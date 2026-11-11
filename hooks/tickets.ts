// Pure parsing and status logic for /to-tickets tickets. No `$` in here, so it is easy to test.
import type { Ticket, TicketKind, TicketSet } from '../types'

// ---------- GitHub ----------

type Labels = { nodes: { name: string }[] }
type Edge = { number: number; state: string }

/** One open issue as the GraphQL query in `ISSUES_QUERY` returns it. */
export type GqlIssue = {
  number: number
  title: string
  url: string
  labels: Labels
  assignees: { nodes: { login: string }[] }
  parent: null | { number: number; title: string; url: string; labels: Labels; subIssuesSummary: { total: number; completed: number } }
  subIssuesSummary: { total: number }
  blockedBy: { nodes: Edge[] }
  blocking: { nodes: Edge[] }
}

export const ISSUES_QUERY = `query($o:String!,$r:String!){repository(owner:$o,name:$r){issues(first:100,states:OPEN,orderBy:{field:CREATED_AT,direction:ASC}){nodes{
number title url labels(first:20){nodes{name}} assignees(first:3){nodes{login}}
parent{number title url labels(first:20){nodes{name}} subIssuesSummary{total completed}}
subIssuesSummary{total} blockedBy(first:30){nodes{number state}} blocking(first:30){nodes{number state}}}}}}`

const names = (l: Labels) => l.nodes.map(n => n.name)
const isWayfinder = (l: Labels) => names(l).some(n => n.startsWith('wayfinder:'))
const openIds = (edges: Edge[]) => edges.filter(e => e.state.toUpperCase() === 'OPEN').map(e => `#${e.number}`)

export function kindOf(text: string): TicketKind {
  if (text.includes('ready-for-human')) return 'human'
  return text.includes('ready-for-agent') ? 'agent' : 'triage'
}

const TRIAGE = ['ready-for-agent', 'ready-for-human', 'needs-triage', 'needs-info']

/**
 * Groups a repo's open issues into ticket sets. A ticket is a sub-issue of a parent (the spec or
 * plan /to-tickets broke down), or a parentless issue carrying a ready-for-* label. Wayfinder
 * maps and their tickets are left to the wayfinder sidebar, and a parent is a set, not a ticket.
 */
export function githubSets(repo: string, issues: readonly GqlIssue[]): TicketSet[] {
  const sets = new Map<string, TicketSet & { order: number }>()
  for (const i of issues) {
    if (isWayfinder(i.labels) || (i.parent && isWayfinder(i.parent.labels))) continue
    if (!i.parent && i.subIssuesSummary.total > 0) continue
    const label = names(i.labels).find(n => TRIAGE.includes(n)) ?? ''
    if (!i.parent && kindOf(label) === 'triage') continue
    const key = i.parent ? `github:${repo}#${i.parent.number}` : `github:${repo}`
    let set = sets.get(key)
    if (!set) {
      set = i.parent
        ? { key, tracker: 'github', title: i.parent.title, url: i.parent.url, total: i.parent.subIssuesSummary.total, done: i.parent.subIssuesSummary.completed, tickets: [], order: i.parent.number }
        : { key, tracker: 'github', title: 'Tickets without a parent', total: 0, done: 0, tickets: [], order: Infinity }
      sets.set(key, set)
    }
    set.tickets.push({
      id: `#${i.number}`,
      title: i.title,
      kind: kindOf(label),
      label,
      assignee: i.assignees.nodes[0]?.login ?? '',
      blockedBy: openIds(i.blockedBy.nodes),
      unblocks: openIds(i.blocking.nodes),
      url: i.url,
      ref: `#${i.number}`,
    })
  }
  return [...sets.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...set }) => ({ ...set, tickets: set.tickets.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))) }))
}

/** "git@github.com:o/r.git" or "https://github.com/o/r" → "o/r"; undefined for any other host. */
export const repoOfRemote = (url: string) => /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?\s*$/.exec(url.trim())?.[1]

// ---------- local files ----------

/** "02-extra-properties.md" → "02", "2" → "02". */
export const localId = (ref: string) => /^(\d+)/.exec(ref.trim())?.[1]?.padStart(2, '0') ?? ref.trim()

export type LocalFile = { name: string; text: string; path: string; relPath: string }

