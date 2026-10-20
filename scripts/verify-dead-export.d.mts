/**
 * Types for scripts/verify-dead-export.mjs.
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
  /** Repo-relative path, e.g. `src/core/values.ts`. */
  file: string
  /** The file's text. */
  text: string
}

/** One exported declaration. */
export interface ExportedDeclaration {
  /** The exported name. */
  name: string
  /** What kind of declaration it is: `function`, `const`, `type`, … */
  kind: string
  /** 1-based line of the declaration. */
  line: number
}

/** One export nobody uses. */
export interface DeadExport {
  /** The file that declares it. */
  file: string
  /** The exported name. */
  name: string
  /** 1-based line of the declaration. */
  line: number
}

/** Entry files: their exports ARE the package's outside surface. */
export const ENTRY_FILES: ReadonlySet<string>

/** The exported declarations of one file; ratchets (`@ts-expect-error`) are skipped. */
export function exportsOf(text: string): ExportedDeclaration[]

/** Whether the declaration at `index` is a ratchet (a deliberately wrong export). */
export function isRatchet(lines: string[], index: number): boolean

/** How often a name appears in a text, comments stripped. */
export function mentionsOf(text: string, name: string): number

/** Every identifier a text mentions, and how often — one pass, not one per name. */
export function identifiersIn(text: string): Map<string, number>

/** The exports nobody uses. */
export function deadExports(files: SourceFile[]): DeadExport[]

/** Every .ts / .tsx under a directory. */
export function tsFilesOf(dir: string): string[]
