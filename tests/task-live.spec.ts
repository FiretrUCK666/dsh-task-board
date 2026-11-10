/**
 * Task-live-state tests: THE one derivation of running/waiting/idle for
 * card breathing, session glow and the controller's state drive — direct
 * steers, session rules and out-of-band turns all surface here, and the card
 * can never again read a different source than the rows.
 */
import { describe, expect, it } from 'vitest'
import { withSchedule, withStatus, type TaskRecord } from '../src/core/tasks.ts'
import {
  DIRECT_FALLBACK_STATUS, isDirectLike, leaveRunningTargetOf, reenterRunningTargetOf,
  relatedSessionIdsOf, runningJustificationOf, scheduleGapHolds, taskLiveStateOf,
  type TaskLiveState,
} from '../src/core/task-live.ts'

function taskWith(rounds: Array<{ sessionId: string; comment?: string; direct?: boolean; endedAt?: number }>): TaskRecord {
  const base = {
    id: 'task-1',
    title: 't',
    description: '',
    prompt: 'p',
    status: 'todo',
    column: 'todo',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    executions: [],
  } as TaskRecord
  return {
    ...base,
    executions: rounds.map((round, index) => ({
      id: `r-${index}`,
      taskId: 'task-1',
      sessionId: round.sessionId,
      startedAt: index,
      endedAt: round.endedAt,
      result: round.endedAt !== undefined ? ('succeeded' as const) : undefined,
      error: undefined,
      ...(round.comment !== undefined ? { comment: round.comment } : {}),
      ...(round.direct === true ? { direct: true as const } : {}),
    })),
  }
}

const runningOf = (running: Record<string, boolean>) => (sessionId: string) => running[sessionId] === true
const waitingOf = (waiting: Record<string, string>) => (sessionId: string) => waiting[sessionId] ?? undefined

describe('relatedSessionIdsOf', () => {
  it('collects every round session, de-duplicated', () => {
    const task = taskWith(
      [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'a' }],
    )
    expect(relatedSessionIdsOf(task, undefined, undefined)).toEqual([
      { sessionId: 'a' },
      { sessionId: 'b' },
    ])
  })

  it('includes session binds before the execution rounds', () => {
    const task = {
      ...taskWith([{ sessionId: 'run' }]),
      binds: [{ kind: 'session' as const, sessionId: 'bound' }],
    }
    expect(relatedSessionIdsOf(task, undefined, undefined)).toEqual([
      { sessionId: 'bound' },
      { sessionId: 'run' },
    ])
  })

  it('subtracts removedSessions from EVERY source (the deleted-session gate)', () => {
    // A removed session that still lingers as a session bind (a workspace bind
    // keeps it from being unbound) must NOT be related — otherwise chatting in
    // it drives the card while the row is gone (the reported bug).
    const task = {
      ...taskWith([{ sessionId: 'run' }]),
      binds: [{ kind: 'session' as const, sessionId: 'bound' }, { kind: 'workspace' as const, workspaceId: 'w' }],
      removedSessions: ['bound', 'link-1'],
    }
    expect(relatedSessionIdsOf(task, ['link-1', 'link-2'], undefined)).toEqual([
      { sessionId: 'run' },
      { sessionId: 'link-2' },
    ])
  })

  it('appends the injected linked ids (workspace members) after the rounds, de-duplicated', () => {
    const task = taskWith([{ sessionId: 'run' }])
    expect(relatedSessionIdsOf(task, ['link-1', 'run', 'link-2'], undefined)).toEqual([
      { sessionId: 'run' },
      { sessionId: 'link-1' },
      { sessionId: 'link-2' },
    ])
  })

  it('存在性判决对每个来源一视同仁，而且必须由调用点写出来', () => {
    // 读者的报告：「删掉或归档了一些会话之后，卡片上的会话数比里面实际的多」，而「等你处理」
    // 也会为一条已经不存在的会话一直亮着。根因是同一个问题有六处各自回答、几处**忘了回答**——
    // 所以第三个参数从可选变成必填：忘掉它不再编译得过，而「看不见」仍然可以显式写成 `undefined`
    // （那时不过滤：看不见 ≠ 不存在）。
    const task = taskWith([{ sessionId: 'run' }])
    const present = (id: string): boolean => id !== 'run'
    expect(relatedSessionIdsOf(task, undefined, present), '不在了的会话仍被算作相关').toEqual([])
    expect(relatedSessionIdsOf(task, undefined, undefined), '「看不见」被当成了「不存在」').toEqual([{ sessionId: 'run' }])
    expect(relatedSessionIdsOf(task, ['link-1'], present)).toEqual([{ sessionId: 'link-1' }])
  })
})

