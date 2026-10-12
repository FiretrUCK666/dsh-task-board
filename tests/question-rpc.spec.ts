/**
 * Pending question wire model (legacy live stream): frame normalization, the
 * per-rpcId projection over the live frames, answer-batch assembly and the
 * plan-review grammar. Pins the wire contract so the interaction card
 * answers through the native respond path with exactly the shape the host
 * validates (pre-0.1.5 hosts; on 0.1.5 the board mirrors read-only instead).
 */
import { describe, expect, it } from 'vitest'
import {
  answerBatchOf, approveLabelOf, declineLabelOf, isDetailOnlyPlanItem, normalizeWireQuestion, pendingQuestionOf,
  planApproveAnswers, planDeclineAnswers, planQuestionOf, reduceQuestionFrames, wireQuestionsOf,
  type WireQuestion,
} from '../src/core/question-rpc.ts'

function wireQuestion(overrides: Partial<WireQuestion> = {}): WireQuestion {
  return {
    rpcId: 'rpc-1',
    sessionId: 's1',
    questions: [{ id: 'q1', question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] }],
    isPlanReview: false,
    ...overrides,
  }
}

describe('normalizeWireQuestion', () => {
  it('reads the wire item fields and drops malformed ones', () => {
    expect(normalizeWireQuestion({ id: 'a', question: 'A', header: 'H', detail: 'D', multiSelect: true })).toEqual(
      { id: 'a', question: 'A', header: 'H', detail: 'D', multiSelect: true },
    )
    expect(normalizeWireQuestion({ question: '' })).toBeUndefined()
    expect(normalizeWireQuestion({ question: 'Q', options: [{ label: 1 }, { label: 'ok', description: 'd' }] })?.options)
      .toEqual([{ label: 'ok', description: 'd' }])
  })

  it('recognises a plan-review intent with its approve label', () => {
    const item = normalizeWireQuestion({ id: 'p', question: 'P', detail: 'plan', intent: { kind: 'plan-review', approve: '批准' } })
    expect(item?.intent).toEqual({ kind: 'plan-review', approve: '批准' })
  })

  it('accepts a detail-carried plan without question text (the plan IS the detail)', () => {
    // Mirrors the official planReviewOf narrowing: question text is NOT
    // required there. Anything else text-less stays dropped.
    expect(isDetailOnlyPlanItem({ question: '', detail: 'plan body', intent: { kind: 'plan-review', approve: '好' } })).toBe(true)
    expect(isDetailOnlyPlanItem({ question: '', detail: '  ', intent: { kind: 'plan-review', approve: '好' } })).toBe(false)
    expect(isDetailOnlyPlanItem({ question: '', detail: 'x' })).toBe(false)
    expect(isDetailOnlyPlanItem({ question: '' })).toBe(false)
    const item = normalizeWireQuestion({ question: '', detail: 'plan body', intent: { kind: 'plan-review', approve: '好' } })
    expect(item?.detail).toBe('plan body')
    expect(item?.question).toBe('')
    expect(wireQuestionsOf([{ question: '', detail: 'plan body', intent: { kind: 'plan-review', approve: '好' } }])).toHaveLength(1)
  })
})

describe('wireQuestionsOf', () => {
  it('returns undefined for an empty or all-malformed list', () => {
    expect(wireQuestionsOf([])).toBeUndefined()
    expect(wireQuestionsOf([{ question: '' }])).toBeUndefined()
    expect(wireQuestionsOf(undefined)).toBeUndefined()
  })
})

describe('reduceQuestionFrames', () => {
  const requested = { type: 'question/requested' as const, rpcId: 'rpc-1', sessionId: 's1', questions: [{ id: 'q1', question: 'Q' }] }

  it('registers a requested frame and removes on resolved', () => {
    let pending = reduceQuestionFrames(new Map(), requested)
    expect(pending.get('rpc-1')?.sessionId).toBe('s1')
    pending = reduceQuestionFrames(pending, { type: 'question/resolved', questionRpcId: 'rpc-1' })
    expect(pending.has('rpc-1')).toBe(false)
  })

  it('is a no-op (same map) for a malformed frame, an unknown resolve, or an identical replay', () => {
    const empty = new Map<string, WireQuestion>()
    expect(reduceQuestionFrames(empty, { ...requested, questions: 'junk' })).toBe(empty)
    const one = reduceQuestionFrames(empty, requested)
    expect(reduceQuestionFrames(one, { type: 'question/resolved', questionRpcId: 'unknown' })).toBe(one)
    expect(reduceQuestionFrames(one, requested)).toBe(one)
  })

  it('keeps the newest frame for a reused rpcId (reconnect replay) and marks plan review', () => {
    const one = reduceQuestionFrames(new Map(), requested)
    const next = reduceQuestionFrames(one, {
      type: 'question/requested', rpcId: 'rpc-1', sessionId: 's1',
      questions: [{ id: 'q1', question: 'Q2', intent: { kind: 'plan-review', approve: 'ok' } }],
    })
    expect(one).not.toBe(next)
    expect(next.get('rpc-1')?.questions[0].question).toBe('Q2')
    expect(next.get('rpc-1')?.isPlanReview).toBe(true)
  })
})

