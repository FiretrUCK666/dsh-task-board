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
    /** Card priority (for the `has:priority` qualifier). */
    priority?: number
    /** Card labels (for the `label:` qualifier, already lowercase). */
    labels?: readonly string[]
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

/** One parsed `key:value` qualifier (see QUALIFIER_KEYS for the key set).
 *  Anything else stays a literal search term — an unknown qualifier narrows
 *  like ordinary text instead of failing. */
export interface BoardQualifier {
  key: string
  value: string
}

/**
 * Split a raw query into plain terms plus recognized qualifiers (see
 * QUALIFIER_KEYS/QUALIFIER_VALUES for the key set and enumerated values).
 * Matching is case-insensitive; `has:` accepts `auto`/`color`/`priority`,
 * `is:` accepts `unread`/`read`, `ws:` takes any text, `label:` takes a
 * label name —
 * quoted (`ws:"a b"`) when the name holds a space, first word otherwise.
 * Anything unrecognized stays a literal search term: an unknown qualifier
 * narrows like ordinary text instead of failing.
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
      if (!value.includes('"') && value !== '' && (key === 'has' || key === 'is' || key === 'ws' || key === 'label')) {
        if (key === 'has' && (value === 'auto' || value === 'color' || value === 'priority')) {
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
        if (key === 'label') {
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
  task: { color?: string; priority?: number; labels?: readonly string[] },
  qualifier: BoardQualifier,
  facets: BoardQueryFacets,
): boolean {
  if (qualifier.key === 'has' && qualifier.value === 'auto') return facets.hasAutomation === true
  if (qualifier.key === 'has' && qualifier.value === 'color') return task.color !== undefined
  if (qualifier.key === 'has' && qualifier.value === 'priority') return task.priority !== undefined
  if (qualifier.key === 'label') {
    return task.labels !== undefined && task.labels.includes(qualifier.value)
  }
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

/** Qualifier keys the filter understands (the completion source of truth —
 *  adding a qualifier here teaches the parser, the cheatsheet hint and the
 *  suggestion list at once). */
export const QUALIFIER_KEYS: readonly string[] = ['has:', 'is:', 'ws:', 'label:']

/** Enumerated qualifier values (keys that take only these; `ws:`/`label:`
 *  take free text and complete nothing). */
const QUALIFIER_VALUES: Readonly<Record<string, readonly string[]>> = {
  'has:': ['has:auto', 'has:color', 'has:priority'],
  'is:': ['is:unread', 'is:read'],
}

/** All enumerated values (every `key:value` the completion can offer). */
const ENUMERATED_VALUES: readonly string[] = Object.values(QUALIFIER_VALUES).flat()

/** Completion candidates for the token being typed (at most 8, key-first):
 *  a key prefix offers keys (`h` → `has:`), a bare key offers its values
 *  (`has:` → its three), a value prefix narrows them (`has:a` → `has:auto`).
 *  Free-text keys (`ws:`/`label:`) and complete tokens offer nothing — the
 *  native datalist narrows the offered set further as typing continues. */
export function completeBoardQuery(query: string): string[] {
  const token = query.toLowerCase().split(/\s+/).pop() ?? ''
  if (token === '' || token.includes('"')) return []
  const separator = token.indexOf(':')
  if (separator < 0) {
    return QUALIFIER_KEYS.filter(key => key.startsWith(token)).slice(0, 8)
  }
  const key = `${token.slice(0, separator)}:`
  const values = QUALIFIER_VALUES[key]
  if (values === undefined) return []
  const prefix = token.slice(separator + 1)
  // A complete enumerated value offers nothing more (already done — same as
  // the trailing-space case, never self-suggest).
  if (ENUMERATED_VALUES.includes(token)) return []
  return values.filter(value => value.startsWith(`${key}${prefix}`)).slice(0, 8)
}

/** Assemble a full query from a completion candidate: the last token is
 *  replaced in place (earlier tokens, their case and the separating spaces
 *  survive — a native datalist swaps the WHOLE value, so candidates must
 *  arrive as whole queries, never bare tokens). */
export function applyCompletion(query: string, candidate: string): string {
  const cut = Math.max(query.lastIndexOf(' '), query.lastIndexOf('\t'), query.lastIndexOf('\n'))
  return cut < 0 ? candidate : `${query.slice(0, cut + 1)}${candidate}`
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
