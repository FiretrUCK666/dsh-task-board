/**
 * The two attachment doors (src/host/attachment-route.ts): admit bytes into the
 * harness's attachment store, and read a stored reference back out.
 *
 * THE FAKE STORE IS AS STRICT AS THE INSTALLED ONE, on purpose. The real local
 * backend proves a read-back against the reference it was handed —
 * `@deepseek-ai/dsh-attachment-local`'s image read compares media type, byte
 * length, width and height, and its file read compares byte count and digest —
 * so a fake that accepted anything would let THIS route drop a field and stay
 * green while every real picture failed. The strictness below is the contract
 * under test, not scenery: the image lane's most important case here is the one
 * where a reference WITHOUT its size must be answered before the store is ever
 * called, because the store's own answer ("corrupt") would be a true sentence
 * about the wrong thing.
 */
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createAttachmentHandler, type AttachmentRouteDeps } from '../src/host/attachment-route.ts'

/** A response capturing the written status and body (405 ends with no body). */
function fakeRes(): ServerResponse & { state: { status: number; body: string } } {
  const state = { status: 200, body: '' }
  return {
    state,
    writeHead(status: number) { state.status = status },
    end(payload?: string) { state.body = payload ?? '' },
  } as unknown as ServerResponse & { state: { status: number; body: string } }
}

/** A request whose body is the given chunks, in order. */
function fakeReq(method: string, chunks: readonly Buffer[] = []): IncomingMessage {
  return {
    method,
    headers: {},
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  } as unknown as IncomingMessage
}

/** One JSON request body. */
function jsonReq(method: string, body: unknown): IncomingMessage {
  return fakeReq(method, [Buffer.from(JSON.stringify(body), 'utf8')])
}

/** The envelope one handler call answered with, and the status it used. */
async function call(
  deps: AttachmentRouteDeps,
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; body: string; envelope: Record<string, unknown> }> {
  const res = fakeRes()
  const req = body === undefined ? fakeReq(method) : jsonReq(method, body)
  ;(req as { url?: string }).url = path
  await createAttachmentHandler(deps)(req, res)
  // A 405 answers with no body at all (the method is refused before any
  // envelope exists), so an empty body is read as such rather than as JSON.
  const envelope = res.state.body === '' ? {} : JSON.parse(res.state.body) as Record<string, unknown>
  return { status: res.state.status, body: res.state.body, envelope }
}

const READ = '/api/dsh-task-board/attachments/read'
const ADMIT = '/api/dsh-task-board/attachments'

