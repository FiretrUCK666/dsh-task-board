/**
 * Types for scripts/verify-read-write-parity.mjs.
 *
 * Same reason as the sibling `.d.mts` files: the gate scripts are plain node
 * that `tsc` must not compile, so a spec importing one would otherwise be `any`
 * — and a check with an `any` input is a check nobody can trust at the call site.
 */

/** Where the two sides live. */
export const PARITY_ENDS: {
  readonly catalog: string
  readonly tools: string
}

/** Where the run-config key list lives. */
export const RUN_CONFIG_HOME: string

/** Parameters that are not card fields, each with the sentence explaining why. */
export const NOT_A_FIELD: Readonly<Record<string, string>>

/** Parameters whose READ name differs from their write name, declared. */
export const READ_AS: Readonly<Record<string, string>>

/** The functions whose object literals are the query's projections. */
export const PROJECTION_FUNCTIONS: readonly string[]

/** The parameter names the catalog's write actions declare. */
export function catalogParamsOf(text: string, runConfigKeys?: readonly string[] | null): string[] | null

/** The run-config keys, read off their declaration. */
export function runConfigKeysOf(text: string): string[] | null

/** The key names the named row builders produce. */
export function projectionKeysOf(text: string, functions: readonly string[]): string[] | Set<string> | null

/** One parity check over a pair of sources. */
export interface ReadWriteParityInput {
  catalogText?: string
  toolsText?: string
  runPresetsText?: string
}

/** The findings; empty means the two sides agree. */
export function readWriteParityFindings(input: ReadWriteParityInput): string[]
