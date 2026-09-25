/**
 * Structural projection pick: read the PAGE-SCOPED session-projection values
 * riding the history tail page into the board's `TranscriptProjectionsShape`.
 *
 * `values` is typed as `Partial<SessionProjectionMap>`, a merge table whose
 * keys exist only when the domain packages are imported — this plugin never
 * imports them, so every field is read and shape-guarded structurally.
 * Anything that is not a plain object with the expected numeric fields is
 * dropped (the key's absence is handled gracefully downstream: capability
 * absence is key absence, never a crash, never a fake zero).
 *
 * WHAT DOES NOT BELONG HERE: a value describing what a session IS right now
 * rather than what it had recorded. The `permissions` projection is the case
 * that proved it — `/permission` opens no turn, so this page's copy of it
 * never refreshed and the panel displayed the value from before the user
 * changed anything. Current settings are read live instead (see
 * `SessionConfigFace.readPermission`).
 *
 * Pure and framework-free, so the pick matrix unit-tests in isolation; the
 * client wiring (`index.ts`) only calls it.
 */
import type { TranscriptLoadResult } from './controller.ts';
/**
 * Pick the board's projection slice out of the tail page's raw values.
 * Unknown, malformed or partial values are dropped key by key — one bad
 * domain never hides the rows the other domains returned.
 */
export declare function pickTranscriptProjections(values: Record<string, unknown> | undefined): Pick<TranscriptLoadResult, 'projections'>;
/** The session's LIVE permission selection, as the panel displays it. */
export interface LivePermissionShape {
    value: string;
    options: readonly {
        value: string;
        name?: string;
        description?: string;
    }[];
}
/**
 * The session's live permission selection, read from a projection BASELINE
 * (the host's own `permissions` projection — the same value its permission
 * selector displays).
 *
 * This is the panel's ONLY source, and it is deliberately not
 * {@link pickTranscriptProjections}: that one reads a history page, which is a
 * snapshot of past events. `/permission` opens no turn, so no new event ever
 * appears and a page-scoped copy of this value never refreshes — the panel read
 * it and showed the preset from before the user changed anything, for as long
 * as the panel stayed open. The live read is one explicit call, so it answers
 * "what is it NOW" and answers it again after every write.
 *
 * `undefined` = the host does not serve the projection, or serves it in a
 * shape this plugin cannot read honestly. The caller then SAYS SO; it must
 * never substitute a default, because 「默认」 is itself a claim about the
 * session's state.
 */
export declare function readPermissionProjectionOf(values: Record<string, unknown> | undefined): LivePermissionShape | undefined;