/** One `.scratch/<feature>/issues` folder, its files in the /to-tickets template: "# 01: Title", "**Blocked by:** 01, 02", "**Status:** ready-for-agent". */
export function localSet(key: string, feature: string, files: readonly LocalFile[]): TicketSet {
  const line = (text: string, name: string) =>
    new RegExp(`^\\s*(?:\\*\\*)?${name}:?(?:\\*\\*)?\\s*:?\\s*(.+)$`, 'im').exec(text)?.[1]?.trim() ?? ''
  const parsed = files.map(f => {
    const status = line(f.text, 'Status').toLowerCase()
    const heading = /^#\s+(.+)$/m.exec(f.text)?.[1]?.trim()
    return {
      id: localId(f.name),
      title: (heading ?? f.name.replace(/\.md$/, '').replace(/-/g, ' ')).replace(/^\d+\s*[:.-]?\s*/, ''),
      status,
      closed: /closed|resolved|done|complete|wontfix/.test(status),
      blockers: (line(f.text, 'Blocked by').match(/\b\d{1,3}\b/g) ?? []).map(localId),
      file: f,
    }
  })
  const open = parsed.filter(p => !p.closed)
  const isOpen = new Set(open.map(p => p.id))
  const tickets: Ticket[] = open.map(p => ({
    id: p.id,
    title: p.title,
    kind: kindOf(p.status),
    label: p.status,
    assignee: /claimed|in.progress/.test(p.status) ? 'claimed' : '',
    // A blocker number that names no open ticket does not block.
    blockedBy: p.blockers.filter(b => isOpen.has(b) && b !== p.id),
    unblocks: open.filter(o => o.id !== p.id && o.blockers.includes(p.id)).map(o => o.id),
    path: p.file.path,
    ref: p.file.relPath,
  }))
  return { key, tracker: 'local', title: feature.replace(/-/g, ' '), total: parsed.length, done: parsed.length - open.length, tickets }
}

// ---------- status ----------

export type Status = 'ready' | 'human' | 'claimed' | 'blocked' | 'triage'

export function statusOf(t: Ticket): Status {
  if (t.assignee) return 'claimed'
  if (t.blockedBy.length) return 'blocked'
  return t.kind === 'agent' ? 'ready' : t.kind
}

export const GROUPS: readonly Status[] = ['ready', 'human', 'claimed', 'blocked', 'triage']

/** Ticket ids in the order the pane lists them. */
export const visibleOrder = (set: TicketSet) =>
  GROUPS.flatMap(s => set.tickets.filter(t => statusOf(t) === s).map(t => t.id))

// ---------- text helpers ----------

export const fit = (s: string, n: number) =>
  n <= 0 ? '' : s.length <= n ? s.padEnd(n) : s.slice(0, Math.max(0, n - 1)) + '…'

// ---------- starting a session in a new tab ----------

export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
export const appleQuote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** The line the new tab runs: Claude Code started in `dir` on the implement command for the ticket. */
export const shellCommand = (dir: string, prompt: string) => `cd ${shellQuote(dir)} && claude ${shellQuote(prompt)}`

export type Launcher = 'iterm' | 'terminal' | 'copy'

/** iTerm and Terminal.app exist only on macOS (`uname -s` says Darwin); elsewhere the command is copied. */
export const effectiveLauncher = (launcher: Launcher, platform: string): Launcher =>
  launcher === 'copy' || platform === 'Darwin' ? launcher : 'copy'

/** osascript argv for a new tab running `cmd`. The line is written to the tab just made, by reference, never to whichever tab is in front. */
export function launchArgv(launcher: Launcher, cmd: string): string[] | undefined {
  if (launcher === 'iterm') {
    return [
      'osascript',
      '-e', 'tell application "iTerm"',
      '-e', 'activate',
      '-e', 'if (count of windows) = 0 then',
      '-e', 'set made to current session of (create window with default profile)',
      '-e', 'else',
      '-e', 'tell current window',
      '-e', 'set t to (create tab with default profile)',
      '-e', 'end tell',
      '-e', 'set made to current session of t',
      '-e', 'end if',
      '-e', `tell made to write text ${appleQuote(cmd)}`,
      '-e', 'end tell',
    ]
  }
  if (launcher === 'terminal') {
    return ['osascript', '-e', 'tell application "Terminal"', '-e', 'activate', '-e', `do script ${appleQuote(cmd)}`, '-e', 'end tell']
  }
  return undefined
}
