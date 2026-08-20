/**
 * Attachment bridge + browser admission: the host admits base64 images to
 * durable refs (structural repeat + media whitelist), and the browser admits
 * drafts through it. Pins the wire contract both ends share.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  admitImages, createAttachHandler, normalizeWireImage, type AttachImagesRequest, type AttachmentsFace,
} from '../src/host/attachment-route.ts'

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
    expect(outcome.error).toBe('attachments unavailable')
  })
})

describe('createAttachHandler', () => {
  it('answers ok with refs for a valid body', async () => {
    const attachments: AttachmentsFace = { saveImages: async () => [] }
    const handler = createAttachHandler(attachments, async () => ({
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
    const handler = createAttachHandler(undefined)
    const res = makeResponse()
    const req = {
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('{')
      },
    } as never
    await handler(req, res as never)
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything())
  })
})
