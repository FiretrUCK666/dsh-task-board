/**
 * Notification center aggregation (client/board/notifications.ts): one row
 * per waiting session, deduped, newest task first; busy-but-not-waiting is
 * never a notification.
 */
import { describe, expect, it } from 'vitest'
import { foldNotesByTask, notificationsExOf, notificationsOf } from '../src/client/board/notifications.ts'
import { createTask, settleExecution, startExecution } from '../src/core/tasks.ts'

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

  it('review tier: unviewed review tasks notify after waiting (failed first)', () => {
    const base = createTask({ title: 'R', description: '', prompt: 'p' }, NOW, 'r')
    const running = startExecution(base, NOW + 1, 'e1')
    const reviewed = settleExecution({ ...running.task, executions: running.task.executions.map(round => ({ ...round, sessionId: 's-1' })) }, 'e1', 'failed', NOW + 2, 'boom')
    const rows = notificationsExOf([reviewed], () => undefined, id => id, () => true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ taskId: 'r', kind: 'review', result: 'failed' })
    // Viewed review tasks stay quiet.
    expect(notificationsExOf([reviewed], () => undefined, id => id, () => false)).toEqual([])
  })

  it('a waiting row suppresses the same task review echo', () => {
    const base = createTask({ title: 'R', description: '', prompt: 'p' }, NOW, 'r')
    const running = startExecution(base, NOW + 1, 'e1')
    const reviewed = settleExecution({ ...running.task, executions: running.task.executions.map(round => ({ ...round, sessionId: 's-1' })) }, 'e1', 'succeeded', NOW + 2, undefined)
    const rows = notificationsExOf([reviewed], id => (id === 's-1' ? 'question' : undefined), id => id, () => true)
    expect(rows.map(row => row.kind)).toEqual(['waiting'])
  })

  it('a bound-but-never-run waiting session notifies (same related set as live)', () => {
    const base = createTask({ title: 'B', description: '', prompt: 'p' }, NOW, 'b')
    const task = { ...base, binds: [{ kind: 'session' as const, sessionId: 's-bound' }] }
    const rows = notificationsExOf([task], id => (id === 's-bound' ? 'approval' : undefined), id => `title-${id}`, () => false)
    expect(rows.map(row => row.sessionId)).toEqual(['s-bound'])
    expect(rows[0]).toMatchObject({ kind: 'waiting', waitingKind: 'approval' })
  })
})

describe('foldNotesByTask (one head per task, collapsed counts one)', () => {
  it('folds same-task rows under the first (waiting-first order kept)', () => {
    const tasks = [task('a', NOW, {
      executions: [
        { id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
        { id: 'e2', sessionId: 's-2', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
      ],
    })]
    const rows = notificationsOf(tasks, () => 'question' as const, id => id)
    expect(rows).toHaveLength(2)
    const folded = foldNotesByTask(rows)
    expect(folded).toHaveLength(1)
    expect(folded[0].head.sessionId).toBe('s-1')
    expect(folded[0].count).toBe(2)
  })

  it('keeps different tasks apart and preserves order', () => {
    const tasks = [
      task('old', NOW, {
        executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
      }),
      task('new', NOW + 10, {
        executions: [{ id: 'e2', sessionId: 's-2', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
      }),
    ]
    const folded = foldNotesByTask(notificationsOf(tasks, () => 'approval' as const, id => id))
    expect(folded.map(entry => entry.head.taskId)).toEqual(['new', 'old'])
    expect(folded.map(entry => entry.count)).toEqual([1, 1])
  })

  it('folds nothing on an empty list', () => {
    expect(foldNotesByTask([])).toEqual([])
  })
})
