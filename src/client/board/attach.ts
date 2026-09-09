/**
 * Browser attachment intake: turn picked/pasted/dropped Files into the forms
 * the OFFICIAL native prompt parts carry. Two lanes, one hook:
 *
 *  - IMAGES (png/jpeg/webp/gif — the native whitelist) are RE-ENCODED
 *    through a canvas downscale (longest edge + quality), so a 12 MB phone
 *    photo becomes a sub-megabyte JPEG/WebP in the browser BEFORE it goes on
 *    the wire — sending is fast and the model still sees the picture. A
 *    silent drop on any unsupported type (the old 「电脑端发不了图」: BMP /
 *    HEIC / screenshots pasted, all discarded without a word) is a contract
 *    violation: every rejection names its reason to the user.
 *  - animated GIFs pass through untouched (a canvas would flatten them)
 *    while still bounded by the byte budget.
 *  - FILES (everything else: pdf/txt/md/zip/video/…) never enter the image
 *    lane. They ride the OFFICIAL file channel instead: the browser uploads
 *    the exact bytes through `fileUploads/upload` (or the binary HTTP
 *    fallback) and the prompt carries only the opaque `{type:'file',
 *    receiptId}` ref. The board never invents a file wire shape and never
 *    base64s file bytes into an image part.
 *
 * The HOST performs the durable admission when it takes the prompt (image
 * bytes are temporary, file refs are staged per-Agent), so the board never
 * uploads through a side channel — there is exactly one mechanism per lane,
 * both shared with the native composer. The pure decision + result-parsing
 * halves are framework-free and unit-tested; only the decode/encode middle
 * touches the DOM.
 */
import type { PromptImage } from '../../core/controller.ts'

/** An encoded, ready-to-send browser image. */
export interface DraftImage {
  /** Stable local identity for the composer strip. */
  id: string
  /** Base64 payload (data URL already stripped): the wire `data` field. */
  data: string
  /** Encoded media type (always inside the native whitelist). */
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Browser display name (never an OS path). */
  name: string
}

/** The official temporary-bytes part for one draft image. */
export function toPromptImage(image: DraftImage): PromptImage {
  return { mediaType: image.mediaType, data: image.data, name: image.name }
}

/** The accepted raster media types (the native version-one whitelist). */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** Why one file never became a draft attachment (each maps to a visible reason). */
export type ImageRejectReason = 'type' | 'size' | 'decode' | 'count'

/** The file lane: a staged upload the prompt references by receipt. */
export interface DraftFile {
  /** Stable local identity for the composer strip. */
  id: string
  /** Opaque receipt from a preceding `fileUploads/upload` on the SAME session. */
  receiptId: string
  /** The file's display name + byte size (never an OS path). */
  name: string
  /** Exact byte size (files carry no admission limits — shown, not gated). */
  bytes: number
}

/** The official file prompt part for one staged file. */
export function toPromptFilePart(file: DraftFile): { type: 'file'; receiptId: string } {
  return { type: 'file', receiptId: file.receiptId }
}

/** A staged file as the controller's PromptFile (receipt + name + bytes). */
export function toPromptFile(file: DraftFile): { receiptId: string; name: string; bytes: number } {
  return { receiptId: file.receiptId, name: file.name, bytes: file.bytes }
}

/** The outcome of intake for one file: an image, or the reason it was not. */
export type IntakeOutcome =
  | { ok: true; image: DraftImage }
  | { ok: false; reason: ImageRejectReason; name: string }

/** A per-surface size budget: what "an image" may cost once encoded. */
export interface ImageBudget {
  /** Longest edge in pixels after re-encode (gif passthrough ignores it). */
  maxEdge: number
  /** Hard cap on the ENCODED bytes (post-compression). */
  maxBytes: number
  /** Canvas quality for lossy re-encode (jpeg/webp). */
  quality: number
}

/** The comment composer: generous — the wire carries it once, per send. */
export const COMMENT_IMAGE_BUDGET: ImageBudget = { maxEdge: 1568, maxBytes: 4 * 1024 * 1024, quality: 0.82 }

/** Task-prompt images PERSIST in the shared board document (every device
 *  syncs them), so the budget is deliberately tight: a few hundred KB each,
 *  a handful per task. */
export const TASK_IMAGE_BUDGET: ImageBudget = { maxEdge: 1280, maxBytes: 512 * 1024, quality: 0.78 }

/** How many images a task's execution prompt may carry (persisted payload). */
export const MAX_TASK_IMAGES = 3

/** How many images one comment send may carry (transient wire payload —
 *  generous, but a hard edge so a whole album drop cannot balloon one send). */
export const MAX_COMMENT_IMAGES = 9

/**
 * PURE decision for one candidate file (unit-tested): the intake route.
 * Images route to the canvas lane; EVERYTHING else routes to the file lane
 * (upload-then-receipt) — a non-image is never a "type rejection" anymore.
 * A pre-compression image may exceed maxBytes and still be fine (the
 * re-encode shrinks it), so size only rejects a PASSTHROUGH (gif) or the
 * final encoded result — never a re-encode candidate up front.
 */
