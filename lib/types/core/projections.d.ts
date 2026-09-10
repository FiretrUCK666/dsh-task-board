/**
 * Structural projection pick: read the official session-projection values
 * riding the history tail page into the board's `TranscriptProjectionsShape`.
 *
 * `values` is typed as `Partial<SessionProjectionMap>`, a merge table whose
 * keys exist only when the domain packages are imported — this plugin never
 * imports them, so every field is read and shape-guarded structurally.
 * Anything that is not a plain object with the expected numeric fields is
 * dropped (the key's absence is handled gracefully downstream: capability
 * absence is key absence, never a crash, never a fake zero).
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
