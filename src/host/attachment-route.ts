/**
 * Attachment routes: the plugin's two doors to the harness's own attachment
 * store (`ctx.attachments`).
 *
 * POST /api/<ns>/attachments       → {ok:true, value: AttachmentRef}
 * POST /api/<ns>/attachments/read  → {ok:true, value:{name, mediaType?, bytes, data}}
 *
 * WHY THESE DOORS EXIST AT ALL. The official `fileUploads/upload` face is
 * per-SESSION (a receipt is minted for one Agent), so it cannot serve a
 * checklist row — which owns no session — and it hands back a receipt rather
 * than the durable reference a document needs to keep. The durable store itself
 * (`ctx.attachments`) has no session in its interface: it speaks in
 * content-addressed ids, which is exactly what a synced document should carry.
 * So the browser admits bytes here, the document stores the ref, and every
 * sender materializes the official prompt parts from it later.
 *
 * The bytes live where the harness already keeps them (the same store the
 * native composer uploads into); this plugin creates no directory, no second
 * copy, and no second wire shape. A host without the service keeps every other
 * feature and hides the attach affordance with a reason.
 *
 * @module dsh-task-board/host/attachment-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { json, readJsonBodyDetailed, type RouteEnvelope } from './http-json.ts'
import type { AttachmentRef } from '../core/attachment.ts'

/** How much of a request body this route accepts (base64 expands by 4/3). */
const MAX_BODY_BYTES = 40 * 1024 * 1024

/** How much of one stored attachment a read may return. */
const MAX_READ_BYTES = 32 * 1024 * 1024

/** The durable file reference the harness hands back (structural). */
interface FileRefLike {
  attachmentId: string
  name: string
  bytes: number
}

/**
 * The durable image reference the harness hands back (structural) — a MIRROR of
 * the official declaration, field for field.
 *
 * It is written out in full rather than extending {@link FileRefLike}, because
 * the two official references are not the same shape with additions: an image
 * reference makes its display name OPTIONAL (the bytes are addressed by digest,
 * the name is decoration) while a file reference requires one (the name is part
 * of the object's path). A mirror is only useful if it says what the harness
 * says — `scripts/verify-host-contracts.mjs` reads this declaration out of the
 * source and reddens the moment the two drift apart, in either direction.
 */
interface ImageRefLike {
  attachmentId: string
  /** Present when the image was submitted with a name — optional, as the harness declares it. */
  name?: string
  bytes: number
  mediaType: string
  width: number
  height: number
  /** Present only when normalization reduced the image (carried, never read here). */
  originalDimensions?: { width: number; height: number }
}

/**
 * The attachment store, read BY NAME and structurally: this plugin never
 * imports the implementing package (`pnpm verify` checks the service really
 * exists, and every call here degrades when it does not).
 */
interface AttachmentStoreLike {
  /** Deployment-resolved image policy (read, never guessed). */
  imageLimits?: { maxImageBytes?: number; mediaTypes?: readonly string[] }
  admitEncodedFile(input: { data: string; name?: string }): Promise<FileRefLike>
  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<ImageRefLike>
  readImage(ref: ImageRefLike, signal?: AbortSignal): Promise<{ ref: ImageRefLike; data: Uint8Array }>
  readFileStream(ref: FileRefLike, signal?: AbortSignal): AsyncIterable<Uint8Array>
}

/** The service face this route needs (real store or a fake). */
export interface AttachmentRouteDeps {
  /** The store, when this host has one. */
  store?: AttachmentStoreLike
}

/** Read one JSON request body, answering the right status for each failure. */
async function readBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | undefined> {
  const outcome = await readJsonBodyDetailed(req, MAX_BODY_BYTES)
  if (outcome.ok) return outcome.value
  // 413 for oversized (the reader deserves to hear "too big"), 400 otherwise.
  const status = outcome.reason === 'oversize' ? 413 : 400
  json(res, { ok: false, error: { code: outcome.reason, message: outcome.reason } }, status)
  return undefined
}

