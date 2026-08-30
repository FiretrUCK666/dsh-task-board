/**
 * Browser image admission: encode a dropped/picked File into the base64 wire
 * form the host attachment bridge accepts (png/jpeg/webp/gif only — the
 * version-one native whitelist — with a generous size cap each), then admit
 * them to durable refs through that bridge. Pure and framework-free so the
 * encoding + validation rules are unit-testable (the breath of the browser
 * fetch stays in the caller).
 */
export interface HostImageRefView {
  attachmentId: string
  mediaType: string
  bytes?: number
  width?: number
  height?: number
  name?: string
}

/** An admitted, ready-to-send browser image. */
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

/** The accepted raster media types (the native version-one whitelist). */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** Per-image byte cap (20 MB) — generous, still protects the bridge. */
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

/** The attachment-bridge endpoint the browser half POSTs to. */
export const ATTACH_URL = '/api/dsh-task-board/attachments'

/** Outcome of admitting drafts: durable refs, or a human reason for failure
 *  (never a silent empty list — the composer must be able to tell the user
 *  WHY their picture did not send). */
export interface AdmitOutcome {
  refs: HostImageRefView[]
  error?: string
}

/** Admit draft images to durable refs through the host bridge. A failure
 *  (bridge down, oversized, service error) carries a message; success never
 *  does. The caller restores the draft AND shows the reason. */
export async function admitDraftImages(images: readonly DraftImage[]): Promise<AdmitOutcome> {
  if (images.length === 0) return { refs: [] }
  try {
    const response = await fetch(ATTACH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        images: images.map(image => ({ mediaType: image.mediaType, data: image.data, name: image.name })),
      }),
    })
    const body = await response.json().catch(() => undefined) as
      | { ok: true; refs?: HostImageRefView[] }
      | { ok: false; error?: { message?: string } }
      | undefined
    if (body === undefined) return { refs: [], error: response.statusText || '上传失败' }
    if (body.ok === true && Array.isArray(body.refs)) return { refs: body.refs }
    const message = 'error' in body && typeof body.error?.message === 'string' ? body.error.message : '上传失败'
    return { refs: [], error: message }
  } catch (error) {
    return { refs: [], error: error instanceof Error ? error.message : '网络错误' }
  }
}