export function intakeDecision(
  type: string,
  size: number,
  budget: ImageBudget,
): { kind: 'passthrough'; mediaType: 'image/gif' } | { kind: 'reencode' } | { kind: 'file' } | { kind: 'reject'; reason: ImageRejectReason } {
  if (!type.startsWith('image/')) return { kind: 'file' }
  if (type === 'image/gif') {
    return size <= budget.maxBytes ? { kind: 'passthrough', mediaType: 'image/gif' } : { kind: 'reject', reason: 'size' }
  }
  return { kind: 'reencode' }
}

/**
 * PURE: turn an encoded data URL into the wire shape, enforcing the budget
 * and the native whitelist on the RESULT (a canvas in an exotic browser can
 * hand back a type the host would reject — that is a decode failure, said
 * out loud, never a silent drop).
 */
let sequence = 0

export function finishEncoded(
  dataUrl: string,
  name: string,
  budget: ImageBudget,
): IntakeOutcome {
  const match = /^data:([^;,]+)[^,]*,(.*)$/s.exec(dataUrl)
  const mediaType = match?.[1] ?? ''
  const data = match?.[2] ?? ''
  if (mediaType === '' || data === '' || !IMAGE_MEDIA_TYPES.includes(mediaType as (typeof IMAGE_MEDIA_TYPES)[number])) {
    return { ok: false, reason: 'decode', name }
  }
  // base64 length → bytes (ceil of 3/4 of the payload, exact enough to gate).
  const bytes = Math.ceil(data.length * 3 / 4)
  if (bytes > budget.maxBytes) return { ok: false, reason: 'size', name }
  sequence += 1
  return {
    ok: true,
    image: {
      id: `img-${Date.now()}-${sequence}`,
      data,
      mediaType: mediaType as DraftImage['mediaType'],
      name,
    },
  }
}

/** Scale a length so the longest edge is at most `maxEdge`. */
export function scaleToFit(width: number, height: number, maxEdge: number): { w: number; h: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { w: width, h: height }
  const ratio = maxEdge / longest
  return { w: Math.max(1, Math.round(width * ratio)), h: Math.max(1, Math.round(height * ratio)) }
}

/** Read a File as a data URL (browser API; resolves '' on error). */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => resolve('')
    reader.readAsDataURL(file)
  })
}

/** Decode an image File into a drawable source; undefined when undecodable. */
async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number } | undefined> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file)
      return { source: bitmap, width: bitmap.width, height: bitmap.height }
    }
  } catch { /* fall through to the element path */ }
  try {
    const url = URL.createObjectURL(file)
    try {
      const image = await new Promise<HTMLImageElement | undefined>(resolve => {
        const element = new Image()
        element.onload = () => { resolve(element) }
        element.onerror = () => { resolve(undefined) }
        element.src = url
      })
      if (image === undefined) return undefined
      return { source: image, width: image.naturalWidth, height: image.naturalHeight }
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return undefined
  }
}

/**
 * Encode one image File into the wire form under `budget` (browser-only
 * middle: decode → canvas downscale → re-encode; the decision and the result
 * gate are the pure functions above). NEVER throws; every failure is an
 * IntakeOutcome with a reason the composer shows.
 */
export async function encodeImageFile(file: File, budget: ImageBudget = COMMENT_IMAGE_BUDGET): Promise<IntakeOutcome> {
  const decision = intakeDecision(file.type, file.size, budget)
  if (decision.kind === 'reject') return { ok: false, reason: decision.reason, name: file.name }
  if (decision.kind === 'passthrough') {
    const dataUrl = await readAsDataUrl(file)
    return finishEncoded(dataUrl, file.name, budget)
  }
  const decoded = await decodeImage(file)
  if (decoded === undefined || decoded.width === 0 || decoded.height === 0) {
    return { ok: false, reason: 'decode', name: file.name }
  }
  const { w, h } = scaleToFit(decoded.width, decoded.height, budget.maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const context = canvas.getContext('2d')
  if (context === null) return { ok: false, reason: 'decode', name: file.name }
  // A JPEG has no alpha: flatten transparency onto white (the universal
  // photo backdrop) so a transparent PNG never turns black.
  context.fillStyle = 'white'
  context.fillRect(0, 0, w, h)
  context.imageSmoothingQuality = 'high'
  context.drawImage(decoded.source, 0, 0, w, h)
  // WebP first (keeps alpha, smaller); browsers without WebP encoding hand
  // back PNG, and the pure gate accepts either (both are whitelisted).
  let dataUrl = canvas.toDataURL('image/webp', budget.quality)
  let outcome = finishEncoded(dataUrl, file.name, budget)
  if (!outcome.ok && outcome.reason === 'size') {
    // One more compression pass before giving up on a big-but-compressible image.
    dataUrl = canvas.toDataURL('image/jpeg', Math.max(0.5, budget.quality - 0.15))
    outcome = finishEncoded(dataUrl, file.name, budget)
  }
  return outcome
}
