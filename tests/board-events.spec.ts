/**
 * Board events (src/core/board-events.ts): one derived moment model for
 * notifications/activity/cards — kinds, states, ordering, day grouping.
 */
import { describe, expect, it } from 'vitest'
import { boardEventsOf, dayBucketOf, groupEventsByDay } from '../src/core/board-events.ts'
import { createTask, newCommentRound, newDirectRound, newExternalRound, startExecution } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

describe('boardEventsOf', () => {
  it('a fresh task contributes exactly its creation', () => {
    const events = boardEventsOf([createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ taskId: 'a', kind: 'created', state: 'settled', at: NOW })
  })

  it('plain runs map to running/settled, newest first', () => {
    const base = createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')
    const started = startExecution(base, NOW + 1, 'e1')
    const events = boardEventsOf([started.task])
    expect(events.map(event => event.kind)).toEqual(['run', 'created'])
    expect(events[0]).toMatchObject({ state: 'running' })
    expect(events[0]?.sessionId).toBeUndefined()
  })

  it('comment lifecycle maps to queued/running/settled', () => {
    const base = createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')
    const queued = newCommentRound({ id: 'c1', now: NOW + 1, text: 'hi', sessionId: 's-1', parentExecutionId: 'e-1' })
    const injected = { ...queued, id: 'c2', injectedAt: NOW + 2 }
    const settled = { ...queued, id: 'c3', injectedAt: NOW + 2, endedAt: NOW + 3, result: 'succeeded' as const }
    const events = boardEventsOf([{ ...base, executions: [queued, injected, settled] }])
    expect(events.map(event => `${event.kind}:${event.state}`)).toEqual([
      'comment:settled',
      'comment:running',
      'comment:queued',
      'created:settled',
    ])
  })

  it('external/direct keep their kinds (never misread as plain runs)', () => {
    const base = createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')
    const task = {
      ...base,
      executions: [
        newExternalRound({ id: 'ext', now: NOW + 1, sessionId: 's-1', text: 'hi' }),
        newDirectRound({ id: 'dir', now: NOW + 2, text: 'steer', sessionId: 's-1' }),
      ],
    }
    expect(boardEventsOf([task]).map(event => event.kind)).toEqual(['direct', 'external', 'created'])
  })

  it('waiting moments derive live (one per session, deduped)', () => {
    const base = createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')
    const task = { ...base, executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }] }
    const events = boardEventsOf([task], { pendingOf: id => (id === 's-1' ? 'question' : undefined) })
    expect(events.filter(event => event.kind === 'waiting')).toHaveLength(1)
    expect(boardEventsOf([task], { pendingOf: () => undefined }).some(event => event.kind === 'waiting')).toBe(false)
  })

  it('waiting moments ride the round clock, never task.updatedAt', () => {
    const base = createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')
    const bumped = { ...base, updatedAt: NOW + 1_000_000 }
    const task = { ...bumped, executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW + 5, endedAt: undefined, result: undefined, error: undefined }] }
    const waiting = boardEventsOf([task], { pendingOf: id => (id === 's-1' ? 'question' : undefined) })
      .find(event => event.kind === 'waiting')!
    expect(waiting.at).toBe(NOW + 5)
  })

  it('a bound-but-never-run waiting session still emits a waiting moment', () => {
    const base = createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')
    const task = { ...base, binds: [{ kind: 'session' as const, sessionId: 's-bound' }] }
    const events = boardEventsOf([task], { pendingOf: id => (id === 's-bound' ? 'approval' : undefined) })
    expect(events.filter(event => event.kind === 'waiting').map(event => event.sessionId)).toEqual(['s-bound'])
  })
})

describe('day grouping', () => {
  it('buckets by local calendar day, newest day first', () => {
    expect(typeof dayBucketOf(NOW)).toBe('string')
    const grouped = groupEventsByDay(boardEventsOf([
      createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a'),
      createTask({ title: 'B', description: '', prompt: 'p' }, NOW + 86_400_000, 'b'),
    ]))
    expect(grouped).toHaveLength(2)
    expect(grouped[0].items[0].taskId).toBe('b')
  })
})
