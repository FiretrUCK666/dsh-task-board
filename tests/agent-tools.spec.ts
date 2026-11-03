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
import { fileURLToPath } from 'node:url'
import { RUN_CONFIG_DEFAULTED, RUN_CONFIG_KEYS, RUN_CONFIG_MUST_ASK } from '../src/core/run-presets.ts'
import { ACTIONS, TOOL_ACTION_IDS } from '../src/core/board-actions.ts'
import { emptyBoardDoc, applyCommit, type BoardCommand, type BoardDoc } from '../src/core/board-doc.ts'
import { emptyItemsDoc, applyItemsCommit, deletedItemsOf, purgeItemTombstone, type ItemsDoc } from '../src/core/items-doc.ts'
import type { ItemRecord } from '../src/core/item.ts'
// The shared constructor, for the one assertion that the INTERFACE's behaviour is
// unchanged by the model's door: the capture sheet still saves a contradictory
// row on purpose, and only the model is refused.
import { captureItemRecord } from '../src/core/item-transitions.ts'
// The vocabulary bridge's built-in half, for the end-to-end cases that prove a
// Chinese column label lands in the document as the stored enum member.
import { builtinCandidatesOf, namesOfCandidates, resolveValue } from '../src/core/resolve.ts'
import { QUALIFIER_KEYS } from '../src/core/task-search.ts'
import { itemQualifierVocabulary } from '../src/core/item-query.ts'
import {
  capabilityView,
  clearIdempotentReplies,
  createTaskboardTools,
  enginePendingOf,
  enumeratedFilters,
  firstFailureOf,
  kindOfReport,
  refuseOp,
  runBatch,
  type OpReport,
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
    submitCommand: () => ({ status: 'broadcast' }),
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
function deps(
  board: ToolCommitFace | undefined = face(),
  sources: ToolDeps['sources'] = runningSources({}),
  /** Optional `sessionId → title`, so a test can prove the deep read NAMES the
   *  sessions it hands over. Absent = this host cannot name any, which is the
   *  honest shape of a host without a session registry. */
  sessionTitles?: Readonly<Record<string, string>>,
): ToolDeps {
  return {
    board: () => board,
    posture: async (sessionId: string) => ({
      sessionId, running: { value: false }, archived: { value: false },
      awaitingApproval: { value: false }, awaitingAnswer: { value: false },
      ...sessionTitles?.[sessionId] === undefined ? {} : { title: sessionTitles[sessionId] },
    } as never),
    sources,
    now: () => NOW,
    uuid: () => `id-${++seq}`,
  }
}

/**
 * A deps face that CAN name workspaces, for the one filter that reads a name.
 *
 * `ToolDeps.workspaceTitle` was declared, documented and never wired — so `ws:`,
 * an advertised filter value, could not match a card at all. Two tests below need
 * a host that really knows the names, and one needs the absence to stay honest.
 * @param titles - `workspaceId → displayed name`.
 * @param board - the commit face, when a test needs its own.
 * @returns deps carrying the lookup.
 */
function depsWithWorkspaces(
  titles: Readonly<Record<string, string>>,
  board: ToolCommitFace = face(),
): ToolDeps {
  return { ...deps(board), workspaceTitle: (id: string) => titles[id] ?? id }
}

function toolNamed(name: string): ToolDefinition {
  const tool = createTaskboardTools(deps()).find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`no tool named ${name}`)
  return tool
}

/** Run the read tool and return the value it hands the model. */
async function query(
  args: Record<string, unknown>,
  board = face(),
  sessionTitles?: Readonly<Record<string, string>>,
  /** A deps face to use instead of the default one, for the queries that depend
   *  on a host capability (naming a workspace) rather than on the board. */
  override?: (board: ToolCommitFace) => ToolDeps,
): Promise<Record<string, unknown>> {
  const built = override === undefined ? deps(board, runningSources({}), sessionTitles) : override(board)
  const tool = createTaskboardTools(built).find(candidate => candidate.name === 'taskboard_query')
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

/**
 * The capabilities text the model reads, rendered exactly as the tool renders it.
 *
 * FULL, not the compact default: the default answer carries the action names and
 * their one-line summaries and NO parameters (that is what makes the common call
 * cheap), so a test asking about parameters has to ask about one action, which is
 * what a caller does too.
 * @param topic - a domain or an action id. `'task.create'` is the usual one here.
 */
function renderCapabilities(topic?: string): string {
  const tool = createTaskboardTools(deps()).find(candidate => candidate.name === 'taskboard_capabilities')
  if (tool === undefined) throw new Error('no taskboard_capabilities')
  const rendered = tool.output.render({ topic }, capabilityView(topic) as never)
  return rendered.map(block => (block.type === 'text' ? block.text : '')).join('\n')
}

/** A row carrying something in every field the read side can be asked for. */
function richItem(): ItemRecord {
  return {
    id: 'i-rich', ref: 7, title: 'A note', body: 'the body', attachments: [], notes: 'the notes',
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
    /* THE SECOND READ DEFECT, restated for the one-vocabulary law. Reporting the STORED
       status while the filter answers a DERIVED one puts a row hanging off a running
       card in two places at once: filtered into 「进行中」 and printed 「待办」. The two
       readings must be the same word.

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
    // The link prints the card's NAME, not its uuid: the uuid is an identifier
    // the model can neither remember nor say back, and the same field is what
    // `item.update` accepts — so the value shown is the value expected back.
    expect(detailed.items[0]?.taskId).toBe('live')
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

  it('a list that EXACTLY fills the limit is not called truncated', async () => {
    /* 「还有更多」 is a measurement, not a comparison with the cap.
     *
     * The old rule was `rows.length >= limit`, which reports 「还有更多」 on a board
     * that holds exactly `limit` rows — the whole answer is in hand and the flag
     * still says the caller is missing something. Its next move is to narrow a
     * filter that did not need narrowing, and after two of those it learns the
     * flag is noise. */
    const box = face()
    box.seedItems(applyItemsCommit(box.items, {
      clientId: 'test', items: [richItem(), { ...richItem(), id: 'i-2', ref: 8 }], deleted: [],
    }, NOW))
    const exact = await query({ detail: 'full', limit: 2 }, box)
    expect(exact.items, 'the fixture is two rows and the cap is two').toHaveLength(2)
    expect(exact.truncated, 'a complete answer was reported as incomplete').toBe(false)
    // One fewer is genuinely truncated, so the flag is not simply always false.
    expect((await query({ detail: 'full', limit: 1 }, box)).truncated).toBe(true)
  })
})

/**
 * `of` answers for BOTH documents.
 *
 * The description has always promised 「一张卡的名字或它的短编号（清单条目用 #12）」
 * while the implementation only ever asked `resolveCard`. The cost is exact: a
 * receipt hands the model `#54`, the model asks about `#54`, and the surface
 * answers 「看板上没有叫「#54」的卡」 — telling it the row it just created does not
 * exist.
 */
/**
 * `ws:` COULD NOT MATCH ANYTHING.
 *
 * `matchQualifier` reads `facets.workspaceTitle ?? ''`, and the host never
 * supplied the face — `ToolDeps.workspaceTitle` was declared, documented, and
 * unwired. So the qualifier compared against the empty string and every card
 * failed it: a documented filter that silently matches nothing, which the caller
 * cannot distinguish from 「there are none」.
 */
describe('a workspace can be named, so `ws:` filters and cards report one', () => {
  const titled = (board: ToolCommitFace) => depsWithWorkspaces({ 'ws-1': 'DeepSeek default', 'ws-2': 'EnvProxy' }, board)

  it('matches the cards in a workspace by the name a person reads', async () => {
    const box = face()
    box.seed({
      ...emptyBoardDoc(NOW),
      tasks: [{ ...card('在默认工作区'), workspaceId: 'ws-1' }, { ...card('在代理工作区'), workspaceId: 'ws-2' }],
    })
    const answer = await query({ filter: 'ws:"DeepSeek default"' }, box, undefined, titled) as { tasks: { title: string }[] }
    const titles = answer.tasks.map(row => row.title)
    expect(titles, '`ws:` matched nothing, which is what an unwired face always did').toContain('在默认工作区')
    expect(titles).not.toContain('在代理工作区')
  })

  it('matches case-insensitively, the way the qualifier always promised', async () => {
    const box = face()
    box.seed({ ...emptyBoardDoc(NOW), tasks: [{ ...card('在默认工作区'), workspaceId: 'ws-1' }] })
    const answer = await query({ filter: 'ws:"deepseek DEFAULT"' }, box, undefined, titled) as { tasks: unknown[] }
    expect(answer.tasks).toHaveLength(1)
  })

  it('does NOT fold the workspace name into the free-text haystack', async () => {
    // The workspace is reached through `ws:` and nowhere else. Folding it into the
    // haystack would make a bare `deepseek` match every card in that workspace,
    // which is a different question from 「this card mentions deepseek」 — and the
    // two would then be impossible to tell apart.
    const box = face()
    box.seed({ ...emptyBoardDoc(NOW), tasks: [{ ...card('在默认工作区'), workspaceId: 'ws-1' }] })
    const hit = await query({ filter: 'deepseek' }, box, undefined, titled) as { tasks: unknown[] }
    expect(hit.tasks, 'a bare word matched on the workspace name').toHaveLength(0)
    // The qualifier is the door, and it works.
    const viaQualifier = await query({ filter: 'ws:"DeepSeek default"' }, box, undefined, titled) as { tasks: unknown[] }
    expect(viaQualifier.tasks).toHaveLength(1)
  })

  it('keeps `ws:` unavailable — not silently empty — when the host cannot name workspaces', async () => {
    // An absent face is the honest degradation the declaration describes: the
    // qualifier must not start claiming matches out of a name nobody provided.
    const box = face()
    box.seed({ ...emptyBoardDoc(NOW), tasks: [{ ...card('在默认工作区'), workspaceId: 'ws-1' }] })
    const answer = await query({ filter: 'ws:"DeepSeek default"' }, box) as { tasks: unknown[] }
    expect(answer.tasks).toHaveLength(0)
  })
})

