/**
 * Coverage-gate tests (scripts/verify-action-coverage.mjs).
 *
 * The gate exists to catch the direction a type cannot see: someone adds a
 * button, the build stays green, and the model was never told. That makes it
 * the most dangerous kind of check to get wrong in the other direction — one
 * that never fires, or one that fires on everything.
 *
 * So every check is run twice: once green, and once against a DELIBERATELY
 * BROKEN copy, asserting the finding appears. The reverse is tested too, and it
 * is the half that is easy to forget: a check that fires on a true declaration
 * teaches the next reader that the fix for a finding is to delete the rule.
 *
 * The last case is the only one that reads the real repository, and it is the
 * one that matters day to day: the whole gate against the actual catalog,
 * controller and UI, expected clean.
 */
import { describe, expect, it } from 'vitest'
import { actionCoverageFindings, readRepo } from '../scripts/verify-action-coverage.mjs'
import type { CoverageInput } from '../scripts/verify-action-coverage.mjs'

const TWELVE = `'create', 'update', 'move', 'delete', 'run', 'speak', 'bind', 'automate', 'cruise', 'ack', 'navigate', 'query',`

/** A two-action catalog: enough structure to be parsed, small enough to poison. */
function catalog(overrides: Record<string, unknown> = {}) {
  const verb = overrides?.verb ?? 'create'
  const surface = overrides?.surface ?? 'ui+ai'
  const semantic = overrides?.semantic === undefined ? '' : `\n    semantic: true,`
  const semanticOf = overrides?.semanticOf === undefined ? '' : `\n    semanticOf: '${overrides.semanticOf}',`
  const optional = overrides?.optional === true ? `, optional: true` : ''
  const requiredWhen = overrides?.requiredWhen === undefined ? '' : `, requiredWhen: '${overrides.requiredWhen}'`
  return `
export const ACTIONS = {
  'task.create': {
    verb: '${verb}',
    domain: 'board',
    lane: 'document',
    danger: 'reversible',
    surface: '${surface}',
    summary: '建一张新卡。',
    params: {
      prompt: { about: '执行 Prompt'${optional}${requiredWhen} },
    },${semantic}${semanticOf}
  },
  'task.move': {
    verb: 'move',
    domain: 'board',
    lane: 'document',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '移栏。',
    params: {
      of: { about: '要移的卡' },
    },
  },
} as const satisfies Record<string, ActionShape>

export const BOARD_VERBS: readonly BoardVerb[] = [${TWELVE}]
`
}

/** A controller with one private member, so the private/public split is tested. */
const CONTROLLER = `
export class BoardController {
  private land(): void {}
  createTask(id: string): void {}
  moveTask(id: string, status: string): void {}
  getSnapshot(): BoardSnapshot { return this.land as never }
  brandNewVerb(): void {}
}
`

const BASE = {
  bindings: { 'task.create': ['createTask'], 'task.move': ['moveTask'] },
  internal: { getSnapshot: '读投影：整份看板快照' },
  foreign: { 'sync.start': 'the host-sync engine' },
  receivers: new Set(['controller', 'this']),
  controllerText: CONTROLLER,
  coreExportNames: ['moveTaskToStatus', 'resolveCardDrop'],
  agentsText: '新增动作必须进 src/core/board-actions.ts。',
  presentFiles: ['src/core/board-actions.ts'],
  scanFiles: [
    { path: 'src/client/board/Board.tsx', text: 'controller.createTask("a")\ncontroller.moveTask("a", "todo")\ncontroller.getSnapshot()\n' },
    { path: 'src/client/index.ts', text: 'sync.start()\n' },
  ],
}

const input = (overrides: Partial<CoverageInput> = {}): CoverageInput => ({ catalogText: catalog(), ...BASE, ...overrides })
const run = (overrides: Partial<CoverageInput> = {}) => actionCoverageFindings(input(overrides))
const findings = (overrides: Partial<CoverageInput> = {}) => run(overrides).join('\n')

describe('the gate is green on a consistent pair', () => {
  it('passes the synthetic baseline', () => {
    expect(actionCoverageFindings(input())).toEqual([])
  })

  it('passes the real repository', () => {
    // The whole gate against the actual catalog, controller and UI. If this
    // fails, either the gate is wrong or the product really drifted.
    expect(actionCoverageFindings(readRepo('.'))).toEqual([])
  })
})

