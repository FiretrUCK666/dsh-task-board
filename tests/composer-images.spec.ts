/**
 * Attachment busy truth (composer-images busyKindOf + AttachmentStrip
 * attachBusyLabel): the busy line names the IN-FLIGHT intake, never the
 * settled ledger.
 */
import { describe, expect, it } from 'vitest'
import { busyKindOf } from '../src/client/board/composer-images.ts'
import { attachBusyLabel } from '../src/client/board/AttachmentStrip.tsx'

describe('busyKindOf', () => {
  it('names the lane in flight, mixed when both, undefined when idle', () => {
    expect(busyKindOf(0, 0)).toBeUndefined()
    expect(busyKindOf(2, 0)).toBe('image')
    expect(busyKindOf(0, 1)).toBe('file')
    expect(busyKindOf(1, 1)).toBe('mixed')
  })
})

describe('attachBusyLabel', () => {
  it('each kind gets its honest line (no two share a sentence)', () => {
    const image = attachBusyLabel('image')
    const file = attachBusyLabel('file')
    const mixed = attachBusyLabel('mixed')
    const fallback = attachBusyLabel(undefined)
    expect(new Set([image, file, mixed]).size).toBe(3)
    expect(fallback).toBe(image)
  })
})
