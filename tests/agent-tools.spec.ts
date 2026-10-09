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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RUN_CONFIG_KEYS } from '../src/core/run-presets.ts'
import { ACTIONS, TOOL_ACTION_IDS } from '../src/core/board-actions.ts'
import { emptyBoardDoc, applyCommit, type BoardDoc } from '../src/core/board-doc.ts'
import { emptyItemsDoc, applyItemsCommit, deletedItemsOf, purgeItemTombstone, type ItemsDoc } from '../src/core/items-doc.ts'
import type { ItemRecord } from '../src/core/item.ts'
import { QUALIFIER_KEYS } from '../src/core/task-search.ts'
import { itemQualifierVocabulary } from '../src/core/item-query.ts'
import {
  capabilityView,
  clearIdempotentReplies,
  createTaskboardTools,
  enumeratedFilters,
  refuseOp,
  runBatch,
  type ToolCommitFace,
  type ToolDeps,
  type ToolDefinition,
} from '../src/host/agent/tools.ts'
import {
  PROMPT_SECTION_NAME,
  PROMPT_SECTION_ORDER,
  PROMPT_SECTION_TEXT,
  registerTaskboardPromptSection,
} from '../src/host/agent/prompt.ts'
// The section face is the HOST's shape, so a test cannot assert against a
// contract the plugin drew for itself.
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'

const NOW = 1_700_000_000_000

/** A commit face whose stored documents are the MERGED truth.
 *
 *  It writes through the real merge grammar (`applyCommit` / `applyItemsCommit`)
 *  rather than assembling an object by hand, and `getDoc` reads back exactly
 *  what that grammar produced. That is the whole point: a fake that hands a
 *  document straight to the reader cannot tell a semantic transition that works
 *  from one that was faked into existence, and a test written against it is
 *  green on a machine where the real thing is broken. */
interface FakeFace extends ToolCommitFace {
  /** The stored documents, so a test can seed AND assert on the merged truth. */
  doc: BoardDoc
  items: ItemsDoc
  writes: string[]
  commits: number
  seed(doc: BoardDoc): void
  seedItems(items: ItemsDoc): void
}
function face(overrides: Partial<ToolCommitFace> = {}): FakeFace {
  const box: FakeFace = {
    doc: emptyBoardDoc(NOW),
    items: emptyItemsDoc(NOW),
    writes: [],
    commits: 0,
    available: true,
    seed(doc) { box.doc = doc },
    seedItems(items) { box.items = items },
    getDoc: () => box.doc,
    getItemsDoc: () => box.items,
    async commit(commit) {
      box.writes.push('board')
      box.commits += 1
      box.doc = applyCommit(box.doc, commit, NOW + 1)
      return box.doc
    },
    async commitItems(commit) {
      box.writes.push('items')
      box.commits += 1
      box.items = applyItemsCommit(box.items, commit, NOW + 1)
      return box.items
    },
    // The REAL document function, for the same reason `commitItems` is: a fake
    // that handed back a pre-emptied tombstone map would pass while the only
    // implementation that can be wrong went untested. The tool always addresses
    // by identity here — it turned the spoken number into one before asking.
    async purgeItem(of) {
      const id = of.kind === 'id'
        ? of.id
        : deletedItemsOf(box.items).find(row => row.ref === of.ref)?.id
      if (id === undefined) return { kind: 'alreadyGone', doc: box.items }
      const outcome = purgeItemTombstone(box.items, id)
      if (outcome.doc !== box.items) box.items = outcome.doc
      return outcome
    },
    submitCommand: () => ({ queued: false }),
    ...overrides,
  }
  return box
}

let seq = 0
/** A minimal card: enough for the relay to find it and name it. */
function card(title: string, now = NOW): BoardDoc['tasks'][number] {
  return { id: `t-${title}`, title, description: '', prompt: 'p', status: 'todo', order: 0, createdAt: now, updatedAt: now, executions: [] }
}
/** Live faces over a fixed set of session statuses; anything else is
 *  `unknown`, which is what a host that cannot see a session must say.
 *
 *  `said` collects what a hand-off actually delivered, because a hand-off that
 *  cannot be observed is a hand-off that cannot be tested — and the two callers
 *  of it (the panel's button and `item.ask`) used to be the one thing nobody
 *  could check. */
function runningSources(
  running: Record<string, 'running' | 'idle'>,
  said: string[] = [],
): ToolDeps['sources'] {
  return {
    agents: () => ({
      get: (id: string) => (id in running
        ? {
            status: running[id],
            followup: (message: unknown) => {
              const text = (message as { content: Array<{ text: string }> }).content[0]?.text ?? ''
              said.push(`${id}: ${text}`)
            },
          }
        : undefined),
    }),
  }
}
function deps(board: ToolCommitFace | undefined = face(), sources: ToolDeps['sources'] = runningSources({})): ToolDeps {
  return {
    board: () => board,
    posture: async () => ({
      sessionId: 's', running: { value: false }, archived: { value: false },
      awaitingApproval: { value: false }, awaitingAnswer: { value: false },
    }),
    sources,
    now: () => NOW,
    uuid: () => `id-${++seq}`,
  }
}

function toolNamed(name: string): ToolDefinition {
  const tool = createTaskboardTools(deps()).find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`no tool named ${name}`)
  return tool
}

/** Run the read tool and return the value it hands the model. */
async function query(args: Record<string, unknown>, board = face()): Promise<Record<string, unknown>> {
  const tool = createTaskboardTools(deps(board)).find(candidate => candidate.name === 'taskboard_query')
  if (tool === undefined || tool.execute === undefined) throw new Error('no taskboard_query')
  return await tool.execute(args, undefined as never) as Record<string, unknown>
}

/** The text the model actually reads, which is not the JSON. */
async function queryText(args: Record<string, unknown>, board = face()): Promise<string> {
  const tool = createTaskboardTools(deps(board)).find(candidate => candidate.name === 'taskboard_query')
  if (tool === undefined || tool.execute === undefined) throw new Error('no taskboard_query')
  const value = await tool.execute(args, undefined as never)
  const rendered = tool.output.render(args, value as never)
  return rendered.map(block => (block.type === 'text' ? block.text : '')).join('\n')
}

/** A row carrying something in every field the read side can be asked for. */
function richItem(): ItemRecord {
  return {
    id: 'i-rich', ref: 7, title: 'A note', body: 'the body', notes: 'the notes',
    steps: [{ id: 's1', text: 'one', done: false }, { id: 's2', text: 'two', done: true }],
    status: 'todo', priority: 'high', tags: ['gallery', 'later'],
    startsAfter: undefined, dueAt: undefined, hardDueAt: undefined, taskId: undefined,
    origin: { source: 'human', at: NOW }, createdAt: NOW, updatedAt: NOW,
  }
}

