/**
 * Session-state bridge (host, session-state-route.ts): the narrow read-only
 * plan/goal/subagent view and its HTTP envelope — native shapes only
 * (GoalView objective/phase, **SubagentCatalogEntry `{ id, createdAt, mode,
 * label? }`** and async `listChildren` keyed by the parent session id); missing
 * faces and malformed leaves degrade to absent blocks (no command catalog here,
 * by design).
 *
 * THE SUBAGENT FIXTURE IS THE POINT OF THIS FILE. It used to be
 * `{ kind: 'child', label, activity }` — a shape the installed host never
 * returns — so this spec was green while the bridge dropped every child and the
 * comment panel showed nothing. A fake that is WIDER than reality hides the bug
 * it is supposed to catch; the fixture is now copied from
 * `@deepseek-ai/dsh-subagent/projection-types` (`SubagentCatalogEntry`).
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
// Native SubagentCatalogEntry shape (async, session-id keyed): id + createdAt +
// mode, where only the continuable mode guarantees a label.
const subagents = {
  listChildren: (parent: string) => parent === 's1' ? Promise.resolve([
    { id: 'c1', createdAt: 1, mode: 'continuable', label: '子任务 A' },
    { id: 'c2', createdAt: 2, mode: 'one-shot', label: '已结束 B' },
    { id: 'c3', createdAt: 3, mode: 'unknown' },
    { createdAt: 4, mode: 'external', label: '没有 id 的行' },
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

  it('reads the subagent CATALOG as it is: id + label, no invented status', async () => {
    const view = await readSessionState({ sessions: { get: () => 'agent' }, subagents }, 's1')
    // Every row with an id is listed — including the unknown-mode child the old
    // `kind === 'child' && label` filter would have dropped.
    expect(view.subagents).toEqual([
      { id: 'c1', title: '子任务 A' },
      { id: 'c2', title: '已结束 B' },
      { id: 'c3', title: 'c3' },
    ])
    // …and the row without an id is the one thing dropped: nothing could look it
    // up, so showing it would be a line that cannot be checked.
    expect(view.subagents?.some(row => row.title === '没有 id 的行')).toBe(false)
    // Liveness is NOT this layer's claim (the catalog carries none); the client
    // asks its own activity derivation by id.
    expect(view.subagents?.every(row => !('status' in row))).toBe(true)
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
  it('400 without a session id, else 200 with the shared envelope', async () => {
    const handler = createSessionStateHandler({ sessions: { get: () => 'agent' }, planMode, goals })
    const res400: { status: number; body: string | undefined } = { status: 0, body: undefined }
    await handler({ url: '/api/dsh-task-board/session-state' } as never, { writeHead: (status: number) => { res400.status = status }, end: (body?: string) => { res400.body = body } } as never)
    expect(res400.status).toBe(400)
    const res: { status: number; body: string | undefined } = { status: 0, body: undefined }
    await handler({ url: '/api/dsh-task-board/session-state?sessionId=s1' } as never, { writeHead: (status: number) => { res.status = status }, end: (body?: string) => { res.body = body } } as never)
    expect(res.status).toBe(200)
    const parsed = JSON.parse(res.body as string) as { ok: boolean; value: Record<string, unknown> }
    // The SHARED envelope: every route answers `{ok, value}` — the view is in
    // `value`, not spread over the top level.
    expect(parsed.ok).toBe(true)
    expect(parsed.value.plan).toEqual({ active: true, pending: true })
  })
})
