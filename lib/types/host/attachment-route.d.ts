/**
 * Attachment bridge (host): admits browser-attached images to the durable
 * attachment service and hands back their refs, so the board's composer can
 * submit a prompt with `{ type: 'image', attachment }` content blocks —
 * exactly the shape the native composer produces. The bridge stays narrow
 * and structurally tolerant: no attachments service means every request
 * fails softly with a clear envelope, never a crash.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
/** One accepted image wire entry from the browser. */
export interface AttachmentWireImage {
    /** Declared raster media type (png/jpeg/webp/gif). */
    mediaType: string;
    /** Canonical base64 encoding of the image bytes. */
    data: string;
    /** Optional display name (never a path). */
    name?: string;
}
/** The request body: ordered wire images to admit. Each entry stays unknown —
 *  the browser body is never trusted past this point; normalizeWireImage
 *  shape-guards every entry downstream. */
export interface AttachImagesRequest {
    images: unknown[];
}
/** The durable attachment refs returned to the browser (mirror of
 *  ImageAttachmentRef, narrowed structurally). */
export interface AttachImageRefView {
    attachmentId: string;
    mediaType: string;
    bytes: number;
    width: number;
    height: number;
    name?: string;
}
/** The attachments service face (abstract; absent when not mounted). */
export interface AttachmentsFace {
    saveImages(inputs: unknown[]): Promise<unknown[]>;
}
/** Normalize an unknown wire item to a SaveImage-shaped input, or undefined. */
export declare function normalizeWireImage(value: unknown): {
    data: Uint8Array;
    mediaType: string;
    name?: string;
} | undefined;
/** Admit browser images and return durable refs (empty body = no refs). */
export declare function admitImages(attachments: AttachmentsFace | undefined, request: AttachImagesRequest | undefined): Promise<{
    refs: AttachImageRefView[];
    error?: string;
}>;
/** The bridge's own envelope (its shape is NOT the settings value envelope:
 *  ok carries refs, fail carries a stable error). The client reads exactly
 *  this shape, so nothing is cast into a foreign one. */
export type AttachEnvelope = {
    ok: true;
    refs: AttachImageRefView[];
} | {
    ok: false;
    error: {
        code: string;
        message: string;
    };
};
/** The request body cap for the bridge: the native attachment bridge admits
 *  an aggregate of ~100 MiB of images (base64-expanded), so the route must
 *  not reject a legitimate multi-image composer send before the durable
 *  service gets to apply its OWN per-image limits (the "选图后点发送毫无反应"
 *  bug was this route's inherited 1 MiB default swallowing the whole POST as
 *  an unparseable body). */
export declare const ATTACH_BODY_LIMIT_BYTES: number;
/** HTTP handler: POST /api/dsh-task-board/attachments (body: admitted images).
 *  The attachments service is resolved PER REQUEST through `resolveAttachments`
 *  — never captured — so a service that mounts after the route (or remounts
 *  after a host reload) still serves admissions. */
export declare function createAttachHandler(resolveAttachments: () => AttachmentsFace | undefined, admit?: (attachments: AttachmentsFace | undefined, request: AttachImagesRequest | undefined) => Promise<{
    refs: AttachImageRefView[];
    error?: string;
}>, bodyLimitBytes?: number): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/** Mount the attachment bridge on the host web surface. */
export declare function registerAttachRoute(ctx: Context): () => void;