describe('the read tool answers a short number, and refuses in a shape the schema accepts', () => {
  const seeded = () => {
    const box = face()
    box.seedItems(applyItemsCommit(box.items, {
      clientId: 'test',
      items: [{ ...richItem(), ref: 54, title: '用编号查的我' }],
      deleted: [],
    }, NOW))
    return box
  }

  it('reads a checklist row by the short number a receipt hands out', async () => {
    const box = seeded()
    for (const of of ['#54', '54']) {
      const answer = await query({ of }, box) as { ok: boolean; items: { ref: string; title: string }[]; tasks: unknown[] }
      expect(answer.ok, `of: ${of} was refused`).toBe(true)
      expect(answer.items, `of: ${of} did not resolve to the row`).toHaveLength(1)
      expect(answer.items[0]?.ref).toBe('#54')
      expect(answer.items[0]?.title).toBe('用编号查的我')
    }
  })

  it('says which numbers DO exist instead of claiming the row is a missing card', async () => {
    // The old answer was 「看板上没有叫「#99」的卡」, which is doubly wrong: it is the
    // wrong document and it withholds the list the caller needs to correct itself.
    const box = seeded()
    const answer = await query({ of: '#99' }, box) as { ok: boolean; detail: string }
    expect(answer.ok).toBe(false)
    expect(answer.detail).toContain('清单里没有 #99')
    expect(answer.detail, 'the refusal does not list what exists').toContain('#54')
  })

  it('refuses a missing card in a SCHEMA-COMPLETE shape, so the sentence survives', async () => {
    /* THE ERROR PATH VIOLATED ITS OWN CONTRACT: the output schema requires
     * `ok/filter/detail/tasks/items`, every refusal returned `{ ok, detail }`, and
     * the host's validator therefore rejected the answer — 「missing required
     * property "value.filter"」. A model asking about a row that does not exist got
     * a tool ERROR instead of the correction written for it. */
    const box = seeded()
    for (const of of ['不存在的卡', '#99']) {
      const answer = await query({ of }, box) as Record<string, unknown>
      expect(answer.ok).toBe(false)
      for (const field of ['filter', 'detail', 'tasks', 'items'] as const) {
        expect(answer, `a refusal dropped the required field ${field}`).toHaveProperty(field)
      }
      expect(Array.isArray(answer.tasks)).toBe(true)
      expect(Array.isArray(answer.items)).toBe(true)
      expect(lossless(answer), 'the refusal itself is not lossless JSON').toBe(true)
    }
  })

  it('keeps `#54` meaning the TAG in a filter, not the ref', async () => {
    // Two grammars starting with `#` is the collision `verify-address-grammar`
    // exists to keep separate: `of` reads an ADDRESS, the search box reads the
    // reader's own TAG. Teaching the filter to read a ref would make `#54` mean
    // one thing in one parameter and another in the next.
    const box = seeded()
    const answer = await query({ filter: '#54' }, box) as { items: unknown[] }
    expect(answer.items, 'the filter matched the ref, so `#54` now means two things').toHaveLength(0)
  })
})

describe('the deep read hands over what the model may write', () => {
  it('reads a card whole: run config, schedule, rules, sessions, and its rows', async () => {
    /* THE DEFECT THIS CLOSES, stated as a test: the write surface was larger than
     * the read surface. `rule.create` requires a session id and NO query returned
     * one, so 「给这张卡加一条规则」 could only be done by guessing. */
    const box = face()
    box.seed({
      ...emptyBoardDoc(NOW),
      tasks: [{
        ...card('深读的卡'),
        id: 'card-deep',
        provider: 'p',
        model: 'm',
        schedule: { mode: 'cron', cron: '0 9 * * *', enabled: true, maxRuns: 3, runCount: 1 } as never,
        rules: [{
          id: 'rule-1', sessionId: 's-1', instruction: '', usePrompt: true,
          trigger: 'on-complete', cron: '', send: 'steer', enabled: true,
        }] as never,
        binds: [{ kind: 'session', sessionId: 's-1' }],
        executions: [{ id: 'r-1', sessionId: 's-1', startedAt: NOW, endedAt: NOW, result: 'succeeded', error: undefined, comment: '' }] as never,
      }],
    })
    const answer = await query({ of: '深读的卡' }, box, { 's-1': '第一条会话' }) as {
      ok: boolean
      detail: string
      tasks: {
        runConfig: Record<string, string>
        schedule?: { mode: string; cron: string; enabled: boolean }
        rules?: { session: string; trigger: string; send: string; sends: string }[]
        binds?: string[]
        sessions?: { session: string; title: string | null; rounds: number }[]
      }[]
    }
    expect(answer.ok).toBe(true)
    expect(answer.detail).toBe('deep')
    const deep = answer.tasks[0]
    expect(deep?.runConfig, 'the run config the model may SET was not readable').toEqual({ provider: 'p', model: 'm' })
    expect(deep?.schedule).toEqual({ mode: 'cron', cron: '0 9 * * *', enabled: true, maxRuns: 3, runCount: 1 })
    // The rule carries the SESSION ID (what rule.create takes) and what it sends.
    expect(deep?.rules?.[0]).toMatchObject({ session: 's-1', trigger: 'on-complete', send: 'steer', sends: '这张卡自己的执行 Prompt' })
    expect(deep?.binds).toEqual(['会话：第一条会话'])
    expect(deep?.sessions?.[0]).toMatchObject({ session: 's-1', title: '第一条会话', rounds: 1 })
  })

  it('refuses a title two cards share, and names both', async () => {
    /* The old lookup was `find(t => t.title === of)` — it picked the first, moved
     * one of the two, said 「已生效」, and nothing mentioned there had been two. A
     * wrong answer that looks like a right one. */
    const box = face()
    box.seed({
      ...emptyBoardDoc(NOW),
      tasks: [{ ...card('收尾'), id: 'a' }, { ...card('收尾'), id: 'b' }],
    })
    const answer = await query({ of: '收尾' }, box) as { ok: boolean; detail: string }
    expect(answer.ok).toBe(false)
    expect(answer.detail).toContain('有 2 张卡都叫「收尾」')
    // And the unique case still works, or the refusal would just be a wall.
    box.seed({ ...emptyBoardDoc(NOW), tasks: [{ ...card('唯一'), id: 'c' }] })
    expect((await query({ of: '唯一' }, box) as { ok: boolean }).ok).toBe(true)
  })

  it('returns comments in FULL and only when asked, because they are the person&#39;s own words', async () => {
    const box = face()
    const long = '这是一条很长的评论，'.repeat(40)
    box.seed({
      ...emptyBoardDoc(NOW),
      tasks: [{
        ...card('有评论的卡'),
        id: 'card-c',
        executions: [{ id: 'r-1', sessionId: 's-1', startedAt: NOW, endedAt: NOW, result: 'succeeded', error: undefined, comment: long }] as never,
      }],
    })
    // Default: the words are NOT there. They are not secret — they are the
    // person's own writing, and dragging them into every 「看一下板」 makes their
    // own words the most expensive thing in the context.
    const plain = await query({ of: '有评论的卡' }, box) as { comments?: unknown }
    expect(plain.comments).toBeUndefined()
    const asked = await query({ of: '有评论的卡', include: ['comments'] }, box) as {
      comments?: { session: string; rounds: { text: string }[] }[]
    }
    // FULL, not a summary: the product requirement is that the whole comment and
    // its whole context are readable.
    expect(asked.comments?.[0]?.rounds[0]?.text).toBe(long)
  })

  it('an unlinked checklist row answers instead of failing the whole read', async () => {
    /* `taskId: undefined` in a row literal made the host's lossless-JSON check
     * reject the ENTIRE answer — not one wrong row, the whole query. A board with
     * one unlinked note was a board that could not be read at all. */
    const box = face()
    box.seedItems(applyItemsCommit(box.items, {
      clientId: 'test', items: [richItem()], deleted: [],
    }, NOW))
    const answer = await query({ detail: 'full' }, box) as { ok: boolean; items: { taskId?: string }[] }
    expect(answer.ok).toBe(true)
    expect(answer.items).toHaveLength(1)
    // Absent, not undefined: the field must not exist at all.
    expect('taskId' in (answer.items[0] ?? {})).toBe(false)
    // The whole answer survives the host's own rule — which is DEEP EQUALITY
    // after a round trip, not "serialisation does not throw".
    expect(lossless(answer)).toBe(true)
  })
})

/**
 * The host's own rule, applied the way the host applies it.
 *
 * `JSON.stringify` cannot tell `{ a: undefined }` from `{}`, so
 * `JSON.parse(JSON.stringify(x))` never throws on an undefined field — an
 * assertion written that way passes on exactly the value the pipeline REJECTS.
 * That is how a nested `undefined` in one row took out every scheduled card's
 * read with a green suite.
 *
 * The rule is that the value survives a round trip UNCHANGED, so the assertion
 * has to be a deep equality against the round-tripped copy.
 * @param value - what a tool returned.
 * @returns whether it is lossless JSON.
 */
function lossless(value: unknown): boolean {
  const round = JSON.parse(JSON.stringify(value)) as unknown
  return deepEqualJson(value, round)
}

/** Structural equality over plain JSON values (objects, arrays, scalars). */
function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, index) => deepEqualJson(entry, b[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => key in right && deepEqualJson(left[key], right[key]))
}

/**
 * EVERY NESTED OBJECT a deep read can carry, each of which can hide one undefined.
 *
 * The original defect was one field (`maxRuns`) inside one nested object
 * (`schedule`); the same shape exists in `rules`, `binds`, `sessions`, `runConfig`
 * and the item rows' optionals. One case per family, because "the row that broke"
 * and "the family it belongs to" are different claims and only the second one
 * keeps the next field from repeating it.
 */
