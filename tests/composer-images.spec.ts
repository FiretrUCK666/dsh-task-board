/**
 * Attachment busy truth (composer-images busyKindOf + AttachmentStrip
 * attachBusyLabel): the busy line names the IN-FLIGHT intake, never the
 * settled ledger. Comment-draft envelope: text + images survive unmount,
 * staged file names come back as a re-add notice (bytes unrecoverable).
 */
import { describe, expect, it } from 'vitest'
import { busyKindOf, decodeCommentDraft, encodeCommentDraft, pickedHasFiles } from '../src/client/board/composer-images.ts'
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

describe('comment draft envelope', () => {
  const image = { id: 'a', name: 'p.png', data: 'ZATA', mediaType: 'image/png' as const }
  const file = { id: 'f', receiptId: 'r', name: 'doc.pdf', bytes: 10 }

  it('round-trips text + images + file names; empty drafts clear', () => {
    const { value, imagesDropped } = encodeCommentDraft('hi', [image], [file])
    expect(imagesDropped).toBe(false)
    expect(decodeCommentDraft(value)).toEqual({
      text: 'hi',
      images: [{ id: expect.any(String), name: 'p.png', data: 'ZATA', mediaType: 'image/png' }],
      fileNames: ['doc.pdf'],
    })
    expect(encodeCommentDraft('', [], []).value).toBe('')
  })

  it('reads legacy raw text and corrupt slots as text-or-empty (never throws)', () => {
    expect(decodeCommentDraft('plain words')).toMatchObject({ text: 'plain words', images: [], fileNames: [] })
    expect(decodeCommentDraft('{oops')).toMatchObject({ text: '{oops', images: [], fileNames: [] })
    expect(decodeCommentDraft(undefined)).toMatchObject({ text: '', images: [], fileNames: [] })
  })

  it('oversized images stay memory-only and say so (the map is never nuked)', () => {
    const big = { ...image, data: 'x'.repeat(3_000_000) }
    const { value, imagesDropped } = encodeCommentDraft('hi', [big], [])
    expect(imagesDropped).toBe(true)
    // Text still persists (only the images are dropped, never the words).
    expect(decodeCommentDraft(value).text).toBe('hi')
    expect(decodeCommentDraft(value).images).toEqual([])
  })

  it('pickedHasFiles spots non-images (re-adding clears the lost-file notice)', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' })
    const pdf = new File(['x'], 'b.pdf', { type: 'application/pdf' })
    expect(pickedHasFiles([png])).toBe(false)
    expect(pickedHasFiles([png, pdf])).toBe(true)
  })
})
