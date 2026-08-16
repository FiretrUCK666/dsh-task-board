/**
 * Drop-position tests: the half-split insertion anchor — the pointer's Y
 * against each card's midpoint decides before/after, symmetric in both
 * directions and correct for any column size.
 */
import { describe, expect, it } from 'vitest'
import { insertionAnchorOf } from '../src/client/board/drop-position.ts'

/** Cards at fixed vertical positions (top, 40px tall, 8px gaps). */
function cards(ids: string[], startY = 0): Array<{ id: string; rect: { top: number; height: number } }> {
  return ids.map((id, index) => ({
    id,
    rect: { top: startY + index * 48, height: 40 },
  }))
}

describe('insertionAnchorOf', () => {
  it('inserts before a card when the pointer is in its upper half (drag down works)', () => {
    const list = cards(['a', 'b', 'c'])
    // Dragging 'a' down onto 'b' upper half → insert before b.
    expect(insertionAnchorOf(list, 48 + 5, 'a')).toEqual({ beforeId: 'b' })
  })

  it('inserts after a card when the pointer is in its lower half', () => {
    const list = cards(['a', 'b', 'c'])
    // Dragging 'a' down onto 'b' lower half → the anchor becomes 'c'
    // (insert before c = after b).
    expect(insertionAnchorOf(list, 48 + 35, 'a')).toEqual({ beforeId: 'c' })
  })

  it('appends at the tail below every midpoint — the two-card downward swap', () => {
    const list = cards(['a', 'b'])
    // 'a' dragged onto the lower half of the last card → column tail.
    expect(insertionAnchorOf(list, 48 + 30, 'a')).toEqual({ beforeId: undefined })
  })

  it('excludes the dragged card itself from the scan', () => {
    const list = cards(['a', 'b', 'c'])
    // Pointers over the dragged card's own rect still resolve correctly.
    expect(insertionAnchorOf(list, 0 + 20, 'a')).toEqual({ beforeId: 'b' })
    expect(insertionAnchorOf(list, 48 + 20, 'b')).toEqual({ beforeId: 'c' })
  })

  it('handles an empty column', () => {
    expect(insertionAnchorOf([], 100, 'ghost')).toEqual({ beforeId: undefined })
  })
})
