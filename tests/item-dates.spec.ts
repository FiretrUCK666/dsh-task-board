/**
 * THE DATE WRITE: what a writer's three dates become, and what cannot both be true.
 *
 * It had no spec of its own — it was exercised only through `item.create` /
 * `item.update`, which pass **numbers**, so the interesting inputs never reached it:
 * a model sending JSON does not have to send numbers. Measured before this file
 * existed (TZ=+08):
 *
 *   { dueAt: null }          -> -28800000  -> stored as 1970-01-01
 *   { dueAt: '2026-11-05' }  -> parsed as UTC -> one day early
 *
 * `null` is the natural way to say 「no date」, and the host already treated it as
 * 「not filled」 at the parameter gate — so the value went from 「absent」 to 「1970」
 * between two layers that each thought the other had judged it. The read side then
 * reported 「计划日已过两万天」 on a row whose author had cleared the date.
 */
import { describe, expect, it } from 'vitest'
import { DATE_KEYS, itemDateWriteOf } from '../src/core/item-dates.ts'
import type { ItemDateKey } from '../src/core/item.ts'

/** One local calendar day, at an hour that is not midnight. */
const day = (d: number, hour = 4): number => new Date(2026, 10, d, hour, 30).getTime()
/** The local midnight of that same day. */
const midnight = (d: number): number => new Date(2026, 10, d, 0, 0, 0, 0).getTime()

const write = (values: Partial<Record<ItemDateKey, unknown>>, written: readonly ItemDateKey[]) =>
  itemDateWriteOf(values as never, new Set(written))

describe('what a writer\'s value becomes', () => {
  it('snaps a number to the local midnight of the day it names', () => {
    // The unit is a DAY, so 05:30 and 00:00 on the same date must store the same
    // instant — otherwise 「今天到期」 is wrong for part of the day.
    const out = write({ dueAt: day(5) }, ['dueAt'])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.values.dueAt).toBe(midnight(5))
  })

  it('reads `null` as a CLEARING, never as 1970', () => {
    // The defect: `null` passed the `=== undefined` test, then `startOfDay(null)`
    // produced the epoch. A row whose author cleared a date reported 「超期两万天」.
    const out = write({ dueAt: null }, ['dueAt'])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.values.dueAt, 'null became a real instant instead of clearing the date').toBeUndefined()
  })

  it('refuses to invent a day from a string', () => {
    // `new Date('2026-11-05')` is parsed as UTC, so in +08 it lands a day early —
    // the class of bug this project has already paid for once. A string is not an
    // instant; it is refused so the caller sends a number.
    const out = write({ dueAt: '2026-11-05' }, ['dueAt'])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.values.dueAt, 'a date string was coerced into a possibly-wrong instant').toBeUndefined()
  })

  it('writes only the keys it was told to write', () => {
    // An edit that mentions one date must not touch the other two: `item.update`
    // relies on 「absent from `values`」 meaning 「leave it alone」.
    const out = write({ startsAfter: day(1), dueAt: day(2), hardDueAt: day(3) }, ['dueAt'])
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(Object.keys(out.values)).toEqual(['dueAt'])
  })
})

describe('what cannot both be true', () => {
  it('refuses a start date after the plan date, and names the pair', () => {
    const out = write({ startsAfter: day(8), dueAt: day(7) }, ['startsAfter', 'dueAt'])
    expect(out.ok).toBe(false)
    if (out.ok) return
    // The pair, not 「日期有矛盾」 — the reader has three candidates and no next step.
    expect(out.conflict.field).toBe('startsAfter')
    expect(out.conflict.limitField).toBe('dueAt')
  })

  it('refuses a plan date after the deadline', () => {
    const out = write({ dueAt: day(14), hardDueAt: day(10) }, ['dueAt', 'hardDueAt'])
    expect(out.ok).toBe(false)
  })

  it('judges the RESULTING triple, so one new value can create the conflict', () => {
    // The first version judged only the keys the payload mentioned, so moving
    // `startsAfter` past an undisturbed `dueAt` sailed through — exactly the
    // contradiction the check exists to stop.
    const out = write({ startsAfter: day(9), dueAt: day(5) }, ['startsAfter'])
    expect(out.ok, 'a value meeting an existing one was not judged together with it').toBe(false)
  })

  it('accepts a legal set', () => {
    const out = write({ startsAfter: day(1), dueAt: day(5), hardDueAt: day(9) }, [...DATE_KEYS])
    expect(out.ok).toBe(true)
  })
})
