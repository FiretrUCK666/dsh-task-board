/**
 * Attachment bridge (host): admits browser-attached images to the durable
 * attachment service and hands back their refs, so the board's composer can
 * submit a prompt with `{ type: 'image', attachment }` content blocks —
 * exactly the shape the native composer produces. The bridge stays narrow
 * and structurally tolerant: no attachments service means every request
 * fails softly with a clear envelope, never a crash.
 */
import type { Context } from '@deepseek-ai/cordis'
import { readJsonBody, json } from './settings-route.ts'

/** One accepted image wire entry from the browser. */
export interface AttachmentWireImage {
  /** Declared raster media type (png/jpeg/webp/gif). */
  mediaType: string
  /** Canonical base64 encoding of the image bytes. */
  data: string
  /** Optional display name (never a path). */
  name?: string
}

/** The validated request body: ordered images to admit. */
export interface AttachImagesRequest {
  images: AttachmentWireImage[]
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
  if (attachments === undefined) return { refs: [], error: 'attachments unavailable' }
  const raw = request?.images
  if (!Array.isArray(raw) || raw.length === 0) return { refs: [] }
  const inputs = raw.map(normalizeWireImage).filter((input): input is NonNullable<typeof input> => input !== undefined)
  if (inputs.length === 0) return { refs: [], error: 'no valid images' }
  try {
    const saved = (await attachments.saveImages(inputs)) as unknown[]
    const refs = saved.map(refViewOf).filter((ref): ref is AttachImageRefView => ref !== undefined)
    return { refs }
  } catch (error) {
    return { refs: [], error: error instanceof Error ? error.message : 'save failed' }
  }
}

/** HTTP handler: POST /api/dsh-task-board/attachments (body: admitted images). */
export function createAttachHandler(
  attachments: AttachmentsFace | undefined,
  admit: (attachments: AttachmentsFace | undefined, request: AttachImagesRequest | undefined) => Promise<{ refs: AttachImageRefView[]; error?: string }> = admitImages,
): (req: import('http').IncomingMessage, res: import('http').ServerResponse) => Promise<void> {
  return async (req, res) => {
    const body = await readJsonBody(req)
    const request = isPlainObject(body) ? body as unknown as AttachImagesRequest : undefined
    if (request === undefined || !Array.isArray(request.images)) {
      json(res, { ok: false, error: { code: 'internal', message: 'invalid body' } }, 400)
      return
    }
    const outcome = await admit(attachments, request)
    if (outcome.error !== undefined) {
      json(res, { ok: false, error: { code: 'internal', message: outcome.error } }, 500)
      return
    }
    json(res, { ok: true, refs: outcome.refs } as unknown as import('./settings-route.ts').RouteEnvelope)
  }
}

/** Mount the attachment bridge on the host web surface. */
export function registerAttachRoute(ctx: Context): () => void {
  const webServer = ctx.get('webServer') as { register(options: unknown): () => void } | undefined
  if (webServer === undefined) return () => undefined
  const attachments = ctx.get('attachments') as AttachmentsFace | undefined
  return webServer.register({
    kind: 'exact',
    path: '/api/dsh-task-board/attachments',
    handler: createAttachHandler(attachments),
  })
}
