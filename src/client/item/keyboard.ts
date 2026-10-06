/**
 * The task list's keyboard flow: ONE map, ONE registration, ONE disposer.
 *
 * WHY A TABLE AND NOT A SWITCH STATEMENT. A keyboard flow written as a `switch`
 * is a list of key tests scattered through the code that holds the state, so the
 * set of keys is not readable anywhere: the answer to 「what can I do without a
 * mouse」 is assembled out of a dozen places, and the one that is missing is the
 * one nobody notices. Here the whole vocabulary is a value and the help sheet is
 * printed from that same value, so a key the reader can discover is a key the
 * reader can press.
 *
 * WHY THE TABLE NAMES ACTIONS INSTEAD OF HOLDING THEM. A binding that carried
 * its own callback would have to be built where the state lives, so the table
 * could not be a constant, could not be printed, and could not be checked for
 * keys with nothing behind them. Naming the action instead makes the table DATA
 * and puts one question at the registrar: **does every name in this table have a
 * handler?** A key with no handler is not a shortcut, it is a promise the
 * interface cannot keep — and the only kind of control this repository refuses
 * to ship. The check for that is one line over one array, and it is why the
 * table can be a constant at all.
 *
 * WHY THE REGISTRAR OWNS `preventDefault` AND THE SKIP. A handler that forgets
 * either produces two failures that look like nothing happening: the browser
 * scrolls the panel, or the keystroke lands in the search box and types a letter
 * into the reader's query while they meant to move a cursor. Both are silent, so
 * both are decided ONCE, here, and a binding cannot opt out by omission.
 *
 * NOTHING HERE DECIDES ANYTHING ABOUT A ROW. A binding names an ACTION and hands
 * it the row's identity; what a priority is, what today is and what a delete does
 * are all `core/item-view.ts` and `core/item-transitions.ts`, read here and by
 * `taskboard_query` alike.
 */
import type { TaskBoardKey } from '../locales.ts'

/**
 * Every action the flow can name. A name with no handler is a dead key.
 *
 * THE LAST FOUR ARE THE PALETTE'S OWN, and they are here for the same reason the
 * rest are: a key the help sheet prints must be a key the registrar can call.
 * `palettePrev` / `paletteNext` / `palettePick` share their CHORD with the row
 * cursor's `movePrev` / `moveNext` / `open`, and they are told apart by their
 * `when` — so {@link bindingFor} has to prefer a binding that APPLIES rather
 * than taking the first one that matches. That is the difference between a table
 * whose order happens to work and one whose correctness does not depend on where
 * a line was typed.
 */
export type ItemKeyAction =
  | 'quickCapture' | 'moveNext' | 'movePrev' | 'pick' | 'rename' | 'open'
  | 'close' | 'priority' | 'dueToday' | 'remove' | 'undo' | 'palette'
  | 'keyHelp' | 'palettePrev' | 'paletteNext' | 'palettePick'

/** The four tiers, in the order the digits run. */
export type ItemPriorityChoice = 'urgent' | 'high' | 'normal' | 'low'

/**
 * Which group a binding belongs to, so the help sheet is a list and not a wall.
 *
 * The groups exist so the HELP SHEET can print the map rather than restate it.
 */
export type KeyGroup = 'write' | 'move' | 'edit' | 'surface'

