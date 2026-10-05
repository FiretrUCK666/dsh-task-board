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
 * Here it is a pure function over three facts the route already has, so the
 * catalog can name it, the coverage gate can bind it, and a test can pin every
 * branch without a storage hub or a socket.
 *
 * ── THE THREE ANSWERS, AND WHY THERE ARE THREE ─────────────────────────────
 *
 * 1. WHICH CARD. Given by the caller — the route looks it up — because that is a
 *    document question. What this function checks is that the row AGREES with
 *    it. The two lookups were independent and nothing compared them, so a request
 *    naming card A with a row of card B delivered B's text into A's
 *    conversation: a wrong answer inside a session a reader will trust, with no
 *    screen anywhere saying so.
 *
 * 2. WHICH SESSION. One that is actually running, else the first bound one. A
 *    card can hold several sessions, and 「the one doing work right now」 is the
 *    only choice that matches what a reader means by asking about this.
 *
 * 3. WHAT IT IS TOLD. The row, in full, with a note about its card — and the note
 *    distinguishes 「never linked」 from 「its card is gone」, which the old
 *    sentence did not: it tested for `undefined`, so a DANGLING link read exactly
 *    like no link at all, and the model was told the second thing.
 */
import type { ItemRecord } from './item.ts'
import type { RelatedSessionFact } from './task-live.ts'
import type { TaskRecord } from './tasks.ts'

/** Why there is nothing to hand over to. A CODE, never a sentence — the panel
 *  owns the wording and the dictionary translates it. */
export type ItemAskRefusal =
  | 'noCard'
  | 'rowBelongsElsewhere'
  | 'taskHasNoSession'
  | 'noLiveAgent'

export interface ItemAskInput {
  /** The row, already resolved from the request. */
  readonly item: ItemRecord
  /** The card the REQUEST named, or `undefined` when no such card is on the board. */
  readonly card: TaskRecord | undefined
  /** The card's related sessions, de-duplicated by the model. */
  readonly sessions: readonly RelatedSessionFact[]
  /** Is that session running right now? The HOST answers this; this core never
   *  asks the host anything, so a test drives it with a plain function. */
  readonly isRunning: (sessionId: string) => boolean
  /** Is there a live agent on that session at all? Same reason. */
  readonly hasAgent: (sessionId: string) => boolean
}

export type ItemAskVerdict =
  | { readonly ok: false; readonly why: ItemAskRefusal }
  | { readonly ok: true; readonly sessionId: string; readonly text: string }

/**
 * The one sentence a row is handed over as.
 *
 * It carries the row's own words, its checklist with the ticks as they are, and
 * the card's — or the reason there is no card to name. A model handed 「这条属于
 * 看板卡片 X」 can open it; a model handed a dangling link told as 「它还没有挂到
 * 任何看板卡片上」 will go looking for a card that was never there.
 */
export function itemAskText(item: ItemRecord, card: TaskRecord | undefined): string {
  const where = card === undefined
    ? '（它没有挂到任何还存在的看板卡片上）'
    : ''
  const steps = item.steps.length === 0
    ? ''
    : `\n它的步骤：${item.steps.map(step => `- [${step.done ? 'x' : ' '}] ${step.text}`).join('\n')}`
  return `任务清单里有一条「#${item.ref} ${item.title || '（无标题）'}」${where}。请处理它，并告诉我你打算怎么做。${steps}`
}

/**
 * Decide the hand-off, or refuse it.
 *
 * The refusals are ordered the way the facts arrive, so the one a reader is most
 * likely to hit — a card that is gone — is reached before anything is read off
 * a session.
 */
export function planItemAsk(input: ItemAskInput): ItemAskVerdict {
  const { item, card, sessions, isRunning, hasAgent } = input
  if (card === undefined) return { ok: false, why: 'noCard' }
  // The row must belong to the card that was named. The panel always sends its
  // own row, so this refuses only a body that does not describe one thing —
  // which is exactly what it should refuse.
  if (item.taskId !== card.id) return { ok: false, why: 'rowBelongsElsewhere' }
  if (sessions.length === 0) return { ok: false, why: 'taskHasNoSession' }

  const running = sessions.find(session => isRunning(session.sessionId))
  const chosen = running?.sessionId ?? sessions[0]?.sessionId
  if (chosen === undefined) return { ok: false, why: 'taskHasNoSession' }
  if (!hasAgent(chosen)) return { ok: false, why: 'noLiveAgent' }

  return { ok: true, sessionId: chosen, text: itemAskText(item, card) }
}