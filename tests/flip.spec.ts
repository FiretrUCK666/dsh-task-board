/**
 * FLIP structure diff: a card animates ONLY when its column or in-column
 * order changed. A pure scroll, hover lift or drag scale never changes the
 * structure, so they can never trigger a FLIP — the "cards vanish / ghost
 * copies / flicker" class of bugs is ruled out at the model level.
 *
 * The second half is the cost contract: the hook runs after every commit, and
 * the cheap half of it (the structure decision) is what decides whether a
 * layout read may follow. `flipDecisionOf` is that decision, stated as a value
 * so it can be tested without a DOM.
 */
import { describe, expect, it } from 'vitest'
import { flipCandidatesOf, flipDecisionOf, type CardStructure } from '../src/client/board/use-flip.ts'

function structure(entries: Array<[string, CardStructure]>): Map<string, CardStructure> {
  return new Map(entries)
}

describe('flipCandidatesOf', () => {
  it('flags a card whose in-column order changed (same column)', () => {
    const before = structure([['a', { status: 'backlog', index: 0 }], ['b', { status: 'backlog', index: 1 }]])
    const after = structure([['b', { status: 'backlog', index: 0 }], ['a', { status: 'backlog', index: 1 }]])
    expect(flipCandidatesOf(before, after).sort()).toEqual(['a', 'b'])
  })

  it('flags a card that moved to another column', () => {
    const before = structure([['a', { status: 'todo', index: 0 }]])
    const after = structure([['a', { status: 'done', index: 0 }]])
    expect(flipCandidatesOf(before, after)).toEqual(['a'])
  })

  it('a pure geometry change (scroll/hover) changes nothing — no FLIP', () => {
    const before = structure([['a', { status: 'todo', index: 0 }], ['b', { status: 'todo', index: 1 }]])
    const after = structure([['a', { status: 'todo', index: 0 }], ['b', { status: 'todo', index: 1 }]])
    expect(flipCandidatesOf(before, after)).toEqual([])
  })

  it('new cards and unknown cards never animate (no old rect to play from)', () => {
    const before = structure([['a', { status: 'todo', index: 0 }]])
    const after = structure([['a', { status: 'todo', index: 0 }], ['c', { status: 'todo', index: 1 }]])
    expect(flipCandidatesOf(before, after)).toEqual([])
  })
})

describe('flipDecisionOf (the cheap half)', () => {
  const signature = 'todo:a,b|done:c'

  it('the first render measures once, and plays nothing', () => {
    // The memory has to start somewhere; on the first commit no card can have
    // moved, so there is nothing to animate.
    expect(flipDecisionOf(undefined, signature, false)).toEqual({ kind: 'measure', animate: false })
  })

  it('an unchanged board skips — no layout read at all', () => {
    // THE FIX, as one assertion: this is the branch a busy board takes on every
    // controller notification, and it must not reach a rect.
    expect(flipDecisionOf(signature, signature, false)).toEqual({ kind: 'skip' })
  })

  it('a moved card measures and plays', () => {
    expect(flipDecisionOf(signature, 'todo:b,a|done:c', false)).toEqual({ kind: 'measure', animate: true })
  })

  it('a drag in flight measures but does not play (the post-drop settle plays)', () => {
    expect(flipDecisionOf(signature, 'todo:b,a|done:c', true)).toEqual({ kind: 'measure', animate: false })
  })

  it('a reveal edge does not resurrect a move that happened while covered', () => {
    // `quiet` is what a reveal sets: the baseline is rebased, nothing flies.
    expect(flipDecisionOf(signature, 'todo:c|done:a,b', true)).toEqual({ kind: 'measure', animate: false })
  })

  it('a reveal with an unchanged structure still skips', () => {
    // The remembered position is a CONTENT position, so a reveal cannot stale it:
    // the viewport is reconstructed from the live frame at animation time.
    expect(flipDecisionOf(signature, signature, true)).toEqual({ kind: 'skip' })
  })
})
