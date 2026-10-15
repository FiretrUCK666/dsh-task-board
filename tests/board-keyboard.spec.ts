/**
 * The wiring, not just the maths.
 *
 * `reorderTargetOf` is unit-tested, but the pure function being right says nothing
 * about whether the card ever calls it — and "declared but not passed" is exactly
 * the shape of the overlay regression that shipped this session: a class existed,
 * a gate checked it existed, and the call site never applied it. So this reads the
 * two files and asserts the chain end to end: the card offers the chord, the board
 * hands it the handler, and the handler ends at the one move funnel.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const card = readFileSync(fileURLToPath(new URL('../src/client/board/TaskCard.tsx', import.meta.url)), 'utf8')
const board = readFileSync(fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url)), 'utf8')

describe('the keyboard reorder is wired end to end', () => {
  it('the card offers Alt with the arrows, and only those', () => {
    expect(card, 'the card has no reorder prop').toContain('onReorder?: (direction: -1 | 1) => void')
    expect(card, 'the card never destructures it').toMatch(/\bonReorder,/)
    expect(card, 'the card does not read the chord').toMatch(/onReorder !== undefined && \(event\.key === 'ArrowUp' \|\| event\.key === 'ArrowDown'\)/)
    // The modifier guard is what keeps it from stealing plain arrow navigation.
    expect(card, 'the chord does not require Alt').toMatch(/event\.altKey && !event\.ctrlKey && !event\.metaKey/)
  })

  it('the board passes the handler, and the handler ends at the one move funnel', () => {
    expect(board, 'the board never passes onReorder to a card').toContain('onReorder={direction => { reorderCard(task, direction) }}')
    expect(board, 'reorderCard does not ask the shared gap module').toContain('reorderTargetOf(others, at, direction)')
    // Both roads end at the same call: a keyboard move cannot take a path a drag
    // could not refuse, and the landing rule stays in one place.
    expect(board, 'reorderCard does not go through moveTask').toMatch(/controller\.moveTask\(task\.id, task\.status, target\.beforeId\)/)
    expect(board, 'stepCard stopped going through the drop funnel').toMatch(/applyCardDrop\(task, next\)/)
  })

  it('the spoken hint names both chords, or a reader never learns them', () => {
    const locales = readFileSync(fileURLToPath(new URL('../src/client/locales.ts', import.meta.url)), 'utf8')
    const hints = [...locales.matchAll(/'card\.keyboardLabel': '([^']*)'/g)].map(m => m[1])
    expect(hints.length, 'the keyboard hint is missing from one language').toBe(2)
    for (const hint of hints) {
      expect(hint, `a hint does not name the column chord: ${hint}`).toContain('[')
      expect(hint, `a hint does not name the reorder chord: ${hint}`).toMatch(/Alt/)
    }
  })
})
