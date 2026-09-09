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
  const events = boardEventsOf(tasks, {
    ...(isUnviewed !== undefined
      ? { viewedBaselineOf: undefined }
      : {}),
  })
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
  return items
    .sort((a, b) => b.at - a.at)
    .slice(0, ACTIVITY_LIMIT)
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
