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
  task: {
    title: string
    description: string
    prompt: string
    executions: readonly { comment?: string }[]
    /** Card accent color (for the `has:color` qualifier). */
    color?: string
  },
  query: string,
  sessionTitles: readonly string[] = [],
  facets: BoardQueryFacets = {},
): boolean {
  const { terms, qualifiers } = parseBoardQuery(query)
  if (terms.length > 0) {
    const haystack = taskHaystack(task, sessionTitles).toLowerCase()
    if (!terms.every(term => haystack.includes(term))) return false
  }
  return qualifiers.every(qualifier => matchQualifier(task, qualifier, facets))
}

/** Caller-resolved facets a qualifier can test (the board wires its live
 *  resolvers; absent = the qualifier cannot match, never an error). */
export interface BoardQueryFacets {
  workspaceTitle?: string
  hasAutomation?: boolean
  isUnviewed?: boolean
}

/** One parsed `key:value` qualifier (`has:auto`, `has:color`, `is:unread`,
 *  `is:read`, `ws:<text>`). Anything else stays a literal search term — an
 *  unknown qualifier narrows like ordinary text instead of failing. */
export interface BoardQualifier {
  key: string
  value: string
}

/**
 * Split a raw query into plain terms plus recognized qualifiers. Matching is
 * case-insensitive; `has:` accepts `auto`/`color`, `is:` accepts
 * `unread`/`read`, `ws:` takes any text — quoted (`ws:"a b"`) when the name
 * holds a space, first word otherwise. Anything unrecognized stays a literal
 * search term: an unknown qualifier narrows like ordinary text instead of
 * failing.
 */
export function parseBoardQuery(query: string): { terms: string[]; qualifiers: BoardQualifier[] } {
  const terms: string[] = []
  const qualifiers: BoardQualifier[] = []
  // Quoted `ws:` values first (multi-word workspace names); the remainder
  // splits on whitespace as usual. An empty quote pair is left alone (it
  // falls through to a literal term and matches nothing — never a silent
  // pass-all), and so is an unclosed quote (a quote inside a value is never
  // a facet value, so the token stays literal text).
  const quoted: Array<{ key: string; value: string }> = []
  const stripped = query.replace(/(^|\s)ws:"([^"]*)"/gi, (match, _space, value: string) => {
    if (value.trim() !== '') quoted.push({ key: 'ws', value: value.trim().toLowerCase() })
    return value.trim() === '' ? match : ' '
  })
  for (const raw of stripped.trim().toLowerCase().split(/\s+/)) {
    if (raw === '') continue
    const separator = raw.indexOf(':')
    if (separator > 0) {
      const key = raw.slice(0, separator)
      const value = raw.slice(separator + 1)
      // A quote inside a would-be facet value means an unclosed `ws:"..."` —
      // the token stays literal text (a facet value never contains quotes).
      if (!value.includes('"') && value !== '' && (key === 'has' || key === 'is' || key === 'ws')) {
        if (key === 'has' && (value === 'auto' || value === 'color')) {
          qualifiers.push({ key, value })
          continue
        }
        if (key === 'is' && (value === 'unread' || value === 'read')) {
          qualifiers.push({ key, value })
          continue
        }
        if (key === 'ws') {
          qualifiers.push({ key, value })
          continue
        }
      }
    }
    terms.push(raw)
  }
  return { terms, qualifiers: [...quoted, ...qualifiers] }
}

/** Whether one qualifier holds (unknown facets read absent = no match). */
function matchQualifier(
  task: { color?: string },
  qualifier: BoardQualifier,
  facets: BoardQueryFacets,
): boolean {
  if (qualifier.key === 'has' && qualifier.value === 'auto') return facets.hasAutomation === true
  if (qualifier.key === 'has' && qualifier.value === 'color') return task.color !== undefined
  if (qualifier.key === 'is' && qualifier.value === 'unread') return facets.isUnviewed === true
  if (qualifier.key === 'is' && qualifier.value === 'read') return facets.isUnviewed === false
  if (qualifier.key === 'ws') {
    const title = facets.workspaceTitle ?? ''
    return title.toLowerCase().includes(qualifier.value)
  }
  return false
}

/** Board keyboard shortcuts: OS-agnostic single keys (no modifiers, so touch
 *  loses nothing and the OS/browser keep theirs). Discoverable through the
 *  `?` cheatsheet, which lists exactly this set. */
export type BoardShortcut = 'focus-search' | 'clear-filter' | 'toggle-help'

/**
 * Whether a keydown target is mid-typing: inside an editable, or composing
 * text (CJK input method wedges `isComposing`/229 while the candidate window
 * lives outside any input — without this guard a `/`, `x` or `?` meant as
 * pinyin/标点 would yank focus, clear the filter or pop the cheatsheet).
 * THE one typing judgment: callers pass its answer as `typing` instead of
 * re-deriving it, so adding a key never forks the predicate.
 */
export function isShortcutTyping(
  target: unknown,
  event: { isComposing?: boolean; keyCode?: number },
): boolean {
  if (event.isComposing === true || event.keyCode === 229) return true
  if (target === null || typeof target !== 'object') return false
  const closest = (target as { closest?: unknown }).closest
  if (typeof closest !== 'function') return false
  return (closest as (selectors: string) => unknown)
    .call(target, 'input, textarea, select, [contenteditable="true"]') !== null
}

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

/** One cheatsheet row: the key plus its current-language description. */
export interface CheatRow {
  key: string
  text: string
}

/** Whether a cheatsheet row survives the filter (blank = all; key or text
 *  substring, case-insensitive — the same sieve spirit as the task filter). */
export function matchCheatRow(row: CheatRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return row.key.toLowerCase().includes(q) || row.text.toLowerCase().includes(q)
}
