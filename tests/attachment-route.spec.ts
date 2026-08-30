/**
 * Attachment bridge + browser admission: the host admits base64 images to
 * durable refs (structural repeat + media whitelist), and the browser admits
 * drafts through it. Pins the wire contract both ends share.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  admitImages, createAttachHandler, normalizeWireImage, type AttachImagesRequest, type AttachmentsFace,
} from '../src/host/attachment-route.ts'
import { admitDraftImages, type DraftImage } from '../src/client/board/attach.ts'

function makeResponse(): {
  writeHead: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
} {
  return { writeHead: vi.fn(), end: vi.fn() }
}

describe('normalizeWireImage', () => {
  it('accepts a valid base64 png', () => {
    const input = normalizeWireImage({ mediaType: 'image/png', data: Buffer.from('hello').toString('base64') })
    expect(input?.mediaType).toBe('image/png')
    expect(input?.data).toBeInstanceOf(Uint8Array)
    expect(input?.name).toBeUndefined()
  })
  it('rejects unknown media types and empty data', () => {
    expect(normalizeWireImage({ mediaType: 'image/bmp', data: 'x' })).toBeUndefined()
    expect(normalizeWireImage({ mediaType: 'image/png', data: '' })).toBeUndefined()
    expect(normalizeWireImage(null)).toBeUndefined()
  })
})

describe('admitImages', () => {
  it('returns durable refs when the service saves them', async () => {
    const attachments: AttachmentsFace = {
      saveImages: async inputs => inputs.map((input, index) => ({
        attachmentId: `att-${index}`,
        mediaType: (input as { mediaType: string }).mediaType,
        bytes: 4, width: 10, height: 20,
      })),
    }
    const request: AttachImagesRequest = { images: [{ mediaType: 'image/png', data: Buffer.from('hi').toString('base64') }] }
    const outcome = await admitImages(attachments, request)
    expect(outcome.error).toBeUndefined()
    expect(outcome.refs[0].attachmentId).toBe('att-0')
  })
  it('degrades when the service is absent', async () => {
    const outcome = await admitImages(undefined, { images: [{ mediaType: 'image/png', data: 'a' }] })
    expect(outcome.refs).toEqual([])
    expect(outcome.error).toContain('图片服务')
  })
})

describe('createAttachHandler', () => {
  it('answers ok with refs for a valid body', async () => {
    const attachments: AttachmentsFace = { saveImages: async () => [] }
    const handler = createAttachHandler(() => attachments, async () => ({
      refs: [{ attachmentId: 'a-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }],
    }))
    const res = makeResponse()
    const req = {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ images: [{ mediaType: 'image/png', data: 'a' }] }))
      },
    } as never
    await handler(req, res as never)
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.anything())
    const body = res.end.mock.calls[0][0] as string
    const parsed = JSON.parse(body)
    expect(parsed.ok).toBe(true)
    expect(parsed.refs[0].attachmentId).toBe('a-1')
  })
  it('returns 400 on a malformed body', async () => {
    const handler = createAttachHandler(() => undefined)
    const res = makeResponse()
    const req = {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('{')
      },
    } as never
    await handler(req, res as never)
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything())
  })

  it('returns 413 (not 400) when the body exceeds the cap — the oversized picture is told apart from a broken request', async () => {
    // A tiny injected cap so the test need not send 128 MB.
    const handler = createAttachHandler(() => undefined, async () => ({ refs: [] }), 8)
    const res = makeResponse()
    const req = {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ images: [{ mediaType: 'image/png', data: 'AAAAAAAA' }] }))
      },
    } as never
    await handler(req, res as never)
    expect(res.writeHead).toHaveBeenCalledWith(413, expect.anything())
    const parsed = JSON.parse(res.end.mock.calls[0][0] as string)
    expect(parsed.error.code).toBe('too_large')
  })

  it('resolves the attachments service per request (mount after register still serves)', async () => {
    // The route is registered before the attachments service exists; the
    // handler must answer through the service present AT REQUEST time.
    let current: AttachmentsFace | undefined = undefined
    const handler = createAttachHandler(() => current)
    current = {
      saveImages: async () => [
        { attachmentId: 'att-x', mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
      ],
    }
    const res = makeResponse()
    const req = {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from(JSON.stringify({ images: [{ mediaType: 'image/png', data: 'aGk=' }] }))
      },
    } as never
    await handler(req, res as never)
    const parsed = JSON.parse(res.end.mock.calls[0][0] as string)
    expect(parsed.ok).toBe(true)
    expect(parsed.refs[0].attachmentId).toBe('att-x')
  })
})

describe('admitDraftImages (browser admission surfaces the reason)', () => {
  const draft: DraftImage = { id: 'i1', data: 'aGk=', mediaType: 'image/png', name: 'a.png' }

  it('returns refs on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, refs: [{ attachmentId: 'att-1', mediaType: 'image/png' }] }),
    })))
    const outcome = await admitDraftImages([draft])
    expect(outcome.error).toBeUndefined()
    expect(outcome.refs[0].attachmentId).toBe('att-1')
    vi.unstubAllGlobals()
  })

  it('surfaces the bridge error message (never a silent empty list)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      statusText: '',
      json: async () => ({ ok: false, error: { message: '图片过大，超出上传限制' } }),
    })))
    const outcome = await admitDraftImages([draft])
    expect(outcome.refs).toEqual([])
    expect(outcome.error).toBe('图片过大，超出上传限制')
    vi.unstubAllGlobals()
  })

  it('surfaces a network failure with a reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const outcome = await admitDraftImages([draft])
    expect(outcome.refs).toEqual([])
    expect(outcome.error).toBe('offline')
    vi.unstubAllGlobals()
  })
})
