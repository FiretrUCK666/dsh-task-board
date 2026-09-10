/**
 * Browser attachment intake: turn picked/pasted/dropped Files into the forms
 * the OFFICIAL native prompt parts carry. Two lanes, one hook:
 *
 *  - IMAGES (png/jpeg/webp/gif — the native whitelist) are RE-ENCODED
 *    through a canvas downscale (longest edge + quality), so a 12 MB phone
 *    photo becomes a sub-megabyte JPEG/WebP in the browser BEFORE it goes on
 *    the wire — sending is fast and the model still sees the picture. A
 *    silent drop on any unsupported type (the old 「电脑端发不了图」: BMP /
 *    HEIC / screenshots pasted, all discarded without a word) is a contract
 *    violation: every rejection names its reason to the user.
 *  - animated GIFs pass through untouched (a canvas would flatten them)
 *    while still bounded by the byte budget.
 *  - FILES (everything else: pdf/txt/md/zip/video/…) never enter the image
 *    lane. They ride the OFFICIAL file channel instead: the browser uploads
 *    the exact bytes through `fileUploads/upload` (or the binary HTTP
 *    fallback) and the prompt carries only the opaque `{type:'file',
 *    receiptId}` ref. The board never invents a file wire shape and never
 *    base64s file bytes into an image part.
 *
 * The HOST performs the durable admission when it takes the prompt (image
 * bytes are temporary, file refs are staged per-Agent), so the board never
 * uploads through a side channel — there is exactly one mechanism per lane,
 * both shared with the native composer. The pure decision + result-parsing
 * halves are framework-free and unit-tested; only the decode/encode middle
 * touches the DOM.
 */
import type { PromptImage } from '../../core/controller.ts';
import { IMAGE_MEDIA_TYPES } from '../../core/tasks.ts';
/** The accepted raster media types — the core table (the intake gate AND
 *  every storage wall read one table, never two). */
export { IMAGE_MEDIA_TYPES };
/** An encoded, ready-to-send browser image. */
export interface DraftImage {
    /** Stable local identity for the composer strip. */
    id: string;
    /** Base64 payload (data URL already stripped): the wire `data` field. */
    data: string;
    /** Encoded media type (always inside the native whitelist). */
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
    /** Browser display name (never an OS path). */
    name: string;
}
/** The official temporary-bytes part for one draft image. */
export declare function toPromptImage(image: DraftImage): PromptImage;
/** The accepted raster media types — re-exported from the core table (the
 *  intake gate AND every storage wall read one table, never two). */
/** Why one file never became a draft attachment (each maps to a visible reason). */
export type ImageRejectReason = 'type' | 'size' | 'decode' | 'count';
/** The file lane: a staged upload the prompt references by receipt. */
export interface DraftFile {
    /** Stable local identity for the composer strip. */
    id: string;
    /** Opaque receipt from a preceding `fileUploads/upload` on the SAME session. */
    receiptId: string;
    /** The file's display name + byte size (never an OS path). */
    name: string;
    /** Exact byte size (files carry no admission limits — shown, not gated). */
    bytes: number;
}
/** The official file prompt part for one staged file. */
export declare function toPromptFilePart(file: DraftFile): {
    type: 'file';
    receiptId: string;
};
/** A staged file as the controller's PromptFile (receipt + name + bytes). */
export declare function toPromptFile(file: DraftFile): {
    receiptId: string;
    name: string;
    bytes: number;
};
/** The outcome of intake for one file: an image, or the reason it was not. */
export type IntakeOutcome = {
    ok: true;
    image: DraftImage;
} | {
    ok: false;
    reason: ImageRejectReason;
    name: string;
};
/** A per-surface size budget: what "an image" may cost once encoded. */
export interface ImageBudget {
    /** Longest edge in pixels after re-encode (gif passthrough ignores it). */
    maxEdge: number;
    /** Hard cap on the ENCODED bytes (post-compression). */
    maxBytes: number;
    /** Canvas quality for lossy re-encode (jpeg/webp). */
    quality: number;
}
/** The comment composer: generous — the wire carries it once, per send. */
export declare const COMMENT_IMAGE_BUDGET: ImageBudget;
/** Task-prompt images PERSIST in the shared board document (every device
 *  syncs them), so the budget is deliberately tight: a few hundred KB each,
 *  a handful per task. */
export declare const TASK_IMAGE_BUDGET: ImageBudget;
/** How many images a task's execution prompt may carry (persisted payload). */
export declare const MAX_TASK_IMAGES = 3;
/** How many images one comment send may carry (transient wire payload —
 *  generous, but a hard edge so a whole album drop cannot balloon one send). */
export declare const MAX_COMMENT_IMAGES = 9;
/** How many non-image files one send may carry (the twin cap of images —
 *  files ride receipts, not bytes, but the strip still needs an edge). */
export declare const MAX_COMMENT_FILES = 5;
/**
 * PURE decision for one candidate file (unit-tested): the intake route.
 * Images route to the canvas lane; EVERYTHING else routes to the file lane
 * (upload-then-receipt) — a non-image is never a "type rejection" anymore.
 * A pre-compression image may exceed maxBytes and still be fine (the
 * re-encode shrinks it), so size only rejects a PASSTHROUGH (gif) or the
 * final encoded result — never a re-encode candidate up front.
 */
export declare function intakeDecision(type: string, size: number, budget: ImageBudget): {
    kind: 'passthrough';
    mediaType: 'image/gif';
} | {
    kind: 'reencode';
} | {
    kind: 'file';
} | {
    kind: 'reject';
    reason: ImageRejectReason;
};
export declare function finishEncoded(dataUrl: string, name: string, budget: ImageBudget): IntakeOutcome;
/** Scale a length so the longest edge is at most `maxEdge`. */
export declare function scaleToFit(width: number, height: number, maxEdge: number): {
    w: number;
    h: number;
};
/**
 * Encode one image File into the wire form under `budget` (browser-only
 * middle: decode → canvas downscale → re-encode; the decision and the result
 * gate are the pure functions above). NEVER throws; every failure is an
 * IntakeOutcome with a reason the composer shows.
 */
export declare function encodeImageFile(file: File, budget?: ImageBudget): Promise<IntakeOutcome>;
