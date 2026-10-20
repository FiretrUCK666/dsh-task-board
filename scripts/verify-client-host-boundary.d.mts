/**
 * Types for scripts/verify-client-host-boundary.mjs.
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
  /** Repo-relative path, e.g. `src/client/TaskBoardIcon.tsx`. */
  file: string
  /** The file's text. */
  text: string
}

/** Which half a file belongs to. `core` is the layer both halves may read. */
export type Half = 'client' | 'host' | 'core' | 'other'

/** One import that reaches across a half. */
export interface BoundaryViolation {
  /** The importing file. */
  file: string
  /** 1-based line of the import. */
  line: number
  /** The import specifier as written. */
  spec: string
  /** The half the importer is in. */
  from: Half
  /** The half the imported module is in. */
  to: Half
}

/** The half a repo-relative path belongs to. */
export function halfOf(rel: string): Half

/** The import targets of one file, comments stripped. */
export function importsOf(text: string): { spec: string; line: number }[]

/** The imports that reach across a half. */
export function boundaryViolations(files: SourceFile[]): BoundaryViolation[]

/** Every .ts / .tsx under a directory. */
export function tsFilesOf(dir: string): string[]
