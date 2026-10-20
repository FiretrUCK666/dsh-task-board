import type { ClientReport, ReportedBox } from '../core/client-report.ts';
/** Landmark → class name. The caller supplies the real (scoped) class names,
 *  so this module never guesses a selector. The list is exactly the landmarks
 *  the board still renders: a key whose element no longer exists reports
 *  nothing, which reads identically to "the board is not mounted" — a fact
 *  nobody can act on. */
export interface LandmarkClasses {
    modes: string;
    search: string;
    strip: string;
    pill: string;
    header: string;
    columns: string;
    firstColumn: string;
    primary: string;
}
/** One element's box, or undefined when it is absent or has no area. */
export declare function boxOf(element: Element | null | undefined): ReportedBox | undefined;
/**
 * The report body the host route accepts: the report minus the receipt
 * instant, which is the HOST's to stamp.
 *
 * It is derived from the core shape (`core/client-report.ts`) rather than
 * written out here: the browser measures and the host reads the SAME
 * description of a box, and two descriptions of a box are two chances for the
 * host to read one and the browser to send another.
 */
export type ClientReportBody = Omit<ClientReport, 'receivedAt'>;
/**
 * Measure the board's live geometry through the caller's own class names.
 * Reads only what exists: an unmounted board reports no boxes, never throws.
 * @param landing - the scoped class names of the landmarks.
 * @param root - the subtree to search (the document in production).
 * @returns the box map keyed by landmark name.
 */
export declare function collectBoardBoxes(landing: LandmarkClasses, root?: ParentNode): Record<string, ReportedBox>;
/**
 * Compose and send one report. Never throws and never blocks the board: the
 * request is fire-and-forget with a short bound.
 * @param version - the bundle version baked into this page.
 * @param landing - the scoped class names of the landmarks.
 * @param fetchImpl - fetch seam (tests).
 * @param root - the subtree to measure (tests).
 * @returns a promise that resolves once the attempt settled (success or not).
 */
export declare function sendClientReport(version: string, landing: LandmarkClasses, fetchImpl?: typeof fetch, root?: ParentNode): Promise<void>;
