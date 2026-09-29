/**
 * What a page body is given, and why it is a contract rather than a convenience.
 *
 * THE PANEL IS AN ASSEMBLY LAYER. It owns the state every page shares — the
 * document, the clock, the view preferences, the selection — and it owns the
 * frame around them: the header, the receipt, the workbench, the detail rail.
 * What each page owns is its own body, and the only thing that crosses the line
 * is this bundle.
 *
 * So the bundle is written down. The alternative — passing fifteen positional
 * arguments, or letting a page reach back into the panel's state through a
 * closure — is how a 900-line file happens: the moment a page can read the
 * panel's internals, the page can also WRITE them, and then extracting it stops
 * being a refactor and becomes a migration. Everything a page may touch is in
 * this type, and everything else is off limits by construction.
 *
 * TWO OF THESE ARE FUNCTIONS RATHER THAN VALUES, and that is the load-bearing
 * part. `renderRows` and `renderDetail` are handed in rather than imported,
 * because the row and the detail are shared by all three pages and are the two
 * things a page must NOT grow its own copy of: a second row component is how the
 * three pages end up disagreeing about what a row says, which is the exact
 * failure the whole `core/item-view.ts` layer exists to prevent.
 */
import type { ReactNode } from 'react';
import type { ItemRecord } from '../../../core/item.ts';
import type { ItemQuery, ItemMatchContext, ItemStatusView } from '../../../core/item-view.ts';
import type { ItemViewPrefs } from '../view-prefs.ts';
import type { TaskBoardKey } from '../../locales.ts';
/** The name of each group, read off the GROUP vocabulary. */
export declare const GROUP_LABEL: Readonly<Record<ItemStatusView, TaskBoardKey>>;
/** The agenda's buckets and the word for each. */
export declare const BUCKET_LABEL: Readonly<Record<string, TaskBoardKey>>;
/** The triage sentences and the word for each line. */
export declare const TRIAGE_LABEL: Readonly<Record<string, TaskBoardKey>>;
/** What every page body receives. */
export interface ItemPageProps {
    /** Every row in the document. Pages filter; none of them owns it. */
    readonly items: readonly ItemRecord[];
    /** The reading clock, passed down so two rows cannot disagree about a day. */
    readonly now: number;
    /** Card id → whether that card is running, right now. */
    readonly running: ReadonlyMap<string, boolean>;
    /** The parsed search box. The ONLY filter on this surface. */
    readonly query: ItemQuery;
    /**
     * The matching context — clock, staleness threshold and the board's live
     * state — as ONE value, built once by the panel and handed down.
     *
     * It is passed rather than rebuilt because a page that assembles its own would
     * be a second place where a threshold is decided, and the threshold is the
     * difference between a row being reported as neglected and not. Two
     * thresholds on one page is a page that answers 「what needs you」 two ways on
     * the same morning.
     */
    readonly matchCtx: ItemMatchContext & {
        readonly running: ReadonlyMap<string, boolean>;
    };
    /** The view preferences, and the one way to change them. */
    readonly prefs: ItemViewPrefs;
    readonly choose: (next: Partial<ItemViewPrefs>) => void;
    /** Whether the detail lives in the row (narrow) or in the rail (wide). */
    readonly narrow: boolean;
    /** The one row renderer, shared by all three pages. */
    readonly renderRows: (list: readonly ItemRecord[]) => ReactNode;
    /** Whether the reader is looking at the list without a filter. */
    readonly filtering: boolean;
}
