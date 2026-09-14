/**
 * Notification center aggregation (client/board/notifications.ts): one row
 * per waiting session, deduped, newest task first; busy-but-not-waiting is
 * never a notification.
 */
import { describe, expect, it } from 'vitest'
import { boardDemandOf, foldNotesByTask, noteKeyOf, notificationsExOf, notificationsOf } from '../src/client/board/notifications.ts'
import { taskUnviewed } from '../src/core/session-display.ts'
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

describe('noteKeyOf (THE row identity)', () => {
  it('builds task|session|kind for snooze keys, drawer keys and unseen sets', () => {
    expect(noteKeyOf({ taskId: 'a', sessionId: 's', kind: 'waiting' })).toBe('a|s|waiting')
  })
})

describe('waiting moment clock (round activity, never task.updatedAt)', () => {
  it('a metadata bump after the wait started does not reorder or re-age the bell', () => {
    const tasks = [task('a', NOW + 100, {
      executions: [
        { id: 'e1', sessionId: 's-1', startedAt: NOW + 5, endedAt: undefined, result: undefined, error: undefined },
      ],
    })]
    const rows = notificationsOf(tasks, id => (id === 's-1' ? 'question' : undefined), id => id)
    expect(rows).toHaveLength(1)
    expect(rows[0].at).toBe(NOW + 5)
  })

  it('orders by round activity even when the task clock disagrees', () => {
    const tasks = [
      task('old-task', NOW + 1_000, {
        executions: [
          { id: 'e1', sessionId: 's-1', startedAt: NOW + 500, endedAt: undefined, result: undefined, error: undefined },
        ],
      }),
      task('new-task', NOW, {
        executions: [
          { id: 'e2', sessionId: 's-2', startedAt: NOW + 10, endedAt: undefined, result: undefined, error: undefined },
        ],
      }),
    ]
    const pending = (id: string | undefined): 'question' | undefined =>
      id === 's-1' || id === 's-2' ? 'question' : undefined
    const rows = notificationsOf(tasks, pending, id => id)
    expect(rows.map(row => row.sessionId)).toEqual(['s-1', 's-2'])
  })

  it('breaks same-instant ties by row key, never by task metadata', () => {
    const tasks = [
      task('b-task', NOW + 1_000, {
        executions: [
          { id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
        ],
      }),
      task('a-task', NOW, {
        executions: [
          { id: 'e2', sessionId: 's-2', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
        ],
      }),
    ]
    const pending = (id: string | undefined): 'question' | undefined =>
      id === 's-1' || id === 's-2' ? 'question' : undefined
    // Same instant: metadata-newest (b-task) must NOT win — key order decides.
    const rows = notificationsOf(tasks, pending, id => id)
    expect(rows.map(row => row.taskId)).toEqual(['a-task', 'b-task'])
  })

  it('prefers endedAt over startedAt for settled waits', () => {
    const tasks = [task('a', NOW, {
      executions: [
        { id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: NOW + 900, result: undefined, error: undefined },
        { id: 'e2', sessionId: 's-2', startedAt: NOW + 800, endedAt: undefined, result: undefined, error: undefined },
      ],
    })]
    const pending = (id: string | undefined): 'question' | undefined =>
      id === 's-1' || id === 's-2' ? 'question' : undefined
    const rows = notificationsOf(tasks, pending, id => id)
    expect(rows.map(row => row.sessionId)).toEqual(['s-1', 's-2'])
  })
})

/**
 * The board's demand count: the answer to 「等我做什么」, stated for the whole
 * surface. It exists because the bell counts folded ROWS and a column header
 * counts CARDS — two numbers that measure different things and can never
 * reconcile on screen. The load-bearing rule is that the review half is
 * independent of `viewedAt`: reading a finished run retires the unread GLOW
 * (that message stays honest) but never resolves the decision, and treating
 * "seen" as "done" is exactly how a board stops being safe to leave running.
 */
describe('boardDemandOf', () => {
  it('an idle board owes nothing', () => {
    expect(boardDemandOf([], () => undefined)).toEqual({ total: 0, waiting: 0, review: 0 })
    expect(boardDemandOf([task('a', NOW)], () => undefined)).toEqual({ total: 0, waiting: 0, review: 0 })
  })

  it('counts each suspended session once, deduplicated across rounds', () => {
    const tasks = [task('a', NOW, {
      refineSessionId: 's-1',
      executions: [
        { id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
        { id: 'e2', sessionId: 's-2', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
      ],
    })]
    const pending = (id: string | undefined): 'question' | undefined =>
      id === 's-1' || id === 's-2' ? 'question' : undefined
    expect(boardDemandOf(tasks, pending)).toEqual({ total: 2, waiting: 2, review: 0 })
  })

  it('counts a settled review task regardless of whether it was looked at', () => {
    const base = createTask({ title: 'R', description: '', prompt: 'p' }, NOW, 'r')
    const running = startExecution(base, NOW + 1, 'e1')
    const settled = settleExecution(running.task, 'e1', 'succeeded', NOW + 2, undefined)
    // Looked at (viewedAt past the settle): the bell goes quiet, the gate does not.
    const looked = { ...settled, viewedAt: NOW + 3 }
    expect(taskUnviewed(looked)).toBe(false)
    expect(boardDemandOf([looked], () => undefined)).toEqual({ total: 1, waiting: 0, review: 1 })
    // Never looked at: same verdict on the gate, and the glow is a separate signal.
    expect(boardDemandOf([settled], () => undefined)).toEqual({ total: 1, waiting: 0, review: 1 })
    expect(taskUnviewed(settled)).toBe(true)
  })

  it('does not count a task still running, nor one that never ran', () => {
    const base = createTask({ title: 'X', description: '', prompt: 'p' }, NOW, 'x')
    const running = startExecution(base, NOW + 1, 'e1').task
    expect(boardDemandOf([running], () => undefined)).toEqual({ total: 0, waiting: 0, review: 0 })
    expect(boardDemandOf([base], () => undefined)).toEqual({ total: 0, waiting: 0, review: 0 })
  })

  it('counts a bound-but-never-run waiting session, like the bell and the glow', () => {
    const base = createTask({ title: 'B', description: '', prompt: 'p' }, NOW, 'b')
    const bound = { ...base, binds: [{ kind: 'session' as const, sessionId: 's-bound' }] }
    // The session bind alone puts it in the related set, with no round behind it —
    // the same path the bell and the card glow read.
    const pending = (id: string | undefined): 'approval' | undefined => (id === 's-bound' ? 'approval' : undefined)
    expect(boardDemandOf([bound], pending)).toEqual({ total: 1, waiting: 1, review: 0 })
    // And it is the waiting SIGNAL that counts, not the bind: no signal, no demand.
    expect(boardDemandOf([bound], () => undefined)).toEqual({ total: 0, waiting: 0, review: 0 })
  })

  it('sums the two halves into the headline total', () => {
    const base = createTask({ title: 'R', description: '', prompt: 'p' }, NOW, 'r')
    const running = startExecution(base, NOW + 1, 'e1')
    const settled = settleExecution(
      { ...running.task, executions: running.task.executions.map(round => ({ ...round, sessionId: 's-1' })) },
      'e1',
      'failed',
      NOW + 2,
      'boom',
    )
    const waiting = task('w', NOW, {
      executions: [{ id: 'e9', sessionId: 's-9', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
    })
    const pending = (id: string | undefined): 'approval' | undefined => (id === 's-9' ? 'approval' : undefined)
    expect(boardDemandOf([settled, waiting], pending)).toEqual({ total: 2, waiting: 1, review: 1 })
  })
})