/** Decode canonical base64 into bytes, or undefined when it is not base64. */
function bytesOf(data: string): Uint8Array | undefined {
  if (data === '' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return undefined
  const bytes = Buffer.from(data, 'base64')
  return bytes.length === 0 ? undefined : new Uint8Array(bytes)
}

/** Base64 of raw bytes (canonical, no data-URL prefix). */
function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** Read a non-empty string field. */
function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Admit one attachment: images through the store's image lane (which
 * normalizes and verifies the raster), everything else byte-for-byte.
 * @param store - the attachment store.
 * @param input - the declared name, optional media type and base64 bytes.
 * @returns the durable reference, or a stable refusal code.
 */
async function admit(
  store: AttachmentStoreLike,
  input: { name: string; mediaType?: string; data: string },
): Promise<{ ok: true; ref: AttachmentRef } | { ok: false; code: string; message: string }> {
  const bytes = bytesOf(input.data)
  if (bytes === undefined) return { ok: false, code: 'bad-bytes', message: 'the payload is not canonical base64' }
  if (input.mediaType !== undefined) {
    const limits = store.imageLimits
    const allowed = limits?.mediaTypes
    if (allowed !== undefined && !allowed.includes(input.mediaType)) {
      return { ok: false, code: 'image-type', message: `the store does not accept ${input.mediaType}` }
    }
    const maxImageBytes = limits?.maxImageBytes
    if (maxImageBytes !== undefined && bytes.length > maxImageBytes) {
      return { ok: false, code: 'oversize', message: `an image may be at most ${String(maxImageBytes)} bytes here` }
    }
    try {
      const saved = await store.saveImage({ data: bytes, mediaType: input.mediaType, name: input.name })
      return {
        ok: true,
        ref: {
          attachmentId: saved.attachmentId,
          // The store may hand back no display name at all — its own sanitizing
          // empties one out — and an image reference is allowed to go without
          // one. A DOCUMENT row is not: it is read by name, so the name the
          // caller declared is the one stored, never an undefined that the
          // document grammar would drop the whole row for.
          name: typeof saved.name === 'string' && saved.name !== '' ? saved.name : input.name,
          bytes: saved.bytes,
          mediaType: saved.mediaType,
          width: saved.width,
          height: saved.height,
        },
      }
    } catch (error) {
      return { ok: false, code: 'image-refused', message: messageOf(error) }
    }
  }
  try {
    const saved = await store.admitEncodedFile({ data: input.data, name: input.name })
    return { ok: true, ref: { attachmentId: saved.attachmentId, name: saved.name, bytes: saved.bytes } }
  } catch (error) {
    return { ok: false, code: 'file-refused', message: messageOf(error) }
  }
}

/**
 * Read one stored attachment back as base64 (images) or exact bytes (files).
 *
 * The reference goes to the store WHOLE (see `core/attachment`): the store's
 * image read verifies the bytes against the reference's own media type, byte
 * length and intrinsic size, so a field this route failed to forward would make
 * a perfectly good attachment unreadable — and the store would report it as
 * corruption, which is a sentence about the STORE that the reader cannot act on.
 *
 * An image reference that carries no intrinsic size cannot be verified at all,
 * and that is a fact about THIS record, not about the bytes: it is answered
 * before the store is called, because every other answer it could get here would
 * be a lie about corruption.
 * @param store - the attachment store.
 * @param ref - the reference a document holds.
 * @returns the bytes as base64, or the reason it could not be read.
 */
