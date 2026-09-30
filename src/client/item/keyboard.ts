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

/** Every action the flow can name. A name with no handler is a dead key. */
export type ItemKeyAction =
  | 'quickCapture' | 'moveNext' | 'movePrev' | 'pick' | 'rename' | 'open'
  | 'close' | 'priority' | 'dueToday' | 'remove' | 'undo' | 'palette'

/** The four tiers, in the order the digits run. */
export type ItemPriorityChoice = 'urgent' | 'high' | 'normal' | 'low'

/**
 * Which group a binding belongs to, so the help sheet is a list and not a wall.
 *
 * The groups exist so the HELP SHEET and the palette can both print the map
 * rather than restate it. `?` is NOT in the table below, because the sheet it
 * prints does not exist yet. An unbound key is honest — the reader presses it
 * and nothing happens, which is the same as a key that does not exist. A BOUND
 * key whose surface renders nothing is a control that promises an action, and
 * this repository refuses to ship those:
 * it is the same defect as a button that only explains itself when pressed.
 * The three belong in the table the day their surfaces land, and the
 * `ItemKeyActions` record is closed, so adding them is a compile error until a
 * handler exists for each.
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
  readonly group: KeyGroup
  /** What it does, as a dictionary key. */
  readonly what: string
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
 */
export const ITEM_KEYS: readonly KeyBinding[] = [
  { keys: 'A', key: 'a', group: 'write', what: 'item.keys.quickCapture', action: 'quickCapture' },
  { keys: '⌘K', key: 'k', cmd: true, group: 'surface', what: 'item.keys.palette', action: 'palette' },
  { keys: '/', key: '/', group: 'surface', what: 'item.keys.palette', action: 'palette' },
  { keys: 'J', key: 'j', group: 'move', what: 'item.keys.next', action: 'moveNext' },
  { keys: 'K', key: 'k', group: 'move', what: 'item.keys.prev', action: 'movePrev' },
  { keys: '↓', key: 'arrowdown', group: 'move', what: 'item.keys.next', action: 'moveNext' },
  { keys: '↑', key: 'arrowup', group: 'move', what: 'item.keys.prev', action: 'movePrev' },
  { keys: 'X', key: 'x', group: 'edit', what: 'item.keys.pick', action: 'pick', when: s => s.focusedId !== undefined },
  { keys: 'E', key: 'e', group: 'edit', what: 'item.keys.rename', action: 'rename', when: s => s.focusedId !== undefined },
  { keys: '↵', key: 'enter', group: 'edit', what: 'item.keys.open', action: 'open', when: s => s.focusedId !== undefined },
  { keys: 'Esc', key: 'escape', group: 'surface', what: 'item.keys.close', action: 'close' },
  { keys: '1', key: '1', group: 'edit', what: 'item.keys.priorityUrgent', action: 'priority', arg: 'urgent', when: s => s.focusedId !== undefined },
  { keys: '2', key: '2', group: 'edit', what: 'item.keys.priorityHigh', action: 'priority', arg: 'high', when: s => s.focusedId !== undefined },
  { keys: '3', key: '3', group: 'edit', what: 'item.keys.priorityNormal', action: 'priority', arg: 'normal', when: s => s.focusedId !== undefined },
  { keys: '4', key: '4', group: 'edit', what: 'item.keys.priorityLow', action: 'priority', arg: 'low', when: s => s.focusedId !== undefined },
  { keys: 'D', key: 'd', group: 'edit', what: 'item.keys.dueToday', action: 'dueToday', when: s => s.focusedId !== undefined },
  { keys: '⌘⌫', key: 'backspace', cmd: true, group: 'write', what: 'item.keys.remove', action: 'remove', when: s => s.focusedId !== undefined },
  { keys: '⌘Z', key: 'z', cmd: true, group: 'write', what: 'item.keys.undo', action: 'undo' },
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
 * cursor jump. `⌘`-held chords and `Esc` are NOT skipped, because those are
 * deliberate gestures rather than typing.
 */
function usable(binding: KeyBinding, event: KeyEventLike): boolean {
  if (binding.key !== event.key.toLowerCase()) return false
  if ((binding.cmd === true) !== isCommand(event)) return false
  if ((binding.shift === true) !== (event.shiftKey === true)) return false
  if (isTypingTarget(event.target) && binding.cmd !== true && binding.key !== 'escape' && binding.key !== 'enter') return false
  return true
}

/**
 * THE BINDING A KEY EVENT IS, or `undefined` when this keystroke is not ours.
 *
 * The `state` is NOT consulted here and that is deliberate: which keys are
 * BOUND is a property of the table, and which of them APPLY is a property of
 * the surface. Reading `when` here would make 「is this key ours」 depend on what
 * happens to be selected, and a key that is bound-but-inert must still be
 * swallowed so the browser does not scroll the panel.
 *
 * @param event - the key event.
 * @param state - what the flow knows right now; read by {@link dispatchKey}.
 * @returns the binding, including one whose `when` is false.
 */
export function bindingFor(event: KeyEventLike, state: KeyState): KeyBinding | undefined {
  void state
  return ITEM_KEYS.find(binding => usable(binding, event))
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
