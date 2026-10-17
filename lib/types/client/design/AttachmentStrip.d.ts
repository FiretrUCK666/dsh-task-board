/**
 * One chip as this component draws it: what to show, and which entry to hand
 * back when it is removed. Deliberately a SHAPE rather than the ledger's own
 * record — `DraftAttachment` satisfies it, and any caller with the same three
 * fields needs nothing more.
 */
export interface AttachmentChip {
    /** The ledger's local key for this entry (removal names it). */
    readonly id: string;
    /** The file's name, as chosen. */
    readonly name: string;
    /** Its size in bytes. */
    readonly bytes: number;
}
/** Format a byte count compactly (B/KB/MB, one decimal under 100). */
export declare function formatBytes(bytes: number): string;
export declare function AttachmentStrip({ attachments, onAdd, onRemove, busy, busyLabel, error }: {
    /** The chips, in the order the reader added them. */
    attachments: readonly AttachmentChip[];
    /** Intake picked files (the hook compresses + admits + validates). */
    onAdd: (files: FileList | File[]) => void;
    onRemove: (id: string) => void;
    /** A file is being compressed/admitted right now. */
    busy?: boolean;
    /** Busy line override (uploads say uploading, not compressing). */
    busyLabel?: string;
    /** The last rejection, said out loud (never a silent drop). */
    error?: string;
}): import("react").JSX.Element;
