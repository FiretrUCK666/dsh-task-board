/**
 * Notification center aggregation (client/board/notifications.ts): ONE row
 * per waiting session and per settled review session, deduped; busy but not
 * waiting is never a notification. Rows are THE counting unit (bell badge =
 * unseen dot = drawer rows).
 */
import { describe, expect, it } from 'vitest'
import { arrivalOf, noteKeyOf, noteStatusShapeOf, notificationsExOf, stampWaitingArrivals, waitingBodyOf, waitingExcerptOf, WAITING_EXCERPT_BUDGET, type NotificationItem } from '../src/client/board/notifications.ts'
import { createTask, settleExecution, startExecution } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

function task(id: string, updatedAt: number, extra: Record<string, unknown> = {}) {
  return {
    ...createTask({ title: `task-${id}`, description: '', prompt: 'p' }, updatedAt, id),
    ...extra,
  }
}

/** Waiting-only view: the gate is driven by the rounds' own read stamps, so a
 *  fixture with none is simply "not looked at yet". */
function waitingRows(
  tasks: Parameters<typeof notificationsExOf>[0],
  pending: Parameters<typeof notificationsExOf>[1],
  titleOf: Parameters<typeof notificationsExOf>[2] = id => id,
) {
  return notificationsExOf(tasks, pending, titleOf)
}

