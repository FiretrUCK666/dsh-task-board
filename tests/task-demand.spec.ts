/**
 * `task-demand.ts` — 「这张卡欠人什么」. THE contract for the human gate.
 *
 * Every case here is a disagreement the board used to have with itself, written
 * as the one answer instead:
 *
 *  - the review half is a CONJUNCTION (finished ∧ in 待审核 ∧ not looked at), so
 *    the card's 待你决断 chip, the header's 待审核 count and the drawer's row
 *    cannot be three different numbers for one card;
 *  - it is read over EVERY lane, because every lane lands a card in 待审核;
 *  - 「等你处理」 walks the RELATED session set, so a session dragged in from
 *    the workspace raises the card's own voice and not only the bell's.
 */
import { describe, expect, it } from 'vitest'
import {
  boardDemandOf,
  gateOf,
  latestCompletedOf,
  sessionGateOf,
  waitingSessionsOf,
} from '../src/core/task-demand.ts'
import { newCommentRound, newDirectRound, newExternalRound, settleExecution, startExecution, type TaskRecord } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

function card(extra: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1',
    title: 'T',
    description: '',
    prompt: 'p',
    status: 'backlog',
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
    executions: [],
    ...extra,
  }
}

/** A plain run that finished — the only lane `plainRunsOf` can see. */
function runFinished(sessionId: string, result: 'succeeded' | 'failed' = 'succeeded') {
  const started = startExecution(card(), NOW + 1, 'e1').task
  const withSession: TaskRecord = {
    ...started,
    executions: started.executions.map(round => ({ ...round, sessionId })),
  }
  return settleExecution(withSession, 'e1', result, NOW + 2, undefined)
}

/** A comment that finished — the lane the plain-run filter throws away. */
function commentFinished(sessionId: string, result: 'succeeded' | 'failed' = 'succeeded', viewedAt = NOW + 1) {
  const round = newCommentRound({ id: 'c1', now: NOW + 1, text: '继续做', sessionId })
  return {
    ...card({ status: 'review' as const, executions: [{ ...round, viewedAt, endedAt: NOW + 2, result }] }),
  }
}

describe('latestCompletedOf — the newest finished work, EVERY lane', () => {
  it('reads a plain run', () => {
    expect(latestCompletedOf(runFinished('s-1'))).toMatchObject({ result: 'succeeded', sessionId: 's-1' })
  })

  it('reads a comment round the plain-run filter cannot see', () => {
    const work = latestCompletedOf(commentFinished('s-1', 'failed'))
    expect(work).toMatchObject({ result: 'failed', sessionId: 's-1' })
  })

  it('reads an observed native turn', () => {
    const round = { ...newExternalRound({ id: 'x1', now: NOW + 1, sessionId: 's-1' }), endedAt: NOW + 2, result: 'succeeded' as const }
    expect(latestCompletedOf(card({ status: 'review', executions: [round] })))
      .toMatchObject({ result: 'succeeded', sessionId: 's-1' })
  })

  it('reads a direct steer and a rule instruction alike', () => {
    const steer = newDirectRound({ id: 'd1', now: NOW + 1, text: '做', sessionId: 's-1' })
    expect(latestCompletedOf(card({ status: 'review', executions: [steer] })))
      .toMatchObject({ result: 'succeeded', sessionId: 's-1' })
    const ruled = { ...newCommentRound({ id: 'r1', now: NOW + 1, text: '再来一轮', sessionId: 's-1', ruleId: 'rule-1' }), endedAt: NOW + 2, result: 'failed' as const }
    expect(latestCompletedOf(card({ status: 'review', executions: [ruled] })))
      .toMatchObject({ result: 'failed' })
  })

  it('ignores a CANCELLED round (an abort is not work a person rules on)', () => {
    const round = { ...newCommentRound({ id: 'c1', now: NOW + 1, text: 'x', sessionId: 's-1' }), endedAt: NOW + 2, result: 'cancelled' as const }
    expect(latestCompletedOf(card({ status: 'review', executions: [round] }))).toBeUndefined()
  })

  it('picks the NEWEST, not the last written', () => {
    const older = { ...newCommentRound({ id: 'c1', now: NOW, text: 'a', sessionId: 's-1' }), endedAt: NOW + 10, result: 'succeeded' as const }
    const newer = { ...newCommentRound({ id: 'c2', now: NOW + 20, text: 'b', sessionId: 's-1' }), endedAt: NOW + 30, result: 'failed' as const }
    expect(latestCompletedOf(card({ status: 'review', executions: [older, newer] }))?.result).toBe('failed')
  })
})

