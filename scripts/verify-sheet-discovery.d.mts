/**
 * Types for scripts/verify-sheet-discovery.mjs.
 *
 * The project typechecks TypeScript only (`allowJs` is off, and the gate scripts
 * are plain node that `tsc` must not compile), so importing the gate from a spec
 * would otherwise be `any` — and a check with an `any` input is a check nobody
 * can trust at the call site. Declared here instead of suppressed.
 *
 * This is a type surface, not a second implementation: the runtime is the .mjs
 * beside it, and a signature that stops matching it is caught by the spec.
 */

/** One array literal found in a source text. */
export interface ArrayLiteral {
  /** The text between the brackets. */
  inner: string
  /** Index of the `[`. */
  open: number
  /** Index of the matching `]`. */
  close: number
}

/** One file that is judged to be carrying a hand-written sheet list. */
export interface SheetListFinding {
  /** Repo-relative path of the file. */
  rel: string
  /** The sheets the list names, sorted. */
  sheets: string[]
}

/** Every array literal in a source text, by bracket matching. */
export function arrayLiterals(code: string): ArrayLiteral[]

/** The depth-1 members of an array literal that are nothing but a sheet path. */
export function bareSheetElements(inner: string): string[]

/** The names among `names` that really exist on disk under `root`. */
export function realSheetsOf(names: readonly string[], root: string): Set<string>

/** Whether the array at `openAt`…`closeAt` is walked (`for…of` / `.map` / … ). */
export function isIterated(code: string, openAt: number, closeAt: number): boolean

/** Every hand-written sheet list in `scripts/verify-*.mjs` and `tests/*.ts`. */
export function findings(root: string): SheetListFinding[]

/** Gate scripts that carry no self-test switch at all (hard rule 16). */
export function gatesWithoutProbe(root: string): string[]
