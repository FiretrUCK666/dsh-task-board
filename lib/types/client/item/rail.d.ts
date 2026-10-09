import type { ItemRailEntry, ItemRailGroup } from '../../core/item-view.ts';
export interface ItemRailProps {
    readonly groups: readonly ItemRailGroup[];
    /** Go to a row, a page, or 「wherever this entry points」. */
    readonly onEnter: (entry: ItemRailEntry) => void;
    /**
     * **读者正站在哪些行上**，从查询里读出来的**一组**。
     *
     * 筛子是叠加的（「已超期」+「紧急」可以同时开着），所以这一侧必须是集合：它原来是一个
     * `string | undefined`，取第一个匹配的行就停——三枚芯片亮着而左栏只有一行有底色，读者看到
     * 的是「我按了三个，它只认一个」。
     */
    readonly activeIds: ReadonlySet<string>;
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