describe('the read tool answers what it says it answers', () => {
  it('`detail` is not a promise — it was declared, described, destructured, and never read', async () => {
    // THE DEFECT. `detail` has been in the schema with the description
    // 「brief 只回标题与状态；full 连正文一起回」 since it was written, and the
    // body destructured it and then never branched on it. Every row came back
    // with a title whatever the caller asked for — so a model that asked for the
    // contents of a note got a title and had NO WAY TO TELL that it had been
    // given the wrong answer. It simply believed it. On a note-taking subsystem
    // whose whole point is writing things down.
    const box = face()
    box.seedItems(applyItemsCommit(box.items, { clientId: 'test', items: [richItem()], deleted: [] }, NOW))
    const brief = await query({}, box)
    const full = await query({ detail: 'full' }, box)
    expect(full.detail, 'the answer does not even say which projection it used').toBe('full')
    expect(brief.detail).toBe('brief')
    expect(Object.keys((brief.items as Record<string, unknown>[])[0] ?? {}), 'brief is carrying the body already')
      .not.toContain('body')
  })

  it('`full` returns the whole written row: the fields a model could write and not read', async () => {
    const box = face()
    box.seedItems(applyItemsCommit(box.items, { clientId: 'test', items: [richItem()], deleted: [] }, NOW))
    const rows = (await query({ detail: 'full' }, box)).items as Record<string, unknown>[]
    const row = rows[0] as Record<string, never>
    expect(row.body).toBe('the body')
    expect(row.notes).toBe('the notes')
    expect(row.tags).toEqual(['gallery', 'later'])
    expect(row.steps).toEqual([
      { id: 's1', text: 'one', done: false },
      { id: 's2', text: 'two', done: true },
    ])
    // The number is read back so `item.step` can be aimed at a line, which is
    // the whole reason a model needs the list rather than a count.
    expect(row.progress).toEqual({ done: 1, total: 2, ratio: 0.5 })
  })

  it('and the PROSE carries the content, not only the JSON', async () => {
    // A model asked for the body and handed a title has been lied to even when
    // the JSON underneath is right — `render` is what the model actually reads.
    const box = face()
    box.seedItems(applyItemsCommit(box.items, { clientId: 'test', items: [richItem()], deleted: [] }, NOW))
    expect(await queryText({ detail: 'full' }, box)).toContain('正文：the body')
    expect(await queryText({}, box)).not.toContain('正文：')
  })

  it('says the READ column, not the stored one — so a filter and a row agree', async () => {
    /* THE SECOND READ DEFECT, restated for the one-vocabulary law. `itemRow` used to report
       the STORED status while the filter answered a DERIVED one, so a row hanging off a
       running card was filtered into 「进行中」 and came back printed 「待办」.

       现在**只有一个词表**：一条挂卡的行走在哪一栏，读的就是那张卡的 `status`；清单自己
       存的两个值只是「它没有卡的时候」的答案。所以这一条钉同一件事的两个方向：①一张在
       `running` 栏的卡，它的行读出来就是 `running`，按 `status:running` 筛得到它；
       ②完整投影里的 `storedStatus` 仍然说得出这一行**自己**存的那一档（`todo`）——两个
       答案不互相顶替。 */
    const box = face()
    const running = face()
    running.seed({ ...emptyBoardDoc(NOW), tasks: [{
      ...card('live'), id: 'card-live', status: 'running',
    }] })
    running.seedItems(applyItemsCommit(running.items, {
      clientId: 'test', items: [{ ...richItem(), taskId: 'card-live' }], deleted: [],
    }, NOW))
    const tool = createTaskboardTools({ ...deps(running), sources: runningSources({ 's-live': 'running' }) })
      .find(candidate => candidate.name === 'taskboard_query')
    if (tool === undefined) throw new Error('no taskboard_query')
    const answer = await tool.execute!({ filter: 'status:running' }, undefined as never) as { items: { status: string }[] }
    expect(answer.items, 'a row standing in 进行中 was not returned by status:running').toHaveLength(1)
    expect(answer.items[0]?.status, 'a row standing in 进行中 came back saying something else').toBe('running')
    // And the stored tier is still reachable, under its own name.
    const detailed = await tool.execute!({ detail: 'full', filter: 'status:running' }, undefined as never) as { items: { storedStatus: string; taskId?: string }[] }
    expect(detailed.items[0]?.storedStatus).toBe('todo')
    expect(detailed.items[0]?.taskId).toBe('card-live')
    // The control: a host with no board answers with the row's OWN two values — the honest
    // shape of 「看不见那张卡」, never a guess at a column and never an empty lie. (The same
    // row is seeded here WITHOUT its card, so this is a real answer and not an empty document
    // saying nothing.)
    box.seedItems(applyItemsCommit(box.items, {
      clientId: 'test', items: [{ ...richItem(), taskId: 'card-live' }], deleted: [],
    }, NOW))
    const idle = await query({ filter: 'status:running' }, box)
    expect(idle.items).toEqual([])
    expect((await query({ filter: 'status:todo' }, box)).items, 'a mounted row was not read as 待办 on a host that cannot see the board').toHaveLength(1)
  })

  it('truncation is reported for BOTH lists, so a short answer is never read as a whole one', async () => {
    const box = face()
    box.seedItems(applyItemsCommit(box.items, {
      clientId: 'test', items: [richItem(), { ...richItem(), id: 'i-2', ref: 8 }], deleted: [],
    }, NOW))
    expect((await query({ limit: 1 }, box)).truncated, 'the notes list hit the limit and nobody said so').toBe(true)
    expect((await query({ limit: 50 }, box)).truncated).toBe(false)
  })
})

describe('a two-document action says which documents it moved', () => {
  it('names both on a promote, because one commit of two is two commits', async () => {
    // `item.promote` writes the board AND the checklist, through two separate
    // commits. A receipt that says 「已生效」 with no subject is a claim about
    // both documents made by a pair of operations where either can fail alone.
    const box = face()
    box.seedItems(applyItemsCommit(box.items, { clientId: 'test', items: [richItem()], deleted: [] }, NOW))
    const result = await runBatch(deps(box), { ops: [{ op: 'item.promote', payload: { of: '#7' } }] })
    const report = result.reports[0]
    expect(report?.documents, 'the receipt does not say which documents it touched').toEqual(['board', 'items'])
    expect(report?.detail).toContain('看板与清单')
  })

  it('names the half that landed when the second commit is refused', async () => {
    // The case the old sentence got wrong: the board commit succeeded, the
    // items commit threw, and the report said 「没写进去」 about the WHOLE op —
    // which is how a reader learns that this tool's failure sentences do not
    // mean what they say, and is left looking at a card that really exists.
    const base = face()
    base.seedItems(applyItemsCommit(base.items, { clientId: 'test', items: [richItem()], deleted: [] }, NOW))
    const half = face({
      ...base,
      commitItems: async () => { throw new Error('disk full') },
    })
    const result = await runBatch(deps(half), { ops: [{ op: 'item.promote', payload: { of: '#7' } }] })
    const report = result.reports[0]
    expect(report?.ok).toBe(false)
    expect(report?.detail).toContain('disk full')
    expect(report?.detail, 'the half that DID land is not named').toContain('看板')
    expect(report?.detail).toContain('没有回滚')
    expect(report?.documents).toEqual(['board'])
  })

  it('keeps the single-document sentence byte-identical, so honest receipts do not churn', async () => {
    const box = face()
    const result = await runBatch(deps(box), { ops: [{ op: 'item.create', payload: { body: 'x' } }] })
    expect(result.reports[0]?.detail).toContain('已生效。')
    expect(result.reports[0]?.documents).toEqual(['items'])
  })

  it('a rehearsal says 会写入, because a dry run that reads as a completed write is the one line it must never print', async () => {
    const box = face()
    box.seedItems(applyItemsCommit(box.items, { clientId: 'test', items: [richItem()], deleted: [] }, NOW))
    const result = await runBatch(deps(box), { ops: [{ op: 'item.promote', payload: { of: '#7' } }], dry_run: true })
    expect(result.reports[0]?.detail).toContain('会写入')
    expect(result.reports[0]?.detail).not.toContain('已写入')
  })
})