describe('1 — coverage, both directions', () => {
  it('catches a UI call that is neither an action nor an INTERNAL entry', () => {
    // THE case the gate exists for: a new button, no catalog entry, no reason.
    const out = findings({
      scanFiles: [...BASE.scanFiles, { path: 'src/client/board/Card.tsx', text: 'controller.brandNewVerb()\n' }],
    })
    expect(out).toContain('controller.brandNewVerb() is neither an action')
    expect(out).toContain('src/client/board/Card.tsx:1')
  })

  it('catches an INTERNAL entry with an empty reason', () => {
    // An unexplained exclusion and a forgotten one look identical from here.
    expect(findings({ internal: { getSnapshot: '   ' } })).toContain('has an empty reason')
  })

  it('catches a call the UI made through a receiver it does not recognize', () => {
    // The renamed prop: `board.createTask(` would stop being checked silently
    // if unknown receivers were simply ignored.
    const out = findings({
      scanFiles: [{ path: 'src/client/board/Board.tsx', text: 'board.moveTask("a", "todo")\n' }],
    })
    expect(out).toContain('a receiver this gate does not recognize')
  })

  it('accepts a receiver once it is declared', () => {
    expect(run({
      receivers: new Set(['controller', 'this', 'board']),
      scanFiles: [{ path: 'src/client/board/Board.tsx', text: 'board.moveTask("a", "todo")\n' }],
    })).toEqual([])
  })

  it('catches a foreign receiver call that was never declared', () => {
    // The exemption is per CALL, not per receiver, so a real action on a known
    // foreign receiver is still caught.
    const out = findings({
      scanFiles: [...BASE.scanFiles, { path: 'src/client/index.ts', text: 'sync.start()\nsync.moveTask("a", "todo")\n' }],
    })
    expect(out).toContain('sync.moveTask')
  })

  it('catches an action id in the binding table that the catalog does not have', () => {
    expect(findings({ bindings: { ...BASE.bindings, 'task.typo': ['createTask'] } })).toContain('"task.typo"')
  })

  it('catches one method claimed by two actions', () => {
    expect(findings({ bindings: { 'task.create': ['createTask'], 'task.move': ['createTask'] } }))
      .toContain('is claimed by two actions')
  })

  it('catches a binding to a method the controller does not expose', () => {
    expect(findings({ bindings: { 'task.create': ['renamedAway'] } })).toContain('is not a public method of BoardController')
  })

  it('catches a method claimed as both an action and a non-action', () => {
    // The two tables must never contradict: whichever one a reader believes
    // first, the other is a lie.
    expect(findings({ internal: { getSnapshot: '读投影', moveTask: '既是动作又不是动作' } }))
      .toContain('is listed in INTERNAL (as not an action) and bound to the action')
  })

  it('does not see a private member as public surface', () => {
    // `this.land(` is the controller talking to itself; only public methods
    // reach the tool, so only they are coverage questions.
    expect(run({
      scanFiles: [...BASE.scanFiles, { path: 'src/core/controller.ts', text: 'this.land()\nthis.createTask("a")\n' }],
    })).toEqual([])
  })
})

describe('2 — semantic honesty, including the direction that must stay quiet', () => {
  it('catches a semantic action naming a function src/core does not export', () => {
    expect(findings({ catalogText: catalog({ semantic: true, semanticOf: 'notARealFunction' }) }))
      .toContain('which src/core/ does not export')
  })

  it('catches a semantic action that names no function', () => {
    expect(findings({ catalogText: catalog({ semantic: true }) }))
      .toContain('without naming the shared core function')
  })

  it('catches a function named without the semantic mark', () => {
    expect(findings({ catalogText: catalog({ semanticOf: 'moveTaskToStatus' }) }))
      .toContain('without being marked semantic')
  })

  it('stays quiet when the named function really exists', () => {
    // The other half. A check that fires here teaches the reader that the fix
    // for a finding is to delete the finding.
    expect(run({ catalogText: catalog({ semantic: true, semanticOf: 'moveTaskToStatus' }) })).toEqual([])
  })
})

describe('3 — catalog coherence', () => {
  it('catches a verb outside the twelve', () => {
    expect(findings({ catalogText: catalog({ verb: 'archive' }) })).toContain('is not one of the twelve')
  })

  it('catches a surface outside the three states', () => {
    expect(findings({ catalogText: catalog({ surface: 'agent' }) })).toContain('is not one of ui / ui+ai / ai-only')
  })

  it('catches a parameter claiming to be both optional and conditional', () => {
    expect(findings({ catalogText: catalog({ optional: true, requiredWhen: 'always' }) }))
      .toContain('declared both optional and requiredWhen')
  })

  it('catches a verb list that drifted from the contract', () => {
    const drifted = catalog().replace("'query',", "'query', 'archive',")
    expect(findings({ catalogText: drifted })).toContain('outside the twelve')
  })
})

describe('a gate that cannot read its input must not report success', () => {
  it('reports a catalog it could not parse', () => {
    const out = findings({ catalogText: 'export const SOMETHING_ELSE = {}\n' })
    expect(out).toContain('cannot read the action catalog')
    expect(out).toContain('not a skip')
  })

  it('reports a controller whose members it could not read', () => {
    expect(findings({ controllerText: 'export class Something {}\n' }))
      .toContain('cannot read the public method list')
  })

  it('reports an empty scan instead of passing on it', () => {
    // The failure mode that makes a gate worse than no gate: a check that
    // reports success because it ran on nothing.
    expect(findings({ scanFiles: [] })).toContain('coverage would pass on empty input')
  })
})

describe('4 — the rule must not outlive the thing it rules', () => {
  it('catches AGENTS.md still mandating a catalog that is gone', () => {
    expect(findings({ presentFiles: [] })).toContain('a rule that outlived the thing it rules')
  })

  it('is quiet when the rule and the catalog agree', () => {
    expect(run({})).toEqual([])
  })
})
