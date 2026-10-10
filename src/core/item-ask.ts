/**
 * Handing one checklist row to a model, decided.
 *
 * ── WHY THIS IS A CORE FUNCTION AND NOT A ROUTE ─────────────────────────────
 *
 * The decision — which conversation, and what it is told — lived entirely inside
 * the HTTP route, which meant two things at once: it had no test, and it was not
 * in the catalog. The panel could press 「问 AI」 and the model could not, because
 * `verify-action-coverage` reads what the CATALOG carries and the route's private
 * function was in neither list. So 「界面有的动作 AI 没有」 was not an oversight to
 * fix; it was a structural consequence of where the judgment sat.
 *
 * Here it is a pure function over facts the caller already has, so the catalog
 * can name it, the coverage gate can bind it, and a test can pin every branch
 * without a storage hub or a socket.
 *
 * ── ONE ACTION, TWO LANES ───────────────────────────────────────────────────
 *
 * 「问 AI」 means one thing to the reader — 「把这一条交给它」 — and the card it
 * hangs off is in one of two situations:
 *
 *   · **有一条对话** → the row's words are said INTO that conversation, and the
 *     card walks 进行中 → 待审核 through the same machinery every other message
 *     in that conversation uses ({@link askTargetOf} says `continue`).
 *   · **一条都没有** → there is nothing to continue, so this is a genuine 开始:
 *     a run opens the card's first conversation ({@link askTargetOf} says `start`).
 *
 * The two lanes are NOT two actions, and they used to look like two because the
 * panel had a separate 「执行」 button that only ever did the second one while
 * refusing whenever the first applied. A reader who pressed the wrong one got a
 * dead control and no sentence explaining why. Which lane this is, is a fact
 * about the card — never a choice the reader has to make correctly.
 *
 * ── WHAT THE TWO LANES AGREE ON ─────────────────────────────────────────────
 *
 * The text. {@link itemContextText} is the single composer, so a row handed to a
 * fresh run and the same row handed to a running conversation say the same thing
 * about themselves — only the lane differs. And because the text is composed from
 * the ROW rather than from the card's own prompt, a card made by the board and a
 * card made from this very row receive it identically.
 */
import { itemTagsOf, type ItemRecord, type ItemStep } from './item.ts'
import type { RelatedSessionFact } from './task-live.ts'
import type { TaskRecord } from './tasks.ts'

/** Why the row cannot be handed over at all. A CODE, never a sentence — the
 *  panel owns the wording and the dictionary translates it. */
export type ItemAskRefusal =
  /** The row points at a card that is no longer on the board. */
  | 'noCard'
  /** The request named a card and a row that do not belong to each other. */
  | 'rowBelongsElsewhere'

/** What the caller must know to decide the lane. Everything here is a fact the
 *  caller already holds; this module asks the host nothing. */
export interface ItemAskInput {
  /** The row, already resolved from the request. */
  readonly item: ItemRecord
  /** The card the REQUEST named, or `undefined` when no such card is on the board. */
  readonly card: TaskRecord | undefined
  /** The card's related sessions, de-duplicated by the model. */
  readonly sessions: readonly RelatedSessionFact[]
  /** Is that session working right now? The CALLER answers this, so a test can
   *  drive it with a plain function and the two halves can each read their own
   *  live source. */
  readonly isRunning: (sessionId: string) => boolean
}

/** Which lane the press takes. */
export type ItemAskTarget =
  | { readonly kind: 'start' }
  | { readonly kind: 'continue'; readonly sessionId: string }

/** The whole hand-off: the lane, and the words. */
export type ItemAskPlan =
  | { readonly kind: 'refused'; readonly why: ItemAskRefusal }
  | { readonly kind: 'start'; readonly text: string }
  | { readonly kind: 'continue'; readonly sessionId: string; readonly text: string }

/**
 * 开始还是继续——**这一张卡有没有一条能接下去的对话**。
 *
 * A card that has run before ALWAYS has one: its rounds hold their session ids
 * forever, so 「继续」 survives the conversation being archived or deleted from
 * the card's own view (the round is still a fact about where the work happened,
 * and saying the note into a conversation that is still there is exactly right).
 * A card with none is a card that has never run — often the one this very press
 * just created out of the row.
 *
 * WHICH SESSION WHEN THERE ARE SEVERAL: one that is working. A card may hold
 * several conversations, and 「the one doing work right now」 is the only choice
 * that matches what a reader means by asking about this. When none is working the
 * FIRST related session is used — the card's own order, binds first, which is
 * 「这张卡的那条对话」 when nobody is speaking. The receipt names whichever it
 * was: a hand-off that cannot be told apart afterwards is not a receipt.
 */
