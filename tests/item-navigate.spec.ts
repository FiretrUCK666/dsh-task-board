/**
 * The checklist's addressing grammar (src/core/item-navigate.ts): how a short
 * number is SPOKEN, and where a jump should land.
 *
 * The first half of this file is the contract that ten places used to keep
 * their own copy of: a short number is said out loud (`#12`, `# 12`), so
 * every reader has to strip the same way. Six of those ten copies forgot the
 * `.trim()`, so `# 12` was found by `item.restore` and missed by
 * `item.update` — the same row, two answers, no error anywhere.
 */
import { describe, expect, it } from 'vitest'
import { planItemNavigation, refOf } from '../src/core/item-navigate.ts'
import type { ItemRecord } from '../src/core/item.ts'

/** One row, on the list page, with the given number. */
function row(ref: number, extra: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: `i-${ref}`,
    ref,
    title: `第 ${ref} 条`,
    body: '',
    notes: '',
    steps: [],
    status: 'todo',
    priority: 'normal',
    tags: [],
    origin: { source: 'human', at: 0 },
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  } as ItemRecord
}

describe('refOf — one way to read a short number', () => {
  it('strips the hash and the spaces around it, in every spelling', () => {
    expect(refOf('#12')).toBe('12')
    expect(refOf('# 12')).toBe('12')
    expect(refOf('12')).toBe('12')
    expect(refOf('  12  ')).toBe('12')
    expect(refOf(' # 12 ')).toBe('12')
  })

  it('takes a number as readily as a string', () => {
    expect(refOf(12)).toBe('12')
  })

  it('says nothing about nothing', () => {
    expect(refOf(undefined)).toBe('')
    expect(refOf(null)).toBe('')
    expect(refOf('')).toBe('')
  })

  it('leaves a uuid alone (it is an id, not a short number)', () => {
    expect(refOf('i-1')).toBe('i-1')
  })
})

describe('planItemNavigation', () => {
  it('refuses a jump that names nothing', () => {
    expect(planItemNavigation({ items: [] })).toEqual({ kind: 'refused', why: 'nothingAsked' })
  })

  it('answers the page from the row when only the row was named', () => {
    expect(planItemNavigation({ of: 7, items: [row(7)] })).toEqual({ kind: 'go', page: 'list', ref: 7 })
  })

  it('refuses a row the document does not hold', () => {
    expect(planItemNavigation({ of: 9, items: [row(7)] })).toEqual({ kind: 'refused', why: 'noSuchItem' })
  })

  it('takes the reader at their word when they named a page', () => {
    expect(planItemNavigation({ page: 'schedule', of: 7, items: [row(7)] })).toEqual({ kind: 'go', page: 'schedule', ref: 7 })
  })
})
