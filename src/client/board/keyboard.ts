/**
 * The board's card keyboard: ONE map, ONE matcher, and the spoken hint DERIVED
 * from the map.
 *
 * WHY A TABLE AND NOT THREE INLINE `if`s. A keyboard flow written as inline key
 * tests is a list of keys scattered through the component that holds the state,
 * so the answer to 「what can I do without a mouse on this board」 is assembled
 * from three places and read nowhere. The list panel has had a map since it was
 * built; the board was the half that did not, which is the whole of the finding
 * this module closes.
 *
 * WHY THE TABLE NAMES ACTIONS INSTEAD OF HOLDING THEM. A binding that carried its
 * own callback would have to be built where the state lives, so the table could
 * not be a constant and could not be checked for keys with nothing behind them.
 * Naming the action makes the table DATA and puts one question at the dispatcher:
 * **does every name in this table have a handler?** {@link BoardCardKeyActions} is
 * a CLOSED record, so a name added without one is a COMPILE ERROR rather than a
 * key that silently does nothing.
 *
 * WHY THE HINT IS DERIVED AND NOT WRITTEN. The card's accessible name advertises
 * these keys, and it used to be a hand-written sentence in two locale files — so
 * adding a binding meant remembering to edit two strings in two languages, and
 * forgetting produced a card that offers a chord nobody is told about. Nothing
 * would have gone red. {@link availableCardKeys} builds the list from the table
 * and {@link BOARD_KEY_PHRASE} names the phrase for each action, so a new binding
 * arrives in the reader's ear the moment it exists — and a new ACTION without a
 * phrase is a compile error too.
 *
 * WHAT IS NOT HERE. Bare `↑` / `↓` / `Home` / `End` inside a dialog's list, `↵` in
 * a rename field, `Esc` on a sheet: those are a WIDGET's own conventions, decided
 * by the widget that owns the focus, and they are not the board's vocabulary.
 * Folding them in would make one table describe five unrelated things.
 */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TaskBoardKey } from '../locales.ts'

/**
 * Every action the card's keyboard can name.
 *
 * `open` is one action with two bindings, which is why the hint is grouped by
 * ACTION rather than by binding: a reader who is told 「回车或空格打开」 twice
 * learns nothing the second time.
 */
export type BoardCardAction = 'open' | 'stepColumn' | 'reorder'

/** ONE BINDING: what is pressed, and what it names. */
export interface BoardCardBinding {
  /** What the reader presses, in the spelling a person says out loud (`[`, `Alt+↑`). */
  readonly keys: string
  /** `KeyboardEvent.key`, lower-cased. */
  readonly key: string
  /** Whether Alt is held. */
  readonly alt?: boolean
  /** Whether the platform's command modifier is held. */
  readonly cmd?: boolean
  /** The action this binding names. */
  readonly action: BoardCardAction
  /** The argument it carries — the direction of the move. */
  readonly arg?: -1 | 1
}

/**
 * THE MAP. Every key the card answers to is here and nowhere else.
 *
 * `[` / `]` STEP THE COLUMN along the board's own `COLUMNS` order, and the caller
 * runs them through the same `resolveCardDrop` a drag uses — so a key move can
 * never take a path a drag could not refuse.
 *
 * `Alt` WITH THE ARROWS REORDERS WITHIN the column. It exists because the manual
 * order is PERSISTED (a hand-placed card is never reordered by the engine), so
 * 「where I put it」 is a capability — and a capability whose only door is the
 * pointer is one a keyboard reader does not have. The chord is what editors and
 * outliners use for 「move this item one place」, and it collides with nothing the
 * board spends: `[` `]` take columns, bare arrows move focus between cards, and
 * Ctrl/Cmd combinations belong to the browser.
 *
 * THE MODIFIER GUARDS ARE DATA, not a condition inside each branch. A bare `[`
 * must not fire while Ctrl is held (that is the browser's), and `Alt`+arrow must
 * not fire without Alt — both are said on the binding, so a new binding cannot
 * forget one and become a key that steals a gesture.
 */
export const BOARD_CARD_KEYS: readonly BoardCardBinding[] = [
  { keys: '[', key: '[', action: 'stepColumn', arg: -1 },
  { keys: ']', key: ']', action: 'stepColumn', arg: 1 },
  { keys: 'Alt+↑', key: 'arrowup', alt: true, action: 'reorder', arg: -1 },
  { keys: 'Alt+↓', key: 'arrowdown', alt: true, action: 'reorder', arg: 1 },
  { keys: '↵', key: 'enter', action: 'open' },
  { keys: '空格', key: ' ', action: 'open' },
]

