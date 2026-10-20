/**
 * Types for scripts/verify-address-grammar.mjs.
 *
 * The project typechecks TypeScript only (`allowJs` is off, and the gate
 * scripts are plain node that `tsc` must not compile), so importing the gate
 * from a spec would otherwise be `any` — and a check with an `any` input is a
 * check nobody can trust at the call site. Declared here instead of suppressed.
 *
 * This is a type surface, not a second implementation: the runtime is the .mjs
 * beside it, and a signature that stops matching it is caught by the spec, not
 * by this file.
 */

/** One file, as the gate reads it. */
export interface SourceFile {
  /** Repo-relative path, e.g. `src/core/item-navigate.ts`. */
  file: string
  /** The file's text. */
  text: string
}

/** One use of the `#` sigil, outside every declared home. */
export interface StraySigil {
  /** The file. */
  file: string
  /** 1-based line of the use. */
  line: number
  /** The line's code, trimmed. */
  text: string
}

/** Where each `#` grammar lives, and which grammar it is. */
export const GRAMMAR_HOMES: Readonly<Record<string, string>>

/** Legal uses of `#` that belong to neither grammar, with the reason. */
export const EXEMPT_SIGILS: Readonly<Record<string, string>>

/** The `#` sigil uses in one file, comments stripped. */
export function sigilUses(text: string): { line: number; text: string }[]

/** The uses of `#` that fall outside every declared home. */
export function straySigils(files: SourceFile[]): StraySigil[]

/** The declared homes that do not exist on disk. */
export function missingHomes(root: string): string[]

/** Every .ts / .tsx under a directory. */
export function tsFilesOf(dir: string): string[]
