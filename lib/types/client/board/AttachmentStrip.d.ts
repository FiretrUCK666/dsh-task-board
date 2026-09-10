import type { DraftFile, DraftImage } from './attach.ts';
import type { IntakeBusyKind } from './composer-images.ts';
/**
 * The busy line for an in-flight intake, named by WHAT is in flight (never
 * the settled ledger — a staging file is not in the ledger yet). undefined
 * kind falls back to the image line (the only intake a file-lane-less
 * surface can start).
 */
export declare function attachBusyLabel(kind: IntakeBusyKind | undefined): string;
/** Format a byte count compactly (B/KB/MB, one decimal under 100). */
export declare function formatBytes(bytes: number): string;
export declare function AttachmentStrip({ images, files, onAdd, onRemoveImage, onRemoveFile, busy, busyLabel, error }: {
    images: readonly DraftImage[];
    /** Staged files (empty when the surface closes the file lane). */
    files?: readonly DraftFile[];
    /** Intake picked files (the hook encodes + stages + validates). */
    onAdd: (files: FileList | File[]) => void;
    onRemoveImage: (id: string) => void;
    onRemoveFile?: (id: string) => void;
    /** A file is encoding/uploading right now (phone photos/uploads take a beat). */
    busy?: boolean;
    /** Busy line override (file uploads say uploading, not compressing). */
    busyLabel?: string;
    /** The last rejection, said out loud (never a silent drop). */
    error?: string;
}): import("react").JSX.Element;