describe('a deep read is lossless for every nested object it can carry', () => {
  it('carries a scheduled card whose optional fields are absent', async () => {
    const box = face()
    box.seed({
      ...emptyBoardDoc(NOW),
      tasks: [{
        ...card('带排期的卡'),
        id: 'card-sched',
        // A CHAIN schedule with no budget: `maxRuns` and `runCount` are both
        // undefined, which is the ordinary shape and the one that broke.
        schedule: { mode: 'chain', cron: '', nextRunAt: undefined, enabled: true, maxRuns: undefined, runCount: 0, lastTriggeredAt: undefined },
      } as never],
    })
    const answer = await query({ of: '带排期的卡' }, box)
    expect(lossless(answer), 'a scheduled card makes the whole answer lossy').toBe(true)
  })

  it('carries session rules, binds and related sessions together', async () => {
    const box = face()
    box.seed({
      ...emptyBoardDoc(NOW),
      tasks: [{
        ...card('挂着东西的卡'),
        id: 'card-rich',
        rules: [{
          id: 'rule-1', sessionId: 's-1', instruction: '', usePrompt: true,
          trigger: 'on-complete', cron: '', nextAt: undefined, send: 'queue', enabled: false,
        }],
        binds: [{ kind: 'workspace', workspaceId: 'ws-1' }],
      } as never],
    })
    const answer = await query({ of: '挂着东西的卡' }, box)
    expect(lossless(answer), 'rules/binds with absent optionals make the answer lossy').toBe(true)
  })

  it('carries a checklist row with no card, no dates and no steps', async () => {
    const box = face()
    box.seedItems(applyItemsCommit(box.items, {
      clientId: 'test', items: [richItem()], deleted: [],
    }, NOW))
    for (const detail of ['brief', 'full'] as const) {
      expect(lossless(await query({ detail }, box)), `detail: ${detail} is lossy`).toBe(true)
    }
  })

  it('carries an empty board without inventing fields', async () => {
    const box = face()
    expect(lossless(await query({ detail: 'deep' }, box))).toBe(true)
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
    // The case the whole-op sentence gets wrong: the board commit succeeded, the
    // items commit threw, and the report says 「没写进去」 about the WHOLE op —
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

  /**
   * THE SIX ARE NOT ONE KIND OF THING, so they no longer carry one sentence.
   *
   * All six used to say 「留空 = 不指定，由宿主按自己的默认链解析」 — and six of the
   * seven cards on this machine came out with no run configuration at all. A model
   * that reads instructions correctly drew the only available conclusion.
   *
   * The split is by CONSEQUENCE: a wrong workspace or permission is damage (it
   * lands files in the wrong directory, or destroys them), while a wrong model or
   * effort is a different flavour of the same work. One rule for six fields gets
   * four of them wrong in one direction or the other.
   */
  it('says what a wrong choice COSTS, not one sentence repeated six times', () => {
    const params = ACTIONS['task.create'].params
    for (const key of RUN_CONFIG_KEYS) {
      expect(params[key], `task.create no longer publishes ${key}`).toBeDefined()
    }
    // The two that can cause damage say so; the four that are a preference say a
    // default will be disclosed.
    for (const key of ['workspaceId', 'permission'] as const) {
      expect(params[key]?.appliesWhen, `${key} does not warn that a wrong value has consequences`)
        .toMatch(/跑|改坏|目录|危险/)
    }
    for (const key of ['provider', 'model', 'reasoningEffort', 'agentPreset'] as const) {
      // These four may take a default — but the default must be DISCLOSED, so the
      // sentence says the receipt will name the field as taking one. It must NOT
      // promise 「the receipt says what value was used」: the host's default is
      // resolved at run time and the receipt is built before any session exists,
      // so that promise could never be kept.
      expect(params[key]?.appliesWhen, `${key} does not say the default is disclosed`)
        .toMatch(/回执|宿主默认/)
      expect(params[key]?.appliesWhen, `${key} promises a value the receipt cannot know`)
        .not.toContain('实际用了什么')
    }
    // And the six are no longer one sentence: a table where every value is equal
    // is a table that has not been decided.
    const distinct = new Set(RUN_CONFIG_KEYS.map(key => params[key]?.appliesWhen))
    expect(distinct.size, 'the six absent-case sentences are still interchangeable').toBeGreaterThan(1)
  })

  it('names the two fields whose wrong value is damage, in one place', () => {
    // A LIST rather than a boolean per key: 「which of these must be asked」 has one
    // answer, and the catalog's own sentences describe the same two.
    expect([...RUN_CONFIG_MUST_ASK]).toEqual(['workspaceId', 'permission'])
    expect([...RUN_CONFIG_DEFAULTED].sort()).toEqual(
      RUN_CONFIG_KEYS.filter(key => !RUN_CONFIG_MUST_ASK.includes(key)).sort(),
    )
  })

  it('reports an UNDISCLOSED default instead of letting it pass silently', async () => {
    // The other half of the bargain: a default is acceptable, an undisclosed one is
    // not. A caller that leaves all six out gets a card that will run on choices
    // nobody made, so the receipt says which ones those are.
    const board = face()
    const made = await runBatch(deps(board), { ops: [{ op: 'task.create', payload: { title: '什么都没配', prompt: '跑一下' } }] })
    expect(made.ok).toBe(true)
    const detail = made.reports[0]?.detail ?? ''
    expect(detail, 'the receipt never mentions the run configuration').toContain('运行配置')
    expect(detail, 'an all-default card does not say it will run on host defaults').toContain('宿主默认')
    // The two that can cause damage are named, so the next turn can fix them.
    expect(detail).toContain('workspaceId')
    expect(detail).toContain('permission')
  })

  it('names what the caller DID choose, and what it left to the host', async () => {
    const board = face()
    const made = await runBatch(deps(board), {
      ops: [{ op: 'task.create', payload: { prompt: '跑一下', workspaceId: 'ws-9', model: 'm-1' } }],
    })
    expect(made.ok).toBe(true)
    const detail = made.reports[0]?.detail ?? ''
    // The chosen ones are reported with their values: the person can see what will
    // actually run, not just that something was set.
    expect(detail).toContain('workspaceId=ws-9')
    expect(detail).toContain('model=m-1')
    // And the remainder is named as the host's, not silently omitted.
    expect(detail).toContain('宿主默认')
  })

  it('says nothing about run configuration on a card that was not created', async () => {
    // The line is about a NEW card's configuration. Attaching it to every update
    // would be a paragraph about a decision the caller did not make.
    const board = face()
    await runBatch(deps(board), { ops: [{ op: 'task.create', payload: { prompt: 'p', title: '已存在的' } }] })
    const card = board.getDoc().tasks[0]
    const updated = await runBatch(deps(board), { ops: [{ op: 'task.update', payload: { of: String(card?.id), title: '改个名' } }] })
    expect(updated.reports[0]?.detail ?? '').not.toContain('运行配置')
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
    // Asked for by ACTION, which is how a caller asks: the compact default answer
    // carries no parameters at all (that is what makes the common call cheap).
    const create = capabilityView('task.create').actions[0]!
    expect(create.params.prompt.required).toBe(true)
    expect(create.params.title.required).toBe(false)
    // A conditional requirement is stated, never silently downgraded.
    const rule = capabilityView('rule.create').actions[0]!
    expect(rule.params.cron.required).toBe(false)
    expect(rule.params.cron.requiredWhen).toContain('cron')
    expect(rule.params.send.required).toBe(true)
  })

  /**
   * THE COST STRUCTURE, FIXED.
   *
   * The full answer is ~7,000 characters for 36 actions, and this tool is
   * documented as 「先查后做」 — so EVERY write began by paying for the whole
   * catalog a caller about to move one card did not need. These cases pin the
   * three sizes, because a narrowing that silently stopped narrowing would put
   * the cost straight back with nothing red.
   */
  it('answers the compact default without parameters, and says how to get more', () => {
    const compact = capabilityView()
    expect(compact.actions).toHaveLength(Object.keys(ACTIONS).length)
    // The NAMES are all there — this is a summary, not a subset.
    expect(compact.actions.map(action => action.id).sort()).toEqual(Object.keys(ACTIONS).sort())
    // The PARAMETERS are not: that is the whole saving.
    for (const action of compact.actions) expect(Object.keys(action.params)).toHaveLength(0)
    // And it says where to go next, so a caller that needs detail is not stuck.
    expect(compact.hint).toContain('topic')
    expect(compact.domains, 'the domains a caller can narrow to are not listed').toBeDefined()
  })

  it('narrows to one domain, in full', () => {
    // A DOMAIN is the document an action speaks about (`board` / `item` / `session`
    // / `preset`), which is NOT the action id's prefix — `task.create` belongs to
    // the `board` domain. Both spellings are accepted for exactly that reason:
    // asking by prefix is the intuitive move, and refusing it would be a turn spent
    // discovering a distinction nobody needs to know.
    const board = capabilityView('board')
    expect(board.scoped).toBe('board')
    expect(board.actions.length).toBeGreaterThan(1)
    expect(board.actions.every(action => action.id.startsWith('task.') || action.id.startsWith('board.'))).toBe(true)
    // Full means parameters came back — otherwise this is the compact answer again.
    expect(Object.keys(board.actions[0]?.params ?? {}).length).toBeGreaterThan(0)
  })

  it('accepts the id PREFIX as a topic too, because that is the intuitive ask', () => {
    // `task` is not a domain, but a caller asking for it means the task actions.
    const task = capabilityView('task')
    expect(task.actions.length).toBeGreaterThan(1)
    expect(task.actions.every(action => action.id.startsWith('task.'))).toBe(true)
  })

  it('narrows to one action, in full', () => {
    const one = capabilityView('task.create')
    expect(one.actions).toHaveLength(1)
    expect(one.actions[0]?.id).toBe('task.create')
    expect(one.actions[0]?.params.prompt).toBeDefined()
  })

  it('answers an unknown topic with the list of real ones instead of refusing', () => {
    // A refusal costs a turn and teaches nothing; the list is a next move.
    const wrong = capabilityView('tak.create')
    expect(wrong.actions).toHaveLength(0)
    expect(wrong.hint).toContain('task.create')
  })

  /**
   * THE LEGAL VALUES REACH THE MODEL, printed with the rule that enforces them.
   *
   * `renderParam` always carried `oneOf`; the template printed only `about`, so
   * the closed value set of every enum parameter was dropped on the way to the
   * model. What that cost is the whole defect this rebuild is about: the
   * description said `status` was 「五档之一：待规划 / 待办 / …」 (the reader's
   * words) while `checkParams` compared against `backlog/todo/…` (the stored
   * words), so a model that followed the description exactly was refused EVERY
   * time, by a message naming values the description had never shown it.
   */
  it('prints the legal values, so the description and the validator say one thing', () => {
    const rendered = renderCapabilities('item.update')
    // `item.update` is the action whose status enum the report was written about.
    expect(rendered, 'the capability answer never names the status values').toContain('可选：backlog / todo / running / review / done')
    // And the words the model reads must not pretend the Chinese labels are the
    // accepted values: the enum is what `checkParams` compares.
    expect(rendered).not.toContain('可选：待规划 / 待办 / 进行中')
  })

  it('prints the legal values for the other closed sets too, not only status', () => {
    // One case per shape family, so a fix that only covered `status` fails here:
    // an enum on a move, a two-value choice, a priority ladder. Each is asked for
    // by the action that carries it, which is how a caller asks too.
    expect(renderCapabilities('task.move'), 'task.move lost its target columns').toContain('可选：backlog / todo / done')
    expect(renderCapabilities('task.comment'), 'task.comment lost its queue/steer choice').toContain('可选：queue / steer')
    expect(renderCapabilities('item.update'), 'item.update lost its priority tiers').toContain('可选：low / normal / high / urgent')
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
    // **COMPARING THE DESCRIPTION AGAINST `QUALIFIER_KEYS` IS SELF-PROVING**: those
    // keys are what GENERATES that description, so the comparison can only ever say
    // 「描述与它自己的来源一致」. It sits green while the model is taught a vocabulary
    // that is half wrong: `taskboard_query`'s filter string is parsed by
    // `matchItemQuery` for the item list too, so a board-only key it teaches (`has:*`,
    // `is:*`) falls through there as **a free word that matches nothing, silently**,
    // while everything the list speaks goes unmentioned.
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
    // THE OTHER HALF, which keeps its force: the
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
    // The receipt must be decided from what
    // `board.commit()` returned, never from the tool's own DRAFT — and the merge
    // discards a write whose stamp
    // another device already passed. Deciding it from the draft reports 「已生效」 about a write
    // that did not happen, lists the row under 受影响的, and the model's next
    // turn is built on it. The fake here is the ONLY one that can produce it:
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
    const board = face({ submitCommand: () => ({ status: 'queued' }) } as Partial<ToolCommitFace>)
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

  it('item.update that does not mention the title keeps the row AND its title', async () => {
    // **这一条曾经是一个会丢行的洞。**
    //
    // 模型那条路把补丁拼成「每一个字段都写一遍」，没传的字段写成显式 `undefined`。
    // 补丁一拼开，那个 `undefined` 就盖住了行上原有的标题——而 `title: undefined`
    // 过不了形状门，于是**整行被文档文法丢掉**，回执却写着「已生效」。
    // 也就是说：**模型改一条清单，可能把那条改没了，并且报告成功。**
    const board = withItem({ title: '原来的标题' })
    const result = await runBatch(deps(board), { ops: [{ op: 'item.update', payload: { of: '#1', body: '新正文' } }] })
    expect(result.ok).toBe(true)
    const row = board.getItemsDoc().items[0]
    expect(row, 'the row is still there — an edit that mentions one field must not remove the row').toBeDefined()
    expect(row?.title, 'and the field nobody mentioned is untouched').toBe('原来的标题')
    expect(row?.body, 'while the field the model DID mention changed').toBe('新正文')
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

  it('a short number is read the SAME way by every action of the family', async () => {
    // **这一条曾经是两个答案。**
    //
    // 短号是**说出来**的：`# 12`（带一个空格）与 `#12` 是同一句话，而读它的
    // 地方曾经有十份拷贝——其中六份少了那一个 `.trim()`。后果不是报错，是
    // **同一个动作族给出两个答案**：`# 1` 在 item.restore / item.purge 找得到，
    // 在 item.update 找不到。
    //
    // 所以这里钉的是**一致性**，不是某一种写法：带空格、不带空格、纯数字，
    // 都要指到同一行。
    const spaced = await runBatch(deps(withItem()), { ops: [{ op: 'item.update', payload: { of: '# 1', body: '改过的' } }] })
    expect(spaced.ok, '「# 1」要能改到第 1 条').toBe(true)
    expect(spaced.reports[0]?.ok).toBe(true)

    const plain = await runBatch(deps(withItem()), { ops: [{ op: 'item.update', payload: { of: '#1', body: '改过的' } }] })
    expect(plain.ok).toBe(true)

    const bare = await runBatch(deps(withItem()), { ops: [{ op: 'item.update', payload: { of: '1', body: '改过的' } }] })
    expect(bare.ok, '「1」也是那一条').toBe(true)
  })

  it('item.restore reads a short number the same way item.update does', async () => {
    const board = withItem()
    await runBatch(deps(board), { ops: [{ op: 'item.delete', payload: { of: '# 1' } }] })
    expect(board.getItemsDoc().items, '「# 1」要能删掉第 1 条').toHaveLength(0)
    const back = await runBatch(deps(board), { ops: [{ op: 'item.restore', payload: { of: '# 1' } }] })
    expect(back.ok, '「# 1」要能找回第 1 条').toBe(true)
    expect(board.getItemsDoc().items.map(item => item.id)).toEqual(['i-1'])
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
    const board = face({ submitCommand: () => ({ status: 'queued' }) } as Partial<ToolCommitFace>)
    board.seed({ ...emptyBoardDoc(NOW), tasks: [{ id: 't-1', title: '跑一下', description: '', prompt: 'p', status: 'todo', order: 0, createdAt: NOW, updatedAt: NOW, executions: [] }] })
    const result = await runBatch(deps(board), { ops: [{ op: 'task.run', payload: { of: '跑一下' } }] })
    expect(result.enginePending).toEqual(['跑一下'])
    const meta = toolNamed('taskboard_execute').output.presentationMeta!({}, result as never) as Record<string, unknown>
    expect(meta.enginePending).toEqual(['跑一下'])
    expect(String(meta.summary)).toContain('引擎')
  })
})

describe('the receipt classifies itself by its fields, not by its own wording', () => {
  /**
   * THE DEFECT THIS PINS.
   *
   * The receipt used to decide its own kind by reading its own sentence:
   * `detail.startsWith('未执行')` said whether the op was skipped,
   * `detail.includes('已受理')` said whether the engine still had it, and
   * `detail.startsWith('这一条已经是这样了')` said whether anything changed.
   *
   * So rewording ONE sentence moved a `kind`, moved the 「第一个失败」 to
   * another op, and moved the summary's count — and **no functional test went
   * red**, because the wording was the only thing that changed. The facts were
   * always there as fields (`next.unchanged`, the service's `queued`); they
   * were dropped on the way into the report and guessed back out of prose.
   */
  const SAID = '未执行：上一条失败后本批停止。'
  const SAID_OTHER_WAY = '没有执行：上一条失败以后这一批就停了。'

  it('a reworded detail leaves the kind alone', () => {
    const skipped = { op: 'item.create', ok: false, skipped: true, detail: SAID }
    expect(kindOfReport(skipped)).toBe('skipped')
    // The same facts, said differently. The kind is a fact about the op, not
    // about the sentence.
    expect(kindOfReport({ ...skipped, detail: SAID_OTHER_WAY })).toBe('skipped')
  })

  it('a reworded detail leaves the first failure pointing at the same op', () => {
    const reports: OpReport[] = [
      { op: 'task.create', ok: true, kind: 'created', detail: '已生效。' },
      { op: 'item.create', ok: false, kind: 'failed', detail: '没写进去：磁盘满了。' },
      { op: 'item.update', ok: false, kind: 'skipped', skipped: true, detail: SAID },
    ]
    expect(firstFailureOf(reports)?.op).toBe('item.create')
    // The skipped op says the same thing in other words. The pointer must NOT
    // move to it: it never ran, so blaming it is blaming an op for something
    // that did not happen to it.
    const reworded = reports.map(report => report.op === 'item.update'
      ? { ...report, detail: SAID_OTHER_WAY }
      : report)
    expect(firstFailureOf(reworded)?.op).toBe('item.create')
  })

  it('a reworded detail leaves the engine-pending set alone', () => {
    const accepted: OpReport = {
      op: 'task.run',
      ok: true,
      kind: 'updated',
      title: '跑一下',
      outcome: { lane: 'engine', status: 'queued', carrier: 'run' },
      detail: '已受理（跑一遍），引擎当前不在线，将在引擎上线后执行。',
    }
    const handedOver: OpReport = {
      op: 'task.run',
      ok: true,
      kind: 'updated',
      title: '另一张卡',
      outcome: { lane: 'engine', status: 'broadcast', carrier: 'run' },
      detail: '已交给引擎跑一遍。',
    }
    expect(enginePendingOf([accepted, handedOver])).toEqual(['跑一下'])
    const reworded = [{
      ...accepted,
      detail: '引擎现在不在线，这一圈已经收下了，等它上线再跑。',
    }, handedOver]
    expect(enginePendingOf(reworded)).toEqual(['跑一下'])
  })

  it('the batch runner writes those fields, so the readers have something to read', async () => {
    const board = face()
    const result = await runBatch(deps(board), {
      ops: [
        { op: 'item.create', payload: { body: '第一条' } },
        { op: 'item.create', payload: {} },          // body is required → fails
        { op: 'item.create', payload: { body: '第三条' } },
      ],
    })
    expect(result.reports[0]?.skipped, 'a landed op is not skipped').toBeUndefined()
    expect(result.reports[2]?.skipped, 'the op after the failure never ran').toBe(true)
    expect(result.reports[2]?.kind).toBe('skipped')
    // And the summary points at the op that FAILED, not at the one that never ran.
    expect(result.summary).toContain('第 2 条失败')
  })

  it('a queued op says so in a field, so the summary can keep it out of the count', async () => {
    const board = face({ submitCommand: () => ({ status: 'queued' }) } as Partial<ToolCommitFace>)
    board.seed({ ...emptyBoardDoc(NOW), tasks: [{ id: 't-1', title: '跑一下', description: '', prompt: 'p', status: 'todo', order: 0, createdAt: NOW, updatedAt: NOW, executions: [] }] })
    const result = await runBatch(deps(board), { ops: [{ op: 'task.run', payload: { of: '跑一下' } }] })
    expect(result.reports[0]?.outcome, 'an accepted-but-unexecuted run says so in a field').toEqual({
      lane: 'engine',
      status: 'queued',
      carrier: 'run',
    })
    expect(result.enginePending).toEqual(['跑一下'])
    expect(result.summary).toContain('已受理')
  })

  it('an engine that cannot perform the carrier is reported as NOT EXECUTED, never as done', async () => {
    /* THE THIRD STATE, which the two-state vocabulary could not express.
     *
     * A live page whose build has no `session.create` branch received the frame
     * and dropped it; the caller was told the batch had landed. This pins the
     * receipt for that case: a field that says `unsupported`, a summary that
     * does NOT count it as an effect, and a sentence that says nothing happened.
     */
    const board = face({
      submitCommand: command => ({ status: 'unsupported', carrier: command.type }),
    } as Partial<ToolCommitFace>)
    board.seed({ ...emptyBoardDoc(NOW), tasks: [{ id: 't-1', title: '建会话', description: '', prompt: 'p', status: 'todo', order: 0, createdAt: NOW, updatedAt: NOW, executions: [] }] })
    const result = await runBatch(deps(board), { ops: [{ op: 'session.create', payload: { of: '建会话' } }] })
    expect(result.reports[0]?.outcome).toEqual({ lane: 'engine', status: 'unsupported', carrier: 'session.create' })
    expect(result.engineUnsupported).toEqual(['建会话'])
    // The two lists are different facts and neither may absorb the other.
    expect(result.enginePending).toEqual([])
    expect(result.summary).toContain('没有执行')
    expect(result.summary, 'a refused relay is not an effect').not.toContain('已生效')
  })

  it('the implementation never reads the detail sentence to classify a report', () => {
    // The structural half of the same promise. The three readers above are the
    // only places a kind, a first failure or a pending row is decided, and
    // they decide it from fields — so a sentence can be reworded freely.
    const source = readFileSync(join(process.cwd(), 'src', 'host', 'agent', 'tools.ts'), 'utf8')
    expect(
      source.match(/detail\.(?:startsWith|includes|endsWith|match)\s*\(/g),
      'a report is classified by reading its own wording — reword one sentence and the kind, '
      + 'the first failure and the summary all move, with every functional test still green',
    ).toBeNull()
  })
})

describe('the relay only carries what it can actually carry', () => {
  it('an engine action whose effect IS a run is relayed with no per-action code', async () => {
    const board = face()
    const relayed: string[] = []
    board.seed({ ...emptyBoardDoc(NOW), tasks: [card('跑一下')] })
    board.submitCommand = (command) => { relayed.push(command.type); return { status: 'queued' } }
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
    board.submitCommand = (command) => { relayed.push(command); return { status: 'queued' } }
    const renamed = await runBatch(deps(board), { ops: [{ op: 'session.rename', payload: { session: 's-1', title: '新名字' } }] })
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
    //
    // `send` is on the command because the CATALOG publishes it: absent means
    // queue, and the value travels so the engine does not have to guess which of
    // the two doors the caller meant. A command without it would make the
    // engine's choice the authority, which is exactly the 「用户开关定」 rule
    // this parameter replaced.
    const commented = await runBatch(deps(board), { ops: [{ op: 'task.comment', payload: { of: '要改名的卡', session: 's-1', text: '接着说' } }] })
    expect(commented.ok).toBe(true)
    expect(relayed[1]).toEqual({ type: 'comment', taskId: 't-要改名的卡', sessionId: 's-1', text: '接着说', clientId: 'model', send: 'queue' })
    // And the choice is READ, not just published: a caller that asks to steer
    // gets a steer.
    const steered = await runBatch(deps(board), { ops: [{ op: 'task.comment', payload: { of: '要改名的卡', session: 's-1', text: '插一句', send: 'steer' } }] })
    expect(steered.ok).toBe(true)
    expect(relayed[2]).toEqual({ type: 'comment', taskId: 't-要改名的卡', sessionId: 's-1', text: '插一句', clientId: 'model', send: 'steer' })
    // The receipt says WHICH one happened, because 「说进去了」 about a line still
    // waiting for the run to settle is the same lie as calling an accepted run a
    // finished one.
    expect(commented.reports[0]?.title).toContain('排队')
    expect(steered.reports[0]?.title).toContain('插话')
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

  /**
   * A KEY THE CATALOG DOES NOT HAVE IS REFUSED, NOT DROPPED.
   *
   * The required-parameter loop walked only the parameters the catalog DECLARES,
   * so a misspelled key was never examined by anything. `provider` typed as
   * `proivder` produced a card with no provider, a receipt saying 「已生效」, and no
   * sentence anywhere connecting the two — the model's next turn was built on
   * the belief that it had set something it had not.
   */
  it('refuses a misspelled parameter by name, and names the one that was meant', async () => {
    const board = face()
    const result = await runBatch(deps(board), {
      ops: [{ op: 'task.update', payload: { of: '要改的卡', proivder: 'opendesign' } }],
    })
    expect(result.ok).toBe(false)
    const detail = result.reports[0]?.detail ?? ''
    expect(detail, 'the typo was silently dropped').toContain('proivder')
    // The suggestion is what turns a refusal into one correction; without it the
    // caller is left trying spellings.
    expect(detail).toContain('provider')
    // And it must not go create the card anyway.
    expect(board.getDoc().tasks).toHaveLength(0)
  })

  it('lists the parameters the action really takes, so the correction is complete', async () => {
    // A refusal that only says 「不认识」 leaves the caller guessing at the whole
    // set; naming it is the difference between one retry and a search.
    const board = face()
    const result = await runBatch(deps(board), { ops: [{ op: 'task.create', payload: { prompt: 'x', titel: 'y' } }] })
    const detail = result.reports[0]?.detail ?? ''
    expect(detail).toContain('title')
    expect(detail, 'the refusal does not say what the action accepts').toContain('prompt')
  })

  it('judges the KEY before the VALUE, so a typo is not reported as a bad value', async () => {
    // `stauts: '进行中'` has two problems; the one the caller must fix first is the
    // key. Reporting 「status 只能是 …」 about it sends them to change a value that
    // was already going to be refused for a different reason.
    const board = face()
    const result = await runBatch(deps(board), {
      ops: [{ op: 'item.update', payload: { of: '#1', stauts: '进行中' } }],
    })
    const detail = result.reports[0]?.detail ?? ''
    expect(detail).toContain('stauts')
    expect(detail).not.toContain('只能是 backlog')
  })

  it('leaves a well-spelled payload alone, including the envelope keys', async () => {
    // The check must not fire on `op` (the catalog does not declare it) or on a
    // legal call, or every batch would be refused.
    const board = face()
    const ok = await runBatch(deps(board), { ops: [{ op: 'task.create', payload: { prompt: '写点什么' } }] })
    expect(ok.ok, 'a legal call was refused as an unknown key').toBe(true)
    expect(board.getDoc().tasks).toHaveLength(1)
  })
})

/**
 * THE DESCRIPTION AND THE VALIDATOR NOW SAY ONE THING.
 *
 * The measured defect: the catalog's `about` printed 「五档之一：待规划 / 待办 /
 * 进行中 / 待审核 / 已完成」 while `checkParams` compared against
 * `backlog/todo/running/review/done`. A model obeying the description was refused
 * EVERY time — and the refusal named values the description had never shown it.
 *
 * These cases are end-to-end on purpose: they assert the DOCUMENT holds the
 * stored value, not merely that the call was accepted. A gate that accepted
 * 进行中 and let it through unchanged would put a reader's word in a field typed
 * `TaskStatus`, which is a worse defect than refusing.
 */
describe('a value said in the reader\'s words is stored as the system\'s word', () => {
  /** deps carrying the resolver, built the way `register.ts` builds it. */
  const resolved = (board: ToolCommitFace): ToolDeps => ({
    ...deps(board),
    resolver: {
      resolve: (kind, value) => {
        const candidates = builtinCandidatesOf(kind)
        if (candidates.length === 0) return undefined
        const out = resolveValue(kind, value, { candidatesOf: () => candidates })
        return out.ok ? out.value : undefined
      },
      candidatesOf: kind => namesOfCandidates(builtinCandidatesOf(kind)),
    },
  })

  it('stores `running` when the caller says 进行中', async () => {
    const board = face()
    board.seedItems(applyItemsCommit(board.items, {
      clientId: 'test', items: [{ ...richItem(), ref: 41, status: 'todo' }], deleted: [],
    }, NOW))
    const result = await runBatch(resolved(board), {
      ops: [{ op: 'item.update', payload: { of: '#41', status: '进行中' } }],
    })
    expect(result.ok, 'the Chinese column label was refused — this is the defect itself').toBe(true)
    // THE DOCUMENT, not the receipt: the stored value must be the enum member.
    expect(board.getItemsDoc().items[0]?.status).toBe('running')
  })

  it('stores the tier when the caller says 紧急', async () => {
    const board = face()
    board.seedItems(applyItemsCommit(board.items, {
      clientId: 'test', items: [{ ...richItem(), ref: 42 }], deleted: [],
    }, NOW))
    const result = await runBatch(resolved(board), {
      ops: [{ op: 'item.update', payload: { of: '#42', priority: '紧急' } }],
    })
    expect(result.ok, 'the Chinese tier was refused').toBe(true)
    expect(board.getItemsDoc().items[0]?.priority).toBe('urgent')
  })

  it('still refuses a value nobody could have meant, and lists the legal ones', async () => {
    const board = face()
    board.seedItems(applyItemsCommit(board.items, {
      clientId: 'test', items: [{ ...richItem(), ref: 43 }], deleted: [],
    }, NOW))
    const result = await runBatch(resolved(board), {
      ops: [{ op: 'item.update', payload: { of: '#43', status: '进行重' } }],
    })
    expect(result.ok).toBe(false)
    const detail = result.reports[0]?.detail ?? ''
    // The list is what turns a refusal into one correction.
    expect(detail).toContain('backlog')
    expect(board.getItemsDoc().items[0]?.status, 'the refused value still landed').toBe('todo')
  })

  it('keeps the strict reading when no resolver is supplied', async () => {
    // A deployment without the face degrades to the old behaviour — never to a
    // guess. This is the honest absence the declaration promises.
    const board = face()
    board.seedItems(applyItemsCommit(board.items, {
      clientId: 'test', items: [{ ...richItem(), ref: 44 }], deleted: [],
    }, NOW))
    const result = await runBatch(deps(board), {
      ops: [{ op: 'item.update', payload: { of: '#44', status: '进行中' } }],
    })
    expect(result.ok, 'without a resolver the Chinese label must still be refused').toBe(false)
  })
})

/**
 * THE FOUR PARAMETERS WHOSE VALUES LIVE IN THE DEPLOYMENT.
 *
 * `permission`, `agentPreset`, `workspaceId` and `model` have no `oneOf` — their
 * members belong to the host, not to this catalog — so the resolver's first
 * version never ran on them at all: it required a `oneOf` to fire. Measured, the
 * exact text the selector prints was accepted, written, and reported 「已生效」:
 *
 *   task.create { permission: 'Full access' }  ->  stored "Full access"
 *
 * and the run then built `/permission Full access`, the host refused the unknown
 * preset, and the card failed at the most expensive moment with a config error.
 *
 * The vocabulary is now a FIELD on the declaration (`ParamSpec.vocabulary`), so
 * the door runs on what the parameter SAYS rather than on whether it happens to
 * carry an enum — and the refusal carries the deployment's real candidate list,
 * which is the only place those values can come from.
 */
describe('a value from the deployment\'s own table is read at the door, not stored as typed', () => {
  /** A host whose permission table looks like the real one: keys plus printed labels. */
  const PERMISSIONS = [
    { value: 'read-only', spellings: ['read-only', 'Read Only'], label: 'Read Only' },
    { value: 'danger-full-access', spellings: ['danger-full-access', 'Full access'], label: 'Full access' },
  ]
  const withHostTable = (board: ToolCommitFace): ToolDeps => ({
    ...deps(board),
    resolver: {
      resolve: (kind, value) => {
        const candidates = kind === 'permission' ? PERMISSIONS : builtinCandidatesOf(kind)
        if (candidates.length === 0) return undefined
        const out = resolveValue(kind, value, { candidatesOf: () => candidates })
        return out.ok ? out.value : undefined
      },
      candidatesOf: kind => namesOfCandidates(kind === 'permission' ? PERMISSIONS : builtinCandidatesOf(kind)),
    },
  })

  it('stores the preset KEY when the caller sends the printed label', async () => {
    const board = face()
    const result = await runBatch(withHostTable(board), {
      ops: [{ op: 'task.create', payload: { prompt: 'p', title: '带权限', permission: 'Full access' } }],
    })
    expect(result.ok).toBe(true)
    // THE DOCUMENT. Storing the label is what produced `/permission Full access`
    // and a config error at run time.
    expect(board.getDoc().tasks[0]?.permission, 'the printed label was stored as if it were the key').toBe('danger-full-access')
  })

  it('refuses an unknown value and lists what THIS deployment has', async () => {
    const board = face()
    const result = await runBatch(withHostTable(board), {
      ops: [{ op: 'task.create', payload: { prompt: 'p', title: 'x', permission: 'Full Access Please' } }],
    })
    expect(result.ok, 'an unreadable preset was accepted and will fail mid-run').toBe(false)
    const detail = result.reports[0]?.detail ?? ''
    // Both halves: the stored key the caller must send, and the label it recognises.
    expect(detail).toContain('danger-full-access')
    expect(detail).toContain('Full access')
    expect(board.getDoc().tasks, 'the refused card still landed').toHaveLength(0)
  })

  it('says so plainly when the host cannot list the values at all', async () => {
    // 「I cannot tell you」 is not 「your value is wrong」. A deployment with no
    // preset table must not accuse a perfectly good key — but it also must not
    // hand the run a value nothing can resolve, so the refusal says WHICH of the
    // two situations this is.
    const board = face()
    const result = await runBatch(withHostTable(board), {
      ops: [{ op: 'task.create', payload: { prompt: 'p', title: 'x', agentPreset: 'Code Reviewer' } }],
    })
    expect(result.ok).toBe(false)
    expect(result.reports[0]?.detail ?? '').toContain('没有给出候选')
  })

  it('passes through unchanged when NO resolver is wired, so a bare host still works', async () => {
    // The degradation that matters: a deployment with no preset service at all
    // must still create cards. Refusing here would turn 「this host cannot say」
    // into 「this host cannot work」.
    const board = face()
    const result = await runBatch(deps(board), {
      ops: [{ op: 'task.create', payload: { prompt: 'p', title: 'x', permission: 'read-only' } }],
    })
    expect(result.ok, 'a host without a resolver was made unable to create cards').toBe(true)
    expect(board.getDoc().tasks[0]?.permission).toBe('read-only')
  })
})

/**
 * THE RECEIPT'S REMAINDER IS OVER THE SIX, NOT OVER THE FOUR THAT MAY DEFAULT.
 *
 * `RUN_CONFIG_DEFAULTED` deliberately excludes the two must-ask keys. Reading the
 * remainder off THAT set meant that as soon as a caller specified any one field,
 * `workspaceId` and `permission` left the remainder and were never mentioned
 * again: a card created with only `workspaceId` said 「其余 provider / model /
 * reasoningEffort / agentPreset 用的是宿主默认」 — silently omitting that its
 * permission was also the host's. And with all four preferences given the
 * remainder came out EMPTY while two of six were unset, so the receipt said
 * 「全部由你指定」, which is the exact opposite of what the line exists to disclose.
 */
describe('the run-config receipt discloses defaults over all six fields', () => {
  const noteOf = async (payload: Record<string, unknown>): Promise<string> => {
    const board = face()
    const out = await runBatch(deps(board), { ops: [{ op: 'task.create', payload: { prompt: 'p', title: 'T', ...payload } }] })
    return out.reports[0]?.detail ?? ''
  }

  it('names a must-ask field that is still on the host default', async () => {
    const note = await noteOf({ workspaceId: 'ws-9' })
    expect(note, 'the receipt never mentions that permission was left to the host').toContain('permission')
    expect(note).toContain('宿主默认')
  })

  it('never says 「全部由你指定」 unless all six really were', async () => {
    // Four given, two (workspaceId, permission) unset.
    const note = await noteOf({ provider: 'p', model: 'm', reasoningEffort: 'high', agentPreset: 'a' })
    expect(note, 'the receipt claimed every field was chosen while two were not').not.toContain('全部由你指定')
    expect(note).toContain('workspaceId')
    expect(note).toContain('permission')
  })

  it('warns that a model without a provider will not be used', async () => {
    // `execution.ts` applies the model route under `provider !== undefined &&
    // model !== undefined`, with effort read inside that guard — so a card with
    // only a model runs on the deployment's default model. Reporting it as a
    // chosen value is not a wording problem: the next turn answers from it.
    const note = await noteOf({ model: 'm-1' })
    expect(note, 'the receipt reports a model that will never be executed').toContain('不会生效')
  })
})

/**
 * THE THREE DATES, JUDGED AND SNAPPED AT THE MODEL'S DOOR.
 *
 * Two defects, one place: a contradiction could be written and could not be read
 * back as one, and the "a date is a DAY" rule lived in the catalog's prose with
 * nothing enforcing it.
 *
 * The refusal is deliberately HERE and not in the shared writer: the capture
 * sheet saves a contradictory row on purpose (the reader can fix one field
 * later), while a model's call is one complete intent with no "later".
 */
describe('a model writing dates: contradicts, snaps to a day, and does not touch what it did not mention', () => {
  const day = (d: number): number => new Date(2026, 10, d, 4, 30).getTime()

  it('refuses a start date after the plan date, and names the pair', async () => {
    const board = face()
    const result = await runBatch(deps(board), {
      ops: [{ op: 'item.create', payload: { title: '自相矛盾', body: 'x', startsAfter: day(8), dueAt: day(7) } }],
    })
    expect(result.ok, 'a row that cannot keep its own promise was written').toBe(false)
    const detail = result.reports[0]?.detail ?? ''
    // NAMES BOTH ENDS: 「日期有矛盾」 leaves three candidates and no next step.
    expect(detail).toContain('startsAfter')
    expect(detail).toContain('dueAt')
    expect(board.getItemsDoc().items, 'the refused row still landed').toHaveLength(0)
  })

  it('refuses a plan date after the deadline, the pair that cannot be renegotiated', async () => {
    const board = face()
    const result = await runBatch(deps(board), {
      ops: [{ op: 'item.create', payload: { title: '晚于截止', body: 'x', dueAt: day(14), hardDueAt: day(10) } }],
    })
    expect(result.ok).toBe(false)
    expect(result.reports[0]?.detail).toContain('hardDueAt')
  })

  it('accepts a legal set and SNAPS each date to local midnight', async () => {
    // The catalog says a date is 「毫秒时间戳，但它标的是一天：给本地零点」, and that rule
    // was enforced by nothing. A model sending "now" put a row at 05:20, which
    // made 「今天到期」 wrong at the day boundary.
    const board = face()
    const result = await runBatch(deps(board), {
      ops: [{ op: 'item.create', payload: { title: '合法日期', body: 'x', dueAt: day(7) } }],
    })
    expect(result.ok).toBe(true)
    const stored = board.getItemsDoc().items[0]
    const midnight = new Date(2026, 10, 7, 0, 0, 0, 0).getTime()
    expect(stored?.dueAt, 'the day was not normalized, so 今天到期 is wrong near midnight').toBe(midnight)
  })

  it('does NOT refuse an edit that mentions no date, however impossible the row already is', async () => {
    // Otherwise 「把标题改一下」 fails forever on a row somebody else made impossible —
    // and the fix they were asked for would be impossible to perform.
    const board = face()
    board.seedItems(applyItemsCommit(board.items, {
      clientId: 'test',
      items: [{ ...richItem(), ref: 3, startsAfter: day(9), dueAt: day(5) }],
      deleted: [],
    }, NOW))
    const result = await runBatch(deps(board), {
      ops: [{ op: 'item.update', payload: { of: '#3', title: '只改标题' } }],
    })
    expect(result.ok, 'an unrelated edit was refused for a contradiction it did not create').toBe(true)
    expect(board.getItemsDoc().items[0]?.title).toBe('只改标题')
  })

  it('refuses an edit that CREATES a contradiction, naming the pair it would make', async () => {
    const board = face()
    board.seedItems(applyItemsCommit(board.items, {
      clientId: 'test',
      items: [{ ...richItem(), ref: 4, dueAt: day(5) }],
      deleted: [],
    }, NOW))
    const result = await runBatch(deps(board), {
      ops: [{ op: 'item.update', payload: { of: '#4', startsAfter: day(9) } }],
    })
    expect(result.ok).toBe(false)
    expect(result.reports[0]?.detail).toContain('startsAfter')
    expect(board.getItemsDoc().items[0]?.startsAfter, 'the refused date still landed').toBeUndefined()
  })

  it('keeps the capture sheet able to save a contradictory row', async () => {
    // THE INTERFACE'S BEHAVIOUR IS NOT CHANGED BY THE MODEL'S DOOR. The sheet saves
    // it on purpose so a reader mid-thought is not locked out; only the model is
    // refused. This asserts the shared writer is still permissive.
    const board = face()
    const made = captureItemRecord({
      title: '人写的矛盾', body: 'x', notes: '', origin: 'human',
      startsAfter: day(8), dueAt: day(7),
    }, NOW, () => 'i-h')
    expect(made.item.startsAfter).toBe(day(8))
    expect(made.item.dueAt).toBe(day(7))
    void board
  })
})

/**
 * THE DATE VERDICT REACHES THE MODEL.
 *
 * Three bare timestamps are not a verdict: 「已逾期 3 天」 and 「还没到可开始的日子」
 * are judgments with a precedence order and a local-day boundary, and a row whose
 * own dates contradict each other has no honest "how late" answer at all. The
 * interface has printed this all along; the model had to recompute it.
 */
describe('a read carries what the dates MEAN, not only when they are', () => {
  const rowWith = (patch: Record<string, unknown>) => {
    const box = face()
    box.seedItems(applyItemsCommit(box.items, {
      clientId: 'test', items: [{ ...richItem(), ref: 21, ...patch }], deleted: [],
    }, NOW))
    return box
  }

  it('says a contradiction out loud, naming the pair', async () => {
    // The row is stored as written (the document keeps it), so the READ is the one
    // place that can say the three dates cannot all be true.
    const box = rowWith({ startsAfter: NOW + 9 * 86_400_000, dueAt: NOW + 5 * 86_400_000 })
    const answer = await query({ of: '#21' }, box) as { items: { datePosture?: string }[] }
    const posture = answer.items[0]?.datePosture
    expect(posture, 'a self-contradicting row read as a normal schedule').toBeDefined()
    expect(posture).toContain('自相矛盾')
    expect(posture).toContain('startsAfter')
    expect(posture).toContain('dueAt')
  })

  it('says a passed deadline is passed, and by how long', async () => {
    const box = rowWith({ hardDueAt: NOW - 3 * 86_400_000 })
    const answer = await query({ of: '#21' }, box) as { items: { datePosture?: string }[] }
    expect(answer.items[0]?.datePosture).toContain('截止')
  })

  it('says a gate has not opened yet, which is not the same as late', async () => {
    const box = rowWith({ startsAfter: NOW + 5 * 86_400_000 })
    const answer = await query({ of: '#21' }, box) as { items: { datePosture?: string }[] }
    expect(answer.items[0]?.datePosture).toContain('还没到')
  })

  it('omits the verdict for a row with no dates at all', async () => {
    // Absent, not undefined: a row that made no promise has no verdict, and the
    // same "absent rather than blank" rule the rest of the projection follows.
    const box = rowWith({})
    const answer = await query({ of: '#21' }, box) as { items: { datePosture?: string }[] }
    expect('datePosture' in (answer.items[0] ?? {})).toBe(false)
  })

  it('prints the verdict in the prose the model reads, not only in the JSON', async () => {
    // A projection that carries it in JSON and prints nothing is the same lie the
    // `detail` parameter used to tell: the answer is there, the reader still
    // cannot use it.
    const box = rowWith({ hardDueAt: NOW - 2 * 86_400_000 })
    const text = await queryText({ of: '#21' }, box)
    expect(text, 'the verdict never reached the prose').toContain('日期态势')
  })
})

/**
 * A BROKEN LINK SAYS IT IS BROKEN.
 *
 * `itemRow` kept the raw uuid for a row whose card is gone, because 「there is a
 * link and I cannot name its target」 is a fact. But a bare uuid is a fact in a
 * shape nobody can act on: `2e1254d5-7464-…` looks exactly like an ordinary
 * reference, so the model could not tell a dangling row from a linked one.
 */
describe('a dangling card link is a readable fact', () => {
  it('marks the link as dead instead of printing a bare uuid', async () => {
    const box = face()
    box.seedItems(applyItemsCommit(box.items, {
      clientId: 'test',
      // A taskId no card on this board has — the state a deleted card leaves.
      items: [{ ...richItem(), ref: 31, taskId: '2e1254d5-7464-4f35-a1ba-2a1ae318ccf3' }],
      deleted: [],
    }, NOW))
    const answer = await query({ of: '#31' }, box) as { items: { taskId?: string }[] }
    const said = answer.items[0]?.taskId ?? ''
    expect(said, 'the dead link reads as a normal reference').toContain('已失效')
    expect(said, 'the whole uuid is unreadable and unquotable').not.toBe('2e1254d5-7464-4f35-a1ba-2a1ae318ccf3')
  })

  it('still names a link that resolves, and omits the field when there is none', async () => {
    const box = face()
    box.seed({ ...emptyBoardDoc(NOW), tasks: [card('还在的卡')] })
    const cardId = box.getDoc().tasks[0]?.id ?? ''
    box.seedItems(applyItemsCommit(box.items, {
      clientId: 'test',
      items: [{ ...richItem(), ref: 32, taskId: cardId }, { ...richItem(), id: 'i-2', ref: 33, taskId: undefined }],
      deleted: [],
    }, NOW))
    const linked = await query({ of: '#32' }, box) as { items: { taskId?: string }[] }
    expect(linked.items[0]?.taskId, 'a live link lost its title').toBe('还在的卡')
    const free = await query({ of: '#33' }, box) as { items: { taskId?: string }[] }
    expect('taskId' in (free.items[0] ?? {}), 'no link is reported as a link').toBe(false)
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

describe('the model and the person press the same buttons', () => {
  /* THE THREE PLACES THE TWO SIDES USED TO DIVERGE.
   *
   * Each case below is a divergence that was REAL: the catalog said one
   * thing, the interface did another, the model did a third, and the gate was
   * green because it only asked whether the function it named existed.
   *
   * The fix is not a second judgment on the model's side — it is the model
   * calling the very function the interface calls, so there is nothing left to
   * disagree about. */

  it('task.approve moves the card AND marks it read, like the person\'s button', async () => {
    const board = face()
    board.seed({
      ...emptyBoardDoc(NOW),
      tasks: [{
        ...card('待审核的卡'),
        status: 'review' as const,
        executions: [{ id: 'e-1', sessionId: 's-1', startedAt: NOW, endedAt: NOW, result: 'succeeded' as const, error: undefined }] as never,
      }],
    })
    const result = await runBatch(deps(board), { ops: [{ op: 'task.approve', payload: { of: '待审核的卡' } }] })
    expect(result.ok).toBe(true)
    const approved = board.getDoc().tasks[0]
    expect(approved?.status, 'the card moved to 已完成').toBe('done')
    // The read clock: the half the model used to leave behind, so a card the
    // model approved kept its unread ring and its 「新 N」 chip.
    expect(approved?.viewedAt, 'and the read clock moved with it').toBe(NOW)
  })

  it('task.approve refuses a card that is still running, and touches nothing', async () => {
    const board = face()
    const round = { id: 'e-1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }
    board.seed({ ...emptyBoardDoc(NOW), tasks: [{ ...card('还在跑的卡'), status: 'review' as const, executions: [round] as never }] })
    const result = await runBatch(deps(board), { ops: [{ op: 'task.approve', payload: { of: '还在跑的卡' } }] })
    expect(result.reports[0]?.ok).toBe(false)
    expect(result.reports[0]?.detail).toContain('还有轮次在跑')
    const untouched = board.getDoc().tasks[0]
    expect(untouched?.status, 'neither the column nor the read clock moved').toBe('review')
    expect(untouched?.viewedAt).toBeUndefined()
  })

  it('task.move refuses a card that is still running — the drag\'s own gate', async () => {
    // The catalog promises it, the drag keeps it, and the model used to be the
    // one side that could move a card out from under a live run.
    const board = face()
    const round = { id: 'e-1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }
    board.seed({ ...emptyBoardDoc(NOW), tasks: [{ ...card('还在跑的卡'), status: 'todo' as const, executions: [round] as never }] })
    const result = await runBatch(deps(board), { ops: [{ op: 'task.move', payload: { of: '还在跑的卡', status: 'done' } }] })
    expect(result.reports[0]?.ok).toBe(false)
    expect(result.reports[0]?.detail).toContain('还有轮次在跑')
    expect(board.getDoc().tasks[0]?.status, 'the card is where it was').toBe('todo')
  })

  it('item.update with a status moves the CARD as well — one fact, two documents', async () => {
    // THE SILENT NO-OP. The model wrote the row's own field and left the card
    // where it was, and the panel's own sync then quietly undid that write —
    // so the receipt said 「已生效」 about an edit nobody kept.
    const board = face()
    board.seed({ ...emptyBoardDoc(NOW), tasks: [card('挂着卡')] })
    const base = {
      id: 'i-1', ref: 1, title: '一条', body: '正文', notes: '', steps: [],
      status: 'todo', priority: 'normal', tags: [], startsAfter: undefined,
      dueAt: undefined, hardDueAt: undefined, taskId: 't-挂着卡',
      origin: { source: 'human', at: NOW }, createdAt: NOW, updatedAt: NOW,
    }
    board.seedItems(applyItemsCommit(emptyItemsDoc(NOW), { clientId: 'c', items: [base as never], deleted: [] }, NOW))
    const result = await runBatch(deps(board), { ops: [{ op: 'item.update', payload: { of: '#1', status: 'done' } }] })
    expect(result.ok).toBe(true)
    expect(board.getItemsDoc().items[0]?.status, 'the row says 已完成').toBe('done')
    expect(board.getDoc().tasks[0]?.status, 'and the card is in 已完成 too').toBe('done')
  })

  it('item.update with a status the executor owns is refused, saying why', async () => {
    const board = face()
    board.seed({ ...emptyBoardDoc(NOW), tasks: [card('挂着卡')] })
    const base = {
      id: 'i-1', ref: 1, title: '一条', body: '正文', notes: '', steps: [],
      status: 'todo', priority: 'normal', tags: [], startsAfter: undefined,
      dueAt: undefined, hardDueAt: undefined, taskId: 't-挂着卡',
      origin: { source: 'human', at: NOW }, createdAt: NOW, updatedAt: NOW,
    }
    board.seedItems(applyItemsCommit(emptyItemsDoc(NOW), { clientId: 'c', items: [base as never], deleted: [] }, NOW))
    const result = await runBatch(deps(board), { ops: [{ op: 'item.update', payload: { of: '#1', status: 'running' } }] })
    expect(result.reports[0]?.ok).toBe(false)
    expect(result.reports[0]?.detail).toContain('进行中')
    expect(board.getItemsDoc().items[0]?.status, 'the row is untouched').toBe('todo')
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
        attachments: [],
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

  /** One card holding one session, and one row hanging off it — plus the relay
   *  the action now rides, so a test can read WHICH carrier it chose and what it
   *  carried. */
  function linked(running: Record<string, 'running' | 'idle'> = { 's-1': 'idle' }) {
    const board = face()
    const relayed: BoardCommand[] = []
    board.submitCommand = (command) => { relayed.push(command); return { status: 'broadcast' } }
    board.seed({
      ...emptyBoardDoc(NOW),
      tasks: [{ ...card('挂着的卡'), binds: [{ kind: 'session', sessionId: 's-1' }] }],
    })
    board.seedItems(oneItem({ taskId: 't-挂着的卡' }))
    return { board, relayed, run: () => deps(board, runningSources(running, [])) }
  }

  it('说进那张卡已有的会话，带着这一条的步骤，而且不改任何文档', async () => {
    const { board, relayed, run } = linked()
    const before = board.getItemsDoc().items[0]
    const out = await runBatch(run(), { ops: [{ op: 'item.ask', payload: { of: 1 } }] })
    expect(out.ok).toBe(true)
    // THE CARRIER IS THE ANSWER: a card that already has a conversation gets a
    // MESSAGE into it, never a second run — the whole point of one action with two
    // lanes is that the model asking reaches the same lane the button does.
    expect(relayed).toHaveLength(1)
    const command = relayed[0]
    expect(command?.type).toBe('comment')
    if (command?.type !== 'comment') return
    expect(command.sessionId).toBe('s-1')
    expect(command.text).toContain('量一遍地板')
    expect(command.text).toContain('在真机上量')
    // A question is not a write. Reporting it as a change would make every
    // 「问一句」 look like an edit of the document.
    expect(board.getItemsDoc().items[0]).toBe(before)
    expect(board.commits).toBe(0)
  })

  it('一条带图片的记录：附件跟着载具一起中转（模型与界面同一个结果）', async () => {
    /* 模型这一条路没有第二个说法：`planItemAsk` 读的是**文档里那一行**的附件，而
       `buildRelay` 按字段白名单拼命令——不在这里点名搬过去，附件就在这一步静默消失，
       同一次 `item.ask` 会在界面上带图、在模型这边只有字。 */
    const { board, relayed, run, ...rest } = linked()
    void rest
    const lamp = { attachmentId: 'att-lamp', name: '灯位.png', bytes: 2048, mediaType: 'image/png' }
    board.seedItems(oneItem({ taskId: 't-挂着的卡', attachments: [lamp] }))
    const out = await runBatch(run(), { ops: [{ op: 'item.ask', payload: { of: 1 } }] })
    expect(out.ok).toBe(true)
    const command = relayed[0]
    expect(command?.type).toBe('comment')
    if (command?.type !== 'comment') return
    expect(command.attachments).toEqual([lamp])
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
    const { run } = linked()
    const out = await runBatch(run(), { ops: [{ op: 'item.ask', payload: { of: 99 } }] })
    expect(out.ok).toBe(false)
    expect(out.reports[0]?.detail).toContain('#99')
  })

  it('一条会话都没有的卡：开一轮，而且这一轮的第一句话是这一条自己的内容', async () => {
    // THE INVERSION THIS FILE IS BUILT ON. 「没有会话」 is not a refusal —
    // 它真正说的是「没有可以接下去的东西」，那正是**开始**的定义。A model told
    // 「没有会话可以说话」 on a fresh card has no way to get the row's words into
    // that card at all.
    const board = face()
    const relayed: BoardCommand[] = []
    board.submitCommand = (command) => { relayed.push(command); return { status: 'broadcast' } }
    board.seed({ ...emptyBoardDoc(NOW), tasks: [card('空的卡')] })
    board.seedItems(oneItem({ taskId: 't-空的卡' }))
    const out = await runBatch(deps(board, runningSources({}, [])), { ops: [{ op: 'item.ask', payload: { of: 1 } }] })
    expect(out.ok).toBe(true)
    const command = relayed[0]
    expect(command?.type).toBe('run')
    if (command?.type !== 'run') return
    expect(command.taskId).toBe('t-空的卡')
    // The card's own prompt is 「p」 and stays so: what goes out is the ROW.
    expect(command.kickoff).toContain('量一遍地板')
  })

  it('prefers the RUNNING session when the card has several', async () => {
    const board = face()
    const relayed: BoardCommand[] = []
    board.submitCommand = (command) => { relayed.push(command); return { status: 'broadcast' } }
    board.seed({
      ...emptyBoardDoc(NOW),
      tasks: [{ ...card('多会话的卡'), binds: [{ kind: 'session', sessionId: 's-idle' }, { kind: 'session', sessionId: 's-busy' }] }],
    })
    board.seedItems(oneItem({ taskId: 't-多会话的卡' }))
    await runBatch(deps(board, runningSources({ 's-idle': 'idle', 's-busy': 'running' }, [])), { ops: [{ op: 'item.ask', payload: { of: 1 } }] })
    const command = relayed[0]
    expect(command?.type).toBe('comment')
    if (command?.type !== 'comment') return
    // 「the one doing work right now」 is the only choice that matches what a
    // reader means by asking; taking the first bound one would send the question
    // to a conversation that finished an hour ago.
    expect(command.sessionId).toBe('s-busy')
  })

  it('the catalog carries it, so a model is told it exists', () => {
    expect(ACTIONS['item.ask']).toBeDefined()
    expect(ACTIONS['item.ask']?.surface).toBe('ui+ai')
    expect(TOOL_ACTION_IDS).toContain('item.ask')
    // The summary has to say that 「没有卡」 is answered by making one, or a model
    // that wants the row to move will stop at the refusal.
    expect(ACTIONS['item.ask']?.summary).toContain('item.promote')
  })
})

describe('模型挂卡与移栏：走的都是界面走的那扇门', () => {
  /* 这一组钉的是**模型这一侧落位与挂载的方式**——与界面的对答在
   * `tests/item-board-linkage.spec.ts` 里（那一处两侧各跑一遍，比的是结果）；这里钉的是
   * 模型自己那一侧的三件事：断链不写、落位有键、挂载一次写完两件事。 */

  it('挂到一张不存在的卡上：明确拒绝，而不是写一条断链', async () => {
    // 界面那一侧的选择器只列板上真的卡，所以「挂到一张不存在的卡」是模型写得出、界面写不
    // 出的一个状态。写下去就是一条断链：屏上读不到那张卡，而清单里记着它——面板那个效果
    // 会把它悄悄清掉，于是回执说「已生效」而链接已经没了。
    const board = face()
    board.seedItems(applyItemsCommit(board.items, { clientId: 'c', items: [richItem()], deleted: [] }, NOW))
    const result = await runBatch(deps(board), { ops: [{ op: 'item.update', payload: { of: '#7', taskId: 'card-that-is-not-there' } }] })
    expect(result.reports[0]?.ok, '一条断链被写进去了').toBe(false)
    expect(result.reports[0]?.detail).toContain('card-that-is-not-there')
    expect(board.getItemsDoc().items[0]?.taskId, '一条断链落在了清单里').toBeUndefined()
  })

  it('挂卡：链接与这一行自己那一档一起写——挂上之后显示的那件事由卡回答', async () => {
    const board = face()
    board.seed({ ...emptyBoardDoc(NOW), tasks: [{ ...card('挂着的那张卡'), id: 't-review', status: 'review' }] })
    board.seedItems(applyItemsCommit(board.items, { clientId: 'c', items: [{ ...richItem(), status: 'backlog' }], deleted: [] }, NOW))
    const result = await runBatch(deps(board), { ops: [{ op: 'item.update', payload: { of: '#7', taskId: 't-review' } }] })
    expect(result.ok).toBe(true)
    const written = board.getItemsDoc().items[0]
    expect(written?.taskId).toBe('t-review')
    expect(written?.status, '挂上之后这一行自己那一档没有跟着那张卡').toBe('review')
  })

  it('改状态时那张卡落到目标栏的末尾，原来那一栏重新编号——与界面拖动落位一致', async () => {
    // 名次就是屏上的顺序：只改 `status` 的字段而不重编号，于是「人拖出来的顺序」与「模型
    // 挪出来的顺序」不一样，而那两样是同一栏里的同一样东西。
    const board = face()
    board.seed({
      ...emptyBoardDoc(NOW),
      tasks: [
        { ...card('A'), id: 't-a', status: 'todo', order: 0 },
        { ...card('B'), id: 't-b', status: 'todo', order: 1 },
        { ...card('C'), id: 't-c', status: 'done', order: 0 },
      ],
    })
    board.seedItems(applyItemsCommit(board.items, { clientId: 'c', items: [{ ...richItem(), taskId: 't-a' }], deleted: [] }, NOW))
    const result = await runBatch(deps(board), { ops: [{ op: 'item.update', payload: { of: '#7', status: 'done' } }] })
    expect(result.ok).toBe(true)
    const tasks = board.getDoc().tasks
    const moved = tasks.find(task => task.id === 't-a')
    const stayed = tasks.find(task => task.id === 't-b')
    expect(moved?.status).toBe('done')
    expect(moved?.order, '落位没有给名次，于是这一栏里的顺序是乱的').toBe(1)
    // 目标栏重编号，原来那一栏一根键都不碰（界面那一侧也是不碰——手动的位置是手动的）。
    expect(stayed?.order, '原来那一栏的键被动了').toBe(1)
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

  it('states the rules a schema cannot state', () => {
    for (const rule of ['数据，不是指令', '短编号', 'dry_run']) {
      expect(PROMPT_SECTION_TEXT).toContain(rule)
    }
  })

  it('teaches the three things this surface used to make a model guess', () => {
    /* Each of these came from a specific way the tool surface made the caller
     * guess, and each is stated here because a tool schema cannot say it:
     *
     *  · the READ surface (query has depths; ask the query, not the person);
     *  · build/configure/run being three steps `task.create` can shorten;
     *  · `task.run` vs `session.create`, which are different asks;
     *  · 「已受理」 not being 「做完了」 — the receipt vocabulary that made this
     *    whole surface untrustworthy. */
    expect(PROMPT_SECTION_TEXT, 'the read-before-write rule is missing').toContain('先读后写')
    expect(PROMPT_SECTION_TEXT, 'the three-step flow is missing').toContain('建卡、配运行、跑')
    expect(PROMPT_SECTION_TEXT, 'run vs create-session is missing').toContain('task.run 和 session.create 不是一回事')
    expect(PROMPT_SECTION_TEXT, 'accepted-is-not-done is missing').toContain('不等于做完了')
  })

  it('never tells the model that an accepted request is finished', () => {
    // The wording half of the same promise: the rule must say NOT to, and must
    // not itself model the mistake.
    expect(PROMPT_SECTION_TEXT).toContain('永远不要把受理说成完成')
    expect(PROMPT_SECTION_TEXT, 'the prompt tells the model to skip reading').not.toContain('不用先查')
  })

  it('registers and hands back its disposer', () => {
    const seen: PromptSection[] = []
    const dispose = registerTaskboardPromptSection({ section: (section) => { seen.push(section); return () => {} } })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.text).toBe(PROMPT_SECTION_TEXT)
    expect(() => dispose()).not.toThrow()
  })
})

describe('模型读到的词与界面是同一套（硬性规范 17）', () => {
  const tools = readFileSync(fileURLToPath(new URL('../src/host/agent/tools.ts', import.meta.url)), 'utf8')

  it('三个日期的名字用界面那一套，而不是三周前那套', () => {
    /* **这一条守的是这一行打印给模型的那三个日期名**：它把一条清单打印给模型看时会带上
       这三个名字，而模型会拿它们回答读者，属于用户可见的那一面。名字与界面同一套——开始 /
       计划 / 截止；一个概念两个名字，就是这一条要挡住的事。 */
    for (const word of ['开始', '计划', '截止']) {
      expect(tools, `模型读到的日期名缺了「${word}」`).toContain(`'${word}'`)
    }
    for (const stale of ['最早开始', '硬期限']) {
      expect(tools, `模型读到的日期名还有旧词「${stale}」`).not.toContain(`'${stale}'`)
    }
  })

  it('the probe bites: the old word is reported', () => {
    const planted = `${tools}\nconst probe = ['硬期限', 1] as const\n`
    expect(planted, 'the plant did not bite').toContain("'硬期限'")
  })

  it('三个日期同时印原始戳和那一天', () => {
    // 读这一行的是个被告诉过「单位是天」的模型，所以一个光秃秃的 13 位数只会让它去猜。这条
    // 把它钉在同一个模板上：两个都给。
    expect(tools, '日期只印了原始戳，模型得自己猜那是哪一天').toContain('（${localDayKey(at)}）')
  })

  it('行自己存的状态与它显示的不同时，两个都说出来', () => {
    // 读者按下「已完成」而它挂着的卡还在待办时，显示的是「已完成」（那条压过卡片的规则）、
    // 存着的是另一档。模型必须看得见这差别，否则它会把显示的那个当成这一行存着的值，然后
    // 基于一个错的字段去写。
    expect(tools, '没有把「存储状态」印给模型').toContain('存储状态')
  })

  it('两种拒答各说各的，而且第一种给出下一步', () => {
    /* 模型把这几句读给读者听，也会照着它们决定下一步。含糊的一句「不行」的代价是：它自己编一个
       理由，或者干脆再试一遍同一件事——所以每一档都得有名字，而"能怎么办"要说出来。

       **两档，不是三档。**「还没有会话可以说话」这一档没有了，因为它从来不是一种拒绝：没有会话
       的卡是**开一轮**，那条路现在通着（见 `item.ask` 的 carrier）。剩下的两档是这一条与它的
       链接本身的关系，与卡的状态无关。 */
    for (const words of ['这一条没有挂在任何看板卡片上', '别替它挑一张']) {
      expect(tools, `拒答句缺了「${words}」这一档`).toContain(words)
    }
    expect(tools, '拒答只说不行、不说下一步').toContain('item.promote')
  })
})
