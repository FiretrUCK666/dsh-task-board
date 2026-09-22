/**
 * Notification center aggregation (client/board/notifications.ts): ONE row
 * per waiting session and per settled review session, deduped; busy but not
 * waiting is never a notification. Rows are THE counting unit (bell badge =
 * unseen dot = drawer rows).
 */
import { describe, expect, it } from 'vitest'
import { arrivalOf, boardDemandOf, noteKeyOf, noteStatusShapeOf, notificationsExOf, stampWaitingArrivals, waitingBodyOf, waitingExcerptOf, WAITING_EXCERPT_BUDGET, type NotificationItem } from '../src/client/board/notifications.ts'
import { taskUnviewed } from '../src/core/session-display.ts'
import { createTask, settleExecution, startExecution } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

function task(id: string, updatedAt: number, extra: Record<string, unknown> = {}) {
  return {
    ...createTask({ title: `task-${id}`, description: '', prompt: 'p' }, updatedAt, id),
    ...extra,
  }
}

/** Waiting-only view (the default review gate closed — rows are waiting tier). */
function waitingRows(
  tasks: Parameters<typeof notificationsExOf>[0],
  pending: Parameters<typeof notificationsExOf>[1],
  titleOf: Parameters<typeof notificationsExOf>[2] = id => id,
) {
  return notificationsExOf(tasks, pending, titleOf, () => false)
}

describe('waiting rows (one per waiting session)', () => {
  it('empty board, or nothing waiting, is no rows', () => {
    expect(waitingRows([], () => undefined)).toEqual([])
    const tasks = [task('a', NOW)]
    expect(waitingRows(tasks, () => undefined)).toEqual([])
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
    const rows = waitingRows(tasks, pending, id => `title-${id}`)
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
    expect(waitingRows(tasks, () => undefined)).toEqual([])
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
    const rows = waitingRows(tasks, () => 'approval' as const)
    expect(rows.map(row => row.taskId)).toEqual(['new', 'old'])
  })
})

describe('review rows (one per settled session of each unviewed review task)', () => {
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

  it('a waiting row suppresses the same-SESSION review echo, never a sibling session', () => {
    const base = createTask({ title: 'R', description: '', prompt: 'p' }, NOW, 'r')
    const running = startExecution(base, NOW + 1, 'e1')
    const reviewed = settleExecution({ ...running.task, executions: running.task.executions.map(round => ({ ...round, sessionId: 's-1' })) }, 'e1', 'succeeded', NOW + 2, undefined)
    // Same session waits too → the louder waiting row stands alone.
    const same = notificationsExOf([reviewed], id => (id === 's-1' ? 'question' : undefined), id => id, () => true)
    expect(same.map(row => row.kind)).toEqual(['waiting'])
    // An UNRELATED session waits → both rows stand: the finished run keeps
    // its 通过/打回, the blocked sibling keeps its 去回答. Suppressing the
    // gate here is what hid the decision behind a question on another lane.
    const sibling = notificationsExOf(
      [{ ...reviewed, refineSessionId: 's-2' }],
      id => (id === 's-2' ? 'question' : undefined),
      id => id,
      () => true,
    )
    expect(sibling.map(row => `${row.kind}:${row.sessionId}`).sort()).toEqual(['review:s-1', 'waiting:s-2'])
  })

  it('EVERY settled session of a review task gets its own row (the drawer states each lane)', () => {
    // The old grammar emitted ONE row per task, naming only the newest run's
    // session — two lanes finishing in different states collapsed into one
    // line and the drawer could not say which conversation did what.
    const two = {
      ...task('r', NOW, { status: 'review' as const }),
      executions: [
        { id: 'e1', sessionId: 's-1', startedAt: NOW + 1, endedAt: NOW + 10, result: 'failed' as const, error: 'boom' },
        { id: 'e2', sessionId: 's-2', startedAt: NOW + 2, endedAt: NOW + 20, result: 'succeeded' as const, error: undefined },
      ],
    }
    const rows = notificationsExOf([two], () => undefined, id => `title-${id}`, () => true)
    expect(rows.map(row => `${row.kind}:${row.sessionId}`)).toEqual(['review:s-1', 'review:s-2'])
    expect(rows[0]).toMatchObject({ result: 'failed', at: NOW + 10, sessionTitle: 'title-s-1' })
    expect(rows[1]).toMatchObject({ result: 'succeeded', at: NOW + 20, sessionTitle: 'title-s-2' })
    // Failed ranks first (it needs a decision), then settle recency — per row.
    const cancelled = {
      ...task('c', NOW + 5, { status: 'review' as const }),
      executions: [
        { id: 'e1', sessionId: 's-3', startedAt: NOW + 1, endedAt: NOW + 3, result: 'cancelled' as const, error: undefined },
      ],
    }
    const mixed = notificationsExOf([two, cancelled], () => undefined, id => id, () => true)
    expect(mixed.map(row => `${row.result}:${row.sessionId}`)).toEqual(['failed:s-1', 'succeeded:s-2', 'cancelled:s-3'])
  })

  it('a legacy review task whose runs carry no session keeps ONE reachable gate row', () => {
    const legacy = {
      ...task('old', NOW + 7, { status: 'review' as const }),
      executions: [
        { id: 'e1', sessionId: undefined, startedAt: NOW + 1, endedAt: NOW + 3, result: 'succeeded' as const, error: undefined },
      ],
    }
    const rows = notificationsExOf([legacy], () => undefined, id => id, () => true)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'review', sessionId: 'old', result: 'succeeded', at: NOW + 3 })
  })
})

