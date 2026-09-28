/**
 * Action-catalog tests (src/core/board-actions.ts).
 *
 * Two jobs, and the second one is the bigger half:
 *
 *  1. The catalog is TRUE about the product — twelve verbs, the locked controls
 *     stay locked, `surface: 'ui'` never reaches the tool, the danger grades
 *     match what is actually recoverable.
 *  2. The gate over the catalog BITES. Every mechanical check below is run a
 *     second time against a deliberately broken COPY of the table, because a
 *     check that has only ever passed is indistinguishable from a check that
 *     cannot fail. Poison the copy, watch the finding appear, and the gate is
 *     real; that is the whole discipline.
 */
import { describe, expect, it } from 'vitest'
import {
  actionCatalogFindings,
  ACTIONS,
  BOARD_VERBS,
  EXECUTE_ENVELOPE_PARAMS,
  TASK_FIELDS,
  TOOL_ACTION_IDS,
  type ActionId,
  type ActionShape,
} from '../src/core/board-actions.ts'
import { ITEM_FIELDS } from '../src/core/item.ts'

/** One action out of the table, with a patch applied — the poisoner's tool. */
function poison(id: ActionId, patch: Partial<ActionShape>): Record<string, ActionShape> {
  const original = ACTIONS[id] as ActionShape
  return { ...(ACTIONS as unknown as Record<string, ActionShape>), [id]: { ...original, ...patch } }
}

describe('the verb table is a contract', () => {
  it('is exactly the declared set, with no duplicates', () => {
    // The count is asserted against the list itself rather than a retyped
    // number, so adding a verb is one edit instead of two that can disagree.
    expect(BOARD_VERBS).toHaveLength(new Set(BOARD_VERBS).size)
    expect(new Set(BOARD_VERBS).size).toBe(BOARD_VERBS.length)
  })

  it('every action in the catalog uses one of them', () => {
    for (const [id, spec] of Object.entries(ACTIONS)) {
      expect(BOARD_VERBS, `${id} uses a verb outside the contract`).toContain(spec.verb)
    }
  })

  it('covers all four domains — a domain nobody uses is a domain nobody planned', () => {
    expect(new Set(Object.values(ACTIONS).map(spec => spec.domain)))
      .toEqual(new Set(['board', 'item', 'preset', 'session']))
  })
})

describe('rule 1 — what the UI locks down, the tool locks down', () => {
  it('rule.create names a target session; rule.update has no way to change it', () => {
    // The UI's target-session dropdown is locked, so the edit path must not
    // accept a new one. A model that could retarget a rule could do something
    // no person can, and the interface's promise would be the thing that breaks.
    expect(Object.keys(ACTIONS['rule.create'].params)).toContain('session')
    expect(Object.keys(ACTIONS['rule.update'].params)).not.toContain('session')
  })

  it('says so out loud, so the model never spends a turn finding out', () => {
    expect(ACTIONS['rule.update'].summary).toContain('目标会话不可改')
  })

  it('a card may only be moved to a column a person may drag it to', () => {
    // MANUAL_STATUSES is the board's own list; 进行中 and 待审核 belong to the
    // runner, so a model must not be able to declare them.
    expect(ACTIONS['task.move'].params.status!.oneOf).toEqual(['backlog', 'todo', 'done'])
    expect(ACTIONS['task.create'].params.status!.oneOf).toEqual(['backlog', 'todo', 'done'])
  })
})

describe('rule 2 — surface ui never reaches the tool', () => {
  it('excludes exactly the ui-only actions, decided in one place', () => {
    // Pinned exactly, on purpose: this is the list of things a person can do
    // that a model cannot, so a new entry here is a decision someone made, not
    // a consequence of adding an action elsewhere. `item.navigate` is on it for
    // the same reason as `board.navigate` — "open this" means nothing in
    // another context, and a model that could retarget a person's screen would
    // be a bug with a good changelog entry.
    const uiOnly = (Object.keys(ACTIONS) as ActionId[]).filter(id => ACTIONS[id].surface === 'ui')
    expect(uiOnly.sort()).toEqual([
      'board.navigate', 'item.navigate', 'session.hide', 'session.navigate', 'task.ack', 'task.navigate',
    ])
    for (const id of uiOnly) expect(TOOL_ACTION_IDS).not.toContain(id)
  })

  it('offers every other action, and offers nothing that is not an action', () => {
    expect([...TOOL_ACTION_IDS].sort()).toEqual(
      (Object.keys(ACTIONS) as ActionId[]).filter(id => ACTIONS[id].surface !== 'ui').sort(),
    )
    expect(new Set(TOOL_ACTION_IDS).size).toBe(TOOL_ACTION_IDS.length)
  })

  it('keeps the read clock human: the model cannot mark a card read', () => {
    // Marking read is what clears 待你决断. A model doing it would delete the
    // user's own gate, so 已读钟 is a person's action and stays off the tool.
    expect(ACTIONS['task.ack'].surface).toBe('ui')
    expect(ACTIONS['task.ack'].summary).toContain('属于人')
  })
})

