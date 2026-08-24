/**
 * Trigger autocomplete: pure text/token logic for the prompt input.
 * Framework-free so the token scan, candidate filtering and insertion rules
 * are unit-testable without React or the runtime. One tokenizer serves both
 * triggers — '/' (slash commands + skills) and '@' (files/sessions) — so the
 * two menus share the same token, filter and flip behaviour.
 *
 * The slash candidate model mirrors the native composer's '/' menu, which
 * merges two sources: host commands (the command registry) and skills (the
 * skill catalog — every skill name is itself a slash entry like `/skill-xxx`).
 *
 * The '@' token delegates to the OFFICIAL grammar
 * (`@deepseek-ai/dsh-file-reference/grammar`): `@"path with spaces` quoted
 * tokens, word-boundary rules and the same open-quote behaviour the harness's
 * own ui-reference input uses — the board never re-implements it.
 */
import { activeAtToken } from './file-reference-grammar.ts'
import type { SlashCandidate } from '../../core/controller.ts'

/** The trigger token at the caret, when the caret sits in one. */
export interface CommandToken {
  /** Index of the token's first character (the trigger). */
  start: number
  /** One past the token's last character (the whole word, for replacement). */
  end: number
  /** Text after the trigger, up to the caret (the filter query). */
  query: string
  /** Whether the token starts a line (slash commands with hints show only then). */
  leading: boolean
  /** Whether the token is an open quoted path (`@"…`); '@' only. */
  quoted?: boolean
}

function isSeparator(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

function tokenAt(text: string, caret: number, trigger: string): CommandToken | undefined {
  if (caret < 0 || caret > text.length) return undefined
  let start = caret
  while (start > 0 && !isSeparator(text[start - 1])) start -= 1
  if (start >= caret) return undefined
  if (text[start] !== trigger) return undefined
  let end = caret
  while (end < text.length && !isSeparator(text[end])) end += 1
  const leading = start === 0 || text[start - 1] === '\n' || text[start - 1] === '\r'
  return { start, end, query: text.slice(start + 1, caret), leading }
}

/**
 * Find the slash token at `caret`. Scans back to the nearest separator to
 * locate the word start, forward to the next separator for the word end;
 * when the word starts with '/', the caret is inside a slash token. The
 * filter query is the typed text between the '/' and the caret. Returns
 * undefined otherwise.
 */
export function commandTokenAt(text: string, caret: number): CommandToken | undefined {
  return tokenAt(text, caret, '/')
}

/**
 * Find the mention token at `caret` — the OFFICIAL `@` grammar from
 * `@deepseek-ai/dsh-file-reference/grammar`: an `@` must sit at a word
 * boundary, and an open quoted path (`@"…`) is one token that may span
 * whitespace. The span covers the whole trigger prefix (`@` or `@"`);
 * `quoted` rides the token so the reference bridge can suppress session
 * discovery inside quoted paths (the official source's rule).
 */
export function mentionTokenAt(text: string, caret: number): CommandToken | undefined {
  const at = activeAtToken(text, caret)
  if (at === undefined) return undefined
  const start = caret - at.prefix.length
  return {
    start,
    end: caret,
    query: at.query,
    leading: text.search(/\S/) === start,
    ...at.quoted ? { quoted: true } : {},
  }
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

/** The replacement text for a picked slash candidate, mirroring the native
 *  menu: commands complete to `/<name>`, skills and commands with an input
 *  hint add a trailing space so typing continues. */
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

/**
 * Replace the whole '@' token span with an official mention splice (a
 * `@path` / `@"path"` file mention or a canonical `@[label](dsh-session:…)`
 * session mention). Pure span surgery shared by every board input.
 * @returns the new text and the caret position after insertion.
 */
export function insertMention(
  text: string,
  token: CommandToken,
  insert: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, token.start)}${insert}${text.slice(token.end)}`
  return { text: next, caret: token.start + insert.length }
}

/** THE '@' menu capability gate — same discipline as '/' (which needs the
 *  slash catalog): the reference menu opens only when a target session
 *  scopes the discovery AND the official reference bridge exists. A missing
 *  capability never shows an empty "no match" menu — it behaves as if the
 *  trigger did not exist at all. */
export function referenceMenuAvailable(
  sessionId: string | undefined,
  bridgePresent: boolean,
): boolean {
  return sessionId !== undefined && bridgePresent
}

/** Whether picking a row should re-open the menu right after insertion.
 *  ONLY the official directory-descent splice (`@"路径/` keeps its quote
 *  open for the next level) continues; a plain file mention, a session
 *  mention and every slash completion all close the menu silently — the
 *  cursor sits inside a live token after their splice and would otherwise
 *  instantly re-open the very menu the user just used. */
export function continueAfterPick(
  row: { insert?: string; continue?: boolean } | undefined,
): boolean {
  return row?.continue === true
}
