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
import { dueStateOf } from './card-view.ts'
import { isTaskStatus } from '../../core/tasks.ts'

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
    /** Card column (for the `due:` qualifiers — only live columns carry dues). */
    status?: string
    /** Due instant (for the `due:` qualifiers). */
    dueAt?: number
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
  // Tokenize first (single scanner — the overview chips remove exactly these
  // units). Only `ws:"..."` spans stay atomic (the one quoted form: labels
  // are spaceless single tokens and enumerated values are closed sets, so
  // neither can hold a space worth quoting). An empty quote pair is left
  // alone (it falls through to a literal term and matches nothing — never a
  // silent pass-all), and so is an unclosed quote (a quote inside a value is
  // never a facet value, so the token stays literal text).
  for (const token of splitFilterTokens(query)) {
    const quoted = /^ws:"([^"]*)"$/i.exec(token)
    if (quoted !== null) {
      const quotedValue = quoted[1] ?? ''
      if (quotedValue.trim() !== '') qualifiers.push({ key: 'ws', value: quotedValue.trim().toLowerCase() })
      else terms.push(token.toLowerCase())
      continue
    }
    const raw = token.toLowerCase()
    const separator = raw.indexOf(':')
    if (separator > 0) {
      const key = raw.slice(0, separator)
      const value = raw.slice(separator + 1)
      // A quote inside a would-be facet value means an unclosed `ws:"..."` —
      // the token stays literal text (a facet value never contains quotes).
      // Keys and enumerated values read the derived tables (single source —
      // adding a qualifier to the tables teaches the parser automatically).
      if (!value.includes('"') && value !== '' && QUALIFIER_KEY_SET.has(key)) {
        if (ENUM_VALUE_SET.has(`${key}:${value}`) || FREE_TEXT_KEYS.has(key)) {
          qualifiers.push({ key, value })
          continue
        }
      }
    }
    terms.push(raw)
  }
  return { terms, qualifiers }
}

/** Whether one qualifier holds (unknown facets read absent = no match).
 *  The predicate reads THE registry above — no second table, so matching
 *  can never drift from parsing: whatever the parser accepts, this resolves
 *  through the same definition. */
