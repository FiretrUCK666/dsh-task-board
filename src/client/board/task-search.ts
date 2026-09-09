/**
 * Board-wide task search: one input, every surface a task owns. A task
 * matches when EVERY whitespace-separated term appears ANYWHERE in its
 * title, description, execution prompt, comment bodies or linked-session
 * titles (case-insensitive AND — narrowing as you type, never a surprise
 * OR flood). Empty query matches all (the filter is a sieve, not a gate).
 *
 * Pure and framework-free so the matcher unit-tests in isolation; TaskBoard
 * supplies the linked titles from its existing resolvers (no new data
 * plumbing — the haystack is assembled at the call site).
 */

/** All searchable text of one task (the caller appends session titles). */
export function taskHaystack(
  task: { title: string; description: string; prompt: string; executions: readonly { comment?: string }[] },
  sessionTitles: readonly string[] = [],
): string {
  const comments = task.executions
    .map(round => round.comment ?? '')
    .filter(text => text !== '')
  return [task.title, task.description, task.prompt, ...comments, ...sessionTitles].join('\n')
}

/** Whether a task matches a raw query string (blank query = match). */
export function matchTask(
  task: { title: string; description: string; prompt: string; executions: readonly { comment?: string }[] },
  query: string,
  sessionTitles: readonly string[] = [],
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(term => term !== '')
  if (terms.length === 0) return true
  const haystack = taskHaystack(task, sessionTitles).toLowerCase()
  return terms.every(term => haystack.includes(term))
}

/** Board keyboard shortcuts: OS-agnostic single keys (no modifiers, so touch
 *  loses nothing and the OS/browser keep theirs). Discoverable through the
 *  `?` cheatsheet, which lists exactly this set. */
export type BoardShortcut = 'focus-search' | 'clear-filter' | 'toggle-help'

/**
 * Map one keydown onto a board shortcut (`/` focuses the filter, `x` clears
 * it, `?` toggles the cheatsheet). Never fires while typing in an editable —
 * inputs keep their keystrokes — nor with modifiers held.
 */
export function boardShortcutOf(
  event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean },
  typing: boolean,
): BoardShortcut | undefined {
  if (typing) return undefined
  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return undefined
  if (event.key === '/') return 'focus-search'
  if (event.key === 'x' || event.key === 'X') return 'clear-filter'
  if (event.key === '?') return 'toggle-help'
  return undefined
}
