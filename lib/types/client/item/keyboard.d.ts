/**
 * The task list's keyboard flow: ONE map, ONE registration, ONE disposer.
 *
 * WHY A TABLE AND NOT A SWITCH STATEMENT. A keyboard flow written as a `switch`
 * is a list of key tests scattered through the code that holds the state, so the
 * set of keys is not readable anywhere: the answer to 「what can I do without a
 * mouse」 is assembled out of a dozen places. Here the whole vocabulary is one
 * value; the keyboard is a quiet capability, and the map is where it is read.
 *
 * WHY THE TABLE NAMES ACTIONS INSTEAD OF HOLDING THEM. A binding that carried
 * its own callback would have to be built where the state lives, so the table
 * could not be a constant and could not be checked for keys with nothing behind
 * them. Naming the action instead makes the table DATA and puts one question at
 * the registrar: **does every name in this table have a handler?** A key with no
 * handler is not a shortcut, it is a promise the interface cannot keep — and the
 * only kind of control this repository refuses to ship. The check for that is
 * one line over one array, and it is why the table can be a constant at all.
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
/**
 * Every action the flow can name. A name with no handler is a dead key.
 *
 * THE LAST THREE ARE THE PALETTE'S OWN. `palettePrev` / `paletteNext` /
 * `palettePick` share their CHORD with the row cursor's `movePrev` / `moveNext` /
 * `open`, and they are told apart by their `when` — so {@link bindingFor} has to
 * prefer a binding that APPLIES rather than taking the first one that matches.
 * That is the difference between a table whose order happens to work and one
 * whose correctness does not depend on where a line was typed.
 */
export type ItemKeyAction = 'quickCapture' | 'moveNext' | 'movePrev' | 'pick' | 'rename' | 'open' | 'close' | 'priority' | 'dueToday' | 'remove' | 'undo' | 'palette' | 'palettePrev' | 'paletteNext' | 'palettePick';
/** The four tiers, in the order the digits run. */
export type ItemPriorityChoice = 'urgent' | 'high' | 'normal' | 'low';
/** ONE BINDING: what is pressed, and what it names. */
export interface KeyBinding {
    /** What the reader presses, in the spelling a person says out loud (`⌘K`, `↵`, `↓`). */
    readonly keys: string;
    /** `KeyboardEvent.key`, lower-cased. */
    readonly key: string;
    /** Whether the platform's command modifier is held. */
    readonly cmd?: boolean;
    /** Whether shift is held. */
    readonly shift?: boolean;
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
    readonly typing?: boolean;
    /**
     * Whether the binding is a TEXT-EDITING gesture that must never be stolen
     * from a field. `⌘Z` and `⌘⌫` are how a reader undoes typing and deletes a
     * word; intercepting them behind the caret is the silent loss of the input's
     * own undo. Unlike `typing`, this is opt-OUT: a chord that IS text editing
     * must SAY so, and the default is that cmd chords are deliberate gestures.
     */
    readonly notWhileTyping?: boolean;
    /** The action this binding names. */
    readonly action: ItemKeyAction;
    /** The argument it carries, when it carries one. */
    readonly arg?: ItemPriorityChoice;
    /**
     * Whether the binding applies at all right now.
     *
     * `Escape` is always BOUND but only does something when there is something to
     * close, and that is the difference between a key that is disabled and a key
     * that is not bound: a bound-but-inert key is still swallowed, so `Esc` in an
     * empty panel does not scroll the page.
     */
    readonly when?: (state: KeyState) => boolean;
}
/** What the flow knows when a key is pressed. */
export interface KeyState {
    /** The row the cursor is on, or `undefined` before one is chosen. */
    readonly focusedId: string | undefined;
    /** Whether anything at all is open — a menu, a row's detail, the palette. */
    readonly somethingOpen: boolean;
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
    readonly paletteOpen: boolean;
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
 */
export declare const ITEM_KEYS: readonly KeyBinding[];
/** The handler for one action. Returning nothing is fine; throwing is not. */
export type ItemKeyHandler = (arg: ItemPriorityChoice | undefined) => void;
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
export type ItemKeyActions = Readonly<Record<ItemKeyAction, ItemKeyHandler>>;
/** The event fields the flow reads. Narrower than `KeyboardEvent` on purpose. */
export type KeyEventLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'target'>;
/** Whether the platform's command modifier is held — ⌘ on macOS, Ctrl elsewhere. */
export declare function isCommand(event: KeyEventLike): boolean;
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
export declare function bindingFor(event: KeyEventLike, state: KeyState): KeyBinding | undefined;
/**
 * WHETHER THE SURFACE SHOULD TAKE THE EVENT BACK — deliberately not the same
 * question as 「does it do something」.
 *
 * A key that is bound but inert (nothing to close, no row under the cursor) is
 * still ours, and must still be swallowed: otherwise `Esc` in an empty panel
 * scrolls the page and `j` at the end of the list jumps the viewport with a
 * chime. Both look like nothing happening, and one of them is.
 */
export declare function claimsKey(event: KeyEventLike): boolean;
/**
 * RUN ONE KEY EVENT, as a pure function.
 *
 * Pure so the whole table can be checked without a DOM: a keyboard flow whose
 * only evidence is that pressing a key on a rendered page did something cannot
 * be checked for the keys it gets WRONG, and a keyboard flow with a wrong key is
 * invisible to its reader too.
 * @returns whether the event was ours and should not travel further.
 */
export declare function dispatchKey(event: KeyEventLike, state: KeyState, actions: ItemKeyActions): boolean;
