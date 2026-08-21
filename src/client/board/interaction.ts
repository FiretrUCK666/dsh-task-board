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