describe('taskLiveStateOf (任务运行态唯一推导)', () => {
  it('is waiting when any related session waits on the user (outranks running)', () => {
    const task = taskWith([{ sessionId: 'a' }, { sessionId: 'b' }])
    const state: TaskLiveState = taskLiveStateOf(
      task,
      runningOf({ a: true, b: true }),
      waitingOf({ b: 'question' }),
    )
    expect(state).toBe('waiting')
  })

  it('is running when any related session reports running (native truth — steer included)', () => {
    const task = taskWith([{ sessionId: 'a', direct: true, endedAt: 5 }])
    expect(taskLiveStateOf(task, runningOf({ a: true }), waitingOf({}))).toBe('running')
  })

  it('is idle when nothing runs and nobody waits', () => {
    const task = taskWith([{ sessionId: 'a', direct: true, endedAt: 5 }])
    expect(taskLiveStateOf(task, runningOf({}), waitingOf({}))).toBe('idle')
  })

  it('is running when a LINKED (workspace-member) session is working — the bound-card glow bug', () => {
    const task = taskWith([{ sessionId: 'run', endedAt: 5 }])
    expect(taskLiveStateOf(task, runningOf({ run: false, link: true }), waitingOf({}), { linkedSessionIds: ['link'] })).toBe('running')
  })

  it('is waiting when a linked session waits on the user', () => {
    const task = taskWith([])
    expect(taskLiveStateOf(task, runningOf({}), waitingOf({ link: 'plan-review' }), { linkedSessionIds: ['link'] })).toBe('waiting')
  })

  it('a REMOVED running session never drives the card (deleted-session gate)', () => {
    // The session lingers as a bind (workspace bind keeps it from unbinding)
    // but is in removedSessions — chatting in it must NOT move the card.
    const task = {
      ...taskWith([]),
      binds: [{ kind: 'session' as const, sessionId: 'gone' }],
      removedSessions: ['gone'],
    }
    expect(taskLiveStateOf(task, runningOf({ gone: true }), waitingOf({ gone: 'question' }))).toBe('idle')
  })
})

describe('direct-round fallback (无事件路径)', () => {
  it('recognizes a settled direct steer round as direct-like', () => {
    const task = taskWith([{ sessionId: 'a', direct: true, endedAt: 5 }])
    expect(isDirectLike(task.executions.at(-1))).toBe(true)
  })

  it('never treats an open board round as direct-like', () => {
    const task = taskWith([{ sessionId: 'a' }])
    expect(isDirectLike(task.executions.at(-1))).toBe(false)
  })

  it('falls back to the review column (a steer that ran to completion is a human gate)', () => {
    expect(DIRECT_FALLBACK_STATUS).toBe('review')
  })
})

