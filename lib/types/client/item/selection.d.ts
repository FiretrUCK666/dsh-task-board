/**
 * Which rows the reader is holding, and the arithmetic of holding them.
 *
 * WHY IT IS A MODULE AND NOT A `useState` IN THE PANEL. Three things have to be
 * true at once and none of them is a one-liner: the selection is a SET OF
 * IDs (a row that disappears under a filter must leave the selection, or the
 * batch bar goes on writing to rows the reader can no longer see), the pickbox
 * is only paid for while the batch is ARMED (the contract is that the left edge
 * of the list moves once for the whole list, not once per row, so a resident
 * checkbox on every row of every page is exactly the price this design refuses),
 * and the batch writes are the SAME writes the single-row menu does — a second
 * implementation of 「标为受阻」 is a second answer to a question the model also
 * answers. So the state is here, pure, and the panel holds it.
 *
 * ARMING IS SEPARATE FROM SELECTING, and that is the whole shape. `armed` is
 * 「the reader asked to select things」; the ids are 「the ones they did」. A
 * reader who taps 多选 and then changes their mind has armed nothing, and the
 * cheapest honest reading of that is a bar with no actions in it — which is why
 * the bar is only drawn once there is something in it.
 *
 * DISARMING DOES NOT FORGET BY ACCIDENT, and it is worth saying which way it
 * goes: leaving the batch keeps the rows picked, because a reader who picked
 * four rows, went to look at one of them in the detail rail, and came back has
 * not changed their mind about the four. Turning 多选 OFF is the explicit act,
 * and that is the one that clears.
 */
/** The reader's holding, and whether they asked to hold at all. */
export interface ItemSelection {
    /** Whether the rows are showing a pickbox. Off means no pickbox is paid for. */
    readonly armed: boolean;
    /** The rows held, by identity — never by number, which the document may not have issued yet. */
    readonly ids: ReadonlySet<string>;
}
/** Nothing held, not armed. The state a panel opens in. */
export declare const NO_SELECTION: ItemSelection;
/** How many rows are held, which is the only number the batch bar leads with. */
export declare function selectedCount(selection: ItemSelection): number;
/**
 * Turn the pickboxes on or off.
 *
 * Switching OFF clears: that is the explicit act, and leaving the selection
 * behind would leave a state nothing on the surface can reach it from — the rows
 * would show no pickbox and the bar would be gone, so the held rows would be
 * invisible AND still writable. An invisible write is the failure this whole
 * mechanism exists to make impossible.
 * @param selection - the current holding.
 * @param armed - whether the reader wants the pickboxes.
 * @returns the next holding.
 */
export declare function setArmed(selection: ItemSelection, armed: boolean): ItemSelection;
/**
 * Hold or release one row.
 *
 * Tapping a row's pickbox while the batch is NOT armed arms it as a side effect
 * — there is no state in which a reader has expressed 「I want to select that
 * row」 and the surface has declined to show them the control for it.
 * @param selection - the current holding.
 * @param id - the row's identity.
 * @returns the next holding.
 */
export declare function togglePicked(selection: ItemSelection, id: string): ItemSelection;
/**
 * SHIFT: hold everything BETWEEN two rows, in the order the reader can see.
 *
 * The range is built from the ORDER THE READER SEES — the sorted, filtered list
 * the table actually drew — and not from the document. The difference is the whole
 * point: a reader who ticks the first row, scrolls past two rows the filter left
 * out, and shift-ticks the seventh means 「the rows between these two on this
 * screen」. A range computed over the document would hold rows that are not on the
 * screen at all, and the batch bar would then say 「已选 8 条」 over six boxes the
 * reader can point at — the exact lie this module exists to prevent.
 *
 * It is also not the same as the *filtered* set in document order, which is what
 * the select-all box counts: the page sorts what it draws, so the third row on
 * screen is not the third row of the document under any order but 「按希望在」.
 *
 * A MISSING ANCHOR IS NOT A RANGE, it is one row. Shift with nothing held has
 * nowhere to measure from, and guessing an anchor is how a press that looked like
 * 「add the next six」 ends up holding the whole list.
 *
 * HOLDING, NOT TOGGLING: the rows inside the range all become held and the ones
 * already held stay held. The alternative — flipping each one — makes the same
 * press mean a different thing depending on what happened to be selected, which
 * is the one property a range gesture must not have.
 * @param selection - the current holding.
 * @param visible - the rows on screen, in order, by identity.
 * @param anchor - the row the range starts from: the last one held by a plain press.
 * @param target - the row the range ends at.
 * @returns the next holding.
 */
export declare function pickThrough(selection: ItemSelection, visible: readonly string[], anchor: string, target: string): ItemSelection;
/**
 * Hold every row the reader can currently see, or release them all.
 *
 * `visible` rather than 「everything」 on purpose: the pickbox exists on the rows
 * on screen, so a select-all that reached past the filter would select rows the
 * reader cannot see and the bar would then say 「选了 40 条」 over a list of 8.
 * @param selection - the current holding.
 * @param visible - the rows the reader can see, by identity.
 * @param on - whether to hold all of them.
 * @returns the next holding.
 */
export declare function setAllPicked(selection: ItemSelection, visible: readonly string[], on: boolean): ItemSelection;
/**
 * Is every visible row held? What the select-all box has to draw.
 *
 * An EMPTY view is 「all held」 vacuously, and the box says so — a select-all on
 * an empty list that reports 「not all」 is a control inviting a click that does
 * nothing.
 * @param selection - the current holding.
 * @param visible - the rows the reader can see, by identity.
 * @returns whether every one of them is held.
 */
export declare function allPicked(selection: ItemSelection, visible: readonly string[]): boolean;
/**
 * Drop the rows that are no longer on screen, and stop arming if nothing is left.
 *
 * This is what keeps the bar from writing to rows the reader has lost: a filter
 * that narrows the list takes the rows it hides out of the holding, so 「选中 4 条」
 * always means four rows the reader can point at. A row that is still held after
 * its own deletion goes too, because writing to it would be a write to a tombstone.
 * @param selection - the current holding.
 * @param visible - the rows the reader can still see, by identity.
 * @param gone - rows that are no longer in the document at all, by identity.
 * @returns the next holding, or `undefined` when there is nothing left to hold.
 */
export declare function reconcile(selection: ItemSelection, visible: readonly string[], gone?: readonly string[]): ItemSelection;