/**
 * Which of them the card can honour right now.
 *
 * A read-only surface passes no handlers, and a binding the surface cannot keep is
 * not offered — neither as a key nor in the spoken hint. That is the difference
 * between a map that describes the component and one that describes an intention.
 */
export interface BoardCardState {
  /** Whether the card was given a column step. */
  readonly canStep: boolean
  /** Whether the card was given a within-column reorder. */
  readonly canReorder: boolean
}

/** Whether this binding's action is available on this card. */
function available(binding: BoardCardBinding, state: BoardCardState): boolean {
  if (binding.action === 'stepColumn') return state.canStep
  if (binding.action === 'reorder') return state.canReorder
  return true
}

/**
 * The binding a key event IS, or `undefined` when this keystroke is not ours.
 *
 * Modifiers are compared BOTH WAYS, which is the part that is easy to get wrong:
 * a binding that does not ask for Alt must refuse an event that has Alt, or `Alt+[`
 * would step a column — and `Alt+[` is a gesture the browser or the platform owns.
 */
export function cardBindingFor(
  event: Pick<ReactKeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>,
  state: BoardCardState,
): BoardCardBinding | undefined {
  const key = event.key.toLowerCase()
  return BOARD_CARD_KEYS.find(binding => binding.key === key
    && available(binding, state)
    && (binding.alt === true) === (event.altKey === true)
    && (binding.cmd === true) === (event.ctrlKey === true || event.metaKey === true))
}

/** The handler for one action. Returning nothing is fine; throwing is not. */
export type BoardCardKeyHandler = (arg: -1 | 1 | undefined) => void

/**
 * EVERY ACTION, as a CLOSED record — the same arrangement the list panel uses,
 * for the same reason: with a `Partial` record, an action named by the table and
 * handled by nobody would be a key that silently does nothing, arriving through
 * the module built to prevent exactly that.
 */
export type BoardCardKeyActions = Readonly<Record<BoardCardAction, BoardCardKeyHandler>>

/**
 * RUN ONE KEY EVENT. `true` means the event was ours and must not travel further.
 *
 * The caller owns `preventDefault` — a React handler cannot be handed an event it
 * did not receive — but it owns it in ONE place, next to this call, rather than
 * inside each branch.
 *
 * TWO DIFFERENT SITUATIONS, and conflating them is how a keystroke disappears:
 *
 *   - NOT OFFERED — a read-only card has no column step, so `]` is not this card's
 *     key and comes back `false`. The browser may have it, and handing it back
 *     costs nothing because none of this vocabulary has a browser meaning.
 *   - OFFERED BUT REFUSED — a card at the end of its column. That one IS ours and
 *     returns `true`, so the caller swallows it and the board never scrolls under a
 *     key that did nothing. This is the case the list panel's rule protects.
 */
export function dispatchCardKey(
  event: Pick<ReactKeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>,
  state: BoardCardState,
  actions: BoardCardKeyActions,
): boolean {
  const binding = cardBindingFor(event, state)
  if (binding === undefined) return false
  actions[binding.action](binding.arg)
  return true
}

/** One action's keys, joined for a sentence: `↵ / 空格`. */
export interface CardKeyOffer {
  readonly action: BoardCardAction
  /** Every spelling that reaches this action, in table order. */
  readonly keys: string
}

/**
 * What this card can actually offer, grouped by action and in table order.
 *
 * THIS IS WHAT THE SPOKEN HINT IS BUILT FROM. A hand-written sentence is a second
 * copy of the map, and the two drift the first time someone adds a key in a hurry.
 */
export function availableCardKeys(state: BoardCardState): readonly CardKeyOffer[] {
  const offers: CardKeyOffer[] = []
  for (const binding of BOARD_CARD_KEYS) {
    if (!available(binding, state)) continue
    const found = offers.find(offer => offer.action === binding.action)
    if (found === undefined) offers.push({ action: binding.action, keys: binding.keys })
    else (found as { keys: string }).keys = `${found.keys} / ${binding.keys}`
  }
  return offers
}

/**
 * The locale key for each action's phrase, as a CLOSED record.
 *
 * Closed for the same reason the handler record is: an action that arrives in the
 * table with no phrase would otherwise render an empty clause in the card's
 * accessible name — a sentence that trails off, which is worse than no sentence.
 */
export const BOARD_KEY_PHRASE: Readonly<Record<BoardCardAction, TaskBoardKey>> = {
  open: 'card.key.open',
  stepColumn: 'card.key.stepColumn',
  reorder: 'card.key.reorder',
}