describe('leave-running judgment (删空即离场的唯一判定)', () => {
  const runningTaskWith = (
    rounds: Array<{ sessionId: string; comment?: string; direct?: boolean; endedAt?: number }>,
  ): TaskRecord => withStatus(taskWith(rounds), 'running', 99)

  it('non-running cards never leave (not applicable)', () => {
    const task = taskWith([{ sessionId: 'a' }])
    expect(task.status).toBe('todo')
    expect(runningJustificationOf(task, 'running')).toBeUndefined()
    expect(leaveRunningTargetOf(task, 'running')).toBeUndefined()
  })

  it('an open execution round justifies staying', () => {
    const task = runningTaskWith([{ sessionId: 'a' }])
    expect(runningJustificationOf(task, 'idle')).toBe('open')
    expect(leaveRunningTargetOf(task, 'idle')).toBeUndefined()
  })

  it('a live native session justifies staying even with no rounds', () => {
    const task = runningTaskWith([])
    expect(runningJustificationOf(task, 'running')).toBe('live')
    expect(leaveRunningTargetOf(task, 'running')).toBeUndefined()
    expect(runningJustificationOf(task, 'waiting')).toBe('live')
    expect(leaveRunningTargetOf(task, 'waiting')).toBeUndefined()
  })

  it('an orphan (no rounds, no live truth, no schedule) leaves to todo', () => {
    const task = runningTaskWith([])
    expect(runningJustificationOf(task, 'idle')).toBeUndefined()
    expect(leaveRunningTargetOf(task, 'idle')).toBe('todo')
  })

  it('an orphan holding completed work leaves to review (the human gate survives)', () => {
    const task = runningTaskWith([{ sessionId: 'a', endedAt: 5 }])
    expect(runningJustificationOf(task, 'idle')).toBeUndefined()
    expect(leaveRunningTargetOf(task, 'idle')).toBe('review')
  })

  it('an armed chain gap holds the column; ignoreSchedule drops it (deletion is a cancel)', () => {
    const task = withStatus(
      withSchedule(taskWith([]), { enabled: true, mode: 'chain', cron: '', maxRuns: undefined, runCount: 0 }, 1),
      'running',
      2,
    )
    expect(scheduleGapHolds(task)).toBe(true)
    expect(runningJustificationOf(task, 'idle')).toBe('schedule')
    expect(leaveRunningTargetOf(task, 'idle')).toBeUndefined()
    expect(runningJustificationOf(task, 'idle', { ignoreSchedule: true })).toBeUndefined()
    expect(leaveRunningTargetOf(task, 'idle', { ignoreSchedule: true })).toBe('todo')
  })

  it('a budgeted cron gap holds the column only while runs remain', () => {
    const holding = withStatus(
      withSchedule(taskWith([]), { enabled: true, cron: '* * * * *', maxRuns: 3, runCount: 1 }, 1),
      'running',
      2,
    )
    expect(scheduleGapHolds(holding)).toBe(true)
    expect(leaveRunningTargetOf(holding, 'idle')).toBeUndefined()
    const spent = withStatus(
      withSchedule(taskWith([]), { enabled: true, cron: '* * * * *', maxRuns: 3, runCount: 3 }, 1),
      'running',
      2,
    )
    expect(scheduleGapHolds(spent)).toBe(false)
    expect(leaveRunningTargetOf(spent, 'idle')).toBe('todo')
  })

  it('an unbudgeted cron never holds the column (no pending run between fires)', () => {
    const task = withStatus(
      withSchedule(taskWith([]), { enabled: true, cron: '* * * * *', maxRuns: undefined, runCount: 3 }, 1),
      'running',
      2,
    )
    expect(scheduleGapHolds(task)).toBe(false)
    expect(leaveRunningTargetOf(task, 'idle')).toBe('todo')
  })

  it('a disarmed or prompt-less schedule never holds the column', () => {
    const off = withStatus(
      withSchedule(taskWith([]), { enabled: false, cron: '* * * * *', maxRuns: 5, runCount: 0 }, 1),
      'running',
      2,
    )
    expect(scheduleGapHolds(off)).toBe(false)
    const emptyPrompt = withStatus(
      withSchedule({ ...taskWith([]), prompt: '   ' }, { enabled: true, mode: 'chain', cron: '', runCount: 0 }, 1),
      'running',
      2,
    )
    expect(scheduleGapHolds(emptyPrompt)).toBe(false)
  })
})