describe('gateOf — the card owes a decision only while all three hold', () => {
  it('a finished card nobody looked at is UNSEEN', () => {
    expect(gateOf(commentFinished('s-1')).state).toBe('unseen')
  })

  it('the same card after the conversation is read is SEEN — looking retires it', () => {
    // The read stamp the session panel writes on open.
    expect(gateOf(commentFinished('s-1', 'succeeded', NOW + 3)).state).toBe('seen')
  })

  it('a card that is not in 待审核 owes nothing, finished or not', () => {
    const done = { ...commentFinished('s-1'), status: 'done' as const }
    expect(gateOf(done).state).toBe('none')
    expect(gateOf({ ...commentFinished('s-1'), status: 'running' as const }).state).toBe('none')
  })

  it('a card dragged into 待审核 by hand, having run nothing, owes nothing', () => {
    expect(gateOf(card({ status: 'review' })).state).toBe('none')
  })

  it('a comment-only card is UNSEEN — the lane used to be invisible to the chip', () => {
    expect(gateOf(commentFinished('s-1')).state).toBe('unseen')
  })

  it('an UNSEEN conversation outranks a read one, so one card never half-asks', () => {
    const read = commentFinished('s-1', 'succeeded', NOW + 3)
    const unreadRound = { ...newCommentRound({ id: 'c2', now: NOW + 10, text: 'b', sessionId: 's-2' }), viewedAt: NOW + 11, endedAt: NOW + 12, result: 'succeeded' as const }
    const both: TaskRecord = { ...read, executions: [...read.executions, unreadRound] }
    expect(gateOf(both)).toMatchObject({ state: 'unseen', sessionId: 's-2' })
  })

  it('names the outcome, so a failure can never read as a success waiting to be confirmed', () => {
    expect(gateOf(commentFinished('s-1', 'failed')).work?.result).toBe('failed')
  })
})

describe('sessionGateOf — the same three readings, scoped to one conversation', () => {
  it('reads the conversation, not the card', () => {
    const task = commentFinished('s-1', 'failed')
    expect(sessionGateOf(task, 's-1').state).toBe('unseen')
    expect(sessionGateOf(task, 's-2').state).toBe('none')
  })

  it('a sibling conversation finishing later does not change the first one verdict', () => {
    const task = commentFinished('s-1')
    const later = { ...newCommentRound({ id: 'c2', now: NOW + 20, text: 'b', sessionId: 's-2' }), viewedAt: NOW + 21, endedAt: NOW + 22, result: 'failed' as const }
    const both: TaskRecord = { ...task, executions: [...task.executions, later] }
    expect(sessionGateOf(both, 's-1').work?.result).toBe('succeeded')
    expect(sessionGateOf(both, 's-2').work?.result).toBe('failed')
  })
})