function matchQualifier(
  task: {
    color?: string
    priority?: number
    labels?: readonly string[]
    status?: string
    dueAt?: number
  },
  qualifier: BoardQualifier,
  facets: BoardQueryFacets,
): boolean {
  const full = `${qualifier.key}:${qualifier.value}`
  if (ENUM_VALUE_SET.has(full)) {
    return QUALIFIER_DEFS[full]?.test(task, facets, qualifier.value) === true
  }
  if (FREE_TEXT_KEYS.has(qualifier.key)) {
    return QUALIFIER_DEFS[`${qualifier.key}:`]?.test(task, facets, qualifier.value) === true
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

/** One qualifier predicate: task fields + caller-resolved facets + the value. */
type QualifierTest = (
  task: {
    color?: string
    priority?: number
    labels?: readonly string[]
    status?: string
    dueAt?: number
  },
  facets: BoardQueryFacets,
  value: string,
) => boolean

/** One qualifier definition: its predicate plus whether it takes free text
 *  (any value through the predicate) or only its enumerated pair.
 *  THE single source — one entry here teaches parsing, completion AND
 *  matching at once; every view below is derived, never edited. */
interface QualifierDef {
  test: QualifierTest
  freeText?: boolean
}

const QUALIFIER_DEFS: Readonly<Record<string, QualifierDef>> = {
  'has:auto': { test: (_task, facets) => facets.hasAutomation === true },
  'has:color': { test: task => task.color !== undefined },
  'has:priority': { test: task => task.priority !== undefined },
  'is:unread': { test: (_task, facets) => facets.isUnviewed === true },
  'is:read': { test: (_task, facets) => facets.isUnviewed === false },
  // Due qualifiers read the card's day state (the same fact the due chips
  // render — never a second date judgment). `due:today` is the Today lens
  // (today's dues PLUS overdue — an undone overdue is still today's work);
  // `due:overdue` is the strictly-past subset. Both skip done/review
  // columns with the chips (a finished card is never "due").
  'due:today': {
    test: task => task.status !== undefined && isTaskStatus(task.status)
      && dueStateOf({ status: task.status, dueAt: task.dueAt }) !== undefined,
  },
  'due:overdue': {
    test: task => task.status !== undefined && isTaskStatus(task.status)
      && dueStateOf({ status: task.status, dueAt: task.dueAt }) === 'overdue',
  },
  'ws:': {
    test: (_task, facets, value) => (facets.workspaceTitle ?? '').toLowerCase().includes(value),
    freeText: true,
  },
  'label:': {
    test: (task, _facets, value) => task.labels !== undefined && task.labels.includes(value),
    freeText: true,
  },
}

/** Qualifier keys the filter understands — derived from the registry. */
export const QUALIFIER_KEYS: readonly string[] = [...new Set(
  Object.keys(QUALIFIER_DEFS).map(full => `${full.slice(0, full.indexOf(':'))}:`),
)]

/** Enumerated qualifier values by key — derived from the registry. */
const QUALIFIER_VALUES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  QUALIFIER_KEYS
    .map(key => [key, Object.keys(QUALIFIER_DEFS).filter(full => full.startsWith(key) && QUALIFIER_DEFS[full]?.freeText !== true)] as const)
    .filter(([, values]) => values.length > 0),
)

/** All enumerated values (every `key:value` the completion can offer). */
const ENUMERATED_VALUES: readonly string[] = Object.values(QUALIFIER_VALUES).flat()

/** Parser key set, derived (no second hardcode: a key added to the registry
 *  parses, hints and completes at once). */
const QUALIFIER_KEY_SET: ReadonlySet<string> = new Set(QUALIFIER_KEYS.map(key => key.slice(0, -1)))

/** Enumerated `key:value` set, derived (the parser accepts exactly these). */
const ENUM_VALUE_SET: ReadonlySet<string> = new Set(ENUMERATED_VALUES)

/** Free-text keys, derived (registry entries flagged freeText). */
const FREE_TEXT_KEYS: ReadonlySet<string> = new Set(
  Object.keys(QUALIFIER_DEFS)
    .filter(full => QUALIFIER_DEFS[full]?.freeText === true)
    .map(full => full.slice(0, -1)),
)

/** Completion candidates for the token being typed (at most 8, key-first):
 *  a key prefix offers keys (`h` → `has:`), a bare key offers its values
 *  (`has:` → its three), a value prefix narrows them (`has:a` → `has:auto`).
 *  Free-text keys (`ws:`/`label:`) and complete tokens offer nothing — the
 *  native datalist narrows the offered set further as typing continues.
 *  The token reads THE single scanner (a `ws:"..."` span is one token —
 *  completion never fires from inside quotes). */
export function completeBoardQuery(query: string): string[] {
  const token = splitFilterTokens(query).pop()?.toLowerCase() ?? ''
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
 *  replaced in place (earlier tokens, their case and every separator survive
 *  — a native datalist swaps the WHOLE value, so candidates must arrive as
 *  whole queries, never bare tokens). A trailing separator means a fresh
 *  empty token: the candidate appends instead of replacing. The boundary
 *  reads THE single scanner (no trailing separator ⇒ the last token is the
 *  string's suffix — a `ws:"..."` span can never be torn, even if a caller
 *  passes a candidate for a quoted context). */
export function applyCompletion(query: string, candidate: string): string {
  if (query === '' || /\s$/.test(query)) return `${query}${candidate}`
  const tokens = splitFilterTokens(query)
  const last = tokens[tokens.length - 1]
  if (last === undefined) return candidate
  return `${query.slice(0, query.length - last.length)}${candidate}`
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

/** Split a filter query into removable tokens — THE one scanner both the
 *  parser and the overview chips read, so chips remove exactly what the
 *  parser sees. Only `ws:"..."` spans stay atomic (the one quoted form);
 *  every other quote splits normally (unclosed/non-ws quotes are literal
 *  text to the parser, so the chips must show them split too). */
export function splitFilterTokens(query: string): string[] {
  const tokens: string[] = []
  const flush = (text: string): void => {
    for (const part of text.split(/\s+/)) {
      if (part !== '') tokens.push(part)
    }
  }
  const pattern = /(^|\s)(ws:"[^"]*")/gi
  let last = 0
  let match: RegExpExecArray | null
  pattern.lastIndex = 0
  while ((match = pattern.exec(query)) !== null) {
    flush(query.slice(last, match.index))
    tokens.push(match[2] ?? match[0])
    last = match.index + match[0].length
  }
  flush(query.slice(last))
  return tokens
}

/** Remove the token at `index` (single-token removal for the overview
 *  chips — Clear-all is just `setFilter('')`, never this). Out-of-range
 *  indexes return the query unchanged. */
export function removeFilterToken(query: string, index: number): string {
  const tokens = splitFilterTokens(query)
  if (index < 0 || index >= tokens.length) return query
  tokens.splice(index, 1)
  return tokens.join(' ')
}