export function askTargetOf(
  sessions: readonly RelatedSessionFact[],
  isRunning: (sessionId: string) => boolean,
): ItemAskTarget {
  const chosen = sessions.find(session => isRunning(session.sessionId)) ?? sessions[0]
  return chosen === undefined ? { kind: 'start' } : { kind: 'continue', sessionId: chosen.sessionId }
}

/**
 * 这一条自己是什么——**交给模型的那段话只有这一个写处**。
 *
 * IT CARRIES THE ROW, NOT THE CARD. The card already reached the model twice: as
 * the run's own prompt when it started a conversation, and as the description on
 * every launch after. Repeating it here would push the row's actual content down
 * the message for the sake of a title the conversation already knows.
 *
 * THE FIVE FIELDS ARE THE ROW'S OWN, in the order a person would say them: what it
 * is called, how it is filed, what it says, what is left to do, and what whoever
 * picks it up needs to know. An empty one is OMITTED rather than sent as a blank
 * label — a list of empty headings reads as a form somebody forgot to fill, and a
 * model that sees 「标签：」 learns nothing except that there are no tags.
 *
 * A ROW WITH NO NUMBER YET SAYS SO. `ref === 0` means the document has not
 * numbered it, and printing 「#0」 would put a number on the screen that the
 * reader's own list does not show — and that no other row can be told apart from.
 */
export function itemContextText(item: ItemRecord): string {
  const where = item.ref > 0 ? `#${item.ref}` : '一条刚记下、还没有编号的条目'
  const lines: string[] = [`任务清单里的一条（${where}）：`]
  /* THE FIELD, NOT THE READING. `itemTitleOf` borrows the body's first line for
   * an untitled row, which is right for a screen (a row with no name still has
   * to be called something) and wrong here: the borrowed line would arrive twice
   * — once as 「标题」 and again inside the body — and the model would be told the
   * row has a title it does not have. */
  if (item.title.trim() !== '') lines.push(`标题：${item.title.trim()}`)
  const tags = itemTagsOf(item.tags)
  if (tags.length > 0) lines.push(`标签：${tags.join('、')}`)
  if (item.body.trim() !== '') lines.push('正文：', item.body.trim())
  const steps = stepLinesOf(item.steps)
  if (steps !== '') lines.push('步骤：', steps)
  if (item.notes.trim() !== '') lines.push('上下文备注：', item.notes.trim())
  lines.push('', '请处理它，并告诉我你打算怎么做。')
  return lines.join('\n')
}

/** The checklist as it stands, one ticked box per line — the model sees what is
 *  done and what is not, which is half of what a step list is FOR. */
function stepLinesOf(steps: readonly ItemStep[]): string {
  return steps.map(step => `- [${step.done ? 'x' : ' '}] ${step.text}`).join('\n')
}

/**
 * Decide the hand-off, or refuse it.
 *
 * THE REFUSALS ARE ABOUT THE ROW AND ITS LINK, never about the card's readiness:
 * whether the card can be run is the launch door's judgment (`taskExecutable` in
 * the controller, `runTask`'s own gate), and duplicating it here is how the panel
 * and the board came to disagree about which cards are runnable. What this
 * function refuses is a row with nowhere to go — a link whose card is gone — and
 * a request that names two things that do not belong together (the panel always
 * sends its own row, so this refuses only a body that does not describe one
 * thing, which is exactly what it should refuse).
 */
export function planItemAsk(input: ItemAskInput): ItemAskPlan {
  const { item, card, sessions, isRunning } = input
  if (card === undefined) return { kind: 'refused', why: 'noCard' }
  if (item.taskId !== card.id) return { kind: 'refused', why: 'rowBelongsElsewhere' }
  const target = askTargetOf(sessions, isRunning)
  const text = itemContextText(item)
  return target.kind === 'start'
    ? { kind: 'start', text }
    : { kind: 'continue', sessionId: target.sessionId, text }
}