describe('waiting rows (one per waiting session)', () => {
  it('empty board, or nothing waiting, is no rows', () => {
    expect(waitingRows([], () => undefined)).toEqual([])
    const tasks = [task('a', NOW)]
    expect(waitingRows(tasks, () => undefined)).toEqual([])
  })

  it('one row per waiting session (rounds deduplicated)', () => {
    const tasks = [task('a', NOW, {
      executions: [
        { id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
        { id: 'e1b', sessionId: 's-1', startedAt: NOW + 1, endedAt: undefined, result: undefined, error: undefined },
        { id: 'e2', sessionId: 's-2', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
      ],
    })]
    const pending = (id: string | undefined): 'question' | undefined =>
      id === 's-1' || id === 's-2' ? 'question' : undefined
    const rows = waitingRows(tasks, pending, id => `title-${id}`)
    // s-1 named by two rounds still waits once (one row per SESSION).
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
    const rows = notificationsExOf([reviewed], () => undefined, id => id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ taskId: 'r', kind: 'review', result: 'failed' })
    // Opening the CARD moves only the task-level baseline — the row gate is
    // the SESSION's own round clock, so the row survives (「点开卡片整卡通知
    // 消失」 was exactly the task-level gate this replaced).
    expect(notificationsExOf([reviewed], () => undefined, id => id)).toHaveLength(1)
    // Acknowledging the SESSION (what the panel/review-page/notification-open
    // /标已读 funnels write) is what retires its row.
    const acknowledged = {
      ...reviewed,
      executions: reviewed.executions.map(round => ({ ...round, viewedAt: NOW + 10 })),
    }
    expect(notificationsExOf([acknowledged], () => undefined, id => id)).toEqual([])
  })

  it('per-session gates: stamping ONE session keeps its sibling row', () => {
    const two = {
      ...task('r', NOW, { status: 'review' as const }),
      executions: [
        { id: 'e1', sessionId: 's-1', startedAt: NOW + 1, endedAt: NOW + 10, result: 'failed' as const, error: 'boom', viewedAt: NOW + 1 },
        { id: 'e2', sessionId: 's-2', startedAt: NOW + 2, endedAt: NOW + 20, result: 'succeeded' as const, error: undefined, viewedAt: NOW + 2 },
      ],
    }
    expect(notificationsExOf([two], () => undefined, id => id)).toHaveLength(2)
    // Stamp s-1 only (its settle moves its ack past its activity): s-1's row
    // leaves, s-2's stays — rows clear conversation by conversation.
    const stamped = {
      ...two,
      executions: two.executions.map(round => (round.sessionId === 's-1' ? { ...round, viewedAt: NOW + 10 } : round)),
    }
    const rows = notificationsExOf([stamped], () => undefined, id => id)
    expect(rows.map(row => row.sessionId)).toEqual(['s-2'])
  })

  it('a waiting row suppresses the same-SESSION review echo, never a sibling session', () => {
    const base = createTask({ title: 'R', description: '', prompt: 'p' }, NOW, 'r')
    const running = startExecution(base, NOW + 1, 'e1')
    const reviewed = settleExecution({ ...running.task, executions: running.task.executions.map(round => ({ ...round, sessionId: 's-1' })) }, 'e1', 'succeeded', NOW + 2, undefined)
    // Same session waits too → the louder waiting row stands alone.
    const same = notificationsExOf([reviewed], id => (id === 's-1' ? 'question' : undefined), id => id)
    expect(same.map(row => row.kind)).toEqual(['waiting'])
    // An UNRELATED session waits → both rows stand: the finished run keeps
    // its 通过/打回, the blocked sibling keeps its 去回答. Suppressing the
    // gate here is what hid the decision behind a question on another lane.
    const sibling = notificationsExOf(
      [{ ...reviewed, executions: [...reviewed.executions, { id: 'e2', sessionId: 's-2', startedAt: NOW + 3, endedAt: undefined, result: undefined, error: undefined }] }],
      id => (id === 's-2' ? 'question' : undefined),
      id => id,
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
    const rows = notificationsExOf([two], () => undefined, id => `title-${id}`)
    expect(rows.map(row => `${row.kind}:${row.sessionId}`)).toEqual(['review:s-1', 'review:s-2'])
    expect(rows[0]).toMatchObject({ result: 'failed', at: NOW + 10, sessionTitle: 'title-s-1' })
    expect(rows[1]).toMatchObject({ result: 'succeeded', at: NOW + 20, sessionTitle: 'title-s-2' })
    // Failed ranks first (it needs a decision), then settle recency — per row.
    // A CANCELLED lane joins none of them: an abort is not something a person
    // rules on, so it earns no row (pinned in the gate describe below).
    const cancelled = {
      ...task('c', NOW + 5, { status: 'review' as const }),
      executions: [
        { id: 'e1', sessionId: 's-3', startedAt: NOW + 1, endedAt: NOW + 3, result: 'cancelled' as const, error: undefined },
      ],
    }
    const mixed = notificationsExOf([two, cancelled], () => undefined, id => id)
    expect(mixed.map(row => `${row.result}:${row.sessionId}`)).toEqual(['failed:s-1', 'succeeded:s-2'])
  })

  it('a legacy review task whose runs carry no session keeps ONE reachable gate row', () => {
    // Driven through the REAL read clock, not an injected predicate: a card
    // whose baseline predates the settle owes the gate, and the same card with
    // the baseline moved past it does not.
    const legacy = {
      ...task('old', NOW, { status: 'review' as const }),
      executions: [
        { id: 'e1', sessionId: undefined, startedAt: NOW + 1, endedAt: NOW + 3, result: 'succeeded' as const, error: undefined },
      ],
    }
    const rows = notificationsExOf([legacy], () => undefined, id => id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'review', sessionId: 'old', result: 'succeeded', at: NOW + 3 })
    // No session identity = no per-session clock: THIS lane alone reads the
    // card-level baseline, so looking at the card retires it.
    expect(notificationsExOf([{ ...legacy, viewedAt: NOW + 8 }], () => undefined, id => id)).toEqual([])
  })

  it('a comment-only session is a lane too, and it names its REAL outcome', () => {
    // The bound-conversation shape: driven natively — comment/observed rounds,
    // NO plain run. It owed a row but borrowed a resultless 「待审核」, so a
    // comment that FAILED read as a success waiting to be confirmed. The gate
    // reads the work, not the run sequence.
    const chatTask = {
      ...task('c', NOW + 5, { status: 'review' as const }),
      executions: [
        { id: 'c1', sessionId: 's-chat', startedAt: NOW + 1, endedAt: NOW + 4, result: 'succeeded' as const, error: undefined, comment: '你好', viewedAt: NOW + 1 },
      ],
    }
    const rows = notificationsExOf([chatTask], () => undefined, id => `title-${id}`)
    expect(rows.map(row => row.sessionId)).toEqual(['s-chat'])
    expect(rows[0]).toMatchObject({ kind: 'review', sessionTitle: 'title-s-chat', at: NOW + 4, result: 'succeeded' })
    const failedChat = {
      ...chatTask,
      executions: [{ ...chatTask.executions[0], result: 'failed' as const, error: 'boom' }],
    }
    expect(notificationsExOf([failedChat], () => undefined, id => id)[0]?.result).toBe('failed')
  })

  it('mixed lanes: each session keeps its OWN result and settle; failed still ranks first', () => {
    const mixed = {
      ...task('m', NOW + 9, { status: 'review' as const }),
      executions: [
        { id: 'e1', sessionId: 's-run', startedAt: NOW + 1, endedAt: NOW + 6, result: 'failed' as const, error: 'boom' },
        { id: 'c1', sessionId: 's-chat', startedAt: NOW + 2, endedAt: NOW + 8, result: 'succeeded' as const, error: undefined, comment: '晚安' },
      ],
    }
    const rows = notificationsExOf([mixed], () => undefined, id => id)
    expect(rows.map(row => row.sessionId)).toEqual(['s-run', 's-chat'])
    const runRow = rows.find(row => row.sessionId === 's-run')
    const chatRow = rows.find(row => row.sessionId === 's-chat')
    expect(runRow).toMatchObject({ result: 'failed', at: NOW + 6 })
    expect(chatRow).toMatchObject({ at: NOW + 8, result: 'succeeded' })
  })
})

describe('bound waiting sessions (no round behind them)', () => {
  it('a bound-but-never-run waiting session notifies (same related set as live)', () => {
    const base = createTask({ title: 'B', description: '', prompt: 'p' }, NOW, 'b')
    const task = { ...base, binds: [{ kind: 'session' as const, sessionId: 's-bound' }] }
    const rows = notificationsExOf([task], id => (id === 's-bound' ? 'approval' : undefined), id => `title-${id}`)
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
    const arrived = notificationsExOf(tasks, pending, id => id, () => [], {}, arrival(seen))
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
    const rows = notificationsExOf(tasks, () => 'approval' as const, id => id, () => [], {}, arrival(new Map()))
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
    const content = notificationsExOf(tasks, pending, id => id, () => [],
      { questionOf: () => questionBatch, answerInPlace: true })
    expect(content[0].excerpt).toBe('要继续吗？')
    expect(content[0].answerable).toBe(true)
    // Same carrier, display-only host = content WITHOUT the affordance.
    const degraded = notificationsExOf(tasks, pending, id => id, () => [],
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
    const rows = notificationsExOf(tasks, () => 'plan-review' as const, id => id, () => [],
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
 * The review tier is THE human gate, per conversation, and it is read from
 * `task-demand.sessionGateOf` — the same derivation the card's 待你决断 chip
 * and the header's 待审核 count read. These cases pin that agreement, because
 * the two used to be separate questions with separate answers: a row existed
 * for any settled round while its WORD came from the plain-run lane, and the
 * card's chip came from a THIRD question (the plain-run lane again).
 */
describe('review rows (the gate, per conversation, every lane)', () => {
  /** A settled comment round in `s-1` — the lane `plainRunsOf` cannot see. */
  const commentFinished = {
    id: 'c1',
    sessionId: 's-1',
    startedAt: NOW,
    injectedAt: NOW,
    endedAt: NOW + 100,
    result: 'succeeded' as const,
    error: undefined,
    comment: '继续做',
    viewedAt: NOW,
  }

  it('a card whose only finished work is a comment still owes a decision', () => {
    const card = { ...task('a', NOW, { status: 'review', executions: [commentFinished] }) }
    const rows = notificationsExOf([card], () => undefined, id => id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'review', sessionId: 's-1', result: 'succeeded' })
  })

  it('a FAILED comment round says 待决策, not a success waiting to be confirmed', () => {
    const card = {
      ...task('a', NOW, {
        status: 'review',
        executions: [{ ...commentFinished, result: 'failed' as const, error: 'boom' }],
      }),
    }
    const row = notificationsExOf([card], () => undefined, id => id)[0]
    expect(row?.result).toBe('failed')
    expect(noteStatusShapeOf({ ...row!, kind: 'review' }))
      .toEqual({ kind: 'error', label: 'board.notifyReviewFailed' })
  })

  it('an observed native turn that finished is the gate too', () => {
    const card = {
      ...task('a', NOW, {
        status: 'review',
        executions: [{
          id: 'x1', sessionId: 's-1', startedAt: NOW, injectedAt: NOW, endedAt: NOW + 100,
          result: 'succeeded' as const, error: undefined, comment: '', sessionAnchor: 's-1',
          external: true, viewedAt: NOW,
        }],
      }),
    }
    expect(notificationsExOf([card], () => undefined, id => id)).toHaveLength(1)
  })

  it('a CANCELLED round is not a decision, so it produces no row at all', () => {
    const card = {
      ...task('a', NOW, {
        status: 'review',
        executions: [{ ...commentFinished, result: 'cancelled' as const }],
      }),
    }
    expect(notificationsExOf([card], () => undefined, id => id)).toEqual([])
  })

  it('looking at the conversation retires its row (the read clock, not the column)', () => {
    const unread = { ...task('a', NOW, { status: 'review', executions: [commentFinished] }) }
    expect(notificationsExOf([unread], () => undefined, id => id)).toHaveLength(1)
    // The per-session read stamp, moved past the settle — what opening the
    // session panel writes.
    const read = {
      ...unread,
      executions: [unread.executions[0], { id: 'c2', sessionId: 's-1', startedAt: NOW + 200, endedAt: NOW + 200, result: 'succeeded' as const, error: undefined, comment: '看到这了', injectedAt: NOW + 200, viewedAt: NOW + 300 }],
    }
    expect(notificationsExOf([read], () => undefined, id => id)).toEqual([])
  })

  it('a card moved out of 待审核 owes nothing, whatever it finished', () => {
    const approved = { ...task('a', NOW, { status: 'done', executions: [commentFinished] }) }
    expect(notificationsExOf([approved], () => undefined, id => id)).toEqual([])
  })

  it('one waiting row and one review row can coexist on DIFFERENT conversations', () => {
    const card = {
      ...task('a', NOW, {
        status: 'review',
        executions: [commentFinished, {
          id: 'c3', sessionId: 's-2', startedAt: NOW, injectedAt: NOW, endedAt: NOW + 50,
          result: 'succeeded' as const, error: undefined, comment: 'ok', viewedAt: NOW,
        }],
      }),
    }
    const pending = (id: string | undefined): 'question' | undefined => (id === 's-2' ? 'question' : undefined)
    const rows = notificationsExOf([card], pending, id => id)
    // s-2 is already shouting louder (waiting), so its review echo yields; the
    // gate on s-1 keeps its own row.
    expect(rows).toHaveLength(2)
    expect(rows.filter(row => row.kind === 'waiting').map(row => row.sessionId)).toEqual(['s-2'])
    expect(rows.filter(row => row.kind === 'review').map(row => row.sessionId)).toEqual(['s-1'])
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

  it('review rows name the two decision states, and there is no third', () => {
    expect(noteStatusShapeOf(row({ kind: 'review', waitingKind: undefined, result: 'failed' })))
      .toEqual({ kind: 'error', label: 'board.notifyReviewFailed' })
    // Succeeded wears AMBER — the same "needs you" language as the waiting
    // chips and the card's 待你决断 badge (green read as "done", which a run
    // nobody has decided is not).
    expect(noteStatusShapeOf(row({ kind: 'review', waitingKind: undefined, result: 'succeeded' })))
      .toEqual({ kind: 'warn', label: 'board.notifyReview' })
    // A row with no result at all (hand-built legacy row) still speaks
    // honestly instead of borrowing the failure word.
    expect(noteStatusShapeOf(row({ kind: 'review', waitingKind: undefined })))
      .toEqual({ kind: 'warn', label: 'board.notifyReview' })
  })
})
