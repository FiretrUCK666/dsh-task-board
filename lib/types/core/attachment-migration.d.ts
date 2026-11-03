/** The meta record key that marks this pass as done. */
export declare const LEGACY_ATTACHMENT_MIGRATION_KEY = "legacyAttachmentsMovedAt";
/** One legacy image that still carries its own bytes. */
export interface LegacyImageRow {
    /** Where it sits, so the caller can write the result back. */
    readonly taskId: string;
    /** Index of the round inside that task. */
    readonly roundIndex: number;
    /** Index inside that round's `promptImages`. */
    readonly imageIndex: number;
    /** Base64 payload, no data-URL prefix. */
    readonly data: string;
    /** Declared media type, when the row had one. */
    readonly mediaType?: string;
    /** Declared name, when the row had one. */
    readonly name?: string;
}
/** What one pass did, in facts the caller can log or assert on. */
export interface LegacyAttachmentMigrationReport {
    /** Images the store accepted and that are now durable refs. */
    readonly moved: number;
    /** Images left untouched, with the reason the store would not take them. */
    readonly skipped: readonly {
        readonly row: LegacyImageRow;
        readonly reason: string;
    }[];
    /** Whether the document actually changed (a no-op pass writes nothing). */
    readonly changed: boolean;
}
/** The store face this pass needs — the same one the attachment route calls. */
export interface ImageAdmittingStore {
    saveImage(input: {
        data: Uint8Array;
        mediaType: string;
        name?: string;
    }): Promise<unknown>;
}
/**
 * Decode canonical base64, or nothing.
 *
 * Uses the same acceptance rule the attachment route uses, so a payload that
 * reaches the store here cannot be one the route would have refused.
 * @param data - base64 text.
 * @returns the bytes, or undefined when it is not base64.
 */
export declare function decodeBase64(data: string): Uint8Array | undefined;
/**
 * Collect every legacy image that still carries bytes, in document order.
 *
 * A row with no usable payload is not a migration candidate and is not reported:
 * there is nothing to move, so leaving it alone is already correct.
 * @param tasks - the document's task rows.
 * @returns the candidate rows.
 */
export declare function legacyImagesOf(tasks: readonly unknown[]): LegacyImageRow[];
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
export declare function migrateLegacyAttachments(tasks: readonly unknown[], store: ImageAdmittingStore, signal?: AbortSignal): Promise<LegacyAttachmentMigrationReport>;