describe('bound waiting sessions (no round behind them)', () => {
  it('a bound-but-never-run waiting session notifies (same related set as live)', () => {
    const base = createTask({ title: 'B', description: '', prompt: 'p' }, NOW, 'b')
    const task = { ...base, binds: [{ kind: 'session' as const, sessionId: 's-bound' }] }
    const rows = notificationsExOf([task], id => (id === 's-bound' ? 'approval' : undefined), id => `title-${id}`, () => false)
    expect(rows.map(row => row.sessionId)).toEqual(['s-bound'])
    expect(rows[0]).toMatchObject({ kind: 'waiting', waitingKind: 'approval' })
  })
})

describe('noteKeyOf (THE row identity)', () => {
  it('builds task|session|kind for drawer keys, the arrival map and unseen sets', () => {
    expect(noteKeyOf({ taskId: 'a', sessionId: 's', kind: 'waiting' })).toBe('a|s|waiting')
  })
})

describe('waiting arrival clock (first-seen, never the round clock)', () => {
  const arrival = (seen: ReadonlyMap<string, number>) =>
    (note: { taskId: string; sessionId: string; kind: 'waiting' | 'review' }): number | undefined =>
      arrivalOf(seen, note)

  it('a wait that fires late in a long turn sorts by arrival, not by round start', () => {
    // s-old's round started long ago; s-new's round started later — but the
    // OLD session's wait arrived just now (a /plan popped at minute ten).
    const tasks = [
      task('early', NOW, {
        executions: [{ id: 'e1', sessionId: 's-old', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
      }),
      task('late', NOW + 1_000, {
        executions: [{ id: 'e2', sessionId: 's-new', startedAt: NOW + 900, endedAt: undefined, result: undefined, error: undefined }],
      }),
    ]
    const pending = (id: string | undefined): 'question' | undefined =>
      id === 's-old' || id === 's-new' ? 'question' : undefined
    // Round-clock order (legacy): the later-started round wins.
    const legacy = notificationsExOf(tasks, pending, id => id)
    expect(legacy.map(row => row.sessionId)).toEqual(['s-new', 's-old'])
    // Arrival order: the just-arrived wait jumps first, whatever its start.
    const seen = new Map([
      ['early|s-old|waiting', NOW + 5_000],
      ['late|s-new|waiting', NOW + 1_000],
    ])
    const arrived = notificationsExOf(tasks, pending, id => id, () => false, () => [], {}, arrival(seen))
    expect(arrived.map(row => row.sessionId)).toEqual(['s-old', 's-new'])
  })

  it('stampWaitingArrivals stamps unseen waiting keys, keeps first-seen, drops the gone', () => {
    const first = stampWaitingArrivals(new Map(), [
      { taskId: 'a', sessionId: 's-1', kind: 'waiting' },
      { taskId: 'a', sessionId: 's-1', kind: 'review' },
    ], 100)
    // Waiting keys stamp; review keys never enter the map.
    expect([...first.entries()]).toEqual([['a|s-1|waiting', 100]])
    const second = stampWaitingArrivals(first, [
      { taskId: 'a', sessionId: 's-1', kind: 'waiting' },
      { taskId: 'b', sessionId: 's-2', kind: 'waiting' },
    ], 200)
    // s-1 keeps its first stamp; s-2 stamps now.
    expect(second.get('a|s-1|waiting')).toBe(100)
    expect(second.get('b|s-2|waiting')).toBe(200)
    const third = stampWaitingArrivals(second, [
      { taskId: 'b', sessionId: 's-2', kind: 'waiting' },
    ], 300)
    // s-1 left the board: dropped, so the map cannot outgrow the bell.
    expect([...third.keys()]).toEqual(['b|s-2|waiting'])
  })

  it('approval signals sort by arrival like any other wait', () => {
    const tasks = [task('a', NOW, {
      executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
    })]
    const rows = notificationsExOf(tasks, () => 'approval' as const, id => id, () => false, () => [], {}, arrival(new Map()))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'waiting', waitingKind: 'approval' })
    expect(rows[0].excerpt).toBeUndefined()
    expect(rows[0].answerable).toBeUndefined()
  })
})

