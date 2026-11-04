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
import { isRecord, messageOf, sameValue, stringOf } from '../src/core/values.ts'

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


/**
 * `sameValue` 存在的理由是它要替掉 `JSON.stringify(a) === JSON.stringify(b)`，
 * 而串比较有两个真实缺陷。两条都钉在这里——它们是这个函数唯一的立身之本。
 */
describe('sameValue compares structure, not serialisation', () => {
  it('is not fooled by key order', () => {
    // A JSON string comparison says these differ; the data is identical, and
    // treating it as a change re-renders a whole panel for nothing.
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(sameValue({ outer: { x: 1, y: 2 } }, { outer: { y: 2, x: 1 } })).toBe(true)
  })

  it('sees a key that is present-but-undefined as a real difference', () => {
    // `JSON.stringify({a:1,b:undefined})` and `JSON.stringify({a:1})` are the SAME
    // string, so a string comparison silently misses "this field is gone" and the
    // surface keeps showing the stale value.
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(false)
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false)
  })

  it('treats null, missing and undefined as three different answers', () => {
    expect(sameValue({ g: null }, { g: undefined })).toBe(false)
    expect(sameValue({ g: null }, {})).toBe(false)
    expect(sameValue({ g: undefined }, {})).toBe(false)
  })

  it('compares arrays element-wise, including length', () => {
    expect(sameValue([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false)
    expect(sameValue([1, [2, { a: 3 }]], [1, [2, { a: 3 }]])).toBe(true)
    expect(sameValue([1, [2, { a: 3 }]], [1, [2, { a: 4 }]])).toBe(false)
    // An array is not the object that happens to look like it.
    expect(sameValue([], {})).toBe(false)
  })

  it('handles primitives and identity', () => {
    expect(sameValue(1, 1)).toBe(true)
    expect(sameValue('a', 'a')).toBe(true)
    expect(sameValue(null, null)).toBe(true)
    expect(sameValue(1, '1')).toBe(false)
    expect(sameValue(null, undefined)).toBe(false)
    const shared = { a: 1 }
    expect(sameValue(shared, shared)).toBe(true)
  })
})
