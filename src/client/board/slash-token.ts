/**
 * Slash-command autocomplete: pure text/token logic for the prompt input.
 * Framework-free so the token scan, candidate filtering and insertion rules
 * are unit-testable without React or the runtime.
 */

/** One command candidate row (the structural face of the host descriptor). */
export interface CommandRow {
  /** Command name without the leading slash. */
  name: string
  /** Human-readable summary. */
  description: string
  /** Free-form input hint; commands with one take an argument (trailing space). */
  hint?: string
}

/** The slash token at the caret, when the caret sits in one. */
export interface CommandToken {
  /** Index of the token's first character (the '/'). */
  start: number
  /** One past the token's last character (the whole word, for replacement). */
  end: number
  /** Text after the '/', up to the caret (the filter query). */
  query: string
  /** Whether the token starts a line (commands with hints show only then). */
  leading: boolean
}

function isSeparator(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

/**
 * Find the slash token at `caret`. Scans back to the nearest separator to
 * locate the word start, forward to the next separator for the word end;
 * when the word starts with '/', the caret is inside a slash token. The
 * filter query is the typed text between the '/' and the caret. Returns
 * undefined otherwise.
 */
export function commandTokenAt(text: string, caret: number): CommandToken | undefined {
  if (caret < 0 || caret > text.length) return undefined
  let start = caret
  while (start > 0 && !isSeparator(text[start - 1])) start -= 1
  if (start >= caret) return undefined
  if (text[start] !== '/') return undefined
  let end = caret
  while (end < text.length && !isSeparator(text[end])) end += 1
  const leading = start === 0 || text[start - 1] === '\n' || text[start - 1] === '\r'
  return { start, end, query: text.slice(start + 1, caret), leading }
}

/**
 * Filter command rows against the query: case-insensitive includes match,
 * prefix matches ranked first, then alphabetical. Commands with an input
 * hint only appear when the token starts a line (mirrors the native menu's
 * leading-position rule).
 */
export function filterCommands(rows: readonly CommandRow[], query: string, leading: boolean): CommandRow[] {
  const needle = query.trim().toLowerCase()
  const byName = (a: CommandRow, b: CommandRow): number => a.name.localeCompare(b.name)
  const matches = rows.filter(row => leading || row.hint === undefined)
    .filter(row => needle === '' || row.name.toLowerCase().includes(needle))
  // Prefix matches rank first; each group stays alphabetical.
  const prefix = matches
    .filter(row => needle !== '' && row.name.toLowerCase().startsWith(needle))
    .sort(byName)
  const rest = matches
    .filter(row => needle === '' || !row.name.toLowerCase().startsWith(needle))
    .sort(byName)
  return [...prefix, ...rest]
}

/** The replacement text for a picked command, mirroring the native menu. */
export function commandCompletion(name: string, hint: string | undefined): string {
  return `/${name}${hint !== undefined ? ' ' : ''}`
}

/**
 * Replace the whole token word with the picked command's completion.
 * @returns the new text and the caret position after insertion.
 */
export function insertCommand(
  text: string,
  token: CommandToken,
  name: string,
  hint: string | undefined,
): { text: string; caret: number } {
  const completion = commandCompletion(name, hint)
  const next = `${text.slice(0, token.start)}${completion}${text.slice(token.end)}`
  return { text: next, caret: token.start + completion.length }
}
