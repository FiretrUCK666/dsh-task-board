/**
 * The rail: where a reader goes, and how much of each thing is there.
 *
 * ── WHY EVERY NUMBER ON IT IS A ROW COUNT AND NOT A LITERAL ─────────────────
 *
 * The first version of this was a table of words with numbers written into it,
 * and it was wrong in a way nothing on screen could report: the number was a
 * fixture value and the row beside it was a filter, so 「落后的 2」 and 「点进去
 * 看到几行」 were two facts that agreed only while nobody edited the data. That is
 * the exact defect PRODUCT's first invariant forbids, committed by the very
 * component meant to satisfy it.
 *
 * So the rows come FROM `itemRailGroupsOf` — each entry carries the rows it
 * holds, and its count is their length. There is no number in this file to go
 * stale, because there is no number in this file at all.
 *
 * ── WHY THE GROUPS ARE GROUPS AND NOT ONE LIST ──────────────────────────────
 *
 * A single column of grey words makes a reader treat a COLLECTION, two
 * PREDICATES and a STATUS as siblings, and they are not:
 *
 *   刚记的   一个集合——「我刚记下、还没给它任何结构的」。它是入口，也是唯一
 *            一个不带条件的入口。
 *   按条件看 四个关于**时间**的谓词。日历欠了、停了、没有日子、还没到。归成一组
 *            是因为读者扫这一组时问的是同一句：日历在跟我说什么。
 *   按重要程度 四档优先级。它们是**刻度**不是条件——所以它们是另一组。
 *   按状态   四个状态。它们是**字段的投影**，不是收窄。
 *   全部 / 已删除 两个地方，不是筛选。
 *
 * **受阻只出现在「按状态」里，不在「按条件看」里。** 一批行在一个栏里有两个身份，
 * 就是不变量 1 禁止的那种重复：两个数、两份真相，而且两边都会对，直到某天不一样。
 *
 * ── WHY 「问一句」AND 「变成看板卡片」 ARE NOT IN HERE ─────────────────────
 *
 * They act on ONE row, not on a view. A rail is a map of where you can go, and
 * putting a row action on it would make the map claim to be something it is not.
 */
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
    readonly onPickDay: (day: string) => void;
}
export declare function ItemRail(props: ItemRailProps): import("react").JSX.Element;
