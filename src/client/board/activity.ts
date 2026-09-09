/**
 * Board activity feed: the recent notable moments of every task in one
 * read-only list (creations, starts, settlements, queued/running/settled
 * comments, external observations, direct sends, refine turns — newest
 * first, capped). DERIVED from the snapshot on every render, never stored:
 * a journal would be new synced state (merge grammar, migration), while the
 * moments themselves already live in the ledger (createdAt, startedAt,
 * endedAt, comment bodies). Clicking a row opens the task detail — the feed
 * owns no surface of its own.
 *
 * Pure and framework-free so the derivation unit-tests in isolation. The
 * rich derivation lives in `core/board-events.ts`; this module is the thin
 * feed adapter (filter + cap) so notifications/activity/cards share one
 * truth.
 */
import { boardEventsOf, type BoardEventKind, type BoardEventState } from '../../core/board-events.ts'
import type { TaskRecord } from '../../core/tasks.ts'

/** Cap: the feed is a glance, not an archive (older moments live on cards). */
export const ACTIVITY_LIMIT = 50

/** One feed row: what happened, where, when. */
export interface ActivityItem {
  /** Stable row key (task + moment). */
  key: string
  taskId: string
  taskTitle: string
  kind: 'created' | 'settled' | 'comment' | 'refined' | 'started' | 'queued' | 'running' | 'direct' | 'external'
  /** Settled outcome (only for settled moments). */
  result?: 'succeeded' | 'failed' | 'cancelled'
  /** Comment/refine/direct text excerpt source. */
  text?: string
  at: number
  /** Lifecycle of the moment (queued/running/settled). */
  state?: BoardEventState
  /** Related native session (run/comment/external/direct). */
  sessionId?: string
}

/** Feed filter (all local UI state — never synced). */
export interface ActivityFilter {
  kinds?: ReadonlyArray<ActivityItem['kind']>
  onlyUnviewed?: boolean
  query?: string
}

/** Fold cluster: the same three groups the feed filter offers (all/run/
 *  comment/other), so a group never straddles a filter switch — filtering to
 *  `run` drops whole comment/other groups instead of hollowing them out. */
export type ActivityCluster = 'run' | 'comment' | 'other'

/** The cluster partition, ONE table: `clusterOf` derives from it and the
 *  Dialog's filter map reads it, so a new row kind changes exactly one place. */
export const CLUSTER_KINDS: Record<ActivityCluster, readonly ActivityItem['kind'][]> = {
  run: ['started', 'settled'],
  comment: ['comment', 'queued', 'running'],
  other: ['created', 'refined', 'direct', 'external'],
}

/** Map one row kind onto its fold cluster (derived from the single table). */
export function clusterOf(kind: ActivityItem['kind']): ActivityCluster {
  for (const cluster of Object.keys(CLUSTER_KINDS) as ActivityCluster[]) {
    if (CLUSTER_KINDS[cluster].includes(kind)) return cluster
  }
  return 'other'
}

/** One folded object-day group: same task, same calendar day, same cluster.
 *  Order inside and across groups inherits the feed order (newest first) —
 *  grouping never re-sorts, it only nests. */
export interface ActivityGroup {
  /** Stable group key (task + day + cluster, see {@link activityGroupKeyOf}). */
  key: string
  taskId: string
  taskTitle: string
  day: string
  cluster: ActivityCluster
  items: ActivityItem[]
}

/** THE group-key constructor (`task|day|cluster`): grouping, expansion state
 *  and remainder keys all derive from this one function — never a retyped
 *  template — so folded identity can never disagree with itself. */
export function activityGroupKeyOf(taskId: string, day: string, cluster: ActivityCluster): string {
  return `${taskId}|${day}|${cluster}`
}

/** THE remainder-row key for a folded group: `groupKey + '|rest'` — one
 *  constructor beside the group key, so the two can never drift apart
 *  (notification folds reuse it with their task-scoped key). */
export function remainderKeyOf(groupKey: string): string {
  return `${groupKey}|rest`
}

/**
 * Fold feed rows into object-day groups (GetStream-style aggregation keyed on
 * object × day, with the filter cluster as the third leg). Single-item groups
 * render exactly like unfolded rows, so sparse feeds look byte-identical to
 * before — only genuinely busy object-days gain a header. Pure: no truncation
 * here (caps stay at the feed/window layer), no unread marking (feed rows
 * carry no unread signal by contract — unread breathes on the card only).
 */