/** ONE BINDING: what is pressed, what it does, and the condition it needs. */
export interface KeyBinding {
  /** What the reader presses, in the words the help sheet uses. */
  readonly keys: string
  /** `KeyboardEvent.key`, lower-cased. */
  readonly key: string
  /** Whether the platform's command modifier is held. */
  readonly cmd?: boolean
  /** Whether shift is held. */
  readonly shift?: boolean
  /**
   * Whether the binding is a COMMAND even inside a text field.
   *
   * THIS IS THE RULE, STATED PER KEY, because the rule used to live inside one
   * boolean: `usable()` skipped every bare key while the reader was typing
   * except the two keys (`Esc`, `↵`) someone had remembered to spell out. Two
   * keys written inside a condition is a list that lives apart from the table,
   * so the next command that belongs there has to be found before it can be
   * added. Here the exception travels with the binding.
   *
   * It is opt-IN for the same reason the skip is opt-out: a key that applies
   * while the reader is typing is a key that can never be typed, so it has to be
   * said out loud on the binding rather than inferred.
   */
  readonly typing?: boolean
  /**
   * Whether the binding is a TEXT-EDITING gesture that must never be stolen
   * from a field. `⌘Z` and `⌘⌫` are how a reader undoes typing and deletes a
   * word; intercepting them behind the caret is the silent loss of the input's
   * own undo. Unlike `typing`, this is opt-OUT: a chord that IS text editing
   * must SAY so, and the default is that cmd chords are deliberate gestures.
   */
  readonly notWhileTyping?: boolean
  readonly group: KeyGroup
  /** What it does, as a dictionary key — typed, so a typo cannot ship a blank word. */
  readonly what: TaskBoardKey
  /** The action this binding names. */
  readonly action: ItemKeyAction
  /** The argument it carries, when it carries one. */
  readonly arg?: ItemPriorityChoice
  /**
   * Whether the binding applies at all right now.
   *
   * `Escape` is always BOUND but only does something when there is something to
   * close, and that is the difference between a key that is disabled and a key
   * that is not bound: a bound-but-inert key is still swallowed, so `Esc` in an
   * empty panel does not scroll the page.
   */
  readonly when?: (state: KeyState) => boolean
}

/** What the flow knows when a key is pressed. */
export interface KeyState {
  /** The row the cursor is on, or `undefined` before one is chosen. */
  readonly focusedId: string | undefined
  /** Whether anything at all is open — a menu, a row's detail, the palette. */
  readonly somethingOpen: boolean
  /**
   * Whether the COMMAND PALETTE is the thing that is open.
   *
   * A SEPARATE FIELD rather than a reading of `somethingOpen`, and the reason is
   * the arrows. `↑` `↓` move the row cursor, and they also move the palette's
   * candidate cursor; `somethingOpen` is true for a row menu and an expanded row
   * as well, so a predicate written against it would hand the palette's bindings
   * to a menu that happens to be open — and since the table is searched in order,
   * the row cursor's binding would quietly win and the palette's would be the
   * unreachable one. 「Something is open」 and 「the palette is what is open」 are
   * two facts, and merging them is how one key ends up doing two things.
   */
  readonly paletteOpen: boolean
}

/**
 * THE MAP. Every key the panel answers to is here and nowhere else.
 *
 * THE NUMBERS ARE PRIORITIES, and that is a product decision rather than a
 * typographical one: `!1`–`!4` are what a reader of this model already types,
 * and a digit that switched pages would break that association on the one page
 * where typing is the main activity. Changing page is the tablist's `←`/`→`,
 * which is where a reader who wants to change page is already looking.
 *
 * `⌘⌫` DELETES and is not its own inverse: the receipt carries the undo, and an
 * undo that is also the thing it undoes is a control whose meaning depends on the
 * last thing that happened.
 *
 * THE PALETTE'S SHARE OF THE ARROWS IS NOT A SHORTCUT CUT IN HALF. `↑` `↓` `↵`
 * carry their meaning with them: inside the palette they move the candidate and
 * run it, outside it they move the row and open it. Each pair is separated by
 * `when`, and {@link bindingFor} prefers the binding that applies — so the
 * palette works whether the caret is in its field or on one of its chips.
 *
 * `?` IS A BARE KEY, and that is the whole answer to 「how is a key that you type
 * inside a text field ever a shortcut」. It is not one while the caret is in a
 * field, because a key bound inside a field can never be typed — and the one
 * place the reader would most want it is exactly there. So `?` follows the rule
 * the rest of the table follows (panel has the focus, nothing is being typed),
 * and the palette — which is where the caret always is — carries a `?` button
 * that a finger can reach. Two ways in beats one key that only works sometimes.
 */
