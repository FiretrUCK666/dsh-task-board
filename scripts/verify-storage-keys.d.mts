/**
 * Types for scripts/verify-storage-keys.mjs.
 *
 * The project typechecks TypeScript only (`allowJs` is off, and the gate scripts
 * are plain node that `tsc` must not compile), so importing the gate from a spec
 * would otherwise be `any`. Declared here instead of suppressed.
 */

/** One key that is declared but no longer appears in the source. */
export interface StorageKeyFindings {
  /** Declared keys the source no longer mentions — a rename or a deletion. */
  wantButMissing: string[]
  /** Keys the source mentions that the declaration does not list. */
  usedButUndeclared: string[]
  /** How many distinct `dsh.taskBoard*` keys the source mentions. */
  seenCount: number
}

/** The declared key table: key → what it stores. */
export const KEYS: Readonly<Record<string, string>>

/** Renamed keys: old → new. Append-only. */
export const RENAMED: Readonly<Record<string, string>>

/** Run both directions of the judgement. */
export function findings(root: string, keys?: Readonly<Record<string, string>>): StorageKeyFindings
