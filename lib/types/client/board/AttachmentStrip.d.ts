import type { DraftAttachment } from './composer-attachments.ts';
import type { IntakeBusyKind } from './composer-attachments.ts';
/**
 * The busy line for an in-flight intake, named by WHAT is in flight (never
 * the settled ledger — a file being admitted is not in the ledger yet).
 */
export declare function attachBusyLabel(kind: IntakeBusyKind | undefined): string;
/** Format a byte count compactly (B/KB/MB, one decimal under 100). */
export declare function formatBytes(bytes: number): string;
export declare function AttachmentStrip({ attachments, onAdd, onRemove, busy, busyLabel, error, hint }: {
    /** The ledger, in the order the reader added it. */
    attachments: readonly DraftAttachment[];
    /** Intake picked files (the hook compresses + admits + validates). */
    onAdd: (files: FileList | File[]) => void;
    onRemove: (id: string) => void;
    /** A file is being compressed/admitted right now. */
    busy?: boolean;
    /** Busy line override (uploads say uploading, not compressing). */
    busyLabel?: string;
    /** The last rejection, said out loud (never a silent drop). */
    error?: string;
    /** One quiet line under the chips (what this surface's attachments mean). */
    hint?: string;
}): import("react").JSX.Element;
