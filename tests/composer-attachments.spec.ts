/**
 * The composer attachment ledger (src/client/board/composer-attachments.ts):
 * one lane for every surface that can attach a file. Covers the busy-line
 * naming, the draft envelope (v2 refs, v1 leftovers re-admitted on restore, raw
 * legacy text, corrupt slots), the intake routing helpers, and the door those
 * refs leave through (src/client/index.ts's attachment bridge: the read-back
 * request, the sentence a failed read produces, and what that failure does to
 * the cache).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachBusyLabel, busyKindOf, decodeCommentDraft, encodeCommentDraft, pickedHasFiles, rejectMessage,
} from '../src/client/board/composer-attachments.ts'
import { createAttachmentBridge } from '../src/client/index.ts'
import type { ApiFace } from '../src/client/platform.ts'
import type { AttachmentRef } from '../src/core/attachment.ts'

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
  // The picture carries its intrinsic size, as every admitted image does: a
  // draft that comes back without it hands the store a reference it cannot
  // verify, and the reader's own picture is refused as corrupt.
  const attachment = { id: 'a', attachmentId: 'att-1', name: 'p.png', bytes: 4, mediaType: 'image/png', width: 1600, height: 1200 }
  const file = { id: 'f', attachmentId: 'att-2', name: 'doc.pdf', bytes: 10 }

  it('round-trips text + refs; empty drafts clear', () => {
    const value = encodeCommentDraft('hi', [attachment, file])
    expect(decodeCommentDraft(value)).toEqual({
      text: 'hi',
      attachments: [
        { id: expect.any(String), attachmentId: 'att-1', name: 'p.png', bytes: 4, mediaType: 'image/png', width: 1600, height: 1200 },
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

/**
 * The door every admitted reference leaves through (src/client/index.ts's
 * `createAttachmentBridge`): admit into the store, read the reference back, and
 * materialize the official prompt parts.
 *
 * Pinned here rather than left to the browser because the two facts that broke
 * it are both invisible in a type: WHAT the read request carries (the reference
 * whole — the store verifies the bytes against it, so a field left behind is an
 * attachment the reader cannot send) and WHAT the reader is told when the read
 * fails (the store's own code and sentence, not a generic sentence that fits
 * every failure).
 */