async function readStored(
  store: AttachmentStoreLike,
  ref: AttachmentRef,
): Promise<{ ok: true; value: { name: string; mediaType?: string; bytes: number; data: string } } | { ok: false; code: string; message: string }> {
  try {
    if (ref.mediaType !== undefined) {
      if (typeof ref.width !== 'number' || typeof ref.height !== 'number') {
        return {
          ok: false,
          code: 'incomplete-ref',
          message: '这一份附件是旧版本上传的，缺它的尺寸信息——重新拖一次就能发',
        }
      }
      const stored = await store.readImage(ref as AttachmentRef & ImageRefLike)
      return {
        ok: true,
        value: { name: ref.name, mediaType: stored.ref.mediaType, bytes: stored.data.length, data: base64Of(stored.data) },
      }
    }
    const chunks: Uint8Array[] = []
    let total = 0
    for await (const chunk of store.readFileStream(ref)) {
      total += chunk.length
      if (total > MAX_READ_BYTES) return { ok: false, code: 'oversize', message: 'the stored file is larger than this route returns' }
      chunks.push(chunk)
    }
    const joined = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
    return { ok: true, value: { name: ref.name, bytes: joined.length, data: joined.toString('base64') } }
  } catch (error) {
    return { ok: false, code: 'unreadable', message: messageOf(error) }
  }
}

/** One error's message, never a throw. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether a value names a stored attachment: the three fields every age of a
 * reference has, and nothing more. This is the gate that says "this is a
 * reference at all" — NOT a field table, and not a claim that the reference is
 * complete. Which fields a read needs is decided where the read happens (the
 * image lane checks its own size fields), so adding a requirement here would
 * turn every lane-specific refusal into one shapeless "not a reference".
 */
function isRefLike(value: unknown): value is AttachmentRef {
  if (typeof value !== 'object' || value === null) return false
  const ref = value as Record<string, unknown>
  return stringOf(ref.attachmentId) !== undefined && typeof ref.name === 'string' && typeof ref.bytes === 'number'
}

/**
 * Build the pure attachment route processor (unit-testable with a fake store).
 * @param deps - the store face.
 * @returns an HTTP handler for the two attachment paths.
 */
export function createAttachmentHandler(
  deps: AttachmentRouteDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const missing = (res: ServerResponse): void => {
    json(res, { ok: false as const, error: { code: 'no-store', message: 'this host has no attachment store' } })
  }
  return async (req, res): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    const url = req.url ?? ''
    const reading = url.includes('/attachments/read')
    const store = deps.store
    if (store === undefined) {
      missing(res)
      return
    }
    const body = await readBody(req, res)
    if (body === undefined) return
    const row = body as Record<string, unknown>
    if (reading) {
      const ref = (row as { ref?: unknown }).ref
      if (!isRefLike(ref)) {
        json(res, { ok: false as const, error: { code: 'bad-ref', message: 'a stored reference is required' } })
        return
      }
      const outcome = await readStored(store, ref)
      json(res, outcome.ok ? { ok: true as const, value: outcome.value } : { ok: false as const, error: { code: outcome.code, message: outcome.message } })
      return
    }
    const name = stringOf(row.name)
    const data = stringOf(row.data)
    if (name === undefined || data === undefined) {
      json(res, { ok: false as const, error: { code: 'bad-request', message: 'a name and base64 bytes are required' } })
      return
    }
    const outcome = await admit(store, {
      name,
      data,
      ...stringOf(row.mediaType) !== undefined ? { mediaType: row.mediaType as string } : {},
    })
    const envelope: RouteEnvelope<AttachmentRef> = outcome.ok
      ? { ok: true, value: outcome.ref }
      : { ok: false, error: { code: outcome.code, message: outcome.message } }
    json(res, envelope)
  }
}

/**
 * Register the attachment routes on the host web server.
 * @param ctx - context carrying the webServer (and, when present, the store).
 * @param ns - the plugin namespace (route path prefix).
 * @returns the route disposers, or a no-op when the web server is absent.
 */
export function registerAttachmentRoute(ctx: Context, ns: string): () => void {
  const webServer = ctx.get('webServer') as { register(options: unknown): () => void } | undefined
  if (webServer === undefined) return () => undefined
  const store = ctx.get('attachments') as AttachmentStoreLike | undefined
  const handler = createAttachmentHandler(store === undefined ? {} : { store })
  const disposers = [
    webServer.register({ kind: 'exact', path: `/api/${ns}/attachments`, handler }),
    webServer.register({ kind: 'exact', path: `/api/${ns}/attachments/read`, handler }),
  ]
  return () => { for (const dispose of disposers) dispose() }
}
