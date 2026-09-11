/**
 * Client self-report: the running page tells the host which bundle it is and
 * how it actually laid out.
 *
 * The board cannot be diagnosed from the host alone — a page pinned to an old
 * artifact and a page rendering a wrong rule look identical from the outside,
 * and both look identical again in a compressed phone screenshot. This module
 * is the missing channel: one small POST per page load carrying the bundle
 * version and the measured boxes of the landmarks that matter (the search
 * field, the column strip, one pill, the columns), so the host route can hand
 * the truth back to whoever is asking.
 *
 * Diagnostic only: nothing in the board reads it, every failure is silent, and
 * the payload carries no board data — just versions and rectangles.
 * @module dsh-task-board/client/client-report
 */
/** One measured box in CSS pixels (viewport-relative). */
export interface MeasuredBox {
    top: number;
    bottom: number;
    height: number;
}
/** Landmark → class name. The caller supplies the real (scoped) class names,
 *  so this module never guesses a selector. `thumbBar` is the falsifier for
 *  the columns-vs-bar overlap: overlap ⇔ firstColumn.bottom > thumbBar.top. */
export interface LandmarkClasses {
    modes: string;
    search: string;
    strip: string;
    pill: string;
    header: string;
    columns: string;
    firstColumn: string;
    primary: string;
    thumbBar: string;
}
/** One element's box, or undefined when it is absent or has no area. */
export declare function boxOf(element: Element | null | undefined): MeasuredBox | undefined;
/** The report body the host route accepts. */
export interface ClientReportBody {
    version: string;
    href: string;
    ua?: string;
    viewport?: {
        width: number;
        height: number;
    };
    dpr?: number;
    boxes?: Record<string, MeasuredBox>;
}
/**
 * Measure the board's live geometry through the caller's own class names.
 * Reads only what exists: an unmounted board reports no boxes, never throws.
 * @param landing - the scoped class names of the landmarks.
 * @param root - the subtree to search (the document in production).
 * @returns the box map keyed by landmark name.
 */
export declare function collectBoardBoxes(landing: LandmarkClasses, root?: ParentNode): Record<string, MeasuredBox>;
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
