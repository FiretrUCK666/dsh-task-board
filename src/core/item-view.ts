/**
 * The checklist's ONE derivation layer — and now its FRONT DOOR rather than its
 * body. Every judgment about a row is made in one of the modules below; this
 * file exists so that a surface has ONE import to write and ONE name to learn.
 *
 * WHY THE LAYERING EXISTS, and what each module is for. The layer used to be one
 * 1,400-line file, which is a size at which a change stops being reviewable: a
 * date-posture fix and a triage-line fix landed in the same file, so neither
 * could be read without reading the other, and "did the other half move too" was
 * a question nobody could answer cheaply. The split is by QUESTION, not by size,
 * and the boundaries are the questions:
 *
 *   item-dates       三个日期是什么意思      the three promises, and the one verdict
 *   item-membership  这一条在不在场          which set a row is in, and its real status
 *   item-stale       多久没动                neglect, with the exemptions that make it usable
 *   item-sort        谁排在前面              the orderings, and the recent-rows list
 *   item-query       能问什么                the grammar, and the one matcher
 *   item-rows        一行长什么样            the row projection, and the four runs
 *   item-schedule    日程在哪一格            the agenda's eight buckets
 *   item-triage      有哪些要处理            the sentences, each with the list it opens
 *   item-counts      那些数字                the rail, the group heads, the one cross-cut
 *
 * THE DEPENDENCY EDGES RUN ONE WAY (dates and membership at the bottom, counts at
 * the top) and the only edge leaving the layer at all is `item-sort`'s 顺序 key,
 * which reads the DOCUMENT's own comparator rather than restating it. That is
 * deliberate and it is the load-bearing comment in `item-sort.ts`: the checklist
 * has no stored order, so the document's order and the reader's 顺序 are one
 * promise, and the second copy of those keys would be free to disagree with it.
 *
 * WHY A FACADE AND NOT NEW IMPORT PATHS. The panel, the workbench tests, the
 * catalog and `task-search.ts` all import `item-view.ts`, and they should keep
 * doing it: an internal reorganization is not a reason for two dozen call sites
 * to change at once, and a reader who has to know nine modules to answer "how
 * does a row read" has learned a worse map than the one they had. Nothing below
 * this file is private in the type-system sense — the sub-modules are imported
 * directly where a module genuinely needs one answer (and only then) — but a
 * SURFACE imports this file, and the list below is the whole of what a surface
 * may rely on. Removing an entry from it is a change to the product's shape, not
 * a refactor.
 *
 * THE ORIGINAL FOUR RULES, which every module below still obeys. They are stated
 * here because they are the layer's contract, not any one module's:
 *
 *  1. **STABLE KEYS, NEVER DISPLAY WORDS.** A predicate compares enum values
 *     (`'urgent'`, `'open'`), never the string a reader sees. A filter written
 *     against a display name silently matches nothing the moment that name is
 *     reworded — the failure mode every "saved filter" inherits from products
 *     that store their queries as text. Keys do not move; the dictionary does.
 *  2. **ONE CLOCK, PASSED IN.** Nothing in this layer reads `Date.now()`. One
 *     render, one `now`, so two rows cannot disagree about whether a day has
 *     passed, and a test does not need a fake timer to pin a deadline verdict.
 *  3. **PROGRESS AND POSTURE ARE DERIVED, NEVER STORED.** `itemProgressOf`
 *     returns `undefined` for a row with no steps (an empty 0% bar reads as a
 *     failed load; absence reads as "there is nothing here yet"), and
 *     `datePostureOf` derives urgency from the same three date fields the reader
 *     typed.
 *  4. **A NO-OP IS NOT AN ANSWER.** The absences here are `undefined` and the
 *     empty collection, never a zero or a "none" string standing in for a value
 *     nobody computed — so a surface that forgot to ask cannot paint a
 *     confident nothing.
 */

// ── the vocabulary the models own, re-exported so one import reads it ────────
export type { ItemPriority, ItemStatus, ItemStatusView } from './item.ts'
export { ITEM_PRIORITIES, ITEM_STATUSES, ITEM_STATUS_VIEWS, itemPriorityRankOf } from './item.ts'

// ── item-dates ─────────────────────────────────────────────────────────────
export { DAY_MS, HARD_SOON_DAYS, datePostureOf, startOfDay } from './item-dates.ts'
export type { DatePosture, SoftPosture } from './item-dates.ts'

// ── item-membership ────────────────────────────────────────────────────────
export { isAgendaItem, isInboxItem } from './item-membership.ts'

// ── item-stale ─────────────────────────────────────────────────────────────
export { DEFAULT_STALE_DAYS, staleDaysOf } from './item-stale.ts'

// ── item-sort ──────────────────────────────────────────────────────────────
export { DEFAULT_ITEM_SORT, ITEM_SORTS, recentItemsOf, sortItemsOf } from './item-sort.ts'
export type { ItemSort } from './item-sort.ts'

// ── item-query ─────────────────────────────────────────────────────────────
export {
  EMPTY_ITEM_QUERY,
  ITEM_FLAGS,
  ITEM_FLAG_TESTS,
  flagProbeOf,
  isItemQualifierToken,
  itemHasFlag,
  itemMatchContextOf,
  itemMatches,
  itemQualifierVocabulary,
  dayTokenOf,
  parseItemQuery,
  PRIORITY_BY_TOKEN,
} from './item-query.ts'
export type { ItemFlag, ItemFlagProbe, ItemMatchContext, ItemQuery } from './item-query.ts'

// ── item-rail ──────────────────────────────────────────────────────────────
export { itemRailGroupsOf, railSiblingsOf, ITEM_RAIL_DATE_FLAGS, ITEM_RAIL_IDLE_FLAGS } from './item-rail.ts'
export type { ItemRailEntry, ItemRailGroup, ItemRailGroupWord, ItemRailKey, ItemRailKind } from './item-rail.ts'

// ── item-navigate ──────────────────────────────────────────────────────────
export { ITEM_PAGES, itemPageOf, planItemNavigation } from './item-navigate.ts'
export type { ItemNavigation, ItemNavigationRefusal, ItemPageId } from './item-navigate.ts'

// ── item-ask ───────────────────────────────────────────────────────────────
export { itemAskText, planItemAsk } from './item-ask.ts'
export type { ItemAskRefusal, ItemAskVerdict } from './item-ask.ts'

// ── item-rows ──────────────────────────────────────────────────────────────
export { ITEM_STATUS_ORDER, itemRefOf, itemRowViewOf, itemSlicesOf } from './item-rows.ts'
export type { ItemRef, ItemRowContext, ItemRowView, ItemSlice, ItemSliceOptions } from './item-rows.ts'

// ── item-schedule ──────────────────────────────────────────────────────────
export { SCHEDULE_BUCKETS, scheduleBucketOf, scheduleBucketsOf } from './item-schedule.ts'
export type { ScheduleBucket, ScheduleBucketId } from './item-schedule.ts'

// ── item-triage ────────────────────────────────────────────────────────────
export { triageLinesOf, allTriageLinesOf } from './item-triage.ts'
export type { TriageLine, TriageSeverity } from './item-triage.ts'