describe('rule 3 — every parameter states its condition', () => {
  it('states the same-column condition where ordering applies', () => {
    for (const id of ['task.create', 'task.move', 'session.reorder'] as const) {
      expect(ACTIONS[id].params.beforeId?.appliesWhen, `${id}.beforeId`).toContain('排序')
    }
  })

  it('states the trigger condition on every cron parameter', () => {
    for (const id of ['task.schedule', 'rule.create', 'rule.update'] as const) {
      expect(ACTIONS[id].params.cron?.requiredWhen, `${id}.cron`).toContain('cron')
    }
  })

  it('states that instruction is only needed when the prompt is not being reused', () => {
    for (const id of ['rule.create', 'rule.update'] as const) {
      expect(ACTIONS[id].params.instruction?.requiredWhen).toContain('usePrompt')
    }
  })

  it('keeps dry_run optional on the envelope, not on every action', () => {
    // It describes the CALL, not the action: rehearsing one op at a time would
    // be a second undo stack, and the merge grammar has no room for one.
    expect(EXECUTE_ENVELOPE_PARAMS.dry_run?.optional).toBe(true)
    const inActions = Object.values(ACTIONS).filter(spec => 'dry_run' in spec.params)
    expect(inActions).toEqual([])
  })
})

describe('the danger grades match what is actually recoverable', () => {
  it('a card deletion is irreversible; a checklist deletion is not', () => {
    // The asymmetry is a product fact (PRD): the checklist deletes through a
    // tombstone and can be restored; a card cannot be brought back at all.
    expect(ACTIONS['task.delete'].danger).toBe('irreversible')
    expect(ACTIONS['item.delete'].danger).toBe('guarded')
    expect(ACTIONS['item.delete'].summary).toContain('墓碑')
  })

  it('says so in the summary, because the grade alone does not reach the model', () => {
    expect(ACTIONS['task.delete'].summary).toContain('不可恢复')
  })
})

describe('the field verdicts reach the tool surface', () => {
  it('a task field the model forbids is not offered as a parameter', () => {
    for (const field of ['promptImages', 'promptFiles'] as const) {
      expect(TASK_FIELDS[field].access).toBe('forbidden')
      expect(Object.keys(ACTIONS['task.update'].params)).not.toContain(field)
    }
  })

  it('an item field the model forbids is not offered as a parameter either', () => {
    for (const field of ['ref', 'origin', 'updatedAt'] as const) {
      expect(ITEM_FIELDS[field].access).not.toBe('writable')
      expect(Object.keys(ACTIONS['item.update'].params)).not.toContain(field)
    }
  })
})

describe('the catalog gate', () => {
  it('is green on the real catalog', () => {
    expect(actionCatalogFindings()).toEqual([])
  })

  it('catches a verb outside the declared set', () => {
    const findings = actionCatalogFindings({ actions: poison('item.create', { verb: 'archive' as never }) })
    expect(findings.join('\n')).toContain('is not one of the declared verbs')
  })

  it('catches an action marked semantic without naming the shared function', () => {
    const findings = actionCatalogFindings({ actions: poison('task.move', { semantic: true, semanticOf: undefined }) })
    expect(findings.join('\n')).toContain('without naming the shared core function')
  })

  it('catches a semantic action naming a function that does not exist', () => {
    // A renamed or misspelled function is the case this whole check is for.
    const findings = actionCatalogFindings({
      actions: poison('task.move', { semantic: true, semanticOf: 'moveTaskToStatusButRenamed' }),
    })
    expect(findings.join('\n')).toContain('not a shared core function that exists')
  })

  it('accepts a semantic action once the shared function really exists', () => {
    // The other half of the check: it must not fire on a declaration that is
    // true, or the fix for a finding would be to delete the finding. The
    // registry is read from the transitions module, so this passes because the
    // function is really there — not because a list was updated to agree.
    expect(actionCatalogFindings({
      actions: poison('item.update', { semantic: true, semanticOf: 'moveTaskToStatus' }),
    })).toEqual([])
  })

  it('catches a function named without the mark', () => {
    const findings = actionCatalogFindings({ actions: poison('item.update', { semanticOf: 'itemStatusOf' }) })
    expect(findings.join('\n')).toContain('without being marked semantic')
  })

  it('catches a forbidden field smuggled into an action\'s parameters', () => {
    const findings = actionCatalogFindings({
      actions: poison('task.update', {
        params: { ...ACTIONS['task.update'].params, promptImages: { about: '图片' } },
      }),
    })
    expect(findings.join('\n')).toContain('the model rules this field "forbidden"')
  })

  it('catches a checklist identity offered as a parameter', () => {
    const findings = actionCatalogFindings({
      actions: poison('item.update', { params: { ...ACTIONS['item.update'].params, ref: { about: '编号' } } }),
    })
    expect(findings.join('\n')).toContain('item.update.ref')
  })

  it('catches a parameter that claims to be both optional and conditional', () => {
    const findings = actionCatalogFindings({
      actions: poison('item.create', {
        params: { body: { about: '正文', optional: true, requiredWhen: 'always' } },
      }),
    })
    expect(findings.join('\n')).toContain('declared both optional and requiredWhen')
  })

  it('catches a parameter nobody described, and one whose condition is blank', () => {
    const blank = actionCatalogFindings({
      actions: poison('item.create', {
        params: { body: { about: '  ', requiredWhen: '' } },
      }),
    })
    expect(blank.join('\n')).toContain('has no description')
    const noAbout = actionCatalogFindings({
      actions: poison('item.create', {
        params: { body: { about: '正文', appliesWhen: '   ' } },
      }),
    })
    expect(noAbout.join('\n')).toContain('appliesWhen is empty')
  })

  it('catches an action with no summary — a schema would print a nameless op', () => {
    const findings = actionCatalogFindings({ actions: poison('item.create', { summary: '   ' }) })
    expect(findings.join('\n')).toContain('has no summary')
  })
})
