/**
 * Pending question wire model: frame normalization, the per-rpcId projection
 * over the mux frames, answer-batch assembly and the plan-review grammar.
 * Pins the wire contract so the interaction card answers through the native
 * respond path with exactly the shape the host validates.
 */
import { describe, expect, it } from 'vitest'
import {
  answerBatchOf, approveLabelOf, declineLabelOf, normalizeWireQuestion, pendingQuestionOf,
  planDecisionAnswers, planQuestionOf, reduceQuestionFrames, wireQuestionsOf,
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

  it('names the approve and decline labels from the intent', () => {
    expect(approveLabelOf(item)).toBe('批准')
    expect(declineLabelOf(item)).toBe('修改')
  })

  it('approve selects the approve label; decline selects the other label', () => {
    expect(planDecisionAnswers(item, 'approve', '')).toEqual([{ id: 'plan', selected: ['批准'] }])
    expect(planDecisionAnswers(item, 'decline', '')).toEqual([{ id: 'plan', selected: ['修改'] }])
  })

  it('decline with an amendment is a custom-only revise-with-feedback answer', () => {
    expect(planDecisionAnswers(item, 'decline', '  请补充预算  '))
      .toEqual([{ id: 'plan', selected: [], custom: '请补充预算' }])
  })
})
