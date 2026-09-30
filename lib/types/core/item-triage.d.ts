/**
 * The triage strip: the sentences a reader has to act on, each with the list it
 * opens.
 *
 * WHY EVERY LINE HERE CARRIES AN ACTION. A number a reader cannot act on is a
 * scoreboard, and a scoreboard on a personal list rewards opening the app rather
 * than finishing anything. So a line is never a bare number: it is emitted
 * together with the filter it opens and the rows it counted, and that is also
 * what makes the count and the jump the SAME predicate — the filter it writes is
 * the `ItemFlag` this line is filed under, and `item-query.ts` judges that flag
 * with the same scope this module counted with.
 *
 * ONLY LINES WITH SOMETHING IN THEM EXIST. A strip that lists four zeros is four
 * rows of chrome saying nothing, and the reader learns to skip it. An empty
 * answer is a sentence on its own ("nothing is waiting"), which is a different
 * thing from four empty rows.
 */
import type { ItemRecord } from './item.ts';
import type { ItemFlag } from './item-query.ts';
/** How loudly a triage line is allowed to speak. */
export type TriageSeverity = 'warn' | 'muted';
/**
 * One line of the triage strip: a sentence, a count, and the list it opens.
 */
export interface TriageLine {
    /** Stable id, also the filter this line applies. */
    readonly id: ItemFlag;
    readonly count: number;
    readonly severity: TriageSeverity;
    /** The rows the line is about, so the jump shows exactly what the count counted. */
    readonly items: readonly ItemRecord[];
    /** The oldest untouched days among them, when the line is about neglect. */
    readonly worstDays: number | undefined;
}
/**
 * The lines the reader has to act on, loudest first, and nothing else.
 *
 * The `undated` line is here and NOT in the plan, because "no date" is a
 * decision the reader has not made yet, and it is the one line a reader can
 * always clear: schedule it, park it, or delete it.
 * @param items - every row in the document.
 * @param now - the reading clock.
 * @param staleDays - the neglect threshold.
 * @returns the lines, loudest first.
 */
export declare function triageLinesOf(items: readonly ItemRecord[], now: number, staleDays?: number): TriageLine[];
