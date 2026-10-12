/**
 * Browser attachment intake: turn picked/pasted/dropped Files into ONE shape
 * the whole plugin stores and sends — a durable attachment ref.
 *
 * WHY THERE IS ONLY ONE LANE TO STORE. The harness owns a durable,
 * content-addressed attachment store (`ctx.attachments`), and every surface here
 * — the task prompt, a session rule, a comment, a checklist row — admits its
 * bytes into that same store through the plugin's host route. A document then
 * carries `{attachmentId, name, bytes, mediaType?}` and nothing else, so the
 * bytes have exactly one home and every sender can materialize them later (a
 * run on another session, a cron rule firing next week, a promotion from the
 * checklist into a card).
 *
 * WHAT THIS MODULE STILL OWNS: the decision of how one picked file is prepared
 * for admission —
 *
 *  - IMAGES (png/jpeg/webp/gif — the native whitelist) are RE-ENCODED through a
 *    canvas downscale (longest edge + quality), so a 12 MB phone photo becomes a
 *    sub-megabyte JPEG/WebP in the browser BEFORE it is stored. Animated GIFs
 *    pass through untouched (a canvas would flatten them) while still bounded by
 *    the byte budget.
 *  - FILES (everything else: pdf/txt/md/zip/video/…) are uploaded byte-for-byte,
 *    never base64'd into an image part and never reshaped.
 *  - A silent drop on any unsupported type (the old 「电脑端发不了图」: BMP / HEIC
 *    / screenshots pasted, all discarded without a word) is a contract
 *    violation: every rejection names its reason to the user.
 *
 * The pure decision + result-parsing halves are framework-free and unit-tested;
 * only the decode/encode middle touches the DOM.
 */
import { IMAGE_MEDIA_TYPES } from '../../core/tasks.ts';
/** The accepted raster media types — the core table (the intake gate AND
 *  every storage wall read one table, never two). */
export { IMAGE_MEDIA_TYPES };
/** One encoded, ready-to-admit browser image. */
export interface EncodedImage {
    /** Base64 payload (data URL already stripped). */
    data: string;
    /** Encoded media type (always inside the native whitelist). */
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
    /** Browser display name (never an OS path). */
    name: string;
}
/** A per-surface size budget: what "an image" may cost once encoded. */
export interface ImageBudget {
    /** Longest edge in pixels after re-encode (gif passthrough ignores it). */
    maxEdge: number;
    /** Hard cap on the ENCODED bytes (post-compression). */
    maxBytes: number;
    /** Canvas quality for lossy re-encode (jpeg/webp). */
    quality: number;
}
/** Why one file never became a draft attachment (each maps to a visible reason). */
export type ImageRejectReason = 'type' | 'size' | 'decode' | 'count';
/** The outcome of intake for one file: an encoded image, or why it was not one. */
export type IntakeOutcome = {
    ok: true;
    image: EncodedImage;
} | {
    ok: false;
    reason: ImageRejectReason;
    name: string;
};
/** The comment composer: generous — it is stored once, then sent per message. */
export declare const COMMENT_IMAGE_BUDGET: ImageBudget;
/** Prompt images persist with the record and are read back at send time, so the
 *  budget stays deliberately tight: a few hundred KB each, a handful per card. */
export declare const TASK_IMAGE_BUDGET: ImageBudget;
/** How many images one record (task prompt / rule / comment / checklist row)
 *  may carry. */
export declare const MAX_TASK_IMAGES = 3;
/** How many images one COMMENT may carry (a conversation is not a document). */
export declare const MAX_COMMENT_IMAGES = 9;
/** How many non-image files one message may carry (the twin cap of images). */
export declare const MAX_COMMENT_FILES = 5;
/** How many images one checklist row's body may carry. */
export declare const MAX_ITEM_IMAGES = 3;
/** How many files one checklist row's body may carry. */
export declare const MAX_ITEM_FILES = 3;
/**
 * The largest file the browser will upload through the plugin's own route.
 *
 * The official file lane streams and has no limit; the plugin's route carries
 * one JSON body, so it needs an edge the user can understand — and a refusal
 * that names the number beats a request the host has to kill. Anything larger
 * is refused at pick time, in words.
 */
export declare const MAX_UPLOAD_BYTES: number;
/**
 * PURE decision for one candidate file (unit-tested): the intake route.
 * Images route to the canvas lane; EVERYTHING else routes to the file lane
 * (upload-then-receipt) — a non-image is never a "type rejection".
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
/**
 * PURE: turn an encoded data URL into the wire shape, enforcing the budget
 * and the native whitelist on the RESULT (a canvas in an exotic browser can
 * hand back a type the host would reject — that is a decode failure, said
 * out loud, never a silent drop).
 */
export declare function finishEncoded(dataUrl: string, name: string, budget: ImageBudget): IntakeOutcome;
/** Read a File's exact bytes as canonical base64 (no data-URL prefix). */
export declare function readFileBase64(file: File): Promise<string>;
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
