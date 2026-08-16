/**
 * Slash-command autocomplete: pure text/token logic for the prompt input.
 * Framework-free so the token scan, candidate filtering and insertion rules
 * are unit-testable without React or the runtime.
 *
 * The candidate model mirrors the native composer's '/' menu, which merges
 * two sources: host commands (the command registry) and skills (the skill
 * catalog — every skill name is itself a slash entry like `/skill-xxx`).
 */
import type { SlashCandidate } from '../../core/controller.ts'

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

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name)

/**
 * Filter slash candidates against the query, mirroring the native composer:
 * commands match case-insensitively (prefix first, then includes) and only
 * appear at any position when they take no hint; skills match by
 * `startsWith` and appear at any position. Commands rank before skills;
 * each group stays sorted.
 */
export function filterSlashCandidates(
  candidates: readonly SlashCandidate[],
  query: string,
  leading: boolean,
): SlashCandidate[] {
  const needle = query.trim().toLowerCase()
  const commands = candidates
    .filter(candidate => candidate.kind === 'command')
    .filter(candidate => leading || candidate.hint === undefined)
    .filter(candidate => needle === '' || candidate.name.toLowerCase().includes(needle))
  const commandPrefix = commands
    .filter(candidate => needle !== '' && candidate.name.toLowerCase().startsWith(needle))
    .sort(byName)
  const commandRest = commands
    .filter(candidate => needle === '' || !candidate.name.toLowerCase().startsWith(needle))
    .sort(byName)
  const skills = candidates
    .filter(candidate => candidate.kind === 'skill')
    .filter(candidate => needle === '' || candidate.name.toLowerCase().startsWith(needle))
    .sort(byName)
  return [...commandPrefix, ...commandRest, ...skills]
}

/** The replacement text for a picked candidate, mirroring the native menu. */
export function commandCompletion(candidate: SlashCandidate): string {
  const needsSpace = candidate.kind === 'skill' || candidate.hint !== undefined
  return `/${candidate.name}${needsSpace ? ' ' : ''}`
}

/**
 * Replace the whole token word with the picked candidate's completion.
 * @returns the new text and the caret position after insertion.
 */
export function insertCommand(
  text: string,
  token: CommandToken,
  candidate: SlashCandidate,
): { text: string; caret: number } {
  const completion = commandCompletion(candidate)
  const next = `${text.slice(0, token.start)}${completion}${text.slice(token.end)}`
  return { text: next, caret: token.start + completion.length }
}
