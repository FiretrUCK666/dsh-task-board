/**
 * Drag-geometry contract: the insertion-gap algorithm — the pointer's Y
 * against each card's gap centers decides the landing gap, symmetric in
 * both directions and correct for any column size — the scrolled indicator
 * math (content coordinates, so the bar sits where the gap is even
 * mid-scroll), and the edge-scroll stepper (the drag auto-scroll grammar).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { indicatorTopOf, insertionGapOf } from '../src/client/board/drop-position.ts'
import { edgeScrollStep } from '../src/client/board/drag-autoscroll.ts'

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

describe('indicatorTopOf (scrolled content coordinates)', () => {
  it('adds the container scroll offset — the bar never drifts mid-scroll', () => {
    // Container's viewport top 200, scrolled 120 down; a gap at viewport 260
    // sits at content 260 - 200 + 120 = 180.
    expect(indicatorTopOf(260, 200, 120, 1000)).toBe(180)
    expect(indicatorTopOf(260, 200, 0, 1000)).toBe(60)
  })

  it('clamps to the content box (never above the top or below the bottom)', () => {
    expect(indicatorTopOf(5, 200, 0, 1000)).toBe(0)
    expect(indicatorTopOf(5000, 200, 0, 1000)).toBe(1000)
  })

  it('keeps the tail bar inside a container whose scroll height ends at the last row bottom (session-list grammar)', () => {
    // The session list's tail slot: last row bottom (content) + gap/2, with
    // the container's scroll height = last row bottom + the bottom strip
    // (without the strip the bar clamps to the very edge and is clipped by
    // overflow: hidden — the reported "no bar after the last row" bug). The
    // strip is 14px in the real list; the math contract holds for any strip
    // >= the bar height. Use the 22px board grammar for the example.
    const lastRowBottom = 88
    const strip = 22
    const contentHeight = lastRowBottom + strip
    const tail = indicatorTopOf(200 + lastRowBottom + 4, 200, 0, contentHeight)
    expect(tail).toBe(lastRowBottom + 4)
    expect(tail + 4).toBeLessThanOrEqual(contentHeight)
  })
})

describe('drop decision legibility (wiring)', () => {
  it('the column dragover names its outcome through the platform cursor', () => {
    // A refusing column must show not-allowed BEFORE release: a designed
    // refusal (busy card, rerun lane) with no advance signal reads as
    // 「拖了也插不进」. Set only on the card path — the external branch keeps
    // the sidebar's own effectAllowed (an incompatible value would block it).
    const board = readFileSync(
      fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url)), 'utf8')
    expect(board).toContain("event.dataTransfer.dropEffect = insertable ? 'move' : 'none'")
  })
})
describe('edgeScrollStep (drag edge auto-scroll)', () => {
  it('returns 0 outside the edge zones and outside the box', () => {
    expect(edgeScrollStep(100, 0, 600, 48, 14)).toBe(0)
    expect(edgeScrollStep(599 - 48 - 1, 0, 599)).toBe(0)
    expect(edgeScrollStep(-10, 0, 600)).toBe(0)
    expect(edgeScrollStep(700, 0, 600)).toBe(0)
  })

  it('scrolls down near the bottom edge, scaling with proximity', () => {
    expect(edgeScrollStep(600, 0, 600, 48, 14)).toBe(14)
    expect(edgeScrollStep(576, 0, 600, 48, 14)).toBe(7)
    expect(edgeScrollStep(553, 0, 600, 48, 14)).toBe(1)
  })

  it('scrolls up near the top edge, negative (up)', () => {
    expect(edgeScrollStep(0, 0, 600, 48, 14)).toBe(-14)
    expect(edgeScrollStep(24, 0, 600, 48, 14)).toBe(-7)
    expect(edgeScrollStep(47, 0, 600, 48, 14)).toBe(-1)
  })
})
