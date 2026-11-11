import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ticket, TicketSet } from '../types'
import { GROUPS, ISSUES_QUERY, effectiveLauncher, fit, githubSets, launchArgv, localSet, repoOfRemote, shellCommand, statusOf, visibleOrder, type GqlIssue, type Launcher, type LocalFile, type Status } from './tickets'

const PANE = 'tickets'
const LOCAL_MS = 5000
// A refresh the person or a ticket write asks for still waits this long after the last read of GitHub.
const FORCE_GAP_MS = 10_000

// Change a shape tag when that value's fields change: it declines what an earlier version stored.
const setsA = atom({ plugin: 'ticket-board', key: 'sets' } as const, [] as TicketSet[], { shape: 'sets-1' })
const activeA = atom({ plugin: 'ticket-board', key: 'active' } as const, '')
const selA = atom({ plugin: 'ticket-board', key: 'sel' } as const, '')
const errorA = atom({ plugin: 'ticket-board', key: 'error' } as const, '')

// Colors: Tokyo Night, as the wayfinder sidebar uses.
const TEXT = '#c0caf5'
const DIM = '#737aa2'
const GREEN = '#9ece6a'
const BLUE = '#7aa2f7'
const YELLOW = '#e0af68'
const PURPLE = '#bb9af7'
const BANNER = '#292e42'
const GROUP: Record<Status, { label: string; mark: string; color: string }> = {
  ready: { label: 'Ready', mark: '▸', color: GREEN },
  human: { label: 'Needs you', mark: '☺', color: PURPLE },
  claimed: { label: 'Claimed', mark: '◐', color: BLUE },
  blocked: { label: 'Blocked', mark: '⧗', color: DIM },
  triage: { label: 'In triage', mark: '?', color: YELLOW },
}

type Opts = { refreshSeconds: number; implementCommand: string; launcher: Launcher }
let opts: Opts = { refreshSeconds: 300, implementCommand: 'implement', launcher: 'iterm' }

function readOptions(options: unknown): Opts {
  const o = (options ?? {}) as Partial<Opts>
  return {
    launcher: o.launcher === 'terminal' || o.launcher === 'copy' ? o.launcher : 'iterm',
    refreshSeconds: typeof o.refreshSeconds === 'number' && o.refreshSeconds >= 30 ? o.refreshSeconds : 300,
    implementCommand: typeof o.implementCommand === 'string' && o.implementCommand.trim() ? o.implementCommand.trim().replace(/^\//, '') : 'implement',
  }
}

type Dollar = EngineInterface
// Module variables start over on a reload; everything drawn lives in $.state.
let root = ''
let platform = '' // `uname -s`: Darwin, Linux, …
let ghRepo: string | null | undefined // undefined: not checked yet; null: none
let lastGh = 0 // when the GitHub tickets held here were read, by this session or another
let paneOpen = false
let ghSets: TicketSet[] = []
let ghError = ''
let busy = false
const localSig = new Map<string, { sig: string; set: TicketSet }>()

// ---------- loading ----------

async function loadLocal($: Dollar): Promise<TicketSet[]> {
  const scratch = `${root}/.scratch`
  if (!(await $.fs.exists(scratch))) return []
  const out: TicketSet[] = []
  for (const dir of await $.fs.list(scratch)) {
    if (dir.kind !== 'dir') continue
    const base = `${scratch}/${dir.name}`
    // A folder with a map.md is a wayfinder map: the wayfinder sidebar shows it.
    if ((await $.fs.exists(`${base}/map.md`)) || !(await $.fs.exists(`${base}/issues`))) continue
    const files = (await $.fs.list(`${base}/issues`)).filter(f => f.kind === 'file' && f.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name))
    const sig = files.map(f => `${f.name}:${f.mtimeMs}`).join(',')
    const cached = localSig.get(base)
    if (cached && cached.sig === sig) { out.push(cached.set); continue }
    const read: LocalFile[] = []
    for (const f of files) {
      try { read.push({ name: f.name, text: await $.fs.read(`${base}/issues/${f.name}`), path: `${base}/issues/${f.name}`, relPath: `.scratch/${dir.name}/issues/${f.name}` }) }
      catch { /* unreadable: left out */ }
    }
    const set = localSet(base, dir.name, read)
    localSig.set(base, { sig, set })
    out.push(set)
  }
  return out.filter(s => s.tickets.length)
}