/**
 * The RE-ENTRY judgment — the mirror of the leave judgment above, and the
 * writer the board was missing. The machine this pins: the main agent hands the
 * job to a subagent and stops; its own round settles one instant before the
 * child flips `running`, so the card lands in 待审核 and NOTHING ever moved it
 * back while the child kept working.
 *
 * Every case is a pair of surfaces that must say the same sentence — the column
 * the card wears and the word its chip shows — so this file cannot go green
 * while the board says 「待你决断」 about a card that is busy.
 */
describe('re-entry judgment (子 Agent 还在跑 ⇒ 回到进行中)', () => {
  const settledCard = (status: 'todo' | 'review' | 'running' | 'done'): TaskRecord =>
    withStatus(taskWith([{ sessionId: 'P', endedAt: 5 }]), status, 99)

  it('a 待审核 card whose work is only its subagents goes back to 进行中', () => {
    // THE reported state, verbatim: the card sits in 待审核 (the main agent's
    // turn ended) while the subagent it dispatched is still working.
    expect(reenterRunningTargetOf(settledCard('review'), 'running', { delegating: true })).toBe('running')
  })

  it('a 待办 card in the same state goes back too (the column claims no work)', () => {
    // 待办 and 待审核 make the SAME claim about the present — "nothing of this
    // card is in flight". Only the second also claims the work finished, so both
    // are refuted by the same live fact.
    expect(reenterRunningTargetOf(settledCard('todo'), 'running', { delegating: true })).toBe('running')
  })

  it('a card already in 进行中 is left alone (nothing to correct)', () => {
    expect(reenterRunningTargetOf(settledCard('running'), 'running', { delegating: true })).toBeUndefined()
  })

  it('已完成 is never dragged back — that conclusion has its own door', () => {
    // `done` is a human's decision (moveTaskToStatus / reviveTaskIfDone). An
    // automatic derivation must not overrule it; the comment and steer paths
    // revive a done card on their own, deliberately.
    expect(reenterRunningTargetOf(settledCard('done'), 'running', { delegating: true })).toBeUndefined()
  })

  it('a session working on its OWN turn is 进行中, not 等子 Agent (no re-entry)', () => {
    // The `delegating` gate is a CONJUNCTION: some descendant runs AND no
    // session runs on its own turn. An own turn is the 进行中 lane written by
    // its own paths (external round / steer drive) — this door is not its writer.
    expect(reenterRunningTargetOf(settledCard('review'), 'running', { delegating: false })).toBeUndefined()
  })

  it('POSITIVE evidence only: an incomplete snapshot never moves a card', () => {
    // 'unknown' is not a verdict anywhere in this module — the same two-pass law
    // the leave side follows. A lagging list must not shuffle the board.
    expect(reenterRunningTargetOf(settledCard('review'), 'unknown', { delegating: true })).toBeUndefined()
    // 'waiting' means a conversation is suspended on the human: that is the
    // 待你决断 chip's business, not a re-entry.
    expect(reenterRunningTargetOf(settledCard('review'), 'waiting', { delegating: true })).toBeUndefined()
  })

  it('the two judgments are exact mirrors: a card can never satisfy both', () => {
    // If both could fire on one card, every pass would ping-pong it between
    // 进行中 and 待审核. They read opposite columns, so the property holds
    // structurally — pinned so a future widening of either arm breaks loudly.
    const review = settledCard('review')
    expect(reenterRunningTargetOf(review, 'running', { delegating: true })).toBe('running')
    expect(leaveRunningTargetOf(review, 'running'), 'a non-running card never leaves').toBeUndefined()
    const running = settledCard('running')
    expect(reenterRunningTargetOf(running, 'running', { delegating: true })).toBeUndefined()
    expect(leaveRunningTargetOf(running, 'running'), 'a live descendant justifies staying').toBeUndefined()
  })
})