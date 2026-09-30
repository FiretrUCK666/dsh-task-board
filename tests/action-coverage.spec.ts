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

const VERB_LIST = `'create', 'update', 'move', 'delete', 'run', 'speak', 'bind', 'automate', 'cruise', 'ack', 'navigate', 'restore', 'query',`

/** A two-action catalog: enough structure to be parsed, small enough to poison.
 *  `params` replaces the whole params block, so a test can declare exactly the
 *  parameter shapes it is about. */
function catalog(overrides: Record<string, unknown> = {}) {
  const verb = overrides?.verb ?? 'create'
  const surface = overrides?.surface ?? 'ui+ai'
  const semantic = overrides?.semantic === undefined ? '' : `\n    semantic: true,`
  const semanticOf = overrides?.semanticOf === undefined ? '' : `\n    semanticOf: '${overrides.semanticOf}',`
  const optional = overrides?.optional === true ? `, optional: true` : ''
  const requiredWhen = overrides?.requiredWhen === undefined ? '' : `, requiredWhen: '${overrides.requiredWhen}'`
  const createParams = (overrides?.params as string | undefined)
    ?? `\n      prompt: { about: '执行 Prompt'${optional}${requiredWhen} },`
  const moveParams = (overrides?.moveParams as string | undefined)
    ?? `\n      of: { about: '要移的卡' },`
  const lane = overrides?.lane ?? 'document'
  // Both synthetic actions ride a carrier, so the baseline's two sides agree.
  const relayCreate = `\n    relay: '${(overrides?.relay as string | undefined) ?? 'alpha.run'}',`
  const relayMove = `\n    relay: '${(overrides?.moveRelay as string | undefined) ?? 'alpha.move'}',`
  // The declared carrier vocabulary. It is written HERE in the fixture only
  // because a test has no other source for it; the gate itself reads this out of
  // the real catalog and never from a list of its own.
  const declared = (overrides?.declaredRelays as string[] | undefined) ?? ['alpha.run', 'alpha.move']
  // The checklist write lane's table. The gate REFUSES to run when it cannot
  // read this block, so a fixture without it would not be testing the lane — it
  // would be testing the refusal. `handlers` is the knob the probes turn.
  const handlers = (overrides?.handlers as string[] | undefined) ?? ['itemTransitions.captureItemRecord']
  return `
export interface ActionShape {
  readonly relay?: ${declared.map(d => `'${d}'`).join(' | ')}
}
export const ACTIONS = {
  'task.create': {
    verb: '${verb}',
    domain: 'board',
    lane: '${lane}',
    danger: 'reversible',
    surface: '${surface}',
    summary: '建一张新卡。',
    params: {${createParams}
    },${semantic}${semanticOf}${relayCreate}
  },
  'task.move': {
    verb: 'move',
    domain: 'board',
    lane: '${lane}',
    danger: 'guarded',
    surface: 'ui+ai',
    summary: '移栏。',
    params: {${moveParams}
    },${relayMove}
  },
} as const satisfies Record<string, ActionShape>

export const ITEM_HANDLERS = {
${handlers.map(h => `  '${h.split('.').pop()}': ${h},`).join('\n')}
} as const satisfies Readonly<Record<string, unknown>>

export const BOARD_VERBS: readonly BoardVerb[] = [${VERB_LIST}]
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
  // The model-facing execution paths. The synthetic catalog offers two actions
  // to the model, so a green baseline has a `case` for each of them — and the
  // engine branch needs a per-action gate, or the relay check fires.
  agentToolsText: tools("    if (id !== 'task.run') { return 'refused' }\n    return relay()"),
  pendingExecution: {},
  // The engine's carriers. The synthetic catalog declares two and both actions
  // ride one, so the two sides agree until a test makes them disagree.
  boardDocText: `export type BoardCommand =
  | { type: 'alpha.run'; taskId: string; clientId: string }
  | { type: 'alpha.move'; taskId: string; clientId: string }
`,
  coreExportNames: ['moveTaskToStatus', 'resolveCardDrop'],
  agentsText: '新增动作必须进 src/core/board-actions.ts。',
  presentFiles: ['src/core/board-actions.ts'],
  // The checklist's own write layer: the functions a panel may call to change a
  // document. The gate asks the CATALOG's `ITEM_HANDLERS` whether each one it
  // sees called is bound to an action, so both halves have to be present for the
  // lane to mean anything.
  itemWriteNames: ['captureItemRecord', 'unboundWrite'],
  scanFiles: [
    { path: 'src/client/board/Board.tsx', text: 'controller.createTask("a")\ncontroller.moveTask("a", "todo")\ncontroller.getSnapshot()\n' },
    { path: 'src/client/index.ts', text: 'sync.start()\n' },
    { path: 'src/client/item/panel.tsx', text: 'const made = captureItemRecord(input, now, mint)\n' },
  ],
}

/** An agent-tool source. `engineBranch` is the slice between the engine-lane
 *  condition and the document-lane one, and `documentBody` is what the
 *  document lane does — the two `case` lines the execution gate needs. */
function tools(engineBranch: string, documentBody = "switch (id) {\n      case 'task.create':\n      case 'task.move':\n        return 1\n      default:\n        return 0\n    }") {
  return `function applyOne(id: string) {\n  if (spec.lane === 'engine') {\n${engineBranch}\n  } else if (spec.lane === 'document') {\n    ${documentBody}\n  }\n}\n`
}

/**
 * The gate's input, plus the one field its inferred type does not carry.
 *
 * `actionCoverageFindings` reads `input.itemWriteNames` (the checklist write
 * layer's own function names) and `readRepo` supplies it, but the type TS infers
 * for the untyped `.mjs` does not include it, so an object literal carrying it is
 * rejected as an excess property. Declaring the field here rather than casting the
 * object away: the gate really does accept it, and if the script's type surface
 * ever catches up this intersection still compiles.
 */
type Input = Partial<CoverageInput> & { readonly itemWriteNames?: readonly string[] }

const input = (overrides: Input = {}) => ({ catalogText: catalog(), ...BASE, ...overrides })
const run = (overrides: Input = {}) => actionCoverageFindings(input(overrides))
const findings = (overrides: Input = {}) => run(overrides).join('\n')

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

  it('catches a bare verdict marker with no decision after it', () => {
    // A marker alone is the worst case: it asserts a verdict and documents
    // nothing, so the next reader inherits "we decided" with no decision.
    expect(findings({ internal: { getSnapshot: 'DEBT: ' } }))
      .toContain('is marked "DEBT" with no reason after the marker')
    expect(findings({ internal: { getSnapshot: 'NOT-FOR-THE-MODEL: ' } }))
      .toContain('is marked "NOT-FOR-THE-MODEL" with no reason after the marker')
  })

  it('catches a verdict written mid-reason instead of as a prefix', () => {
    // The counts read the PREFIX, so a verdict buried in prose silently counts
    // as a plain non-action and the decision disappears from the report.
    expect(findings({ internal: { getSnapshot: 'a read projection, and NOT-FOR-THE-MODEL on top' } }))
      .toContain('does not START with the marker')
  })

  it('accepts either marker once it carries its decision', () => {
    expect(run({ internal: { getSnapshot: 'DEBT: the catalog does not carry this one yet' } })).toEqual([])
    expect(run({ internal: { getSnapshot: 'NOT-FOR-THE-MODEL: a product decision, not an omission' } })).toEqual([])
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

describe('1b — the OTHER direction: the model was told, and it cannot do it', () => {
  it('catches a model-reachable action with no execution path', () => {
    // The case the first gate cannot see. The catalog promises it, the model
    // learns from the catalog, and it will try — so the missing `case` is a
    // defect whether or not anyone wrote it down.
    const out = findings({ agentToolsText: "case 'task.create':\n" })
    expect(out).toContain("task.move: the catalog tells the model it can do this")
    expect(out).toContain("no `case 'task.move':` exists in the agent tool")
    expect(out).toContain('is not recorded as a debt')
  })

  it('still reports it when the debt IS written down — logging is not a waiver', () => {
    // The whole point of the ledger: it names and counts the debt, it does not
    // stop the debt from being a finding. A gate that went green here would be
    // the allow-list this whole mechanism exists to avoid.
    const out = findings({
      agentToolsText: "case 'task.create':\n",
      pendingExecution: { 'task.move': 'NO-EXECUTION: host has not wired it yet' },
    })
    expect(out).toContain("task.move: the catalog tells the model it can do this")
    expect(out).toContain('logged debt: host has not wired it yet')
  })

  it('catches a paid debt entry and demands it be deleted', () => {
    // A table nobody prunes IS an allow-list. The moment the code lands, the
    // line has to go — that is what makes the ledger shrink instead of accrete.
    expect(findings({ pendingExecution: { 'task.create': 'NO-EXECUTION: stale' } }))
      .toContain('PENDING_EXECUTION["task.create"] is paid')
  })

  it('catches a debt entry for an action the model cannot reach', () => {
    expect(findings({ pendingExecution: { 'task.typo': 'NO-EXECUTION: never earnable' } }))
      .toContain('names an action the catalog does not offer the model')
  })

  it('catches a debt entry with no reason after the marker', () => {
    expect(findings({ pendingExecution: { 'task.move': 'NO-EXECUTION: ' } }))
      .toContain('carries no reason after the marker')
  })

  it('catches a debt entry wearing the wrong marker', () => {
    // This debt is "in the catalog, no code"; the catalog debt is the opposite
    // end of the pipeline. Sharing a marker would merge the two counts.
    expect(findings({ pendingExecution: { 'task.move': 'DEBT: the wrong marker' } }))
      .toContain('does not start with "NO-EXECUTION: "')
  })

  it('does not demand an execution path for a ui-only action', () => {
    // An action the model is never offered cannot be a broken promise to it.
    expect(run({
      catalogText: catalog({ surface: 'ui' }),
      agentToolsText: tools("    if (id !== 'task.run') { return 'refused' }\n    return relay()", "switch (id) {\n      case 'task.move':\n        return 1\n      default:\n        return 0\n    }"),
    })).toEqual([])
  })

  it('reports an unreadable tool source instead of passing on it', () => {
    expect(findings({ agentToolsText: '' }))
      .toContain('cannot read the agent tool source')
  })

  it('accepts a real execution path for every offered action', () => {
    // The other half: once the `case` exists, nothing here fires.
    expect(run()).toEqual([])
  })
})

describe('1c — the relay must not forward a non-run as a run', () => {
  it('catches an engine branch with no per-action gate at all', () => {
    // The shape that actually shipped: generalised on `lane`, so creating a
    // session, renaming one and speaking into one were all forwarded as "run
    // this card". No `case` was missing, so the execution gate stayed green.
    const out = findings({
      catalogText: catalog({ lane: 'engine' }),
      agentToolsText: tools('    return relay()'),
    })
    expect(out).toContain('the relay decision has NO per-action test')
    expect(out).toContain("task.create: its lane is 'engine'")
  })

  it('catches an engine action recognised by name, even when the guard is fail-closed', () => {
    // `id !== 'task.create'` refuses everything it does not name, so it cannot
    // cause the incident today. It is still the shape that regrows it: add an
    // engine action, forget the line, and it is forwarded again. The fix is to
    // decide from the catalog's carrier, and the gate says so while the
    // name-keyed guard is still in the file.
    const out = findings({
      catalogText: catalog({ lane: 'engine' }),
      agentToolsText: tools("    if (id !== 'task.create') { return 'refused' }\n    return relay()"),
    })
    expect(out).toContain('recognises this engine action BY NAME')
    expect(out).toContain("Decide from the catalog's `relay` field instead")
  })

  it('accepts a guard that names the actions the relay carries', () => {
    // One of the two safe shapes. It is accepted rather than preferred, because
    // a gate that red on a correct implementation is a gate that gets switched
    // off.
    expect(run({
      catalogText: catalog({ lane: 'engine' }),
      agentToolsText: tools("    if (id !== 'task.create') { return 'refused' }\n    return relay()"),
      // The name check is about the RELAY decision, so this case is covered by
      // the case above; here the point is that the shape is not rejected.
    }).filter(f => f.includes('NO per-action test'))).toEqual([])
  })

  it('accepts the other safe shape: read the carrier and refuse when it is absent', () => {
    // The shape the host actually moved to — no `lane` branch at all, one
    // shared body, and the decision made from the catalog field.
    const shared = `function applyOne(doc, id, payload) {
  switch (id) {
    case 'task.create':
      return { relay: true, carrier: spec.relay }
    case 'task.move':
      return { doc }
  }
}
function execute(doc, items, id, payload) {
  const next = applyOne(doc, id, payload)
  if (typeof next === 'string') return { ok: false }
  if (next.relay === true) {
    const relay = spec.relay
    if (relay === undefined) return { ok: false, detail: 'no carrier' }
    return { ok: true }
  }
  return { ok: true }
}
`
    expect(run({ catalogText: catalog({ lane: 'engine' }), agentToolsText: shared })).toEqual([])
  })

  it('follows the lane, not a list of names: a document-lane action is out of scope', () => {
    // The negative test that matters. Nothing names `task.create` anywhere, so
    // if the verdict came from a name list rather than from `lane`, moving the
    // action to the document lane would change nothing — and it changes
    // everything: the action leaves the engine set the check walks.
    expect(run({
      catalogText: catalog({ lane: 'document' }),
      agentToolsText: tools('    return relay()'),
    })).toEqual([])
  })

  it('reports a relay decision it cannot find instead of passing', () => {
    expect(findings({ agentToolsText: 'function applyOne() { return 0 }' }))
      .toContain('cannot find where src/host/agent/tools.ts decides that an action is a relay')
  })
})

describe('3 — parameter declarations, fields only', () => {
  it('catches a boolean spelled as two strings', () => {
    // The regression fingerprint: `oneOf: ['true','false']` reaches the host as
    // a string, and the model reads an enum where there is a boolean.
    const out = findings({
      catalogText: catalog({ params: "\n      flag: { about: '开关', optional: true, oneOf: ['true', 'false'] }," }),
    })
    expect(out).toContain('oneOf lists \'true\'')
    expect(out).toContain('Use `boolean: true`')
  })

  it('accepts the same parameter declared as a boolean', () => {
    expect(run({
      catalogText: catalog({ params: "\n      flag: { about: '开关', optional: true, boolean: true }," }),
    })).toEqual([])
  })

  it('catches two conditional parameters with nothing that chooses between them', () => {
    // The `session.hide` shape: "required when it is a session row" and
    // "required when it is a round row", with no way to say which is true.
    const out = findings({
      catalogText: catalog({
        params: "\n      session: { about: '会话', requiredWhen: '动的是会话行' },\n      round: { about: '轮次', requiredWhen: '动的是轮次行' },\n      title: { about: '标题', optional: true },",
      }),
    })
    expect(out).toContain('are all conditionally required and no declared parameter discriminates')
    // Once per ACTION, not once per parameter — the same unsatisfiable set
    // repeated per param is noise that trains people to ignore the output.
    expect(out.split('no declared parameter discriminates').length - 1).toBe(1)
  })

  it('accepts two conditional parameters that a declared parameter discriminates', () => {
    expect(run({
      catalogText: catalog({
        params: "\n      kind: { about: '动哪一行', oneOf: ['session', 'round'] },\n      session: { about: '会话', requiredWhen: 'kind 是 session' },\n      round: { about: '轮次', requiredWhen: 'kind 是 round' },",
      }),
    })).toEqual([])
  })

  it('catches a condition naming an optional parameter whose absent case is unwritten', () => {
    // The mode/cron case: omitting `mode` still means cron, and the literal
    // reading of the enum does not say that.
    const out = findings({
      catalogText: catalog({
        params: "\n      mode: { about: '模式', optional: true, oneOf: ['cron', 'chain'] },\n      cron: { about: '五段 cron', requiredWhen: 'mode 是 cron' },",
      }),
    })
    expect(out).toContain('but mode is optional and has no `default`')
  })

  it('accepts the same pair once the absent case is declared', () => {
    expect(run({
      catalogText: catalog({
        params: "\n      mode: { about: '模式', optional: true, oneOf: ['cron', 'chain'], default: '不传 = cron' },\n      cron: { about: '五段 cron', requiredWhen: 'mode 是 cron' },",
      }),
    })).toEqual([])
  })

  it('applies the same rule to appliesWhen, not just requiredWhen', () => {
    // `appliesWhen` is the same load-bearing fact in different words: this
    // parameter only means anything under a condition, so its absent case is
    // just as much a question the fields have to answer.
    const out = findings({
      catalogText: catalog({
        params: "\n      scope: { about: '标到哪一层', optional: true, oneOf: ['task', 'all'] },\n      who: { about: '对谁', appliesWhen: 'scope 不是 all' },",
      }),
    })
    expect(out).toContain('appliesWhen "scope 不是 all"')
    expect(out).toContain('but scope is optional and has no `default`')
  })

  it('accepts an appliesWhen whose named optional parameter states its absent case', () => {
    expect(run({
      catalogText: catalog({
        params: "\n      scope: { about: '标到哪一层', optional: true, oneOf: ['task', 'all'], default: '不传 = task' },\n      who: { about: '对谁', appliesWhen: 'scope 不是 all' },",
      }),
    })).toEqual([])
  })
})

describe('3e — carriers, both directions', () => {
  it('is quiet when the catalog and the engine agree', () => {
    // The green case IS the invariant: every declared carrier is carried, and
    // every carried variant is named and ridden. Asserted as a property, never
    // as a count of either side.
    expect(run()).toEqual([])
  })

  it('catches an action asking for a carrier the catalog does not declare', () => {
    const out = findings({ catalogText: catalog({ relay: 'nonexistent' }) })
    expect(out).toContain('relay "nonexistent" is not one the catalog declares')
  })

  it('catches a carrier the engine can carry but the catalog does not name', () => {
    const out = findings({
      boardDocText: "export type BoardCommand =\n  | { type: 'alpha.run'; taskId: string }\n  | { type: 'alpha.move'; taskId: string }\n  | { type: 'task.archive'; taskId: string }\n",
    })
    expect(out).toContain("the engine can carry `type: 'task.archive'` but the catalog does not name it")
  })

  it('catches a declared carrier the engine cannot carry at all', () => {
    // The dead half: a name the catalog promises and no variant can carry, so
    // anything riding it is a request with nowhere to go.
    const out = findings({ catalogText: catalog({ declaredRelays: ['alpha.run', 'alpha.move', 'task.detach'] }) })
    expect(out).toContain("the catalog declares the carrier \"task.detach\" but the BoardCommand union has no")
  })

  it('catches a carrier nobody rides', () => {
    // A carrier on both sides that no action selects is a request nobody can
    // make — and it reads, from the outside, like a feature that works.
    const out = findings({ catalogText: catalog({ moveRelay: 'alpha.run' }) })
    expect(out).toContain('but NO action declares')
    expect(out).toContain('a carrier nobody rides is a request nobody can make')
  })

  it('reports a command union it cannot read instead of passing', () => {
    expect(findings({ boardDocText: 'export const nothing = 1\n' }))
      .toContain('cannot read the carrier variants')
  })

  it('reports a catalog with no relay vocabulary instead of passing vacuously', () => {
    // If the field is deleted on purpose this check must be deleted with it —
    // a check that quietly stops checking is worse than no check.
    const stripped = catalog().replace(/export interface ActionShape \{[\s\S]*?\}\n/, '')
    expect(findings({ catalogText: stripped })).toContain('cannot read the declared carrier names')
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
  it('catches a verb outside the declared set', () => {
    expect(findings({ catalogText: catalog({ verb: 'archive' }) })).toContain('is not one of the declared verbs')
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
    expect(findings({ catalogText: drifted })).toContain('outside the declared verbs')
  })
})

describe('the checklist write lane: a panel write the catalog says nothing about', () => {
  // THE LANE, AND WHY IT NEEDS ITS OWN PROBES. The method scan is structurally
  // blind to this panel: it writes through bare core functions (`applyItemPatch`
  // / `captureItemRecord` / …) because the model has to call the very same ones,
  // and a bare call has no receiver for the method scan to classify. So the
  // check runs the other way: a write-layer call the PANEL makes is legal exactly
  // when the catalog binds that function in `ITEM_HANDLERS` or declares it in
  // `INTERNAL` with a reason. Before the lane existed, adding such a button left
  // the gate green — the failure mode where the gate says nothing about a whole
  // panel, rather than saying something wrong about it.

  it('passes the synthetic baseline, where the call IS bound', () => {
    // The reverse half first, because it is the half that is easy to forget: a
    // check that fires on a true declaration teaches the next reader that the
    // fix for a finding is to delete the rule.
    expect(actionCoverageFindings(input())).toEqual([])
  })

  it('catches a write the catalog binds no action to', () => {
    // The same probe run by hand on the real file, done here in the INPUT so no
    // product file is ever modified to prove a gate works. ONE binding is
    // dropped from the table — the table stays readable, which matters, because
    // an EMPTY table is a different case (the gate refuses to run on it, which
    // the case below covers) and would prove nothing about the lane.
    const out = findings({
      catalogText: catalog({ handlers: ['itemTransitions.captureItemRecord'] }),
      scanFiles: [...BASE.scanFiles, { path: 'src/client/item/panel.tsx', text: 'applyItemPatch(rows, id, patch, now)\n' }],
      itemWriteNames: ['captureItemRecord', 'applyItemPatch'],
    })
    expect(out, 'the lane is silent on a checklist write nobody told the model about').toContain('applyItemPatch()')
    expect(out).toContain('neither a value in ITEM_HANDLERS nor an INTERNAL entry with a reason')
    expect(out, 'the finding must point at the file so the reader knows where to look').toContain('src/client/item/panel.tsx:1')
  })

  it('and is quiet again once that write is bound', () => {
    // The pair to the case above. Without it, "the gate fires" proves only that
    // the gate fires.
    expect(run({
      catalogText: catalog({ handlers: ['itemTransitions.captureItemRecord', 'itemTransitions.applyItemPatch'] }),
      scanFiles: [...BASE.scanFiles, { path: 'src/client/item/panel.tsx', text: 'applyItemPatch(rows, id, patch, now)\n' }],
      itemWriteNames: ['captureItemRecord', 'applyItemPatch'],
    })).toEqual([])
  })

  it('accepts a write the panel makes with no action behind it, once it says why', () => {
    // The `INTERNAL` half of "either one". This is the shape the real repo is in
    // for `restoreItemRecord` and `isBlankCapture`: the panel really calls them,
    // and there really is no catalog action, because they are not actions.
    const files = [...BASE.scanFiles, { path: 'src/client/item/panel.tsx', text: 'const empty = isBlankCapture(input)\n' }]
    expect(findings({ scanFiles: files, itemWriteNames: ['captureItemRecord', 'isBlankCapture'] }))
      .toContain('isBlankCapture()')
    expect(run({
      scanFiles: files,
      itemWriteNames: ['captureItemRecord', 'isBlankCapture'],
      internal: { getSnapshot: '读投影', isBlankCapture: '判一条快记是不是空——判空不是动作，它不写任何东西' },
    })).toEqual([])
  })

  it('still refuses to declare one whose reason is empty', () => {
    // An unexplained exclusion and a forgotten one look identical from here, so
    // the ledger's rule has to reach this lane too.
    const files = [...BASE.scanFiles, { path: 'src/client/item/panel.tsx', text: 'const empty = isBlankCapture(input)\n' }]
    expect(findings({
      scanFiles: files,
      itemWriteNames: ['captureItemRecord', 'isBlankCapture'],
      internal: { getSnapshot: '读投影', isBlankCapture: '   ' },
    })).toContain('has an empty reason')
  })

  it('does not read a method call as a bare core call', () => {
    // The negative lookbehind is load-bearing: the panel holds documents and
    // other objects, so a call that merely SHARES a name is not a write, and a
    // gate that cannot tell the two reports every one of them.
    const files = [...BASE.scanFiles, { path: 'src/client/item/panel.tsx', text: 'view.captureItemRecord(x)\nsomething.applyItemPatch(a, b, c, d)\n' }]
    expect(run({ scanFiles: files, itemWriteNames: ['captureItemRecord', 'applyItemPatch'] })).toEqual([])
  })

  it('reports the lane as unreadable rather than passing it on nothing', () => {
    // The refusal that keeps this lane honest: a catalog it cannot read the
    // table out of — or one whose table binds NOTHING — would otherwise leave the
    // whole checklist unwatched, silently. An empty table is the more dangerous
    // of the two, because it looks like a real declaration.
    const stripped = catalog().replace(/export const ITEM_HANDLERS[\s\S]*?\n} as const[^\n]*\n/, '')
    expect(findings({ catalogText: stripped })).toContain('cannot read ITEM_HANDLERS')
    expect(findings({ catalogText: catalog({ handlers: [] }) }))
      .toContain('would have passed on empty input')
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