async function findRepo($: Dollar): Promise<string | null> {
  // The origin remote names the repository without a call to GitHub.
  try {
    const r = await $.process.run(['git', 'remote', 'get-url', 'origin'], { cwd: root, timeoutMs: 5000 })
    const repo = r.exitCode === 0 ? repoOfRemote(r.stdout) : undefined
    if (repo) return repo
  } catch { /* no git here */ }
  try {
    const r = await $.process.run(['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: root, timeoutMs: 15000 })
    return r.exitCode === 0 && r.stdout.trim() ? r.stdout.trim() : null
  } catch { return null }
}

/** One GraphQL request (5 points of the 5,000 an hour), whatever the number of tickets. */
async function fetchGithub($: Dollar, repo: string): Promise<TicketSet[]> {
  const [owner = '', name = ''] = repo.split('/')
  const r = await $.process.run(['gh', 'api', 'graphql', '-f', `query=${ISSUES_QUERY}`, '-f', `o=${owner}`, '-f', `r=${name}`], { cwd: root, timeoutMs: 20000 })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || 'gh api graphql failed')
  const data = JSON.parse(r.stdout) as { data: { repository: { issues: { nodes: GqlIssue[] } } } }
  return githubSets(repo, data.data.repository.issues.nodes)
}

/** What the last session to read a repository's tickets left in the shared store, for every other session. */
type Cache = { at: number; sets: TicketSet[] }

/**
 * Keeps the GitHub tickets current while spending few requests: every session on a repository
 * shares one read through the store, a poll reads only while the pane is open and the shared
 * read is older than the refresh interval, and a forced read still keeps FORCE_GAP_MS.
 */
async function syncGithub($: Dollar, now: number, force: boolean) {
  if (ghRepo === undefined) ghRepo = await findRepo($)
  if (!ghRepo) return
  const key = `gh1:${ghRepo}`
  const cached = (await $.store.get(key).catch(() => undefined)) as Cache | undefined
  if (cached && typeof cached.at === 'number' && Array.isArray(cached.sets) && cached.at > lastGh && cached.at <= now) {
    lastGh = cached.at
    ghSets = cached.sets
    ghError = ''
  }
  const age = now - lastGh
  if (force ? age < FORCE_GAP_MS : (lastGh > 0 && !paneOpen) || age < opts.refreshSeconds * 1000) return
  lastGh = now // a failed read waits out the interval too
  try {
    ghSets = await fetchGithub($, ghRepo)
    ghError = ''
    await $.store.set(key, { at: now, sets: ghSets } satisfies Cache)
  } catch (err) {
    ghError = String(err).slice(0, 200)
  }
}

async function refresh($: Dollar, opt: { force?: boolean } = {}) {
  if (busy || !root) return
  busy = true
  try {
    const now = await $.clock.now()
    const local = await loadLocal($).catch(() => [] as TicketSet[])
    await syncGithub($, now, opt.force === true)
    const next = [...ghSets, ...local]
    // Only a change is written, so a quiet poll redraws nothing.
    if (JSON.stringify(next) !== JSON.stringify(await read($, setsA))) await update($, setsA, () => next)
    if (ghError !== (await read($, errorA))) await update($, errorA, () => ghError)
    const active = await read($, activeA)
    const first = next[0]
    if (first && !next.some(s => s.key === active)) await update($, activeA, () => first.key)
  } finally {
    busy = false
  }
}

// ---------- actions ----------

const activeSet = async ($: Dollar) => {
  const [sets, key] = [await read($, setsA), await read($, activeA)]
  return sets.find(s => s.key === key) ?? sets[0]
}

const selected = async ($: Dollar) => {
  const [set, sel] = [await activeSet($), await read($, selA)]
  return set?.tickets.find(t => t.id === sel)
}

async function openTicket($: Dollar, t: Ticket | undefined) {
  const target = t?.url ?? t?.path
  if (!target) return
  const argv = [platform === 'Darwin' ? 'open' : 'xdg-open', target]
  try {
    const r = await $.process.run(argv)
    if (r.exitCode !== 0) $.ui.toast(`Could not open ${target}: ${r.stderr.trim() || 'exit ' + r.exitCode}`)
  } catch (err) {
    $.ui.toast(`Could not run ${argv[0]}: ${String(err)}`)
  }
}

/** Puts the implement command for the ticket in the prompt box; the person sends it. */
async function implementTicket($: Dollar, t: Ticket | undefined) {
  if (!t) return
  const s = statusOf(t)
  if (s === 'blocked') $.ui.toast(`${t.id} still waits on ${t.blockedBy.join(' ')}.`)
  try { await $.prompt.fill({ text: `/${opts.implementCommand} ${t.ref}` }) }
  catch (err) { $.ui.toast(`Could not fill the prompt: ${String(err).slice(0, 160)}`) }
}

/** Starts a session of its own on the ticket, in a new tab opened in this session's folder. */
async function launchTicket($: Dollar, t: Ticket | undefined) {
  if (!t) return
  if (statusOf(t) === 'blocked') { $.ui.toast(`${t.id} still waits on ${t.blockedBy.join(' ')}: not started.`); return }
  // The folder this session works in, read at the press; the project root where that fails.
  const dir = (await $.session.cwd().catch(() => '')) || root
  const cmd = shellCommand(dir, `/${opts.implementCommand} ${t.ref}`)
  const launcher = effectiveLauncher(opts.launcher, platform)
  const argv = launchArgv(launcher, cmd)
  if (!argv) {
    const r = await $.ui.copy({ text: cmd })
    $.ui.toast(r.isCopied ? `Copied the command that starts ${t.id}.` : 'Could not copy the launch command.')
    return
  }
  const app = launcher === 'iterm' ? 'iTerm' : 'Terminal'
  try {
    const r = await $.process.run(argv, { timeoutMs: 20000 })
    if (r.exitCode === 0) $.ui.toast(`Started ${t.id} in a new ${app} ${launcher === 'iterm' ? 'tab' : 'window'}, in ${dir}.`)
    else $.ui.toast(`Could not open a tab: ${r.stderr.trim().slice(0, 160)}. macOS may be asking to let Claude Code control ${app}.`)
  } catch (err) {
    $.ui.toast(`Could not run osascript: ${String(err)}`)
  }
}

async function move($: Dollar, by: 1 | -1) {
  const set = await activeSet($)
  if (!set) return
  const order = visibleOrder(set)
  if (!order.length) return
  const i = order.indexOf(await read($, selA))
  const next = order[Math.max(0, Math.min(order.length - 1, i < 0 ? 0 : i + by))]!
  await update($, selA, () => next)
  try { void $.ui.scroll({ to: { key: `row:${next}` }, in: PANE }).catch(() => undefined) } catch { /* no surface draws the pane */ }
}

// gh commands that change a ticket: only these make the session read GitHub again.
const GH_WRITE = /\bgh\s+(issue\s+(create|edit|close|reopen|delete|transfer|develop)|pr\s+(create|merge|close|reopen)|api\b[^|;&]*(mutation|(--method|-X)[ =]?(POST|PATCH|PUT|DELETE)))/i

const countOpen = (sets: readonly TicketSet[]) => sets.reduce((n, s) => n + s.tickets.length, 0)

export const register: Register = (on, options) => {
  opts = readOptions(options)

  // ---------- events ----------

  on('session.start', async ($, e, next) => {
    root = (await $.session.root().catch(() => e.cwd)) || e.cwd
    try { platform = (await $.process.run(['uname', '-s'], { timeoutMs: 5000 })).stdout.trim() } catch { platform = '' }
    await $.command.register({ name: 'tickets', description: 'Show the open /to-tickets tickets in a sidebar' })
    $.clock.every(LOCAL_MS, () => { void refresh($) })
    // The pane opens by itself only where there is a ticket to show.
    void refresh($).then(async () => {
      if (!countOpen(await read($, setsA))) return
      paneOpen = true
      void $.ui.open({ id: PANE, title: 'Tickets' })
    })
    return next(e)
  })

  on('command.run', { command: 'tickets' }, async $ => {
    paneOpen = true
    await refresh($, { force: true })
    const n = countOpen(await read($, setsA))
    const r = await $.ui.open({ id: PANE, title: 'Tickets' })
    const error = await read($, errorA)
    return { text: (r.isPlaced ? `Tickets sidebar open: ${n} open ticket${n === 1 ? '' : 's'}.` : `Tickets sidebar is waiting for room: ${r.reason}`) + (error ? ` GitHub could not be read: ${error}` : '') }
  })

  // This session's own writes to tickets (gh calls, local ticket files): refresh at once.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Edit' && e.tool !== 'Write' && e.tool !== 'Bash') return ran
    const path = e.tool === 'Bash' ? '' : e.file_path
    const cmd = e.tool === 'Bash' ? e.command : ''
    if (path.includes('/.scratch/') || GH_WRITE.test(cmd)) void refresh($, { force: cmd !== '' })
    return ran
  }).catch(($, e, next) => next(e))

  // A closed pane stops the polling of GitHub; /tickets opens it again.
  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE) paneOpen = false
    return r
  }).catch(($, e, next) => next(e))

  // ---------- drawing ----------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const W = Math.max(30, e.props.bodyColumns)
    const sets = await read($, setsA)
    const activeKey = await read($, activeA)
    const sel = await read($, selA)
    const error = await read($, errorA)
    const set = sets.find(s => s.key === activeKey) ?? sets[0]

    if (!set) {
      return (
        <Box flexDirection="column">
          <Text color={TEXT}>No open tickets here.</Text>
          <Text dimColor wrap="wrap">Looked for open GitHub sub-issues and ready-for-* issues, and for .scratch/&lt;feature&gt;/issues/*.md. Run /to-tickets to publish some.</Text>
          {error ? <Text color={YELLOW} wrap="wrap">{`! ${error}`}</Text> : null}
          <Button key="k-refresh" plain dimColor hotkey="r" label="refresh" onPress={() => refresh($, { force: true })} />
        </Box>
      )
    }

    const idW = Math.max(2, ...set.tickets.map(t => t.id.length))
    const CELL = 6
    const room = Math.max(6, W - 2 - (idW + 2) - 1 - CELL - 1)
    const title = (id: string) => set.tickets.find(t => t.id === id)?.title ?? ''

    const launcher = effectiveLauncher(opts.launcher, platform)
    const newLabel = launcher === 'iterm' ? 'new tab' : launcher === 'terminal' ? 'new window' : 'copy command'

    const statusCell = (t: Ticket, s: Status) => {
      if (s === 'claimed') return `◐ ${t.assignee.slice(0, 4)}`
      if (s === 'blocked') return t.blockedBy.length === 1 && (t.blockedBy[0] ?? '').length <= CELL - 2 ? `⧗ ${t.blockedBy[0]}` : `⧗ ${t.blockedBy.length}`
      return ''
    }

    const row = (t: Ticket, s: Status) => {
      const isSel = sel === t.id
      const bg = isSel ? BANNER : undefined
      const out = [
        <Box key={`row:${t.id}`} flexDirection="row">
          <Text color={GROUP[s].color}>▐</Text>
          <Button key={`sel:${t.id}`} plain onPress={() => update($, selA, cur => (cur === t.id ? '' : t.id))}>
            <Text backgroundColor={bg} color={DIM}>{` ${t.id.padStart(idW)} `}</Text>
            <Text backgroundColor={bg} color={s === 'blocked' ? DIM : TEXT} bold={isSel}>{fit(t.title, room)}</Text>
            <Text backgroundColor={bg} color={GROUP[s].color}>{' ' + statusCell(t, s).padStart(CELL).slice(-CELL) + ' '}</Text>
          </Button>
        </Box>,
      ]
      if (isSel) {
        out.push(
          <Box key={`detail:${t.id}`} flexDirection="column" paddingLeft={2} marginBottom={1}>
            <Text color={TEXT} wrap="wrap">{t.title}</Text>
            <Text dimColor>{`${t.label || 'no triage label'}${t.assignee ? ` · claimed by ${t.assignee}` : ''}`}</Text>
            {t.blockedBy.map(b => <Text key={`w:${b}`} dimColor>{`waits on ${b} ${fit(title(b), Math.max(4, W - 13 - b.length)).trimEnd()}`}</Text>)}
            {t.unblocks.length
              ? <Text dimColor wrap="wrap">{`unblocks ${t.unblocks.join(' ')}`}</Text>
              : <Text dimColor>unblocks nothing</Text>}
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Button key={`open:${t.id}`} label="open" onPress={() => openTicket($, t)} />
              <Button key={`new:${t.id}`} variant={s === 'ready' ? 'primary' : undefined} label={newLabel} onPress={() => launchTicket($, t)} />
              <Button key={`go:${t.id}`} label="this tab" onPress={() => implementTicket($, t)} />
            </Box>
          </Box>,
        )
      }
      return out
    }

    const body: unknown[] = []
    const counts: { text: string; color: string }[] = []
    for (const s of GROUPS) {
      const ts = set.tickets.filter(t => statusOf(t) === s)
      if (s !== 'triage' || ts.length) counts.push({ text: `${ts.length} ${GROUP[s].mark}`, color: GROUP[s].color })
      if (!ts.length) continue
      body.push(<Text key={`g:${s}`} color={GROUP[s].color}>{`${GROUP[s].mark} ${GROUP[s].label} `}<Text dimColor>{String(ts.length)}</Text></Text>)
      for (const t of ts) body.push(...row(t, s))
      body.push(<Text key={`gap:${s}`}> </Text>)
    }
    if (set.total) counts.push({ text: `✓ ${set.done}/${set.total}`, color: DIM })

    const right = counts.map(c => c.text).join('  ') + ' '
    const brand = W - 2 - right.length >= 10 ? ' ▤ TICKETS' : ' ▤'
    const sep = '─'.repeat(W)

    return (
      <Box flexDirection="column" width={W}>
        {sets.length > 1 ? (
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {sets.map(x => (
              <Button key={`set:${x.key}`} label={fit(x.title, 18).trim()} variant={x.key === set.key ? 'primary' : 'secondary'} onPress={() => update($, activeA, () => x.key)} />
            ))}
          </Box>
        ) : null}
        <Box key="banner" flexDirection="row">
          <Text color={BANNER}>▐</Text>
          <Text backgroundColor={BANNER} color={TEXT} bold>{brand}</Text>
          <Text backgroundColor={BANNER}>{' '.repeat(Math.max(1, W - 2 - brand.length - right.length))}</Text>
          {counts.map((c, i) => <Text key={`n:${i}`} backgroundColor={BANNER} color={c.color}>{(i ? '  ' : '') + c.text}</Text>)}
          <Text backgroundColor={BANNER}> </Text>
          <Text color={BANNER}>▌</Text>
        </Box>
        <Text color={TEXT} bold wrap="wrap">{`◎ ${set.title}`}</Text>
        {error ? <Text color={YELLOW} wrap="wrap">{`! ${error}`}</Text> : null}
        <Text dimColor>{sep}</Text>
        {body as never}
        <Text dimColor>{sep}</Text>
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          <Button key="k-up" plain dimColor hotkey="i" label="up" onPress={() => move($, -1)} />
          <Button key="k-down" plain dimColor hotkey="k" label="down" onPress={() => move($, 1)} />
          <Button key="k-open" plain dimColor hotkey="o" label="open" onPress={async () => openTicket($, await selected($))} />
          <Button key="k-new" plain dimColor hotkey="n" label={newLabel} onPress={async () => launchTicket($, await selected($))} />
          <Button key="k-go" plain dimColor hotkey="g" label="this tab" onPress={async () => implementTicket($, await selected($))} />
          <Button key="k-refresh" plain dimColor hotkey="r" label="refresh" onPress={() => refresh($, { force: true })} />
        </Box>
      </Box>
    )
  })
}
