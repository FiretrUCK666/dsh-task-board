/**
 * Task-live-state tests: THE one derivation of running/waiting/idle for
 * card breathing, session glow and the controller's state drive — direct
 * steers, session rules and out-of-band turns all surface here, and the card
 * can never again read a different source than the rows.
 */
import { describe, expect, it } from 'vitest'
import { latestExecutionOf, type TaskRecord } from '../src/core/tasks.ts'
import {
  DIRECT_FALLBACK_STATUS, isDirectLike, relatedSessionIdsOf, taskLiveStateOf,
  type TaskLiveState,
} from '../src/core/task-live.ts'

function taskWith(rounds: Array<{ sessionId: string; comment?: string; direct?: boolean; endedAt?: number }>, refine?: string): TaskRecord {
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
    refineSessionId: refine,
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
  it('collects refine + every round session, de-duplicated', () => {
    const task = taskWith(
      [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'a' }],
      'refine',
    )
    expect(relatedSessionIdsOf(task)).toEqual([
      { sessionId: 'refine', refine: true },
      { sessionId: 'a', refine: false },
      { sessionId: 'b', refine: false },
    ])
  })

  it('includes session binds before the execution rounds', () => {
    const task = {
      ...taskWith([{ sessionId: 'run' }]),
      binds: [{ kind: 'session' as const, sessionId: 'bound' }],
    }
    expect(relatedSessionIdsOf(task)).toEqual([
      { sessionId: 'bound', refine: false },
      { sessionId: 'run', refine: false },
    ])
  })

  it('appends the injected linked ids (workspace members) after the rounds, de-duplicated', () => {
    const task = taskWith([{ sessionId: 'run' }])
    expect(relatedSessionIdsOf(task, ['link-1', 'run', 'link-2'])).toEqual([
      { sessionId: 'run', refine: false },
      { sessionId: 'link-1', refine: false },
      { sessionId: 'link-2', refine: false },
    ])
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
    expect(taskLiveStateOf(task, runningOf({ run: false, link: true }), waitingOf({}), ['link'])).toBe('running')
  })

  it('is waiting when a linked session waits on the user', () => {
    const task = taskWith([])
    expect(taskLiveStateOf(task, runningOf({}), waitingOf({ link: 'plan-review' }), ['link'])).toBe('waiting')
  })
})

describe('direct-round fallback (无事件路径)', () => {
  it('recognizes a settled direct steer round as direct-like', () => {
    const task = taskWith([{ sessionId: 'a', direct: true, endedAt: 5 }])
    expect(isDirectLike(latestExecutionOf(task))).toBe(true)
  })

  it('never treats an open board round as direct-like', () => {
    const task = taskWith([{ sessionId: 'a' }])
    expect(isDirectLike(latestExecutionOf(task))).toBe(false)
  })

  it('falls back to the review column (a steer that ran to completion is a human gate)', () => {
    expect(DIRECT_FALLBACK_STATUS).toBe('review')
  })
})