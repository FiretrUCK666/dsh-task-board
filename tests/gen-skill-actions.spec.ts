/**
 * THE GENERATED ACTION REFERENCE, AND THE PARSER BEHIND IT.
 *
 * ── THE DEFECT THIS FILE EXISTS BECAUSE OF ─────────────────────────────────
 *
 * `session.create`, `task.create` and `task.update` get their six run-config
 * parameters from ONE shared declaration (`...RUN_CONFIG_PARAMS`). The first
 * version of the generator did not understand a spread, so it emitted those three
 * action tables WITHOUT the six — and the output looked completely normal. Every
 * row it did print was correct; the table simply had seven rows instead of
 * thirteen. That is the worst shape a documentation defect can take: a reader
 * cannot tell a short list from a complete one, so nobody would ever report it.
 *
 * So the generator now either expands a spread or THROWS, and these cases pin
 * both halves of that: the expansion is right, and an unknown spread is loud.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { actionsOf, render } from '../scripts/gen-skill-actions.mjs'
import { ACTIONS } from '../src/core/board-actions.ts'
import { RUN_CONFIG_KEYS } from '../src/core/run-presets.ts'

const catalog = readFileSync(join(process.cwd(), 'src', 'core', 'board-actions.ts'), 'utf8')

describe('the catalog parser', () => {
  it('reads every action the catalog declares', () => {
    const parsed = actionsOf(catalog)
    expect(parsed.map(action => action.id).sort()).toEqual(Object.keys(ACTIONS).sort())
  })

  it('expands a shared parameter block instead of dropping it', () => {
    // The three actions that spread `...RUN_CONFIG_PARAMS`. Before the expansion
    // existed, all three tables were silently six rows short.
    const parsed = actionsOf(catalog)
    for (const id of ['task.create', 'task.update', 'session.create'] as const) {
      const action = parsed.find(candidate => candidate.id === id)
      expect(action, `${id} was not parsed at all`).toBeDefined()
      const names = action?.params.map(param => param.name) ?? []
      for (const key of RUN_CONFIG_KEYS) {
        expect(names, `${id} lost the run-config parameter ${key}`).toContain(key)
      }
    }
  })

  it('gives the expanded parameters the sentences from their one declaration', () => {
    // The point of reading `run-presets.ts` rather than re-typing the six: the
    // reference cannot say something different from the catalog about the same
    // field. `workspaceId` is the one whose absent case is a WARNING.
    const create = actionsOf(catalog).find(action => action.id === 'task.create')
    const workspaceId = create?.params.find(param => param.name === 'workspaceId')
    expect(workspaceId?.appliesWhen, 'the shared declaration’s sentence did not reach the reference').toContain('决定文件落在哪')
    expect(workspaceId?.optional).toBe(true)
  })

  it('THROWS on a spread it does not know how to expand', () => {
    // A generator that quietly skipped an unknown spread would emit a table that
    // looks complete and is not — so this is the case that has to be loud. The
    // spread is planted on a COPY of the catalog, never in the real file.
    const planted = catalog.replace(
      /^( {6})\.\.\.RUN_CONFIG_PARAMS,$/m,
      '$1...SOME_FUTURE_PARAM_GROUP,',
    )
    expect(planted, 'the probe could not plant a spread — the catalog no longer has one to replace').not.toBe(catalog)
    expect(() => actionsOf(planted)).toThrow(/SOME_FUTURE_PARAM_GROUP/)
  })

  it('renders a row for every parameter it parsed, so the table is not short', () => {
    const parsed = actionsOf(catalog)
    const rendered = render(parsed)
    const create = parsed.find(action => action.id === 'task.create')
    for (const param of create?.params ?? []) {
      expect(rendered, `the rendered reference has no row for ${param.name}`).toContain(`\`${param.name}\``)
    }
  })
})

describe('the reference on disk', () => {
  it('is byte-identical to what the generator renders', () => {
    // This is what `pnpm verify` runs through `--check`. Asserting it here too
    // means a stale reference fails the test suite, not only the gate.
    const onDisk = readFileSync(join(process.cwd(), 'skills', 'taskboard', 'references', 'actions.md'), 'utf8')
    expect(onDisk, 'the committed reference is stale — run node scripts/gen-skill-actions.mjs').toBe(render(actionsOf(catalog)))
  })

  it('carries the banner that says it must not be edited by hand', () => {
    // A generated file without that line invites a hand edit, and a hand edit is
    // overwritten by the next run with no trace of what was lost.
    const onDisk = readFileSync(join(process.cwd(), 'skills', 'taskboard', 'references', 'actions.md'), 'utf8')
    expect(onDisk).toContain('由 scripts/gen-skill-actions.mjs')
    expect(onDisk).toContain('不要手改')
  })
})
