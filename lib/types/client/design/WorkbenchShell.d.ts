/**
 * The workbench shell: ONE frame for all three pages.
 *
 * WHY THIS EXISTS AT ALL. The three pages each used to lay out their own frame:
 * the board put `padding: 14px 16px 16px` on its root, the list put the bar in
 * its own padded row and the list content below it, and the overview did the
 * same with different numbers. Every one of them was plausible on its own, and
 * together they meant the bar sat at 16/10/16 in the three pages and the gap
 * under it was 12/0/12. The reader's report was 「点总览/看板/清单，整个页面都
 * 在动」 — and they were right: three separate frames can only agree by
 * coincidence, and coincidence is what a later single edit destroys.
 *
 * THE FIX IS STRUCTURAL, NOT NUMERICAL. Aligning three numbers would have been
 * a patch: the next person to add a fourth page (or to touch one page's
 * padding) reintroduces the drift, silently. So the frame is a COMPONENT: the
 * page supplies only its content, and every geometric decision — where the bar
 * sits, how much air surrounds it, how far the content starts below it — is
 * made here, once, for all three.
 *
 * WHAT A PAGE MAY STILL DO. Its own interior: columns, rows, cards, scrolling.
 * What it may NOT do is decide its own outer air or draw its own bar. Those two
 * are the shared frame, and a page that re-derives them is a page that will one
 * day disagree with its siblings.
 *
 * WHY THE BAR IS A SIBLING OF THE SCROLLER, NOT INSIDE IT. Scrolling is the
 * page's business; a bar that scrolls away is a bar you cannot leave from. So
 * the shell is a column: the bar row (fixed), the notice strip (fixed, absent
 * when quiet), then a scroller that owns the rest.
 */
import type { ReactNode } from 'react';
import { type WorkbenchTab } from './WorkbenchBar.tsx';
import { type WorkbenchNoticeItem } from './WorkbenchNotice.tsx';
/** Everything the shared frame needs to draw itself. */
export interface WorkbenchShellProps {
    /** Which destination is showing. */
    readonly active: string;
    /** The destinations to offer. */
    readonly tabs: readonly WorkbenchTab[];
    /** Accessible name for the navigation group. */
    readonly label: string;
    /** The one-line readout; absent prints nothing but keeps the slot. */
    readonly status?: string;
    /** Whether the update check is in flight. */
    readonly checking: boolean;
    /** The update button's face. */
    readonly checkLabel: string;
    /** Run the update check. */
    readonly onCheck: () => void;
    /** Accessible name for the exit control. */
    readonly exitLabel: string;
    /** Leave the workbench. */
    readonly onExit: () => void;
    /** Go to another destination. */
    readonly onNavigate: (id: string) => void;
    /** Warnings to carry below the bar; empty renders no strip. */
    readonly notices?: readonly WorkbenchNoticeItem[];
    /**
     * Whether this page's own scroller should own the remaining height. Pages
     * whose interior manages its own scrolling (the list's rail + column, the
     * board's column strip) pass `false` and get a plain block that fills the
     * rest; a page that is one long document (the overview) passes `true`.
     */
    readonly scrolls?: boolean;
    /**
     * The page's own seat marker. Each page names its subtree so its sheet can
     * scope selectors to itself; the shell carries it so a page cannot forget it
     * (a missing marker means its whole stylesheet stops matching, silently).
     */
    readonly seat: string;
    /** The page. */
    readonly children: ReactNode;
}
/**
 * Render the shared workbench frame.
 * @param props - the bar's props, optional warnings, and the page content.
 * @returns the frame: bar row, optional warning strip, then the page.
 */
export declare function WorkbenchShell({ active, tabs, label, status, checking, checkLabel, onCheck, exitLabel, onExit, onNavigate, notices, scrolls, seat, children, }: WorkbenchShellProps): import("react").JSX.Element;
