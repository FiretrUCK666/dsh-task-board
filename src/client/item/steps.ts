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
import type { ItemStep } from '../../core/item.ts'
import { mintStepId } from '../../core/item-transitions.ts'

/**
 * A step id that is not already taken.
 *
 * `mintStepId` is positional — `${itemId}.s${position}` — and positions are
 * exactly what a reordering edit destroys, so a new step minted at 「position 2」
 * can collide with the step that is still sitting there. The suffix is a counter
 * rather than a clock for the reason the mint function's own comment gives: two
 * writers typing the same line into the same row have to arrive at the same id.
 * @param steps - the steps already on the row.
 * @param itemId - the row the new step belongs to.
 * @returns an id no existing step holds.
 */
function freshStepId(steps: readonly ItemStep[], itemId: string): string {
  const taken = new Set(steps.map(step => step.id))
  for (let at = steps.length + 1; at <= steps.length + 32; at += 1) {
    const candidate = mintStepId(itemId, at)
    if (!taken.has(candidate)) return candidate
  }
  /* 32 步在同一行里已经是另一个问题（清单页一行只画得出两三步），而这里不能
     抛：新增一步失败不该把整块面板带走。走到这里的名字必定没被占用过——位置数
     已经越过了整个列表的长度。 */
  return mintStepId(itemId, Date.now())
}

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
export function addStep(steps: readonly ItemStep[], itemId: string, text: string): readonly ItemStep[] {
  const words = text.trim()
  if (words === '') return steps
  return [...steps, { id: freshStepId(steps, itemId), text: words, done: false }]
}

/**
 * Take one step off, and answer the same list when the name holds nothing.
 * @param steps - the steps as they stand.
 * @param stepId - which step.
 * @returns the next list, or the very same one.
 */
export function removeStep(steps: readonly ItemStep[], stepId: string): readonly ItemStep[] {
  if (!steps.some(step => step.id === stepId)) return steps
  return steps.filter(step => step.id !== stepId)
}

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
export function moveStep(steps: readonly ItemStep[], stepId: string, by: -1 | 1): readonly ItemStep[] {
  const at = steps.findIndex(step => step.id === stepId)
  const to = at + by
  if (at < 0 || to < 0 || to >= steps.length) return steps
  const next = steps.slice()
  const moved = next[at] as ItemStep
  next[at] = next[to] as ItemStep
  next[to] = moved
  return next
}
