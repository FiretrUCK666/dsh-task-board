/**
 * Official pending-interaction mirror: the 0.1.5 question read model.
 *
 * The waterfall is a claim chain (first answer wins, never a broadcast), so
 * the board never registers its own listener. This spec pins the read-only
 * projection instead: normalize + per-session newest-wins + waiting-kind
 * derivation, all pure over the official `pendingInteractions` snapshot.
 */
import { describe, expect, it } from 'vitest'
import {
  awaitingOf,
  isMirrorQuestionKind,
  mirrorQuestionOf,
  mirrorQuestionsOf,
  mirrorWaitingOf,
  normalizeMirrorQuestion,
  pendingMirrorOf,
} from '../src/core/question-mirror.ts'

describe('normalizeMirrorQuestion', () => {
  it('keeps the full item shape and trims malformed rows', () => {
    expect(normalizeMirrorQuestion({
      id: 'q-1', question: '继续？', detail: 'plan body', header: 'h',
      options: [{ label: '好', description: 'd' }, { label: '否' }],
      multiSelect: true,
    })).toEqual({
      id: 'q-1', question: '继续？', detail: 'plan body', header: 'h',
      options: [{ label: '好', description: 'd' }, { label: '否' }],
      multiSelect: true,
    })
    expect(normalizeMirrorQuestion({ question: '' })).toBeUndefined()
    expect(normalizeMirrorQuestion({ options: [] })).toBeUndefined()
    expect(normalizeMirrorQuestion(null)).toBeUndefined()
  })

  it('falls back to the question text as the id', () => {
    expect(normalizeMirrorQuestion({ question: '继续？' })?.id).toBe('继续？')
  })

  it('accepts a detail-carried plan without question text (official planReviewOf needs none)', () => {
    const item = normalizeMirrorQuestion({
      question: '', detail: '# 计划正文', intent: { kind: 'plan-review', approve: '好' },
    })
    expect(item?.detail).toBe('# 计划正文')
    expect(item?.question).toBe('')
    // Anything else text-less stays dropped.
    expect(normalizeMirrorQuestion({ question: '', detail: 'x' })).toBeUndefined()
    expect(mirrorQuestionsOf([{ question: '', detail: '# 计划正文', intent: { kind: 'plan-review', approve: '好' } }])).toHaveLength(1)
  })
})

describe('mirrorQuestionsOf', () => {
  it('returns undefined when nothing is usable', () => {
    expect(mirrorQuestionsOf(undefined)).toBeUndefined()
    expect(mirrorQuestionsOf([{ question: '' }])).toBeUndefined()
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
