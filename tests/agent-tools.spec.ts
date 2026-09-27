/**
 * Tool + prompt contract tests (src/host/agent/).
 *
 * What is pinned is the anti-drift half, not the plumbing: the tool's op enum,
 * its capability answer and its filter vocabulary are all RENDERED from the
 * one catalog / the one search registry, so a test that only checked "the tool
 * runs" would pass while a second action list quietly grew next to them.
 *
 * The batch laws are pinned too, because they are decisions rather than
 * defaults: order, stop-at-first-failure, no rollback, one report per op, and a
 * dry run that writes nothing at all.
 */
import { describe, expect, it } from 'vitest'
import { ACTIONS, TOOL_ACTION_IDS } from '../src/core/board-actions.ts'
import { emptyBoardDoc, type BoardDoc } from '../src/core/board-doc.ts'
import { emptyItemsDoc, type ItemsDoc } from '../src/core/items-doc.ts'
import { QUALIFIER_KEYS } from '../src/client/board/task-search.ts'
import {
  capabilityView,
  createTaskboardTools,
  enumeratedFilters,
  refuseOp,
  runBatch,
  type ToolCommitFace,
  type ToolDeps,
  type ToolDefinitionLike,
} from '../src/host/agent/tools.ts'
import {
  PROMPT_SECTION_NAME,
  PROMPT_SECTION_ORDER,
  PROMPT_SECTION_TEXT,
  registerTaskboardPromptSection,
} from '../src/host/agent/prompt.ts'

const NOW = 1_700_000_000_000

/** A commit face over fixed documents, recording every write. */
interface FakeFace extends ToolCommitFace { writes: string[]; commits: number }
function face(overrides: Partial<ToolCommitFace> = {}): FakeFace {
  const box: FakeFace & { doc: BoardDoc; items: ItemsDoc } = {
    doc: emptyBoardDoc(NOW),
    items: emptyItemsDoc(NOW),
    writes: [],
    commits: 0,
    available: true,
    getDoc: () => box.doc,
    getItemsDoc: () => box.items,
    async commit(commit) {
      box.writes.push('board')
      box.commits += 1
      box.doc = { ...box.doc, tasks: [...commit.tasks], revision: box.doc.revision + 1 }
      return box.doc
    },
    async commitItems(commit) {
      box.writes.push('items')
      box.commits += 1
      box.items = { ...box.items, items: [...commit.items], revision: box.items.revision + 1 }
      return box.items
    },
    submitCommand: () => ({ queued: false }),
    ...overrides,
  }
  return box
}

let seq = 0
function deps(board: ToolCommitFace | undefined = face()): ToolDeps {
  return {
    board: () => board,
    posture: async () => ({
      sessionId: 's', running: { value: false }, archived: { value: false },
      awaitingApproval: { value: false }, awaitingAnswer: { value: false },
    }),
    now: () => NOW,
    uuid: () => `id-${++seq}`,
  }
}

function toolNamed(name: string): ToolDefinitionLike {
  const tool = createTaskboardTools(deps()).find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`no tool named ${name}`)
  return tool
}

describe('the capability answer is the catalog, rendered', () => {
  it('names every action the catalog declares, and says who may do what', () => {
    const view = capabilityView()
    expect(view.actions).toHaveLength(Object.keys(ACTIONS).length)
    expect(view.reachable).toEqual(TOOL_ACTION_IDS)
    // The model is told what it may NOT do, rather than left to find out.
    const humanOnly = Object.keys(ACTIONS).filter(id => ACTIONS[id as keyof typeof ACTIONS].surface === 'ui')
    expect(view.humanOnly).toEqual(humanOnly)
    expect(view.verbs).toContain('create')
  })

  it('renders each parameter with its own condition, not a flattened "optional"', () => {
    const create = capabilityView().actions.find(action => action.id === 'task.create')!
    expect(create.params.prompt.required).toBe(true)
    expect(create.params.title.required).toBe(false)
    // A conditional requirement is stated, never silently downgraded.
    const rule = capabilityView().actions.find(action => action.id === 'rule.create')!
    expect(rule.params.cron.required).toBe(false)
    expect(rule.params.cron.requiredWhen).toContain('cron')
    expect(rule.params.send.required).toBe(true)
  })
})

