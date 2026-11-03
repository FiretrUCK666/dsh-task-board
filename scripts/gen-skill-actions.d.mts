/**
 * The generator's surface, for the spec that proves it cannot go quietly wrong.
 *
 * Hand-written because the generator is a plain `.mjs` (it runs under bare `node`
 * from `pnpm verify`, with no build step), while the test that pins its behaviour
 * is TypeScript. The alternative — `any` at the import site — would make the
 * "an unknown spread throws" case unreadable exactly where readability matters
 * most.
 */

/** One parameter as the catalog declares it and the reference prints it. */
export interface ParsedParam {
  readonly name: string
  readonly about: string
  readonly optional: boolean
  readonly oneOf?: readonly string[]
  readonly appliesWhen?: string
  readonly default?: string
  readonly requiredWhen?: string
}

/** One action as the catalog declares it. */
export interface ParsedAction {
  readonly id: string
  readonly verb: string
  readonly danger: string
  readonly lane: string
  readonly summary: string
  readonly params: readonly ParsedParam[]
  /** Spreads the parser could not resolve. Non-empty means the reading is wrong. */
  readonly unresolved?: readonly string[]
}

/**
 * Read the action table out of the catalog's source.
 * @param source - the contents of `src/core/board-actions.ts`.
 * @returns every action it declares, with its parameters.
 * @throws when the catalog spreads a parameter block the generator cannot expand,
 *   because silently omitting those parameters is the failure mode this guards.
 */
export function actionsOf(source: string): readonly ParsedAction[]

/**
 * Render the whole reference document.
 * @param actions - what {@link actionsOf} returned.
 * @returns the markdown that belongs on disk.
 */
export function render(actions: readonly ParsedAction[]): string
