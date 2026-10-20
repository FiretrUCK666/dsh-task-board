/**
 * Types for scripts/verify-truncation-form.mjs.
 *
 * The project typechecks TypeScript only (`allowJs` is off, and the gate
 * scripts are plain node that `tsc` must not compile), so importing the gate
 * from a spec would otherwise be `any` — and a check with an `any` input is a
 * check nobody can trust at the call site. Declared here instead of suppressed,
 * so `tests/truncation-form.spec.ts` feeds it typed sheets and gets a typed
 * list of findings back.
 *
 * This is a type surface, not a second implementation: the runtime is the .mjs
 * beside it, and a signature that stops matching it is caught by the spec, not
 * by this file.
 */

/** One stylesheet, as the gate reads it. */
export interface Sheet {
  /** Repo-relative path, e.g. `src/client/board.module.css`. */
  rel: string
  /** The file's text. */
  css: string
}

/** One declaration of a rule body. */
export interface Declaration {
  /** The property name, e.g. `white-space`. */
  property: string
  /** The value, e.g. `nowrap`. */
  value: string
}

/**
 * A shape a page sheet may spell out on its own.
 *
 * `match` is a fragment of the NORMALISED declaration body — that is what
 * makes the exemption a ratchet: change the shape and the exemption dies.
 * `home`, when present, names a fragment that must not appear in any
 * shared-layer rule: the exemption admits that "the shared layer has no home
 * for this shape yet" and must not outlive that home.
 */
export interface PerSheetExemption {
  /** Fragment of the normalised declaration body this exemption covers. */
  match: string
  /** Fragment that, once the shared layer grows it, voids this exemption. */
  home?: string
  /** Why this shape may be spelled out here. Must be structural, not a taste. */
  why: string
}

/** The truncation form found in one rule. */
export interface TruncationForm {
  /** Which member of the family: the one-line ellipsis, or the two-line clamp. */
  kind: 'ellipsis' | 'clamp'
  /** The first declaration of the pair. */
  first: string
  /** The second declaration of the pair. */
  second: string
}

/** One page sheet that spells out the truncation form. */
export interface TruncationCopy {
  /** Repo-relative path of the sheet. */
  file: string
  /** 1-based line of the rule's selector. */
  line: number
  /** The rule's selector. */
  selector: string
  /** The at-rule the rule sits in, `''` at the top level. */
  at: string
  /** Which member of the family. */
  kind: 'ellipsis' | 'clamp'
  /** The declaration that says "do not wrap". */
  first: string
  /** The declaration that says "the cut shows an ellipsis" (or "clipped"). */
  second: string
  /** The rule's normalised declaration body. */
  body: string
  /** True when an exemption covers this shape. */
  exempt: boolean
  /** The exemption's reason, when there is one. */
  why: string | null
}

/** Where the shared forms live: the layer a page sheet may not re-spell. */
export const SHARED_LAYER: string

/** The shapes a page sheet may spell out on its own, with their reasons. */
export const PER_SHEET_EXEMPTIONS: readonly PerSheetExemption[]

/** Normalise a rule body: trimmed declarations, whitespace collapsed, order ignored. */
export function normaliseBody(body: string): string

/** The declarations of one rule body. */
export function declarationsIn(body: string): Declaration[]

/** Whether a sheet is a page sheet (as opposed to the shared layer). */
export function isPageSheet(rel: string): boolean

/** The truncation form a rule body spells out, if it spells one out. */
export function truncationFormIn(body: string): TruncationForm | null

/** Every page sheet that spells out the truncation form. */
export function truncationCopiesIn(
  sheets: Sheet[],
  exemptions?: readonly PerSheetExemption[],
): TruncationCopy[]

/** Read the client sheets of a repository. */
export function sheetsOf(root: string): Sheet[]
