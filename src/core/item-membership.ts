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
 * The row's DERIVED status, from the board's live state — the ONE place a row is
 * asked whether it is 进行中.
 *
 * Every surface that shows or filters a status goes through here: the row
 * projection, the group counts, the group fill and the query.
 *
 * @param item - the row.
 * @param running - the board's live state keyed by card id, or `undefined` when
 *   the caller has no board. A row whose card is not in the map is not running;
 *   a card this host cannot see is `false` here, which is why the live verdict
 *   itself is `unknown` upstream and never arrives as a guess.
 * @returns the stored status, or the derived 进行中.
 */
export function derivedStatusOf(item: ItemRecord, running: ReadonlyMap<string, boolean> | undefined): ItemStatusView {
  return itemStatusOf(item, item.taskId !== undefined && running?.get(item.taskId) === true)
}
