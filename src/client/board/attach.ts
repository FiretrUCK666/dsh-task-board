/**
 * Browser image intake: encode a dropped/picked File into the base64 form the
 * OFFICIAL native prompt part carries (png/jpeg/webp/gif — the native
 * whitelist — with a generous per-image cap). The HOST performs the durable
 * admission when it takes the prompt (its `PromptContentPart` image variant
 * is temporary bytes, not a ref), so the board never uploads images through a
 * side channel — there is exactly one image mechanism, shared with the native
 * composer. Pure and framework-free so the encoding + validation rules are
 * unit-testable.
 */
import type { PromptImage } from '../../core/controller.ts'

/** An encoded, ready-to-send browser image. */
export interface DraftImage {
  /** Stable local identity for the composer strip. */
  id: string
  /** Base64 payload (data URL already stripped): the wire `data` field. */
  data: string
  /** Declared media type (validated against the native whitelist). */
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

/** Per-image byte cap (20 MB) — generous, still protects the prompt channel. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

let sequence = 0

/** Encode one image File; undefined when the type/size is not acceptable. */
export function encodeImageFile(file: File): Promise<DraftImage | undefined> {
  if (!IMAGE_MEDIA_TYPES.includes(file.type as (typeof IMAGE_MEDIA_TYPES)[number])) {
    return Promise.resolve(undefined)
  }
  if (file.size > MAX_IMAGE_BYTES) return Promise.resolve(undefined)
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      const comma = dataUrl.indexOf(',')
      const data = comma >= 0 ? dataUrl.slice(comma + 1) : ''
      if (data === '') {
        resolve(undefined)
        return
      }
      sequence += 1
      resolve({
        id: `img-${Date.now()}-${sequence}`,
        data,
        mediaType: file.type as DraftImage['mediaType'],
        name: file.name,
      })
    }
    reader.onerror = () => { resolve(undefined) }
    reader.readAsDataURL(file)
  })
}
