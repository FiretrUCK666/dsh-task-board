/**
 * Types for scripts/verify-carrier-parity.mjs.
 *
 * The project typechecks TypeScript only (`allowJs` is off, and the gate scripts
 * are plain node that `tsc` must not compile), so importing the gate from a spec
 * would otherwise be `any` — and a check with an `any` input is a check nobody
 * can trust at the call site. Declared here instead of suppressed.
 *
 * This is a type surface, not a second implementation: the runtime is the .mjs
 * beside it, and a signature that stops matching it is caught by the spec, not
 * by this file.
 */

/** Where each of the three ends lives. */
export const CARRIER_ENDS: {
  readonly list: { readonly file: string; readonly symbol: string }
  readonly union: { readonly file: string; readonly symbol: string }
  readonly dispatch: { readonly file: string; readonly symbol: string }
}

/** The three source texts a parity check reads; `undefined` = the file is absent. */
export interface CarrierParityInput {
  listText?: string
  unionText?: string
  dispatchText?: string
}

/** The names in a `const NAME = ['a', 'b'] as const` array, or null when unreadable. */
export function carrierListOf(text: string, symbol: string): string[] | null

/** The `type:` literals of the `BoardCommand` union, or null when unreadable. */
export function unionCarriersOf(text: string): string[] | null

/** The keys of a dispatch table declared as `const NAME: T = { … }`, or null. */
export function dispatchKeysOf(text: string, symbol: string): string[] | null

/** The findings for one set of sources; empty means the three ends agree. */
export function carrierParityFindings(input: CarrierParityInput): string[]