describe('waiting body (signal + content + affordance, one derivation)', () => {
  const questionBatch = {
    questions: [{ question: '要继续吗？', detail: undefined, intent: undefined }],
    isPlanReview: false,
  }
  const planBatch = {
    questions: [{ question: '', detail: '## 计划\n1. 先做 A\n2. 再做 B', intent: { kind: 'plan-review' } }],
    isPlanReview: true,
  }

  it('a plan quotes its detail body and flags the plan grammar', () => {
    expect(waitingBodyOf(planBatch)).toEqual({ text: '## 计划\n1. 先做 A\n2. 再做 B', isPlan: true })
  })

  it('a plan without detail falls back to its question line', () => {
    expect(waitingBodyOf({
      questions: [{ question: '执行这个计划？', detail: undefined, intent: { kind: 'plan-review' } }],
      isPlanReview: true,
    })).toEqual({ text: '执行这个计划？', isPlan: true })
  })

  it('a question quotes its first item; an empty batch is a shell', () => {
    expect(waitingBodyOf(questionBatch)).toEqual({ text: '要继续吗？', isPlan: false })
    expect(waitingBodyOf(undefined)).toBeUndefined()
    expect(waitingBodyOf({ questions: [], isPlanReview: false })).toBeUndefined()
    expect(waitingBodyOf({
      questions: [{ question: '   ', detail: undefined, intent: undefined }],
      isPlanReview: false,
    })).toBeUndefined()
  })

  it('excerpts collapse whitespace and clamp to the budget with an ellipsis', () => {
    expect(waitingExcerptOf('  要继续吗？ ')).toBe('要继续吗？')
    const long = `x${'y'.repeat(WAITING_EXCERPT_BUDGET + 20)}`
    const excerpt = waitingExcerptOf(long)
    expect(excerpt.length).toBeLessThanOrEqual(WAITING_EXCERPT_BUDGET)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(waitingExcerptOf('a\nb\tc')).toBe('a b c')
  })

  it('rows carry excerpt + answerable only with a readable carrier and an interactive host', () => {
    const tasks = [task('a', NOW, {
      executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
    })]
    const pending = (id: string | undefined): 'question' | undefined =>
      id === 's-1' ? 'question' : undefined
    // Readable carrier + interactive host = content row with 去回答.
    const content = notificationsExOf(tasks, pending, id => id, () => false, () => [],
      { questionOf: () => questionBatch, answerInPlace: true })
    expect(content[0].excerpt).toBe('要继续吗？')
    expect(content[0].answerable).toBe(true)
    // Same carrier, display-only host = content WITHOUT the affordance.
    const degraded = notificationsExOf(tasks, pending, id => id, () => false, () => [],
      { questionOf: () => questionBatch, answerInPlace: false })
    expect(degraded[0].excerpt).toBe('要继续吗？')
    expect(degraded[0].answerable).toBeUndefined()
    // No carrier at all = shell (no excerpt, no affordance).
    const shell = notificationsExOf(tasks, pending, id => id)
    expect(shell[0].excerpt).toBeUndefined()
    expect(shell[0].answerable).toBeUndefined()
  })

  it('plan rows quote the plan body (the row promises what the card holds)', () => {
    const tasks = [task('a', NOW, {
      executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
    })]
    const rows = notificationsExOf(tasks, () => 'plan-review' as const, id => id, () => false, () => [],
      { questionOf: () => planBatch, answerInPlace: true })
    expect(rows[0].excerpt).toBe(waitingExcerptOf('## 计划 1. 先做 A 2. 再做 B'))
    expect(rows[0].answerable).toBe(true)
  })

  it('rows without a content face stay signal-only (no excerpt, no affordance)', () => {
    const tasks = [task('a', NOW, {
      executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
    })]
    const rows = waitingRows(tasks, () => 'question' as const)
    expect(rows[0].excerpt).toBeUndefined()
    expect(rows[0].answerable).toBeUndefined()
  })
})

