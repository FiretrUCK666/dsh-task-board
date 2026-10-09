/**
 * WHICH SET A ROW IS IN — the three membership predicates, and nothing else.
 *
 * WHY THEY ARE TOGETHER AND STAND ALONE. Every page, every group and every count
 * in the checklist is a set, and the sets overlap: a row can be unfinished and
 * unfiled at once, or filed and scheduled at once. The predicates that decide
 * each set used to be scattered through the file that happened to need them, and
 * a predicate copied to the place that needed it is a second answer to a
 * question the product has already answered once. The concrete instance: a bare
 * capture landed in the agenda's 「没有日期」 bucket while the triage strip
 * exempted exactly those rows from its own 「没有日期」 line — two surfaces, one
 * question, two answers, and the second one wrong. A thought the reader wrote a
 * minute ago has not failed to be scheduled; it has not been READ twice yet.
 *
 * So membership is decided here, once, and the query grammar, the agenda, the
 * triage strip and the rail counts all read it. That is also why this module
 * imports nothing but the model: it is the bottom of the derivation layer, and
 * everything above it may depend on it.
 *
 * `derivedStatusOf` lives here for the same reason. 进行中 is not a stored field,
 * and "which group does this row show up in" is a membership question, so the
 * one derivation that answers it sits with the other three rather than beside a
 * caller's loop — four surfaces that ask "is it running" spelled out four ways is
 * four places for the derived status to be quietly wrong in one of them, and the
 * wrong one is always the facet, because a facet that disagrees with the row it
 * counts is a facet that sends the reader to an empty group.
 */
import type { ItemRecord, ItemStatusView } from './item.ts'
import { itemStatusOf } from './item.ts'
import type { TaskStatus } from './tasks.ts'

/** Whether a row belongs on a working page at all. Finished work is history. */
export function isLiveItem(item: ItemRecord): boolean {
  return item.status !== 'done'
}

/**
 * Whether a row is still an unsorted capture.
 *
 * "Structured" means the reader put it into the taxonomy: it has a priority
 * above the default, a date of any of the three kinds, a tag, or a board card.
 * Give it any of those and it has been filed; leave it bare and it is still
 * waiting to be decided about. That is the whole rule, and it is why steps and
 * body text do NOT count: they are content, not a place in the taxonomy, and a
 * note that arrives with a checklist is still a thought that needs a decision.
 * @param item - the row.
 * @returns whether it belongs to the inbox.
 */
export function isInboxItem(item: ItemRecord): boolean {
  if (item.status === 'done') return false
  if (item.priority !== 'normal') return false
  if (item.tags.length > 0) return false
  if (item.taskId !== undefined) return false
  return item.startsAfter === undefined && item.dueAt === undefined && item.hardDueAt === undefined
}

/**
 * Whether a row is a MEMBER of the agenda — the one membership test, read by the
 * agenda fill and by the page rail's count, so the number on the rail is the
 * number of rows the page actually holds.
 *
 * Two exclusions, each one borrowed rather than re-argued:
 *
 *  - **FINISHED WORK IS HISTORY.** An agenda that lists work as still to do is
 *    the one lie an agenda cannot carry, and the reader's own "show me what I
 *    finished" belongs on the list page where the finished group is.
 *  - **AN UNFILED CAPTURE IS NOT ON AN AGENDA.** A bare note is not a date-shaped
 *    hole in the agenda; it has not been READ twice yet, and the inbox is the
 *    page that holds it. So the agenda takes {@link isInboxItem}, the very
 *    predicate the triage strip uses, and 收件 ∩ 日程 = ∅ becomes true in the
 *    code rather than only in the product note.
 *
 * A filed row with no date still belongs here — it is in the 「没有日期」
 * bucket, which is a named container rather than nowhere.
 * @param item - the row.
 * @returns whether the agenda holds it.
 */
export function isAgendaItem(item: ItemRecord): boolean {
  return isLiveItem(item) && !isInboxItem(item)
}

/**
 * The row's status AS A SURFACE SHOWS IT — the ONE place that question is answered.
 *
 * **A row that hangs off a card is wherever that card is**; a row with no card (or
 * one this machine cannot see) is its own two values. Every surface that shows or
 * filters a status goes through here: the row projection, the rail's counts and
 * its rows, the group counts, the query, and the model's own query answer.
 *
 * @param item - the row.
 * @param cards - 看板的栏，按卡片 id 索引；`undefined` 表示这个调用者手上没有看板
 *   （一次干跑、一台看不见引擎的宿主）。那时一条挂了卡的行读的是**它自己**的两个值
 *   ——它不猜一栏自己看不见的东西，也不把「看不见」说成「待办」。
 * @returns 那一行现在站在哪一栏。
 */
export function derivedStatusOf(item: ItemRecord, cards: ReadonlyMap<string, TaskStatus> | undefined): ItemStatusView {
  return itemStatusOf(item, item.taskId === undefined ? undefined : cards?.get(item.taskId))
}