export const ITEM_KEYS: readonly KeyBinding[] = [
  { keys: 'A', key: 'a', group: 'write', what: 'item.keys.quickCapture', action: 'quickCapture' },
  { keys: '⌘K', key: 'k', cmd: true, group: 'surface', what: 'item.keys.palette', action: 'palette' },
  { keys: '/', key: '/', group: 'surface', what: 'item.keys.palette', action: 'palette' },
  { keys: '?', key: '?', shift: true, group: 'surface', what: 'item.keys.keyHelp', action: 'keyHelp' },
  { keys: 'J', key: 'j', group: 'move', what: 'item.keys.next', action: 'moveNext', when: s => !s.paletteOpen },
  { keys: 'K', key: 'k', group: 'move', what: 'item.keys.prev', action: 'movePrev', when: s => !s.paletteOpen },
  { keys: '↓', key: 'arrowdown', group: 'move', what: 'item.keys.next', action: 'moveNext', when: s => !s.paletteOpen },
  { keys: '↑', key: 'arrowup', group: 'move', what: 'item.keys.prev', action: 'movePrev', when: s => !s.paletteOpen },
  { keys: '↓', key: 'arrowdown', group: 'move', what: 'item.keys.paletteNext', action: 'paletteNext', typing: true, when: s => s.paletteOpen },
  { keys: '↑', key: 'arrowup', group: 'move', what: 'item.keys.palettePrev', action: 'palettePrev', typing: true, when: s => s.paletteOpen },
  { keys: 'X', key: 'x', group: 'edit', what: 'item.keys.pick', action: 'pick', when: s => s.focusedId !== undefined && !s.somethingOpen },
  { keys: 'E', key: 'e', group: 'edit', what: 'item.keys.rename', action: 'rename', when: s => s.focusedId !== undefined && !s.somethingOpen },
  { keys: '↵', key: 'enter', group: 'edit', what: 'item.keys.open', action: 'open', typing: true, when: s => s.focusedId !== undefined && !s.paletteOpen && !s.somethingOpen },
  { keys: '↵', key: 'enter', group: 'edit', what: 'item.keys.palettePick', action: 'palettePick', typing: true, when: s => s.paletteOpen },
  { keys: 'Esc', key: 'escape', group: 'surface', what: 'item.keys.close', action: 'close', typing: true },
  { keys: '1', key: '1', group: 'edit', what: 'item.keys.priorityUrgent', action: 'priority', arg: 'urgent', when: s => s.focusedId !== undefined && !s.somethingOpen },
  { keys: '2', key: '2', group: 'edit', what: 'item.keys.priorityHigh', action: 'priority', arg: 'high', when: s => s.focusedId !== undefined && !s.somethingOpen },
  { keys: '3', key: '3', group: 'edit', what: 'item.keys.priorityNormal', action: 'priority', arg: 'normal', when: s => s.focusedId !== undefined && !s.somethingOpen },
  { keys: '4', key: '4', group: 'edit', what: 'item.keys.priorityLow', action: 'priority', arg: 'low', when: s => s.focusedId !== undefined && !s.somethingOpen },
  { keys: 'D', key: 'd', group: 'edit', what: 'item.keys.dueToday', action: 'dueToday', when: s => s.focusedId !== undefined && !s.somethingOpen },
  { keys: '⌘⌫', key: 'backspace', cmd: true, notWhileTyping: true, group: 'write', what: 'item.keys.remove', action: 'remove', when: s => s.focusedId !== undefined },
  { keys: '⌘Z', key: 'z', cmd: true, notWhileTyping: true, group: 'write', what: 'item.keys.undo', action: 'undo' },
]

/** The handler for one action. Returning nothing is fine; throwing is not. */
export type ItemKeyHandler = (arg: ItemPriorityChoice | undefined) => void

/**
 * EVERY ACTION, as a CLOSED record.
 *
 * Closed because that is what makes the dead-key question answerable: a name
 * added to `ItemKeyAction` without a member here is a COMPILE ERROR, so the table
 * can never name an action the panel cannot perform. With a `Partial` record the
 * same omission would be a key that silently does nothing — the one defect this
 * whole module is arranged to prevent, arriving through the module built to
 * prevent it.
 */