describe('waiting moment clock (round activity, never task.updatedAt)', () => {
  it('a metadata bump after the wait started does not reorder or re-age the bell', () => {
    const tasks = [task('a', NOW + 100, {
      executions: [
        { id: 'e1', sessionId: 's-1', startedAt: NOW + 5, endedAt: undefined, result: undefined, error: undefined },
      ],
    })]
    const rows = waitingRows(tasks, id => (id === 's-1' ? 'question' : undefined))
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
    const rows = waitingRows(tasks, pending)
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
    const rows = waitingRows(tasks, pending)
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
    const rows = waitingRows(tasks, pending)
    expect(rows.map(row => row.sessionId)).toEqual(['s-1', 's-2'])
  })
})

/**
 * The board's demand count: the answer to 「等我做什么」, stated for the whole
 * surface. It exists because the bell counts notification ROWS (one per
 * session) and a column header counts CARDS — two numbers that measure
 * different things and can never reconcile on screen. The load-bearing rule
 * is that the review half is independent of `viewedAt`: reading a finished
 * run retires the unread GLOW (that message stays honest) but never resolves
 * the decision, and treating "seen" as "done" is exactly how a board stops
 * being safe to leave running.
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

describe('noteStatusShapeOf (THE status word per row — many states, one table)', () => {
  const row = (over: Partial<NotificationItem>): NotificationItem => ({
    taskId: 'a',
    taskTitle: 't',
    sessionId: 's',
    sessionTitle: 'S',
    kind: 'waiting',
    waitingKind: 'question',
    at: NOW,
    ...over,
  })

  it('waiting rows name the interaction they wait on', () => {
    expect(noteStatusShapeOf(row({ waitingKind: 'approval' }))).toEqual({ kind: 'warn', label: 'waiting.approval' })
    expect(noteStatusShapeOf(row({ waitingKind: 'plan-review' }))).toEqual({ kind: 'warn', label: 'waiting.plan-review' })
    expect(noteStatusShapeOf(row({ waitingKind: 'question' }))).toEqual({ kind: 'warn', label: 'waiting.question' })
    // A waiting row without a kind (hand-built legacy row) still speaks
    // honestly instead of crashing or borrowing a review word.
    expect(noteStatusShapeOf(row({ waitingKind: undefined }))).toEqual({ kind: 'warn', label: 'detail.result.running' })
  })

  it('review rows separate the decision states (failed / cancelled / pending)', () => {
    expect(noteStatusShapeOf(row({ kind: 'review', waitingKind: undefined, result: 'failed' })))
      .toEqual({ kind: 'error', label: 'board.notifyReviewFailed' })
    // Cancelled used to fall through to the green 待审核 word — a decision
    // that does not exist. It is now its own muted state.
    expect(noteStatusShapeOf(row({ kind: 'review', waitingKind: undefined, result: 'cancelled' })))
      .toEqual({ kind: 'muted', label: 'board.notifyCancelled' })
    expect(noteStatusShapeOf(row({ kind: 'review', waitingKind: undefined, result: 'succeeded' })))
      .toEqual({ kind: 'success', label: 'board.notifyReview' })
    expect(noteStatusShapeOf(row({ kind: 'review', waitingKind: undefined })))
      .toEqual({ kind: 'success', label: 'board.notifyReview' })
  })
})
