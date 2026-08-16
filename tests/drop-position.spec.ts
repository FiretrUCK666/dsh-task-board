/**
 * Drop-position tests: the insertion-gap algorithm — the pointer's Y
 * against each card's gap centers decides the landing gap, symmetric in
 * both directions and correct for any column size.
 */
import { describe, expect, it } from 'vitest'
import { insertionGapOf } from '../src/client/board/drop-position.ts'

/** Cards at fixed vertical positions (top, 40px tall, 8px gaps). */
function cards(ids: string[], startY = 0): Array<{ id: string; rect: { top: number; height: number } }> {
  return ids.map((id, index) => ({
    id,
    rect: { top: startY + index * 48, height: 40 },
  }))
}

const GAP = 8

describe('insertionGapOf', () => {
  it('lands in the gap above a card when the pointer is in its upper half', () => {
    const list = cards(['a', 'b', 'c'])
    // Dragging 'a' down onto 'b' upper half → insert before b, indicator at
    // the gap center above b (b.top - 4).
    expect(insertionGapOf(list, 48 + 5, 'a', GAP)).toEqual({ beforeId: 'b', top: 48 - 4 })
  })

  it('lands in the gap below a card when the pointer is in its lower half', () => {
    const list = cards(['a', 'b', 'c'])
    // Dragging 'a' onto 'b' lower half → the gap below b = the gap above c.
    expect(insertionGapOf(list, 48 + 35, 'a', GAP)).toEqual({ beforeId: 'c', top: 96 - 4 })
  })

  it('appends at the column tail below the last card — the two-card downward swap', () => {
    const list = cards(['a', 'b'])
    // 'a' dragged onto the lower half of the last card → column tail, with
    // the indicator at the tail gap center (b.bottom + 4).
    expect(insertionGapOf(list, 48 + 30, 'a', GAP)).toEqual({ beforeId: undefined, top: 88 + 4 })
  })

  it('excludes the dragged card itself from the gap scan', () => {
    const list = cards(['a', 'b', 'c'])
    // Pointers over the dragged card's own rect still resolve against the
    // other cards' gaps.
    expect(insertionGapOf(list, 0 + 20, 'a', GAP)).toEqual({ beforeId: 'b', top: 48 - 4 })
    expect(insertionGapOf(list, 48 + 20, 'b', GAP)).toEqual({ beforeId: 'c', top: 96 - 4 })
  })

  it('handles an empty column and a lone dragged card', () => {
    expect(insertionGapOf([], 100, 'ghost', GAP)).toEqual({ beforeId: undefined, top: 0 })
    expect(insertionGapOf(cards(['a']), 100, 'a', GAP)).toEqual({ beforeId: undefined, top: 0 })
  })
})
