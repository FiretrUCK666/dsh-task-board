/**
 * ONE-TIME relocation of legacy attachment bytes out of the board document.
 *
 * WHAT THIS SOLVES. Two older revisions persisted attachment payloads INSIDE the
 * document: `promptImages` carried base64 image bytes per round, `promptFiles`
 * carried per-Agent staged receipts. Measured on a real board, that is 513 KB of
 * a 1.99 MB document (26%) — bytes that every replica downloads on every
 * connect, that the merge layer compares row by row, and that the sync payload
 * has to carry, all to hold seven pictures the harness already knows how to keep
 * in its own store.
 *
 * So each legacy image is handed to the official attachment store once, and the
 * document keeps only the durable ref. The bytes leave; the picture does not.
 *
 * ── WHY THIS IS NOT THE "REWRITE ON LOAD" THE MODEL FORBIDS ──────────────────
 *
 * `attachment.ts` says a record migrates when it is next EDITED, never on load,
 * because a background rewrite of every replica's document is a write nobody
 * asked for. That rule stands for anything that runs repeatedly. This pass is
 * different in the four ways that matter, and each one is a gate here:
 *
 * 1. it runs AT MOST ONCE, recorded in the unit's `meta` document before the
 *    board is written, so a crash re-runs at most this one idempotent pass;
 * 2. it only ever REMOVES payload bytes it has already duplicated into the
 *    store, and only after that duplicate is confirmed;
 * 3. it never touches a row it cannot complete — one unreadable image is left
 *    exactly as it was, and the pass still succeeds for the other six;
 * 4. it is skipped entirely when the host has no attachment store, because then
 *    the bytes have nowhere honest to go.
 *
 * The receipt is measured, never assumed: {@link migrateLegacyAttachments}
 * reports what it relocated and what it left behind, and the caller logs that.
 *
 * @module dsh-task-board/core/attachment-migration
 */
import type { AttachmentRef } from './attachment.ts'

/** The meta record key that marks this pass as done. */
export const LEGACY_ATTACHMENT_MIGRATION_KEY = 'legacyAttachmentsMovedAt'

/** One legacy image that still carries its own bytes. */
export interface LegacyImageRow {
  /** Where it sits, so the caller can write the result back. */
  readonly taskId: string
  /** Index of the round inside that task. */
  readonly roundIndex: number
  /** Index inside that round's `promptImages`. */
  readonly imageIndex: number
  /** Base64 payload, no data-URL prefix. */
  readonly data: string
  /** Declared media type, when the row had one. */
  readonly mediaType?: string
  /** Declared name, when the row had one. */
  readonly name?: string
}

/** What one pass did, in facts the caller can log or assert on. */
export interface LegacyAttachmentMigrationReport {
  /** Images the store accepted and that are now durable refs. */
  readonly moved: number
  /** Images left untouched, with the reason the store would not take them. */
  readonly skipped: readonly { readonly row: LegacyImageRow; readonly reason: string }[]
  /** Whether the document actually changed (a no-op pass writes nothing). */
  readonly changed: boolean
}

/** The store face this pass needs — the same one the attachment route calls. */
export interface ImageAdmittingStore {
  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<unknown>
}

/** Is this a payload {@link decodeBase64} can turn into bytes? */
function isBase64(data: string): boolean {
  return data !== '' && /^[A-Za-z0-9+/]*={0,2}$/.test(data)
}

/**
 * Decode canonical base64, or nothing.
 *
 * Uses the same acceptance rule the attachment route uses, so a payload that
 * reaches the store here cannot be one the route would have refused.
 * @param data - base64 text.
 * @returns the bytes, or undefined when it is not base64.
 */
export function decodeBase64(data: string): Uint8Array | undefined {
  if (!isBase64(data)) return undefined
  const bytes = Buffer.from(data, 'base64')
  return bytes.length === 0 ? undefined : new Uint8Array(bytes)
}

/**
 * Collect every legacy image that still carries bytes, in document order.
 *
 * A row with no usable payload is not a migration candidate and is not reported:
 * there is nothing to move, so leaving it alone is already correct.
 * @param tasks - the document's task rows.
 * @returns the candidate rows.
 */
export function legacyImagesOf(tasks: readonly unknown[]): LegacyImageRow[] {
  const out: LegacyImageRow[] = []
  tasks.forEach((task, taskIndex) => {
    // A persisted row is untrusted input: anything that is not an object here is
    // a row this pass has nothing to say about, not a reason to throw.
    if (typeof task !== 'object' || task === null) return
    const row = task as Record<string, unknown>
    const taskId = typeof row.id === 'string' ? row.id : String(taskIndex)
    const rounds = row.executions
    if (!Array.isArray(rounds)) return
    rounds.forEach((round, roundIndex) => {
      if (typeof round !== 'object' || round === null) return
      const images = (round as Record<string, unknown>).promptImages
      if (!Array.isArray(images)) return
      images.forEach((image, imageIndex) => {
        if (typeof image !== 'object' || image === null) return
        const entry = image as Record<string, unknown>
        if (typeof entry.data !== 'string' || !isBase64(entry.data)) return
        if (Buffer.from(entry.data, 'base64').length === 0) return
        out.push({
          taskId,
          roundIndex,
          imageIndex,
          data: entry.data,
          ...(typeof entry.mediaType === 'string' ? { mediaType: entry.mediaType } : {}),
          ...(typeof entry.name === 'string' ? { name: entry.name } : {}),
        })
      })
    })
  })
  return out
}

