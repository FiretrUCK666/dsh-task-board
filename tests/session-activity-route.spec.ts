/**
 * Session-activity bridge (host, session-activity-route.ts): the pure
 * structural read of a session's native plan / goal / command catalog and the
 * HTTP envelope — missing faces and malformed leaves degrade to absent blocks.
 */
import { describe, expect, it } from 'vitest'
import { createSessionActivityHandler, queryParamOf, readSessionActivity } from '../src/host/session-activity-route.ts'

const planMode = { get: (agent: unknown) => (agent === 'agent' ? { active: true, pending: true } : null) }
const goals = { get: (agent: unknown) => (agent === 'agent' ? { activeGoal: { title: '发布 v2', status: 'active' } } : undefined) }
const commands = {
  list: (agent: unknown) => (agent === 'agent'
    ? [{ name: '/plan', description: '计划模式' }, { name: '/goal', description: '目标' }, { name: 3, description: 'x' }]
    : []),
}

describe('readSessionActivity (structural read of native services)', () => {
  it('reads plan + goal + command catalog from the native faces', () => {
    const view = readSessionActivity({ sessions: { get: id => id === 's1' ? 'agent' : undefined }, planMode, goals, commands }, 's1')
    expect(view.plan).toEqual({ active: true, pending: true })
    expect(view.goal).toEqual({ title: '发布 v2', active: true })
    expect(view.commands).toEqual([{ name: '/plan', description: '计划模式' }, { name: '/goal', description: '目标' }])
  })
  it('unknown session → no blocks; malformed leaves are dropped, not thrown', () => {
    expect(readSessionActivity({ sessions: { get: () => undefined }, planMode, goals, commands }, 'ghost')).toEqual({})
    const noisy = readSessionActivity({ sessions: { get: () => 'agent' }, planMode, goals, commands: { list: () => 'nope' } }, 's1')
    expect(noisy.commands).toBeUndefined()
    expect(noisy.plan).toBeDefined()
  })
  it('a throwing native service degrades that block only', () => {
    const view = readSessionActivity({
      sessions: { get: () => 'agent' },
      planMode: { get: () => { throw new Error('boom') } },
      goals,
    }, 's1')
    expect(view.plan).toBeUndefined()
    expect(view.goal).toBeDefined()
  })
  it('prefers the agents face over sessions', () => {
    const view = readSessionActivity({ agents: { get: () => undefined }, sessions: { get: () => 'agent' }, planMode, goals }, 's1')
    expect(view.plan).toBeUndefined()
    expect(view.goal).toBeUndefined()
  })
})

describe('queryParamOf', () => {
  it('extracts a param from a raw URL, handling encoding and missing values', () => {
    expect(queryParamOf('/api/x?sessionId=abc%20123', 'sessionId')).toBe('abc 123')
    expect(queryParamOf('/api/x', 'sessionId')).toBeUndefined()
    expect(queryParamOf('/api/x?a=1&sessionId=', 'sessionId')).toBe('')
    expect(queryParamOf(undefined, 'sessionId')).toBeUndefined()
  })
})

describe('createSessionActivityHandler (HTTP envelope)', () => {
  it('400 without a session id, else 200 with the ok envelope', async () => {
    const req400 = { url: '/api/dsh-task-board/session-activity' }
    const res400: { status: number; body: string | undefined } = { status: 0, body: undefined }
    const handler = createSessionActivityHandler({ sessions: { get: () => 'agent' }, planMode, goals, commands })
    await handler(req400 as never, { writeHead: (status: number) => { res400.status = status }, end: (body?: string) => { res400.body = body } } as never)
    expect(res400.status).toBe(400)

    const req = { url: '/api/dsh-task-board/session-activity?sessionId=s1' }
    const res: { status: number; body: string | undefined } = { status: 0, body: undefined }
    await handler(req as never, { writeHead: (status: number) => { res.status = status }, end: (body?: string) => { res.body = body } } as never)
    expect(res.status).toBe(200)
    const parsed = JSON.parse(res.body as string) as Record<string, unknown>
    expect(parsed.ok).toBe(true)
    expect(parsed.goal).toEqual({ title: '发布 v2', active: true })
  })
})
