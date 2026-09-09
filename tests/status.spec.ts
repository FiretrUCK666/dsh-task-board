/**
 * Board WIP derivations (client/board/status.ts): the ONE full-ledger count
 * and the ONE sentence question shared by the status line, the compact tabs
 * and the column headers — three surfaces, one truth, zero drift.
 */
import { describe, expect, it } from 'vitest'
import { wipCountsOf, wipSentenceKeyOf } from '../src/client/board/status.ts'

describe('wipCountsOf (single full-ledger pass)', () => {
  it('counts running vs. in-play (running + review)', () => {
    expect(wipCountsOf(['backlog', 'todo', 'running', 'running', 'review', 'done'])).toEqual({
      running: 2,
      inPlay: 3,
    })
  })

  it('reads empty as zero (unlimited boards stay quiet)', () => {
    expect(wipCountsOf([])).toEqual({ running: 0, inPlay: 0 })
  })
})

describe('wipSentenceKeyOf (ONE sentence, running wins)', () => {
  it('names the running over-limit first when both fire', () => {
    expect(wipSentenceKeyOf({ running: 5, inPlay: 9 }, { running: 3, global: 4 })).toEqual({
      key: 'board.wipRunningOver',
      params: { n: '5', limit: '3' },
    })
  })

  it('falls through to the global sentence', () => {
    expect(wipSentenceKeyOf({ running: 1, inPlay: 9 }, { running: 3, global: 4 })).toEqual({
      key: 'board.wipOver',
      params: { n: '9', limit: '4' },
    })
  })

  it('stays silent inside the ceilings or without them', () => {
    expect(wipSentenceKeyOf({ running: 1, inPlay: 2 }, { running: 3, global: 4 })).toBeUndefined()
    expect(wipSentenceKeyOf({ running: 9, inPlay: 9 }, undefined)).toBeUndefined()
    expect(wipSentenceKeyOf({ running: 9, inPlay: 9 }, {})).toBeUndefined()
  })

  it('a masked wip scopes the question per column (no second function)', () => {
    const counts = { running: 5, inPlay: 5 }
    expect(wipSentenceKeyOf(counts, { running: 3 })?.key).toBe('board.wipRunningOver')
    expect(wipSentenceKeyOf(counts, { global: 4 })?.key).toBe('board.wipOver')
    expect(wipSentenceKeyOf({ running: 1, inPlay: 9 }, { running: 3 })?.key).toBeUndefined()
  })
})