/** A store result this pass can accept as a durable ref. */
function refOf(saved: unknown): AttachmentRef | undefined {
  if (typeof saved !== 'object' || saved === null) return undefined
  const row = saved as Record<string, unknown>
  // Only what the store GUARANTEES is required here: the official image ref
  // declares `name` optional, so demanding it would report a perfectly good
  // store result as a refusal — and the image would keep its bytes forever
  // because of a field the harness never promised.
  if (typeof row.attachmentId !== 'string' || row.attachmentId === '') return undefined
  if (typeof row.bytes !== 'number' || !Number.isFinite(row.bytes)) return undefined
  // The ref travels WHOLE (see attachment.ts): only this plugin's own source keys
  // are dropped, never an enumerated "keep these" list.
  const { data, receiptId, ...rest } = row as Record<string, unknown> & { data?: unknown; receiptId?: unknown }
  void data
  void receiptId
  return rest as unknown as AttachmentRef
}

/**
 * Move every legacy image into the store, then remove the bytes from the rows.
 *
 * Mutates `tasks` IN PLACE only for the rows it fully completes: an image the
 * store refuses is left byte-for-byte as it was, and its round keeps its
 * `promptImages` entry. A task whose rounds all moved loses the `promptImages`
 * array entirely rather than keeping an empty one — an empty array is a shape
 * the normalizers treat as "had attachments, now none", which is not what
 * happened here.
 * @param tasks - the document's task rows (mutated for completed rows).
 * @param store - the host's image lane.
 * @param signal - aborts the pass between images.
 * @returns what actually happened.
 */
export async function migrateLegacyAttachments(
  tasks: readonly unknown[],
  store: ImageAdmittingStore,
  signal?: AbortSignal,
): Promise<LegacyAttachmentMigrationReport> {
  const candidates = legacyImagesOf(tasks)
  const skipped: { row: LegacyImageRow; reason: string }[] = []
  // Keyed by the candidate's exact position, so the write-back below never has
  // to guess which entry it moved (matching by name would collide on two images
  // sharing a name, and matching by index alone would collide across tasks).
  const moved = new Map<string, AttachmentRef>()
  const positionOf = (row: LegacyImageRow): string => `${row.taskId}\u0000${row.roundIndex}\u0000${row.imageIndex}`

  for (const row of candidates) {
    if (signal?.aborted === true) break
    const bytes = decodeBase64(row.data)
    if (bytes === undefined) {
      skipped.push({ row, reason: 'not base64' })
      continue
    }
    try {
      const saved = await store.saveImage({
        data: bytes,
        mediaType: row.mediaType ?? 'image/png',
        ...(row.name !== undefined ? { name: row.name } : {}),
      })
      const ref = refOf(saved)
      if (ref === undefined) {
        skipped.push({ row, reason: 'store returned no usable ref' })
        continue
      }
      moved.set(positionOf(row), ref)
    } catch (error) {
      skipped.push({ row, reason: error instanceof Error ? error.message : 'store refused' })
    }
  }

  // Write back only AFTER the store confirmed each image: the document never
  // loses a byte that has no durable copy.
  let changed = false
  tasks.forEach((task, taskIndex) => {
    if (typeof task !== 'object' || task === null) return
    const row = task as Record<string, unknown>
    const taskId = typeof row.id === 'string' ? row.id : String(taskIndex)
    const rounds = row.executions
    if (!Array.isArray(rounds)) return
    rounds.forEach((round, roundIndex) => {
      if (typeof round !== 'object' || round === null) return
      const carrier = round as Record<string, unknown>
      const images = carrier.promptImages
      if (!Array.isArray(images)) return
      const movedRefs: AttachmentRef[] = []
      const kept: unknown[] = []
      images.forEach((image, imageIndex) => {
        const ref = moved.get(`${taskId}\u0000${roundIndex}\u0000${imageIndex}`)
        if (ref === undefined) kept.push(image)
        else movedRefs.push(ref)
      })
      if (movedRefs.length === 0) return
      const existing = Array.isArray(carrier.attachments) ? (carrier.attachments as unknown[]) : []
      carrier.attachments = [...existing, ...movedRefs]
      // An empty `promptImages` is a shape the normalizers read as "had
      // attachments, now none" — which is not what happened, so drop the key.
      if (kept.length === 0) delete carrier.promptImages
      else carrier.promptImages = kept
      changed = true
    })
  })

  return { moved: moved.size, skipped, changed }
}