export function groupActivityByObjectDay(
  items: readonly ActivityItem[],
  dayOf: (at: number) => string,
): ActivityGroup[] {
  const groups: ActivityGroup[] = []
  const index = new Map<string, ActivityGroup>()
  for (const item of items) {
    const day = dayOf(item.at)
    const cluster = clusterOf(item.kind)
    const key = activityGroupKeyOf(item.taskId, day, cluster)
    const existing = index.get(key)
    if (existing !== undefined) {
      existing.items.push(item)
      continue
    }
    const group: ActivityGroup = {
      key,
      taskId: item.taskId,
      taskTitle: item.taskTitle,
      day,
      cluster,
      items: [item],
    }
    index.set(key, group)
    groups.push(group)
  }
  return groups
}

/** Cap: an expanded group shows this many newest rows; the rest reads as one
 *  quiet remainder line (navigation stays on the group header's 进详情 — the
 *  remainder is information, never a second toggle). */
export const GROUP_ITEM_LIMIT = 10

/**
 * Split a group's rows into the shown head and the folded remainder count.
 * Generic over the row shape (feed rows and notification rows share the cap
 * discipline, never a second copy): the header always counts the full group
 * (the count never lies about the cap). The limit normalizes defensively
 * (non-finite → the default cap, negatives → 0, fractions → floor): an open
 * generic must never lie about counts no matter who calls it next. Pure so
 * the cap unit-tests without rendering.
 */
export function splitGroupItems<T>(
  items: readonly T[],
  limit: number = GROUP_ITEM_LIMIT,
): { shown: T[]; rest: number } {
  const capped = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : GROUP_ITEM_LIMIT
  if (items.length <= capped) return { shown: [...items], rest: 0 }
  return { shown: items.slice(0, capped), rest: items.length - capped }
}

/**
 * Collect every notable moment of every task, newest first. Running rounds
 * ARE moments (their start/observation/injection lights the feed); an empty
 * comment body stays (the row shows a placeholder) — the view decides
 * trimming, never the derivation.
 */
export function activityOf(
  tasks: readonly TaskRecord[],
  filter: ActivityFilter = {},
  isUnviewed?: (task: TaskRecord, at: number) => boolean,
): ActivityItem[] {
  // Upstream is already newest-first; filtering preserves order, so no
  // re-sort here (one ordering, one place).
  const events = boardEventsOf(tasks)
  const items: ActivityItem[] = []
  for (const event of events) {
    if (event.kind === 'waiting') continue
    const mapped = toActivityItem(event)
    if (mapped === undefined) continue
    // Unviewed filter needs the ledger baseline — resolved by the caller
    // through `isUnviewed(task, at)`; absent = no unviewed filtering.
    if (filter.onlyUnviewed === true && isUnviewed !== undefined) {
      const task = tasks.find(candidate => candidate.id === event.taskId)
      if (task === undefined || !isUnviewed(task, event.at)) continue
    }
    if (filter.kinds !== undefined && filter.kinds.length > 0 && !filter.kinds.includes(mapped.kind)) continue
    if (filter.query !== undefined && filter.query.trim() !== '') {
      const query = filter.query.trim().toLowerCase()
      const haystack = `${mapped.taskTitle} ${mapped.text ?? ''}`.toLowerCase()
      if (!haystack.includes(query)) continue
    }
    items.push(mapped)
  }
  return items.slice(0, ACTIVITY_LIMIT)
}

/** Map one shared event onto the feed's row grammar. */
function toActivityItem(event: {
  key: string
  taskId: string
  taskTitle: string
  kind: BoardEventKind
  state: BoardEventState
  at: number
  result?: 'succeeded' | 'failed' | 'cancelled'
  text?: string
  sessionId?: string
}): ActivityItem | undefined {
  const base = {
    key: event.key,
    taskId: event.taskId,
    taskTitle: event.taskTitle,
    at: event.at,
    state: event.state,
    ...(event.result !== undefined ? { result: event.result } : {}),
    ...(event.text !== undefined ? { text: event.text } : {}),
    ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
  }
  switch (event.kind) {
    case 'created':
      return { ...base, kind: 'created' }
    case 'run':
      return { ...base, kind: event.state === 'settled' ? 'settled' : 'started' }
    case 'comment':
      if (event.state === 'queued') return { ...base, kind: 'queued' }
      if (event.state === 'running') return { ...base, kind: 'running' }
      return { ...base, kind: 'comment' }
    case 'external':
      return { ...base, kind: 'external' }
    case 'direct':
      return { ...base, kind: 'direct' }
    case 'refined':
      return { ...base, kind: 'refined' }
    default:
      return undefined
  }
}