describe('pendingQuestionOf', () => {
  it('returns the newest winning question for one session (any rpcId)', () => {
    const pending = reduceQuestionFrames(reduceQuestionFrames(new Map(), {
      type: 'question/requested', rpcId: 'a', sessionId: 's1', questions: [{ id: 'q', question: '旧' }],
    }), {
      type: 'question/requested', rpcId: 'b', sessionId: 's1', questions: [{ id: 'q', question: '新' }],
    })
    expect(pendingQuestionOf(pending, 's1')?.rpcId).toBe('b')
    expect(pendingQuestionOf(pending, 'other')).toBeUndefined()
    expect(pendingQuestionOf(pending, undefined)).toBeUndefined()
  })
})

describe('answerBatchOf', () => {
  const batch = wireQuestion({
    questions: [
      { id: 'a', question: 'A', options: [{ label: 'x' }] },
      { id: 'b', question: 'B', multiSelect: true, options: [{ label: 'y' }, { label: 'z' }] },
      { id: 'c', question: 'C' },
    ],
  })

  it('emits one entry per question in frame order (skip = empty selected)', () => {
    const answers = answerBatchOf(batch, [
      { selected: ['x'] },
      { selected: ['y', 'z'] },
      { selected: [], custom: '手写' },
    ])
    expect(answers).toEqual([
      { id: 'a', selected: ['x'] },
      { id: 'b', selected: ['y', 'z'] },
      { id: 'c', selected: [], custom: '手写' },
    ])
  })

  it('keeps custom alongside selections only for multi-select questions', () => {
    const answers = answerBatchOf(wireQuestion(), [{ selected: ['A'], custom: '备注' }])
    expect(answers).toEqual([{ id: 'q1', selected: ['A'] }])
  })

  it('carries custom for a single-select answer without selections', () => {
    const answers = answerBatchOf(wireQuestion(), [{ selected: [], custom: ' 自由答案 ' }])
    expect(answers).toEqual([{ id: 'q1', selected: [], custom: '自由答案' }])
  })
})

describe('plan review grammar', () => {
  const plan = wireQuestion({
    isPlanReview: true,
    questions: [{
      id: 'plan', question: '这个方案可以吗？', detail: '# 计划',
      options: [{ label: '批准' }, { label: '修改' }],
      intent: { kind: 'plan-review', approve: '批准' },
    }],
  })
  const item = planQuestionOf(plan)!

  it('names the labels from the intent, never from the option order', () => {
    expect(approveLabelOf(item)).toBe('批准')
    expect(declineLabelOf(item)).toBe('修改')
    // The approve label is the ASKER's own option, so a plan whose alternative is
    // listed first still approves with the right label — reading `options[0]`
    // answered the opposite option, silently, and that is the defect this pins.
    const reordered = planQuestionOf(wireQuestion({
      isPlanReview: true,
      questions: [{ ...plan.questions[0], options: [{ label: '修改' }, { label: '批准' }] }],
    }))!
    expect(planApproveAnswers(reordered)).toEqual([{ id: 'plan', selected: ['批准'] }])
    expect(planDeclineAnswers(reordered)).toEqual([{ id: 'plan', selected: ['修改'] }])
  })

  it('has no approve label without the intent (the generic flow owns that question)', () => {
    // No intent = not a plan review: there is nothing to infer the label from, and
    // guessing one approves whatever the asker happened to list first.
    expect(approveLabelOf({ id: 'x', question: 'Q', options: [{ label: 'A' }, { label: 'B' }] })).toBeUndefined()
    expect(declineLabelOf({ id: 'x', question: 'Q', options: [{ label: 'A' }] })).toBeUndefined()
    expect(approveLabelOf(undefined)).toBeUndefined()
  })

  it('decline answers with the asker own other option, and is absent when it offered none', () => {
    expect(planApproveAnswers(item)).toEqual([{ id: 'plan', selected: ['批准'] }])
    expect(planDeclineAnswers(item)).toEqual([{ id: 'plan', selected: ['修改'] }])
    const single = planQuestionOf(wireQuestion({
      isPlanReview: true,
      questions: [{ ...plan.questions[0], options: [{ label: '批准' }] }],
    }))!
    // No other option = no refusal to send. An empty `selected` is a SKIP of the
    // whole question, which is a different answer from "refuse this plan".
    expect(planDeclineAnswers(single)).toBeUndefined()
  })

  it('decline with an amendment is a custom-only revise-with-feedback answer', () => {
    expect(planDeclineAnswers(item, '  请补充预算  '))
      .toEqual([{ id: 'plan', selected: [], custom: '请补充预算' }])
  })
})
