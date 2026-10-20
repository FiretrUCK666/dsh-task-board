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
import { ITEM_PRIORITIES_BY_WEIGHT, PRIORITY_DIGIT, type ItemPriority } from '../../core/item-view.ts'

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
export type ItemKeyAction =
  | 'quickCapture' | 'moveNext' | 'movePrev' | 'pick' | 'rename' | 'open'
  | 'close' | 'priority' | 'dueToday' | 'remove' | 'undo' | 'palette'
  | 'palettePrev' | 'paletteNext' | 'palettePick'

/** ONE BINDING: what is pressed, and what it names. */
interface KeyBinding {
  /** What the reader presses, in the spelling a person says out loud (`⌘K`, `↵`, `↓`). */
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
   * THIS IS THE RULE, STATED PER KEY, because a rule inside one boolean is a rule
   * apart from the table: `usable()` skips every bare key while the reader is
   * typing except the two keys (`Esc`, `↵`) written into it by hand. Two keys
   * written inside a condition is a list that lives apart from the table, so the
   * next command that belongs there has to be found before it can be added. Here
   * the exception travels with the binding.
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
  /** The action this binding names. */
  readonly action: ItemKeyAction
  /** The argument it carries, when it carries one. */
  readonly arg?: ItemPriority
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
  /**
   * 有没有一层东西**占着键盘**——一个菜单、一张展开的行、一个浮层（命令面板 / 新建 /
   * 排序）。
   *
   * 它不只是「屏幕上还有别的东西」：这一层开着的时候，读者按的那些键是**给这一层**的。
   * 所以它同时是 {@link LAYER_TRANSPARENT} 那条规则的输入——两个事实一个名字，因为它们
   * 本来就是同一件事。
   */
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
 */
export const ITEM_KEYS: readonly KeyBinding[] = [
  /* **它自己没有 `when`，而这是对的**：这枚键不该在占着键盘的那一层里生效，由
     {@link LAYER_TRANSPARENT} 那一条规则说——不在这里再写一遍「除了……之外」。 */
  { keys: 'A', key: 'a', action: 'quickCapture' },
  { keys: '⌘K', key: 'k', cmd: true, action: 'palette' },
  { keys: '/', key: '/', action: 'palette' },
  { keys: 'J', key: 'j', action: 'moveNext', when: s => !s.paletteOpen },
  { keys: 'K', key: 'k', action: 'movePrev', when: s => !s.paletteOpen },
  { keys: '↓', key: 'arrowdown', action: 'moveNext', when: s => !s.paletteOpen },
  { keys: '↑', key: 'arrowup', action: 'movePrev', when: s => !s.paletteOpen },
  { keys: '↓', key: 'arrowdown', action: 'paletteNext', typing: true, when: s => s.paletteOpen },
  { keys: '↑', key: 'arrowup', action: 'palettePrev', typing: true, when: s => s.paletteOpen },
  { keys: 'X', key: 'x', action: 'pick', when: s => s.focusedId !== undefined && !s.somethingOpen },
  { keys: 'E', key: 'e', action: 'rename', when: s => s.focusedId !== undefined && !s.somethingOpen },
  { keys: '↵', key: 'enter', action: 'open', typing: true, when: s => s.focusedId !== undefined && !s.paletteOpen && !s.somethingOpen },
  { keys: '↵', key: 'enter', action: 'palettePick', typing: true, when: s => s.paletteOpen },
  { keys: 'Esc', key: 'escape', action: 'close', typing: true },
  /* 1–4 就是 `!N` 那一把阶梯本身，读的是 core 里唯一那张数字表：行上的记号、快记的
     `!1`、以及这一张映射，是同一套拼写的三个读者。 */
  ...ITEM_PRIORITIES_BY_WEIGHT.map(priority => ({
    keys: PRIORITY_DIGIT[priority],
    key: PRIORITY_DIGIT[priority],
    action: 'priority' as const,
    arg: priority,
    when: (state: KeyState) => state.focusedId !== undefined && !state.somethingOpen,
  })),
  { keys: 'D', key: 'd', action: 'dueToday', when: s => s.focusedId !== undefined && !s.somethingOpen },
  { keys: '⌘⌫', key: 'backspace', cmd: true, notWhileTyping: true, action: 'remove', when: s => s.focusedId !== undefined },
  { keys: '⌘Z', key: 'z', cmd: true, notWhileTyping: true, action: 'undo' },
]

/**
 * 占着键盘的那一层（见 {@link KeyState.somethingOpen}）**唯一放行**的几枚动作。
 *
 * 其余每一枚都是**对列表**的动作，而列表此刻不是读者在按的那一层。
 *
 * **这条规则必须在表这一层，不能变成每个绑定自己写的 `when`。** 一处漏写的 `when`
 * 就是一次真事故：纸开着、焦点又恰好不在输入框里（起名框按回车收起后焦点落回
 * `<body>`，或焦点在某枚芯片上）时，读者接着敲的那个字母会把**他自己正开着的那张纸**
 * 关掉——因为 `openLayer` 是开关。而「某个绑定忘了挡」在测试里看不见：那一枚动作
 * 在自己的用例里是通的，缺的那一句只在「有层开着」这个前提成立时才显形。
 *
 * 所以判据只有一条：**新增一枚动作时不必再记得写「层开着就别响应」**，漏写的那一枚
 * 也会被挡住。默认是「不听」，放行才要理由。`ITEM_KEY_ACTIONS` 的处理器表与
 * `KeyState.somethingOpen` 闭合，加一枚没有处理器的键就是编译错误。
 *
 * 三枚调色板动作在里面，因为它是**那一层自己的**键：`↑↓` 与 `↵` 在面板里是「挪候选 /
 * 跑它」，在列表上是「挪光标 / 打开这一行」——两层各有一个名字，而
 * {@link bindingFor} 靠各自的 `when` 挑出适用的一枚。**那些 `when` 不许因为这条规则而
 * 删掉**：它们的作用是让「适用的那一枚」赢，而不是「挡住不适用的那一枚」。
 *
 * **而 `⌘` 和弦不算在里面**（判据在 {@link dispatchKey}）：一条带命令修饰键的和弦是
 * **故意的动作**，它属于这一面，不属于当前那一层——与 {@link usable} 里「裸键算打字、
 * 和弦不算」是同一条界线。所以纸开着时 `⌘K` 照旧开得动调色板（那是它唯一的键盘入口），
 * 而裸键 `/` 不动：后者在一个开着纸、焦点又落在某枚芯片上的读者手里，会把他的纸换掉。
 */
const LAYER_TRANSPARENT: ReadonlySet<ItemKeyAction> = new Set<ItemKeyAction>([
  'close', 'palettePrev', 'paletteNext', 'palettePick',
])

/** The handler for one action. Returning nothing is fine; throwing is not. */
type ItemKeyHandler = (arg: ItemPriority | undefined) => void

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
type KeyEventLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'target'>

/** Whether a KEY EVENT is TYPING — the one thing that suspends the flow. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as (HTMLElement & { isContentEditable?: boolean }) | null
  if (element === null || element === undefined) return false
  if (element.isContentEditable === true) return true
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** The keys ONE FIELD has claimed, said on the field itself.
 *
 * A field that answers keys itself — an in-place name that takes `Enter` to
 * confirm and `Esc` to dismiss — has to say so where the flow reads, because the
 * flow is a pure function over the event and can see nothing of a pane's state.
 * The value is the bare keys the field takes, space-separated: those keys are
 * the FIELD's there, and the flow stands aside. A `⌘` chord on the same key is
 * still the surface's, because a chord is a deliberate gesture, not typing.
 *
 * The attribute marks this panel's own subtree — the same rule every other
 * `data-` mark in this plugin follows. */
const EMPTY_KEYS: ReadonlySet<string> = new Set()

function keysClaimedByTarget(target: EventTarget | null): ReadonlySet<string> {
  const element = target as (Element | null) | undefined
  const said = element?.getAttribute('data-dsh-tb-keys') ?? undefined
  if (element === null || element === undefined || said === undefined || said.trim() === '') return EMPTY_KEYS
  return new Set(said.toLowerCase().split(/\s+/).filter(one => one !== ''))
}

/** Whether the platform's command modifier is held — ⌘ on macOS, Ctrl elsewhere. */
function isCommand(event: KeyEventLike): boolean {
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
  /* A FIELD'S OWN CLAIM BEATS THE TABLE, for the bare key it named: the flow
     stands aside on exactly those keys, wherever the field sits. */
  if (!isCommand(event) && keysClaimedByTarget(event.target).has(binding.key)) return false
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
 * match alone makes the table's ORDER the thing that decides behaviour, which is
 * invisible in review and breaks the day a line is moved: the palette's `↵` sits
 * below the row's `↵`, and the row's wins the moment the caret is not in the
 * palette's field.
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

/**
 * RUN ONE KEY EVENT, as a pure function.
 *
 * Pure so the whole table can be checked without a DOM: a keyboard flow whose
 * only evidence is that pressing a key on a rendered page did something cannot
 * be checked for the keys it gets WRONG, and a keyboard flow with a wrong key is
 * invisible to its reader too.
 *
 * 事件仍然是**我们的**（照着这条路的规矩：认了的键一律吞掉，哪怕它什么都不做），
 * 但占着键盘的那一层开着时，只有 {@link LAYER_TRANSPARENT} 那几枚真的动手。
 * @returns whether the event was ours and should not travel further.
 */
export function dispatchKey(event: KeyEventLike, state: KeyState, actions: ItemKeyActions): boolean {
  const binding = bindingFor(event, state)
  if (binding === undefined) return false
  if (binding.when !== undefined && !binding.when(state)) return true
  /* 占着键盘的那一层：**裸键**归它，和弦归这一面（见 {@link LAYER_TRANSPARENT}）。 */
  if (state.somethingOpen && !isCommand(event) && !LAYER_TRANSPARENT.has(binding.action)) return true
  actions[binding.action](binding.arg)
  return true
}
