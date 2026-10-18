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
import type { WorkbenchCounts } from '../../core/workbench-summary.ts'
import { t } from '../locales.ts'
import type { WorkbenchTab } from '../design/WorkbenchBar.tsx'
import { workbenchStage } from './stage.ts'

/** The three pages, in reading order. */
export const WORKBENCH_PAGES = ['home', 'board', 'items'] as const

/** A page of the workbench. */
export type WorkbenchPage = (typeof WORKBENCH_PAGES)[number]

/**
 * The three slot keys, authored ONCE.
 *
 * `main` key = sidebar row id = tab id. The plugin id is the prefix, exactly as
 * the naming matrix requires: `dsh-task-board` is the plugin, and each surface
 * adds one noun.
 */
export const WORKBENCH_KEYS = {
  home: 'dsh-task-board-home',
  board: 'dsh-task-board',
  items: 'dsh-task-board-items',
} as const

/** Which pages the host says are switched on; all of them until it says otherwise. */
let registered: readonly WorkbenchPage[] = WORKBENCH_PAGES

/**
 * Record which pages exist.
 * @param pages - the pages whose rows the host reported as loaded.
 */
export function setWorkbenchPages(pages: readonly WorkbenchPage[]): void {
  registered = pages
}

/** What the bar needs to render, for the page asking. */
export interface WorkbenchChrome {
  readonly tabs: readonly WorkbenchTab[]
  readonly status: string | undefined
  readonly exitLabel: string
  readonly onNavigate: (id: string) => void
  readonly onExit: () => void
}

/** The tab label per page; one table, so no page can invent a fifth name. */
const TAB_LABEL = {
  home: 'workbench.tab.home',
  board: 'workbench.tab.board',
  items: 'workbench.tab.items',
} as const satisfies Record<WorkbenchPage, string>

/**
 * Build the bar's props.
 *
 * Called during render, so the counts are as fresh as the page itself. Counts
 * for a page that is switched off are not shown anywhere: a number that leads to
 * a destination the reader cannot open is worse than no number.
 * @returns the bar's props.
 */
export function workbenchChromeOf(): WorkbenchChrome {
  const counts = workbenchStage.countsOf()
  const tabs: WorkbenchTab[] = registered.map(page => ({
    id: page,
    label: t(TAB_LABEL[page]),
    title: t(TAB_LABEL[page]),
    // One badge per destination, and only for the number that belongs to it:
    // 「等你处理」 is what the board is for, 「逾期」 is what the list is for.
    // Showing both on both would make the two tabs indistinguishable at a glance.
    ...page === 'board' && counts.demand > 0 ? { badge: counts.demand } : {},
    ...page === 'items' && counts.overdue > 0 ? { badge: counts.overdue } : {},
  }))
  const status = counts.demand === 0 && counts.running === 0
    ? undefined
    : t('workbench.status', { n: String(counts.demand), m: String(counts.running) })
  return {
    tabs,
    status,
    exitLabel: t('workbench.exit'),
    onNavigate: id => { workbenchStage.navigate(id as WorkbenchPage) },
    onExit: () => { workbenchStage.exit() },
  }
}

/** Re-exported for callers that only need the count shape. */
export type { WorkbenchCounts }