describe('waitingSessionsOf — the RELATED set, not "sessions with a round here"', () => {
  it('a session bound from the workspace counts with no board round behind it', () => {
    const bound = card({ binds: [{ kind: 'session', sessionId: 's-bound' }] })
    const pending = (id: string | undefined): 'question' | undefined => (id === 's-bound' ? 'question' : undefined)
    // The bell, the demand row and the card's own chip all read this one set.
    expect(waitingSessionsOf(bound, pending)).toEqual([{ sessionId: 's-bound', waitingKind: 'question' }])
  })

  it('a live workspace member counts, and a removed one never does', () => {
    const task = card({ removedSessions: ['s-gone'] })
    const linked = (): readonly string[] => ['s-live', 's-gone']
    const pending = (id: string | undefined): 'question' | undefined =>
      id === 's-live' || id === 's-gone' ? 'question' : undefined
    expect(waitingSessionsOf(task, pending, linked).map(row => row.sessionId)).toEqual(['s-live'])
  })

  it('deduplicates: two rounds naming one conversation wait once', () => {
    const task = card({
      executions: [
        { id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined },
        { id: 'e2', sessionId: 's-1', startedAt: NOW + 1, endedAt: undefined, result: undefined, error: undefined },
      ],
    })
    expect(waitingSessionsOf(task, () => 'question')).toHaveLength(1)
  })

  it('names the NUMBERED run when the conversation has one, and the conversation when it does not', () => {
    const run = runFinished('s-1')
    const pending = (): 'question' => 'question'
    expect(waitingSessionsOf(run, pending)[0]?.executionId).toBe('e1')
    // Never a fabricated index: the old walk passed a comment round's id into
    // the run sequence and the tooltip printed 「第 0 次执行」.
    const commentCard = card({ status: 'running', executions: [newCommentRound({ id: 'c1', now: NOW, text: 'x', sessionId: 's-9' })] })
    expect(waitingSessionsOf(commentCard, pending)[0]).toEqual({ sessionId: 's-9', waitingKind: 'question' })
  })

  it('no signal, no row — a bind alone is not a block', () => {
    const bound = card({ binds: [{ kind: 'session', sessionId: 's-bound' }] })
    expect(waitingSessionsOf(bound, () => undefined)).toEqual([])
  })
})

describe('boardDemandOf — the header line, counting the SAME gate', () => {
  it('an idle board owes nothing', () => {
    expect(boardDemandOf([], () => undefined)).toEqual({ total: 0, waiting: 0, review: 0 })
    expect(boardDemandOf([card()], () => undefined)).toEqual({ total: 0, waiting: 0, review: 0 })
  })

  it('counts a finished unlooked-at card, whatever lane produced it', () => {
    // The plain-run lane first (the only case the old count could see)…
    expect(boardDemandOf([runFinished('s-1')], () => undefined)).toEqual({ total: 1, waiting: 0, review: 1 })
    // …and then the four it could not, which is the whole point.
    expect(boardDemandOf([commentFinished('s-1')], () => undefined)).toEqual({ total: 1, waiting: 0, review: 1 })
  })

  it('stops counting a card the user has looked at', () => {
    expect(boardDemandOf([commentFinished('s-1', 'succeeded', NOW + 3)], () => undefined))
      .toEqual({ total: 0, waiting: 0, review: 0 })
  })

  it('does not count a task still running, nor one that never ran', () => {
    const running = startExecution(card(), NOW + 1, 'e1').task
    expect(boardDemandOf([running], () => undefined)).toEqual({ total: 0, waiting: 0, review: 0 })
  })

  it('counts each suspended conversation once, over the related set', () => {
    const bound = card({ binds: [{ kind: 'session', sessionId: 's-bound' }] })
    const pending = (id: string | undefined): 'approval' | undefined => (id === 's-bound' ? 'approval' : undefined)
    expect(boardDemandOf([bound], pending)).toEqual({ total: 1, waiting: 1, review: 0 })
    expect(boardDemandOf([bound], () => undefined)).toEqual({ total: 0, waiting: 0, review: 0 })
  })

  it('sums the two halves into the headline total', () => {
    const pending = (id: string | undefined): 'approval' | undefined => (id === 's-9' ? 'approval' : undefined)
    const waiting = card({
      id: 'w',
      binds: [{ kind: 'session', sessionId: 's-9' }],
      executions: [{ id: 'e9', sessionId: 's-9', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
    })
    expect(boardDemandOf([commentFinished('s-1'), waiting], pending))
      .toEqual({ total: 2, waiting: 1, review: 1 })
  })

  it('the header number and the card chip can never disagree', () => {
    // The invariant, stated once: for any card, 待审核 counts it IFF the gate
    // says the card owes a decision.
    for (const task of [commentFinished('s-1'), commentFinished('s-1', 'failed'), card({ status: 'review' })]) {
      expect(boardDemandOf([task], () => undefined).review === 1).toBe(gateOf(task).state === 'unseen')
    }
  })
})
