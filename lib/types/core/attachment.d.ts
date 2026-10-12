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
    attachmentId: string;
    /** Display name, already stripped of any local path by the store. */
    name: string;
    /** Exact byte length (shown, never a gate here). */
    bytes: number;
    /** Present for images: the display lane and the prompt part's media type. */
    mediaType?: string;
    /** Present for images: intrinsic size, used by the thumbnail's box. */
    width?: number;
    height?: number;
}
/**
 * One attachment as the SEND path needs it: exactly one source of bytes, in
 * order of preference. A new record fills `attachmentId`; an older one fills
 * `data` (temporary bytes, self-contained) or `receiptId` (a per-Agent stage
 * that dies with its session). The materializer picks the first available
 * source and reports honestly when a source is gone.
 */
export interface PromptAttachment {
    name: string;
    bytes: number;
    /** Images only — the wire part's media type. */
    mediaType?: string;
    /** Durable source: read the bytes back from the official store. */
    attachmentId?: string;
    /** Legacy source: the temporary-bytes part this record was born with. */
    data?: string;
    /** Legacy source: a staged receipt, valid only for its own session. */
    receiptId?: string;
}
/** The record fields {@link attachmentsOf} reads (all three ages). */
export interface AttachmentCarrier {
    attachments?: AttachmentRef[];
    /** Legacy: base64 temporary bytes persisted by an older revision. */
    promptImages?: readonly {
        mediaType?: string;
        data?: string;
        name?: string;
    }[];
    /** Legacy: staged receipts persisted by an older revision. */
    promptFiles?: readonly {
        receiptId?: string;
        name?: string;
        bytes?: number;
    }[];
}
/**
 * Normalize one persisted attachment list: unusable rows are dropped, a usable
 * row keeps only the fields this model knows. A row without an id cannot be
 * read back from the store, so it is not an attachment here.
 * @param raw - the persisted value.
 * @returns the refs, or undefined when there are none.
 */
export declare function normalizeAttachmentRefs(raw: unknown): AttachmentRef[] | undefined;
/**
 * Every attachment one record carries, in document order, whichever age wrote
 * it. THE one bridge: the send path, the caption and the surfaces all read
 * this, so a legacy document cannot be visible to one of them and invisible to
 * another.
 * @param carrier - the record (or any object carrying the three field ages).
 * @returns the attachments as the send path consumes them.
 */
export declare function attachmentsOf(carrier: AttachmentCarrier | undefined): PromptAttachment[];
/** How many of each lane a set of attachments carries. */
export interface AttachmentCounts {
    images: number;
    files: number;
}
/**
 * The caption's reading: images are the ones with a media type, everything else
 * is a file. ONE reader for the comment thread's 「含 N 张图片 / N 个文件」, so
 * the two lanes cannot be counted by two different rules.
 * @param attachments - refs or prompt attachments (only `mediaType` is read).
 * @returns the two counts.
 */
export declare function attachmentCountsOf(attachments: readonly {
    mediaType?: string;
}[]): AttachmentCounts;
