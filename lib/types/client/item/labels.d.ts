/**
 * Every vocabulary the list names, in one place, as CLOSED tables.
 *
 * WHY ONE FILE. Four files used to declare the same handful of words: the row
 * and the detail pane each had a `PRIORITY_LABEL`, the row's `MARK_LABEL` and
 * the detail's `STATUS_LABEL` were the same three keys under two names, the
 * batch bar and the page props each had a priority table, and the overview
 * strip had a `TILE_ORDER` that was a second copy of the model's own status
 * order. That is eight answers to four questions, and the failure mode is not a
 * compile error — it is a word that quietly drifts, or renders `undefined`,
 * while the panel goes on looking finished.
 *
 * The rule that makes it safe is CLOSEDNESS, and it is the whole point of the
 * type: `Readonly<Record<ItemPriority, TaskBoardKey>>` cannot be satisfied by a
 * table that is missing a tier, so the day the model grows one, `tsc` names
 * this file and nothing else. A `Record<string, …>` satisfies nothing — it
 * accepts every key and guarantees none — which is why the old tables that
 * needed a `?? 'fallback'` were not merely untidy: the fallback was there
 * precisely because the table could not be trusted to be complete, and it
 * rendered a word that was true of no flag at all.
 *
 * WHAT IS DELIBERATELY NOT HERE: any judgment. A table maps a value the model
 * already decided to a word for it. Which rows match a filter, which page a row
 * is on and what a date means are all `core/item-view.ts`, read by this surface
 * and by `taskboard_query` alike.
 */
import type { ItemPriority, ItemStatus } from '../../core/item.ts';
import type { ItemFlag, ItemSort, ItemStatusView, ScheduleBucketId } from '../../core/item-view.ts';
import type { TaskBoardKey } from '../locales.ts';
/**
 * The seven — now six — orders, and the word for each.
 *
 * This table is the reason the filter bar has never had to be told what an
 * order is called. It was written out longhand once, in the bar itself, and the
 * first time the model dropped a tier `tsc` named this line and nothing else —
 * which is the entire reason a closed `Record` is worth more than a `switch`.
 */
export declare const SORT_LABEL: Readonly<Record<ItemSort, TaskBoardKey>>;
/**
 * Each priority's word.
 *
 * The row draws it on the pill, the detail's `<select>` lists it, and the batch
 * bar's picker offers it — three consumers, one table, and a tier the model adds
 * makes this file red and no other.
 */
export declare const PRIORITY_LABEL: Readonly<Record<ItemPriority, TaskBoardKey>>;
/**
 * The three marks a reader can PUT a row into, and each one's word.
 *
 * The row menu offers exactly these three, filtered to the ones this row is not
 * already in; the detail's `<select>` offers the same three. Note what is NOT
 * here: `inProgress`. It is a GROUP — a row hanging off a running card reads as
 * 进行中 — and not a state a reader can write, so no control anywhere offers it.
 * That is why this table is over `ItemStatus` (the three) while `GROUP_LABEL`
 * below is over `ItemStatusView` (the four): two vocabularies that share three
 * words, and keeping them apart is what stops one of them growing the other's
 * members.
 */
export declare const STATUS_LABEL: Readonly<Record<ItemStatus, TaskBoardKey>>;
/** The four groups a row sorts into, and the word for each. */
export declare const GROUP_LABEL: Readonly<Record<ItemStatusView, TaskBoardKey>>;
/** The agenda's buckets and the word for each. */
export declare const BUCKET_LABEL: Readonly<Record<ScheduleBucketId, TaskBoardKey>>;
/**
 * The triage sentences, and the word for each line.
 *
 * Three flags share a word with a line that has no entry of its own, and that
 * is a deliberate collapse rather than a missing key: `triageLinesOf` emits four
 * ids, and a table keyed over the whole flag set still has to say something
 * about the rest. The right something is the nearest honest line, not a blank —
 * and now that the table is closed, saying it is a choice the compiler asks for
 * instead of a `?? 'item.triage.undated'` that used to be reached by no code
 * path at all and would have rendered a date sentence for a flag that is not
 * about dates.
 */
export declare const TRIAGE_LABEL: Readonly<Record<ItemFlag, TaskBoardKey>>;
