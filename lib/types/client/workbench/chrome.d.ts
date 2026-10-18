/**
 * The workbench's addresses and the bar's chrome, in one place.
 *
 * TWO THINGS LIVE HERE, for the same reason: they are the only facts every page
 * and the assembly layer must agree on, and a second copy of either drifts
 * silently.
 *
 *   1. THE KEYS. A page's `main` slot key, its sidebar row id and the workbench
 *      tab id are the same string (the shell resolves a row to its stage by id).
 *      They used to be authored in two files; a tab that spelled it differently
 *      would be a tab that opens a panel the shell never registered, and the
 *      only symptom is a click that does nothing.
 *   2. THE CHROME. Three pages render the same bar. Building its tabs, labels
 *      and status line in one function is what stops page two from showing a
 *      count that page one does not.
 *
 * WHY THE PAGE LIST IS REGISTRY STATE AND NOT A PROP OF EACH PANEL. The plugin
 * page has one switch per surface; a switched-off page must not appear as a tab
 * anyone can press. The browser already asks the host which surfaces are on (see
 * `surfaces.ts`), and the entry remembers the answer here so the bar can render
 * exactly the destinations that exist. An unknown answer means "all three",
 * matching the registration's own failure direction.
 */
import type { WorkbenchCounts } from '../../core/workbench-summary.ts';
import type { WorkbenchTab } from '../design/WorkbenchBar.tsx';
/** The three pages, in reading order. */
export declare const WORKBENCH_PAGES: readonly ["home", "board", "items"];
/** A page of the workbench. */
export type WorkbenchPage = (typeof WORKBENCH_PAGES)[number];
/**
 * The three slot keys, authored ONCE.
 *
 * `main` key = sidebar row id = tab id. The plugin id is the prefix, exactly as
 * the naming matrix requires: `dsh-task-board` is the plugin, and each surface
 * adds one noun.
 */
export declare const WORKBENCH_KEYS: {
    readonly home: "dsh-task-board-home";
    readonly board: "dsh-task-board";
    readonly items: "dsh-task-board-items";
};
/**
 * Record which pages exist.
 * @param pages - the pages whose rows the host reported as loaded.
 */
export declare function setWorkbenchPages(pages: readonly WorkbenchPage[]): void;
/** What the bar needs to render, for the page asking. */
export interface WorkbenchChrome {
    readonly tabs: readonly WorkbenchTab[];
    readonly status: string | undefined;
    readonly exitLabel: string;
    readonly onNavigate: (id: string) => void;
    readonly onExit: () => void;
}
/**
 * Build the bar's props.
 *
 * Called during render, so the counts are as fresh as the page itself. Counts
 * for a page that is switched off are not shown anywhere: a number that leads to
 * a destination the reader cannot open is worse than no number.
 * @returns the bar's props.
 */
export declare function workbenchChromeOf(): WorkbenchChrome;
/** Re-exported for callers that only need the count shape. */
export type { WorkbenchCounts };
