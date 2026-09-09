/**
 * Board activity feed (client/board/activity.ts): derived moments, newest
 * first, capped; running rounds are not moments yet; empty comments skipped.
 */
import { describe, expect, it } from 'vitest'
import { ACTIVITY_LIMIT, activityOf } from '../src/client/board/activity.ts'
import { createTask } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

describe('activityOf', () => {
  it('a fresh task contributes exactly its creation', () => {
    const tasks = [createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')]
    expect(activityOf(tasks)).toEqual([
      { key: 'a|created', taskId: 'a', taskTitle: 'A', kind: 'created', at: NOW },
    ])
  })

  it('collects settlements, comments and refines — newest first, running skipped', () => {
    const base = createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')
    const tasks = [{
      ...base,
      executions: [
        { id: 'e-settled', sessionId: 's', startedAt: NOW + 1, endedAt: NOW + 5, result: 'succeeded' as const, error: undefined },
        { id: 'e-comment', sessionId: 's', startedAt: NOW + 2, endedAt: NOW + 6, result: undefined, error: undefined, comment: 'hello' },
        { id: 'e-empty', sessionId: 's', startedAt: NOW + 3, endedAt: NOW + 7, result: undefined, error: undefined, comment: '  ' },
        { id: 'e-refine', sessionId: 's', startedAt: NOW + 4, endedAt: NOW + 8, result: undefined, error: undefined, refine: true },
        { id: 'e-running', sessionId: 's', startedAt: NOW + 9, endedAt: undefined, result: undefined, error: undefined },
      ],
    }]
    const kinds = activityOf(tasks).map(item => item.kind)
    // Empty comment skipped, running round not a moment yet; creation oldest.
    expect(kinds).toEqual(['refined', 'comment', 'settled', 'created'])
    const settled = activityOf(tasks).find(item => item.kind === 'settled')!
    expect(settled.result).toBe('succeeded')
    const comment = activityOf(tasks).find(item => item.kind === 'comment')!
    expect(comment.text).toBe('hello')
  })

  it('caps at the limit (a glance, not an archive)', () => {
    const tasks = [createTask({ title: 'A', description: '', prompt: 'p' }, NOW, 'a')]
    expect(ACTIVITY_LIMIT).toBe(30)
    expect(activityOf(tasks)).toHaveLength(1)
  })
})
