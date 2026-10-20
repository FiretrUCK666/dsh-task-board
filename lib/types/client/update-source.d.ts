import type { UpdateApplyResult, UpdateEvidence, UpdateSourceView } from '../core/update-view.ts';
/** The bundle's own version (the host-unreachable comparison baseline). */
export declare const BUNDLED_VERSION: string;
/** The wire shapes this file reads - they live in core (one home per shape). */
export type { UpdateEvidence, UpdateSourceView, UpdateApplyResult };
/**
 * Read the installed source through the host route. An old host without the
 * route answers 404 (or hangs), which degrades to undefined like any other
 * failure — the button then compares the bundle version against npm with an
 * unknown install mode.
 * @param timeoutMs - per-request bound (default 15s, the transport's budget).
 * @returns the source view, or undefined when unreadable.
 */
export declare function fetchUpdateSource(timeoutMs?: number): Promise<UpdateSourceView | undefined>;
/**
 * Ask the host to apply the update it described. The request carries nothing:
 * the host re-derives the plan from the running copy, so the page can never
 * ask for a different installation than the one it is running in.
 *
 * The bound is generous on purpose — a package download plus a compile is
 * minutes, not seconds — and the caller re-reads the source afterwards, so an
 * answer lost to a live reload is not mistaken for a failed update.
 * @param timeoutMs - per-request bound (default 10 minutes).
 * @returns the result, or undefined when the answer never arrived.
 *
 * NOT named `applyUpdate`: that name belongs to the HOST's action (the one
 * that really installs something). This one only ASKS. Two different acts
 * under one name is how a reader stops trusting either of them.
 */
export declare function requestUpdateApply(timeoutMs?: number): Promise<UpdateApplyResult | undefined>;
