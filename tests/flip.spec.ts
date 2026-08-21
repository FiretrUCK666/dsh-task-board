/**
 * FLIP structure diff: a card animates ONLY when its column or in-column
 * order changed. A pure scroll, hover lift or drag scale never changes the
 * structure, so they can never trigger a FLIP — the "cards vanish / ghost
 * copies / flicker" class of bugs is ruled out at the model level.
 */
import { describe, expect, it } from 'vitest'
import { flipCandidatesOf, type CardStructure } from '../src/client/board/use-flip.ts'

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
