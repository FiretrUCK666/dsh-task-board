import type { ItemRailEntry, ItemRailGroup } from '../../core/item-view.ts';
export interface ItemRailProps {
    readonly groups: readonly ItemRailGroup[];
    /** Go to a row, a page, or 「wherever this entry points」. */
    readonly onEnter: (entry: ItemRailEntry) => void;
    /** The entry the reader is standing in, if any. */
    readonly activeId: string | undefined;
    /** The month being shown, and the days that hold rows. */
    readonly month: string;
    readonly daysWithRows: readonly string[];
    readonly today: string;
    /** The day the reader is looking at, read off the query — the calendar's own
     *  「you are here」 for the cell, distinct from aria-current (the rail row). */
    readonly activeDay?: string;
    /** Whether the month grid is unfolded. The reader's own choice, defaulted by
     *  the band (see `ItemRail`): a fold is one of the six moves rule 11 allows,
     *  while `display: none` — what the phone used to get — is not. */
    readonly calendarOpen: boolean;
    readonly onToggleCalendar: () => void;
    /** Move the shown month by ±1. Two buttons rather than a text field: a month is
     *  a place you step through, and nobody types 「2026-09」 to get there. */
    readonly onShiftMonth: (by: -1 | 1) => void;
    /** Back to the month that holds today, and off whatever day was picked. */
    readonly onToday: () => void;
    /** Whether there is anything to return FROM — a month that is not today's, or a
     *  day that is picked. It greys the control rather than removing it: a control
     *  that vanishes the instant it is pressed reads as 「it broke」, and the reader
     *  gets no chance to see that the press worked. */
    readonly canReturnToToday: boolean;
    readonly onPickDay: (day: string) => void;
}
export declare function ItemRail(props: ItemRailProps): import("react").JSX.Element;
