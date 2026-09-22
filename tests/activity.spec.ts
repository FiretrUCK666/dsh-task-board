/**
 * Board activity feed (client/board/activity.ts): derived moments, newest
 * first, capped; running/queued rounds ARE moments (their start lights the
 * feed); empty comments stay (the row shows a placeholder). The drawer
 * hierarchy is day → task fold → session section → row — waiting state is
 * the notification drawer's job, never the feed's.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ACTIVITY_LIMIT, FOLD_ITEM_LIMIT, activityFoldKeyOf, activityOf, clusterOf, foldFeedByTaskDay, foldRestKeyOf, freezeFeed, sectionFoldBySession, splitFoldItems } from '../src/client/board/activity.ts'
import { createTask } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

describe('activityOf', () => {
  it('a fresh task contributes exactly its creation', () => {
    const tasks = [createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')]
    expect(activityOf(tasks)).toEqual([
      { key: 'a|created', taskId: 'a', taskTitle: 'A', kind: 'created', at: NOW, state: 'settled' },
    ])
  })

  it('collects starts, settlements and queued/running/settled comments — newest first', () => {
    const base = createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')
    const tasks = [{
      ...base,
      executions: [
        { id: 'e-settled', sessionId: 's', startedAt: NOW + 1, endedAt: NOW + 5, result: 'succeeded' as const, error: undefined },
        { id: 'e-comment', sessionId: 's', startedAt: NOW + 2, endedAt: NOW + 6, result: 'succeeded' as const, error: undefined, comment: 'hello' },
        { id: 'e-empty', sessionId: 's', startedAt: NOW + 3, endedAt: NOW + 7, result: 'succeeded' as const, error: undefined, comment: '  ' },
        { id: 'e-running', sessionId: 's', startedAt: NOW + 9, endedAt: undefined, result: undefined, error: undefined },
        { id: 'e-queued', sessionId: 's', startedAt: NOW + 10, endedAt: undefined, result: undefined, error: undefined, comment: 'queued' },
      ],
    }]
    const kinds = activityOf(tasks).map(item => item.kind)
    // Queued + running rounds are moments too (their save/start lights the
    // feed); creation oldest.
    expect(kinds).toEqual(['queued', 'started', 'comment', 'comment', 'settled', 'created'])
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
    expect(clusterOf('direct')).toBe('other')
    expect(clusterOf('external')).toBe('other')
  })
})

it('never maps a waiting moment into the feed (state belongs to the drawer)', () => {
  // `activityOf` skips board-events' live `waiting` rows by construction: the
  // feed is a journal of what HAPPENED, the drawer is where "waiting on you"
  // lives. The skip is a one-line gate — pin it so a future refactor cannot
  // quietly merge the two vocabularies.
  const source = readFileSync(fileURLToPath(new URL('../src/client/board/activity.ts', import.meta.url)), 'utf8')
  expect(source).toContain("if (event.kind === 'waiting') continue")
})

describe('task × day folds + session sections (the drawer hierarchy)', () => {
  /** One synthetic row with an optional session (the grammar reads task/session/at). */
  function sessionRow(key: string, taskId: string, sessionId: string | undefined, at: number) {
    const base = { key, taskId, taskTitle: taskId, kind: 'comment' as const, at }
    return sessionId === undefined ? base : { ...base, sessionId }
  }
  const dayOf = (at: number): string => `day${Math.floor(at / 100)}`

  it('activityFoldKeyOf / foldRestKeyOf are THE constructors (state, list id and remainder agree)', () => {
    expect(activityFoldKeyOf('a', 'day3')).toBe('a|day3')
    expect(foldRestKeyOf('a|day3')).toBe('a|day3|rest')
  })

  it('folds same task + same day, preserving feed order; other tasks split', () => {
    const folds = foldFeedByTaskDay([
      sessionRow('a|3', 'a', 's1', 302),
      sessionRow('b|1', 'b', 's2', 301),
      sessionRow('a|2', 'a', 's1', 300),
    ], dayOf)
    expect(folds.map(fold => fold.key)).toEqual(['a|day3', 'b|day3'])
    expect(folds[0]?.items.map(item => item.key)).toEqual(['a|3', 'a|2'])
    expect(folds[0]?.taskTitle).toBe('a')
  })

  it('sections a fold BY SESSION in first-appearance order; session-less moments bucket too', () => {
    const sections = sectionFoldBySession([
      sessionRow('m1', 'a', 's1', 320),
      sessionRow('m2', 'a', 's2', 310),
      sessionRow('m3', 'a', 's1', 305),
      sessionRow('m4', 'a', undefined, 300),
    ])
    expect(sections.map(section => section.sessionId)).toEqual(['s1', 's2', undefined])
    expect(sections[0]?.items.map(item => item.key)).toEqual(['m1', 'm3'])
    expect(sections[2]?.items.map(item => item.key)).toEqual(['m4'])
  })

  it('splitFoldItems caps the newest head and counts the rest (defensive normalize)', () => {
    const items = Array.from({ length: FOLD_ITEM_LIMIT + 3 }, (_, index) =>
      sessionRow(`a|${index}`, 'a', 's1', 100 + index))
    const split = splitFoldItems(items)
    expect(split.shown).toHaveLength(FOLD_ITEM_LIMIT)
    expect(split.shown[0]?.key).toBe('a|0')
    expect(split.rest).toBe(3)
    expect(splitFoldItems(items.slice(0, 2)).rest).toBe(0)
    expect(splitFoldItems(items, -1)).toEqual({ shown: [], rest: FOLD_ITEM_LIMIT + 3 })
    expect(splitFoldItems(items, Number.NaN).shown).toHaveLength(FOLD_ITEM_LIMIT)
    expect(splitFoldItems(items, 2.7).shown).toHaveLength(2)
  })
})

describe('freezeFeed (read-freeze behind the pill)', () => {
  it('shows the oldest base rows and queues the rest', () => {
    expect(freezeFeed([1, 2, 3, 4, 5], 3)).toEqual({ frozen: [3, 4, 5], fresh: 2 })
    expect(freezeFeed([1, 2], 5)).toEqual({ frozen: [1, 2], fresh: 0 })
    expect(freezeFeed([], 0)).toEqual({ frozen: [], fresh: 0 })
  })

  it('a negative base means unfrozen (first frame shows live, zero queued)', () => {
    expect(freezeFeed([1, 2, 3], -1)).toEqual({ frozen: [1, 2, 3], fresh: 0 })
    expect(freezeFeed([], -1)).toEqual({ frozen: [], fresh: 0 })
  })
})
