/**
 * Attachment bridge (host): admits browser-attached images to the durable
 * attachment service and hands back their refs, so the board's composer can
 * submit a prompt with `{ type: 'image', attachment }` content blocks —
 * exactly the shape the native composer produces. The bridge stays narrow
 * and structurally tolerant: no attachments service means every request
 * fails softly with a clear envelope, never a crash.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readJsonBodyDetailed } from './settings-route.ts'

/** One accepted image wire entry from the browser. */
export interface AttachmentWireImage {
  /** Declared raster media type (png/jpeg/webp/gif). */
  mediaType: string
  /** Canonical base64 encoding of the image bytes. */
  data: string
  /** Optional display name (never a path). */
  name?: string
}

/** The request body: ordered wire images to admit. Each entry stays unknown —
 *  the browser body is never trusted past this point; normalizeWireImage
 *  shape-guards every entry downstream. */
export interface AttachImagesRequest {
  images: unknown[]
}

/** The durable attachment refs returned to the browser (mirror of
 *  ImageAttachmentRef, narrowed structurally). */
export interface AttachImageRefView {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: string
}

/** The attachments service face (abstract; absent when not mounted). */
export interface AttachmentsFace {
  saveImages(inputs: unknown[]): Promise<unknown[]>
}

/** Structural filter: keep only well-formed base64 images with a media type
 *  the version-one attendee accepts. */
const ACCEPTED_MEDIA = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
function isMediaType(value: string): boolean {
  return ACCEPTED_MEDIA.includes(value)
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Normalize an unknown wire item to a SaveImage-shaped input, or undefined. */
export function normalizeWireImage(value: unknown): { data: Uint8Array; mediaType: string; name?: string } | undefined {
  if (!isPlainObject(value)) return undefined
  const data = value.data
  if (typeof data !== 'string' || data === '') return undefined
  const mediaType = value.mediaType
  if (typeof mediaType !== 'string' || !isMediaType(mediaType)) return undefined
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length === 0) return undefined
  const name = value.name
  return {
    data: new Uint8Array(bytes),
    mediaType,
    ...typeof name === 'string' && name !== '' ? { name } : {},
  }
}

/** Narrow a saveImages result to ref-like views (unknown re-shapes degrade). */
function refViewOf(value: unknown): AttachImageRefView | undefined {
  if (!isPlainObject(value)) return undefined
  const id = value.attachmentId
  const mediaType = value.mediaType
  if (typeof id !== 'string' || typeof mediaType !== 'string') return undefined
  const view: AttachImageRefView = {
    attachmentId: id,
    mediaType,
    bytes: typeof value.bytes === 'number' ? value.bytes : 0,
    width: typeof value.width === 'number' ? value.width : 0,
    height: typeof value.height === 'number' ? value.height : 0,
  }
  if (typeof value.name === 'string' && value.name !== '') view.name = value.name
  return view
}

/** Admit browser images and return durable refs (empty body = no refs). */
export async function admitImages(
  attachments: AttachmentsFace | undefined,
  request: AttachImagesRequest | undefined,
): Promise<{ refs: AttachImageRefView[]; error?: string }> {
  if (attachments === undefined) return { refs: [], error: '图片服务未就绪，暂不能上传' }
  const raw = request?.images
  if (!Array.isArray(raw) || raw.length === 0) return { refs: [] }
  const inputs = raw.map(normalizeWireImage).filter((input): input is NonNullable<typeof input> => input !== undefined)
  if (inputs.length === 0) return { refs: [], error: '没有可用的图片（仅支持 png/jpeg/webp/gif）' }
  try {
    const saved = (await attachments.saveImages(inputs)) as unknown[]
    const refs = saved.map(refViewOf).filter((ref): ref is AttachImageRefView => ref !== undefined)
    return { refs }
  } catch (error) {
    return { refs: [], error: error instanceof Error ? error.message : '图片保存失败' }
  }
}

/** The bridge's own envelope (its shape is NOT the settings value envelope:
 *  ok carries refs, fail carries a stable error). The client reads exactly
 *  this shape, so nothing is cast into a foreign one. */
export type AttachEnvelope =
  | { ok: true; refs: AttachImageRefView[] }
  | { ok: false; error: { code: string; message: string } }

function writeResponse(res: ServerResponse, envelope: AttachEnvelope, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/** The request body cap for the bridge: the native attachment bridge admits
 *  an aggregate of ~100 MiB of images (base64-expanded), so the route must
 *  not reject a legitimate multi-image composer send before the durable
 *  service gets to apply its OWN per-image limits (the "选图后点发送毫无反应"
 *  bug was this route's inherited 1 MiB default swallowing the whole POST as
 *  an unparseable body). */
export const ATTACH_BODY_LIMIT_BYTES = 128 * 1024 * 1024

/** HTTP handler: POST /api/dsh-task-board/attachments (body: admitted images).
 *  The attachments service is resolved PER REQUEST through `resolveAttachments`
 *  — never captured — so a service that mounts after the route (or remounts
 *  after a host reload) still serves admissions. */
export function createAttachHandler(
  resolveAttachments: () => AttachmentsFace | undefined,
  admit: (attachments: AttachmentsFace | undefined, request: AttachImagesRequest | undefined) => Promise<{ refs: AttachImageRefView[]; error?: string }> = admitImages,
  bodyLimitBytes: number = ATTACH_BODY_LIMIT_BYTES,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    // A distinct oversized signal (not the shared "invalid body"): the client
    // can then tell the user WHY the send failed instead of silently dropping
    // the draft.
    const read = await readJsonBodyDetailed(req, bodyLimitBytes)
    if (!read.ok) {
      if (read.reason === 'oversize') {
        writeResponse(res, { ok: false, error: { code: 'too_large', message: '图片过大，超出上传限制' } }, 413)
      } else {
        writeResponse(res, { ok: false, error: { code: 'internal', message: 'invalid body' } }, 400)
      }
      return
    }
    const body = read.value
    const request = isPlainObject(body) && Array.isArray(body.images)
      ? { images: body.images as unknown[] }
      : undefined
    if (request === undefined) {
      writeResponse(res, { ok: false, error: { code: 'internal', message: 'invalid body' } }, 400)
      return
    }
    const outcome = await admit(resolveAttachments(), request)
    if (outcome.error !== undefined) {
      writeResponse(res, { ok: false, error: { code: 'internal', message: outcome.error } }, 500)
      return
    }
    writeResponse(res, { ok: true, refs: outcome.refs })
  }
}

/** Mount the attachment bridge on the host web surface. */
export function registerAttachRoute(ctx: Context): () => void {
  const webServer = ctx.get('webServer') as { register(options: unknown): () => void } | undefined
  if (webServer === undefined) return () => undefined
  return webServer.register({
    kind: 'exact',
    path: '/api/dsh-task-board/attachments',
    handler: createAttachHandler(() => ctx.get('attachments') as AttachmentsFace | undefined),
  })
}
