/**
 * Reading a value that came from outside (src/core/values.ts): the three
 * structural readers every surface used to keep its own copy of.
 *
 * These are one-liners, and that is exactly why they were copied: nothing
 * failed when one copy drifted from another — a copy that stopped rejecting
 * the empty string would have changed what a document was allowed to say, and
 * no functional test would have gone red.
 */
import { describe, expect, it } from 'vitest'
import { isRecord, messageOf, stringOf } from '../src/core/values.ts'

describe('stringOf', () => {
  it('reads a non-empty string, and says nothing about anything else', () => {
    expect(stringOf('a')).toBe('a')
    expect(stringOf('')).toBeUndefined()
    expect(stringOf(undefined)).toBeUndefined()
    expect(stringOf(null)).toBeUndefined()
    expect(stringOf(12)).toBeUndefined()
    expect(stringOf({})).toBeUndefined()
  })
})

describe('messageOf', () => {
  it('reads an error message, and never throws', () => {
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf('plain')).toBe('plain')
    expect(messageOf(42)).toBe('42')
    expect(messageOf(undefined)).toBe('undefined')
  })
})

describe('isRecord', () => {
  it('is true for a plain object and false for the rest', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
    expect(isRecord('a')).toBe(false)
    expect(isRecord(1)).toBe(false)
  })
})
