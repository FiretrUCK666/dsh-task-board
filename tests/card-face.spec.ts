/**
 * Card face projection: one display shape for EVERY card — a bound
 * session/workspace task and a plain created task render the same run
 * window, comment count + latest, and remaining-time slot. The two kinds
 * can never drift because they read the same projection.
 */
import { describe, expect, it } from 'vitest'
import { createTask, newCommentRound, newDirectRound, newExternalRound, startExecution, type ExecutionRecord } from '../src/core/tasks.ts'
import { cardFaceOf } from '../src/client/board/card-face.ts'

const NOW = 1_700_000_000_000

describe('cardFaceOf', () => {
  it('a fresh task has no run window, no comments and no schedule slot', () => {
    const face = cardFaceOf(createTask({ title: 't', description: '', prompt: '' }, NOW, 't1'), NOW)
    expect(face.running).toBe(false)
    expect(face.startedAt).toBeUndefined()
    expect(face.commentCount).toBe(0)
    expect(face.nextRunAt).toBeUndefined()
  })

  it('derives the latest plain run window and duration', () => {
    const task = createTask({ title: 't', description: '', prompt: '' }, NOW, 't1')
    const started = startExecution(task, NOW, 'e1')
    const startedRound = { ...started.execution, sessionId: 's-1', endedAt: NOW + 300_000, result: 'succeeded' as const }
    const withRound = { ...started.task, executions: [...started.task.executions].map(round => round.id === 'e1' ? startedRound : round) }
    const face = cardFaceOf(withRound, NOW + 300_000)
    expect(face.startedAt).toBe(NOW)
    expect(face.endedAt).toBe(NOW + 300_000)
    expect(face.duration).toBe(300_000)
  })

  it('counts the session comment thread and the newest body', () => {
    const task = createTask({ title: 't', description: '', prompt: '' }, NOW, 't1')
    const rounds: ExecutionRecord[] = [
      newExternalRound({ id: 'x1', now: NOW + 10, sessionId: 's-1', text: '你好' }),
      newDirectRound({ id: 'd1', now: NOW + 20, text: '直发一句', sessionId: 's-1' }),
      newCommentRound({ id: 'c1', now: NOW + 30, text: '评论', sessionId: 's-1' }),
    ]
    const withComments = { ...task, executions: rounds }
    const face = cardFaceOf(withComments, NOW + 40)
    expect(face.commentCount).toBe(3)
    expect(face.latest?.text).toBe('评论')
  })

  it('a bound session task with no board run still shows its thread', () => {
    const task = { ...createTask({ title: 't', description: '', prompt: '' }, NOW, 't1'), bind: { kind: 'session' as const, sessionId: 's-b' } }
    const withRound = { ...task, executions: [newExternalRound({ id: 'x1', now: NOW + 10, sessionId: 's-b' })] }
    const face = cardFaceOf(withRound, NOW + 20)
    expect(face.commentCount).toBe(1)
    expect(face.startedAt).toBeUndefined() // external rounds are not plain runs
    expect(face.latest?.text).toBe('')
    expect(face.latest?.stateKey).toBe('review.commentRunning')
  })

  it('armed cron rules surface the next run; running tasks report elapsed', () => {
    const task = createTask({ title: 't', description: '', prompt: '' }, NOW, 't1')
    const scheduled = { ...task, schedule: { enabled: true, mode: 'cron' as const, cron: '0 9 * * *', nextRunAt: NOW + 3_600_000, runCount: 0, lastTriggeredAt: NOW, primed: false, maxRuns: undefined } }
    expect(cardFaceOf(scheduled, NOW).nextRunAt).toBe(NOW + 3_600_000)
    const started = startExecution(task, NOW, 'e1')
    const withSession = { ...started.task, executions: [...started.task.executions].map(round => round.id === 'e1' ? { ...round, sessionId: 's-1' } : round) }
    const face = cardFaceOf(withSession, NOW + 90_000)
    // An open plain run = executing: the live indicator + elapsed.
    expect(face.running).toBe(true)
    expect(face.elapsed).toBe(90_000)
  })
})
