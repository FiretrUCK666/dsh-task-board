/**
 * The reader's calendar day (src/core/local-day.ts): one instant, one local
 * day key.
 *
 * The key is LOCAL on purpose: the reader's calendar is the local one, so a
 * row due today is due today on the machine they are sitting at. A key built
 * from `toISOString()` is a UTC day, and it puts every row after the evening
 * cutoff — or anywhere west of Greenwich — on the wrong day.
 */
import { describe, expect, it } from 'vitest'
import { localDayKey } from '../src/core/local-day.ts'

describe('localDayKey', () => {
  it('reads the LOCAL calendar day, not the UTC one', () => {
    // Built from local components, so this holds in any timezone: a UTC-based
    // key would answer a different day wherever the offset is not zero.
    const at = new Date(2024, 5, 15, 23, 30).getTime()
    expect(localDayKey(at)).toBe('2024-06-15')
  })

  it('pads the month and the day to two places', () => {
    const at = new Date(2024, 0, 5, 12, 0).getTime()
    expect(localDayKey(at)).toBe('2024-01-05')
  })

  it('says the same thing for the same day, whatever the hour', () => {
    const morning = new Date(2024, 2, 9, 0, 5).getTime()
    const evening = new Date(2024, 2, 9, 23, 55).getTime()
    expect(localDayKey(morning)).toBe(localDayKey(evening))
  })
})
