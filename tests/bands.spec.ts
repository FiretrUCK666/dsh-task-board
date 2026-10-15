/**
 * The breakpoint contract: the sheets and the JS agree, by construction.
 *
 * WHY THIS IS A SPEC AND NOT A COMMENT. Every panel sizes itself from its own
 * box, so the boundary between "wide" and "narrow" has to be answered twice —
 * `useSurfaceNarrow` measures it in JS, `@container` measures it in CSS — and
 * CSS cannot read a TS module. The numbers therefore lived in six places, held
 * in step by nothing but attention. The one-pixel seam that produced is written
 * down in `item.module.css`: JS reads `width <= 1080` as narrow while the sheet
 * asks `min-width: 1081px`. The pair is right; the fact that it is right is
 * what nothing was checking.
 *
 * `src/client/design/bands.ts` is the definition of record. This file holds
 * BOTH directions to it: a query with no row is red, and a row with no query is
 * red — the second half is what keeps the table from becoming a description of
 * a layout that no longer exists.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allBands, BANDS } from '../src/client/design/bands.ts'
import { clientSheets, repoRoot } from './panel-harness.ts'

/** `@container <name> (max-width: <n>px)` — the narrow side of a boundary. */
const MAX_QUERY = /@container\s+([\w-]+)\s*\(\s*max-width:\s*(\d+)px\s*\)/g

/** `@container <name> (min-width: <n>px)` — the wide side, which must be narrow + 1. */
const MIN_QUERY = /@container\s+([\w-]+)\s*\(\s*min-width:\s*(\d+)px\s*\)/g

/** Every query of one shape, across every stylesheet the client half owns. */
function queries(pattern: RegExp): { container: string; px: number; sheet: string }[] {
  const out: { container: string; px: number; sheet: string }[] = []
  for (const sheet of clientSheets()) {
    for (const match of sheet.css.matchAll(new RegExp(pattern.source, 'g'))) {
      out.push({ container: match[1] as string, px: Number(match[2]), sheet: sheet.rel })
    }
  }
  return out
}

describe('the breakpoint table is the sheets’ definition of record', () => {
  const declared = new Set(allBands().map(band => `${band.container}@${band.narrowMax}`))

  it('every `max-width` container query has a row in the table', () => {
    const orphans = queries(MAX_QUERY)
      .filter(query => !declared.has(`${query.container}@${query.px}`))
      .map(query => `${query.sheet}: @container ${query.container} (max-width: ${query.px}px)`)
    expect(
      orphans,
      'a container query the table does not know about — add it to BANDS, or the JS side has no way to agree with it',
    ).toEqual([])
  })

  it('every row in the table is used by a query (a stale row is a description of a layout that is gone)', () => {
    // EITHER side counts. A boundary is often written only one way round: the
    // list panel's widest step is expressed as `min-width: 1081px` (the layout
    // it switches TO) with no `max-width: 1080px` rule at all, because the
    // narrow shape is the base. Requiring the `max-width` form would have made
    // that row look stale and pushed someone to delete a boundary the JS side
    // is measuring.
    const used = new Set([
      ...queries(MAX_QUERY).map(query => `${query.container}@${query.px}`),
      ...queries(MIN_QUERY).map(query => `${query.container}@${query.px - 1}`),
    ])
    const stale = [...declared].filter(key => !used.has(key))
    expect(stale, 'a BANDS row no stylesheet asks about any more').toEqual([])
  })

  it('the wide side is always exactly narrow + 1 — the seam has one place to be forgotten', () => {
    const wrong = queries(MIN_QUERY)
      .filter(query => !declared.has(`${query.container}@${query.px - 1}`))
      .map(query => `${query.sheet}: @container ${query.container} (min-width: ${query.px}px) does not pair with a row at ${query.px - 1}px`)
    expect(wrong).toEqual([])
  })

  it('the containers the table names are the ones the panels actually declare', () => {
    const css = clientSheets().map(sheet => sheet.css).join('\n')
    for (const band of allBands()) {
      expect(css, `no sheet declares container-name: ${band.container}, so every query against it is inert`)
        .toContain(`container-name: ${band.container}`)
    }
  })

  it('the JS side reads the table rather than spelling the number', () => {
    // A panel that writes the number itself is the drift this table exists to
    // stop, and it would compile: the two sides would simply disagree.
    const offenders: string[] = []
    for (const [file, source] of panelSources()) {
      for (const match of source.matchAll(/useSurfaceNarrow\(\s*'[^']*'\s*,\s*([^)]+)\)/g)) {
        const arg = (match[1] as string).trim()
        if (!arg.startsWith('bandNarrowMax(')) offenders.push(`${file}: useSurfaceNarrow(…, ${arg})`)
      }
    }
    expect(offenders, 'a panel measures with a literal width instead of a table row').toEqual([])
  })

  it('every group in the table is reachable by name', () => {
    // `bandNarrowMax` throws on an unknown pair, so a call site naming a group
    // that does not exist fails at the first render rather than silently
    // falling back to a number nobody chose.
    expect(Object.keys(BANDS).length).toBeGreaterThan(0)
    for (const [group, bands] of Object.entries(BANDS)) {
      expect((bands as readonly unknown[]).length, `${group} is empty`).toBeGreaterThan(0)
    }
  })
})

/** The three panels that measure a box, and their sources. */
function panelSources(): readonly (readonly [string, string])[] {
  return [
    'src/client/board/TaskBoard.tsx',
    'src/client/board/session-panel.tsx',
    'src/client/item/panel.tsx',
  ].map(rel => [rel, readFileSync(join(repoRoot, rel), 'utf8')] as const)
}
