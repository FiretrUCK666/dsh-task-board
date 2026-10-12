/**
 * Browser attachment intake: turn picked/pasted/dropped Files into ONE shape
 * the whole plugin stores and sends — a durable attachment ref.
 *
 * WHY THERE IS ONLY ONE LANE TO STORE. The harness owns a durable,
 * content-addressed attachment store (`ctx.attachments`), and every surface here
 * — the task prompt, a session rule, a comment, a checklist row — admits its
 * bytes into that same store through the plugin's host route. A document then
 * carries `{attachmentId, name, bytes, mediaType?}` and nothing else, so the
 * bytes have exactly one home and every sender can materialize them later (a
 * run on another session, a cron rule firing next week, a promotion from the
 * checklist into a card).
 *
 * WHAT THIS MODULE STILL OWNS: the decision of how one picked file is prepared
 * for admission —
 *
 *  - IMAGES (png/jpeg/webp/gif — the native whitelist) are RE-ENCODED through a
 *    canvas downscale (longest edge + quality), so a 12 MB phone photo becomes a
 *    sub-megabyte JPEG/WebP in the browser BEFORE it is stored. Animated GIFs
 *    pass through untouched (a canvas would flatten them) while still bounded by
 *    the byte budget.
 *  - FILES (everything else: pdf/txt/md/zip/video/…) are uploaded byte-for-byte,
 *    never base64'd into an image part and never reshaped.
 *  - A silent drop on any unsupported type (the old 「电脑端发不了图」: BMP / HEIC
 *    / screenshots pasted, all discarded without a word) is a contract
 *    violation: every rejection names its reason to the user.
 *
 * The pure decision + result-parsing halves are framework-free and unit-tested;
 * only the decode/encode middle touches the DOM.
 */
import { IMAGE_MEDIA_TYPES } from '../../core/tasks.ts'

/** The accepted raster media types — the core table (the intake gate AND
 *  every storage wall read one table, never two). */
export { IMAGE_MEDIA_TYPES }

/** One encoded, ready-to-admit browser image. */
export interface EncodedImage {
  /** Base64 payload (data URL already stripped). */
  data: string
  /** Encoded media type (always inside the native whitelist). */
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Browser display name (never an OS path). */
  name: string
}

/** A per-surface size budget: what "an image" may cost once encoded. */
export interface ImageBudget {
  /** Longest edge in pixels after re-encode (gif passthrough ignores it). */
  maxEdge: number
  /** Hard cap on the ENCODED bytes (post-compression). */
  maxBytes: number
  /** Canvas quality for lossy re-encode (jpeg/webp). */
  quality: number
}

/** Why one file never became a draft attachment (each maps to a visible reason). */
export type ImageRejectReason = 'type' | 'size' | 'decode' | 'count'

/** The outcome of intake for one file: an encoded image, or why it was not one. */
export type IntakeOutcome =
  | { ok: true; image: EncodedImage }
  | { ok: false; reason: ImageRejectReason; name: string }

/** The comment composer: generous — it is stored once, then sent per message. */
export const COMMENT_IMAGE_BUDGET: ImageBudget = { maxEdge: 1568, maxBytes: 4 * 1024 * 1024, quality: 0.82 }

/** Prompt images persist with the record and are read back at send time, so the
 *  budget stays deliberately tight: a few hundred KB each, a handful per card. */
export const TASK_IMAGE_BUDGET: ImageBudget = { maxEdge: 1280, maxBytes: 512 * 1024, quality: 0.78 }

/** How many images one record (task prompt / rule / comment / checklist row)
 *  may carry. */
export const MAX_TASK_IMAGES = 3

/** How many images one COMMENT may carry (a conversation is not a document). */
export const MAX_COMMENT_IMAGES = 9

/** How many non-image files one message may carry (the twin cap of images). */
export const MAX_COMMENT_FILES = 5

/** How many images one checklist row's body may carry. */
export const MAX_ITEM_IMAGES = 3

/** How many files one checklist row's body may carry. */
export const MAX_ITEM_FILES = 3

/**
 * The largest file the browser will upload through the plugin's own route.
 *
 * The official file lane streams and has no limit; the plugin's route carries
 * one JSON body, so it needs an edge the user can understand — and a refusal
 * that names the number beats a request the host has to kill. Anything larger
 * is refused at pick time, in words.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/**
 * PURE decision for one candidate file (unit-tested): the intake route.
 * Images route to the canvas lane; EVERYTHING else routes to the file lane
 * (upload-then-receipt) — a non-image is never a "type rejection".
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
export function finishEncoded(  dataUrl: string,
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
  return {
    ok: true,
    image: { data, mediaType: mediaType as EncodedImage['mediaType'], name },
  }
}

/** Read a File's exact bytes as canonical base64 (no data-URL prefix). */
export function readFileBase64(file: File): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : '')
    }
    reader.onerror = () => resolve('')
    reader.readAsDataURL(file)
  })
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
