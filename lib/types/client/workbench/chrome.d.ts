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
