/**
 * The session-state chip grammar (`session-chip.ts`) — the one mapping every
 * session surface renders: the detail's run rows and linked rows, the review
 * page's state row, the linked panel's state row.
 *
 * The file exists for ONE claim, and it is the claim this spec pins: **a row's
 * word must say who is working.** `sessionActiveOf` collapses `own ∨ descendant`
 * into "working", which is right for a light and wrong for a word — a main agent
 * that has stopped and is only waiting for the subagents it dispatched read
 * 进行中 on every row, so the reader could not see that the agent they were
 * talking to was idle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resultChipKind, sessionStateChip, waitingKeyOf } from '../src/client/board/session-chip.ts'

/** The dictionary the chip reads is chosen by the document language. */
function useLanguage(lang: string): void {
  vi.stubGlobal('document', { documentElement: { lang } })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('sessionStateChip', () => {
  it('names the stopped agent instead of calling it 进行中 (zh)', () => {
    useLanguage('zh')
    expect(sessionStateChip('running', undefined, 'detail.result.succeeded', 'detail.result.cancelled'))
      .toMatchObject({ kind: 'warn', label: '进行中', spinner: true })
    const delegating = sessionStateChip('delegating', undefined, 'detail.result.succeeded', 'detail.result.cancelled')
    expect(delegating.label).toBe('等子 Agent')
    // NO SPINNER. A spinner says "something is turning HERE", and that is exactly
    // what this state denies. The word is the only honest carrier, and the title
    // carries the rest of the sentence.
    expect(delegating.spinner).toBeUndefined()
    expect(delegating.title).toBeTruthy()
    expect(delegating.kind, 'still live work — the same warn family as running').toBe('warn')
  })

  it('the english mirror says the same thing', () => {
    useLanguage('en')
    expect(sessionStateChip('delegating', undefined, 'detail.result.succeeded', 'detail.result.cancelled').label)
      .toBe('Waiting on subagents')
  })

  it('waiting still outranks every live word, and a settled row still reports its outcome', () => {
    useLanguage('zh')
    expect(sessionStateChip('waiting', 'question', 'detail.result.succeeded', 'detail.result.cancelled').label)
      .toBe('提问')
    expect(sessionStateChip('succeeded', undefined, 'detail.result.succeeded', 'detail.result.cancelled').kind)
      .toBe('success')
    expect(sessionStateChip('failed', undefined, 'detail.result.succeeded', 'detail.result.cancelled').label)
      .toBe('失败')
    // The idle pair is the caller's words, never a second vocabulary here: a
    // linked row passes 未运行, a run row passes 已取消.
    expect(sessionStateChip('cancelled', undefined, 'detail.result.succeeded', 'detail.result.cancelled').label)
      .toBe('已取消')
  })

  it('the waiting kind → word table is closed, and the result colour is one place', () => {
    useLanguage('zh')
    expect(waitingKeyOf('approval')).toBe('waiting.approval')
    expect(waitingKeyOf('plan-review')).toBe('waiting.plan-review')
    expect(waitingKeyOf('question')).toBe('waiting.question')
    expect(resultChipKind('failed')).toBe('error')
    expect(resultChipKind('succeeded')).toBe('success')
    expect(resultChipKind(undefined)).toBe('muted')
  })
})
