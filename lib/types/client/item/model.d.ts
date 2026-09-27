/**
 * Task-list derivations. Framework-free and React-free on purpose: every
 * judgment the panel makes — what a group is, what a row says, what an edit
 * changes — is decided here and nowhere else, so the same question can never
 * get two answers in one panel.
 *
 * Two rules shape everything below.
 *
 * PROGRESS IS DERIVED, NEVER STORED. `itemProgressOf` returns `undefined` when
 * an item has no steps, and the panel draws nothing at all in that case. A 0%
 * bar reads as "something failed to load"; absence reads as "there is nothing
 * here yet". Those are different facts and the panel must not blur them.
 *
 * AN EDIT THAT CHANGES NOTHING MUST NOT COMMIT. `editItem` returns the SAME
 * array when the edit is a no-op, which is the client-side counterpart of the
 * board's `userEdit` funnel: the sync replica only stamps a revision and
 * broadcasts when it is handed a different array, so a no-op that rebuilt the
 * array would wake every device for nothing.
 */
import type { ItemRecord, ItemStatusView } from '../../core/item.ts';
/** The four display groups, in the order they read top to bottom. */
export declare const ITEM_GROUPS: readonly ["inProgress", "open", "blocked", "done"];
export type ItemGroup = typeof ITEM_GROUPS[number];
/** One grouped slice of the list, already ordered. */
export interface ItemGroupSlice {
    readonly group: ItemGroup;
    readonly items: readonly ItemRecord[];
}
/** Row-height tiers. The reader picks one and we remember it. */
export type ItemDensity = 'compact' | 'comfy';
/** The filter the reader has applied. Absent means "no filter". */
export interface ItemFilter {
    /** Free text over title, body, notes and tags. */
    readonly text: string;
    /** Which groups to show; empty means all of them. */
    readonly groups: readonly ItemGroup[];
}
/** A filter that shows everything. */
export declare const NO_ITEM_FILTER: ItemFilter;
/** What one row says, decided once. */
export interface ItemRowView {
    readonly item: ItemRecord;
    /** `#12` — the number the reader and the model both call this row by. */
    readonly ref: string;
    /** Never blank: an untitled item borrows its body's first line. */
    readonly title: string;
    readonly status: ItemStatusView;
    /** `undefined` when the item has no steps — drawn as nothing at all. */
    readonly progress: {
        readonly done: number;
        readonly total: number;
        readonly ratio: number;
    } | undefined;
    /** The single right-aligned value; two candidates never both win. */
    readonly meta: ItemRowMeta;
}
/** Why a row carries its badge. */
export type ItemRowMeta = {
    readonly kind: 'none';
}
/** `3/8` — a step count, shown next to the bar and never inside it. */
 | {
    readonly kind: 'steps';
    readonly done: number;
    readonly total: number;
}
/** An overdue or near deadline wins over a step count. */
 | {
    readonly kind: 'due';
    readonly at: number;
    readonly overdue: boolean;
    readonly hard: boolean;
}
/** No deadline and no steps; the row stays quiet. */
 | {
    readonly kind: 'quiet';
};
/**
 * Build one row's view.
 *
 * The row answers THREE questions at once and the answers must fit a 300px
 * column: what is it, how far along is it, and when is it wanted. Deadline
 * beats step count because a missed date is a fact while a step count is
 * progress you chose to report.
 * @param item - the record.
 * @param linkedRunning - whether the board card this item hangs off is running.
 * @param now - the reading clock, so every row in one render agrees.
 * @returns what the row says.
 */
export declare function itemRowViewOf(item: ItemRecord, linkedRunning: boolean, now: number): ItemRowView;
/**
 * Filter, group and order the list in one pass.
 *
 * The reader is scanning, not auditing, so the order is: what is happening
 * now, what is waiting, what is stuck, what is finished — and inside a group,
 * the reader's own manual order (`order`) first, then the nearest deadline,
 * then the newest. Nothing here is stored; it is a pure function of the
 * document.
 * @param items - every item in the document.
 * @param filter - what to keep.
 * @param linkedRunning - per-item running flag, keyed by the board card id.
 * @returns one slice per non-empty group, in reading order.
 */
export declare function itemGroupSlicesOf(items: readonly ItemRecord[], filter: ItemFilter, linkedRunning: ReadonlyMap<string, boolean>): ItemGroupSlice[];
/** Whether a group opens by default. */
export declare function groupOpenByDefault(group: ItemGroup, filtering: boolean): boolean;
/** A mutation the reader made, expressed as a partial patch. */
export type ItemEdit = Partial<Pick<ItemRecord, 'title' | 'body' | 'notes' | 'status' | 'priority' | 'tags' | 'startsAfter' | 'dueAt' | 'hardDueAt' | 'taskId'>>;
/**
 * Apply one edit to one item.
 *
 * Returns the SAME array when the edit would change nothing, so the caller can
 * hand it straight to the sync replica and know no revision will be burned.
 * That is the whole point of this function existing: the AI's write path
 * stamps `updatedAt` inside `applyItemsCommit`, and a human edit that forgot to
 * check would wake every device for a keystroke that changed no fact.
 * @param items - the current list.
 * @param id - the row to change.
 * @param edit - the fields to change.
 * @param now - the edit clock; only a real change moves `updatedAt`.
 * @returns the next list, or the very same one when nothing changed.
 */
export declare function editItem(items: readonly ItemRecord[], id: string, edit: ItemEdit, now: number): readonly ItemRecord[];
/**
 * Toggle one step of one item, creating nothing.
 *
 * Steps are one level deep by model decision, so there is no recursion here
 * and none may be added: a nested checklist is the thing the narrow panel
 * cannot show and the design rules refuse to show.
 * @param items - the current list.
 * @param id - the row to change.
 * @param stepId - the step to toggle.
 * @param now - the edit clock.
 * @returns the next list, or the very same one when nothing changed.
 */
export declare function toggleItemStep(items: readonly ItemRecord[], id: string, stepId: string, now: number): readonly ItemRecord[];
/**
 * Remove one item. The document keeps its tombstone, so this is recoverable
 * through the merge grammar — the panel says so rather than pretending a
 * delete is final.
 * @param items - the current list.
 * @param id - the row to drop.
 * @returns the next list, or the very same one when it was not there.
 */
export declare function removeItem(items: readonly ItemRecord[], id: string): readonly ItemRecord[];
/**
 * The reader's chosen row height, remembered across sessions.
 *
 * A density the reader cannot change is a density they will fight. This is the
 * one preference the panel owns; everything else about the list is derived.
 * @returns the stored tier, defaulting to compact because the column is narrow.
 */
export declare function readItemDensity(): ItemDensity;
/** Remember the reader's chosen row height. */
export declare function writeItemDensity(density: ItemDensity): void;
