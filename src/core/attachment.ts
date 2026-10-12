/**
 * Attachments, in ONE place: what a document stores, what the send path
 * consumes, and the one bridge between them.
 *
 * WHERE THE BYTES LIVE. The harness already owns a durable, content-addressed
 * attachment store (`ctx.attachments`, the objects under the DSH data root) and
 * the native composer has always uploaded through it. This plugin therefore
 * stores NOTHING itself: a document carries a reference, and the bytes are read
 * back through the host route that fronts that same store. A plugin-owned folder
 * would be a second home for the same bytes — two places to back up, two places
 * to outlive their refs, and one of them invisible to the harness.
 *
 * THREE AGES OF THE SAME FIELD, and only one reader. `attachments` is what new
 * writes produce. Two older shapes still sit in real documents:
 * `promptImages` (base64 temporary bytes) and `promptFiles` (per-Agent
 * receipts). {@link attachmentsOf} is the ONLY reader of those two — the send
 * path, the comment caption and every surface go through it, so nothing else in
 * the plugin has to know that an older document exists. A record is migrated
 * when it is next EDITED (never on load: a background rewrite of every replica's
 * document is a write nobody asked for).
 * @module dsh-task-board/core/attachment
 */

/** One durable attachment as a document carries it (bytes live in the store). */
export interface AttachmentRef {
  /** Content-addressed id in the official attachment store. */
  attachmentId: string
  /** Display name, already stripped of any local path by the store. */
  name: string
  /** Exact byte length (shown, never a gate here). */
  bytes: number
  /** Present for images: the display lane and the prompt part's media type. */
  mediaType?: string
  /** Present for images: intrinsic size, used by the thumbnail's box. */
  width?: number
  height?: number
}

/**
 * One attachment as the SEND path needs it: exactly one source of bytes, in
 * order of preference. A new record fills `attachmentId`; an older one fills
 * `data` (temporary bytes, self-contained) or `receiptId` (a per-Agent stage
 * that dies with its session). The materializer picks the first available
 * source and reports honestly when a source is gone.
 */
export interface PromptAttachment {
  name: string
  bytes: number
  /** Images only — the wire part's media type. */
  mediaType?: string
  /** Durable source: read the bytes back from the official store. */
  attachmentId?: string
  /** Legacy source: the temporary-bytes part this record was born with. */
  data?: string
  /** Legacy source: a staged receipt, valid only for its own session. */
  receiptId?: string
}

/** The record fields {@link attachmentsOf} reads (all three ages). */
export interface AttachmentCarrier {
  attachments?: AttachmentRef[]
  /** Legacy: base64 temporary bytes persisted by an older revision. */
  promptImages?: readonly { mediaType?: string; data?: string; name?: string }[]
  /** Legacy: staged receipts persisted by an older revision. */
  promptFiles?: readonly { receiptId?: string; name?: string; bytes?: number }[]
}

/** Read a string field that must be present and non-empty. */
function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Read a finite, non-negative number. */
function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Normalize one persisted attachment list: unusable rows are dropped, a usable
 * row keeps only the fields this model knows. A row without an id cannot be
 * read back from the store, so it is not an attachment here.
 * @param raw - the persisted value.
 * @returns the refs, or undefined when there are none.
 */
export function normalizeAttachmentRefs(raw: unknown): AttachmentRef[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: AttachmentRef[] = []
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const candidate = row as Record<string, unknown>
    const attachmentId = stringOf(candidate.attachmentId)
    const name = stringOf(candidate.name)
    const bytes = countOf(candidate.bytes)
    if (attachmentId === undefined || name === undefined || bytes === undefined) continue
    const mediaType = stringOf(candidate.mediaType)
    const width = countOf(candidate.width)
    const height = countOf(candidate.height)
    out.push({
      attachmentId,
      name,
      bytes,
      ...(mediaType !== undefined ? { mediaType } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    })
  }
  return out.length > 0 ? out : undefined
}

/**
 * 两份附件表**是不是同一份**——问的是「这次改动动了它没有」。
 *
 * 比的是内容寻址的 id、名字与字节数三项，而不是整对象：`mediaType` / `width` /
 * `height` 是显示用的补充信息，同一份字节补不补它们都还是那个附件，而把它们算进
 * 「变了没」会让一次纯粹的补充渲染算成一次修改、盖一次戳、把每台设备都叫醒。
 * `undefined` 与空表**不是同一件事**（前者是「没人说过」，后者是「一个都不留」），
 * 所以两端各自缺席时才相等。
 *
 * 一处定义：清单那条 patch 的「按值比」与会话规则那条 patch 的「按值比」是同一个问题。
 * @param a - 左表。
 * @param b - 右表。
 * @returns 两份表是否逐条相同。
 */
export function sameAttachmentRefs(
  a: readonly AttachmentRef[] | undefined,
  b: readonly AttachmentRef[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.length !== b.length) return false
  return a.every((ref, at) => {
    const other = b[at]
    return other !== undefined && ref.attachmentId === other.attachmentId && ref.name === other.name && ref.bytes === other.bytes
  })
}

/**
 * Every attachment one record carries, in document order, whichever age wrote
 * it. THE one bridge: the send path, the caption and the surfaces all read
 * this, so a legacy document cannot be visible to one of them and invisible to
 * another.
 * @param carrier - the record (or any object carrying the three field ages).
 * @returns the attachments as the send path consumes them.
 */
export function attachmentsOf(carrier: AttachmentCarrier | undefined): PromptAttachment[] {
  if (carrier === undefined) return []
  const out: PromptAttachment[] = []
  for (const ref of carrier.attachments ?? []) {
    out.push({
      name: ref.name,
      bytes: ref.bytes,
      ...(ref.mediaType !== undefined ? { mediaType: ref.mediaType } : {}),
      attachmentId: ref.attachmentId,
    })
  }
  // Legacy images: self-contained bytes. Their byte length is derived from the
  // base64 payload (ceil of 3/4) exactly like the browser-side gate does, so a
  // legacy row reports the same size a new one would.
  for (const image of carrier.promptImages ?? []) {
    const data = stringOf(image.data)
    if (data === undefined) continue
    out.push({
      name: stringOf(image.name) ?? '',
      bytes: Math.ceil(data.length * 3 / 4),
      ...(stringOf(image.mediaType) !== undefined ? { mediaType: image.mediaType as string } : {}),
      data,
    })
  }
  // Legacy files: a receipt is valid for one Agent only. It is kept here so a
  // send that happens while it is still live succeeds; the materializer reports
  // it as lost when it is not.
  for (const file of carrier.promptFiles ?? []) {
    const receiptId = stringOf(file.receiptId)
    if (receiptId === undefined) continue
    out.push({
      name: stringOf(file.name) ?? '',
      bytes: countOf(file.bytes) ?? 0,
      receiptId,
    })
  }
  return out
}

/** How many of each lane a set of attachments carries. */
export interface AttachmentCounts {
  images: number
  files: number
}

/**
 * The caption's reading: images are the ones with a media type, everything else
 * is a file. ONE reader for the comment thread's 「含 N 张图片 / N 个文件」, so
 * the two lanes cannot be counted by two different rules.
 * @param attachments - refs or prompt attachments (only `mediaType` is read).
 * @returns the two counts.
 */
export function attachmentCountsOf(attachments: readonly { mediaType?: string }[]): AttachmentCounts {
  let images = 0
  let files = 0
  for (const attachment of attachments) {
    if (attachment.mediaType !== undefined && attachment.mediaType !== '') images += 1
    else files += 1
  }
  return { images, files }
}
