/**
 * Three pure edits to a checklist, and the one thing none of them may do.
 *
 * WHY THIS IS NOT IN THE VIEW. A row's steps are read by the row line, the detail
 * pane and the model's `item.update`, and they are WRITTEN from a touch control
 * (a ⋯ menu), from the detail pane and from a keyboard flow. Three writers means
 * three places that could each decide what 「把这一步挪上去」 means at the end of
 * the list, and the list is the reader's own words in the reader's own order —
 * the one thing on this surface where a quiet disagreement is a loss.
 *
 * SO EACH EDIT IS A FUNCTION THAT TAKES A LIST AND ANSWERS A LIST, and the panel
 * hands the answer to the shared writer (`applyItemPatch`) rather than building
 * the row itself. That is the same seam every other field on this panel crosses,
 * and crossing it here too is what makes a step edited by thumb and a step edited
 * by the model the same edit rather than two documents.
 *
 * THE ONE THING NONE OF THEM MAY DO is renumber the steps that are staying. An id
 * is how a step is ADDRESSED — `item.step` takes it as a parameter and a writer
 * quotes it back — so reordering must move whole entries, never rebuild the list
 * from positions. The bug this prevents is concrete: moving the last step up
 * rebuilds the list, the first step's id becomes the third step's id, and the
 * model is then asked about a step that means something else.
 */
import type { ItemStep } from '../../core/item.ts';
/**
 * Add one line at the end, or hand the same list back.
 *
 * A BLANK LINE IS NOT A STEP, and the blank is decided here rather than by the
 * field that typed it: a capture surface whose 「加一步」 button can file an empty
 * checkbox is a checklist that fills itself with furniture. The same list coming
 * back is what tells the caller there was nothing to write, so the button can
 * refuse itself instead of the document growing a row that says nothing.
 * @param steps - the steps as they stand.
 * @param itemId - the row the step belongs to, which its id is derived from.
 * @param text - what the reader typed.
 * @returns the next list, or the very same one.
 */
export declare function addStep(steps: readonly ItemStep[], itemId: string, text: string): readonly ItemStep[];
/**
 * Take one step off, and answer the same list when the name holds nothing.
 * @param steps - the steps as they stand.
 * @param stepId - which step.
 * @returns the next list, or the very same one.
 */
export declare function removeStep(steps: readonly ItemStep[], stepId: string): readonly ItemStep[];
/**
 * Move one step one place, and answer the same list at either end of the list.
 *
 * CLAMPING AND NOT WRAPPING: 「往上挪」 on the first step does nothing, where a
 * wrap would drop it at the bottom — and a control whose press moves a line to
 * the other end of a checklist is a control nobody presses twice. The first and
 * the last step are therefore answered with the same array, which is also what
 * tells the panel not to burn a revision on a press that cannot do anything.
 * @param steps - the steps as they stand.
 * @param stepId - which step.
 * @param by - `-1` for up, `1` for down.
 * @returns the next list, or the very same one.
 */
export declare function moveStep(steps: readonly ItemStep[], stepId: string, by: -1 | 1): readonly ItemStep[];
