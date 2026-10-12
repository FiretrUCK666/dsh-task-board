/**
 * Attachment routes: the plugin's two doors to the harness's own attachment
 * store (`ctx.attachments`).
 *
 * POST /api/<ns>/attachments       → {ok:true, value: AttachmentRef}
 * POST /api/<ns>/attachments/read  → {ok:true, value:{name, mediaType?, bytes, data}}
 *
 * WHY THESE DOORS EXIST AT ALL. The official `fileUploads/upload` face is
 * per-SESSION (a receipt is minted for one Agent), so it cannot serve a
 * checklist row — which owns no session — and it hands back a receipt rather
 * than the durable reference a document needs to keep. The durable store itself
 * (`ctx.attachments`) has no session in its interface: it speaks in
 * content-addressed ids, which is exactly what a synced document should carry.
 * So the browser admits bytes here, the document stores the ref, and every
 * sender materializes the official prompt parts from it later.
 *
 * The bytes live where the harness already keeps them (the same store the
 * native composer uploads into); this plugin creates no directory, no second
 * copy, and no second wire shape. A host without the service keeps every other
 * feature and hides the attach affordance with a reason.
 *
 * @module dsh-task-board/host/attachment-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
/** The durable file reference the harness hands back (structural). */
interface FileRefLike {
    attachmentId: string;
    name: string;
    bytes: number;
}
/**
 * The durable image reference the harness hands back (structural) — a MIRROR of
 * the official declaration, field for field.
 *
 * It is written out in full rather than extending {@link FileRefLike}, because
 * the two official references are not the same shape with additions: an image
 * reference makes its display name OPTIONAL (the bytes are addressed by digest,
 * the name is decoration) while a file reference requires one (the name is part
 * of the object's path). A mirror is only useful if it says what the harness
 * says — `scripts/verify-host-contracts.mjs` reads this declaration out of the
 * source and reddens the moment the two drift apart, in either direction.
 */
interface ImageRefLike {
    attachmentId: string;
    /** Present when the image was submitted with a name — optional, as the harness declares it. */
    name?: string;
    bytes: number;
    mediaType: string;
    width: number;
    height: number;
    /** Present only when normalization reduced the image (carried, never read here). */
    originalDimensions?: {
        width: number;
        height: number;
    };
}
/**
 * The attachment store, read BY NAME and structurally: this plugin never
 * imports the implementing package (`pnpm verify` checks the service really
 * exists, and every call here degrades when it does not).
 */
interface AttachmentStoreLike {
    /** Deployment-resolved image policy (read, never guessed). */
    imageLimits?: {
        maxImageBytes?: number;
        mediaTypes?: readonly string[];
    };
    admitEncodedFile(input: {
        data: string;
        name?: string;
    }): Promise<FileRefLike>;
    saveImage(input: {
        data: Uint8Array;
        mediaType: string;
        name?: string;
    }): Promise<ImageRefLike>;
    readImage(ref: ImageRefLike, signal?: AbortSignal): Promise<{
        ref: ImageRefLike;
        data: Uint8Array;
    }>;
    readFileStream(ref: FileRefLike, signal?: AbortSignal): AsyncIterable<Uint8Array>;
}
/** The service face this route needs (real store or a fake). */
export interface AttachmentRouteDeps {
    /** The store, when this host has one. */
    store?: AttachmentStoreLike;
}
/**
 * Build the pure attachment route processor (unit-testable with a fake store).
 * @param deps - the store face.
 * @returns an HTTP handler for the two attachment paths.
 */
export declare function createAttachmentHandler(deps: AttachmentRouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/**
 * Register the attachment routes on the host web server.
 * @param ctx - context carrying the webServer (and, when present, the store).
 * @param ns - the plugin namespace (route path prefix).
 * @returns the route disposers, or a no-op when the web server is absent.
 */
export declare function registerAttachmentRoute(ctx: Context, ns: string): () => void;
export {};
