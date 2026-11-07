/**
 * Types for scripts/source-core.mjs.
 *
 * The project typechecks TypeScript only (`allowJs` is off, and the gate scripts
 * are plain node that `tsc` must not compile), so importing the shared scanner
 * from a spec would otherwise be `any` — and a scanner with an `any` surface is a
 * scanner whose mistakes nobody can catch at the call site. Declared here instead
 * of suppressed, the same way every gate that a spec imports carries its own
 * `.d.mts`.
 *
 * This is a type surface, not a second implementation: the runtime is the `.mjs`
 * beside it, and a signature that stops matching it is caught by
 * `tests/source-scan.spec.ts`, not by this file.
 */

/** A character is plain code. */
export const SOURCE_CODE: 0
/** A character sits inside a comment. */
export const SOURCE_COMMENT: 1
/** A character is the delimiter quote of a string literal written in code. */
export const SOURCE_LITERAL: 2
/** A character is inside a string literal's body. */
export const SOURCE_LITERAL_BODY: 3

/** One scanned source: comments blanked out, plus each character's position. */
export interface Scan {
  /** The source with every comment replaced by spaces (newlines kept). */
  readonly text: string
  /** One entry per character: `SOURCE_CODE`, `SOURCE_COMMENT`, `SOURCE_LITERAL` or `SOURCE_LITERAL_BODY`. */
  readonly state: Uint8Array
}

/** One `case '<id>':` label written in code. */
export interface CaseLabel {
  /** The label's identifier, between the quotes. */
  readonly id: string
  /** Index of the `case` keyword. */
  readonly index: number
  /** Index just past the label's colon. */
  readonly end: number
}

/** Classify every character of a source. */
export function scanSource(source: string): Scan

/** The source with every comment replaced by spaces, everything else intact. */
export function stripSourceComments(source: string): string

/** The `case` labels written in CODE (a label inside prose or a string is not a branch). */
export function caseLabelsOf(scan: Scan): CaseLabel[]

/** The first match that STARTS in code. */
export function firstCodeMatch(scan: Scan, pattern: RegExp): RegExpExecArray | null

/** The first match that STARTS on a literal delimiter written in code. */
export function firstLiteralMatch(scan: Scan, pattern: RegExp): RegExpExecArray | null

/** The brace-balanced region starting at or after `from`, or `null`. */
export function bracedRegionOf(scan: Scan, from: number): Scan | null
