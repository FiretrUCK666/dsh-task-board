/**
 * Session-state bridge (host, session-state-route.ts): the narrow read-only
 * plan/goal/subagent view and its HTTP envelope — native shapes only
 * (GoalView objective/phase, SubagentListEntry label/activity, async
 * listChildren keyed by the parent session id); missing faces and malformed
 * leaves degrade to absent blocks (no command catalog here, by design).
 */
import { describe, expect, it } from 'vitest'
import { createSessionStateHandler, queryParamOf, readSessionState } from '../src/host/session-state-route.ts'

const planMode = { get: (agent: unknown) => (agent === 'agent' ? { active: true, pending: true } : null) }
// Native GoalView shape: objective + phase (active/paused/blocked/complete).
const goals = {
  get: (agent: unknown) => agent === 'agent'
    ? { objective: '发布 v2', phase: 'active' }
    : undefined,
}
// Native SubagentListEntry shape: kind/label/activity (async, session-id keyed).
const subagents = {
  listChildren: (parent: string) => parent === 's1' ? Promise.resolve([
    { kind: 'child', id: 'c1', activity: 'running', hasChildren: false, mode: 'continuable', label: '子任务 A' },
    { kind: 'child', id: 'c2', activity: 'inactive', hasChildren: true, mode: 'one-shot', label: '已结束 B' },
    { kind: 'diagnostic', id: 'c3', reason: 'corrupt' },
    { kind: 'child', id: 'c4', activity: 'running', hasChildren: false, mode: 'one-shot' },
  ]) : Promise.resolve([]),
}

describe('readSessionState (structural read of native plan/goal/subagents)', () => {
  it('reads plan + goal from the native faces (GoalView objective/phase)', async () => {
    const view = await readSessionState({ sessions: { get: id => id === 's1' ? 'agent' : undefined }, planMode, goals }, 's1')
    expect(view.plan).toEqual({ active: true, pending: true })
    expect(view.goal).toEqual({ title: '发布 v2', active: true })
  })

  it('a COMPLETED goal (phase complete) is surfaced nowhere', async () => {
    const done = { get: () => ({ objective: '收尾', phase: 'complete' }) }
    const view = await readSessionState({ sessions: { get: () => 'agent' }, goals: done }, 's1')
    expect(view.goal).toBeUndefined()
  })

  it('reads LIVE subagents: kind child + label + activity running (async, by session id)', async () => {
    const view = await readSessionState({ sessions: { get: () => 'agent' }, subagents }, 's1')
    expect(view.subagents).toEqual([{ title: '子任务 A', status: 'running' }])
  })

  it('unknown session → no blocks; a throwing service degrades that block only', async () => {
    expect(await readSessionState({ sessions: { get: () => undefined }, planMode, goals }, 'ghost')).toEqual({})
    const view = await readSessionState(
      { sessions: { get: () => 'agent' }, planMode: { get: () => { throw new Error('boom') } }, goals },
      's1',
    )
    expect(view.plan).toBeUndefined()
    expect(view.goal).toBeDefined()
  })
})

describe('queryParamOf', () => {
  it('extracts a param from a raw URL, handling encoding and missing values', () => {
    expect(queryParamOf('/api/x?sessionId=abc%20123', 'sessionId')).toBe('abc 123')
    expect(queryParamOf('/api/x', 'sessionId')).toBeUndefined()
    expect(queryParamOf(undefined, 'sessionId')).toBeUndefined()
  })
})

describe('createSessionStateHandler', () => {
  it('400 without a session id, else 200 with the ok envelope', async () => {
    const handler = createSessionStateHandler({ sessions: { get: () => 'agent' }, planMode, goals })
    const res400: { status: number; body: string | undefined } = { status: 0, body: undefined }
    await handler({ url: '/api/dsh-task-board/session-state' } as never, { writeHead: (status: number) => { res400.status = status }, end: (body?: string) => { res400.body = body } } as never)
    expect(res400.status).toBe(400)
    const res: { status: number; body: string | undefined } = { status: 0, body: undefined }
    await handler({ url: '/api/dsh-task-board/session-state?sessionId=s1' } as never, { writeHead: (status: number) => { res.status = status }, end: (body?: string) => { res.body = body } } as never)
    expect(res.status).toBe(200)
    const parsed = JSON.parse(res.body as string) as Record<string, unknown>
    expect(parsed.plan).toEqual({ active: true, pending: true })
  })
})
