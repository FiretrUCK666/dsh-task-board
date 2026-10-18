/** One destination the workbench can show. */
export interface WorkbenchTab {
    /** Stable id, the value `onNavigate` receives back. */
    readonly id: string;
    /** Already-localised name. */
    readonly label: string;
    /**
     * A count that belongs to this destination (「等你处理 3」 on the board,
     * 「逾期 2」 on the list). Absent or zero renders no badge: a zero badge is
     * a promise that something is there to look at.
     */
    readonly badge?: number;
    /** Full name for the pointer tooltip, when the tab label is shortened. */
    readonly title?: string;
}
export interface WorkbenchBarProps {
    /** Which destination is showing; must match one tab id. */
    readonly active: string;
    /** The destinations to offer, in reading order. */
    readonly tabs: readonly WorkbenchTab[];
    /** Accessible name for the navigation group. */
    readonly label: string;
    /**
     * The one-line state of the whole workbench ("等你处理 3 · 进行中 1").
     * Absent when there is nothing to report — an always-present line makes the
     * reader scan a readout that says "nothing" on most days.
     */
    readonly status?: string;
    /** Accessible name for the exit control. */
    readonly exitLabel: string;
    /** Leave the workbench (back to the shell's conversation). */
    readonly onExit: () => void;
    /** Go to another destination. */
    readonly onNavigate: (id: string) => void;
}
/**
 * Render the workbench bar.
 * @param props - destinations, the active one, the status line and the exit.
 * @returns the bar, as one flex row that wraps rather than hides.
 */
export declare function WorkbenchBar({ active, tabs, label, status, exitLabel, onExit, onNavigate }: WorkbenchBarProps): import("react").JSX.Element;
