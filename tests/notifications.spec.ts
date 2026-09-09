/**
 * Notification center aggregation (client/board/notifications.ts): one row
 * per waiting session, deduped, newest task first; busy-but-not-waiting is
 * never a notification.
 */
import { describe, expect, it } from 'vitest'
import { notificationsOf } from '../src/client/board/notifications.ts'
import { createTask } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

function task(id: string, updatedAt: number, extra: Record<string, unknown> = {}) {
  return {
    ...createTask({ title: `task-${id}`, description: '', prompt: 'p' }, updatedAt, id),
    ...extra,
  }
}

describe('notificationsOf', () => {
  it('empty board, or nothing waiting, is no rows', () => {
    expect(notificationsOf([], () => undefined, id => id)).toEqual([])
    const tasks = [task('a', NOW)]
    expect(notificationsOf(tasks, () => undefined, id => id)).toEqual([])
  })

  it('one row per waiting session (execution + refine deduplicated)', () => {
    const tasks = [task('a', NOW, {
      refineSessionId: 's-1',
      executions: [
        { id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
        { id: 'e2', sessionId: 's-2', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
      ],
    })]
    const pending = (id: string | undefined): 'question' | undefined =>
      id === 's-1' || id === 's-2' ? 'question' : undefined
    const rows = notificationsOf(tasks, pending, id => `title-${id}`)
    // s-1 named twice (round + refine) waits once.
    expect(rows.map(row => row.sessionId)).toEqual(['s-1', 's-2'])
    expect(rows[0]).toMatchObject({
      taskId: 'a', taskTitle: 'task-a', sessionTitle: 'title-s-1', waitingKind: 'question',
    })
  })

  it('a busy session with no waiting signal is never a notification', () => {
    const tasks = [task('a', NOW, {
      executions: [
        { id: 'e1', sessionId: 's-9', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
      ],
    })]
    expect(notificationsOf(tasks, () => undefined, id => id)).toEqual([])
  })

  it('newest task first', () => {
    const tasks = [
      task('old', NOW, {
        executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
      }),
      task('new', NOW + 10, {
        executions: [{ id: 'e2', sessionId: 's-2', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
      }),
    ]
    const rows = notificationsOf(tasks, () => 'approval' as const, id => id)
    expect(rows.map(row => row.taskId)).toEqual(['new', 'old'])
  })
})
