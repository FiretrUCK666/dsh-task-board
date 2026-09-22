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

/** Feed cluster: the same three kinds the feed filter offers (all/run/
 *  comment/other), so a filter switch keeps or drops whole kinds — it never
 *  hollows out a row's meaning mid-kind. */
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

/**
 * Split a live newest-first feed into the frozen window and the queued
 * remainder: the view shows the oldest `base` rows (what was on screen when
 * the drawer opened or the pill was last tapped); newer arrivals queue behind
 * the pill instead of shoving the rows being read. A negative base means
 * "unfrozen" (first frame, filter mid-typing): the whole live list shows
 * with zero queued, so the freeze engaging a beat later changes nothing
 * visible. Shrinking feeds clamp to the whole list. Pure.
 */
export function freezeFeed<T>(
  live: readonly T[],
  base: number,
): { frozen: T[]; fresh: number } {
  if (base < 0) return { frozen: [...live], fresh: 0 }
  const fresh = Math.max(0, live.length - base)
  return { frozen: live.slice(Math.max(0, live.length - base)), fresh }
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
