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
  readonly armed: boolean
  /** The rows held, by identity — never by number, which the document may not have issued yet. */
  readonly ids: ReadonlySet<string>
}

/** Nothing held, not armed. The state a panel opens in. */
export const NO_SELECTION: ItemSelection = { armed: false, ids: new Set() }

/** How many rows are held, which is the only number the batch bar leads with. */
export function selectedCount(selection: ItemSelection): number {
  return selection.ids.size
}

/**
 * Turn the pickboxes on or off.
 *
 * Switching OFF clears: that is the explicit act, and leaving the selection
 * behind would leave a state nothing on the surface can reach it from — the rows
 * would show no pickbox and the bar would be gone, so the held rows would be
 * invisible AND still writable. An invisible write is the failure this whole
 * mechanism exists to make impossible.
 *
 * **ARMED WITH NOTHING HELD IS ONLY SAFE WHILE THE SCREEN HAS ROWS.** Turning the
 * mode on is the reader's act and happens before they have picked anything — that
 * is what pressing 多选 means. What is NOT safe is that state existing over an
 * empty list: the bar it draws says 「已选 0 条」 with every action greyed out, and
 * if 多选 is disabled at that moment the reader cannot leave. So the caller that
 * arms without a row in hand goes through `armFor`, which knows how many rows the
 * screen is showing. See it for the whole account.
 * @param selection - the current holding.
 * @param armed - whether the reader wants the pickboxes.
 * @returns the next holding.
 */
export function setArmed(selection: ItemSelection, armed: boolean): ItemSelection {
  if (!armed) return NO_SELECTION
  return selection.armed ? selection : { armed: true, ids: selection.ids }
}

/**
 * Turn the pickboxes on for a reader who pressed 多选 — or decline when there is
 * nothing on screen to put a pickbox on.
 *
 * **THE DEAD END.** The surface used to arm unconditionally and draw the batch
 * bar whenever `armed` was true. Over an empty list that is a bar reading
 * 「已选 0 条」 with every action greyed out — and, because 多选 also carried
 * `disabled={visibleIds.length === 0}`, no control on the page could leave the
 * mode. A reader who had just deleted everything was stuck until they found
 * `Esc`.
 *
 * **WHY THIS IS A SEPARATE ENTRY AND NOT A CHANGE TO `setArmed`.** The two
 * callers want opposite things from the same word. The pickbox on a ROW arms as
 * a side effect of holding that row (`togglePicked`), and there the row is the
 * proof that the mode has something to act on. The top-bar button arms with
 * nothing held yet — that is the point of pressing it — so it is the one caller
 * that has to know whether the screen has anything to offer. Making that
 * knowledge a parameter is the whole content of this function.
 * @param selection - the current holding.
 * @param available - how many rows the reader can point at right now.
 * @returns the next holding: armed when there is something to arm for.
 */
export function armFor(selection: ItemSelection, available: number): ItemSelection {
  if (available <= 0) return NO_SELECTION
  return setArmed(selection, true)
}

/**
 * Hold or release one row.
 *
 * Tapping a row's pickbox while the batch is NOT armed arms it as a side effect
 * — there is no state in which a reader has expressed 「I want to select that
 * row」 and the surface has declined to show them the control for it.
 *
 * **RELEASING THE LAST ROW ALSO LEAVES THE MODE**, for the reason written on
 * `reconcile`: a mode with nothing in it has nothing to act on, and the bar it
 * draws would lead with 「已选 0 条」 over an empty list. The reader who let go of
 * everything has said the same thing as one who pressed 多选 twice.
 * @param selection - the current holding.
 * @param id - the row's identity.
 * @returns the next holding.
 */
export function togglePicked(selection: ItemSelection, id: string): ItemSelection {
  const ids = new Set(selection.ids)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  if (ids.size === 0) return NO_SELECTION
  return { armed: true, ids }
}

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
 * screen is not the third row of the document under any order but 「按计划」.
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
export function pickThrough(selection: ItemSelection, visible: readonly string[], anchor: string, target: string): ItemSelection {
  const from = visible.indexOf(anchor)
  const to = visible.indexOf(target)
  if (from < 0 || to < 0) return togglePicked(selection, target)
  const ids = new Set(selection.ids)
  for (let at = Math.min(from, to); at <= Math.max(from, to); at += 1) {
    const id = visible[at]
    if (id !== undefined) ids.add(id)
  }
  return { armed: true, ids }
}

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
export function setAllPicked(selection: ItemSelection, visible: readonly string[], on: boolean): ItemSelection {
  if (on) {
    /* 全选一个**空**视图不开启模式：那会造出「手里 0 条、模式开着」那个死局。
       空视图上按全选什么都不会发生，也不该有任何东西发生。 */
    if (visible.length === 0) return selection.ids.size === 0 ? NO_SELECTION : { armed: true, ids: selection.ids }
    return { armed: true, ids: new Set(visible) }
  }
  /* 取消全选 = 手上一条都没有 = 离开这个模式（见 `reconcile` 那段判据）。
     这一支原先留着 `armed`，于是「全选之后取消全选」也留下一块「已选 0 条」的面板。 */
  return NO_SELECTION
}

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
export function allPicked(selection: ItemSelection, visible: readonly string[]): boolean {
  // NO `visible.length > 0` TERM, and its absence is the claim: `every` over an
  // empty list is already `true`, which is what 「all held」 means of a list with
  // nothing on it. A guard here would make the one answer the reader can act on
  // — the box is only drawn while there IS something to select, so this branch
  // is about the box agreeing with itself — into an invitation to press a
  // control that does nothing.
  return visible.every(id => selection.ids.has(id))
}

/**
 * Drop the rows that are no longer on screen, and stop arming if nothing is left.
 *
 * This is what keeps the bar from writing to rows the reader has lost: a filter
 * that narrows the list takes the rows it hides out of the holding, so 「选中 4 条」
 * always means four rows the reader can point at. A row that is still held after
 * its own deletion goes too, because writing to it would be a write to a tombstone.
 *
 * **A HOLDING THAT BECAME EMPTY IS NOT A MODE, IT IS NOTHING.** Arming exists to
 * pick rows; with no rows held there is nothing the mode could act on, and the
 * surface has no action that would put something back into it. Leaving `armed`
 * true produced a bar reading 「已选 0 条」 over an empty list with every action in
 * it greyed out, and the one control that could have left the mode was disabled
 * for the same reason the bar appeared — a reader who had just deleted everything
 * was stuck on a panel whose only exit was `Esc`.
 *
 * So arming is **derived from the holding**, not kept alongside it: no ids, no
 * mode. A reader who wants to pick again presses 多选 again, which is the same
 * press they made the first time.
 * @param selection - the current holding.
 * @param visible - the rows the reader can still see, by identity.
 * @param gone - rows that are no longer in the document at all, by identity.
 * @returns the next holding, or `undefined` when there is nothing left to hold.
 */
export function reconcile(selection: ItemSelection, visible: readonly string[], gone: readonly string[] = []): ItemSelection {
  if (selection.ids.size === 0) {
    /* 空手就不该还在这个模式里。这一支原先返回 `{ armed: true, ids: 空 }`，
       于是「删光之后面板不消失」——把那句判据并进下面同一条出口。 */
    return selection.armed ? NO_SELECTION : selection
  }
  const live = new Set(visible)
  const dead = new Set(gone)
  const ids = new Set([...selection.ids].filter(id => live.has(id) && !dead.has(id)))
  if (ids.size === selection.ids.size) return selection
  if (ids.size === 0) return NO_SELECTION
  return { armed: selection.armed, ids }
}