describe('the attachment door (admit, read back, send)', () => {
  const IMAGE: AttachmentRef = {
    attachmentId: 'att-img',
    name: 'IMG_20261013_012519.jpg',
    bytes: 4,
    mediaType: 'image/jpeg',
    width: 1600,
    height: 1200,
  }

  interface RecordedCall {
    url: string
    body: Record<string, unknown>
  }

  /** A fetch stub answering one scripted envelope per call, recording each request. */
  function stubFetch(answers: readonly unknown[]): RecordedCall[] {
    const calls: RecordedCall[] = []
    let at = 0
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      const answer = answers[Math.min(at, answers.length - 1)]
      at += 1
      if (answer === undefined) throw new Error('no answer scripted')
      return { ok: true, json: async () => answer }
    })
    return calls
  }

  /** The two wire calls the send needs, both recorded. */
  function stubApi(): { api: ApiFace; uploads: Array<Record<string, unknown>>; prompts: Array<Record<string, unknown>> } {
    const uploads: Array<Record<string, unknown>> = []
    const prompts: Array<Record<string, unknown>> = []
    const api = {
      fileUploads: {
        upload: async (request: Record<string, unknown>) => {
          uploads.push(request)
          return { result: { ok: true as const, value: { receiptId: 'receipt-1' } } }
        },
      },
      sessions: {
        prompt: async (request: Record<string, unknown>) => {
          prompts.push(request)
          return { result: { ok: true as const, value: { accepted: true } } }
        },
      },
    }
    return { api: api as unknown as ApiFace, uploads, prompts }
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it('the read request carries the document\'s reference FIELD FOR FIELD', async () => {
    const calls = stubFetch([{ ok: true, value: { data: 'QUJD', mediaType: 'image/jpeg' } }])
    const { api, prompts } = stubApi()
    const outcome = await createAttachmentBridge(api).sendComment('s-1', '看这张', 'queue', [IMAGE])

    expect(outcome).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('api/dsh-task-board/attachments/read')
    // 逐字段相等：不是「有几个字段恰好一样」，而是这一份 ref 原样过去了——
    // 尺寸少了，官方那次读回就会拿字节去对一份不完整的引用，然后把好好的图片报成损坏。
    expect(calls[0]?.body).toEqual({ ref: IMAGE })
    expect(prompts[0]?.content).toEqual([{ type: 'text', text: '看这张' }, { type: 'image', mediaType: 'image/jpeg', data: 'QUJD', name: IMAGE.name }])
  })

  it('a field this bundle has never heard of rides along too', async () => {
    // 官方给图片 ref 长的字段不止今天这些。这一条钉的是判据本身：读回请求不带字段表，
    // 所以官方下次补一个字段时，这里一个字都不用改。
    const calls = stubFetch([{ ok: true, value: { data: 'QUJD', mediaType: 'image/jpeg' } }])
    const { api } = stubApi()
    const exotic = { ...IMAGE, originalDimensions: { width: 3200, height: 2400 } }
    await createAttachmentBridge(api).sendComment('s-1', '', 'queue', [exotic])
    expect(calls[0]?.body).toEqual({ ref: exotic })
  })

  it('a failed read tells the reader the HOST\'s reason, code and all', async () => {
    const message = '这一份附件是旧版本上传的，缺它的尺寸信息——重新拖一次就能发'
    stubFetch([{ ok: false, error: { code: 'incomplete-ref', message } }])
    const { api } = stubApi()
    const outcome = await createAttachmentBridge(api).sendComment('s-1', '看这张', 'queue', [IMAGE])
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error).toContain(message)
      expect(outcome.error).toContain('incomplete-ref')
    }
  })

  it('the file lane says it the same way (one sentence, both lanes)', async () => {
    stubFetch([{ ok: false, error: { code: 'unreadable', message: 'Stored attachment object is missing.' } }])
    const { api } = stubApi()
    const outcome = await createAttachmentBridge(api).sendComment('s-1', '', 'queue', [
      { attachmentId: 'att-file', name: 'notes.pdf', bytes: 12 },
    ])
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('Stored attachment object is missing.')
  })

  it('a host that never answered is not reported as a store verdict', async () => {
    // 路由没了、body 太大、socket 断了——三种都没有「库说的话」，而把任何一种写成
    // 库的结论，就是替一个没开口的人编一句解释。
    vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }))
    const { api } = stubApi()
    const outcome = await createAttachmentBridge(api).sendComment('s-1', '', 'queue', [IMAGE])
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('no-answer')
  })

  it('a failed read is not remembered; a successful one is shared', async () => {
    // 失败不进缓存：否则一次失手会把这个附件在整页的生命期里钉成「读不回来」，
    // 而用户再点一次发送时，复用的是一个已经过期的答案。
    const failing = stubFetch([{ ok: false, error: { code: 'unreadable', message: 'temporarily gone' } }])
    const failingBridge = createAttachmentBridge(stubApi().api)
    await failingBridge.sendComment('s-1', '', 'queue', [IMAGE])
    await failingBridge.sendComment('s-1', '', 'queue', [IMAGE])
    expect(failing).toHaveLength(2)

    // 成功的那一次仍然只读一遍：一条消息里同一个附件出现两次，不该读两遍。
    const reading = stubFetch([{ ok: true, value: { data: 'QUJD', mediaType: 'image/jpeg' } }])
    const bridge = createAttachmentBridge(stubApi().api)
    await bridge.sendComment('s-1', '', 'queue', [IMAGE, IMAGE])
    expect(reading).toHaveLength(1)
  })

  it('a legacy document row with its own bytes never touches the store', async () => {
    // 老形状（记录里自带 base64）不算引用：它没有 attachmentId 可读，也不该被读。
    const calls = stubFetch([{ ok: true, value: { data: 'QUJD' } }])
    const { api } = stubApi()
    const outcome = await createAttachmentBridge(api).sendComment('s-1', '', 'queue', [
      { name: 'old.png', bytes: 4, mediaType: 'image/png', data: 'QUJD' },
    ])
    expect(outcome).toEqual({ ok: true })
    expect(calls).toHaveLength(0)
  })

  it('a row with neither source refuses by name instead of reading nothing', async () => {
    const calls = stubFetch([{ ok: true, value: { data: 'QUJD' } }])
    const { api } = stubApi()
    const outcome = await createAttachmentBridge(api).sendComment('s-1', '', 'queue', [{ name: 'ghost.png', bytes: 4, mediaType: 'image/png' }])
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toContain('no-source')
    expect(calls).toHaveLength(0)
  })
})