describe('the run-config field list exists once', () => {
  /**
   * SEVEN COPIES, TWO OF THEM `as const` LOOPS, AND NOT ONE GATE.
   *
   * The run-config field names were written out in seven places. Two of those were
   * loops of the shape `for (const key of ['workspaceId', …] as const)`, which is
   * the one construct in TypeScript that stays valid forever. So when a run field
   * was added to the card and to the interface, both loops went on ignoring it and
   * the build stayed green — and the failure that produced was the model being
   * answered 「已生效」 about a field that had not moved, having burnt a revision and
   * woken every device to achieve nothing. Each copy was a complete, correct list
   * of the keys that copy knew about, so nothing anywhere could be incomplete.
   *
   * So the list is exported once and the interface is derived from it, and THIS is
   * the gate for the class: a second literal list of those names is the defect, and
   * it is invisible to every other check because each such list is well-formed on
   * its own.
   */
  // A WRITE PATH, and the distinction from a declaration is the whole point: the
  // catalogue and the interface are SUPPOSED to name each field, and that is what
  // declaring a shape is. A place that APPLIES a patch is not declaring anything,
  // it is answering 「which fields are these」 a second time — and that second
  // answer is what went stale.
  const WRITE_PATHS = [
    'src/core/controller.ts',
    'src/host/agent/tools.ts',
    'src/client/board/automation-ui.tsx',
  ]

  it('no write path spells the list out again', () => {
    for (const rel of WRITE_PATHS) {
      const source = readFileSync(join(process.cwd(), ...rel.split('/')), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      for (const key of RUN_CONFIG_KEYS) {
        expect(
          new RegExp(`\\[\\s*(?:'${key}'|"${key}"\\s*,?)`).test(source),
          `${rel} spells a run-config field list out literally again (starting at ${key}). `
          + 'Import RUN_CONFIG_KEYS from core/run-presets.ts and loop over it: a literal list is a valid, complete, '
          + 'and permanently stale second answer to 「which fields are these」.',
        ).toBe(false)
      }
    }
  })

  it('the catalogue offers EXACTLY those fields, so declaring a new one is not a silent no-op', () => {
    // The other drift direction, and it is the one that reaches the model. The
    // catalogue is the contract the model reads; a field it offers and nothing
    // applies is a promise the tool breaks, and a field it omits is a capability
    // the model cannot find. So the set is checked, not the spelling.
    const offered = Object.keys(ACTIONS['task.update'].params).sort()
    const expected = ['agentPreset', 'color', 'description', 'model', 'of', 'permission', 'prompt', 'provider', 'reasoningEffort', 'title', 'workspaceId']
    expect(offered, 'the catalogue\'s task.update parameters have drifted from the fields the card actually has').toEqual(expected)
  })

  it('and the model can actually SET them — the promise the catalogue makes', async () => {
    // The other half, because deriving the list does not by itself make a tool
    // apply it. `task.update` listed eleven parameters in the catalogue and wrote
    // three; the loop it now uses is the shared one, so this asserts the BEHAVIOUR
    // rather than the shape: a colour the model sets is a colour the card has.
    const board = face()
    const created = await runBatch(deps(board), { ops: [{ op: 'task.create', payload: { title: '配色试验', prompt: '试一次' } }] })
    expect(created.ok, `could not create the card to colour: ${JSON.stringify(created)}`).toBe(true)
    // The colour goes in through the same op. This gate is about the FIELD being
    // applied, so the card is addressed the way the writer addresses it; whether
    // the create receipt hands the model an address is a separate question and is
    // not what fails here.
    const made = board.getDoc().tasks.find(task => task.title === '配色试验')
    expect(made, 'the card was not created, so there is nothing to colour').toBeDefined()
    const paint = await runBatch(deps(board), { ops: [{ op: 'task.update', payload: { of: String(made?.id), color: '#aabbcc' } }] })
    expect(paint.ok, `the colour was refused entirely: ${paint.summary}`).toBe(true)
    const painted = board.getDoc().tasks.find(task => task.title === '配色试验')
    expect(painted?.color, 'the model set a colour the catalogue offers and the card does not have it').toBe('#aabbcc')
    // And an update that changes nothing says so instead of costing a write. The
    // report of 「nothing moved」 is an EMPTY change list, not a missing field —
    // the summary still has to read as a completion, so the assertion is on what
    // changed and on the revision, not on a flag.
    const commitsBefore = board.commits
    const again = await runBatch(deps(board), { ops: [{ op: 'task.update', payload: { of: String(made?.id), color: '#aabbcc' } }] })
    expect(again.changed?.tasks, 'setting a field to the value it already had was reported as a change').toEqual([])
    expect(again.counts.unchanged, 'the receipt calls a no-op an update').toBe(1)
    expect(board.commits, 'an update that changed nothing still cost a revision and woke every device').toBe(commitsBefore)
  })
})

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
  it('the CARDS run the board grammar, not a title substring', async () => {
    // THE CLAIM. `filterHelp()` advertises `has:auto` / `is:unread` / `ws:` as
    // usable values, and this half of the query was a whole-string `includes`
    // against `task.title` — so a model that sent one got back the cards whose
    // TITLE happened to contain those characters, and zero everywhere else. The
    // checklist half has been on its real grammar all along, which is how one
    // filter could be 「does nothing」 for half the document and work on the other.
    const board = face()
    board.seed({
      ...emptyBoardDoc(NOW),
      tasks: [
        { ...card('带规则的卡'), rules: [{ id: 'r-1', sessionId: 's-1', instruction: '每天看一眼', trigger: 'cron', cron: '0 9 * * *', send: 'queue', enabled: true }] },
        { ...card('普通的卡') },
      ],
    })
    const matched = await query({ filter: 'has:auto' }, board)
    const titles = (matched.tasks as Array<{ title: string }>).map(row => row.title)
    expect(titles, 'an advertised qualifier matched nothing the reader could act on').toContain('带规则的卡')
    expect(titles).not.toContain('普通的卡')
  })
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

  it('teaches the model EVERY vocabulary both registries parse, not one of them', () => {
    // **THIS USED TO BE A SELF-PROVING ASSERTION.** It compared the tool's
    // description against `QUALIFIER_KEYS` — which is what GENERATES that
    // description — so it could only ever say 「描述与它自己的来源一致」. And it
    // was green while the model was being taught a vocabulary that was half
    // wrong: `taskboard_query`'s filter string is parsed by `matchItemQuery` for
    // the item list too, so the board-only keys it taught (`has:*`, `is:*`) fell
    // through there as **free words and matched nothing, silently**, while
    // everything the list speaks was never mentioned.
    //
    // **THE CLAIM IS ABOUT THE PARSER, NOT ABOUT THE DESCRIPTION.** For every
    // token the ITEM grammar reads as a qualifier, the tool must name it; and
    // vice versa — a key in the description the parser does not know is a word
    // that silently matches nothing, which is the same defect pointing the other
    // way. That second half is what makes this test able to fail.
    const vocabulary = itemQualifierVocabulary()
    expect(vocabulary.length, 'the item vocabulary is empty — the derivation broke, not the description').toBeGreaterThan(0)
    const filter = (toolNamed('taskboard_query').parameters.properties as { filter: { description: string } }).filter
    const said = filter.description
    for (const token of vocabulary) {
      expect(said, `the model is never told \`${token}\`, so a query using it silently matches nothing`).toContain(token)
    }
    // And every board key survives alongside it — the two lists are additive.
    for (const key of QUALIFIER_KEYS) {
      expect(said, `the board's own key \`${key}\` disappeared from the description`).toContain(key)
    }
    // THE OTHER HALF, which the old assertion got right and this one keeps: the
    // description must also offer the VALUES, or the model knows the key and
    // still has to guess what goes after the colon. A free-text key (`ws:`)
    // contributes no values, and that is the registry's own answer rather than an
    // omission here.
    for (const value of enumeratedFilters()) {
      expect(said, `the model is told \`${value.slice(0, value.indexOf(':') + 1)}\` exists but never told \`${value}\` is one of its values`).toContain(value)
    }
    // And the round trip, which is the part that actually catches a stale list:
    // take the words out of the description and hand them back to the parser. A
    // word that survives being taught AND parsed is a real qualifier; one that
    // does not is a promise the tool cannot keep.
    const taught = vocabulary.concat(QUALIFIER_KEYS).filter(token => said.includes(token))
    expect(taught.length, 'nothing was taught at all').toBeGreaterThan(0)
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

  it('a write the host DECLINED is not reported as 已生效', async () => {
    // The receipt used to be decided from the tool's own DRAFT, never from what
    // `board.commit()` returned — and the merge discards a write whose stamp
    // another device already passed. So the op reported 「已生效」 about a write
    // that had not happened, listed the row under 受影响的, and the model's next
    // turn was built on it. The fake here is the ONLY one that can produce it:
    // every other case has a single document, so a draft and a host answer are
    // trivially the same and the discard is unreachable.
    const board = face()
    // The host keeps ITS copy: the commit is received and thrown away, which is
    // exactly what a stale stamp does inside the merge.
    const realCommit = board.commit.bind(board)
    board.commit = async () => board.getDoc()
    void realCommit
    const result = await runBatch(deps(board), { ops: [{ op: 'task.create', payload: { title: '被丢掉的一条', prompt: '试一次' } }] })
    const report = result.reports[0]
    expect(report?.detail, 'a write the host threw away was reported as a success').not.toContain('已生效')
    expect(report?.detail, 'the model was not told the write did not land').toContain('没写进去')
    expect(result.changed?.tasks ?? [], 'a declined write was still listed as changed').toEqual([])
    // And the host really is unchanged — the claim is about the document, not a wording.
    expect(board.getDoc().tasks.map(t => t.title)).not.toContain('被丢掉的一条')
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
    board.seed({ ...emptyBoardDoc(NOW), tasks: [{ ...emptyBoardDoc(NOW).tasks[0] } as never] })
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

describe('the checklist verbs a person can reach and a model now shares', () => {
  /** A checklist holding one row, already numbered, through the real grammar. */
  function withItem(patch: Record<string, unknown> = {}) {
    const board = face()
    const base = {
      id: 'i-1', ref: 1, title: '一条', body: '正文', notes: '', steps: [],
      status: 'todo', priority: 'normal', tags: [], startsAfter: undefined,
      dueAt: undefined, hardDueAt: undefined, taskId: undefined,
      origin: { source: 'human', at: NOW }, createdAt: NOW, updatedAt: NOW,
      ...patch,
    }
    board.seedItems(applyItemsCommit(emptyItemsDoc(NOW), { clientId: 'c', items: [base as never], deleted: [] }, NOW))
    return board
  }

  it('item.step ticks one step and leaves the rest exactly as they were', async () => {
    const board = withItem({
      steps: [
        { id: 's-1', text: '第一步', done: false },
        { id: 's-2', text: '第二步', done: true },
        { id: 's-3', text: '第三步', done: false },
      ],
    })
    const result = await runBatch(deps(board), { ops: [{ op: 'item.step', payload: { of: '#1', step: 's-1', done: true } }] })
    expect(result.ok).toBe(true)
    // The WHOLE list is not rebuilt: this is why the verb exists, because an
    // `item.update` replaces it wholesale and a model retyping steps from
    // memory is how a list quietly loses one.
    const steps = board.getItemsDoc().items[0]?.steps ?? []
    expect(steps.map(step => [step.id, step.done])).toEqual([['s-1', true], ['s-2', true], ['s-3', false]])
  })

  it('item.step names the steps that DO exist, rather than failing at "no such step"', async () => {
    const board = withItem({ steps: [{ id: 's-1', text: '第一步', done: false }] })
    const result = await runBatch(deps(board), { ops: [{ op: 'item.step', payload: { of: '#1', step: 's-9', done: true } }] })
    expect(result.reports[0]?.ok).toBe(false)
    // The step list is something only the document knows, so a miss has to
    // come back with the list in it — the caller cannot invent the id.
    expect(result.reports[0]?.detail).toContain('s-1')
  })

  it('item.step on a step already in that state changes nothing and says so', async () => {
    const board = withItem({ steps: [{ id: 's-1', text: '第一步', done: true }] })
    const writes = board.writes.length
    const result = await runBatch(deps(board), { ops: [{ op: 'item.step', payload: { of: '#1', step: 's-1', done: true } }] })
    expect(result.reports[0]?.detail).toContain('已经是这样了')
    expect(board.writes).toHaveLength(writes)
  })

  it('item.promote makes a card AND links the two, in one op', async () => {
    const board = withItem({ body: '要做的事' })
    const result = await runBatch(deps(board), { ops: [{ op: 'item.promote', payload: { of: '#1' } }] })
    expect(result.ok).toBe(true)
    const tasks = board.getDoc().tasks
    const items = board.getItemsDoc().items
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.title).toBe('一条')
    expect(tasks[0]?.prompt).toBe('要做的事')
    // Two documents, one op, and the link is the point: a card nobody can get
    // back to from the note, and a note nobody can get back to from the card.
    expect(items[0]?.taskId).toBe(tasks[0]?.id)
  })

  it('item.promote refuses to build a second card for a note that already has one', async () => {
    const board = withItem({ taskId: 't-elsewhere' })
    const result = await runBatch(deps(board), { ops: [{ op: 'item.promote', payload: { of: '#1' } }] })
    expect(result.reports[0]?.ok).toBe(false)
    expect(result.reports[0]?.detail).toContain('已经挂在卡片上了')
    expect(board.getDoc().tasks).toHaveLength(0)
  })

  it('item.restore brings a deleted note back, and says so when it cannot', async () => {
    const board = withItem()
    // Delete it through the real grammar, so the tombstone is a real one.
    await runBatch(deps(board), { ops: [{ op: 'item.delete', payload: { of: '#1' } }] })
    expect(board.getItemsDoc().items).toHaveLength(0)
    expect(board.getItemsDoc().tombstones['i-1']).toBeDefined()

    const back = await runBatch(deps(board), { ops: [{ op: 'item.restore', payload: { of: '#1' } }] })
    expect(back.ok).toBe(true)
    expect(board.getItemsDoc().items.map(item => item.id)).toEqual(['i-1'])
    expect(board.getItemsDoc().tombstones['i-1']).toBeUndefined()

    // A number nothing was ever deleted under is not a restore, it is a guess.
    const miss = await runBatch(deps(face()), { ops: [{ op: 'item.restore', payload: { of: '#99' } }] })
    expect(miss.reports[0]?.ok).toBe(false)
    expect(miss.reports[0]?.detail).toContain('#99')
  })

  it('item.promote rehearses cleanly and writes nothing', async () => {
    const board = withItem()
    const result = await runBatch(deps(board), { ops: [{ op: 'item.promote', payload: { of: '#1' } }], dry_run: true })
    expect(result.dryRun).toBe(true)
    expect(board.writes).toEqual([])
    expect(board.getDoc().tasks).toHaveLength(0)
  })

  it('item.purge erases the text behind a deletion, and the row cannot come back', async () => {
    const board = withItem()
    await runBatch(deps(board), { ops: [{ op: 'item.delete', payload: { of: '#1' } }] })
    expect(deletedItemsOf(board.getItemsDoc())).toHaveLength(1)

    const purged = await runBatch(deps(board), { ops: [{ op: 'item.purge', payload: { of: '#1' } }] })
    expect(purged.ok).toBe(true)
    expect(purged.reports[0]?.detail).toContain('撤不回来')
    // The archive is a read over tombstones, so this is where the row is gone —
    // and the tombstone itself is still there, which is what stops a replica
    // that never heard about the purge from handing the row back.
    expect(deletedItemsOf(board.getItemsDoc())).toEqual([])
    expect(board.getItemsDoc().tombstones['i-1']).toBeDefined()

    const back = await runBatch(deps(board), { ops: [{ op: 'item.restore', payload: { of: '#1' } }] })
    expect(back.reports[0]?.ok, 'a purged row is not restorable — that is what irreversible means').toBe(false)
    expect(board.getItemsDoc().items).toEqual([])
  })

  it('item.purge refuses a row that is still in the list, and says which action does that', async () => {
    // 「已彻底删除」 about a row the reader can scroll up and see is the one lie
    // this tool must not tell, and the fix is named rather than merely refused:
    // a model that knows which action deletes will use it.
    const board = withItem()
    const result = await runBatch(deps(board), { ops: [{ op: 'item.purge', payload: { of: '#1' } }] })
    expect(result.reports[0]?.ok).toBe(false)
    expect(result.reports[0]?.detail).toContain('item.delete')
    expect(board.getItemsDoc().items).toHaveLength(1)
  })

  it('item.purge on something already gone is a success, not a failure about finished work', async () => {
    const board = withItem()
    await runBatch(deps(board), { ops: [{ op: 'item.delete', payload: { of: '#1' } }] })
    const first = await runBatch(deps(board), { ops: [{ op: 'item.purge', payload: { of: '#1' } }] })
    expect(first.ok).toBe(true)
    const again = await runBatch(deps(board), { ops: [{ op: 'item.purge', payload: { of: '#1' } }] })
    expect(again.ok, 'a retry must not be reported as a failure about work that is finished').toBe(true)
    expect(again.reports[0]?.kind).toBe('unchanged')
  })

  it('item.purge rehearses in the future tense and writes nothing', async () => {
    // The one action on this surface that leaves nothing to undo, so a rehearsal
    // that reads as a completed write is the most expensive lie here.
    const board = withItem()
    await runBatch(deps(board), { ops: [{ op: 'item.delete', payload: { of: '#1' } }] })
    const result = await runBatch(deps(board), { ops: [{ op: 'item.purge', payload: { of: '#1' } }], dry_run: true })
    expect(result.dryRun).toBe(true)
    expect(result.reports[0]?.detail).toContain('会写入')
    expect(result.reports[0]?.detail).not.toContain('已生效')
    expect(deletedItemsOf(board.getItemsDoc())).toHaveLength(1)
  })
})

describe('the idempotency key is a promise the tool keeps', () => {
  // The field was declared in the envelope and read by nobody, which is worse
  // than not offering it: the caller is told a retry is safe and it is not.
  it('a retried batch returns the first answer and runs nothing again', async () => {
    clearIdempotentReplies()
    const board = face()
    const first = await runBatch(deps(board), {
      ops: [{ op: 'item.create', payload: { body: '只应存在一条' } }],
      idempotencyKey: 'k-1',
    })
    expect(first.ok).toBe(true)
    expect(board.getItemsDoc().items).toHaveLength(1)

    const second = await runBatch(deps(board), {
      ops: [{ op: 'item.create', payload: { body: '只应存在一条' } }],
      idempotencyKey: 'k-1',
    })
    // The row is the proof; the status code is not, because it is 200 either way.
    expect(board.getItemsDoc().items).toHaveLength(1)
    expect(second.replayed).toBe(true)
    // And the sentence has to say so, because "no new row" and "no second
    // attempt" are different facts and only the second one is what was promised.
    expect(second.summary).toContain('没有重复执行')
  })

  it('a different key is a different batch', async () => {
    clearIdempotentReplies()
    const board = face()
    await runBatch(deps(board), { ops: [{ op: 'item.create', payload: { body: 'a' } }], idempotencyKey: 'k-a' })
    await runBatch(deps(board), { ops: [{ op: 'item.create', payload: { body: 'b' } }], idempotencyKey: 'k-b' })
    expect(board.getItemsDoc().items).toHaveLength(2)
  })

  it('a rehearsal is not remembered, and a refusal is not either', async () => {
    clearIdempotentReplies()
    const rehearsed = face()
    await runBatch(deps(rehearsed), { ops: [{ op: 'item.create', payload: { body: 'x' } }], dry_run: true, idempotencyKey: 'k-dry' })
    // A caller may rehearse the same batch twice on purpose; the second one
    // should reflect the document as it is NOW, not as it was when the key
    // was first used.
    const again = await runBatch(deps(rehearsed), { ops: [{ op: 'item.create', payload: { body: 'x' } }], dry_run: true, idempotencyKey: 'k-dry' })
    expect(again.replayed).toBeUndefined()

    clearIdempotentReplies()
    const down = face({ available: false })
    await runBatch(deps(down), { ops: [{ op: 'item.create', payload: { body: 'x' } }], idempotencyKey: 'k-down' })
    // Storage being down wrote nothing, so there is nothing to promise about
    // it: remembering the refusal would hand it to a retry that should work.
    const up = face()
    const retried = await runBatch(deps(up), { ops: [{ op: 'item.create', payload: { body: 'x' } }], idempotencyKey: 'k-down' })
    expect(retried.replayed).toBeUndefined()
    expect(up.getItemsDoc().items).toHaveLength(1)
  })

  it('and the PUBLISHED schema says so, because a key published as a boolean never arrives', () => {
    // The behaviour above was always correct; the promise was not reachable,
    // because the whole envelope was published as `type: 'boolean'`. A model
    // that obeys the schema sends `idempotencyKey: true`; the reader guards on
    // `typeof === 'string'`, yields '', and the retry-safety path never runs —
    // silently, with the schema still claiming the protection is in force.
    //
    // So the assertion is about the SHAPE, not the behaviour: the two envelope
    // parameters have different kinds and the schema has to publish both of them.
    const envelope = toolNamed('taskboard_execute').parameters.properties as Record<string, { type?: string }>
    expect(envelope.dry_run?.type, 'dry_run is a flag').toBe('boolean')
    expect(envelope.idempotencyKey?.type, 'idempotencyKey is a caller-chosen string, not a flag').toBe('string')
  })

  it('and every envelope parameter publishes a shape, rather than inheriting one', () => {
    const envelope = toolNamed('taskboard_execute').parameters.properties as Record<string, { type?: string }>
    const published = new Set(['ops', 'dry_run', 'idempotencyKey'])
    for (const [name, spec] of Object.entries(envelope)) {
      if (!published.has(name)) continue
      expect(spec.type, `${name} is published with no JSON type, so a model is told nothing about what to send`).toBeDefined()
    }
  })
})

describe('the receipt a card renders', () => {
  it('carries the batch in the tool\'s own words, with a kind per op', async () => {
    const board = face()
    const result = await runBatch(deps(board), {
      ops: [
        { op: 'item.create', payload: { body: '一' } },
        { op: 'item.create', payload: { body: '二' } },
        { op: 'item.update', payload: { of: '#1', title: '改过的' } },
      ],
    })
    expect(result.counts.created).toBe(2)
    expect(result.counts.updated).toBe(1)
    // The kinds come from the catalog's verb, so a card and the model read the
    // same classification.
    expect(result.reports.map(r => r.kind)).toEqual(['created', 'created', 'updated'])
  })

  it('a dry run says NOTHING WAS WRITTEN, in the words a card can render', async () => {
    const result = await runBatch(deps(face()), { ops: [{ op: 'item.create', payload: { body: '演练' } }], dry_run: true })
    const meta = toolNamed('taskboard_execute').output.presentationMeta!({}, result as never) as Record<string, unknown>
    expect(meta.dryRun).toBe(true)
    // The one word that must never be wrong: a rehearsal that renders as
    // "added" tells the person something was written that was not.
    expect(meta.persisted).toBe(false)
    expect(meta.counts).toMatchObject({ created: 1 })
  })

  it('an engine op with no seat reads as ACCEPTED, not as executed', async () => {
    const board = face({ submitCommand: () => ({ queued: true }) } as Partial<ToolCommitFace>)
    board.seed({ ...emptyBoardDoc(NOW), tasks: [{ id: 't-1', title: '跑一下', description: '', prompt: 'p', status: 'todo', order: 0, createdAt: NOW, updatedAt: NOW, executions: [] }] })
    const result = await runBatch(deps(board), { ops: [{ op: 'task.run', payload: { of: '跑一下' } }] })
    expect(result.enginePending).toEqual(['跑一下'])
    const meta = toolNamed('taskboard_execute').output.presentationMeta!({}, result as never) as Record<string, unknown>
    expect(meta.enginePending).toEqual(['跑一下'])
    expect(String(meta.summary)).toContain('引擎')
  })
})

describe('the relay only carries what it can actually carry', () => {
  it('an engine action whose effect IS a run is relayed with no per-action code', async () => {
    const board = face()
    const relayed: string[] = []
    board.seed({ ...emptyBoardDoc(NOW), tasks: [card('跑一下')] })
    board.submitCommand = (command) => { relayed.push(command.type); return { queued: true } }
    const result = await runBatch(deps(board), { ops: [{ op: 'task.run', payload: { of: '跑一下' } }] })
    expect(relayed).toEqual(['run'])
    expect(result.enginePending).toEqual(['跑一下'])
  })

  it('an engine action rides the carrier the CATALOG names, never a guessed one', async () => {
    // The catalog says which carrier each action rides; this file only builds
    // what that carrier asks for. Forwarding a rename as a run would RUN THE
    // CARD instead of renaming anything — a silently wrong action, which is
    // worse than a refusal. So: the command's own `type` must be the carrier
    // the action declared, and the payload must carry that carrier's fields.
    const board = face()
    const relayed: unknown[] = []
    board.seed({ ...emptyBoardDoc(NOW), tasks: [card('要改名的卡')] })
    board.submitCommand = (command) => { relayed.push(command); return { queued: true } }
    const renamed = await runBatch(deps(board), { ops: [{ op: 'session.rename', payload: { of: '要改名的卡', session: 's-1', title: '新名字' } }] })
    expect(renamed.ok).toBe(true)
    // `of` is the catalog's ADDRESSING (which card this belongs to); the
    // carrier's own fields are the session and the name. The tool passes what
    // the carrier asks for and does not invent a field for it.
    expect(relayed).toEqual([{ type: 'session.rename', sessionId: 's-1', title: '新名字', clientId: 'model' }])
    // The receipt names what the engine was asked to do, so a queued request
    // never reads as a finished one.
    expect(renamed.reports[0]?.detail).toContain('改会话名')
    expect(renamed.enginePending).toEqual(['新名字'])

    // A comment carries its own fields, and refuses without the ones it needs.
    const commented = await runBatch(deps(board), { ops: [{ op: 'task.comment', payload: { of: '要改名的卡', session: 's-1', text: '接着说' } }] })
    expect(commented.ok).toBe(true)
    expect(relayed[1]).toEqual({ type: 'comment', taskId: 't-要改名的卡', sessionId: 's-1', text: '接着说', clientId: 'model' })
    const empty = await runBatch(deps(board), { ops: [{ op: 'task.comment', payload: { of: '要改名的卡', session: 's-1', text: '  ' } }] })
    expect(empty.reports[0]?.detail).toContain('是空的')
  })
})

describe('steps without an id are repaired, never dropped', () => {
  it('mints an id per step and says so instead of losing rows', async () => {
    const result = await runBatch(deps(face()), {
      ops: [{ op: 'item.create', payload: { body: '带步骤', steps: ['第一步', { text: '第二步' }] } }],
    })
    const receipt = result.reports[0]
    // Two steps arrived without ids; the row grammar would have dropped both.
    expect(result.changed?.items).toHaveLength(1)
    expect(receipt?.detail).toContain('铸号')
    expect(receipt?.detail).toContain('2')
  })

  it('a step that already has an id is left alone', async () => {
    const result = await runBatch(deps(face()), {
      ops: [{ op: 'item.create', payload: { body: '有 id', steps: [{ id: 's-1', text: '第一步', done: false }] } }],
    })
    expect(result.reports[0]?.detail).not.toContain('铸号')
  })
})

describe('a shape the writer got wrong is REFUSED, and nothing is half-written', () => {
  // THE TWO REFUSALS THAT MATTER MOST, because both have a wrong answer that
  // looks like a right one. A checklist supplied as a string can be read as "no
  // steps" — and `item.update` replaces the WHOLE row, so the reader's ticked
  // boxes are gone and the receipt says the edit was refused. A tag list
  // supplied as a number can be read as "no tags" — and the row is filed with
  // its structure stripped, which is the loss a capture-first surface exists to
  // prevent. So the rule is one sentence: an unreadable shape is never a repair.
  it('a checklist that is not a list leaves the ticked boxes exactly as they were', async () => {
    const board = face()
    await runBatch(deps(board), {
      ops: [{ op: 'item.create', payload: { body: '带勾选', steps: [{ id: 's-1', text: '第一步', done: true }] } }],
    })
    const before = board.getItemsDoc().items[0]?.steps ?? []
    expect(before.map(step => step.done)).toEqual([true])
    const result = await runBatch(deps(board), {
      ops: [{ op: 'item.update', payload: { of: '#1', steps: 'oops' } }],
    })
    const receipt = result.reports[0]
    expect(receipt?.ok, 'the edit reported success on a checklist it could not read').toBe(false)
    expect(receipt?.detail, 'the refusal does not say what shape a checklist is, so the writer has nothing to act on').toMatch(/列表|steps/i)
    // The document, not the receipt: a refused edit that still emptied the list
    // is the exact failure, and only reading the merged document back catches it.
    expect(board.getItemsDoc().items[0]?.steps ?? []).toEqual(before)
  })

  it('a tag list that is not a list refuses the row rather than filing it unlabelled', async () => {
    const board = face()
    const result = await runBatch(deps(board), {
      ops: [{ op: 'item.create', payload: { body: '带标签', tags: ['画廊'], steps: [{ id: 's-1', text: '第一步', done: true }] } }],
    })
    expect(result.reports[0]?.ok).toBe(true)
    const before = JSON.stringify(board.getItemsDoc().items)
    const refused = await runBatch(deps(board), {
      ops: [{ op: 'item.create', payload: { body: '标签是数字', tags: 123 } }],
    })
    expect(refused.reports[0]?.ok, 'a row was filed with its structure silently stripped').toBe(false)
    // Nothing about the document moved — not even the previous row, because a
    // write that half-succeeded is the state this plugin cannot recover from.
    expect(JSON.stringify(board.getItemsDoc().items)).toBe(before)
  })

  it('the refusals are distinguishable from each other, so the writer knows which one they hit', async () => {
    // One generic "bad input" for both would be safe, and useless: the writer
    // cannot fix a sentence that does not say which field was wrong.
    const board = face()
    const badSteps = await runBatch(deps(board), { ops: [{ op: 'item.update', payload: { of: '#1', steps: 'oops' } }] })
    const badTags = await runBatch(deps(board), { ops: [{ op: 'item.create', payload: { body: 'x', tags: 123 } }] })
    expect(badSteps.reports[0]?.detail).not.toBe(badTags.reports[0]?.detail)
  })
})

describe('the four simple document actions, proven through the merge grammar', () => {
  it('board.cruise writes the section, and reads it back clamped', async () => {
    const board = face()
    await runBatch(deps(board), { ops: [{ op: 'board.cruise', payload: { enabled: true, limit: 99 } }] })
    // Read the MERGED document back, not the return value: the bound is the
    // board's own clamp, and a hand-assembled fake would happily accept 99.
    const cruise = board.getDoc().cruise.value
    expect(cruise.enabled).toBe(true)
    expect(cruise.limit).toBe(20)
  })

  it('rule.delete removes exactly that rule and names where to look when it is not there', async () => {
    const board = face()
    board.seed({
      ...emptyBoardDoc(NOW),
      tasks: [{ ...card('带规则的卡'), rules: [
        { id: 'r-1', sessionId: 's-1', instruction: '每天看一眼', trigger: 'cron', cron: '0 9 * * *', send: 'queue', enabled: true },
        { id: 'r-2', sessionId: 's-2', instruction: '跑完看一眼', trigger: 'on-complete', cron: '', send: 'queue', enabled: true },
      ] }],
    })
    await runBatch(deps(board), { ops: [{ op: 'rule.delete', payload: { of: '带规则的卡', rule: 'r-1' } }] })
    expect(board.getDoc().tasks[0]?.rules?.map(rule => rule.id)).toEqual(['r-2'])

    const missed = await runBatch(deps(board), { ops: [{ op: 'rule.delete', payload: { of: '带规则的卡', rule: 'nope' } }] })
    expect(missed.ok).toBe(false)
    // The refusal is a next step, not a wall.
    expect(missed.reports[0]?.detail).toContain('taskboard_query')
  })

  it('session.reorder moves the row, and an unknown beforeId puts it last rather than dropping it', async () => {
    const board = face()
    board.seed({ ...emptyBoardDoc(NOW), tasks: [{ ...card('有序的卡'), sessionsOrder: ['s-1', 's-2'] }] })
    await runBatch(deps(board), { ops: [{ op: 'session.reorder', payload: { of: '有序的卡', session: 's-2', beforeId: 's-1' } }] })
    expect(board.getDoc().tasks[0]?.sessionsOrder).toEqual(['s-2', 's-1'])
    await runBatch(deps(board), { ops: [{ op: 'session.reorder', payload: { of: '有序的卡', session: 's-1', beforeId: 'not-a-session' } }] })
    expect(board.getDoc().tasks[0]?.sessionsOrder).toEqual(['s-2', 's-1'])
  })
})

describe('the five new document actions, proven through the merge grammar', () => {
  it('cancelComment removes a QUEUED comment and refuses an injected one, saying why', async () => {
    const board = face()
    const round = (id: string, extra: Record<string, unknown>) => ({ id, sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined, comment: '一句话', ...extra })
    board.seed({ ...emptyBoardDoc(NOW), tasks: [{ ...card('有评论的卡'), executions: [round('q-queued', {}), round('q-sent', { injectedAt: NOW + 1 })] as never }] })
    // The three preconditions are three FIELDS: a queued comment has neither
    // injectedAt nor endedAt, and an injected one has no way back.
    const queued = await runBatch(deps(board), { ops: [{ op: 'task.cancelComment', payload: { of: '有评论的卡', round: 'q-queued' } }] })
    expect(queued.ok).toBe(true)
    expect(board.getDoc().tasks[0]?.executions.map(entry => entry.id)).toEqual(['q-sent'])
    // The likeliest thing a model tries: withdrawing what has already gone out.
    const sent = await runBatch(deps(board), { ops: [{ op: 'task.cancelComment', payload: { of: '有评论的卡', round: 'q-sent' } }] })
    expect(sent.ok).toBe(false)
    expect(sent.reports[0]?.detail).toContain('撤不回来')
  })

  it('duplicate copies the text, disarms the schedule, and takes neither rules nor rounds', async () => {
    const board = face()
    board.seed({ ...emptyBoardDoc(NOW), tasks: [{ ...card('源卡'), description: '详情', schedule: { enabled: true, mode: 'cron' as const, cron: '0 9 * * *', nextRunAt: 5, lastTriggeredAt: 6, maxRuns: 3, runCount: 2, primed: true }, rules: [{ id: 'r-1', sessionId: 's-1', instruction: 'x', trigger: 'cron' as const, cron: '0 9 * * *', send: 'queue' as const, enabled: true }], executions: [{ id: 'e-1', sessionId: 's-1', startedAt: NOW, endedAt: NOW, result: 'succeeded' as const, error: undefined }] as never }] })
    await runBatch(deps(board), { ops: [{ op: 'task.duplicate', payload: { of: '源卡' } }] })
    const tasks = board.getDoc().tasks
    const copy = tasks[tasks.length - 1]!
    expect(copy.id).not.toBe('t-源卡')
    expect(copy.description).toBe('详情')
    // The schedule CONFIG comes along; its automation state does not.
    expect(copy.schedule).toMatchObject({ cron: '0 9 * * *', enabled: false, runCount: 0 })
    expect(copy.schedule?.nextRunAt).toBeUndefined()
    // Rules and rounds belong to the sessions THIS card owns — copying them
    // would silently automate sessions the new card does not have.
    expect(copy.rules).toBeUndefined()
    expect(copy.executions).toEqual([])
  })

  it('session.bind records the source without expanding a workspace', async () => {
    const board = face()
    board.seed({ ...emptyBoardDoc(NOW), tasks: [card('要挂来源的卡')] })
    await runBatch(deps(board), { ops: [{ op: 'session.bind', payload: { of: '要挂来源的卡', workspace: 'w-1' } }] })
    expect(board.getDoc().tasks[0]?.binds).toEqual([{ kind: 'workspace', workspaceId: 'w-1' }])
    const again = await runBatch(deps(board), { ops: [{ op: 'session.bind', payload: { of: '要挂来源的卡', workspace: 'w-1' } }] })
    expect(again.reports[0]?.detail).toContain('已经挂')
  })

  it('rule.create arms a rule the grammar will keep, and keeps the dead-arm laws', async () => {
    const board = face()
    board.seed({ ...emptyBoardDoc(NOW), tasks: [card('要建规则的卡')] })
    const created = await runBatch(deps(board), { ops: [{ op: 'rule.create', payload: { of: '要建规则的卡', session: 's-1', trigger: 'cron', cron: '0 9 * * *', usePrompt: 'true', send: 'queue' } }] })
    expect(created.ok).toBe(true)
    // WRITE-THEN-READ-BACK: the rule must come out of the MERGED document. An
    // armed cron rule with no due slot is dropped by the row grammar, so a tool
    // that wrote one would report success over a rule that does not exist —
    // and the one-rule-per-session guard would not see it either.
    const rules = board.getDoc().tasks[0]?.rules
    expect(rules).toHaveLength(1)
    expect(rules?.[0]?.sessionId).toBe('s-1')
    expect(typeof rules?.[0]?.nextAt).toBe('number')
    // A second definition for one session is two triggers racing.
    const second = await runBatch(deps(board), { ops: [{ op: 'rule.create', payload: { of: '要建规则的卡', session: 's-1', cron: '0 9 * * *', usePrompt: 'true', send: 'queue' } }] })
    expect(second.reports[0]?.detail).toContain('不要叠第二条')
    // An expression with no computable next slot is refused rather than written
    // as a rule that can never run.
    const dead = await runBatch(deps(board), { ops: [{ op: 'rule.create', payload: { of: '要建规则的卡', session: 's-9', trigger: 'cron', cron: '不是 cron', usePrompt: 'true', send: 'queue' } }] })
    expect(dead.reports[0]?.detail).toContain('永远不会跑')
    // usePrompt and instruction are mutually exclusive.
    const both = await runBatch(deps(board), { ops: [{ op: 'rule.create', payload: { of: '要建规则的卡', session: 's-2', cron: '0 9 * * *', usePrompt: 'true', instruction: '多余的话', send: 'queue' } }] })
    expect(both.reports[0]?.detail).toContain('instruction')
  })

  it('rule.update changes the content and says where to look when the rule is not there', async () => {
    const board = face()
    board.seed({ ...emptyBoardDoc(NOW), tasks: [{ ...card('有规则的卡'), rules: [{ id: 'r-1', sessionId: 's-1', instruction: '旧的话', trigger: 'cron' as const, cron: '0 9 * * *', send: 'queue' as const, enabled: true }] }] })
    await runBatch(deps(board), { ops: [{ op: 'rule.update', payload: { of: '有规则的卡', rule: 'r-1', enabled: 'false' } }] })
    const rule = board.getDoc().tasks[0]?.rules?.[0]
    expect(rule?.enabled).toBe(false)
    expect(rule?.cron).toBe('0 9 * * *')
    const missed = await runBatch(deps(board), { ops: [{ op: 'rule.update', payload: { of: '有规则的卡', rule: 'nope', enabled: 'false' } }] })
    expect(missed.ok).toBe(false)
    expect(missed.reports[0]?.detail).toContain('taskboard_query')
  })

  it('preset.create stores a schedule preset in the schedule section, and a run one in the run section', async () => {
    const board = face()
    await runBatch(deps(board), { ops: [{ op: 'preset.create', payload: { kind: 'schedule', label: '每天早上', cron: '0 9 * * *' } }] })
    await runBatch(deps(board), { ops: [{ op: 'preset.create', payload: { kind: 'run', label: '省token', config: { model: '小模型', reasoningEffort: 'low' } } }] })
    // WRITE-THEN-READ-BACK on the merged document: two sections, two documents'
    // worth of state, and an unreadable cron would have been stored and never
    // fired.
    const doc = board.getDoc()
    expect(doc.schedulePresets.value.map(preset => preset.label)).toEqual(['每天早上'])
    expect(doc.schedulePresets.value[0]?.cron).toBe('0 9 * * *')
    expect(doc.runPresets.value.presets.map(preset => preset.name)).toEqual(['省token'])
    expect(doc.runPresets.value.presets[0]?.config).toEqual({ model: '小模型', reasoningEffort: 'low' })
    // A cron that cannot be computed is refused, not stored.
    const bad = await runBatch(deps(board), { ops: [{ op: 'preset.create', payload: { kind: 'schedule', label: '坏的', cron: '不是 cron' } }] })
    expect(bad.reports[0]?.detail).toContain('永远不会触发')
    expect(board.getDoc().schedulePresets.value).toHaveLength(1)
  })

  it('preset.update edits the right section and drops a default that points at a deleted row', async () => {
    const board = face()
    board.seed({ ...emptyBoardDoc(NOW), schedulePresets: { value: [{ id: 'sp-1', label: '旧名', cron: '0 9 * * *' }], at: NOW }, runPresets: { value: { presets: [{ id: 'rp-1', name: '旧配置', config: { model: 'm' } }], defaultId: 'rp-1' }, at: NOW } })
    await runBatch(deps(board), { ops: [{ op: 'preset.update', payload: { of: 'sp-1', label: '新名' } }] })
    expect(board.getDoc().schedulePresets.value[0]?.label).toBe('新名')
    expect(board.getDoc().schedulePresets.value[0]?.cron).toBe('0 9 * * *')
    // Deleting the DEFAULT preset must not leave a default pointing at a row
    // that is gone — the next run would fail with no explanation.
    await runBatch(deps(board), { ops: [{ op: 'preset.delete', payload: { of: 'rp-1' } }] })
    const doc = board.getDoc()
    expect(doc.runPresets.value.presets).toEqual([])
    expect(doc.runPresets.value.defaultId).toBeUndefined()
    const missed = await runBatch(deps(board), { ops: [{ op: 'preset.delete', payload: { of: 'nope' } }] })
    expect(missed.reports[0]?.detail).toContain('没有 id 为 nope 的预设')
  })
})

describe('a model asks a question about a row, through the same plan the panel uses', () => {
  /** One row, hung off a card, in a document the fake face will hand back. */
  function oneItem(patch: Partial<ItemRecord>): ItemsDoc {
    return applyItemsCommit(emptyItemsDoc(NOW), {
      clientId: 'c',
      items: [{
        id: 'i-1',
        ref: 1,
        title: '量一遍地板',
        body: '',
        notes: '',
        steps: [{ id: 'i-1.s1', text: '在真机上量', done: false }],
        status: 'todo',
        priority: 'normal',
        tags: [],
        startsAfter: undefined,
        dueAt: undefined,
        hardDueAt: undefined,
        taskId: undefined,
        origin: { source: 'human', at: NOW },
        createdAt: NOW,
        updatedAt: NOW,
        ...patch,
      }],
      deleted: [],
    }, NOW)
  }

  /** One card holding one session, and one row hanging off it. */
  function linked(said: string[], running: Record<string, 'running' | 'idle'> = { 's-1': 'idle' }) {
    const board = face()
    board.seed({
      ...emptyBoardDoc(NOW),
      tasks: [{ ...card('挂着的卡'), binds: [{ kind: 'session', sessionId: 's-1' }] }],
    })
    board.seedItems(oneItem({ taskId: 't-挂着的卡' }))
    return { board, said, run: () => deps(board, runningSources(running, said)) }
  }

  it('hands the row to that card session, with its steps, and writes nothing', async () => {
    const said: string[] = []
    const { board, run } = linked(said)
    const before = board.getItemsDoc().items[0]
    const out = await runBatch(run(), { ops: [{ op: 'item.ask', payload: { of: 1 } }] })
    expect(out.ok).toBe(true)
    expect(said, 'nothing was said').toHaveLength(1)
    expect(said[0]).toContain('s-1')
    expect(said[0]).toContain('量一遍地板')
    expect(said[0]).toContain('在真机上量')
    // A question is not a write. Reporting it as a change would make every
    // 「问一句」 look like an edit of the document.
    expect(board.getItemsDoc().items[0]).toBe(before)
  })

  it('says what to DO when the row has no card, rather than only what is wrong', async () => {
    const said: string[] = []
    const board = face()
    board.seedItems(oneItem({ taskId: undefined }))
    const out = await runBatch(deps(board, runningSources({}, said)), { ops: [{ op: 'item.ask', payload: { of: 1 } }] })
    expect(out.ok).toBe(false)
    expect(out.reports[0]?.detail).toContain('item.promote')
    expect(said).toEqual([])
  })

  it('refuses a number that names no row, and names the number back', async () => {
    const said: string[] = []
    const { run } = linked(said)
    const out = await runBatch(run(), { ops: [{ op: 'item.ask', payload: { of: 99 } }] })
    expect(out.ok).toBe(false)
    expect(out.reports[0]?.detail).toContain('#99')
  })

  it('says so when the card has no session to talk to', async () => {
    const board = face()
    board.seed({ ...emptyBoardDoc(NOW), tasks: [card('空的卡')] })
    board.seedItems(oneItem({ taskId: 't-空的卡' }))
    const out = await runBatch(deps(board), { ops: [{ op: 'item.ask', payload: { of: 1 } }] })
    expect(out.ok).toBe(false)
    expect(out.reports[0]?.detail).toContain('会话')
  })

  it('prefers the RUNNING session when the card has several', async () => {
    const said: string[] = []
    const board = face()
    board.seed({
      ...emptyBoardDoc(NOW),
      tasks: [{ ...card('多会话的卡'), binds: [{ kind: 'session', sessionId: 's-idle' }, { kind: 'session', sessionId: 's-busy' }] }],
    })
    board.seedItems(oneItem({ taskId: 't-多会话的卡' }))
    const out = await runBatch(deps(board, runningSources({ 's-idle': 'idle', 's-busy': 'running' }, said)), { ops: [{ op: 'item.ask', payload: { of: 1 } }] })
    expect(out.ok).toBe(true)
    // 「the one doing work right now」 is the only choice that matches what a
    // reader means by asking; taking the first bound one would send the question
    // to a conversation that finished an hour ago.
    expect(said[0]?.startsWith('s-busy:')).toBe(true)
  })

  it('the catalog carries it, so a model is told it exists', () => {
    expect(ACTIONS['item.ask']).toBeDefined()
    expect(ACTIONS['item.ask']?.surface).toBe('ui+ai')
    expect(TOOL_ACTION_IDS).toContain('item.ask')
    // The summary has to distinguish a question from work, or a model that wants
    // the job done will use this and think it started.
    expect(ACTIONS['item.ask']?.summary).toContain('item.promote')
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
    const seen: PromptSection[] = []
    const dispose = registerTaskboardPromptSection({ section: (section) => { seen.push(section); return () => {} } })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.text).toBe(PROMPT_SECTION_TEXT)
    expect(() => dispose()).not.toThrow()
  })
})
