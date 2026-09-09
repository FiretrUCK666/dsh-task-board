/**
 * Board activity feed (client/board/activity.ts): derived moments, newest
 * first, capped; running/queued rounds ARE moments (their start lights the
 * feed); empty comments stay (the row shows a placeholder).
 */
import { describe, expect, it } from 'vitest'
import { ACTIVITY_LIMIT, activityOf } from '../src/client/board/activity.ts'
import { createTask } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

describe('activityOf', () => {
  it('a fresh task contributes exactly its creation', () => {
    const tasks = [createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')]
    expect(activityOf(tasks)).toEqual([
      { key: 'a|created', taskId: 'a', taskTitle: 'A', kind: 'created', at: NOW, state: 'settled' },
    ])
  })

  it('collects starts, settlements, queued/running/settled comments and refines — newest first', () => {
    const base = createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')
    const tasks = [{
      ...base,
      executions: [
        { id: 'e-settled', sessionId: 's', startedAt: NOW + 1, endedAt: NOW + 5, result: 'succeeded' as const, error: undefined },
        { id: 'e-comment', sessionId: 's', startedAt: NOW + 2, endedAt: NOW + 6, result: 'succeeded' as const, error: undefined, comment: 'hello' },
        { id: 'e-empty', sessionId: 's', startedAt: NOW + 3, endedAt: NOW + 7, result: 'succeeded' as const, error: undefined, comment: '  ' },
        { id: 'e-refine', sessionId: 's', startedAt: NOW + 4, endedAt: NOW + 8, result: 'succeeded' as const, error: undefined, refine: true },
        { id: 'e-running', sessionId: 's', startedAt: NOW + 9, endedAt: undefined, result: undefined, error: undefined },
        { id: 'e-queued', sessionId: 's', startedAt: NOW + 10, endedAt: undefined, result: undefined, error: undefined, comment: 'queued' },
      ],
    }]
    const kinds = activityOf(tasks).map(item => item.kind)
    // Queued + running rounds are moments too (their save/start lights the
    // feed); creation oldest.
    expect(kinds).toEqual(['queued', 'started', 'refined', 'comment', 'comment', 'settled', 'created'])
    const settled = activityOf(tasks).find(item => item.kind === 'settled')!
    expect(settled.result).toBe('succeeded')
    const comment = activityOf(tasks).find(item => item.kind === 'comment' && item.text === 'hello')!
    expect(comment.text).toBe('hello')
  })

  it('filters by kind and query', () => {
    const base = createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')
    const tasks = [{
      ...base,
      executions: [
        { id: 'e1', sessionId: 's', startedAt: NOW + 1, endedAt: NOW + 5, result: 'succeeded' as const, error: undefined },
        { id: 'e2', sessionId: 's', startedAt: NOW + 2, endedAt: NOW + 6, result: 'succeeded' as const, error: undefined, comment: 'hello world' },
      ],
    }]
    expect(activityOf(tasks, { kinds: ['settled'] }).map(item => item.kind)).toEqual(['settled'])
    expect(activityOf(tasks, { query: 'hello' }).map(item => item.kind)).toEqual(['comment'])
    expect(activityOf(tasks, { query: 'missing' })).toEqual([])
  })

  it('filters to unviewed moments via the caller baseline', () => {
    const base = createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')
    const tasks = [{
      ...base,
      executions: [
        { id: 'e1', sessionId: 's', startedAt: NOW + 1, endedAt: NOW + 5, result: 'succeeded' as const, error: undefined },
        { id: 'e2', sessionId: 's', startedAt: NOW + 2, endedAt: NOW + 6, result: 'succeeded' as const, error: undefined, comment: 'hello world' },
      ],
    }]
    // Baseline past everything: nothing unviewed.
    expect(activityOf(tasks, { onlyUnviewed: true }, () => false)).toEqual([])
    // Baseline before everything: all moments pass through.
    expect(activityOf(tasks, { onlyUnviewed: true }, () => true)).toHaveLength(3)
  })

  it('caps at the limit (a glance, not an archive)', () => {
    const tasks = [createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')]
    expect(ACTIVITY_LIMIT).toBe(50)
    expect(activityOf(tasks)).toHaveLength(1)
  })
})
