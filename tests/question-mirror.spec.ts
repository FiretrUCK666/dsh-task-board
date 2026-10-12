/**
 * Official pending-interaction mirror: the question read model.
 *
 * The waterfall is a claim chain (first answer wins, never a broadcast), so
 * the board never registers its own listener. This spec pins the read-only
 * projection instead: per-session newest-wins + the waiting-kind derivation,
 * all pure over the official session-status snapshot. The ITEM grammar is the
 * wire model's, so its own cases live in `question-rpc.spec.ts` — this file
 * pins only what the snapshot layer adds.
 */
import { describe, expect, it } from 'vitest'
import {
  awaitingOf,
  isMirrorQuestionKind,
  isPlanReviewBatch,
  mirrorQuestionOf,
  mirrorWaitingOf,
  pendingMirrorOf,
} from '../src/core/question-mirror.ts'

describe('isPlanReviewBatch', () => {
  it('reads the plan-review intent off the items, whatever the carrier kind says', () => {
    const tagged = [{ id: 'plan', question: '', detail: '# 计划', intent: { kind: 'plan-review' as const, approve: '好' } }]
    expect(isPlanReviewBatch('question', tagged)).toBe(true)
    expect(isPlanReviewBatch('plan-review', [{ id: 'q', question: '继续？' }])).toBe(true)
    expect(isPlanReviewBatch('question', [{ id: 'q', question: '继续？' }])).toBe(false)
  })
})

describe('isMirrorQuestionKind', () => {
  it('renders questions, never approvals', () => {
    expect(isMirrorQuestionKind('question')).toBe(true)
    expect(isMirrorQuestionKind('plan-review')).toBe(true)
    expect(isMirrorQuestionKind('approval')).toBe(false)
    expect(isMirrorQuestionKind(undefined)).toBe(false)
  })
})

describe('mirrorQuestionOf', () => {
  const batch = (overrides = {}) => ({
    key: 'question:1', kind: 'question', sessionId: 's-1',
    questions: [{ id: 'q-1', question: '继续？' }],
    ...overrides,
  })

  it('normalizes one renderable batch', () => {
    expect(mirrorQuestionOf('s-1', 'question:1', batch()))?.toMatchObject({
      key: 'question:1', sessionId: 's-1', isPlanReview: false,
    })
  })

  it('carries the intent through, so the card can answer with the asker own label', () => {
    /* The approve label is the ONLY thing that may answer a plan review, and the
       official host publishes it on the question item. A projection that drops it
       leaves the answering card with nothing but option ORDER to guess from — and
       a plan whose asker listed its alternative first gets approved the wrong way
       round, silently. */
    const mirror = mirrorQuestionOf('s-1', 'question:9', batch({
      questions: [{
        id: 'plan-review', question: '', detail: '# 计划',
        options: [{ label: 'Keep planning' }, { label: 'Approve' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }],
    }))
    expect(mirror?.isPlanReview).toBe(true)
    expect(mirror?.questions[0]?.intent).toEqual({ kind: 'plan-review', approve: 'Approve' })
  })

  it('drops approval carriers, foreign sessions and empty batches', () => {
    expect(mirrorQuestionOf('s-1', 'approval:1', {
      key: 'approval:1', kind: 'approval', sessionId: 's-1',
    })).toBeUndefined()
    expect(mirrorQuestionOf('s-1', 'question:1', batch({ sessionId: 's-2' }))).toBeUndefined()
    expect(mirrorQuestionOf('s-1', 'question:1', batch({ questions: [] }))).toBeUndefined()
    expect(mirrorQuestionOf('s-1', 'question:1', undefined)).toBeUndefined()
  })

  it('falls back to the map key when the carrier has none', () => {
    expect(mirrorQuestionOf('s-1', 'fallback', batch({ key: undefined }))?.key).toBe('fallback')
  })

  it('flags plan-review batches by kind', () => {
    expect(mirrorQuestionOf('s-1', 'question:2', batch({ kind: 'plan-review' }))?.isPlanReview).toBe(true)
  })
})

describe('pendingMirrorOf', () => {
  it('returns the newest renderable batch for the session', () => {
    const snapshot = new Map([
      ['question:1', { key: 'question:1', kind: 'question', sessionId: 's-1', questions: [{ id: 'a', question: '一' }] }],
      ['approval:1', { key: 'approval:1', kind: 'approval', sessionId: 's-1' }],
      ['question:2', { key: 'question:2', kind: 'question', sessionId: 's-1', questions: [{ id: 'b', question: '二' }] }],
    ])
    expect(pendingMirrorOf(snapshot, 's-1')?.key).toBe('question:2')
    expect(pendingMirrorOf(snapshot, 's-9')).toBeUndefined()
    expect(pendingMirrorOf(undefined, 's-1')).toBeUndefined()
    expect(pendingMirrorOf(snapshot, undefined)).toBeUndefined()
  })
})

describe('awaitingOf', () => {
  const content = { key: 'question:1', sessionId: 's-1', questions: [], isPlanReview: false }
  it('prefers parsed content, shells a proven wait, stays silent otherwise', () => {
    expect(awaitingOf(content, 'plan-review')).toEqual({ type: 'content', question: content })
    expect(awaitingOf(undefined, 'plan-review')).toEqual({ type: 'shell', waitingKind: 'plan-review' })
    expect(awaitingOf(undefined, 'question')).toEqual({ type: 'shell', waitingKind: 'question' })
    // Approvals belong to the native surface — never a board card.
    expect(awaitingOf(undefined, 'approval')).toBeUndefined()
    expect(awaitingOf(undefined, undefined)).toBeUndefined()
  })
})

describe('mirrorWaitingOf', () => {
  it('derives the waiting kind with plan-review winning', () => {
    const snapshot = new Map([
      ['approval:1', { key: 'approval:1', kind: 'approval', sessionId: 's-1' }],
      ['question:1', { key: 'question:1', kind: 'question', sessionId: 's-1', questions: [] }],
    ])
    expect(mirrorWaitingOf(snapshot, 's-1')).toBe('question')
    const review = new Map([
      ['question:1', { key: 'question:1', kind: 'question', sessionId: 's-1', questions: [] }],
      ['question:2', { key: 'question:2', kind: 'plan-review', sessionId: 's-1', questions: [] }],
    ])
    expect(mirrorWaitingOf(review, 's-1')).toBe('plan-review')
    expect(mirrorWaitingOf(snapshot, 's-9')).toBeUndefined()
  })

  it('reads approval carriers as approval', () => {
    const snapshot = new Map([
      ['approval:1', { key: 'approval:1', kind: 'approval', sessionId: 's-1' }],
    ])
    expect(mirrorWaitingOf(snapshot, 's-1')).toBe('approval')
  })
})