/** A content-addressed object id of the shape the installed backend requires. */
function objectIdOf(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

/** An attachment failure carrying the code the route/reader routes on. */
class FakeAttachmentError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

interface StoredImage {
  mediaType: string
  bytes: number
  width: number
  height: number
  data: Buffer
}

/** The image reference fields the route forwards (the four the store verifies). */
interface ImageRefShape {
  attachmentId: string
  name: string
  bytes: number
  mediaType: string
  width: number
  height: number
  [field: string]: unknown
}

/** The file reference fields (the two the store verifies). */
interface FileRefShape {
  attachmentId: string
  name: string
  bytes: number
  [field: string]: unknown
}

/**
 * A store that behaves like the installed local backend: the same reference
 * checks, the same refusal codes, and a record of what it was handed (so a test
 * can see whether the route forwarded the whole reference or a shortened copy).
 */
function fakeStore(options: {
  images?: Map<string, StoredImage>
  files?: Map<string, readonly Buffer[]>
  imageLimits?: { maxImageBytes?: number; mediaTypes?: readonly string[] }
  savedImage?: (input: { data: Uint8Array; mediaType: string; name?: string }) => Promise<ImageRefShape>
  chunkSize?: number
}) {
  const images = options.images ?? new Map<string, StoredImage>()
  const files = options.files ?? new Map<string, readonly Buffer[]>()
  const reads: { images: ImageRefShape[]; files: FileRefShape[] } = { images: [], files: [] }
  const store = {
    imageLimits: options.imageLimits,
    admitEncodedFile: async (input: { data: string; name?: string }) => {
      const bytes = Buffer.from(input.data, 'base64')
      return { attachmentId: objectIdOf(bytes), name: input.name ?? '', bytes: bytes.length }
    },
    saveImage: async (input: { data: Uint8Array; mediaType: string; name?: string }) => {
      if (options.savedImage !== undefined) return options.savedImage(input)
      throw new FakeAttachmentError('no image lane in this fake', 'ATTACHMENT_WRITE_FAILED')
    },
    readImage: async (ref: ImageRefShape) => {
      reads.images.push(ref)
      if (!/^sha256:[a-f0-9]{64}$/.test(String(ref.attachmentId))) {
        throw new FakeAttachmentError('Attachment reference is invalid.', 'INVALID_ATTACHMENT_REF')
      }
      const stored = images.get(String(ref.attachmentId))
      if (stored === undefined) throw new FakeAttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
      // The installed backend's four comparisons, in its order.
      if (stored.mediaType !== ref.mediaType || stored.data.byteLength !== ref.bytes
        || stored.width !== ref.width || stored.height !== ref.height) {
        throw new FakeAttachmentError('Stored attachment metadata does not match its reference.', 'ATTACHMENT_CORRUPT')
      }
      return { ref, data: new Uint8Array(stored.data) }
    },
    readFileStream: async function* (ref: FileRefShape) {
      reads.files.push(ref)
      const digest = /^sha256:([a-f0-9]{64})$/.exec(String(ref.attachmentId))?.[1]
      if (digest === undefined) throw new FakeAttachmentError('File attachment reference is invalid.', 'INVALID_ATTACHMENT_REF')
      const chunks = files.get(String(ref.attachmentId))
      if (chunks === undefined) throw new FakeAttachmentError('File attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
      const hash = createHash('sha256')
      let bytes = 0
      for (const chunk of chunks) {
        hash.update(chunk)
        bytes += chunk.byteLength
        yield new Uint8Array(chunk)
      }
      if (bytes !== ref.bytes || hash.digest('hex') !== digest) {
        throw new FakeAttachmentError('Stored file attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
      }
    },
  }
  return { store: store as unknown as NonNullable<AttachmentRouteDeps['store']>, reads, images, files }
}

/** One stored image whose reference matches its bytes. */
function storeImage(store: ReturnType<typeof fakeStore>, mediaType: string, width: number, height: number): ImageRefShape {
  const data = Buffer.from(`image-${String(width)}x${String(height)}`)
  const attachmentId = objectIdOf(data)
  store.images.set(attachmentId, { mediaType, bytes: data.byteLength, width, height, data })
  return { attachmentId, name: 'IMG_20261013_012519.jpg', bytes: data.byteLength, mediaType, width, height }
}

/** One stored file whose reference matches its bytes. */
function storeFile(store: ReturnType<typeof fakeStore>, name: string, chunks: readonly Buffer[]): FileRefShape {
  const joined = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
  const attachmentId = objectIdOf(joined)
  store.files.set(attachmentId, chunks)
  return { attachmentId, name, bytes: joined.byteLength }
}

describe('reading a stored attachment back', () => {
  it('hands the store the reference WHOLE and answers with the bytes', async () => {
    const fake = fakeStore({})
    const ref = storeImage(fake, 'image/jpeg', 1600, 1200)
    const outcome = await call({ store: fake.store }, READ, 'POST', { ref })

    expect(outcome.envelope.ok).toBe(true)
    const value = outcome.envelope.value as { name: string; mediaType: string; bytes: number; data: string }
    expect(value.mediaType).toBe('image/jpeg')
    expect(value.data).toBe(fake.images.get(ref.attachmentId)?.data.toString('base64'))
    // 逐字段相等：路由交给库的那一份，就是文档里那一份。少一个字段（原来的 `width ?? 0`）
    // 会让上面那次读回抛 CORRUPT——好端端的图片，报成损坏。
    expect(fake.reads.images).toEqual([ref])
  })

  it('a field the route has never heard of still reaches the store', async () => {
    const fake = fakeStore({})
    const ref = { ...storeImage(fake, 'image/png', 800, 600), originalDimensions: { width: 3200, height: 2400 } }
    const outcome = await call({ store: fake.store }, READ, 'POST', { ref })
    expect(outcome.envelope.ok).toBe(true)
    expect(fake.reads.images).toEqual([ref])
  })

  it('refuses an image reference with no usable size BEFORE calling the store', async () => {
    // 这一份不是「读不出来」，是「它不是一份能读的引用」：读者要听到一句能照做的话
    // （重新拖一次），而不是库的 CORRUPT——那句话是真的，但说的不是这件事。
    for (const partial of [
      { width: undefined, height: undefined },
      { width: 1600, height: undefined },
      { width: undefined, height: 1200 },
      { width: '1600', height: '1200' },
    ]) {
      const fake = fakeStore({})
      const full = storeImage(fake, 'image/jpeg', 1600, 1200)
      const ref: Record<string, unknown> = { ...full, ...partial }
      if (partial.width === undefined) delete ref.width
      if (partial.height === undefined) delete ref.height
      const outcome = await call({ store: fake.store }, READ, 'POST', { ref })
      expect(outcome.envelope.ok, JSON.stringify(partial)).toBe(false)
      expect((outcome.envelope.error as { code: string }).code).toBe('incomplete-ref')
      expect((outcome.envelope.error as { message: string }).message).toContain('重新拖一次')
      expect(fake.reads.images).toEqual([])
    }
  })

  it('the store really would have called that reference corrupt (the fake is the installed check)', async () => {
    // 这条钉的是「假库不比现实宽容」：同一份缺尺寸的引用真到了库里，得到的是 CORRUPT。
    // 上一用例之所以要拦在前面，正是因为这一条成立——不然它就只是在替库说一句废话。
    const fake = fakeStore({})
    const ref = storeImage(fake, 'image/jpeg', 1600, 1200)
    await expect(fake.store.readImage({ ...ref, width: 0, height: 0 })).rejects.toThrow(/metadata does not match/)
    await expect(fake.store.readImage({ ...ref, width: 0, height: 0 })).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('reads a file verbatim, base64-encoded, with the reference it was handed', async () => {
    const fake = fakeStore({})
    const chunks = [Buffer.from('hello '), Buffer.from('world')]
    const ref = storeFile(fake, 'notes.pdf', chunks)
    const outcome = await call({ store: fake.store }, READ, 'POST', { ref })

    expect(outcome.envelope.ok).toBe(true)
    expect(outcome.envelope.value).toEqual({ name: 'notes.pdf', bytes: 11, data: Buffer.concat(chunks).toString('base64') })
    expect(fake.reads.files).toEqual([ref])
  })

  it('answers with the store\'s own words when the read fails', async () => {
    const fake = fakeStore({})
    const ref = { attachmentId: objectIdOf(Buffer.from('gone')), name: 'gone.png', bytes: 4, mediaType: 'image/png', width: 10, height: 10 }
    const outcome = await call({ store: fake.store }, READ, 'POST', { ref })
    expect(outcome.envelope.ok).toBe(false)
    expect(outcome.envelope.error).toMatchObject({ code: 'unreadable' })
    expect((outcome.envelope.error as { message: string }).message).toContain('missing')
  })

  it('refuses a file larger than this route returns', async () => {
    const fake = fakeStore({})
    // 33 MB in the same megabyte, referenced 33 times: the cap is crossed while
    // the route is still streaming, so nothing large is ever concatenated.
    const megabyte = Buffer.alloc(1024 * 1024, 0x61)
    const ref = storeFile(fake, 'huge.bin', Array.from({ length: 33 }, () => megabyte))
    const outcome = await call({ store: fake.store }, READ, 'POST', { ref })
    expect(outcome.envelope).toMatchObject({ ok: false, error: { code: 'oversize' } })
  })

  it('a request that names no stored reference is refused as such', async () => {
    const fake = fakeStore({})
    for (const ref of [undefined, null, 'x', { attachmentId: '', name: 'a', bytes: 1 }, { attachmentId: 'a', bytes: 1 }]) {
      const outcome = await call({ store: fake.store }, READ, 'POST', { ref })
      expect(outcome.envelope).toMatchObject({ ok: false, error: { code: 'bad-ref' } })
    }
  })

  it('a host with no attachment store says so, and never pretends', async () => {
    const outcome = await call({}, READ, 'POST', { ref: { attachmentId: 'a', name: 'a', bytes: 1 } })
    expect(outcome.envelope).toMatchObject({ ok: false, error: { code: 'no-store' } })
  })
})

describe('admitting bytes', () => {
  it('an image comes back with the size a later read-back verifies', async () => {
    // 环回的另一端：上传时元数据是齐的。少了这两个数字，同一个引用下一次就读不回来。
    const fake = fakeStore({
      savedImage: async input => ({
        attachmentId: objectIdOf(Buffer.from(input.data)),
        name: input.name ?? '',
        bytes: input.data.byteLength,
        mediaType: input.mediaType,
        width: 1600,
        height: 1200,
      }),
    })
    const outcome = await call({ store: fake.store }, ADMIT, 'POST', { name: 'IMG.jpg', mediaType: 'image/jpeg', data: Buffer.from('jpg').toString('base64') })
    expect(outcome.envelope).toMatchObject({
      ok: true,
      value: { name: 'IMG.jpg', bytes: 3, mediaType: 'image/jpeg', width: 1600, height: 1200 },
    })
  })

  it('a file comes back as a content-addressed reference and nothing more', async () => {
    const fake = fakeStore({})
    const data = Buffer.from('hello world').toString('base64')
    const outcome = await call({ store: fake.store }, ADMIT, 'POST', { name: 'notes.pdf', data })
    expect(outcome.envelope).toMatchObject({
      ok: true,
      value: { name: 'notes.pdf', bytes: 11, attachmentId: objectIdOf(Buffer.from('hello world')) },
    })
    expect((outcome.envelope.value as { mediaType?: unknown }).mediaType).toBeUndefined()
  })

  it('a payload that is not canonical base64 is refused (never half-decoded)', async () => {
    const fake = fakeStore({})
    // An empty payload never reaches the decoder: it is a request without bytes.
    expect((await call({ store: fake.store }, ADMIT, 'POST', { name: 'a.txt', data: '' })).envelope)
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
    for (const data of ['not base64!', 'QUJD*', '=', 'QQ==QQ==']) {
      const outcome = await call({ store: fake.store }, ADMIT, 'POST', { name: 'a.txt', data })
      expect(outcome.envelope, data).toMatchObject({ ok: false, error: { code: 'bad-bytes' } })
    }
  })

  it('the store\'s own image policy is enforced before it is asked', async () => {
    const fake = fakeStore({ imageLimits: { maxImageBytes: 2, mediaTypes: ['image/png'] } })
    const type = await call({ store: fake.store }, ADMIT, 'POST', { name: 'a.gif', mediaType: 'image/gif', data: 'QUJD' })
    expect(type.envelope).toMatchObject({ ok: false, error: { code: 'image-type' } })
    const size = await call({ store: fake.store }, ADMIT, 'POST', { name: 'a.png', mediaType: 'image/png', data: 'QUJDRA==' })
    expect(size.envelope).toMatchObject({ ok: false, error: { code: 'oversize' } })
  })

  it('a store refusal is reported with the store\'s own message', async () => {
    const fake = fakeStore({ savedImage: async () => { throw new FakeAttachmentError('Declared image type does not match its bytes.', 'IMAGE_TYPE_MISMATCH') } })
    const outcome = await call({ store: fake.store }, ADMIT, 'POST', { name: 'a.png', mediaType: 'image/png', data: 'QUJD' })
    expect(outcome.envelope).toMatchObject({ ok: false, error: { code: 'image-refused', message: 'Declared image type does not match its bytes.' } })
  })

  it('a request without a name or without bytes is a bad request', async () => {
    const fake = fakeStore({})
    for (const body of [{ name: 'a.txt' }, { data: 'QUJD' }, { name: '', data: 'QUJD' }]) {
      const outcome = await call({ store: fake.store }, ADMIT, 'POST', body)
      expect(outcome.envelope).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
  })
})

describe('the route as a whole', () => {
  it('answers GET (and anything else) with 405, store or no store', async () => {
    const fake = fakeStore({})
    expect((await call({ store: fake.store }, ADMIT, 'GET')).status).toBe(405)
    expect((await call({}, READ, 'PUT')).status).toBe(405)
  })
  it('a request body over the cap is answered 413, not 400', async () => {
    // The reader deserves "too big" rather than "broken": the two call for
    // different actions (pick a smaller file vs. try again).
    const fake = fakeStore({})
    const half = Buffer.alloc(21 * 1024 * 1024, 0x20)
    const res = fakeRes()
    const req = fakeReq('POST', [half, half])
    ;(req as { url?: string }).url = ADMIT
    await createAttachmentHandler({ store: fake.store })(req, res)
    expect(res.state.status).toBe(413)
    expect(JSON.parse(res.state.body)).toMatchObject({ ok: false, error: { code: 'oversize' } })
  })

  it('an unparseable body is answered 400', async () => {
    const fake = fakeStore({})
    const res = fakeRes()
    const req = fakeReq('POST', [Buffer.from('{not json')])
    ;(req as { url?: string }).url = ADMIT
    await createAttachmentHandler({ store: fake.store })(req, res)
    expect(res.state.status).toBe(400)
    expect(JSON.parse(res.state.body)).toMatchObject({ ok: false, error: { code: 'malformed' } })
  })
})
