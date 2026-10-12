/**
 * The composer attachment ledger (src/client/board/composer-attachments.ts):
 * one lane for every surface that can attach a file. Covers the busy-line
 * naming, the draft envelope (v2 refs, v1 leftovers re-admitted on restore, raw
 * legacy text, corrupt slots), and the intake routing helpers.
 */
import { describe, expect, it } from 'vitest'
import {
  busyKindOf, decodeCommentDraft, encodeCommentDraft, pickedHasFiles, rejectMessage,
} from '../src/client/board/composer-attachments.ts'
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
  it('names the lane in flight (an unknown kind falls back to the image line)', () => {
    const lines = new Set([
      attachBusyLabel(undefined),
      attachBusyLabel('image'),
      attachBusyLabel('file'),
      attachBusyLabel('mixed'),
    ])
    // The image line is the fallback, so it is shared with `undefined`; the
    // other two say something the ledger could not (file / both lanes).
    expect(lines.size).toBe(3)
    expect(attachBusyLabel(undefined)).toBe(attachBusyLabel('image'))
    expect(attachBusyLabel('file')).not.toBe(attachBusyLabel('image'))
    expect(attachBusyLabel('mixed')).not.toBe(attachBusyLabel('file'))
  })
})

describe('comment draft envelope', () => {
  const attachment = { id: 'a', attachmentId: 'att-1', name: 'p.png', bytes: 4, mediaType: 'image/png' }
  const file = { id: 'f', attachmentId: 'att-2', name: 'doc.pdf', bytes: 10 }

  it('round-trips text + refs; empty drafts clear', () => {
    const value = encodeCommentDraft('hi', [attachment, file])
    expect(decodeCommentDraft(value)).toEqual({
      text: 'hi',
      attachments: [
        { id: expect.any(String), attachmentId: 'att-1', name: 'p.png', bytes: 4, mediaType: 'image/png' },
        { id: expect.any(String), attachmentId: 'att-2', name: 'doc.pdf', bytes: 10 },
      ],
      legacyImages: [],
    })
    expect(encodeCommentDraft('', [])).toBe('')
  })

  it('reads the v1 envelope (pictures as bytes) and hands them back for re-admission', () => {
    const v1 = JSON.stringify({ v: 1, text: '旧草稿', images: [{ name: 'old.png', data: 'QUJD', mediaType: 'image/png' }], fileNames: ['gone.pdf'] })
    const restored = decodeCommentDraft(v1)
    expect(restored.text).toBe('旧草稿')
    expect(restored.attachments).toEqual([])
    expect(restored.legacyImages).toEqual([{ name: 'old.png', data: 'QUJD', mediaType: 'image/png' }])
  })

  it('reads legacy raw text and corrupt slots as text-or-empty (never throws)', () => {
    expect(decodeCommentDraft('plain words')).toMatchObject({ text: 'plain words', attachments: [], legacyImages: [] })
    expect(decodeCommentDraft('{oops')).toMatchObject({ text: '{oops', attachments: [], legacyImages: [] })
    expect(decodeCommentDraft(undefined)).toMatchObject({ text: '', attachments: [], legacyImages: [] })
  })

  it('drops unusable ref rows instead of failing the whole draft', () => {
    const dirty = JSON.stringify({
      v: 2,
      text: 'hi',
      attachments: [null, { attachmentId: '', name: 'x', bytes: 1 }, { attachmentId: 'att-9', name: 'ok.txt', bytes: 2 }, { attachmentId: 'att-8' }],
    })
    expect(decodeCommentDraft(dirty).attachments).toEqual([
      { id: expect.any(String), attachmentId: 'att-9', name: 'ok.txt', bytes: 2 },
    ])
  })

  it('pickedHasFiles spots non-images (re-adding clears the lost-file notice)', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' })
    const pdf = new File(['x'], 'b.pdf', { type: 'application/pdf' })
    expect(pickedHasFiles([png])).toBe(false)
    expect(pickedHasFiles([png, pdf])).toBe(true)
  })
})

describe('rejectMessage', () => {
  it('every reason names the file (and the cap where one applies)', () => {
    expect(rejectMessage('type', 'a.bmp')).toContain('a.bmp')
    expect(rejectMessage('size', 'big.png')).toContain('big.png')
    expect(rejectMessage('decode', 'odd.heic')).toContain('odd.heic')
    expect(rejectMessage('count', 'extra.png', 3)).toContain('3')
  })
})
