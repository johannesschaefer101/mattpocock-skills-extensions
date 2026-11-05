import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ctx, Flash, Flow, Launch, Ticket, WfMap } from '../types'
import {
  budgetBar,
  budgetLevel,
  fit,
  fmtTokens,
  ghTicket,
  localId,
  newlyReady,
  nextUnblocked,
  openBlockers,
  parseLocalTicket,
  parseMapBody,
  plainText,
  statusOf,
  taskListNumbers,
  wrapLines,
  type GhIssue,
  type Status,
} from './tracker'
import { effectiveLauncher, handoffFile, handoffPrompt, launchArgv, openArgv, sessionPrompt, shellCommand, type Launcher } from './launch'

const P = 'wayfinder-sidebar'
const PANE = 'wayfinder'
const TICK_MS = 150
const LAUNCH_TTL_MS = 10 * 60 * 1000
const FLASH_MS = 1600
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

// Change a shape tag when that value's fields change: it declines what an earlier version stored.
const mapsA = atom({ plugin: 'wayfinder-sidebar', key: 'maps' } as const, [] as WfMap[], { shape: 'maps-1' })
const activeA = atom({ plugin: 'wayfinder-sidebar', key: 'active' } as const, '')
const selA = atom({ plugin: 'wayfinder-sidebar', key: 'sel' } as const, '')
const flowA = atom({ plugin: 'wayfinder-sidebar', key: 'flow' } as const, null as Flow | null, { shape: 'flow-1' })
const pickedA = atom({ plugin: 'wayfinder-sidebar', key: 'picked' } as const, [] as string[])
const launchesA = atom({ plugin: 'wayfinder-sidebar', key: 'launches' } as const, [] as Launch[], { shape: 'launches-1' })
const flashA = atom({ plugin: 'wayfinder-sidebar', key: 'flash' } as const, null as Flash | null, { shape: 'flash-1' })
const mineA = atom({ plugin: 'wayfinder-sidebar', key: 'mine' } as const, [] as string[])
const peersA = atom({ plugin: 'wayfinder-sidebar', key: 'peers' } as const, {} as Record<string, string>, { shape: 'peers-1' })
const showDoneA = atom({ plugin: 'wayfinder-sidebar', key: 'showDone' } as const, false)
const spinA = atom({ plugin: 'wayfinder-sidebar', key: 'spin' } as const, 0)
const contextsA = atom({ plugin: 'wayfinder-sidebar', key: 'contexts' } as const, [] as Ctx[], { shape: 'contexts-1' })
const selfCtxA = atom({ plugin: 'wayfinder-sidebar', key: 'selfCtx' } as const, null as { tokens?: number; window: number } | null, { shape: 'selfctx-1' })

// Colors: Proschi's palette for the types, dark tints for the row chips.
const COLOR = { grilling: '#ec4899', prototype: '#a855f7', research: '#3b82f6', task: '#f97316', unknown: '#8590a8' } as const
const TINT = { grilling: '#3a1a2d', prototype: '#2e1f45', research: '#172745', task: '#3a2212', unknown: '#242b3b' } as const
const WORD = { grilling: 'grill', prototype: 'proto', research: 'rsrch', task: 'task', unknown: '?' } as const
const INK = '#0b1020'
const TEXT = '#dbe1ee'
const DIM = '#7c869c'
const GREEN = '#22c55e'
const FLASH_TINT = '#14532d'
const BLUE = '#7aa7ff'
const YELLOW = '#eab308'
const BTN = '#2a3550'
const BANNER = '#1c2540'
const RED = '#ef4444'
const LEVEL = { ok: GREEN, warn: YELLOW, over: RED } as const

type Opts = { launcher: Launcher; editor: string; pollSeconds: number; githubSeconds: number; contextBudget: number }

let opts: Opts = { launcher: 'iterm', editor: '', pollSeconds: 3, githubSeconds: 45, contextBudget: 200_000 }

function readOptions(options: unknown): Opts {
  const o = (options ?? {}) as Partial<Opts>
  return {
    launcher: o.launcher === 'terminal' || o.launcher === 'copy' ? o.launcher : 'iterm',
    editor: typeof o.editor === 'string' ? o.editor.trim() : '',
    pollSeconds: typeof o.pollSeconds === 'number' && o.pollSeconds > 0 ? o.pollSeconds : 3,
    githubSeconds: typeof o.githubSeconds === 'number' && o.githubSeconds >= 10 ? o.githubSeconds : 45,
    contextBudget: typeof o.contextBudget === 'number' && o.contextBudget >= 1000 ? o.contextBudget : 200_000,
  }
}

type Dollar = EngineInterface
// Module variables start over on a reload; everything drawn lives in $.state.
let root = ''
let sessionId = ''
let tmp = '/tmp'
let platform = '' // `uname -s`: Darwin, Linux, …
let skillText: string | undefined
let ghRepo: string | null | undefined // undefined: not checked yet; null: none
let lastGh = 0
let ghMaps: WfMap[] = []
let busy = false
let tick = 0
const localSig = new Map<string, { sig: string; map: WfMap }>()

