import { expect, test } from 'claude-code/testing'

import { effectiveLauncher, githubSets, herdrError, launchArgv, localSet, repoOfRemote, shellCommand, statusOf, visibleOrder, type GqlIssue } from './tickets'

const labels = (...names: string[]) => ({ nodes: names.map(name => ({ name })) })
const spec = { number: 53, title: 'Game spec', url: 'u53', labels: labels('ready-for-agent'), subIssuesSummary: { total: 4, completed: 1 } }
const issue = (number: number, over: Partial<GqlIssue> = {}): GqlIssue => ({
  number,
  title: `Ticket ${number}`,
  url: `u${number}`,
  labels: labels('ready-for-agent'),
  assignees: { nodes: [] },
  parent: spec,
  subIssuesSummary: { total: 0 },
  blockedBy: { nodes: [] },
  blocking: { nodes: [] },
  ...over,
})

test('sub-issues group under their parent, by status', async () => {
  const sets = githubSets('o/r', [
    issue(53, { parent: null, subIssuesSummary: { total: 4 } }),
    issue(58, { blockedBy: { nodes: [{ number: 57, state: 'OPEN' }] } }),
    issue(57, { blockedBy: { nodes: [{ number: 56, state: 'CLOSED' }] }, blocking: { nodes: [{ number: 58, state: 'OPEN' }] } }),
    issue(73, { labels: labels('ready-for-human') }),
    issue(60, { assignees: { nodes: [{ login: 'jo' }] } }),
  ])

  expect(sets.length).toBe(1)
  const set = sets[0]!
  expect(set.title).toBe('Game spec')
  expect(set.done).toBe(1)
  expect(set.tickets.map(t => `${t.id} ${statusOf(t)}`)).toEqual(['#57 ready', '#58 blocked', '#60 claimed', '#73 human'])
  expect(set.tickets[0]!.unblocks).toEqual(['#58'])
  expect(visibleOrder(set)).toEqual(['#57', '#73', '#60', '#58'])
  // A ticket an agent runs on is claimed, though nobody is assigned.
  expect(statusOf(set.tickets[0]!, true)).toBe('claimed')
  expect(visibleOrder(set, new Set(['#57']))).toEqual(['#73', '#57', '#60', '#58'])
})

test('wayfinder tickets and unlabelled loose issues are left out', async () => {
  const map = { ...spec, number: 1, labels: labels('wayfinder:map') }
  const sets = githubSets('o/r', [
    issue(2, { parent: map, labels: labels('wayfinder:task') }),
    issue(3, { parent: null, labels: labels('bug') }),
    issue(4, { parent: null }),
  ])

  expect(sets.map(s => s.key)).toEqual(['github:o/r'])
  expect(sets[0]!.tickets.map(t => t.id)).toEqual(['#4'])
})

test('local ticket files follow the /to-tickets template', async () => {
  const file = (name: string, text: string) => ({ name, text, path: `/p/${name}`, relPath: `.scratch/f/issues/${name}` })
  const set = localSet('/p', 'dark-mode', [
    file('01-toggle.md', '# 01: Toggle\n\n**Blocked by:** None (can start immediately)\n\n**Status:** done\n'),
    file('02-persist.md', '# 02: Persist the choice\n\n**Blocked by:** 01\n\n**Status:** ready-for-agent\n'),
    file('03-sync.md', '# 03: Sync\n\n**Blocked by:** 01, 02\n\n**Status:** ready-for-human\n'),
  ])

  expect(set.done).toBe(1)
  expect(set.tickets.map(t => `${t.id} ${t.title}: ${statusOf(t)}`)).toEqual(['02 Persist the choice: ready', '03 Sync: blocked'])
  expect(set.tickets[1]!.blockedBy).toEqual(['02'])
  expect(set.tickets[0]!.unblocks).toEqual(['03'])
})

test('a new tab starts in the given folder, quoted', async () => {
  const cmd = shellCommand("/Users/jo/it's here", '/implement #57')

  expect(cmd).toBe(`cd '/Users/jo/it'\\''s here' && claude '/implement #57'`)
  expect(launchArgv('iterm', "/Users/jo/it's here", '/implement #57')!.join('\n')).toContain(`tell made to write text "cd '/Users/jo/it'\\\\''s here' && claude '/implement #57'"`)
  expect(effectiveLauncher('iterm', 'Linux')).toBe('copy')
  expect(launchArgv('copy', "/Users/jo/it's here", '/implement #57')).toBeUndefined()
})

test('a new herdr pane gets the folder and the command as they are', async () => {
  const argv = launchArgv('herdr', "/Users/jo/it's here", '/implement #57')!

  expect(argv.slice(0, 7)).toEqual(['herdr-app', 'do', 'terminal.open', '--place', 'right', '--folder', "/Users/jo/it's here"])
  expect(argv.slice(7)).toEqual(['--argv', '["claude","/implement #57"]'])
})

test('herdr launches on any system, and by itself inside herdr', async () => {
  expect(effectiveLauncher('herdr', 'Linux')).toBe('herdr')
  expect(effectiveLauncher('herdr', 'Darwin')).toBe('herdr')
  expect(effectiveLauncher('iterm', 'Linux', true)).toBe('herdr')
  expect(effectiveLauncher('iterm', 'Darwin', true)).toBe('herdr')
  expect(effectiveLauncher('iterm', 'Darwin')).toBe('iterm')
  expect(effectiveLauncher('terminal', 'Darwin', true)).toBe('terminal')
  expect(effectiveLauncher('terminal', 'Linux', true)).toBe('copy')
  expect(effectiveLauncher('copy', 'Darwin', true)).toBe('copy')
})

test('a failed herdr launch says why', async () => {
  expect(herdrError('{\n  "error": "cannot start a terminal: no such folder"\n}\n', '')).toBe('cannot start a terminal: no such folder')
  expect(herdrError('', 'herdr-app: no Herdr window at /h/herdr-app.sock\n')).toBe('herdr-app: no Herdr window at /h/herdr-app.sock')
})

test('the repository is read from the origin remote', async () => {
  expect(repoOfRemote('git@github.com:jo/some-repo.git\n')).toBe('jo/some-repo')
  expect(repoOfRemote('https://github.com/jo/dotted.name')).toBe('jo/dotted.name')
  expect(repoOfRemote('git@gitlab.com:jo/x.git')).toBeUndefined()
})
