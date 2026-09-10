import { type DraftFile, type DraftImage, type ImageBudget, type ImageRejectReason } from './attach.ts';
/** The in-flight intake kind (what the busy line must name). */
export type IntakeBusyKind = 'image' | 'file' | 'mixed';
/** Combine per-lane in-flight counts into one label kind (pure, tested). */
export declare function busyKindOf(images: number, files: number): IntakeBusyKind | undefined;
/**
 * Cap for persisted draft images (base64 chars, whole envelope): ONE
 * localStorage map holds EVERY draft, so an unsent 4MB phone photo must
 * never nuke the entire map silently (the store skips the whole write on
 * quota). Over the cap the images stay in memory only and the caller is
 * told (imagesDropped) so the surface can say so — text + file names
 * always persist.
 */
export declare const DRAFT_IMAGE_CHARS = 2500000;
/** A composer draft that survives unmount: text + images + lost file names. */
export interface CommentDraftSnapshot {
    text: string;
    images: DraftImage[];
    /** Names of staged files (bytes are unrecoverable after unmount — the
     *  surface names them so the user re-adds them, never silently drops). */
    fileNames: string[];
}
/**
 * Encode a composer draft for the string draft store (pure, tested). Empty
 * drafts encode to '' (the store treats it as a clear).
 */
export declare function encodeCommentDraft(text: string, images: readonly DraftImage[], files: readonly DraftFile[]): {
    value: string;
    imagesDropped: boolean;
};
/**
 * Decode a stored comment draft (pure, tested): the v1 envelope, legacy raw
 * text (pre-attachment drafts), or corrupt → empty. Chip ids regenerate (a
 * restored chip is a new chip, never a key collision across sessions).
 */
export declare function decodeCommentDraft(raw: string | undefined): CommentDraftSnapshot;
/** Whether a picked batch contains any non-image (a re-add clears the lost-file notice). */
export declare function pickedHasFiles(files: FileList | File[]): boolean;
/** One human line for one rejection reason (locale-owned). */
export declare function rejectMessage(reason: ImageRejectReason, name: string, max?: number): string;
/** Stage one file's exact bytes on a session (the official pre-step). */
export type FileStager = (sessionId: string, file: File) => Promise<{
    ok: true;
    receiptId: string;
} | {
    ok: false;
    error: string;
}>;
/** The state + affordances one composer needs for its attachments. */
export interface ComposerImages {
    images: readonly DraftImage[];
    files: readonly DraftFile[];
    /** Replace the image ledger (composer clear after a send, chip removal). */
    setImages: (next: readonly DraftImage[]) => void;
    /** Replace the file ledger. */
    setFiles: (next: readonly DraftFile[]) => void;
    /** Intake files (picker / drop / paste); rejections land in `error`. */
    addFiles: (files: FileList | File[]) => Promise<void>;
    /** A file is being encoded/uploaded right now. */
    busy: boolean;
    /**
     * WHAT is in flight right now (the busy line's truth — never the settled
     * ledger: a staging file is not in the ledger yet, and naming the busy
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
export declare function useComposerImages(budget: ImageBudget, maxImages: number, 
/** Controlled mode: the ledger lives OUTSIDE the hook (a task draft that
 *  must round-trip through save/restore); absent = the hook owns it. */
controlled?: {
    images: readonly DraftImage[];
    onChange: (next: readonly DraftImage[]) => void;
}, 
/** File-lane options: the session to stage on + the stager. Absent = the
 *  file lane is closed (images only, legacy surfaces). */
filesOpts?: {
    sessionId: string | undefined;
    stage: FileStager;
    maxFiles?: number;
}): ComposerImages;