// ---------- loading ----------

async function loadLocal($: Dollar): Promise<WfMap[]> {
  const scratch = `${root}/.scratch`
  if (!(await $.fs.exists(scratch))) return []
  const out: WfMap[] = []
  for (const dir of await $.fs.list(scratch)) {
    if (dir.kind !== 'dir') continue
    const base = `${scratch}/${dir.name}`
    const mapPath = `${base}/map.md`
    if (!(await $.fs.exists(mapPath))) continue
    let ticketDir = ''
    for (const name of ['tickets', 'issues']) if (await $.fs.exists(`${base}/${name}`)) { ticketDir = `${base}/${name}`; break }
    const files = ticketDir ? (await $.fs.list(ticketDir)).filter(f => f.kind === 'file' && f.name.endsWith('.md')) : []
    const mapStat = await $.fs.stat(mapPath)
    const sig = `${mapStat.mtimeMs}|${files.map(f => `${f.name}:${f.mtimeMs}`).join(',')}`
    const cached = localSig.get(mapPath)
    if (cached && cached.sig === sig) { out.push(cached.map); continue }
    try {
      const header = parseMapBody(await $.fs.read(mapPath), dir.name)
      const tickets: Ticket[] = []
      for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
        const path = `${ticketDir}/${f.name}`
        try { tickets.push(parseLocalTicket(f.name, await $.fs.read(path), path)) }
        catch { tickets.push({ id: localId(f.name), title: f.name, type: 'unknown', hitl: false, closed: false, assignee: '', blockedBy: [], path, warning: 'could not read the file' }) }
      }
      const map: WfMap = { key: mapPath, tracker: 'local', relPath: `.scratch/${dir.name}/map.md`, ...header, tickets }
      localSig.set(mapPath, { sig, map })
      out.push(map)
    } catch (err) {
      out.push({ key: mapPath, tracker: 'local', relPath: `.scratch/${dir.name}/map.md`, title: dir.name, destination: '', fog: [], decisions: 0, tickets: [], error: String(err) })
    }
  }
  return out
}

async function gh($: Dollar, args: string[]): Promise<unknown> {
  const r = await $.process.run(['gh', ...args], { cwd: root, timeoutMs: 20000 })
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `gh ${args[0]} failed`)
  return JSON.parse(r.stdout)
}

