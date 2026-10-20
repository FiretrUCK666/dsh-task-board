/**
 * Types for scripts/verify-one-implementation.mjs.
 *
 * The project typechecks TypeScript only (`allowJs` is off, and the gate
 * scripts are plain node that `tsc` must not compile), so importing the gate
 * from a spec would otherwise be `any` — and a check with an `any` input is a
 * check nobody can trust at the call site. Declared here instead of suppressed,
 * so `tests/one-implementation.spec.ts` feeds it a typed bundle and gets a
 * typed list of findings back.
 *
 * This is a type surface, not a second implementation: the runtime is the .mjs
 * beside it, and a signature that stops matching it is caught by the spec, not
 * by this file.
 */

/** One top-level declaration found in a file. */
export interface Declaration {
  /** What kind of declaration it is: `function`, `const`, `class`, … */
  kind: string
  /** The declared name. */
  name: string
  /** The declaration's code, comments stripped and whitespace collapsed. */
  body: string
  /** 1-based line of the declaration. */
  line: number
}

/** One file, as the gate reads it. */
export interface SourceFile {
  /** Repo-relative path, e.g. `src/core/values.ts`. */
  file: string
  /** The file's text. */
  text: string
}

/** One name that has more than one home. */
export interface DuplicateHome {
  /** The shared name. */
  name: string
  /** True when every home's code is byte-identical — that is a copy. */
  same: boolean
  /** Where the homes are. */
  homes: { file: string; line: number }[]
}

/** Framework-fixed plugin entry names: one per half, not two copies of one thing. */
export const EXEMPT_NAMES: ReadonlySet<string>

/** Where the addition ledger lives, relative to the repo root. */
export const RECORDS_FILE: string

/** The top-level declarations of one file. */
export function declarationsOf(text: string): Declaration[]

/** The names that have more than one home. */
export function duplicateHomes(
  files: SourceFile[],
  exempt?: ReadonlySet<string>,
): DuplicateHome[]

/** Whether the homes span two halves (client vs host/core). */
export function spansHalves(homes: { file: string }[]): boolean

/**
 * The path-shaped words in a text: `src/…`, `design/…`, `scripts/…`, `tests/…`, `lib/…`.
 *
 * The addition ledger writes the path as the FIRST word, so this is how a
 * machine-readable unit is pulled out of a sentence.
 */
export function pathsIn(text: string): string[]

/** Every .ts / .tsx under a directory. */
export function tsFilesOf(dir: string): string[]

/** The addition ledger's findings: empty `problems` means it holds up. */
export function checkAdditionRecords(root: string): { ok: boolean; problems: string[] }
