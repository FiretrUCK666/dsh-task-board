import { type AttachmentRef } from '../../core/attachment.ts';
import { type EncodedImage, type ImageBudget, type ImageRejectReason } from './attach.ts';
/** One admitted attachment in a composer ledger: a durable ref plus the local
 *  key the strip needs for its chips. */
export interface DraftAttachment extends AttachmentRef {
    id: string;
}
/** Admit one picked file's bytes into the store; the ONE upload path. */
export type AttachmentAdmitter = (input: {
    name: string;
    data: string;
    mediaType?: string;
}) => Promise<{
    ok: true;
    ref: AttachmentRef;
} | {
    ok: false;
    error: string;
}>;
/**
 * 一枚芯片的本地键：**内容寻址的 id 加它在表里的位置**。
 *
 * 位置要进来，因为同一个文件可以被挂两次（两份芯片、两个删除键），而删除键只能指一个。
 * 位置让这个键**在两次渲染之间是同一个字符串**——React 靠它认得出「还是那几枚芯片」；
 * 而它**不进文档**（`refsOf` 把它丢掉），所以它变了也换不掉任何一条记录。
 */
export declare function chipKeyOf(ref: AttachmentRef, at: number): string;
/** 文档里那一份读成芯片表（`refsOf` 是反方向，两个方向只有这一对）。 */
export declare function chipsOf(refs: readonly AttachmentRef[]): DraftAttachment[];
/** 芯片表写回文档的那一份（`chipKeyOf` 的反方向）。 */
export declare function refsOf(chips: readonly DraftAttachment[]): AttachmentRef[];
/** The in-flight intake kind (what the busy line must name). */
export type IntakeBusyKind = 'image' | 'file' | 'mixed';
/** Combine per-lane in-flight counts into one label kind (pure, tested). */
export declare function busyKindOf(images: number, files: number): IntakeBusyKind | undefined;
/** A composer draft that survives unmount: text + the refs it carries. */
export interface CommentDraftSnapshot {
    text: string;
    attachments: DraftAttachment[];
    /**
     * v1 leftovers: images the OLD draft grammar kept as base64 bytes. They are
     * re-admitted on restore (one round trip), so an unsent picture is never lost
     * by an upgrade — it just arrives as a ref a moment later.
     */
    legacyImages: EncodedImage[];
}
/**
 * Encode a composer draft for the string draft store (pure, tested). Empty
 * drafts encode to '' (the store treats it as a clear).
 *
 * The payload is now tiny by construction: refs are id + name + size, so the
 * old byte cap that used to drop pictures from a full draft map is gone — every
 * attachment a reader picked is still there when they come back.
 */
export declare function encodeCommentDraft(text: string, attachments: readonly DraftAttachment[]): string;
/**
 * Decode a stored comment draft (pure, tested): the v2 ref envelope, the v1
 * envelope this revision replaced (text + inline image bytes, re-admitted on
 * restore), legacy raw text (pre-attachment drafts), or corrupt → empty.
 *
 * A v2 row is read through {@link normalizeAttachmentRefs} — the ONE ref
 * grammar this plugin has, the same one a document is ingested with. A second
 * reader here (an id/name/bytes check of its own) is how a restored picture came
 * back without the fields the store verifies its identity with: the two readers
 * agreed on three keys and disagreed about everything else.
 */
export declare function decodeCommentDraft(raw: string | undefined): CommentDraftSnapshot;
/** Whether a picked batch contains any non-image (a re-add clears stale notices). */
export declare function pickedHasFiles(files: FileList | File[]): boolean;
/** One human line for one rejection reason (locale-owned). */
export declare function rejectMessage(reason: ImageRejectReason, name: string, max?: number): string;
/** What one composer needs from its attachment ledger. */
export interface ComposerAttachments {
    attachments: readonly DraftAttachment[];
    /** Replace the ledger (composer clear after a send, chip removal, restore). */
    setAttachments: (next: readonly DraftAttachment[]) => void;
    /** Intake files (picker / drop / paste); rejections land in `error`. */
    addFiles: (files: FileList | File[]) => Promise<void>;
    /** Admit already-encoded images (the v1 draft restore path). */
    addEncoded: (images: readonly EncodedImage[]) => Promise<void>;
    /** A file is being encoded/admitted right now. */
    busy: boolean;
    /**
     * WHAT is in flight right now (the busy line's truth — never the settled
     * ledger: a file being admitted is not in the ledger yet, and naming the busy
     * line from the ledger is exactly the "传文件却显示图片压缩中" lie).
     * undefined while idle.
     */
    busyKind: IntakeBusyKind | undefined;
    /** The last rejection reason (one quiet line, replaced by the next try). */
    error: string | undefined;
    /** Spread on the composer CONTAINER so drop-anywhere and paste work. */
    dropProps: {
        'data-dsh-tb-dndover': '' | undefined;
        onDragOver: (event: React.DragEvent) => void;
        onDragLeave: (event: React.DragEvent) => void;
        onDrop: (event: React.DragEvent) => void;
        onPaste: (event: React.ClipboardEvent) => void;
    };
}
/** The one impure seam: admit bytes, hand back the durable ref. */
export interface ComposerAttachmentOptions {
    readonly budget: ImageBudget;
    readonly maxImages: number;
    readonly maxFiles?: number;
    /** The host admission (absent = the surface is read-only about attachments). */
    readonly admit?: AttachmentAdmitter;
    /** Controlled mode: the ledger lives OUTSIDE the hook (a draft that must
     *  round-trip through save/restore); absent = the hook owns it. */
    readonly controlled?: {
        attachments: readonly DraftAttachment[];
        onChange: (next: readonly DraftAttachment[]) => void;
    };
}
export declare function useComposerAttachments(options: ComposerAttachmentOptions): ComposerAttachments;