async function loadGithub($: Dollar): Promise<WfMap[]> {
  if (ghRepo === undefined) {
    try {
      const r = await $.process.run(['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: root, timeoutMs: 15000 })
      ghRepo = r.exitCode === 0 && r.stdout.trim() ? r.stdout.trim() : null
    } catch { ghRepo = null }
  }
  if (!ghRepo) return []
  const repo = ghRepo
  const mapIssues = (await gh($, ['issue', 'list', '--repo', repo, '--label', 'wayfinder:map', '--state', 'open', '--json', 'number,title,url,body', '--limit', '20'])) as { number: number; title: string; url: string; body: string }[]
  const out: WfMap[] = []
  for (const mi of mapIssues) {
    const header = parseMapBody(`# ${mi.title}\n${mi.body ?? ''}`, mi.title)
    let children: GhIssue[]
    try { children = (await gh($, ['api', `repos/${repo}/issues/${mi.number}/sub_issues?per_page=100`])) as GhIssue[] }
    catch {
      children = []
      for (const n of taskListNumbers(mi.body ?? '')) {
        try { children.push((await gh($, ['api', `repos/${repo}/issues/${n}`])) as GhIssue) } catch { /* skip */ }
      }
    }
    const tickets = await Promise.all(children.map(async c => {
      let native: number[] | undefined
      if (c.state.toLowerCase() !== 'closed') {
        try { native = ((await gh($, ['api', `repos/${repo}/issues/${c.number}/dependencies/blocked_by`])) as { number: number }[]).map(x => x.number) }
        catch { native = undefined }
      }
      return ghTicket(c, native)
    }))
    out.push({ key: `github:${repo}#${mi.number}`, tracker: 'github', url: mi.url, repo, number: mi.number, ...header, tickets })
  }
  return out
}

async function refresh($: Dollar, opt: { github?: boolean } = {}) {
  if (busy || !root) return
  busy = true
  try {
    const now = await $.clock.now()
    const local = await loadLocal($)
    if (opt.github || now - lastGh > opts.githubSeconds * 1000) {
      lastGh = now
      try { ghMaps = await loadGithub($) } catch (err) { ghMaps = ghMaps.map(m => ({ ...m, error: String(err) })) }
    }
    const next = [...local, ...ghMaps]
    const prev = await read($, mapsA)
    // Tickets a resolution just unblocked flash once.
    const fresh: string[] = []
    for (const m of next) {
      const before = prev.find(p => p.key === m.key)
      if (before) fresh.push(...newlyReady(before.tickets, m.tickets).map(id => `${m.key}|${id}`))
    }
    await update($, mapsA, () => next)
    if (fresh.length) await update($, flashA, () => ({ ids: fresh, until: now + FLASH_MS }))
    const active = await read($, activeA)
    const first = next[0]
    if (!next.some(m => m.key === active) && first) await update($, activeA, () => first.key)
    // A launch stops showing once its ticket is claimed, or after ten minutes.
    await update($, launchesA, ls => ls.filter(l => {
      const t = next.find(m => m.key === l.mapKey)?.tickets.find(x => x.id === l.id)
      return t && !t.assignee && !t.closed && now - l.at < LAUNCH_TTL_MS
    }))
    await syncPeers($, next)
    await cleanHandoffs($, next)
  } finally {
    busy = false
  }
}

// ---------- which tab holds which ticket ----------

/** What each tab running the mod keeps in the shared store under `peer:<session id>`. */
type PeerRecord = { claims: string[]; tokens?: number; window?: number; at?: number }

const readPeer = (v: unknown): PeerRecord =>
  Array.isArray(v) ? { claims: v as string[] } : ((v ?? { claims: [] }) as PeerRecord) // 0.1.0 stored a bare list

async function publishSelf($: Dollar, claims: string[]) {
  if (!sessionId) return
  const self = await read($, selfCtxA)
  const rec: PeerRecord = { claims, tokens: self?.tokens, window: self?.window, at: await $.clock.now() }
  await $.store.set(`peer:${sessionId}`, rec)
}

async function syncPeers($: Dollar, maps: WfMap[]) {
  const mine = await read($, mineA)
  const open = new Set<string>()
  for (const m of maps) for (const t of m.tickets) if (t.assignee && !t.closed) open.add(`${m.key}|${t.id}`)
  const kept = mine.filter(k => open.has(k))
  if (kept.length !== mine.length) await update($, mineA, () => kept)
  await publishSelf($, kept)
  const labels: Record<string, string> = {}
  const contexts: Ctx[] = []
  for (const key of await $.store.keys()) {
    if (!key.startsWith('peer:') || key === `peer:${sessionId}`) continue
    const rec = readPeer(await $.store.get(key))
    const sid = key.slice(5)
    const live = rec.claims.filter(k => open.has(k))
    if (!live.length) { await $.store.delete(key); continue }
    for (const k of live) labels[k] = sid.slice(0, 3)
    if (rec.window) contexts.push({ who: sid.slice(0, 3), keys: live, tokens: rec.tokens, window: rec.window, at: rec.at ?? 0 })
  }
  await update($, peersA, () => labels)
  await update($, contextsA, () => contexts)
}

async function noteClaim($: Dollar, mapKey: string, id: string) {
  await update($, mineA, ms => (ms.includes(`${mapKey}|${id}`) ? ms : [...ms, `${mapKey}|${id}`]))
}

// ---------- handoffs ----------

type HandoffRecord = { path: string; mapKey: string; ids: string[]; at: number }

async function cleanHandoffs($: Dollar, maps: WfMap[]) {
  if (tick % 200 !== 0) return // every ~30s
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    if (!key.startsWith('handoff:')) continue
    const rec = (await $.store.get(key)) as HandoffRecord | undefined
    if (!rec) continue
    const m = maps.find(x => x.key === rec.mapKey)
    const allClosed = m ? rec.ids.every(id => m.tickets.find(t => t.id === id)?.closed ?? true) : false
    const stale = now - rec.at > 7 * 24 * 3600 * 1000
    if (allClosed || stale) {
      try { await $.process.run(['rm', '-f', rec.path]) } catch { /* already gone */ }
      await $.store.delete(key)
    }
  }
}

// ---------- actions ----------

const activeMap = async ($: Dollar) => {
  const [maps, key] = [await read($, mapsA), await read($, activeA)]
  return maps.find(m => m.key === key) ?? maps[0]
}

async function launchSet($: Dollar): Promise<Set<string>> {
  const m = await activeMap($)
  return new Set((await read($, launchesA)).filter(l => l.mapKey === m?.key).map(l => l.id))
}

async function openPath($: Dollar, target: string) {
  const argv = openArgv(target, opts.editor, platform)
  try {
    const r = await $.process.run(argv)
    if (r.exitCode !== 0) $.ui.toast(`Could not open ${target}: ${r.stderr.trim() || 'exit ' + r.exitCode}`)
  } catch (err) {
    $.ui.toast(`Could not run ${argv[0]}: ${String(err)}`)
  }
}

async function openTicket($: Dollar, id: string) {
  const m = await activeMap($)
  const t = m?.tickets.find(x => x.id === id)
  if (!t) return
  const target = t.path ?? t.url
  if (target) await openPath($, target)
}

async function startPressed($: Dollar, id: string) {
  const m = await activeMap($)
  if (!m) return
  if (await read($, flowA)) { $.ui.toast('Finish or cancel the start in progress first.'); return }
  const launching = await launchSet($)
  const picked = (await read($, pickedA)).filter(p => {
    const t = m.tickets.find(x => x.id === p)
    return t && statusOf(t, m.tickets, launching) === 'ready'
  })
  const t = m.tickets.find(x => x.id === id)
  const ids = picked.length ? picked : t && statusOf(t, m.tickets, launching) === 'ready' ? [t.id] : []
  if (!ids.length) {
    const s = t ? statusOf(t, m.tickets, launching) : 'closed'
    $.ui.toast(s === 'blocked' && t ? `${t.id} is waiting on ${openBlockers(t, m.tickets).join(', ')}.` : `${id} is not ready to start.`)
    return
  }
  await update($, selA, () => ids[0])
  await update($, flowA, () => ({ mapKey: m.key, ids, stage: 'ask', startedAt: 0 }))
}

async function beginHandoff($: Dollar) {
  const flow = await read($, flowA)
  const m = await activeMap($)
  if (!flow || !m) return
  const now = await $.clock.now()
  const path = handoffFile(tmp, m, flow.ids, now)
  const tickets = flow.ids.map(id => m.tickets.find(t => t.id === id)).filter((t): t is Ticket => !!t)
  await update($, flowA, (): Flow => ({ ...flow, stage: 'writing', handoffPath: path, startedAt: now }))
  const rec: HandoffRecord = { path, mapKey: m.key, ids: flow.ids, at: now }
  await $.store.set(`handoff:${path}`, rec)
  void $.prompt.submit({ text: handoffPrompt(m, tickets, path, skillText) })
}

async function launchAll($: Dollar, withHandoff: boolean) {
  const flow = await read($, flowA)
  const m = await activeMap($)
  if (!flow || !m) return
  const path = withHandoff ? flow.handoffPath : undefined
  const cmds = flow.ids.map(id => {
    const t = m.tickets.find(x => x.id === id)!
    return shellCommand(root, sessionPrompt(m, t, path))
  })
  let ok = 0
  const launcher = effectiveLauncher(opts.launcher, platform)
  if (launcher === 'copy') {
    const r = await $.ui.copy({ text: cmds.join('\n') })
    const why = opts.launcher === 'copy' ? '' : ` (${opts.launcher === 'iterm' ? 'iTerm' : 'Terminal'} launching is macOS only)`
    $.ui.toast(r.isCopied ? `Copied ${cmds.length} launch command${cmds.length > 1 ? 's' : ''}${why}.` : 'Could not copy the launch command.')
    ok = r.isCopied ? cmds.length : 0
  } else {
    for (const cmd of cmds) {
      const argv = launchArgv(launcher, cmd)!
      try {
        const r = await $.process.run(argv, { timeoutMs: 20000 })
        if (r.exitCode === 0) ok++
        else $.ui.toast(`Could not open a tab: ${r.stderr.trim().slice(0, 160)}. macOS may be asking to let Claude Code control ${launcher === 'iterm' ? 'iTerm' : 'Terminal'}.`)
      } catch (err) { $.ui.toast(`Could not run osascript: ${String(err)}`) }
    }
    if (ok) $.ui.toast(`Started ${ok} session${ok > 1 ? 's' : ''}${path ? ' with the handoff' : ''}.`)
  }
  const now = await $.clock.now()
  if (ok) await update($, launchesA, ls => [...ls, ...flow.ids.map(id => ({ mapKey: m.key, id, at: now }))])
  await update($, pickedA, () => [])
  await update($, flowA, () => null)
}

async function discard($: Dollar) {
  const flow = await read($, flowA)
  if (flow?.handoffPath) {
    try { await $.process.run(['rm', '-f', flow.handoffPath]) } catch { /* gone */ }
    await $.store.delete(`handoff:${flow.handoffPath}`)
  }
  await update($, flowA, () => null)
}

async function move($: Dollar, by: 1 | -1) {
  const m = await activeMap($)
  if (!m) return
  const order = visibleOrder(m, await launchSet($))
  if (!order.length) return
  const cur = await read($, selA)
  const i = order.indexOf(cur)
  const next = order[Math.max(0, Math.min(order.length - 1, i < 0 ? 0 : i + by))]
  await update($, selA, () => next)
  void $.ui.scroll({ to: { key: `row:${next}` }, in: PANE })
}

async function onTick($: Dollar) {
  tick++
  const now = await $.clock.now()
  const flash = await read($, flashA)
  if (flash && now > flash.until) await update($, flashA, () => null)
  const flow = await read($, flowA)
  if (flow?.stage === 'writing' && flow.handoffPath && tick % 7 === 0) {
    if (await $.fs.exists(flow.handoffPath)) {
      const st = await $.fs.stat(flow.handoffPath)
      if (st.size > 0) await update($, flowA, (f): Flow | null => (f ? { ...f, stage: 'ready' } : f))
    }
  }
  // Only spin while something on screen spins.
  const m = await activeMap($)
  const spinning = flow?.stage === 'writing' || (m?.tickets.some(t => t.assignee && !t.closed) ?? false)
  if (spinning) await update($, spinA, n => (n + 1) % 1000)
  if (tick % Math.max(1, Math.round((opts.pollSeconds * 1000) / TICK_MS)) === 0) await refresh($)
}

function visibleOrder(m: WfMap, launching: Set<string>): string[] {
  const by = (s: Status) => m.tickets.filter(t => statusOf(t, m.tickets, launching) === s).map(t => t.id)
  return [...by('ready'), ...by('claimed'), ...by('launching'), ...by('blocked')]
}

async function afterToolCall($: Dollar, path: string, cmd: string) {
  const before = await read($, mapsA)
  await refresh($, { github: cmd !== '' })
  const after = await read($, mapsA)
  for (const m of after) {
    const old = before.find(b => b.key === m.key)
    for (const t of m.tickets) {
      const was = old?.tickets.find(x => x.id === t.id)
      const claimedNow = t.assignee && !t.closed && (!was || !was.assignee)
      const byThisCall = (t.path !== undefined && t.path === path) ||
        (m.tracker === 'github' && new RegExp(`gh\\s+issue\\s+edit\\s+${t.id.slice(1)}\\b.*--add-assignee`).test(cmd))
      if (claimedNow && byThisCall) await noteClaim($, m.key, t.id)
    }
  }
}

async function startup($: Dollar) {
  await refresh($, { github: true })
  const maps = await read($, mapsA)
  const first = maps.find(m => m.tracker === 'local') ?? maps[0]
  if (first) void $.ui.open({ id: PANE, title: first.title })
}

export const register: Register = (on, options) => {
  opts = readOptions(options)

  // ---------- events ----------

  on('session.start', async ($, e, next) => {
    root = (await $.session.root().catch(() => e.cwd)) || e.cwd
    sessionId = await $.session.id().catch(() => '')
    tmp = (await $.env.get('TMPDIR')) || '/tmp'
    try { platform = (await $.process.run(['uname', '-s'], { timeoutMs: 5000 })).stdout.trim() } catch { platform = '' }
    const home = await $.env.get('HOME')
    for (const p of [`${home}/.claude/skills/handoff/SKILL.md`, `${home}/.agents/skills/handoff/SKILL.md`]) {
      try { skillText = await $.fs.read(p); break } catch { /* not installed there */ }
    }
    await $.command.register({ name: 'wayfinder-map', description: 'Show the wayfinder map sidebar', argumentHint: '[refresh]' })
    $.clock.every(TICK_MS, () => { void onTick($) })
    void $.session.usage().then(u => update($, selfCtxA, () => ({ tokens: u.context.tokens, window: u.context.window }))).catch(() => undefined)
    void startup($)
    return next(e)
  })

  // This session's context fill, for the budget bars: kept here and shared with the other tabs.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      await update($, selfCtxA, () => ({ tokens: e.context.tokens, window: e.context.window }))
      await publishSelf($, await read($, mineA))
    }
    return next(e)
  })

  on('command.run', { command: 'wayfinder-map' }, async $ => {
    await refresh($, { github: true })
    const maps = await read($, mapsA)
    if (!maps.length) return { text: 'No wayfinder map found: looked for .scratch/<effort>/map.md and open GitHub issues labelled wayfinder:map.' }
    const r = await $.ui.open({ id: PANE, title: (await activeMap($))?.title ?? 'Wayfinder' })
    return { text: r.isPlaced ? `Wayfinder sidebar open (${maps.length} map${maps.length > 1 ? 's' : ''}).` : `Wayfinder sidebar is waiting for room: ${r.reason}` }
  })

  // This session's own edits to ticket files: refresh at once, and remember claims it made.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Edit' && e.tool !== 'Write' && e.tool !== 'Bash') return ran
    const path = e.tool === 'Bash' ? '' : e.file_path
    const cmd = e.tool === 'Bash' ? e.command : ''
    if (path.includes('/.scratch/') || /\bgh\s+(issue|api)\b/.test(cmd)) void afterToolCall($, path, cmd)
    return ran
  }).catch(($, e, next) => next(e))

  // ---------- drawing ----------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const W = Math.max(36, e.props.bodyColumns)
    const maps = await read($, mapsA)
    const activeKey = await read($, activeA)
    const m = maps.find(x => x.key === activeKey) ?? maps[0]
    const sel = await read($, selA)
    const flow = await read($, flowA)
    const picked = await read($, pickedA)
    const launches = await read($, launchesA)
    const flash = await read($, flashA)
    const mine = await read($, mineA)
    const peers = await read($, peersA)
    const showDone = await read($, showDoneA)
    const contexts = await read($, contextsA)
    const selfCtx = await read($, selfCtxA)
    const spin = SPIN[(await read($, spinA)) % SPIN.length]

    if (!m) {
      return (
        <Box flexDirection="column">
          <Text color={TEXT}>No wayfinder map here yet.</Text>
          <Text dimColor>Looked for .scratch/&lt;effort&gt;/map.md and open GitHub issues labelled wayfinder:map. Run /wayfinder to chart one.</Text>
        </Box>
      )
    }

    const launching = new Set(launches.filter(l => l.mapKey === m.key).map(l => l.id))
    const st = (t: Ticket) => statusOf(t, m.tickets, launching)
    const open = m.tickets.filter(t => !t.closed)
    const count = (s: Status) => open.filter(t => st(t) === s).length
    const idW = Math.max(2, ...m.tickets.map(t => t.id.length))
    const room = Math.max(6, W - 25 - idW)
    const kind = m.tracker === 'local' ? ' md ' : ' gh '
    const flashing = new Set(flash?.ids ?? [])

    // Status column: 5 cells.
    const statusCells = (t: Ticket): { text: string; color: string }[] => {
      const s = st(t)
      if (s === 'claimed') {
        const k = `${m.key}|${t.id}`
        const who = mine.includes(k) ? 'you' : peers[k] ?? (t.assignee === 'claude' || t.assignee === 'claimed' ? 'tab' : t.assignee.slice(0, 3))
        return [{ text: `${spin} ${who}`.padStart(5).slice(-5), color: who === 'you' ? BLUE : YELLOW }]
      }
      if (s === 'launching') return [{ text: '↗ new', color: BLUE }]
      if (s === 'blocked') {
        const b = openBlockers(t, m.tickets)
        const color = (id: string) => COLOR[m.tickets.find(x => x.id === id)?.type ?? 'unknown']
        if (m.tracker === 'github' || b.length > 2) {
          const head = m.tracker === 'github' ? `⧗ ${b.length}` : `${b[0]} +${b.length - 1}`
          return [{ text: head.padStart(5).slice(-5), color: DIM }]
        }
        const cells: { text: string; color: string }[] = [{ text: ' '.repeat(5 - (b.length * 3 - 1)), color: DIM }]
        b.forEach((id, i) => cells.push({ text: (i ? ' ' : '') + id, color: color(id) }))
        return cells
      }
      if (flow?.ids.includes(t.id) && flow.mapKey === m.key) return [{ text: flow.stage === 'writing' ? `${spin} ✎`.padStart(5) : flow.stage === 'ready' ? ' ✓ ho' : '  ▶? ', color: YELLOW }]
      return [{ text: '     ', color: DIM }]
    }

    const row = (t: Ticket) => {
      const s = st(t)
      const k = `${m.key}|${t.id}`
      const isFlash = flashing.has(k)
      const tint = isFlash ? FLASH_TINT : TINT[t.type]
      const isPicked = picked.includes(t.id)
      const canRun = s === 'ready'
      const out = [
        <Box key={`row:${t.id}`} flexDirection="row">
          <Text color={isPicked ? GREEN : tint}>{isPicked ? '◆' : '▐'}</Text>
          <Button key={`sel:${t.id}`} plain onPress={() => update($, selA, () => t.id)}>
            <Text backgroundColor={t.hitl ? COLOR[t.type] : INK} color={t.hitl ? INK : COLOR[t.type]} bold>{` ${WORD[t.type]}`.padEnd(6) + ' '}</Text>
            <Text backgroundColor={tint} color={DIM}>{` ${t.id.padStart(idW)} `}</Text>
            <Text backgroundColor={tint} color={s === 'blocked' ? DIM : TEXT} bold={isFlash} underline={sel === t.id}>{fit(t.title, room)}</Text>
            <Text backgroundColor={tint}> </Text>
            {statusCells(t).map(c => <Text backgroundColor={tint} color={c.color}>{c.text}</Text>)}
            <Text backgroundColor={tint}> </Text>
          </Button>
          <Button key={`open:${t.id}`} plain onPress={() => openTicket($, t.id)}>
            <Text backgroundColor={BTN} color={TEXT}>{kind}</Text>
          </Button>
          <Button key={`run:${t.id}`} plain onPress={() => startPressed($, t.id)}>
            <Text backgroundColor={canRun ? BTN : tint} color={canRun ? GREEN : DIM}>{' ▶ '}</Text>
          </Button>
          <Text color={tint}>▌</Text>
        </Box>,
      ]
      if (sel === t.id) {
        const b = openBlockers(t, m.tickets)
        const nu = nextUnblocked(t, m.tickets)
        const tail = nu.more ? ` +${nu.more} more` : ''
        const also = nu.alsoWaits.length ? ` (also waits ${nu.alsoWaits.join(' ')})` : ''
        const nextText = nu.next ? `${nu.next.id} ${fit(nu.next.title, Math.max(8, W - 2 - 'unblocks '.length - nu.next.id.length - 1 - also.length - tail.length)).trimEnd()}` : ''
        out.push(
          <Box key={`detail:${t.id}`} flexDirection="column" paddingLeft={2}>
            <Text color={TEXT} wrap="wrap">{t.title}</Text>
            <Text dimColor>{`${t.hitl ? 'needs you' : 'agent alone'} · ${b.length ? 'waits ' + b.join(' ') : 'no blockers'}`}</Text>
            {nu.next
              ? <Text dimColor wrap="wrap">{'unblocks '}<Text color={COLOR[nu.next.type]}>{nextText}</Text>{also + tail}</Text>
              : <Text dimColor>unblocks nothing</Text>}
            {t.warning ? <Text color={YELLOW}>{`? ${t.warning}`}</Text> : null}
          </Box>,
        )
      }
      if (flow && flow.mapKey === m.key && flow.ids[0] === t.id) out.push(strip(flow))
      return out
    }

    const strip = (f: Flow) => {
      const launcher = effectiveLauncher(opts.launcher, platform)
      const where = launcher === 'iterm' ? 'iTerm tab' : launcher === 'terminal' ? 'Terminal window' : 'command (copied)'
      const what = f.ids.length > 1 ? `${f.ids.length} tickets (${f.ids.join(' ')}) in new ${where}s` : `${f.ids[0]} in a new ${where}`
      if (f.stage === 'ask') {
        return (
          <Box key="strip" flexDirection="column" paddingLeft={2} marginBottom={1}>
            <Text color={YELLOW}>{`▶ Start ${what}?`}</Text>
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Button key="handoff" hotkey="h" variant="primary" label="handoff + start" onPress={() => beginHandoff($)} />
              <Button key="fresh" hotkey="f" label="fresh" onPress={() => launchAll($, false)} />
              <Button key="cancel" hotkey="c" label="cancel" onPress={() => update($, flowA, () => null)} />
            </Box>
          </Box>
        )
      }
      if (f.stage === 'writing') {
        return (
          <Box key="strip" flexDirection="column" paddingLeft={2} marginBottom={1}>
            <Text color={YELLOW}>{`${spin} this session is writing the handoff…`}</Text>
            <Text dimColor>It waits for the current turn to end first.</Text>
            <Box flexDirection="row" gap={1}>
              <Button key="fresh" hotkey="f" label="skip, start fresh" onPress={() => launchAll($, false)} />
              <Button key="cancel" hotkey="c" label="cancel" onPress={() => discard($)} />
            </Box>
          </Box>
        )
      }
      return (
        <Box key="strip" flexDirection="column" paddingLeft={2} marginBottom={1}>
          <Text color={GREEN}>✓ handoff ready</Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key="launch" hotkey="l" variant="primary" label="launch" onPress={() => launchAll($, true)} />
            <Button key="view" hotkey="v" label="view" onPress={() => (f.handoffPath ? openPath($, f.handoffPath) : undefined)} />
            <Button key="discard" hotkey="d" label="discard" onPress={() => discard($)} />
          </Box>
        </Box>
      )
    }

    const groups: [Status, string, string][] = [['ready', '▸ Ready', GREEN], ['claimed', '◐ Claimed', BLUE], ['launching', '↗ Starting', BLUE], ['blocked', '⧗ Blocked', DIM]]
    const body: unknown[] = []
    for (const [s, label, color] of groups) {
      const ts = open.filter(t => st(t) === s)
      if (!ts.length) continue
      body.push(<Text key={`g:${s}`} color={color}>{`${label} `}<Text dimColor>{String(ts.length)}</Text></Text>)
      for (const t of ts) body.push(...row(t))
      body.push(<Text key={`gap:${s}`}> </Text>)
    }
    const done = m.tickets.filter(t => t.closed)
    const sep = '─'.repeat(W)

    // One bar per session on this map against the per-session budget: this one first, then the tabs holding tickets.
    const contextSection = () => {
      const idsOf = (keys: string[]) => keys.filter(k => k.startsWith(`${m.key}|`)).map(k => k.slice(m.key.length + 1))
      const rows: { who: string; ids: string[]; tokens?: number; window: number }[] = []
      if (selfCtx) rows.push({ who: 'you', ids: idsOf(mine), tokens: selfCtx.tokens, window: selfCtx.window })
      for (const c of contexts) { const ids = idsOf(c.keys); if (ids.length) rows.push({ who: c.who, ids, tokens: c.tokens, window: c.window }) }
      if (!rows.length) return null
      const idsW = Math.min(8, Math.max(0, ...rows.map(r => r.ids.join(' ').length)))
      const barW = Math.max(6, W - 2 - 3 - 1 - (idsW ? idsW + 1 : 0) - 1 - 5)
      return (
        <Box key="ctx" flexDirection="column">
          <Text color={TEXT}>{'◔ Context '}<Text dimColor>{`· ${fmtTokens(opts.contextBudget)} a session`}</Text></Text>
          {rows.map(r => {
            const budget = Math.min(opts.contextBudget, r.window)
            const level = budgetLevel(r.tokens, budget)
            const bar = budgetBar(r.tokens, budget, barW)
            return (
              <Text key={`ctx:${r.who}`}>
                <Text color={r.who === 'you' ? BLUE : YELLOW}>{`  ${r.who.padEnd(3)} `}</Text>
                {idsW ? <Text dimColor>{fit(r.ids.join(' '), idsW) + ' '}</Text> : null}
                <Text color={LEVEL[level]}>{bar.fill}</Text>
                <Text color={BTN}>{bar.track}</Text>
                <Text color={level === 'ok' ? DIM : LEVEL[level]} bold={level === 'over'}>{' ' + fmtTokens(r.tokens).padStart(5)}</Text>
              </Text>
            )
          })}
          <Text> </Text>
        </Box>
      )
    }

    // The top bar, drawn like a ticket row: brand on the left, counts on the right.
    const banner = () => {
      const counts: { text: string; color: string }[] = [
        { text: `${count('ready')} ▸`, color: GREEN },
        { text: `${count('claimed')} ◐`, color: BLUE },
        { text: `${count('blocked')} ⧗`, color: DIM },
        { text: `✓ ${done.length}`, color: DIM },
      ]
      const right = counts.map(c => c.text).join('  ') + ' '
      const inner = W - 2
      const brand = inner - right.length >= 13 ? ' ◈ WAYFINDER' : ' ◈'
      const gap = Math.max(1, inner - brand.length - right.length)
      return (
        <Box key="banner" flexDirection="row">
          <Text color={BANNER}>▐</Text>
          <Text backgroundColor={BANNER} color={BLUE} bold>{' ◈'}</Text>
          <Text backgroundColor={BANNER} color={TEXT} bold>{brand.slice(2)}</Text>
          <Text backgroundColor={BANNER}>{' '.repeat(gap)}</Text>
          {counts.map((c, i) => (
            <Text key={`n:${i}`} backgroundColor={BANNER} color={c.color}>{(i ? '  ' : '') + c.text}</Text>
          ))}
          <Text backgroundColor={BANNER}> </Text>
          <Text color={BANNER}>▌</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {maps.length > 1 ? (
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {maps.map(x => (
              <Button key={`map:${x.key}`} label={fit(x.title, 18).trim()} variant={x.key === m.key ? 'primary' : 'secondary'} onPress={() => update($, activeA, () => x.key)} />
            ))}
          </Box>
        ) : null}
        {banner()}
        {wrapLines(plainText(m.destination || m.title), W - 2, 2).map((l, i) => (
          <Text key={`dest:${i}`} color={TEXT} bold={i === 0 || undefined}>{`${i ? ' ' : '◎'} ${l}`}</Text>
        ))}
        {m.error ? <Text color={YELLOW} wrap="wrap">{`! ${m.error}`}</Text> : null}
        <Text dimColor>{sep}</Text>
        {open.length === 0 ? <Text color={GREEN}>Every ticket is resolved. The way is clear.</Text> : null}
        {body as never}
        {contextSection()}
        {m.fog.length ? <Text dimColor>{`≋ fog: ${fit(m.fog[0] ?? '', W - 8).trimEnd()}${m.fog.length > 1 ? ` +${m.fog.length - 1}` : ''}`}</Text> : null}
        <Text dimColor>{sep}</Text>
        {showDone
          ? done.map(t => <Text key={`done:${t.id}`} dimColor>{`  ✓ ${t.id.padStart(idW)} ${fit(t.title, W - idW - 5).trimEnd()}`}</Text>)
          : <Text dimColor>{`✓ ${done.length} resolved`}</Text>}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="k-down" plain hotkey="j" label="down" onPress={() => move($, 1)} />
          <Button key="k-up" plain hotkey="k" label="up" onPress={() => move($, -1)} />
          <Button key="k-open" plain hotkey="o" label="open" onPress={() => (sel ? openTicket($, sel) : undefined)} />
          <Button key="k-start" plain hotkey="s" label={picked.length ? `start ${picked.length}` : 'start'} onPress={() => startPressed($, sel)} />
          <Button key="k-pick" plain hotkey="x" label="pick" onPress={() => update($, pickedA, p => (!sel ? p : p.includes(sel) ? p.filter(x => x !== sel) : [...p, sel]))} />
          <Button key="k-done" plain hotkey="r" label={showDone ? 'hide done' : 'show done'} onPress={() => update($, showDoneA, v => !v)} />
          <Button key="k-refresh" plain hotkey="g" label="refresh" onPress={() => refresh($, { github: true })} />
        </Box>
      </Box>
    )
  })
}
