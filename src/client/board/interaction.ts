/**
 * Session live to-do readout: the native `todo/write` log event carries the
 * whole list, and the newest event wins (last-write-wins). Pure and
 * framework-free so the rules unit-test in isolation. Pending native
 * questions moved to the core wire model (question-rpc.ts) — the mux frame
 * is the answerable source, not transcript events.
 */
import type { TranscriptEventShape } from '../../core/controller.ts'

/** One to-do row the native `todo/write` log event carries. */
export interface SessionTodo {
  /** What this task is — a short imperative line. */
  content: string
  /** Lifecycle state: pending / in_progress / completed. */
  status: 'pending' | 'in_progress' | 'completed'
}

/**
 * Read the latest `todo/write` snapshot out of a session's events (last-write
 * wins — the newest event holds the whole list). Returns the todo rows, or
 * undefined when the session never wrote one.
 */
export function latestSessionTodos(events: readonly TranscriptEventShape[]): SessionTodo[] | undefined {
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'todo/write') continue
    const data = event.data as { todos?: unknown } | null
    if (!Array.isArray(data?.todos)) return undefined
    const todos = data.todos
      .map((row): SessionTodo | undefined => {
        if (typeof row !== 'object' || row === null) return undefined
        const entry = row as Record<string, unknown>
        if (typeof entry.content !== 'string' || entry.content === '') return undefined
        const status = entry.status
        const normalized = status === 'in_progress' || status === 'completed' ? status : 'pending'
        return { content: entry.content, status: normalized }
      })
      .filter((row): row is SessionTodo => row !== undefined)
    return todos
  }
  return undefined
}

/** Whether one todo row is still open (not yet completed). */
export function isOpenTodo(row: SessionTodo): boolean {
  return row.status !== 'completed'
}

/** Subagent statuses that mean "finished" (the tolerant set: a native
 *  reshape that adds a new word degrades to "still active" — the context
 *  block shows work in flight, never finished work). 'inactive' is the
 *  native word the host bridge maps activity to; the legacy words stay for
 *  older bridge payloads. */
export const FINISHED_SUBAGENT_STATUS = new Set(['inactive', 'finished', 'completed', 'done', 'settled'])

/**
 * Whether the session context is WORTH showing: at least one OPEN todo, an
 * ACTIVE goal, or an unfinished subagent. Fully-done things are not the
 * readout's business — when everything listed is finished, the block hides
 * entirely (the "todo 全完成还显示上下文" issue); an unknown subagent
 * status is treated as active (shown) so a host reshape never hides running
 * work. THE one predicate every context surface reads.
 */
export function contextWorthOf(context: {
  todos?: readonly { content?: string; status?: string }[]
  goal?: { title?: string; active?: boolean }
  subagents?: readonly { title?: string; status?: string }[]
}): boolean {
  if ((context.todos ?? []).some(todo => todo.status !== 'completed')) return true
  if (context.goal?.active === true) return true
  if ((context.subagents ?? []).some(sub =>
    sub.status === undefined || !FINISHED_SUBAGENT_STATUS.has(sub.status))) return true
  return false
}