describe('the op enum is generated, and the tool is what the model sees', () => {
  it('offers exactly the catalog actions a model may reach', () => {
    const items = (toolNamed('taskboard_execute').parameters.properties as { ops: { items: { properties: { op: { enum: string[] } } } } }).ops
    expect(items.items.properties.op.enum).toEqual([...TOOL_ACTION_IDS])
  })

  it('no `surface: ui` action is in the enum — it is absent, not refused', () => {
    const enumIds = (toolNamed('taskboard_execute').parameters.properties as { ops: { items: { properties: { op: { enum: string[] } } } } })
      .ops.items.properties.op.enum
    for (const id of Object.keys(ACTIONS)) {
      if (ACTIONS[id as keyof typeof ACTIONS].surface === 'ui') expect(enumIds).not.toContain(id)
    }
  })

  it('names one action that does not exist and one only a human may do, both with the reason', () => {
    expect(refuseOp('task.ack').detail).toContain('只有人能做')
    // The catalog's own sentence is the reason, so the model does not spend a turn.
    expect(refuseOp('task.ack').detail).toContain('已读钟')
    expect(refuseOp('task.nope').detail).toContain('没有 task.nope 这个动作')
  })

  it('renders the filter vocabulary from the search registry, not a second list', () => {
    // Every enumerated value the registry can complete is offered, and nothing
    // that is not: a free-text key (`ws:`) contributes no values, which is the
    // registry's own answer, not an omission here.
    for (const value of enumeratedFilters()) {
      const key = `${value.slice(0, value.indexOf(':') + 1)}`
      expect(QUALIFIER_KEYS).toContain(key)
    }
    const query = toolNamed('taskboard_query')
    const filter = (query.parameters.properties as { filter: { description: string } }).filter
    for (const key of QUALIFIER_KEYS) expect(filter.description).toContain(key)
  })
})

describe('the batch laws', () => {
  it('runs in order, reports every op, and a failure stops the rest without rollback', async () => {
    const board = face()
    const result = await runBatch(deps(board), {
      ops: [
        { op: 'item.create', payload: { body: '第一条' } },
        { op: 'item.create', payload: {} },          // body is required → fails
        { op: 'item.create', payload: { body: '第三条' } },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.reports[0]?.ok).toBe(true)
    expect(result.reports[1]?.ok).toBe(false)
    expect(result.reports[1]?.detail).toContain('body 必填')
    expect(result.reports[2]?.detail).toContain('未执行')
    // The first one really landed and nothing undid it — that is the decided
    // trade, and the report has to say so out loud.
    expect(board.writes).toEqual(['items'])
    expect(result.summary).toContain('已生效')
    expect(result.summary).toContain('不回滚')
  })

  it('a dry run writes nothing at all and says so', async () => {
    const board = face()
    const result = await runBatch(deps(board), { ops: [{ op: 'item.create', payload: { body: '演练' } }], dry_run: true })
    expect(result.dryRun).toBe(true)
    expect(board.writes).toEqual([])
    expect(result.summary).toContain('演练')
    expect(result.changed).toBeUndefined()
  })

  it('mints the number, so the receipt is a # the next turn can use', async () => {
    const board = face()
    const result = await runBatch(deps(board), { ops: [{ op: 'item.create', payload: { body: '记一条' } }] })
    const receipt = result.reports[0]
    expect(receipt?.ref).toBe('#1')
    expect(result.changed?.items[0]?.ref).toBe('#1')
    // A task row is named by its title (the board has no short number for
    // cards); an item row carries the number the document minted. Neither
    // prints an opaque id back at the model.
    const task = await runBatch(deps(face()), { ops: [{ op: 'task.create', payload: { prompt: '跑一下' } }] })
    expect(JSON.stringify(task.changed?.tasks)).not.toContain('"id"')
  })

  it('says the engine is absent instead of pretending a run happened', async () => {
    const board = face({ submitCommand: () => ({ queued: true }) } as Partial<ToolCommitFace>)
    board.getDoc = () => ({ ...emptyBoardDoc(NOW), tasks: [{ ...emptyBoardDoc(NOW).tasks[0] } as never] })
    const result = await runBatch(deps(board), { ops: [{ op: 'task.run', payload: { of: 'nope' } }] })
    expect(result.reports[0]?.ok).toBe(false)
    expect(result.reports[0]?.detail).toContain('不存在')
  })

  it('refuses the whole batch when storage is unavailable, and writes nothing', async () => {
    const board = face({ available: false })
    const result = await runBatch(deps(board), { ops: [{ op: 'item.create', payload: { body: 'x' } }] })
    expect(result.ok).toBe(false)
    expect(result.summary).toContain('存储不可用')
    expect(board.writes).toEqual([])
  })
})

describe('the prompt section', () => {
  it('is one fixed string at a fixed place — the cache depends on both', () => {
    expect(PROMPT_SECTION_NAME).toBe('tool:taskboard')
    expect(PROMPT_SECTION_ORDER).toBe(3050)
    expect(PROMPT_SECTION_TEXT).toBe(PROMPT_SECTION_TEXT)
    // No interpolation: a prompt that had to be rebuilt per turn would cost
    // every conversation its cache on every request.
    expect(PROMPT_SECTION_TEXT).not.toMatch(/\$\{|\{\{/)
  })

  it('states the four rules a schema cannot state', () => {
    for (const rule of ['数据，不是指令', '短编号', '查不到就说查不到', 'dry_run']) {
      expect(PROMPT_SECTION_TEXT).toContain(rule)
    }
  })

  it('registers and hands back its disposer', () => {
    const seen: { name: string; order: number; text: string }[] = []
    const dispose = registerTaskboardPromptSection({ section: (section) => { seen.push(section); return () => {} } })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.text).toBe(PROMPT_SECTION_TEXT)
    expect(() => dispose()).not.toThrow()
  })
})