export type ItemKeyActions = Readonly<Record<ItemKeyAction, ItemKeyHandler>>

/** The event fields the flow reads. Narrower than `KeyboardEvent` on purpose. */
export type KeyEventLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'target'>

/** Whether a key event is TYPING — the one thing that suspends the flow. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as (HTMLElement & { isContentEditable?: boolean }) | null
  if (element === null || element === undefined) return false
  if (element.isContentEditable === true) return true
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Whether the platform's command modifier is held — ⌘ on macOS, Ctrl elsewhere. */
export function isCommand(event: KeyEventLike): boolean {
  return event.metaKey === true || event.ctrlKey === true
}

/**
 * A BARE KEY IS SKIPPED WHILE THE READER IS TYPING, and this is the rule that
 * makes the flow safe to have at all: `j`, `k` and `d` are letters, and a reader
 * searching for 「jdk」 must get three letters rather than two letters and a
 * cursor jump. `⌘`-held chords are NOT skipped, because those are deliberate
 * gestures rather than typing, and the few keys that are commands even inside a
 * field — `Esc`, `↵`, the palette's own arrows — SAY SO on their binding.
 */
function usable(binding: KeyBinding, event: KeyEventLike): boolean {
  if (binding.key !== event.key.toLowerCase()) return false
  if ((binding.cmd === true) !== isCommand(event)) return false
  if ((binding.shift === true) !== (event.shiftKey === true)) return false
  if (isTypingTarget(event.target)) {
    if (binding.notWhileTyping === true) return false
    if (binding.cmd !== true && binding.typing !== true) return false
  }
  return true
}

/**
 * THE BINDING A KEY EVENT IS, or `undefined` when this keystroke is not ours.
 *
 * TWO QUESTIONS, NOT ONE. Which bindings a chord REACHES is a property of the
 * table; which of them APPLIES is a property of the surface. Returning the first
 * match — the whole of what this used to do — made the table's ORDER the thing
 * that decided behaviour, which is invisible in review and breaks the day a line
 * is moved: the palette's `↵` sits below the row's `↵`, and the row's wins the
 * moment the caret is not in the palette's field.
 *
 * So the applicable binding wins, and the first match is still returned when none
 * of them applies, because a key that is bound but inert must be swallowed.
 *
 * @param event - the key event.
 * @param state - what the flow knows right now.
 * @returns the binding that applies, else the first one that matches, else nothing.
 */
export function bindingFor(event: KeyEventLike, state: KeyState): KeyBinding | undefined {
  const matched = ITEM_KEYS.filter(binding => usable(binding, event))
  return matched.find(binding => binding.when === undefined || binding.when(state)) ?? matched[0]
}

/**
 * WHETHER THE SURFACE SHOULD TAKE THE EVENT BACK — deliberately not the same
 * question as 「does it do something」.
 *
 * A key that is bound but inert (nothing to close, no row under the cursor) is
 * still ours, and must still be swallowed: otherwise `Esc` in an empty panel
 * scrolls the page and `j` at the end of the list jumps the viewport with a
 * chime. Both look like nothing happening, and one of them is.
 */
export function claimsKey(event: KeyEventLike): boolean {
  return ITEM_KEYS.some(binding => usable(binding, event))
}

/** The bindings of one group, in table order — the help sheet reads this. */
export function keysInGroup(group: KeyGroup): readonly KeyBinding[] {
  return ITEM_KEYS.filter(binding => binding.group === group)
}

/**
 * RUN ONE KEY EVENT, as a pure function.
 *
 * Pure so the whole table can be checked without a DOM: a keyboard flow whose
 * only evidence is that pressing a key on a rendered page did something cannot
 * be checked for the keys it gets WRONG, and a keyboard flow with a wrong key is
 * invisible to its reader too.
 * @returns whether the event was ours and should not travel further.
 */
export function dispatchKey(event: KeyEventLike, state: KeyState, actions: ItemKeyActions): boolean {
  const binding = bindingFor(event, state)
  if (binding === undefined) return false
  if (binding.when !== undefined && !binding.when(state)) return true
  actions[binding.action](binding.arg)
  return true
}
