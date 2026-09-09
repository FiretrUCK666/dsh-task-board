/**
 * Board activity feed (client/board/activity.ts): derived moments, newest
 * first, capped; running/queued rounds ARE moments (their start lights the
 * feed); empty comments stay (the row shows a placeholder).
 */
import { describe, expect, it } from 'vitest'
import { ACTIVITY_LIMIT, activityOf, clusterOf, groupActivityByObjectDay } from '../src/client/board/activity.ts'
import { createTask } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

/** One synthetic row (the grouping grammar only reads key/taskId/day/kind). */
function row(key: string, taskId: string, kind: 'created' | 'comment' | 'settled' | 'started' | 'queued' | 'running' | 'direct' | 'external' | 'refined', at: number) {
  return { key, taskId, taskTitle: taskId, kind, at }
}

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

describe('clusterOf (fold clusters mirror the filter map)', () => {
  it('covers every row kind in exactly the filter thirds', () => {
    expect(clusterOf('started')).toBe('run')
    expect(clusterOf('settled')).toBe('run')
    expect(clusterOf('comment')).toBe('comment')
    expect(clusterOf('queued')).toBe('comment')
    expect(clusterOf('running')).toBe('comment')
    expect(clusterOf('created')).toBe('other')
    expect(clusterOf('refined')).toBe('other')
    expect(clusterOf('direct')).toBe('other')
    expect(clusterOf('external')).toBe('other')
  })
})

describe('groupActivityByObjectDay (object-day folding)', () => {
  const dayOf = (at: number): string => `day${Math.floor(at / 100)}`

  it('folds same task + same day + same cluster, and keys stably', () => {
    const groups = groupActivityByObjectDay([
      row('a|3', 'a', 'comment', 302),
      row('a|2', 'a', 'comment', 301),
      row('a|1', 'a', 'settled', 300),
    ], dayOf)
    // Two comment rows share a group; the settled row stands alone.
    expect(groups.map(group => group.key)).toEqual(['a|day3|comment', 'a|day3|run'])
    expect(groups[0].items.map(item => item.key)).toEqual(['a|3', 'a|2'])
    expect(groups[1].items.map(item => item.key)).toEqual(['a|1'])
  })

  it('splits across tasks, days, and clusters (never one mega-group)', () => {
    const groups = groupActivityByObjectDay([
      row('a|1', 'a', 'comment', 100),
      row('b|1', 'b', 'comment', 100),
      row('a|2', 'a', 'comment', 200),
    ], dayOf)
    expect(groups.map(group => group.key)).toEqual(['a|day1|comment', 'b|day1|comment', 'a|day2|comment'])
  })

  it('preserves feed order inside and across groups (grouping never re-sorts)', () => {
    const groups = groupActivityByObjectDay([
      row('b|1', 'b', 'created', 350),
      row('a|2', 'a', 'comment', 320),
      row('a|1', 'a', 'comment', 310),
    ], dayOf)
    expect(groups.map(group => group.taskId)).toEqual(['b', 'a'])
    expect(groups[1].items.map(item => item.at)).toEqual([320, 310])
  })

  it('folds nothing on empty or single-row feeds', () => {
    expect(groupActivityByObjectDay([], dayOf)).toEqual([])
    const single = groupActivityByObjectDay([row('a|1', 'a', 'created', 100)], dayOf)
    expect(single).toHaveLength(1)
    expect(single[0].items).toHaveLength(1)
  })
})
