/**
 * Types for scripts/verify-action-coverage.mjs.
 *
 * The project typechecks TypeScript only (`allowJs` is off, and the gate
 * scripts are plain node that `tsc` must not compile), so importing the gate
 * from a spec would otherwise be `any` — and a check with an `any` input is a
 * check nobody can trust at the call site. Declared here instead of suppressed,
 * so `tests/action-coverage.spec.ts` feeds it a typed bundle and gets a
 * `string[]` back.
 *
 * This is a type surface, not a second implementation: the runtime is the .mjs
 * beside it, and a signature that stops matching it is caught by the spec, not
 * by this file.
 */

/** Everything one run of the gate reads. All text: the gate never imports the
 *  TypeScript modules, it reads them the way a reviewer would. */
export interface CoverageInput {
  /** The text of src/core/board-actions.ts. */
  catalogText: string
  /** The text of src/core/controller.ts. */
  controllerText: string
  /** The scanned sources: src/client/** and the controller itself. */
  scanFiles: { path: string; text: string }[]
  /** Every exported name across src/core, the set a `semanticOf` must hit. */
  coreExportNames: string[]
  /** The text of AGENTS.md, for the rule/thing agreement check. */
  agentsText: string
  /** Repo-relative paths that exist, as the check needs to know them. */
  presentFiles: string[]
  /** Action id -> the controller methods carrying it. Injectable so a test can
   *  feed a broken table; defaults to the script's own. */
  bindings?: Record<string, string[]>
  /** Method -> why it is not an action. */
  internal?: Record<string, string>
  /** `receiver.method` -> why that receiver is not the board controller. */
  foreign?: Record<string, string>
  /** The receiver names that ARE a board controller. */
  receivers?: Set<string>
}

/** Every gap found, one sentence each. Empty means this run found nothing —
 *  which is a real answer here, because the gate has no skip path. */
export function actionCoverageFindings(input: CoverageInput): string[]

/** Read the repository into the shape the findings function takes. */
export function readRepo(root: string): CoverageInput
