import { expect, test } from 'claude-code/testing'

import { localId, newlyReady, parseLocalTicket, parseMapBody, statusOf } from './tracker'
import { effectiveLauncher, handoffFile, handoffRules, launchArgv, openArgv, sessionPrompt, shellCommand } from './launch'
import type { WfMap } from '../types'

const FRONT = `---
title: Implement P3 pending-action confirmation
type: wayfinder:task
status: open
assignee:
blocked_by: [07-p3-confirmation.md, 09-implement-identity-and-sessions.md]
---

## Question

How do we confirm payments?
`

const SKILL_DOC = `# P4: verifiable action receipts

Type: grilling
Status: claimed
Blocked by: 01

## Question
What goes in a receipt?
`

test('reads the frontmatter shape', async () => {
  const t = parseLocalTicket('14-implement-p3-confirmation.md', FRONT, '/x/14.md')
  expect(t.id).toBe('14')
  expect(t.title).toBe('Implement P3 pending-action confirmation')
  expect(t.type).toBe('task')
  expect(t.hitl).toBe(false)
  expect(t.closed).toBe(false)
  expect(t.assignee).toBe('')
  expect(t.blockedBy).toEqual(['07', '09'])
})

test("reads the skill doc's shape", async () => {
  const t = parseLocalTicket('08-p4-receipts.md', SKILL_DOC, '/x/08.md')
  expect(t.title).toBe('P4: verifiable action receipts')
  expect(t.type).toBe('grilling')
  expect(t.hitl).toBe(true)
  expect(t.assignee).toBe('claimed')
  expect(t.blockedBy).toEqual(['01'])
})

test('a task is HITL only when marked', async () => {
  const t = parseLocalTicket('21-submit.md', FRONT.replace('assignee:', 'assignee:\nhitl: true'), '/x')
  expect(t.hitl).toBe(true)
  expect(localId('#57')).toBe('#57')
})

test('status and newly unblocked tickets', async () => {
  const a = parseLocalTicket('07-p3.md', SKILL_DOC.replace('Status: claimed', 'Status: open').replace('Blocked by: 01', ''), '/7')
  const b = parseLocalTicket('14-x.md', FRONT.replace('09-implement-identity-and-sessions.md', ''), '/14')
  const none = new Set<string>()
  expect(statusOf(b, [a, b], none)).toBe('blocked')
  const closedA = { ...a, closed: true }
  expect(statusOf(b, [closedA, b], none)).toBe('ready')
  expect(newlyReady([a, b], [closedA, b])).toEqual(['14'])
})

test('map header', async () => {
  const h = parseMapBody('# Map: I4 Agent Security\n\n## Destination\n\nI4 submitted.\n\n## Decisions so far\n\n- [a](x): y\n\n## Not yet specified\n\n- write-ups\n', 'x')
  expect(h.title).toBe('I4 Agent Security')
  expect(h.destination).toBe('I4 submitted.')
  expect(h.decisions).toBe(1)
  expect(h.fog).toEqual(['write-ups'])
})

test('launch command and handoff path', async () => {
  const m: WfMap = { key: '/r/.scratch/w/map.md', tracker: 'local', relPath: '.scratch/w/map.md', title: 'I4 Agent Security', destination: '', fog: [], decisions: 0, tickets: [] }
  const t = parseLocalTicket('07-p3.md', SKILL_DOC, '/7')
  const p = handoffFile('/tmp/', m, ['07', '08'], Date.UTC(2026, 10, 4, 12, 0, 0))
  expect(p.startsWith('/tmp/wayfinder-handoffs/i4-agent-security-07-08-')).toBe(true)
  expect(sessionPrompt(m, t, undefined)).toBe('/wayfinder .scratch/w/map.md 07')
  expect(sessionPrompt(m, t, p)).toContain(`read the "## 07" section of ${p}`)
  expect(shellCommand("/a b/it's", 'x')).toBe(`cd '/a b/it'\\''s' && claude 'x'`)
  expect(launchArgv('copy', 'x')).toBe(undefined)
  expect(launchArgv('iterm', 'say "hi"')?.join(' ')).toContain('write text "say \\"hi\\""')
  expect(handoffRules('---\nname: handoff\n---\nWrite it.\nSave to the temporary directory of the OS.\nRedact keys.')).toBe('Write it.\nRedact keys.')
})

test('platform fallbacks', async () => {
  expect(effectiveLauncher('iterm', 'Darwin')).toBe('iterm')
  expect(effectiveLauncher('terminal', 'Linux')).toBe('copy')
  expect(effectiveLauncher('copy', 'Darwin')).toBe('copy')
  expect(openArgv('/r/t.md', '', 'Darwin')).toEqual(['open', '/r/t.md'])
  expect(openArgv('/r/t.md', '', 'Linux')).toEqual(['xdg-open', '/r/t.md'])
  expect(openArgv('/r/t.md', 'code -r', 'Linux')).toEqual(['code', '-r', '/r/t.md'])
  expect(openArgv('https://github.com/o/r/issues/1', 'code', 'Linux')).toEqual(['xdg-open', 'https://github.com/o/r/issues/1'])
})
