/**
 * The three task-board tools (host half) — the model's whole surface on this
 * plugin: `taskboard_capabilities` (what can be done), `taskboard_query` (what
 * is there), `taskboard_execute` (do this batch).
 *
 * ── WHY THREE ───────────────────────────────────────────────────────────────
 * Read and write are separate names, which is what makes a read-only mode a
 * later possibility; and three names that mean three different things beat
 * thirty that overlap (near-identical tool names are the top cause of a model
 * picking the wrong one). The whole set fits the "3-5 hot tools" range.
 *
 * ── ONE CATALOG, FOUR VIEWS (this file is three of them) ────────────────────
 *
 * The action table in `board-actions.ts` is the authority. Nothing here writes
 * an action, a verb, a parameter, a danger level or a value list a second
 * time: the op enum is {@link TOOL_ACTION_IDS}, the parameter table is each
 * row's `params`, and the filter vocabulary comes from the SAME search registry
 * the board's own filter box completes from. A second list is the drift this
 * project has spent three knives removing; writing one here would put it back.
 *
 * ── THE THREE LAWS ──────────────────────────────────────────────────────────
 *
 * 1. THE CATALOG IS THE ONLY AUTHORITY, INCLUDING WHO MAY DO WHAT. An op may
 *    only name an action in {@link TOOL_ACTION_IDS}, so an action marked
 *    `surface: 'ui'` does not exist for this tool — it is not "refused", it is
 *    absent from the enum the model can even type, and if one is named anyway
 *    the answer says WHO may do it and why (the catalog's own `summary` says
 *    so out loud, so the model does not spend a turn discovering it).
 * 2. SHORT NUMBERS OUT, NEVER UUIDs. A person and a model both say "#12"; a
 *    uuid has to be carried through a conversation to be useful and the model
 *    invents them when it has to type one. Every row this tool returns carries
 *    its number and title, because a receipt the model can read back is what
 *    makes "把第 3 条删了" work on the next turn.
 * 3. A BUSINESS FAILURE SAYS WHAT TO CHANGE. Not a code, not a stack: the
 *    thing to fix and how. An unparseable spec, a missing required parameter
 *    and a target that does not exist are the three failures a model actually
 *    hits, and each one comes back with the correction attached.
 *
 * ── BATCH SEMANTICS (decided, not discovered here) ───────────────────────────
 *
 * `ops` run in order, the first failure stops the rest, nothing is rolled
 * back, and every op is reported. That is a deliberate trade: a cross-op undo
 * layer would be a second history beside the merge grammar, and the grammar is
 * where convergence across devices actually comes from. So the report is the
 * product: "前 2 条已生效，第 3 条失败：…". `dry_run` rehearses the WHOLE batch
 * on a document clone through the same code path — one at a time would be a
 * different function, and a rehearsal that differs from the real thing is not
 * a rehearsal.
 *
 * ── ENGINE-LANE OPS SAY SO WHEN NO ENGINE IS HOLDING THE SEAT ───────────────
 * A relayed command is accepted, not executed: the honest answer is "已受理，
 * 引擎当前不在线，将在引擎上线后执行". Pretending it ran is the failure mode.
 */
import {
  ACTIONS,
  BOARD_VERBS,
  EXECUTE_ENVELOPE_PARAMS,
  TOOL_ACTION_IDS,
  VERB_KIND,
  type ActionDanger,
  type ActionDomain,
  type ActionId,
  type ActionKind,
  type ActionLane,
  type ActionSurface,
  type ParamSpec,
} from '../../core/board-actions.ts'
import { QUALIFIER_KEYS, completeBoardQuery, itemSearchContext, matchItemQuery, matchTask } from '../../core/task-search.ts'
import { hasLiveAutomation } from '../../core/automation.ts'
import { sessionUnviewedOf, taskUnviewed } from '../../core/session-display.ts'
import { itemQualifierVocabulary } from '../../core/item-query.ts'
import { refOf } from '../../core/item-navigate.ts'
import { messageOf } from '../../core/values.ts'
import { attachmentCountsOf, attachmentsOf, normalizeAttachmentRefs } from '../../core/attachment.ts'
import { clampCruiseLimit, type BoardCommand, type BoardCommandCarrier, type BoardCommit, type BoardDoc, type BoardView, type CommandRelayStatus, type CruiseValue } from '../../core/board-doc.ts'
import { applyItemsCommit, deletedItemsOf, purgeItemTombstone, restoredItemOf, type ItemPurge, type ItemsCommit, type ItemsDoc } from '../../core/items-doc.ts'
import { cardStatusMapOf, createTask, landCardInColumn, resolveCardDrop, taskBindsOf, type TaskBind, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
import type { SessionRule } from '../../core/automation.ts'
import { nextRunAtMs, isValidCron } from '../../core/schedule.ts'
import type { SchedulePreset } from '../../core/presets.ts'
import { RUN_CONFIG_KEYS, RUN_CONFIG_DEFAULTED, RUN_CONFIG_MUST_ASK, type RunConfigPresetConfig, type RunPresetsDocument } from '../../core/run-presets.ts'

/** Read a run-config patch, keeping only the keys the preset model actually
 *  has. An unknown key is dropped rather than stored: the section's grammar
 *  would drop it too, so a silent loss here would be a lie about what landed. */
function readRunConfig(raw: unknown): RunConfigPresetConfig {
  if (typeof raw !== 'object' || raw === null) return {}
  const source = raw as Record<string, unknown>
  const config: RunConfigPresetConfig = {}
  for (const key of RUN_CONFIG_KEYS) {
    const value = source[key]
    if (typeof value === 'string' && value !== '') config[key] = value
  }
  return config
}

/**
 * Read the `bind` list a card is born with, or the sentence saying why not.
 *
 * THE SHAPE IS CHECKED, NOT COERCED, and every refusal names what to send. A
 * `bind` entry is a discriminated pair — `{ kind: 'session', sessionId }` or
 * `{ kind: 'workspace', workspaceId }` — and a reader that accepted anything
 * with a `sessionId` on it would store a bind whose `kind` is a typo, which no
 * reader of `taskBindsOf` would ever match again. A card that silently has no
 * sources is exactly the state this parameter exists to prevent.
 *
 * Sources are NOT verified against a live registry here: this host can bind a
 * session it cannot currently see (the sidebar lists a workspace's sessions, and
 * the board is not the registry). What IS refused is a malformed entry, because
 * that is a fact about the REQUEST rather than about the world.
 * @param raw - the payload's `bind` value.
 * @returns the binds, or a refusal sentence.
 */
function readBinds(raw: unknown): TaskBind[] | string {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return 'bind 要么是一份列表，要么别传；现在这个不是列表，所以这张卡没有建。'
  const binds: TaskBind[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      return 'bind 的每一项都要写成 { kind, sessionId } 或 { kind, workspaceId }，收到了一项不是对象的。'
    }
    const row = entry as Record<string, unknown>
    const kind = row.kind
    if (kind === 'session') {
      const sessionId = typeof row.sessionId === 'string' ? row.sessionId.trim() : ''
      if (sessionId === '') return 'bind 里有一项 kind 是 session，但没有给 sessionId。'
      binds.push({ kind: 'session', sessionId })
      continue
    }
    if (kind === 'workspace') {
      const workspaceId = typeof row.workspaceId === 'string' ? row.workspaceId.trim() : ''
      if (workspaceId === '') return 'bind 里有一项 kind 是 workspace，但没有给 workspaceId。'
      binds.push({ kind: 'workspace', workspaceId })
      continue
    }
    return `bind 的每一项都要有 kind，只能是 session 或 workspace，收到的是「${String(kind)}」。`
  }
  // One entry per source: two identical entries are one source written twice,
  // and every reader of the list would show it twice.
  const seen = new Set<string>()
  for (const bind of binds) {
    const key = bind.kind === 'session' ? `s:${bind.sessionId}` : `w:${bind.workspaceId}`
    if (seen.has(key)) {
      const named = bind.kind === 'session' ? `会话 ${bind.sessionId}` : `工作区 ${bind.workspaceId}`
      return `${named} 在 bind 里出现了两次。卡片只挂一次来源就够了，所以这张卡没有建。`
    }
    seen.add(key)
  }
  return binds
}
import { approveTaskToStatus, armSchedule, BUSY_REASON, moveTaskToStatus, removeSessionFromTask, type TransitionResult } from '../../core/task-transitions.ts'
// The checklist's write semantics: the SAME functions the capture box and
// the detail pane call. A field write the tool does itself is a second answer to
// a question two surfaces already share, and the checklist is the second synced
// document — two writers with two no-op laws is a document whose replicas
// disagree about which edits happened.
import {
  applyItemPatch,
  applyItemStatus,
  applyItemStep,
  captureItemRecord,
  isItemListValue,
  mountItemRecord,
  planItemPromotion,
  readItemStepList,
  removeItemRecord,
} from '../../core/item-transitions.ts'
import { ITEM_PRIORITIES, ITEM_STATUSES, itemProgressOf, itemTagsOf, itemTitleOf, type ItemDateConflict, type ItemDateKey, type ItemPriority, type ItemRecord, type ItemStatus, type ItemStatusView } from '../../core/item.ts'
// The date verdicts, from the one module that owns what a date MEANS: the
// conflict test, the day normalization, and the posture a read can print.
import { DATE_KEYS, datePostureOf, itemDateWriteOf } from '../../core/item-dates.ts'
// The vocabulary bridge: what a caller SAID, read into what this system stores.
// The candidate lists stay in this repository's own enums plus whatever the
// deployment supplies, so the resolver does not become a third vocabulary. The
// assembly itself lives in `register.ts` — this module only declares the FACE it
// needs, so the tool stays a pure function of its deps.
import type { ResolveKind } from '../../core/resolve.ts'
import { derivedStatusOf, linkedCardOf } from '../../core/item-membership.ts'
import { planItemAsk } from '../../core/item-ask.ts'
// THE ONE PATH INTO A MODEL, shared with the two slash commands and with the
// panel's hand-off route. A second copy of these four lines is a second thing to
// keep in step, and the first time they drifted nobody would have found out.
import type { SessionPosture, SessionPostureSources } from '../session-state.ts'
import { sessionRunningOf } from '../session-state.ts'
import { relatedSessionIdsOf, type TaskLiveState } from '../../core/task-live.ts'
// Types only: which row a purge names is decided by the route that receives it,
// and a tool face that declared its own copy of the address would be free to
// disagree with the service about which name a caller may send. Erased at build.
import type { ItemAddress } from '../board-route.ts'

/* ── the host faces this tool reads ────────────────────────────────────────
 * Structural and late-bound: the same discipline as session-state.ts. Nothing
 * here imports an SDK runtime, so the whole tool surface is testable with
 * plain objects and the plugin keeps an empty `dependencies`. */

export interface ToolCommitFace {
  getDoc(): BoardDoc
  getItemsDoc(): ItemsDoc
  commit(commit: BoardCommit): Promise<BoardDoc>
  commitItems(commit: ItemsCommit): Promise<ItemsDoc>
  /**
   * Erase one deleted row's text — the host's own operation, and the only one
   * that can: a commit carries rows and deletions, and a tombstone's payload is
   * a field the merge grammar never shows a replica. So it is on this face
   * rather than in the batch's commit path, and the batch asks for it the same
   * way the panel's HTTP route does.
   *
   * THE ADDRESS IS THE SERVICE'S OWN, not a narrowed copy of it. The tool has
   * already turned the number a model says out loud into the row's identity by
   * the time it gets here, and a second signature that took a bare id would be a
   * second name for one operation — with the real service no longer assignable
   * to this face, which is how a structural view starts drifting from the class
   * it is a view of.
   *
   * A face that cannot purge must say so rather than pretend: the model would
   * otherwise be told 「已生效」 about words that are still on disk.
   */
  purgeItem(of: ItemAddress, clientId: string): Promise<ItemPurge>
  /** Relay one command to whichever replica holds the seat, and ANSWER WITH
   *  WHAT HAPPENED: a live engine that knows the carrier took it, nobody was
   *  there so it parked, or the live engine does not implement it and nothing
   *  was sent or parked. The whole union rides through: the catalog decides
   *  which carrier an action rides, and the relay carries it as-is. */
  submitCommand(command: BoardCommand): CommandRelayStatus
  available: boolean
}

export interface ToolDeps {
  board: () => ToolCommitFace | undefined
  posture: (sessionId: string) => Promise<SessionPosture>
  /** The live host faces, so a decision that needs to know whether a session
   *  is still working asks the SAME derivation the board does — never a second
   *  one written here. */
  sources: SessionPostureSources
  /**
   * A workspace's display name, when this host knows one.
   *
   * OPTIONAL, and deliberately so: `ws:` is a board-side qualifier whose whole
   * job is 「cards in a workspace called this」, and a card with no workspace is
   * not in any workspace. Guessing a name would make the qualifier answer for a
   * host that cannot see it, so a host without this face simply does not offer
   * `ws:` — which is the honest answer, and the same one the board gives.
   */
  workspaceTitle?: (workspaceId: string) => string
  /**
   * The vocabulary bridge, when this host can supply one.
   *
   * OPTIONAL for the same reason the workspace face is: a deployment without it
   * still works — the closed sets then keep the catalog's stricter reading — and
   * an absent face must degrade to 「the old behaviour」 rather than to a guess.
   */
  resolver?: ParamResolver
  now: () => number
  uuid: () => string
}

/* ── ONE tool schema ─────────────────────────────────────────────────────── */

/**
 * The tools below are the HOST's `ToolDefinition`, imported — a hand-written
 * copy of it compiles against itself and then fails on the first real
 * registration, which is what happened: `output` was simply absent, and
 * nothing in the tree could say so.
 *
 * Types only: `dependencies` stays empty, and the runtime the plugin loads
 * against is the host's own.
 */
export type { ToolDefinition, ToolOutputDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/**
 * RENDER AND PRESENTATION ARE NOT THE SAME FUNCTION, and collapsing them is
 * the mistake this split exists to prevent:
 *
 *  - `render` is what the MODEL reads. It is prose: the sentence, then the
 *    short numbers. A model reading a receipt should not have to find `#12`
 *    inside indented JSON — the plugin's own system prompt tells it to use
 *    short numbers, and this is where that instruction is carried out.
 *  - `presentationMeta` is what the CARD reads, computed for top-level calls
 *    only. Same values, different consumer.
 *
 * BOTH READ `value` AND NOTHING ELSE. Neither may recompute a field: a renderer
 * that derives its own answer hands the model something the declared schema
 * does not describe, and the model cannot tell which of the two is true.
 */
function text(parts: readonly string[]): ContentBlock[] {
  return [{ type: 'text', text: parts.filter(part => part !== '').join('\n') }]
}

/* ── the capability view, rendered from the catalog ──────────────────────── */

/** One action as the model reads it: what it is, what it costs, who may do it,
 *  and every parameter with its own condition spelled out. */
export interface CapabilityAction {
  readonly id: string
  readonly verb: string
  readonly domain: ActionDomain
  readonly lane: ActionLane
  readonly danger: ActionDanger
  readonly surface: ActionSurface
  readonly summary: string
  readonly params: Readonly<Record<string, {
    about: string
    required: boolean
    requiredWhen?: string
    appliesWhen?: string
    oneOf?: readonly string[]
  }>>
}

/** Render one parameter's rule. The catalog states three states and a schema
 *  renderer that collapsed them would print the wrong sentence:
 *  `optional: true` = may always be omitted; `requiredWhen` = may be omitted
 *  UNLESS the stated condition holds; neither = always required. So a
 *  conditional requirement must NOT render as "required" — that is how a model
 *  refuses to fill a field it was told it had to fill. */
function renderParam(spec: ParamSpec): CapabilityAction['params'][string] {
  return {
    about: spec.about,
    required: spec.optional !== true && spec.requiredWhen === undefined,
    ...(spec.requiredWhen === undefined ? {} : { requiredWhen: spec.requiredWhen }),
    ...(spec.appliesWhen === undefined ? {} : { appliesWhen: spec.appliesWhen }),
    ...(spec.oneOf === undefined ? {} : { oneOf: spec.oneOf }),
  }
}

/**
 * THE WHOLE CATALOG, rendered. One function, so the capability query, the tool
 * schema and any future surface cannot answer the question three ways.
 */
export function capabilityActions(): readonly CapabilityAction[] {
  return Object.entries(ACTIONS).map(([id, spec]) => ({
    id,
    verb: spec.verb,
    domain: spec.domain,
    lane: spec.lane,
    danger: spec.danger,
    surface: spec.surface,
    summary: spec.summary,
    params: Object.fromEntries(Object.entries(spec.params).map(([name, p]) => [name, renderParam(p)])),
  }))
}

/** What `taskboard_capabilities` answers: the model's own reach, stated first,
 *  so a caller that only wants to know "what may I do" reads two lines.
 *
 *  NARROWING IS THE POINT OF `topic`, and the reason is a cost measurement rather
 *  than tidiness: the full answer is ~7,000 characters (36 actions × their
 *  parameters) and the tool is documented as 「先查后做」, so EVERY write began by
 *  paying for the whole catalog. That structure is wrong — a caller about to move
 *  one card does not need the nine preset actions — so the answer can now be
 *  asked for in three sizes:
 *
 *   · no topic        — the reach (verbs, reachable, humanOnly) plus the action
 *                       IDS and their one-line summaries, no parameters
 *   · `topic: 'task'` — one domain, in full
 *   · `topic: 'task.create'` — one action, in full
 *
 *  The sizes are DERIVED from the same catalog, so a compact answer cannot omit
 *  an action the full one has: it is the same list, sliced.
 */
export function capabilityView(topic?: string): {
  verbs: readonly string[]
  reachable: readonly string[]
  humanOnly: readonly string[]
  actions: readonly CapabilityAction[]
  /** What this answer covered, echoed so a caller can tell a slice from the whole. */
  scoped?: string
  /** The domains an unscoped answer can be narrowed to. */
  domains?: readonly string[]
  /** How to ask for more, when this answer was narrowed. */
  hint?: string
} {
  const all = capabilityActions()
  const reach = {
    verbs: BOARD_VERBS,
    reachable: TOOL_ACTION_IDS,
    // Named, not omitted: a capability list that silently drops what the model
    // cannot do invites a turn spent discovering it.
    humanOnly: Object.keys(ACTIONS).filter(id => !TOOL_ACTION_IDS.includes(id as ActionId)),
  }
  const domains = [...new Set(all.map(action => action.domain))].sort()
  const said = (topic ?? '').trim()
  if (said === '') {
    // THE COMPACT DEFAULT: what may I do, and what is each thing called. No
    // parameters — those are what made the answer expensive, and most calls only
    // need to know which verb exists.
    return {
      ...reach,
      actions: all.map(action => ({ ...action, params: {} })),
      domains,
      hint: '这是摘要（只有动作名与一句话）。要看某个域或某个动作的完整参数：topic 给 "task" 或 "task.create"。',
    }
  }
  const exact = all.find(action => action.id === said)
  if (exact !== undefined) return { ...reach, actions: [exact], scoped: exact.id }
  const inDomain = all.filter(action => action.domain === said)
  if (inDomain.length > 0) return { ...reach, actions: inDomain, scoped: said, domains }
  /* THE ID PREFIX IS ALSO A TOPIC, and this is not charity.
   *
   * A domain is the DOCUMENT an action speaks about (`board` / `item` / `session` /
   * `preset`), while every reader of an action id sees the SUBJECT first
   * (`task.create` → `task`). Those are different vocabularies, and a caller that
   * asks for `task` means the task actions — refusing that because the catalog
   * files them under `board` would cost a turn to learn a distinction that buys it
   * nothing. The prefix match is exact, not fuzzy: a topic that is not a whole
   * leading segment does not match.
   *
   * The domain list still leads, so the canonical spelling is visible first. */
  const prefixed = all.filter(action => action.id.startsWith(`${said}.`))
  if (prefixed.length > 0) return { ...reach, actions: prefixed, scoped: said, domains }
  // AN UNKNOWN TOPIC IS ANSWERED, NOT REFUSED: the caller asked about something
  // this catalog does not group, and the useful reply is the list of groups it
  // does have — a refusal would cost a turn and teach it nothing.
  return {
    ...reach,
    actions: [],
    scoped: said,
    domains,
    hint: `没有「${said}」这个域或动作。可以给的值：${[...domains, ...all.map(action => action.id)].slice(0, 40).join(' / ')}`,
  }
}

/* ── the query tool's filter vocabulary, from the ONE search registry ────── */

/** Every `key:value` the board's own filter box can offer — derived by asking
 *  the registry itself, one key at a time. A key added there appears here with
 *  no edit on this side. */
export function enumeratedFilters(): readonly string[] {
  return QUALIFIER_KEYS.flatMap(key => completeBoardQuery(key))
}

/** The filter syntax, in the words BOTH registries use — and **both** is the
 *  point, not a nicety.
 *
 *  `taskboard_query`'s `filter` string is parsed by `matchItemQuery` for the item
 *  list AND by the board's own search, so the description has to cover both.
 *  Describe only the board's keys and the model is taught board keys (`has:*`,
 *  `is:*`) that the list silently treats as free words — a query that returns
 *  nothing and reports no error — while everything the list actually speaks
 *  (`status:`, `p1`–`p4`, `!1`–`!4`, `has:`, `#标签`) goes unmentioned.
 *  **A vocabulary taught by half is
 *  worse than none**: the model cannot tell 「no match」 from 「I used it wrong」.
 *
 *  Both halves are DERIVED from the registry that parses them, so a flag added to
 *  one appears in the description without anyone editing this file — which is the
 *  only arrangement in which the description cannot go stale quietly.
 */
export function filterHelp(): { keys: readonly string[]; values: readonly string[]; syntax: string } {
  return {
    keys: [...QUALIFIER_KEYS, ...itemQualifierVocabulary()],
    values: enumeratedFilters(),
    syntax: '空格分隔；`key:value` 是筛选，其余是字面搜索；未识别的 key 当普通文字处理，不会报错。看板与任务清单共用这一串，但**两边各认自己的一半**，所以请按要查的那一面挑词',
  }
}

/* ── receipts the model can read back ────────────────────────────────────── */

interface TaskRow { readonly title: string; readonly status: string }

/**
 * A CARD'S WRITTEN CONTENT, and what `detail: 'full'` adds to a brief row.
 *
 * The checklist's fields had no read path at all for as long as this tool
 * existed, which is the whole defect: a note-taking subsystem where a model can
 * write a body, a notes line and four steps and then cannot read any of them
 * back. It can only re-query and be handed a title. So the content the model can
 * WRITE is exactly the content it must be able to READ, and the read is the same
 * projection, not a summary of it.
 */
interface TaskDetail extends TaskRow {
  readonly description: string
  readonly prompt: string
}

interface ItemRow {
  readonly ref: string
  readonly id: string
  readonly title: string
  /**
   * The DERIVED status — what the reader sees, and what `status:inProgress`
   * filters on.
   *
   * Printing the STORED one is the same defect as a facet counting
   * by a different predicate than the list under it: a row hanging off a running
   * card filters into `status:inProgress` and then comes back printed as `open`,
   * with nothing in the answer saying the two are different questions. A model
   * that has just asked 「what is running」 must not be told the answer is empty.
   */
  readonly status: ItemStatusView
  /** The stored tier, for the caller that needs to know a row reads `inProgress`
   *  because its card is running. Never the one a filter compares. */
  readonly storedStatus: ItemStatus
  /** The linked card, or `undefined` — never a second copy of its title. */
  readonly taskId: string | undefined
}

/** What `detail: 'full'` adds to a brief checklist row: the whole row, minus
 *  its identity, which the brief row already carries. */
interface ItemDetail extends ItemRow {
  readonly body: string
  readonly notes: string
  readonly tags: readonly string[]
  /**
   * The tier as it is stored. Writable by the model (`item.create` /
   * `item.update` publish `priority`) and therefore readable — a field a caller
   * can set and cannot read back is a field it can only set by guessing.
   */
  readonly priority: ItemPriority
  readonly steps: readonly { readonly id: string; readonly text: string; readonly done: boolean }[]
  /** Millisecond stamps; read them as whole local days (see the catalog). */
  readonly startsAfter: number | undefined
  readonly dueAt: number | undefined
  readonly hardDueAt: number | undefined
  readonly progress: { readonly done: number; readonly total: number } | undefined
  /**
   * WHAT THE THREE DATES MEAN RIGHT NOW, in one word a caller can act on.
   *
   * A row can be 「已逾期 3 天」, 「今天到期」, 「还没到可开始的日子」, or — the case that
   * matters most — `contradiction`: its own three dates cannot all be true. The
   * interface has printed that verdict since `datePostureOf` existed; the model
   * got three bare timestamps and had to derive it, which it cannot do correctly
   * (the derivation has a precedence order and a local-day boundary).
   *
   * A READER THAT CANNOT SEE THE VERDICT CANNOT ACT ON IT: 「紧急、周五截止」 handed to
   * a model that only sees `dueAt: 1794…` is a deadline it has to compute, and a
   * contradiction looks exactly like a normal schedule.
   *
   * OPTIONAL because a row with no dates has no verdict — and because `compact`
   * omits it then, which is the same "absent, not undefined" rule every other
   * optional field here follows.
   */
  readonly datePosture?: string
}

/**
 * A card is named by its TITLE, and the board has no short number for cards —
 * so a title is the handle a person and a model can both say. Printing the
 * uuid instead would be printing an identifier the model can neither remember
 * nor read back. The checklist is the document that mints `#12`, so that is
 * where a number comes from, and it comes from the document.
 */
function taskRow(task: TaskRecord): TaskRow {
  return compact({ title: task.title, status: task.status })
}

/**
 * DROP every `undefined` FIELD, one level deep, and keep the rest.
 *
 * THE HOST'S TOOL PIPELINE REQUIRES LOSSLESS JSON, and `JSON.stringify` cannot
 * tell `{ a: undefined }` from `{}` — so a single undefined field makes the
 * whole answer fail with 「value is not lossless JSON」. That is what a checklist
 * row with no card did: `taskId: undefined` went into the object literal and
 * every query of a board containing one such row came back as a tool ERROR —
 * not a wrong row, the entire read.
 *
 * The repair is here rather than at each of the eight row builders because the
 * next optional field added anywhere would reintroduce it: `{...cond ? {} : {}}`
 * is a rule each site has to remember, and a helper they all call is a rule
 * nobody can forget. Values are otherwise untouched — `null` stays (`null` IS
 * lossless), so this cannot silently widen the shapes columns rely on.
 */
function compact<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T
}

/** The same row with its written content, for `detail: 'full'`. */
function taskDetailRow(task: TaskRecord): TaskDetail {
  return compact({ ...taskRow(task), description: task.description, prompt: task.prompt })
}

/**
 * An item's number is the document-minted one (`#12`), never its uuid — and its
 * status is the DERIVED one, read through the very function the panel reads, so
 * a query answer and a row on screen cannot disagree about the same row.
 *
 * `taskId` PRINTS THE CARD'S TITLE WHEN THE CARD IS KNOWN, and both halves of
 * that matter:
 *
 *  · The uuid is an identifier the model can neither remember nor say back, and
 *    printing it in a row contradicts this surface's own rule 「引用用短编号、
 *    不要用内部 id」 — a rule every linked row then broke.
 *  · The same field is what a WRITE accepts (`item.update`'s `taskId` resolves a
 *    title), so the value shown is the value expected back. Showing one and
 *    accepting the other teaches a model to paste a uuid into a field that only
 *    ever matches a title.
 *
 * A row hanging off a card this document cannot resolve keeps the raw id: 「there
 * is a link and I cannot name its target」 is a fact, and dropping the field would
 * report the row as unlinked.
 */
function itemRow(item: ItemRecord, cards?: ReadonlyMap<string, TaskStatus>, titles?: ReadonlyMap<string, string>): ItemRow {
  const cardTitle = item.taskId === undefined ? undefined : titles?.get(item.taskId)
  return compact({
    ref: `#${item.ref}`,
    id: item.id,
    title: itemTitleOf(item),
    status: derivedStatusOf(item, cards),
    storedStatus: item.status,
    /**
     * THE LINK, NAMED WHEN IT CAN BE AND MARKED WHEN IT CANNOT.
     *
     * A row hanging off a card this document cannot resolve keeps a value, because
     * 「there is a link and I cannot name its target」 is a fact and dropping the
     * field would report the row as unlinked. But printing the BARE uuid was a
     * fact in a shape the reader cannot act on: the model saw
     * `2e1254d5-7464-4f35-a1ba-2a1ae318ccf3` and could not tell a broken link from
     * an ordinary reference — one long identifier looks exactly like another.
     *
     * So the broken case says it is broken, and keeps enough of the id to be
     * quoted back. `null` is reserved for "linked, target unknown" — the value a
     * reader must not confuse with "not linked", which is the field being absent.
     */
    taskId: item.taskId === undefined
      ? undefined
      : cardTitle ?? `（已失效）${item.taskId.slice(0, 8)}…`,
  })
}

/** `taskId → title`, built once per query so a hundred rows cost one pass. */
function cardTitlesOf(tasks: readonly TaskRecord[]): ReadonlyMap<string, string> {
  return new Map(tasks.map(task => [task.id, task.title]))
}

/**
 * The date verdict as ONE READABLE SENTENCE, from the shared derivation.
 *
 * NOT a second judgement: every branch here is `datePostureOf`'s own verdict,
 * translated. The precedence (contradiction → gate → hard deadline → soft plan)
 * lives in that function, so a row cannot be 「还没到开始日」 on one surface and
 * 「已逾期」 on another.
 *
 * The contradiction branch names the PAIR, because 「日期有矛盾」 leaves the reader
 * with three candidates and no next step.
 * @param item - the row.
 * @param now - the reading clock, so two rows in one answer cannot disagree.
 * @returns the sentence, or undefined when the row carries no dates at all.
 */
function datePostureWordsOf(item: ItemRecord, now: number): string | undefined {
  const posture = datePostureOf(item, now)
  switch (posture.kind) {
    case 'none': return undefined
    case 'contradiction': {
      const a = DATE_FIELD_WORDS[posture.conflict.field] ?? posture.conflict.field
      const b = DATE_FIELD_WORDS[posture.conflict.limitField] ?? posture.conflict.limitField
      return `这组日期自相矛盾：${a} 晚于 ${b}`
    }
    case 'gated': return `还没到可开始的日子（${localDayOf(posture.startsAfter)} 起）`
    case 'hardOverdue': return `已过截止日 ${posture.days} 天`
    case 'hardSoon': return `截止日在 ${posture.days} 天内`
    case 'hardAhead': return `离截止日还有 ${posture.days} 天`
    case 'dueToday': return '今天到期'
    case 'behind': return `计划日已过 ${posture.days} 天`
    case 'upcoming': return `计划日在 ${posture.days} 天后`
  }
}

/** The same row with everything a reader typed, for `detail: 'full'`. */
function itemDetailRow(item: ItemRecord, cards?: ReadonlyMap<string, TaskStatus>, titles?: ReadonlyMap<string, string>, now?: number): ItemDetail {
  const read = itemRow(item, cards, titles)
  return compact({
    ...read,
    body: item.body,
    notes: item.notes,
    tags: [...item.tags],
    priority: item.priority,
    steps: item.steps.map(step => ({ id: step.id, text: step.text, done: step.done })),
    startsAfter: item.startsAfter,
    dueAt: item.dueAt,
    hardDueAt: item.hardDueAt,
    progress: itemProgressOf(item),
    // The clock is an ARGUMENT, never read inside: one answer, one `now`, so two
    // rows cannot disagree about whether a day has passed.
    ...now === undefined ? {} : { datePosture: datePostureWordsOf(item, now) },
  })
}
/* ── the deep card: everything the model may WRITE, readable ─────────────── */

/**
 * One card, as `detail: 'deep'` (or `of`) hands it over.
 *
 * THE FIELD LIST IS THE POINT, and it is derived from the same declarations the
 * writes come from: the six run-config keys, the schedule rule, the session
 * rules, the binds, the sessions. Before this existed, a card read as
 * `{ title, status }` — so the write surface was strictly LARGER than the read
 * surface. A model told to 「给这张卡加一条规则」 could not learn which sessions
 * the card had, and `rule.create` requires exactly that; the only remaining move
 * is to guess, or to ask the person to copy an id out of the interface.
 *
 * `sessions` carries titles because a session is addressed by its id and read by
 * its name. `rules` carries both for the same reason.
 */
interface TaskDeep extends TaskDetail {
  /** The same six fields as a nested record, for printing. */
  readonly runConfig: Readonly<Record<string, string>>
  /**
   * The schedule, with its optionals OMITTED rather than set to `undefined`.
   *
   * The declaration used to type them as `number | undefined`, and the row
   * builder wrote them literally — which is what made a board with ONE scheduled
   * card unreadable: `{ maxRuns: undefined }` is not lossless JSON, so the host
   * rejected the ENTIRE answer. The type now says what the value must be, so
   * putting the undefined back is a compile error rather than a runtime defect
   * that only shows up on a board somebody happens to have scheduled.
   */
  readonly schedule?: {
    readonly mode: 'cron' | 'chain'
    readonly cron: string
    readonly enabled: boolean
    readonly maxRuns?: number
    readonly runCount?: number
  }
  readonly rules?: readonly {
    readonly id: string
    readonly session: string
    readonly trigger: 'cron' | 'on-complete'
    readonly cron: string
    readonly send: string
    readonly enabled: boolean
    /** The words the rule sends, or a marker that it sends the card's own prompt. */
    readonly sends: string
  }[]
  readonly binds?: readonly string[]
  readonly sessions?: readonly {
    readonly session: string
    readonly title: string | null
    readonly rounds: number
    readonly unread: boolean
  }[]
  readonly attachments?: number
  readonly color?: string
  readonly createdAt?: number
  readonly updatedAt?: number
  readonly unread?: boolean
  readonly live?: string
}

/**
 * The deep projection of one card.
 *
 * EVERY FIELD IS EITHER COPIED OR DERIVED FROM A SHARED FUNCTION — nothing here
 * invents a judgement. `taskUnviewed`, `taskLiveStateOf`'s inputs and the round
 * count all come from the modules the board itself reads, so a query cannot
 * disagree with the panel about whether a card is unread or live.
 *
 * Absent fields are OMITTED, not set to undefined (`compact`), because the host's
 * tool pipeline requires lossless JSON and one undefined field fails the whole
 * answer rather than one column.
 * @param task - the card.
 * @param sessionTitles - `sessionId → title`, when this host knows one.
 * @param live - the card's live state, or undefined when it cannot be known.
 */
function taskDeepRow(
  task: TaskRecord,
  sessionTitles?: ReadonlyMap<string, string>,
  live?: string,
): TaskDeep {
  const runConfig: Record<string, string> = {}
  for (const key of RUN_CONFIG_KEYS) {
    const value = task[key]
    if (typeof value === 'string' && value !== '') runConfig[key] = value
  }
  const rounds = new Map<string, number>()
  for (const round of task.executions) {
    if (round.sessionId === undefined) continue
    rounds.set(round.sessionId, (rounds.get(round.sessionId) ?? 0) + 1)
  }
  return compact({
    ...taskDetailRow(task),
    /* THE SIX RUN-CONFIG FIELDS, BY THEIR OWN NAMES, beside the nested copy.
     *
     * `runConfig` is the convenient shape for printing; the FLAT names are the
     * ones a WRITE takes (`task.update` publishes `provider`, `model`, …). A
     * projection that only nested them left the reader translating
     * `runConfig.provider` back into `provider` — and a tool that can write what
     * it cannot read BY NAME makes its caller guess, which is the whole defect
     * `verify-read-write-parity` exists for.
     *
     * Written out rather than spread from RUN_CONFIG_KEYS on purpose: the parity
     * gate reads STRUCTURE, and a runtime-built object has no keys to read. A
     * seventh run-config field therefore fails two ways at once — this literal
     * does not mention it, and the gate says so. */
    workspaceId: task.workspaceId,
    provider: task.provider,
    model: task.model,
    reasoningEffort: task.reasoningEffort,
    agentPreset: task.agentPreset,
    permission: task.permission,
    runConfig,
    /* SPREAD PER FIELD, NEVER A LITERAL WITH `undefined` INSIDE.
     *
     * `compact` drops undefined fields of the object it is handed, ONE LEVEL
     * DEEP. So `{ maxRuns: task.schedule.maxRuns }` inside this literal survived
     * it: the schedule object itself is not undefined, its CHILD is. The host's
     * tool pipeline then applied its own lossless-JSON rule to the WHOLE answer
     * — `{ maxRuns: undefined }` round-trips to `{}`, which is not the same
     * value — and every read of a board holding ONE scheduled card came back as
     * a tool ERROR rather than a wrong row.
     *
     * The repair is per field rather than a recursive `compact`, and the choice
     * is deliberate: this project's shape is to make a structure's fields
     * VISIBLE at the site that builds it. A recursive compactor would fix this
     * object and silently change what every other row means, and the next
     * optional field added anywhere would be back to "remember to ask". */
    schedule: task.schedule === undefined ? undefined : compact({
      // `as const` because `compact` widens a literal's type through its generic
      // return — the row is a projection, and the union is a fact about the
      // document, so it is asserted here rather than widened away.
      mode: (task.schedule.mode === 'chain' ? 'chain' : 'cron') as 'cron' | 'chain',
      cron: task.schedule.cron ?? '',
      enabled: task.schedule.enabled === true,
      ...task.schedule.maxRuns === undefined ? {} : { maxRuns: task.schedule.maxRuns },
      ...task.schedule.runCount === undefined ? {} : { runCount: task.schedule.runCount },
    }),
    rules: task.rules === undefined || task.rules.length === 0 ? undefined : task.rules.map(rule => compact({
      id: rule.id,
      session: rule.sessionId,
      trigger: rule.trigger === 'on-complete' ? 'on-complete' as const : 'cron' as const,
      cron: rule.cron ?? '',
      send: rule.send === 'steer' ? 'steer' : 'queue',
      enabled: rule.enabled === true,
      // 「送什么」 is the one field a caller can act on without a second read.
      sends: rule.usePrompt === true ? '这张卡自己的执行 Prompt' : (rule.instruction ?? ''),
    })),
    binds: taskBindsOf(task).length === 0 ? undefined : taskBindsOf(task).map(bind =>
      bind.kind === 'session' ? `会话：${sessionTitles?.get(bind.sessionId) ?? bind.sessionId}` : `工作区：${bind.workspaceId}`),
    sessions: relatedSessionIdsOf(task, undefined, undefined).length === 0 ? undefined
      : relatedSessionIdsOf(task, undefined, undefined).map(fact => compact({
        session: fact.sessionId,
        title: sessionTitles === undefined ? null : sessionTitles.get(fact.sessionId) ?? null,
        rounds: rounds.get(fact.sessionId) ?? 0,
        unread: sessionUnviewedOf(task, fact.sessionId),
      })),
    // The count, never the bytes: a card's pictures belong to the attachment
    // store, and a query that inlined them would rebuild the 1.9 MB document in
    // the model's context one card at a time.
    attachments: attachmentTotalOf(task),
    color: task.color,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    unread: taskUnviewed(task),
    live,
  })
}

/**
 * How many images and files a card's execution prompt carries, or `undefined`
 * when it carries none.
 *
 * ONE reader of all three attachment ages (`attachmentsOf`), which is the only
 * place the two legacy shapes and the current one are joined — a second reader
 * here would count a card's pictures differently from the `.1 MB` measure the
 * interface shows.
 */
function attachmentTotalOf(task: TaskRecord): number | undefined {
  const counts = attachmentCountsOf(attachmentsOf(task))
  const total = counts.images + counts.files
  return total === 0 ? undefined : total
}

/**
 * The ONE place a card is looked up by what a caller said.
 *
 * A card is named by its TITLE, and titles are not unique — two cards called
 * 「收尾」 is an ordinary thing to have. The old lookup was
 * `tasks.find(t => t.id === of || t.title === of)`, which SILENTLY picked the
 * first: the model said 「把收尾移到已完成」, one of the two moved, the receipt
 * said 「已生效」, and nothing anywhere mentioned there had been two. A wrong
 * answer that looks like a right one is the exact failure mode this surface is
 * being rebuilt around.
 *
 * So a title that matches more than one card is a REFUSAL that lists them, and a
 * caller that meant one of them says which. The uuid keeps working (a caller that
 * has one has it for real), and a title wins over nothing.
 * @param tasks - the board.
 * @param spoken - what the caller said: a title, or an id.
 * @returns the card, or the sentence explaining which cards it could have meant.
 */
export function resolveCard(
  tasks: readonly TaskRecord[],
  spoken: unknown,
): { kind: 'found'; task: TaskRecord } | { kind: 'missing' } | { kind: 'ambiguous'; matches: readonly TaskRecord[] } {
  const said = String(spoken ?? '').trim()
  if (said === '') return { kind: 'missing' }
  const byId = tasks.find(task => task.id === said)
  if (byId !== undefined) return { kind: 'found', task: byId }
  const matches = tasks.filter(task => task.title.trim() === said)
  if (matches.length === 0) return { kind: 'missing' }
  if (matches.length === 1) return { kind: 'found', task: matches[0] as TaskRecord }
  return { kind: 'ambiguous', matches }
}

/** The refusal sentence for an ambiguous title, naming every candidate. */
export function ambiguousCardWhy(spoken: unknown, matches: readonly TaskRecord[]): string {
  const named = matches.slice(0, 10).map(task => {
    const where = task.status
    const since = localDayOf(task.createdAt)
    return `「${task.title}」（在 ${where}，${since} 建的）`
  }).join('、')
  return `有 ${matches.length} 张卡都叫「${String(spoken)}」：${named}。要动哪一张？把标题改到唯一，或者先 task.update 给它们改成不同的名字。`
}


/* ── op resolution: the catalog decides what exists and who may do it ────── */

/** The kind a report is filed under, read from the CATALOG's verb — the one
 *  classification in this system. The verb→kind table lives in the catalog
 *  (`VERB_KIND`), so a verb added there cannot fall through to a default. */
function kindOf(id: string, ok: boolean, unchanged: boolean): OpReport['kind'] {
  if (!ok) return 'failed'
  if (unchanged) return 'unchanged'
  const verb = ACTIONS[id as ActionId]?.verb
  // An op the catalog does not know has no kind of its own; the catalog's own
  // table answers for every verb it declares, and anything else is reported
  // as an update — the one kind that says 「something happened」.
  return verb === undefined ? 'updated' : VERB_KIND[verb]
}

/**
 * The kind a report is filed under, decided from the report's FIELDS.
 *
 * The catalog's verb says which kind of change this was; the report's own
 * fields say whether there WAS one. **Neither is read out of the detail
 * sentence**: a receipt that classified itself by its own wording turns one
 * rewording into a wrong kind, a wrong first failure and a wrong summary —
 * with every functional test still green, because the wording was the only
 * thing that changed.
 * @param report - the report as the batch runner built it.
 * @returns the kind.
 */
export function kindOfReport(report: Omit<OpReport, 'kind'>): OpReport['kind'] {
  if (report.skipped === true) return 'skipped'
  // A refused relay is not an effect either: the engine lane's own status is
  // the field that says so, and reading it here keeps the classification off
  // the sentence. It is ALSO not a failure — the op was legal, the seat holder
  // simply cannot perform it — so it stays out of both `failed` and the
  // effect kinds by riding the document lane's "nothing moved" answer.
  if (report.outcome?.lane === 'engine' && report.outcome.status === 'unsupported') return 'unchanged'
  // "DID ANYTHING MOVE" HAS ONE HOME PER LANE: the document outcome carries it
  // for the ops that build one, and the purge branch — which predates outcomes
  // — still reports it on the report itself. Both are read, and neither is
  // allowed to win by default.
  const movedNothing = report.outcome?.lane === 'document'
    ? report.outcome.unchanged === true
    : report.unchanged === true
  return kindOf(report.op, report.ok, movedNothing)
}

/**
 * The rows the engine ACCEPTED but has not run yet.
 *
 * Accepted is not executed: a card that renders these as done is lying, and
 * the summary that counts them as effects is lying in a bigger way.
 * @param reports - the batch's reports.
 * @returns the titles of the accepted-but-pending rows.
 */
export function enginePendingOf(reports: readonly OpReport[]): string[] {
  const pending: string[] = []
  for (const report of reports) {
    if (report.ok && report.title !== undefined && isEngineLane(report.outcome, 'queued')) pending.push(report.title)
  }
  return pending
}

/**
 * The rows the relay REFUSED because the live engine cannot perform them.
 *
 * A separate list from {@link enginePendingOf} on purpose: 「等引擎上线」 and
 * 「这个页面做不了」 are different facts with different next moves (wait vs.
 * reload / use another device), and one list holding both would push the reader
 * toward the wrong one.
 */
export function engineUnsupportedOf(reports: readonly OpReport[]): string[] {
  const refused: string[] = []
  for (const report of reports) {
    if (report.ok && report.title !== undefined && isEngineLane(report.outcome, 'unsupported')) refused.push(report.title)
  }
  return refused
}

/** Whether an outcome is the engine lane in one particular relay state. */
function isEngineLane(outcome: OpOutcome | undefined, status: CommandRelayStatus['status']): boolean {
  return outcome !== undefined && outcome.lane === 'engine' && outcome.status === status
}

/**
 * The op the batch stopped at: the first failure that was actually ATTEMPTED.
 *
 * A skipped op is not a failure — it never ran — so pointing the summary at
 * one would blame an op for something that did not happen to it.
 * @param reports - the batch's reports.
 * @returns the first real failure, or undefined when there was none.
 */
export function firstFailureOf(reports: readonly OpReport[]): OpReport | undefined {
  return reports.find(report => !report.ok && report.skipped !== true)
}

/** The host's own JSON value type, DERIVED from the projection's own
 *  signature rather than imported from wherever it happens to live: one
 *  derivation, so a host change moves both at once. */
type HostJson = Parameters<NonNullable<ToolDefinition['output']['presentationMeta']>>[1]

/** The batch in the tool's OWN vocabulary, for the tool card to narrow. Not an
 *  envelope: it is the same words the model reads, so the person and the model
 *  cannot be told two different stories about the same batch. */
function presentationOf(result: ExecuteResult): HostJson {
  // The projection is persisted VERBATIM as JSON, so it is built as plain
  // JSON: the internal rows are `readonly` and the host's `JsonValue` is not,
  // and that difference is the honest one — this value gets serialized.
  return {
    dryRun: result.dryRun,
    // The single most important word here: a rehearsal that renders as "added
    // 3 items" tells the person something was written that was not.
    persisted: !result.dryRun,
    ok: result.ok,
    summary: result.summary,
    counts: result.counts,
    items: result.changed?.items ?? [],
    tasks: result.changed?.tasks ?? [],
    // Accepted, not executed — a card that renders these as "已执行" lies.
    enginePending: result.enginePending,
    // Refused, not even accepted: the seat holder cannot perform the carrier.
    // Its own field because its own next move (reload / another device).
    engineUnsupported: result.engineUnsupported,
    reports: result.reports.map(report => ({ ...report })),
  } as unknown as HostJson
}

/** Which of the two synced documents an op moved. */
export type ActionDocument = 'board' | 'items'

/** What each one is called in a receipt the model reads. */
const DOCUMENT_LABEL: Readonly<Record<ActionDocument, string>> = {
  board: '看板',
  items: '清单',
}

/**
 * The sentence for an op that landed, and the ONLY place 「已生效」 is written.
 *
 * One document is the historical sentence and stays exactly as it was: the
 * subject-less form is honest when there is one subject. Two documents get their
 * subjects named, because 「已生效」 about a promote that wrote the card and lost
 * the link is a claim about a half that the reader cannot see from the receipt.
 * A rehearsal says 会写入 for the same reason — a receipt that reads as a
 * completed write inside a dry run is the one line this tool must never print.
 */
function landedWord(dryRun: boolean, moved: readonly ActionDocument[]): string {
  if (moved.length <= 1) return '已生效。'
  return `${dryRun ? '会写入' : '已写入'}${moved.map(doc => DOCUMENT_LABEL[doc]).join('与')}两份文档。`
}

export interface OpReport {
  /** The op's own words back, so a report points at something. */
  readonly op: string
  readonly ok: boolean
  /** Which kind of change this was, from the catalog's verb — the only
   *  classification in the system, so a card and the model read one thing. */
  readonly kind: ActionKind | 'unchanged' | 'failed' | 'skipped'
  /** The short number and title this op touched, when it touched one. */
  readonly ref?: string
  readonly title?: string
  /**
   * WHICH DOCUMENTS ACTUALLY MOVED, and it is here because an action that writes
   * two documents cannot be reported by a subject-less 「已生效」.
   *
   * `item.promote` is the one: it creates a card AND links the row. The two
   * commits are separate, so a medium that takes the first and refuses the
   * second leaves the document in a half state — and a receipt saying
   * 「没写进去」 about the whole op is how a reader learns that this tool's
   * failure sentences do not mean what they say. A two-document action cannot
   * be reported by a subject-less 「已生效」.
   *
   * One document moved is the ordinary case and stays implicit; only an op that
   * moved two has to name them.
   */
  readonly documents?: readonly ActionDocument[]
  /**
   * THE OP WAS NOT EXECUTED: the batch stopped before it, or the call was
   * cancelled. It is a field because the sentence that says so is prose, and
   * prose can be reworded — a receipt that classifies itself by reading its
   * own wording turns one rewording into a wrong answer with nothing red.
   */
  readonly skipped?: boolean
  /**
   * THE HOST TOOK NO CHANGE: the row already looked like this. A field for the
   * same reason as {@link skipped}.
   */
  readonly unchanged?: boolean
  /**
   * WHERE THIS OP LANDED, as a value rather than as a sentence.
   *
   * The receipt used to carry a single `queued` boolean, and the boolean could
   * not express the case that mattered: a live engine that does not implement
   * the carrier. That one is neither "done" nor "queued", and the two-state
   * vocabulary had nowhere to put it, so it was reported as done.
   *
   * Every branch below assigns exactly one of these, and the sentence the model
   * reads is RENDERED from it — so 「已生效」 can only come out of the branch
   * that really wrote, and 「没有执行」 can only come out of a branch that
   * really did not.
   */
  readonly outcome?: OpOutcome
  /** What happened, or what to change. Never a bare error code. Rendered
   *  FROM {@link outcome} for the engine lane, so the two cannot disagree. */
  readonly detail: string
}

/**
 * One op's landing place. THREE lanes, because the batch has three:
 *
 *  · `document` — the host wrote a document. Only this lane may be counted as
 *    an effect;
 *  · `engine` — a command was relayed, and the STATUS says what the relay did
 *    with it. `broadcast` still is not "done": the engine took the request;
 *  · `none` — nothing was written and nothing was sent, with a reason.
 */
export type OpOutcome =
  | {
    readonly lane: 'document'
    /** Which documents the write landed in — the two-document op names both. */
    readonly wrote: readonly ActionDocument[]
    /** True when the write changed nothing (the row already looked like this). */
    readonly unchanged?: true
  }
  | {
    readonly lane: 'engine'
    readonly status: CommandRelayStatus['status']
    /** Which carrier, and — for `unsupported` — the one the page lacks. */
    readonly carrier: BoardCommandCarrier
  }
  | { readonly lane: 'none'; readonly why: 'skipped' | 'refused' | 'rehearsed' }

/** Why an op cannot run, in the words the catalog itself uses. */
export function refuseOp(id: string): { ok: false; detail: string } {
  const spec = ACTIONS[id as ActionId]
  if (spec === undefined) {
    // The COUNT is read from the table, never typed. A typed number disagrees
    // with `BOARD_VERBS` the moment a verb is added, and every refusal then tells
    // the model a count the list under it contradicts — and a model that checks
    // the count finds the mismatch and stops trusting the rest of the line.
    return { ok: false, detail: `没有 ${id} 这个动作。可用动作见 taskboard_capabilities，动词只有这 ${BOARD_VERBS.length} 个：${BOARD_VERBS.join(' / ')}` }
  }
  if (spec.surface === 'ui') {
    return { ok: false, detail: `「${id}」只有人能做：${spec.summary}` }
  }
  return { ok: false, detail: `${id} 不可用。` }
}

/** Read one parameter's value out of a payload, refusing an absent one with the
 *  correction attached rather than a type error. */
function paramOf(payload: Record<string, unknown>, name: string): unknown {
  return payload[name]
}

/**
 * The declared parameter a mistyped key most likely meant, for the correction.
 *
 * Absent when nothing is close, because a confident wrong guess about the intent
 * is worse than no guess: `q` is two edits from neither `of` nor `title`, and
 * telling a caller it probably meant `of` sends them to fix the wrong thing.
 * The budget is 2 — enough for a transposition or a dropped letter (`proivder`,
 * `stauts`), short enough that unrelated short names never collide.
 * @param said - the key the caller sent.
 * @param declared - every parameter the action takes.
 * @returns the nearest declared key, or undefined when none is close.
 */
function nearestKey(said: string, declared: readonly string[]): string | undefined {
  let best: string | undefined
  let bestDistance = Infinity
  for (const name of declared) {
    const distance = editDistanceAtMost(said, name, 2)
    if (distance < bestDistance) {
      bestDistance = distance
      best = name
    }
  }
  return bestDistance <= 2 ? best : undefined
}

/**
 * Levenshtein distance, abandoned once it exceeds `limit`.
 *
 * The early exit is what makes this cheap enough to run over every declared
 * parameter for every mistyped key: parameter names are short and usually differ
 * in the first couple of characters, so most pairs bail out in the first row.
 * @param a - one string.
 * @param b - the other.
 * @param limit - the distance past which the answer stops mattering.
 * @returns the distance, or `limit + 1` when it is larger.
 */
function editDistanceAtMost(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowBest = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost)
      current.push(value)
      if (value < rowBest) rowBest = value
    }
    if (rowBest > limit) return limit + 1
    previous = current
  }
  return previous[b.length]!
}

/** The one required-parameter check, driven by the catalog's own conditions.
 *  A conditional requirement cannot be decided from the payload alone (it
 *  names a fact about another field), so those are reported as a reminder
 *  rather than guessed at. */
function checkParams(id: ActionId, payload: Record<string, unknown>, resolver?: ParamResolver): string | undefined {
  const spec = ACTIONS[id]
  /* A KEY THE CATALOG DOES NOT HAVE IS REFUSED, NOT DROPPED.
   *
   * This loop used to walk only the parameters the catalog DECLARES — so a
   * misspelled key was never looked at by anything. `provider` typed as
   * `proivder` produced a card with no provider, a receipt that said 「已生效」,
   * and no sentence anywhere connecting the two. The model's next turn was built
   * on the belief that it had set something it had not.
   *
   * THE SUGGESTION IS THE POINT. A refusal that only says 「不认识的参数」 sends the
   * model looking for a different spelling by trial; naming the nearest declared
   * parameter turns it into one correction. This is the same correction the
   * catalog's own refusals carry, and the reason the check lives here rather
   * than in the JSON schema: the host's schema subset supports `properties` but
   * `payload` is published as a bare object (one discriminated union of 36
   * branches would be carried on EVERY request, which costs more than it saves).
   *
   * A key that names something the action does not take is a CALLER MISTAKE, not
   * a value error, so it is reported before any value is judged: reporting 「status
   * 只能是 …」 about a `stauts` typo would send the caller to fix a value that was
   * already right.
   */
  const declared = Object.keys(spec.params)
  const unknown = Object.keys(payload).filter(key => key !== 'op' && !declared.includes(key))
  if (unknown.length > 0) {
    const described = unknown.slice(0, 5).map(key => {
      const near = nearestKey(key, declared)
      return near === undefined ? `「${key}」` : `「${key}」（是不是 ${near}？）`
    })
    return `${id} 不认识 ${described.join('、')} 这个参数，所以什么都没写。这个动作的参数只有：${declared.join(' / ')}`
  }
  for (const [name, p] of Object.entries(spec.params)) {
    const value = paramOf(payload, name)
    const missing = value === undefined || value === null || value === ''
    if (!missing) {
      if (p.oneOf !== undefined && !p.oneOf.includes(String(value))) {
        // THE RESOLVER GETS FIRST REFUSAL. A closed set is the one place the two
        // vocabularies collided: the catalog's `about` names the READER's words
        // and `oneOf` holds the STORED ones, so a caller that followed the
        // description was refused by a list it had never been shown. The resolver
        // reads the human spellings into the stored value, and the payload is
        // REWRITTEN so what the gate accepts is what the writer stores — a gate
        // that accepted 进行中 and let it through unchanged would put a word in a
        // field typed `TaskStatus`.
        const stored = resolveParamValue(id, name, value, p, resolver)
        if (stored === undefined) {
          return `${name} 只能是 ${p.oneOf.join(' / ')}，收到的是「${String(value)}」`
        }
        payload[name] = stored
      }
      continue
    }
    if (p.optional === true) continue
    // `requiredWhen` is a CONDITION in prose ("required unless the trigger is
    // cron"), and this function cannot evaluate prose. Demanding the field
    // anyway would refuse every call the condition does not apply to; the
    // action's own case is the one that knows the condition, and it checks it
    // with real facts before writing. So a conditional requirement is carried
    // to the case, not enforced here.
    if (p.requiredWhen !== undefined) continue
    return `${name} 必填：${p.about}`
  }
  return undefined
}

/**
 * The resolver face this module takes, when the host has one.
 *
 * Declared structurally and passed in (never imported as a value from core, never
 * as a host service) because it must work in tests and in a deployment where the
 * workspace registry is absent: absent = the resolver only knows the built-in
 * vocabularies, which is the honest degradation.
 */
export interface ParamResolver {
  /**
   * Read one value into its stored spelling.
   * @param kind - the vocabulary.
   * @param value - what the caller said.
   * @returns the stored value, or undefined when it is not readable.
   */
  resolve(kind: ResolveKind, value: unknown): string | undefined
}

/**
 * Which vocabulary a parameter speaks, when it is a closed set the resolver knows.
 *
 * NOT derived from the parameter's NAME alone, and that is deliberate: `status`
 * appears on both documents with the same vocabulary, while `permission` and
 * `agentPreset` are the deployment's and cannot be assumed. The table therefore
 * pairs an action's parameter with a kind only where the vocabulary is REALLY the
 * one the resolver owns; everything else keeps the catalog's stricter reading.
 */
const PARAM_VOCABULARIES: Readonly<Record<string, ResolveKind>> = {
  status: 'status',
  priority: 'priority',
}

/**
 * Read one closed-set parameter through the resolver, MUTATING the payload.
 *
 * MUTATION IS THE POINT. A resolver that only VALIDATED would leave the human
 * spelling in the payload, and the writer downstream would store it — so 进行中
 * would be accepted by the gate and then written to a field typed `TaskStatus`.
 * The value is rewritten in place to the stored spelling, so what the gate
 * accepted is exactly what lands in the document.
 *
 * @param id - the action, for the refusal sentence.
 * @param name - the parameter.
 * @param value - what the caller said.
 * @param spec - its declaration.
 * @param resolver - the face, when one was supplied.
 * @returns the stored value, or undefined when the resolver cannot read it (which
 *   leaves the caller's own refusal to fire).
 */
function resolveParamValue(
  _id: string,
  name: string,
  value: unknown,
  spec: ParamSpec,
  resolver: ParamResolver | undefined,
): string | undefined {
  const kind = PARAM_VOCABULARIES[name]
  if (kind === undefined || spec.oneOf === undefined || resolver === undefined) return undefined
  const stored = resolver.resolve(kind, value)
  if (stored === undefined) return undefined
  return spec.oneOf.includes(stored) ? stored : undefined
}

/**
 * WHAT RUN CONFIGURATION THIS CARD WILL ACTUALLY USE — said out loud.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 *
 * Six of the seven cards on this machine were created with NO run configuration,
 * and every receipt said only 「已生效」. The person then had a card that would run
 * on a workspace, a model, an effort and a permission nobody had chosen and
 * nobody had been told about — the platform's defaults, silently.
 *
 * The catalog now says which of the six must be asked about (a wrong workspace or
 * permission is damage, not preference) and which may take a default. The other
 * half of that bargain is this: A DEFAULT IS ACCEPTABLE, AN UNDISCLOSED DEFAULT
 * IS NOT. So the receipt names the fields the caller DID set and says plainly
 * that the rest are the host's.
 *
 * @param id - the action, so only a card-creating action pays this line.
 * @param task - the card as written, which already carries the resolved config.
 * @param dryRun - a rehearsal has no card, and saying 「会这样跑」 would invent one.
 * @returns the sentence to append, or nothing.
 */
function createdConfigNote(id: ActionId, task: TaskRecord | undefined, dryRun: boolean): string {
  if (id !== 'task.create' || task === undefined || dryRun) return ''
  const given = RUN_CONFIG_KEYS.filter(key => {
    const value = task[key]
    return typeof value === 'string' && value !== ''
  })
  if (given.length === 0) {
    // THE LOUD CASE. Nothing was chosen, so the card will run on whatever this
    // deployment happens to default to — which the caller cannot see and the
    // person did not pick. Naming the two that matter most is what makes the
    // next turn able to fix it.
    return `\n运行配置：一个都没指定，会全部走宿主默认（工作区与权限也在其中——这两项选错会跑到别的目录、或改坏文件）。要指定就先 task.update 补上 ${RUN_CONFIG_MUST_ASK.join(' / ')}。`
  }
  const named = given.map(key => `${key}=${String(task[key])}`).join('、')
  const rest = RUN_CONFIG_DEFAULTED.filter(key => !given.includes(key))
  return rest.length === 0
    ? `\n运行配置：${named}（全部由你指定）。`
    : `\n运行配置：${named}（你指定的）；其余 ${rest.join(' / ')} 用的是宿主默认。`
}

/* ── the batch runner ────────────────────────────────────────────────────── */

export interface ExecuteRequest {
  readonly ops: readonly { op: string; payload?: unknown }[]
  readonly dry_run?: boolean
  /**
   * The caller's promise that a retried batch is the SAME batch.
   *
   * A model that retries after a timeout cannot tell "my write did not land"
   * from "my write landed and the answer was lost", so it retries — and without
   * a key the retry is a second write. This is what makes the retry safe.
   *
   * A STRING, and the published schema says so. It was once declared and never
   * read, and while it was unread a promise nobody kept was worse than no
   * promise, because the caller was told it was protected; it is read now (see
   * the batch runner) and the schema publishes its real shape, because a key
   * published as a boolean arrives as `true`, fails the reader's string guard,
   * and fails open — silently, with the schema still claiming the protection.
   */
  readonly idempotencyKey?: string
}

export interface ExecuteResult {
  readonly dryRun: boolean
  readonly ok: boolean
  /** One report per op that was attempted, in order. */
  readonly reports: readonly OpReport[]
  /** The line a person reads: how many landed, where it stopped. */
  readonly summary: string
  readonly boardRevision: number
  readonly itemsRevision: number
  /** Only on a real run: the boards that moved, with their short numbers. */
  readonly changed?: { readonly tasks: readonly TaskRow[]; readonly items: readonly ItemRow[] }
  /** The batch in the tool's OWN vocabulary, so a card can render it without
   *  re-reading prose. The kinds come from the catalog's `verb`, never from a
   *  name list written here. */
  readonly counts: Readonly<Record<ActionKind | 'unchanged' | 'failed' | 'skipped', number>>
  /** Rows this op handed to the engine while no replica held the seat. They
   *  are ACCEPTED, not done — a card that renders them as "已执行" is lying. */
  readonly enginePending: readonly string[]
  /** Rows the relay REFUSED because the live engine does not implement their
   *  carrier. A separate field from {@link enginePending}, not folded into it:
   *  「等引擎上线」 and 「这个页面做不了」 have different next moves (wait vs.
   *  reload / another device), and one list holding both points the reader at
   *  the wrong one. */
  readonly engineUnsupported: readonly string[]
  /**
   * Set when this answer is an earlier one's, replayed because the caller
   * retried with the same key. Nothing ran this time — and saying so is the
   * whole point, because a retry that silently re-executed looks exactly like
   * one that did not.
   */
  readonly replayed?: true
}

/**
 * How long a key's answer is replayable, and how many are remembered.
 *
 * Both are deliberately short. The thing being protected is a retry that
 * follows a timeout, which is seconds; a key remembered for a day is a key
 * that silently swallows a legitimate second attempt hours later, and a caller
 * re-issuing the same batch on purpose would get the old answer with no
 * indication that the new one was ignored. The window covers the failure it
 * exists for and closes soon after.
 */
const IDEMPOTENCY_TTL_MS = 10 * 60_000
const IDEMPOTENCY_MAX_ENTRIES = 64

/** Key → the answer that key already earned. Insertion-ordered, pruned lazily. */
const idempotencyReplies = new Map<string, { readonly at: number; readonly result: ExecuteResult }>()

/**
 * The earlier answer for this key, if one is still inside its window.
 *
 * Expiry is checked on READ rather than by a timer, so there is no clock to
 * own and nothing to dispose — a background sweeper would outlive the calls it
 * serves and would be a second thing to leak.
 */
function readIdempotentReply(key: string, now: number): ExecuteResult | undefined {
  const hit = idempotencyReplies.get(key)
  if (hit === undefined) return undefined
  if (now - hit.at > IDEMPOTENCY_TTL_MS) {
    idempotencyReplies.delete(key)
    return undefined
  }
  return hit.result
}

/** Remember this key's answer, evicting the oldest keys when the map is full. */
function rememberIdempotentReply(key: string, result: ExecuteResult, now: number): void {
  idempotencyReplies.delete(key)
  idempotencyReplies.set(key, { at: now, result })
  while (idempotencyReplies.size > IDEMPOTENCY_MAX_ENTRIES) {
    const oldest = idempotencyReplies.keys().next()
    if (oldest.done === true) break
    idempotencyReplies.delete(oldest.value)
  }
}

/** Forget every remembered key. For tests, and for nothing else. */
export function clearIdempotentReplies(): void {
  idempotencyReplies.clear()
}

/**
 * Run a batch. Order, stop-at-first-failure, no rollback, report every op —
 * and `dry_run` rehearses the SAME code path against a clone, so a rehearsal
 * that disagrees with the real thing cannot happen.
 */
/** The four carriers, as the CATALOG names them. Read structurally so the tool
 *  never has to name an action to know what to build. */
type RelayKind = 'run' | 'comment' | 'session.create' | 'session.rename'

/** What each carrier does, for the receipt — a receipt that says "已交给引擎"
 *  alone is what made a queued request read as a finished one. */
const RELAY_VERB: Record<RelayKind, string> = {
  'run': '执行一次',
  'comment': '发一条话',
  'session.create': '建一条会话',
  'session.rename': '改会话名',
}

/**
 * Build the command the CATALOG asked for, from the payload the model sent.
 * Dispatch is by `relay` and `command.type` alone: if the two ever disagree
 * that is a real inconsistency, and the refusal says so rather than guessing
 * which one to believe.
 */
function buildRelay(
  relay: RelayKind,
  payload: Record<string, unknown>,
  doc: BoardDoc,
): { command: BoardCommand; title: string } | string {
  const of = String(payload.of ?? '')
  const findCard = (): TaskRecord | undefined => doc.tasks.find(task => task.id === of || task.title === of)
  const card = (): TaskRecord | undefined => {
    const found = findCard()
    return found ?? undefined
  }
  const missingCard = `卡 ${of} 不存在。看板上现在有：${doc.tasks.slice(0, 20).map(taskRow).map(row => row.title).join('，') || '（一张卡都没有）'}`
  const clientId = 'model'
  switch (relay) {
    case 'run': {
      const found = card()
      if (found === undefined) return missingCard
      /* THE TRIGGER IS THE CALLER'S, and hardcoding it here is the exact shape
       * of a declared-but-unread parameter: the catalog publishes
       * `trigger: manual | schedule | chain`, a caller that sends `schedule`
       * gets `manual` on the record, and **nothing anywhere says the value was
       * dropped** — the run happens, the receipt is green, and the attribution
       * on the card is wrong forever. */
      const requested = String(payload.trigger ?? '')
      const trigger: 'manual' | 'schedule' | 'chain' =
        requested === 'schedule' || requested === 'chain' ? requested : 'manual'
      // The FIRST MESSAGE, when the caller brought one: the checklist hands a row
      // of its own to a card whose prompt may say something else entirely, and the
      // run reads this instead. Absent = the card's own prompt, unchanged.
      const kickoff = String(payload.kickoff ?? '').trim()
      /* **载具只带它明说带的东西。** 这里按字段白名单地拼命令：`item.ask` 交给载具的
         附件（那一行自己的图片与文件）必须在这里被**点名搬过去**，否则它到这一步就没了
         ——而屏上不会有人说一句话，模型与界面也会对同一件事给出两个结果。 */
      const carried = normalizeAttachmentRefs(payload.attachments) ?? []
      return {
        command: {
          type: 'run', taskId: found.id, trigger, clientId,
          ...kickoff === '' ? {} : { kickoff },
          ...carried.length === 0 ? {} : { attachments: carried },
        },
        title: found.title,
      }
    }
    case 'comment': {
      const found = card()
      if (found === undefined) return missingCard
      const sessionId = String(payload.session ?? '')
      if (sessionId === '') return '要跟哪个会话说话？给一个 session。'
      const text = String(payload.text ?? '').trim()
      const carried = normalizeAttachmentRefs(payload.attachments) ?? []
      // 与别处同一条律：**只有附件、没有字，是一条真消息**（`isBlankMessage`）。
      if (text === '' && carried.length === 0) return '要发的话是空的。'
      /* QUEUE OR STEER IS THE CALLER'S CALL, and the catalog publishes the
       * choice. Absent = queue: a queued line can still be cancelled, a steer
       * already said cannot be unsaid, so the recoverable one is the default. */
      const send = payload.send === 'steer' ? 'steer' : 'queue'
      return {
        command: {
          type: 'comment', taskId: found.id, sessionId, text, clientId, send,
          ...carried.length === 0 ? {} : { attachments: carried },
        },
        // The receipt must say which of the two happened: 「说进去了」 about a
        // line still waiting for the run to settle is the same class of lie as
        // calling an accepted run a finished one.
        title: `${found.title}（${send === 'steer' ? '插话' : '排队'}）`,
      }
    }
    case 'session.create': {
      const found = card()
      if (found === undefined) return missingCard
      /* THE NAME TRAVELS BESIDE THE CONFIG, not inside it.
       *
       * `readRunConfig` filters through `RUN_CONFIG_KEYS` — six run settings —
       * so a `title` riding that object is dropped without a word, and the new
       * session came out named after its card. A name is not a run setting: it
       * is a separate field on the command, and it is read here as one. */
      const named = String(payload.title ?? '').trim()
      return {
        command: {
          type: 'session.create',
          taskId: found.id,
          config: readRunConfig(payload),
          clientId,
          ...named === '' ? {} : { title: named },
        },
        title: named === '' ? found.title : `${found.title} → ${named}`,
      }
    }
    case 'session.rename': {
      const sessionId = String(payload.session ?? '')
      if (sessionId === '') return '要改名的会话是哪个？给一个 session。'
      const title = String(payload.title ?? '').trim()
      if (title === '') return '新名字不能是空的。'
      return { command: { type: 'session.rename', sessionId, title, clientId }, title }
    }
  }
}

export async function runBatch(deps: ToolDeps, request: ExecuteRequest, exec?: ToolRunContext): Promise<ExecuteResult> {
  const now = deps.now()
  const board = deps.board()
  const reports: OpReport[] = []
  // The caller's cancellation, observed between ops. The registry fuses the
  // caller's signal back before the body, so this IS the user's abort — and a
  // batch that ignored it would keep writing after the person walked away.
  const signal: AbortSignal | undefined = exec?.signal
  if (signal !== undefined && signal.aborted) {
    return {
      dryRun: request.dry_run === true,
      ok: false,
      reports: [{ op: '(batch)', kind: 'failed', ok: false, detail: '这次调用已经被取消，一个字节都没有落盘。' }],
      summary: '没有执行：调用已取消。',
      boardRevision: 0,
      itemsRevision: 0,
      counts: { created: 0, updated: 0, moved: 0, deleted: 0, unchanged: 0, failed: 1, skipped: 0 },
      enginePending: [],
      engineUnsupported: [],
    }
  }
  if (board === undefined || !board.available) {
    const refused: OpReport = { op: '(batch)', kind: 'failed', ok: false, detail: '看板存储不可用，这次写操作一个字节都没落。换一次连接或重启宿主再试。' }
    reports.push(refused)
    return {
      dryRun: request.dry_run === true,
      ok: false,
      reports,
      summary: '没有执行：存储不可用。',
      boardRevision: 0,
      itemsRevision: 0,
      counts: { created: 0, updated: 0, moved: 0, deleted: 0, unchanged: 0, failed: 1, skipped: 0 },
      enginePending: [],
      engineUnsupported: [],
    }
  }

  // A retry carrying the same key gets the answer that key already earned, and
  // nothing runs. It is read AFTER the two guards below, not before them: a
  // batch refused for cancellation or for missing storage never wrote anything,
  // so remembering it would hand back a refusal to a retry that should succeed
  // — the cache is a promise about WRITES, and a batch that wrote none has
  // nothing to promise.
  const idempotencyKey = typeof request.idempotencyKey === 'string' ? request.idempotencyKey.trim() : ''
  if (idempotencyKey !== '' && request.dry_run !== true) {
    const earlier = readIdempotentReply(idempotencyKey, now)
    if (earlier !== undefined) {
      return { ...earlier, replayed: true, summary: `同一个幂等键的第一次结果，没有重复执行。${earlier.summary}` }
    }
  }

  // The clone every op works on. A real run commits it per op (so each op is
  // durable on its own); a dry run never touches the medium at all.
  let doc: BoardDoc = board.getDoc()
  let items: ItemsDoc = board.getItemsDoc()
  const changedTasks: TaskRecord[] = []
  const changedItems: ItemRecord[] = []
  const enginePending: string[] = []
  const raw: Array<Omit<OpReport, 'kind'>> = []
  let failed = false

  for (const step of request.ops) {
    if (signal !== undefined && signal.aborted) {
      raw.push({ op: step.op, ok: false, skipped: true, detail: '未执行：这次调用已经被取消。' })
      continue
    }
    if (failed) {
      raw.push({ op: step.op, ok: false, skipped: true, detail: '未执行：上一条失败后本批停止。' })
      continue
    }
    const id = step.op as ActionId
    if (!TOOL_ACTION_IDS.includes(id)) {
      const refusal = refuseOp(step.op)
      raw.push({ op: step.op, ok: false, detail: refusal.detail })
      failed = true
      continue
    }
    const payload = (step.payload ?? {}) as Record<string, unknown>
    const problem = checkParams(id, payload, deps.resolver)
    if (problem !== undefined) {
      raw.push({ op: step.op, ok: false, detail: problem })
      failed = true
      continue
    }
    const spec = ACTIONS[id]
    // Engine actions are REQUESTS, never document writes: the engine holds the
    // carriers and performs them, and whatever they change lands on the board
    // from there. So they are decided in ONE place — `applyOne` — and every
    // carrier shares one body, because "what does this action do" is a
    // question only the catalog can answer (`spec.relay`), and four copies of
    // the same request would be four places to keep in step.
    const next = applyOne(doc, items, id, payload, deps, now)
    if (typeof next === 'string') {
      raw.push({ op: step.op, ok: false, detail: next })
      failed = true
      continue
    }
    if (next.relay === true || next.carrier !== undefined) {
      /* WHICH CARRIER IS TWO CASES, and they differ in KIND rather than in style.
       *
       *  · `carrier` — the OP says which, because the carrier is a fact about the
       *    DATA (item.ask starts a card that has no conversation and speaks into
       *    one that has). The catalog has one `relay` per action and cannot
       *    express a carrier that depends on the state of the card.
       *  · `relay: true` — the CATALOG says which (`spec.relay`): for these the
       *    carrier is a fact about the ACTION, so the catalog's field is its one
       *    home and this file must not keep a second copy of the mapping. */
      const relay = next.carrier?.kind ?? (spec as { relay?: RelayKind }).relay
      const carried = next.carrier?.payload ?? payload
      if (relay === undefined) {
        raw.push({ op: step.op, ok: false, detail: `「${id}」在目录里没有 relay 派发，所以这里明确拒绝——转发它会跑错东西。` })
        failed = true
        continue
      }
      const built = buildRelay(relay, carried, doc)
      if (typeof built === 'string') {
        raw.push({ op: step.op, ok: false, detail: built })
        failed = true
        continue
      }
      if (request.dry_run === true) {
        raw.push({
          op: step.op,
          ok: true,
          title: built.title,
          outcome: { lane: 'none', why: 'rehearsed' },
          detail: `会经引擎${RELAY_VERB[relay]}。`,
        })
        continue
      }
      /* THREE ANSWERS, and the third one is why this is a switch and not a
       * boolean. `broadcast` still is NOT "done" — the engine took the request,
       * the work has not happened — so the sentence says what was handed over,
       * not what was accomplished. */
      const relayed = board.submitCommand(built.command)
      raw.push({
        op: step.op,
        ok: true,
        title: built.title,
        outcome: { lane: 'engine', status: relayed.status, carrier: built.command.type },
        detail: relayed.status === 'broadcast'
          ? `已交给引擎${RELAY_VERB[relay]}——它收到请求了，工作还没做完。`
          : relayed.status === 'queued'
            ? `已受理（${RELAY_VERB[relay]}），引擎当前不在线，将在引擎上线后执行。`
            // 第三种状态：有人在线，但它做不了这件事。既不广播也不排队——排队只会
            // 把它晚一点再丢一次，那是一句延迟的谎。
            : `没有执行：当前持席位的浏览器不支持「${relayed.carrier}」这条载具（它实现的是更早的一版）。这一条什么都没发生——刷新页面或换一台设备再来一次。`,
      })
      continue
    }

    // A THIRD KIND, beside the relay and the document write, and it is here
    // because a purge has NO move in the merge grammar: the text it erases lives
    // in a field of the host's own tombstone map, which a commit — rows plus
    // deletions — cannot carry and a replica cannot see. So the batch asks the
    // service for it, the same `purgeItem` the panel's HTTP route calls, and
    // reports from what came back. Routing it through the commit path instead
    // would be the exact failure this tool must not ship: the receipt would say
    // 「已生效」 about words that are still on the disk.
    if (next.purge !== undefined) {
      const said = `#${refOf(payload.of)}`
      if (request.dry_run === true) {
        // A rehearsal touches nothing, so it says what WOULD go — and for this one
        // action the tense is the whole message, because it is the only action on
        // this surface that leaves nothing behind to undo.
        raw.push({
          op: step.op,
          ok: true,
          ref: said,
          detail: `会写入。（${said} 的正文与删除记录会被清掉，撤不回来）`,
        })
        continue
      }
      let purged: ItemPurge
      try {
        purged = await board.purgeItem({ kind: 'id', id: next.purge }, 'model')
      } catch (error) {
        raw.push({
          op: step.op,
          ok: false,
          detail: `没写进去：${messageOf(error)}正文还在，没有回滚。`,
        })
        failed = true
        continue
      }
      if (purged.kind === 'notDeleted') {
        // The service found a live row behind that name. Reported rather than
        // smoothed into a success: the batch must not say it destroyed something
        // it did not destroy.
        raw.push({
          op: step.op,
          ok: false,
          ref: said,
          detail: `清单里的 ${said} 没有删过，没有可清除的删除记录。要删它用 item.delete（那条还能找回）。`,
        })
        failed = true
        continue
      }
      // The service's document is the truth, including when it is the SAME one
      // it already had: that identity is how a purge that found nothing left to
      // erase is told apart from one that erased something.
      const wasMoved = purged.doc !== items
      items = purged.doc
      raw.push({
        op: step.op,
        ok: true,
        ...(purged.kind === 'purged' ? { ref: `#${purged.erased.ref}`, title: itemTitleOf(purged.erased) } : {}),
        ...(wasMoved ? { documents: ['items'] as const } : {}),
        ...(wasMoved ? {} : { unchanged: true }),
        detail: `${wasMoved ? '已生效。' : '这一条已经是这样了，没有改动。'}${purged.kind === 'purged' ? `（#${purged.erased.ref} 的正文与删除记录已清掉，撤不回来）` : '（这一条已经清干净了，没有可清除的内容）'}`,
      })
      continue
    }

    // Everything that is not a relay arrives here as a document change, and it
    // travels the same merge grammar every device writes through.
    const { doc: nextDoc, items: nextItems, task, item } = next
    // DID THE HOST ACTUALLY TAKE IT? `applyCommit` returns the SAME OBJECT when
    // nothing moved — that is the signal the service itself uses — so identity is
    // the whole question, and the draft was never entitled to answer it.
    //
    // The merge discards a write whose stamp another device already passed: a
    // delete carrying a `baseUpdatedAt` that is now older than the host row, a
    // section stamp older than a section written in the meantime. A receipt
    // built from the draft reports 「已生效」 about the discarded write, lists the
    // row under 受影响的, and builds the model's next turn on a fact that did not
    // happen. Deciding
    // the receipt from the returned document is the only arrangement in which
    // 「已生效」 means the medium holds it.
    // THREE OUTCOMES, NOT TWO, and collapsing two of them is how this lied.
    // `noop` is 「there was nothing to change」 — a real answer about a real
    // situation. `declined` is 「the host was asked and did not take it」 — which
    // happened because another device's stamp outranked ours, and which the model
    // must hear as ITS OWN failure to land rather than as success.
    // DID THE DOCUMENT MOVE? Not 「is the returned object the one I built」 — that
    // question only the real writer can answer, and a test double that re-applies
    // the commit legitimately produces an equal-but-different object, so asking it
    // would make every write look declined. The question that is answerable
    // everywhere is 「is the document the same one it was before I asked」: the
    // service returns the SAME object when the merge kept its copy, so a write that
    // another device outranked reads here as `unchanged` — which is the fact.
    let noop = next.unchanged === true
    let declined = false
    // Which documents this op actually got written. Tracked OUTSIDE the try so a
    // throw on the SECOND commit still knows the first one landed — that is the
    // whole reason this list exists.
    const moved: ActionDocument[] = []
    if (request.dry_run !== true) {
      /* A COMMIT THAT REFUSES IS A REPORT, NOT A THROWN TOOL CALL.
         `DocumentService.commit` rejects when the medium will not take the write —
         which is correct, and it is what stopped a full disk from being reported
         as saved. But this loop had no catch, so that rejection escaped as an
         exception: the tool call failed rather than answering, and the reader saw
         a red tool card instead of 「这一条没写进去」.

         The batch contract already says what happens on failure — 「首个失败即停」 and
         every attempted op is reported in order — so a commit that cannot land is
         reported as the failure it is, and the ops after it are not attempted. That
         keeps the promise the envelope already makes instead of breaking it with an
         exception the reader cannot act on. */
      try {
        if (nextDoc !== doc) {
          const before = doc
          doc = await board.commit(boardCommitOf(before, nextDoc))
          if (doc === before) declined = true
          else moved.push('board')
        }
        if (nextItems !== items) {
          const before = items
          items = await board.commitItems(itemsCommitOf(before, nextItems))
          if (items === before) declined = true
          else moved.push('items')
        }
      } catch (error) {
        // The half that DID land is named, because "没写进去" on its own reads as
        // "nothing happened" and the reader is then looking at a card that exists.
        const kept = moved.length === 0
          ? ''
          : `${moved.map(doc2 => DOCUMENT_LABEL[doc2]).join('与')}那一份已经写进去了，没有回滚。`
        raw.push({
          op: step.op,
          ok: false,
          ...(moved.length === 0 ? {} : { documents: moved }),
          detail: `没写进去：${messageOf(error)}${kept}`,
        })
        // `failed` is the loop's OWN stop signal, so the ops after this one are
        // reported by the same branch that reports them after any other failure —
        // one place decides what 「未执行」 means, not two.
        failed = true
        continue
      }
    } else {
      // A rehearsal reports what WOULD be written, so it tracks the same two
      // documents — 「会写入两份」 is the sentence that makes a two-document
      // action's rehearsal worth reading.
      if (nextDoc !== doc) moved.push('board')
      if (nextItems !== items) moved.push('items')
      doc = nextDoc
      items = nextItems
    }
    const landed = !noop && !declined
    if (task !== undefined && landed) changedTasks.push(task)
    if (item !== undefined && landed) changedItems.push(item)
    raw.push({
      op: step.op,
      ok: true,
      ...(task === undefined ? {} : { title: task.title }),
      ...(item === undefined ? {} : { ref: `#${item.ref}`, title: itemTitleOf(item) }),
      ...(moved.length === 0 ? {} : { documents: moved }),
      outcome: {
        lane: 'document',
        wrote: moved,
        ...(noop || declined ? { unchanged: true } : {}),
      },
      detail: `${declined
        ? '这一条没有改成——另一台设备刚改过它，这次没写进去。'
        : noop ? '这一条已经是这样了，没有改动。' : landedWord(request.dry_run === true, moved)}${createdConfigNote(id, task, request.dry_run === true)}${next.note ?? ''}`,
    })
  }

  // The kind is the catalog's word for the op, not a name list written here,
  // so a new verb cannot be missing from it. And it is decided from the
  // report's FIELDS — an op that was skipped or that changed nothing says so,
  // and no reading of its own sentence is involved. A receipt that classified
  // itself by its wording would turn one rewording into a wrong kind, a wrong
  // first failure and a wrong summary, with every functional test still green.
  reports.push(...raw.map(report => ({ ...report, kind: kindOfReport(report) })))
  /* THE COUNTS THE SUMMARY IS BUILT FROM, each read off a FIELD.
   *
   * 「已生效」 used to be `done.length - enginePending.length` — one subtraction
   * standing in for four different facts. It could not express the third relay
   * state at all, so an op the engine refused counted as an effect. Now each
   * number comes from its own predicate over the same outcome value, and a
   * sentence can only be built from numbers that were actually measured. */
  const wrote = reports.filter(report => report.ok
    && report.outcome?.lane === 'document'
    && report.outcome.unchanged !== true
    && report.outcome.wrote.length > 0).length
  const relayed = reports.filter(report => isEngineLane(report.outcome, 'broadcast')).length
  const unsupported = engineUnsupportedOf(reports).length
  // The engine-pending set is read BEFORE the summary is written, because the
  // summary must not call an accepted run an effect.
  enginePending.push(...enginePendingOf(reports))
  const counts = { created: 0, updated: 0, moved: 0, deleted: 0, unchanged: 0, failed: 0, skipped: 0 }
  for (const report of reports) counts[report.kind] += 1

  const done = reports.filter(report => report.ok)
  const firstFailure = firstFailureOf(reports)
  const ok = firstFailure === undefined
  // The clauses the summary is assembled from, each one a measured fact and
  // each one able to stand alone: a batch of pure writes prints only the first,
  // and a batch of pure relays prints only the relay clauses.
  const clauses = [
    wrote > 0 ? `${wrote} 条已生效（文档已经写进去了）` : '',
    relayed > 0 ? `${relayed} 条已交给引擎，工作还没做完` : '',
    enginePending.length > 0 ? `${enginePending.length} 条已受理（${enginePending.join('、')}）但引擎当前不在线，将在引擎上线后执行` : '',
    unsupported > 0 ? `${unsupported} 条没有执行——持席位的浏览器不支持这条载具，那一条什么都没发生` : '',
  ].filter(clause => clause !== '')
  const summary = request.dry_run === true
    ? `演练：${done.length} 条会生效${ok ? '' : `，第 ${reports.indexOf(firstFailure!) + 1} 条过不去：${firstFailure!.detail}`}。没有落盘。`
    : ok
      ? `${clauses.length === 0 ? '这一批没有产生任何写入。' : `${clauses.join('；')}。`}`
      : `前 ${done.length} 条已生效，第 ${reports.indexOf(firstFailure!) + 1} 条失败：${firstFailure!.detail}。已生效的不回滚。`
  const unsupportedTitles = engineUnsupportedOf(reports)
  const result: ExecuteResult = {
    dryRun: request.dry_run === true,
    ok,
    reports,
    summary,
    boardRevision: doc.revision,
    itemsRevision: items.revision,
    counts,
    enginePending,
    engineUnsupported: unsupportedTitles,
    ...(request.dry_run === true ? {} : {
      // The same derivation the query answers with, over the document as it
      // stands AFTER the batch — so a receipt and a query cannot print two
      // different statuses for the same row.
      changed: {
        tasks: changedTasks.map(taskRow),
        items: changedItems.map(row => itemRow(row, cardStatusMapOf(doc.tasks))),
      },
    }),
  }
  // The key is remembered only now, after the writes, and only for a real run:
  // a batch that half-failed still burned revisions, and a retry carrying the
  // same key must get THAT answer rather than running the ops again. A rehearsal
  // is not remembered, because a caller is free to rehearse the same batch
  // twice on purpose and the second rehearsal should reflect the document as it
  // is now.
  if (idempotencyKey !== '' && request.dry_run !== true) rememberIdempotentReply(idempotencyKey, result, now)
  return result
}

/** The commit that carries one op: the whole view plus the ids this op claims
 *  as its own edits. Only the changed rows are claimed — an untouched baseline
 *  copy that claimed itself would overwrite whatever the engine wrote since. */
function boardCommitOf(before: BoardDoc, after: BoardDoc): BoardCommit {
  const view: BoardView = {
    tasks: after.tasks,
    cruise: after.cruise.value,
    schedulePresets: after.schedulePresets.value,
    runPresets: after.runPresets.value,
  }
  return {
    clientId: 'model',
    tasks: after.tasks,
    // Claims are decided by OBJECT IDENTITY, not by a timestamp comparison: an
    // op that produced a new row is this op's edit even when the two stamps
    // happen to be equal (the same clock reading is not "unchanged"), and a
    // timestamp diff quietly drops exactly those claims — after which the
    // merge keeps the host's copy and the op reports success over a write
    // that never happened.
    changed: after.tasks.filter(task => before.tasks.find(prev => prev.id === task.id) !== task).map(task => task.id),
    deleted: before.tasks.filter(task => !after.tasks.some(next => next.id === task.id)).map(task => ({ id: task.id, baseUpdatedAt: task.updatedAt })),
    cruise: { value: view.cruise, at: after.cruise.at },
    schedulePresets: { value: view.schedulePresets, at: after.schedulePresets.at },
    runPresets: { value: view.runPresets, at: after.runPresets.at },
  }
}

function itemsCommitOf(before: ItemsDoc, after: ItemsDoc): ItemsCommit {
  return {
    clientId: 'model',
    items: after.items,
    changed: after.items.filter(item => before.items.find(prev => prev.id === item.id) !== item).map(item => item.id),
    deleted: before.items.filter(item => !after.items.some(next => next.id === item.id)).map(item => ({ id: item.id, baseUpdatedAt: item.updatedAt })),
  }
}

/** Apply one document-lane op to a document pair, or explain why not. */
function applyOne(
  doc: BoardDoc,
  items: ItemsDoc,
  id: ActionId,
  payload: Record<string, unknown>,
  deps: ToolDeps,
  now: number,
): { doc: BoardDoc; items: ItemsDoc; task?: TaskRecord; item?: ItemRecord; unchanged?: true; note?: string; relay?: true; carrier?: { kind: RelayKind; payload: Record<string, unknown> }; purge?: string } | string {
  const edited = (task: TaskRecord): TaskRecord => ({ ...task, updatedAt: now })
  const findTask = (): TaskRecord | undefined => doc.tasks.find(task => task.id === payload.of || task.title === payload.of)
  const findItem = (): ItemRecord | undefined => {
    const key = refOf(payload.of)
    return items.items.find(item => item.id === payload.of) ?? items.items.find(item => String(item.ref) === key)
  }
  /**
   * The three actions the catalog marks `semantic` go through the SHARED pure
   * function the catalog names — the same one the UI's button calls. A refusal
   * carries its own reason and is returned as a business failure; an unchanged
   * result is reported as "nothing moved" rather than dressed as a change.
   */
  const through = (result: TransitionResult): string | { task: TaskRecord; unchanged?: true } =>
    !result.ok ? result.why : result.task === last ? { task: result.task, unchanged: true } : { task: result.task }
  let last: TaskRecord | undefined
  switch (id) {
    case 'task.move': {
      last = findTask()
      if (last === undefined) return `卡 ${String(payload.of)} 不存在。`
      const target = String(payload.status) as TaskStatus
      /* THE SAME GATE THE INTERFACE'S DRAG WALKS THROUGH.
       *
       * 「一张还在跑的卡能不能换栏」是一个问题，而人按拖动与模型说「移到待办」
       * 必须拿到同一个答案——所以这里走的是界面走的那道门（`resolveCardDrop`，
       * 界面的拖动与键盘移动都调它），不是一份「像界面的」判断。 */
      const drop = resolveCardDrop(last, target)
      if (drop.kind === 'reject') return BUSY_REASON
      if (drop.kind === 'run') {
        return '「进行中」是执行器落的栏：卡跑起来自己会过去，人和模型都不能把它拖过去。'
      }
      /* **落位走界面的那一条路。** 只改 `status` 的字段，卡在目标栏里的名次就还是原来那一栏
       * 的键——于是「人拖出来的顺序」与「模型挪出来的顺序」不一样，而键就是屏上的顺序。
       * **位置**归 `applyCardOrder`（`landCardInColumn` 里面就是它），**内容**归
       * `moveTaskToStatus`——界面拖动（`controller.moveTask`）走的是同一对共享函数。 */
      const transitioned = moveTaskToStatus(last, target, now)
      if (!transitioned.ok) return transitioned.why
      const tasks = landCardInColumn(doc.tasks, last.id, target, undefined, now, transitioned.task)
      if (tasks === doc.tasks) return { doc, items, task: last, unchanged: true }
      return { doc: { ...doc, tasks }, items, task: tasks.find(task => task.id === last!.id) ?? last }
    }
    case 'task.approve': {
      last = findTask()
      if (last === undefined) return `卡 ${String(payload.of)} 不存在。`
      /* THE SHARED APPROVE, and it is the whole action: the busy gate, the read
       * clock and the move to 「已完成」 live in one function, which the
       * interface's 通过 button calls too. The model approving a card and a
       * person approving it are then the same act, not two acts that happen to
       * look alike. */
      const approved = through(approveTaskToStatus(last, now))
      if (typeof approved === 'string') return approved
      const tasks = doc.tasks.map(task => (task.id === last!.id ? approved.task : task))
      return approved.unchanged === true ? { doc, items, task: last, unchanged: true } : { doc: { ...doc, tasks }, items, task: approved.task }
    }
    case 'task.schedule': {
      last = findTask()
      if (last === undefined) return `卡 ${String(payload.of)} 不存在。`
      const armed = through(armSchedule(last, payload as Parameters<typeof armSchedule>[1], now))
      if (typeof armed === 'string') return armed
      const tasks = doc.tasks.map(task => (task.id === last!.id ? armed.task : task))
      return armed.unchanged === true ? { doc, items, task: last, unchanged: true } : { doc: { ...doc, tasks }, items, task: armed.task }
    }
    case 'session.remove': {
      last = findTask()
      if (last === undefined) return `卡 ${String(payload.of)} 不存在。`
      // The shared function asks whether the row it PRODUCED still has working
      // sessions left, so the reader is handed that row and answers from the
      // board's own session derivation — never a second activity rule here.
      // The three answers stay distinct: nothing running is `idle`, something
      // running is `running`, and a session this host cannot see is `unknown`
      // (which may not be read as idle, or a live session would be droppable).
      const removed = through(removeSessionFromTask(last, String(payload.session ?? ''), now, (current) =>
        livenessOf(deps.sources, current)))
      if (typeof removed === 'string') return removed
      const tasks = doc.tasks.map(task => (task.id === last!.id ? removed.task : task))
      return removed.unchanged === true ? { doc, items, task: last, unchanged: true } : { doc: { ...doc, tasks }, items, task: removed.task }
    }
    case 'board.cruise': {
      // The cruise section: a switch and a concurrency budget. The bound is
      // the board's OWN clamp — a second bound here is a second answer to
      // "how many may run at once", and the first one to drift is the one the
      // engine reads.
      const current = doc.cruise.value
      const next: CruiseValue = {
        ...current,
        ...(payload.enabled === undefined ? {} : { enabled: payload.enabled === true || payload.enabled === 'true' }),
        ...(payload.limit === undefined ? {} : { limit: clampCruiseLimit(Number(payload.limit)) }),
      }
      const same = current.enabled === next.enabled && current.limit === next.limit
      return same
        ? { doc, items, unchanged: true }
        : { doc: { ...doc, cruise: { value: next, at: now } }, items }
    }
    case 'rule.delete': {
      last = findTask()
      if (last === undefined) return `卡 ${String(payload.of)} 不存在。`
      const rules = last.rules ?? []
      const target = String(payload.rule ?? '')
      const kept = rules.filter(rule => rule.id !== target)
      if (kept.length === rules.length) {
        // A refusal has to be actionable, not a wall: say where to look.
        return `这张卡上没有 id 为 ${target} 的会话规则。用 taskboard_query 先看这张卡挂了哪些会话。`
      }
      const next: TaskRecord = { ...last, rules: kept, updatedAt: now }
      return { doc: { ...doc, tasks: doc.tasks.map(task => (task.id === last!.id ? next : task)) }, items, task: next }
    }
    case 'session.reorder': {
      last = findTask()
      if (last === undefined) return `卡 ${String(payload.of)} 不存在。`
      const session = String(payload.session ?? '')
      const order = (last.sessionsOrder ?? []).filter(id => id !== session)
      const before = payload.beforeId === undefined ? undefined : String(payload.beforeId)
      const at = before === undefined ? order.length : order.indexOf(before)
      // No `beforeId` means the tail, and an unknown one means the tail too —
      // both are "put it last", never "drop it".
      order.splice(at < 0 ? order.length : at, 0, session)
      const same = (last.sessionsOrder ?? []).join('|') === order.join('|')
      if (same) return { doc, items, task: last, unchanged: true }
      const next: TaskRecord = { ...last, sessionsOrder: order, updatedAt: now }
      return { doc: { ...doc, tasks: doc.tasks.map(task => (task.id === last!.id ? next : task)) }, items, task: next }
    }
    case 'task.run':
    case 'task.comment':
    case 'session.create':
    case 'session.rename': {
      // ONE body for every relayed action, because it is the same request: the
      // engine holds the carriers and performs it, so nothing here writes a
      // document. WHICH carrier this one rides is `spec.relay`, read by the
      // caller — naming an action in here to decide anything would put the
      // catalog's mapping into this file a second time, and the two copies
      // drift the first time a carrier moves. The card a carrier names, if it
      // names one at all, is the caller's question, not this case's.
      return { doc, items, relay: true }
    }
    case 'task.cancelComment': {
      // The three preconditions are THREE FIELDS, not a "state" value: a
      // comment round still QUEUED has no `injectedAt` and no `endedAt`. Once
      // injected the field simply has no way back — so the refusal says that,
      // because the likeliest thing a model tries is withdrawing a comment
      // that has already been sent.
      const found = findTask()
      if (found === undefined) return `卡 ${String(payload.of ?? '')} 不存在。`
      const target = String(payload.round ?? '')
      const round = found.executions.find(entry => entry.id === target)
      if (round === undefined) return `这张卡上没有 id 为 ${target} 的轮次。`
      if (round.comment === undefined) return `${target} 不是一条评论轮次，没法撤。`
      if (round.injectedAt !== undefined) return `${target} 已经注入会话了，撤不回来——字段上没有撤回这条路。`
      if (round.endedAt !== undefined) return `${target} 已经结束了，撤不回来。`
      const next: TaskRecord = { ...found, executions: found.executions.filter(entry => entry.id !== target), updatedAt: now }
      return { doc: { ...doc, tasks: doc.tasks.map(task => (task.id === found.id ? next : task)) }, items, task: next }
    }
    case 'task.duplicate': {
      const found = findTask()
      if (found === undefined) return `卡 ${String(payload.of)} 不存在。`
      // A copy inherits the card's TEXT and its schedule CONFIG, never its
      // automation state: rules and rounds belong to the sessions THIS card
      // owns, and copying them would silently automate sessions the new card
      // does not have. The schedule comes along disarmed for the same reason.
      const schedule = found.schedule === undefined ? undefined : { ...found.schedule, enabled: false, runCount: 0, nextRunAt: undefined, lastTriggeredAt: undefined }
      const copy: TaskRecord = {
        ...found,
        id: deps.uuid(),
        executions: [],
        rules: undefined,
        viewedAt: undefined,
        removedSessions: undefined,
        sessionsOrder: undefined,
        hidden: undefined,
        schedule,
        // Attachments deep-copied: sharing the array would let one card's
        // edit rewrite the other's pictures.
        promptImages: found.promptImages === undefined ? undefined : found.promptImages.map(image => ({ ...image })),
        promptFiles: found.promptFiles === undefined ? undefined : found.promptFiles.map(file => ({ ...file })),
        status: 'todo',
        createdAt: now,
        updatedAt: now,
      }
      return { doc: { ...doc, tasks: [...doc.tasks, copy] }, items, task: copy }
    }
    case 'session.bind': {
      const found = findTask()
      if (found === undefined) return `卡 ${String(payload.of)} 不存在。`
      const session = payload.session === undefined ? undefined : String(payload.session)
      const workspace = payload.workspace === undefined ? undefined : String(payload.workspace)
      if (session === undefined && workspace === undefined) return '要给这张卡挂来源，给一个 session 或一个 workspace。'
      const binds = taskBindsOf(found)
      const bind: TaskBind = session === undefined
        ? { kind: 'workspace', workspaceId: workspace as string }
        : { kind: 'session', sessionId: session }
      const keyOf = (b: TaskBind): string => (b.kind === 'session' ? `s:${b.sessionId}` : `w:${b.workspaceId}`)
      if (binds.some(entry => keyOf(entry) === keyOf(bind))) return '这个来源已经挂在这张卡上了。'
      // A workspace bind is a source/config association, not a subscription:
      // it never expands to its members and does not follow them as they come
      // and go. That is the folder case, deliberately.
      const next: TaskRecord = { ...found, binds: [...binds, bind], bind: undefined, updatedAt: now }
      return { doc: { ...doc, tasks: doc.tasks.map(task => (task.id === found.id ? next : task)) }, items, task: next }
    }
    case 'rule.create': {
      const found = findTask()
      if (found === undefined) return `卡 ${String(payload.of)} 不存在。`
      const sessionId = String(payload.session ?? '')
      if (sessionId === '') return '要给哪个会话建规则？给一个 session。'
      const rules = found.rules ?? []
      // One rule per session, by the law the board already holds: a second
      // definition for one session is two triggers racing, not a feature.
      if (rules.some(rule => rule.sessionId === sessionId)) {
        return `这张卡对 ${sessionId} 已经有一条规则了。要改就改它（rule.update），不要叠第二条。`
      }
      const usePrompt = payload.usePrompt === true || payload.usePrompt === 'true'
      const instruction = String(payload.instruction ?? '')
      if (!usePrompt && instruction.trim() === '') return 'usePrompt 是 false 时必须给一句 instruction（用 true 就送这张卡自己的执行 Prompt）。'
      if (usePrompt && instruction.trim() !== '') return 'usePrompt 是 true 时不用给 instruction——送的就是这张卡自己的 Prompt。'
      const trigger = payload.trigger === 'on-complete' ? 'on-complete' : 'cron'
      const cron = String(payload.cron ?? '')
      if (trigger === 'cron' && cron.trim() === '') return 'trigger 是 cron 时必须给一个五段 cron 表达式。'
      const send = payload.send === 'steer' ? 'steer' : 'queue'
      // An ARMED cron rule needs a due slot, and the row grammar drops one
      // without it — correctly: an armed rule that can never run is the dead
      // arm this law exists to prevent. The slot is the SCHEDULER's number, so
      // it is computed here with the scheduler's own function, never invented.
      // An on-complete rule carries no slot at all, and the grammar refuses one
      // that does.
      const nextAt = trigger === 'cron' ? nextRunAtMs(cron, now) : undefined
      if (trigger === 'cron' && nextAt === undefined) return `这个 cron 表达式算不出下次运行时间，建出来的规则永远不会跑，所以没有建。换一个表达式，或改成 on-complete。`
      const rule: SessionRule = {
        id: deps.uuid(), sessionId, instruction, usePrompt, trigger,
        cron: trigger === 'cron' ? cron : '',
        ...(nextAt === undefined ? {} : { nextAt }),
        send,
        enabled: true,
      }
      const next: TaskRecord = { ...found, rules: [...rules, rule], updatedAt: now }
      return { doc: { ...doc, tasks: doc.tasks.map(task => (task.id === found.id ? next : task)) }, items, task: next }
    }
    case 'rule.update': {
      const found = findTask()
      if (found === undefined) return `卡 ${String(payload.of)} 不存在。`
      const rules = found.rules ?? []
      const target = String(payload.rule ?? '')
      const at = rules.findIndex(rule => rule.id === target)
      if (at < 0) return `这张卡上没有 id 为 ${target} 的规则。用 taskboard_query 先看这张卡挂了哪些会话。`
      const rule = rules[at]!
      const usePrompt = payload.usePrompt === undefined ? rule.usePrompt === true : payload.usePrompt === true || payload.usePrompt === 'true'
      const instruction = payload.instruction === undefined ? rule.instruction : String(payload.instruction)
      const trigger = payload.trigger === undefined ? rule.trigger : (payload.trigger === 'on-complete' ? 'on-complete' : 'cron')
      const cron = payload.cron === undefined ? rule.cron : String(payload.cron)
      const send = payload.send === undefined ? rule.send : (payload.send === 'steer' ? 'steer' : 'queue')
      if (!usePrompt && instruction.trim() === '') return 'usePrompt 是 false 时必须留一句 instruction。'
      if (trigger === 'cron' && cron.trim() === '') return 'trigger 是 cron 时必须有一个五段 cron 表达式。'
      const next: SessionRule = { ...rule, usePrompt, instruction, trigger, cron: trigger === 'cron' ? cron : '', send, enabled: payload.enabled === undefined ? rule.enabled : payload.enabled === true || payload.enabled === 'true' }
      const kept = [...rules]
      kept[at] = next
      const task: TaskRecord = { ...found, rules: kept, updatedAt: now }
      return { doc: { ...doc, tasks: doc.tasks.map(row => (row.id === found.id ? task : row)) }, items, task }
    }
    case 'preset.create': {
      const kind = payload.kind === 'run' ? 'run' : 'schedule'
      const label = String(payload.label ?? '').trim()
      if (label === '') return '预设要有一个名字（label）。'
      if (kind === 'schedule') {
        const cron = String(payload.cron ?? '').trim()
        if (cron === '') return 'kind 是 schedule 时必须给一个五段 cron 表达式。'
        if (!isValidCron(cron)) return `「${cron}」不是一个能算出来的五段 cron 表达式，所以没有存——存下来它也永远不会触发。`
        // A preset is a NAME plus an expression; the ids are the document's to
        // mint, and the section carries the write stamp.
        const value: SchedulePreset[] = [...doc.schedulePresets.value, { id: deps.uuid(), label, cron }]
        return { doc: { ...doc, schedulePresets: { value, at: now } }, items }
      }
      const config = readRunConfig(payload.config)
      if (Object.keys(config).length === 0) return 'kind 是 run 时要给 config（workspaceId / provider / model / reasoningEffort / agentPreset / permission 至少一个）。'
      const value: RunPresetsDocument = { presets: [...doc.runPresets.value.presets, { id: deps.uuid(), name: label, config }] }
      return { doc: { ...doc, runPresets: { value, at: now } }, items }
    }
    case 'preset.update': {
      const label = payload.label === undefined ? undefined : String(payload.label).trim()
      const cron = payload.cron === undefined ? undefined : String(payload.cron).trim()
      const config = payload.config === undefined ? undefined : readRunConfig(payload.config)
      if (label === undefined && cron === undefined && config === undefined && payload.makeDefault === undefined) {
        return '要改哪一样？给 label、cron、config，或 makeDefault。'
      }
      if (cron !== undefined && !isValidCron(cron)) return `「${cron}」不是一个能算出来的五段 cron 表达式，所以没有改。`
      // Which section an edit lands in is a FACT read from the document —
      // whichever list actually holds that id — not a guess from which fields
      // the caller happened to send. Guessing here is how a rename lands on the
      // wrong list and gets refused for a preset that exists.
      const id = String(payload.of)
      const inSchedule = doc.schedulePresets.value.some(preset => preset.id === id)
      const inRun = doc.runPresets.value.presets.some(preset => preset.id === id)
      if (!inSchedule && !inRun) return `没有 id 为 ${id} 的预设。`
      if (inSchedule && inRun) return `${id} 同时出现在两类预设里——这不该发生，请报给维护者。`
      let next = doc
      if (inSchedule) {
        const current = doc.schedulePresets.value
        const at = current.findIndex(preset => preset.id === id)
        const kept = [...current]
        kept[at] = { ...kept[at]!, label: label ?? kept[at]!.label, cron: cron ?? kept[at]!.cron }
        next = { ...next, schedulePresets: { value: kept, at: now } }
      } else {
        const current = doc.runPresets.value
        const at = current.presets.findIndex(preset => preset.id === id)
        const kept = [...current.presets]
        kept[at] = { ...kept[at]!, name: label ?? kept[at]!.name, config: config ?? kept[at]!.config }
        const makeDefault = payload.makeDefault === undefined ? undefined : payload.makeDefault === true || payload.makeDefault === 'true'
        const value: RunPresetsDocument = { presets: kept, ...(makeDefault === undefined ? (current.defaultId === undefined ? {} : { defaultId: current.defaultId }) : (makeDefault ? { defaultId: kept[at]!.id } : { defaultId: undefined })) }
        next = { ...next, runPresets: { value, at: now } }
      }
      return { doc: next, items }
    }
    case 'preset.delete': {
      const id = String(payload.of)
      const inSchedule = doc.schedulePresets.value.some(preset => preset.id === id)
      const inRun = doc.runPresets.value.presets.some(preset => preset.id === id)
      if (!inSchedule && !inRun) return `没有 id 为 ${id} 的预设。`
      if (inSchedule && inRun) return `${id} 同时出现在两类预设里——这不该发生，请报给维护者。`
      // A deleted preset is GONE, not disabled: unlike a card, nothing here
      // keeps a tombstone, and a default pointing at a row that no longer
      // exists would fail the next run with no explanation.
      if (inSchedule) {
        const value = doc.schedulePresets.value.filter(preset => preset.id !== id)
        return { doc: { ...doc, schedulePresets: { value, at: now } }, items }
      }
      const current = doc.runPresets.value
      const value: RunPresetsDocument = { presets: current.presets.filter(preset => preset.id !== id), ...(current.defaultId === id ? {} : (current.defaultId === undefined ? {} : { defaultId: current.defaultId })) }
      return { doc: { ...doc, runPresets: { value, at: now } }, items }
    }
    case 'task.update': {
      const found = findTask()
      if (found === undefined) return `卡 ${String(payload.of)} 不存在。`
      const patch = payload as Partial<TaskRecord>
      // EVERY FIELD THE CATALOGUE PROMISES, not the three that were here.
      //
      // The catalogue lists eleven parameters and this case body wrote three, so a
      // model that set `color` or `model` was answered 「已生效」 about a field that
      // had not moved — and it cost a revision and woke every device while
      // achieving nothing. **A write that reports success it did not perform is
      // the worst thing this tool can do**, because the model's next turn is
      // built on believing it happened.
      //
      // The run-config loop reads the SAME list the detail pane and the preset
      // reader read, and the clear-a-field rule is the same one: a present key
      // with '' or undefined clears it, because a cleared run config is a real
      // intent (execution falls back to the defaults) and silently keeping the old
      // value would be the opposite of what was asked for.
      const applied: Partial<TaskRecord> = {}
      for (const key of ['title', 'description', 'prompt'] as const) {
        if (key in patch) applied[key] = patch[key]
      }
      for (const key of RUN_CONFIG_KEYS) {
        if (key in patch) {
          const value = patch[key]
          applied[key] = value === undefined || value === '' ? undefined : value
        }
      }
      // The accent colour is a run-ADJACENT field, not a preset one, so it keeps
      // its own rule — and its own reason for not being in the loop above.
      if ('color' in patch) {
        applied.color = patch.color !== undefined && patch.color !== '' ? patch.color : undefined
      }
      // AN UPDATE THAT CHANGES NOTHING IS NOT AN UPDATE. The `semantic` actions
      // already report `unchanged` rather than burning a revision; this one must
      // too, or 「改成了它本来的样子」 comes back as a success that cost a write.
      if (Object.entries(applied).every(([key, value]) => found[key as keyof TaskRecord] === value)) {
        return { doc, items, task: found, unchanged: true }
      }
      const next = edited({ ...found, ...applied })
      return { doc: { ...doc, tasks: doc.tasks.map(task => (task.id === found.id ? next : task)) }, items, task: next }
    }
    case 'task.create': {
      /* THE CARD IS BUILT ONCE, WITH EVERYTHING THE CATALOG SAYS IT ACCEPTS.
       *
       * `bind` was published and never read: a model that named a source got a
       * card with none, and the receipt said the card had been created — true,
       * and not what was asked for. The run configuration was the same story
       * from the other side: not published at all on this action, so "build a
       * card and run it" was necessarily TWO calls, with a half-finished card
       * visible in between.
       *
       * Both are read here now, and the config loop reads the SAME key list the
       * detail pane and the preset reader read, so a seventh field cannot be
       * settable in one place and invisible in another. */
      const binds = readBinds(payload.bind)
      if (typeof binds === 'string') return binds
      const created = createTask({
        title: String(payload.title ?? ''),
        description: String(payload.description ?? ''),
        prompt: String(payload.prompt ?? ''),
        ...(payload.status === undefined ? {} : { status: payload.status as TaskStatus }),
        ...binds.length === 0 ? {} : { binds },
        ...readRunConfig(payload),
        ...(payload.color === undefined || payload.color === '' ? {} : { color: String(payload.color) }),
      }, now, deps.uuid())
      return { doc: { ...doc, tasks: [...doc.tasks, created] }, items, task: created }
    }
    case 'task.delete': {
      const found = findTask()
      if (found === undefined) return `卡 ${String(payload.of)} 不存在。`
      return { doc: { ...doc, tasks: doc.tasks.filter(task => task.id !== found.id) }, items, task: found }
    }
    case 'item.create': {
      // The row is built by the SHARED constructor the capture box also goes
      // through, so a row the model writes and a row a person writes cannot come
      // out two ways (step ids, trimming, the neutral tiers, the provenance).
      if (!isItemListValue(payload.steps) || !isItemListValue(payload.tags)) {
        return 'steps 与 tags 要么是一份列表，要么别传；现在这个不是列表，所以什么都没写。'
      }
      /* THE DATES ARE JUDGED AND SNAPPED AT THIS DOOR, and only the ones sent.
       *
       * A row whose three dates contradict each other is a promise that cannot be
       * kept: 「开始」 after 「计划」, or a plan after the un-moveable deadline. The
       * interface deliberately still saves such a row (the reader is mid-thought
       * and can fix one field later, and the row keeps saying so) — but a model's
       * call is one complete, re-issuable intent with no "later", so the refusal
       * belongs HERE rather than inside the shared writer that the capture sheet
       * also uses. See `itemDateWriteOf`.
       *
       * The granularity is the second half: a date means a DAY, and the model
       * sending "now" put a row at 05:20, which made 「今天到期」 wrong at the day
       * boundary. The catalog stated that rule in prose and nothing enforced it. */
      const dates = itemDateWriteOf(
        { startsAfter: payload.startsAfter as number | undefined, dueAt: payload.dueAt as number | undefined, hardDueAt: payload.hardDueAt as number | undefined },
        new Set(DATE_KEYS.filter(key => payload[key] !== undefined)),
      )
      if (!dates.ok) return dateConflictSentence(dates.conflict)
      const link = linkOf(payload.taskId)
      const made = captureItemRecord({
        title: typeof payload.title === 'string' ? payload.title : '',
        body: typeof payload.body === 'string' ? payload.body : '',
        notes: typeof payload.notes === 'string' ? payload.notes : '',
        origin: 'ai',
        // Status and priority go through the constructor's neutral fallback
        // rather than a check here: the catalog's oneOf already fences the model
        // (checkParams), and the fallback is the same repair the inbound grammar
        // makes, so a value from a future build costs a tier and not the row.
        status: payload.status,
        priority: payload.priority,
        steps: payload.steps,
        tags: payload.tags,
        startsAfter: dates.values.startsAfter,
        dueAt: dates.values.dueAt,
        hardDueAt: dates.values.hardDueAt,
        ...link === undefined ? {} : { taskId: link },
      }, now, deps.uuid)
      // The row arrives with no number at all: the document mints it, which is
      // the only thing that may hand one out.
      const merged = applyItemsCommit(items, { clientId: 'model', items: [...items.items, made.item], deleted: [] }, now)
      const stored = merged.items.find(item => item.id === made.item.id) ?? made.item
      return { doc, items: merged, item: stored, note: mintedNote(made.mintedSteps) }
    }
    case 'item.update': {
      const found = findItem()
      if (found === undefined) return `清单里没有 #${refOf(payload.of)}。`
      // 文本三件只认字符串：非字符串不是“空”，是“没说清”，直接拒而不是落盘一个数字。
      for (const field of ['title', 'body', 'notes'] as const) {
        if (payload[field] !== undefined && typeof payload[field] !== 'string') {
          return `${field} 要写就写一段文字，现在这个不是文字。`
        }
      }
      if (payload.status !== undefined && !ITEM_STATUSES.includes(payload.status as ItemRecord['status'])) {
        return `status 只能是 ${ITEM_STATUSES.join(' / ')}，收到的是「${String(payload.status)}」（「进行中」是派生的，不可写）。`
      }
      if (payload.priority !== undefined && !ITEM_PRIORITIES.includes(payload.priority as ItemRecord['priority'])) {
        return `priority 只能是 ${ITEM_PRIORITIES.join(' / ')}，收到的是「${String(payload.priority)}」。`
      }
      // 整份替换的两件要能被读：写成一个读不出来的形状不是“清空”，是“没说清”，
      // 按清空处理就是把读者自己写的几行勾选抹掉，还没有一句话告诉他。
      if (!isItemListValue(payload.steps) || !isItemListValue(payload.tags)) {
        return 'steps 与 tags 要么是一份列表，要么别传；现在这个不是列表，所以这一条没有动。'
      }
      // 三时间互不覆盖：没传的沿用，传了空（null 或空串）的是删承诺，传了数字的是新承诺，
      // 传了别的形状的是没说清，沿用旧的不动它。
      const nextInstant = (field: ItemDateKey): number | undefined => {
        const raw = payload[field]
        if (raw === undefined) return found[field]
        if (raw === null || raw === '') return undefined
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw
        return found[field]
      }
      /* THE DATES THIS CALL WILL LEAVE ON THE ROW, judged and snapped — see
       * `item.create`'s note for why the refusal lives at this door and not in the
       * shared writer.
       *
       * JUDGED ON THE RESULT, NOT ON THE PAYLOAD. A merge is what an update
       * produces, so the conflict that matters is the one the ROW WILL HOLD — and
       * the first version of this check compared only the keys the payload
       * mentioned, so 「把开始日改成 9 号」 on a row planned for the 5th sailed
       * through and created exactly the contradiction the check exists to stop.
       * A test caught it, which is the point of asserting the OUTCOME rather than
       * the mechanism.
       *
       * `mentioned` still decides what is WRITTEN (`nextInstant` owns 「没提 / 清空 /
       * 新值」), while `judged` is the merged triple. Splitting the two is what
       * keeps 「把标题改一下」 from being refused over a contradiction somebody else
       * put in the row: an edit that mentions no date is not asked to fix one. */
      const mentionedDates = new Set(DATE_KEYS.filter(key => payload[key] !== undefined))
      /* AN EDIT THAT MENTIONS NO DATE IS NOT ASKED TO FIX ONE.
       *
       * The merge is what an update produces, so the conflict that matters is the
       * one the ROW WILL HOLD — but only when this call is what puts it there. A
       * row somebody else made impossible must stay editable by title, or the
       * person is locked out of the very fix they were asked to make.
       *
       * So the two questions are answered separately: `attempted` is the merged
       * triple, judged for the conflict; `mentionedDates` is what gets written.
       * The conflict test runs only when the caller touched a date at all. */
      const attempted: Record<string, number | undefined> = {}
      for (const key of DATE_KEYS) {
        attempted[key] = mentionedDates.has(key) ? nextInstant(key) : found[key]
      }
      const writtenDates = mentionedDates.size === 0
        ? { ok: true as const, values: {} }
        : itemDateWriteOf(attempted as Pick<ItemRecord, ItemDateKey>, mentionedDates)
      if (!writtenDates.ok) return dateConflictSentence(writtenDates.conflict)
      // 挂卡：没传 = 不动；空 = 摘掉；非空字符串 = 换链；别的形状 = 没说清（沿用）。
      const link: 'none' | 'unlink' | { readonly cardId: string } =
        payload.taskId === null || payload.taskId === ''
          ? 'unlink'
          : typeof payload.taskId === 'string' && payload.taskId !== ''
            ? { cardId: payload.taskId }
            : 'none'
      // The step list is read once, against the row it will live in, so the ids
      // it mints are the row's own deterministic ones.
      const steps = payload.steps === undefined ? undefined : readItemStepList(payload.steps, found.id)
      // The patch names only the fields the caller actually gave. It used to be a
      // SPREAD of every field — with `payload.title as string | undefined` — so a
      // field the model did NOT mention arrived as an explicit `undefined`, and
      // the spread wrote that undefined over the row. `title: undefined` fails
      // `isItemRecordShape`, so the WHOLE ROW was dropped by the document grammar
      // while the receipt said the edit had been applied: **the model could
      // delete a row by editing it.** The shared writer now refuses to write a
      // row that is not a row (src/core/item-transitions.ts), and this side
      // simply stops manufacturing undefineds.
      //
      // **两类字段，两种读法**：标题/正文/备注/状态/优先级是**必填**的，补丁里带
      // undefined 是不合法值，所以「没提」就不能出现在补丁里；日期那几项的行内形状
      // 本来就是 `number | undefined`，所以那里 undefined 是**清空**——`nextInstant`
      // 已经把「没提」与「清空」分开了（没提 → 沿用当前值，写回去等于没改）。
      //
      // **链接不在这个补丁里**：挂上与摘下是挂载那一条路（下面），不是一个字段的补丁。
      const patch: Parameters<typeof applyItemPatch>[2] = {}
      if (payload.title !== undefined) patch.title = payload.title as string
      if (payload.body !== undefined) patch.body = payload.body as string
      if (payload.notes !== undefined) patch.notes = payload.notes as string
      if (payload.priority !== undefined) patch.priority = payload.priority as ItemRecord['priority']
      patch.tags = payload.tags === undefined ? found.tags : itemTagsOf(payload.tags)
      // The SNAPPED values, from the same read that judged the conflict — not
      // `nextInstant` again, which would be a second reading of one payload and
      // could disagree with the one that was just validated.
      patch.startsAfter = 'startsAfter' in writtenDates.values ? writtenDates.values.startsAfter : found.startsAfter
      patch.dueAt = 'dueAt' in writtenDates.values ? writtenDates.values.dueAt : found.dueAt
      patch.hardDueAt = 'hardDueAt' in writtenDates.values ? writtenDates.values.hardDueAt : found.hardDueAt
      if (steps !== undefined) patch.steps = steps.steps
      let rows = applyItemPatch(items.items, found.id, patch, now)
      /* **挂载：链接与这一行自己那一档一起写。**
       *
       * 摘掉链接不需要挂载——这一行保留最后一次与卡同步过的状态，那就是它现在的状态（一次
       * 普通的补丁，与界面那一枚「不挂」一样）。挂上必须同时决定这一行自己那一档是什么：挂上
       * 之后「这一行显示什么」由卡回答，而两个字段各写各的，就是这一行说待办、那张卡说待审核，
       * 屏上两个说法。`mountItemRecord` 是挂载的唯一落点（界面提升那一条路调的是它）。
       *
       * **挂到一张不存在的卡上是一条断链**：屏上读不到那张卡，而清单里却记着它。界面那一侧
       * 的选择器只列板上真的卡，所以这个状态模型写不出来——这里明确拒绝，而不是写一条断链
       * 再让面板那一侧悄悄把它清掉。 */
      if (link === 'unlink') {
        rows = applyItemPatch(rows, found.id, { taskId: undefined }, now)
      } else if (link !== 'none') {
        const target = doc.tasks.find(task => task.id === link.cardId)
        if (target === undefined) {
          const names = doc.tasks.slice(0, 20).map(task => task.title).join('，')
          return `看板上没有 id 为 ${link.cardId} 的卡片，挂不上去。看板上现在有：${names || '（一张卡都没有）'}`
        }
        // 已经是这张卡：挂载与一次普通补丁写的是同一件事，而空转不该烧一次版本。
        if (target.id !== found.taskId) {
          rows = mountItemRecord(rows, found.id, target.id, target.status, now)
        }
      }
      /* THE STATUS HALF IS ITS OWN WRITE, and it is the INTERFACE's write.
       *
       * `applyItemStatus` is the one door a row's status goes through: the row's
       * own field AND the card's column change together, because two documents
       * telling two stories is a state the reader cannot explain. The panel's
       * status chips call it; a model that only wrote the field would leave the
       * card where it was — and the panel's own sync would then quietly undo
       * that write, so the receipt said 「已生效」 about an edit nobody kept.
       *
       * **那道卡按界面那一侧的读法拿**（`linkedCardOf`：卡不在板上就不算挂着），所以「这一条
       * 挂着哪张卡、它在哪一栏」在两边是同一个答案——而那一栏正是「它还在进行中吗」这条门的
       * 判据，两边必须拿到同一个。 */
      let cardMove: { readonly cardId: string; readonly status: TaskStatus } | undefined
      if (payload.status !== undefined) {
        const card = linkedCardOf(rows.find(item => item.id === found.id) ?? found, cardStatusMapOf(doc.tasks))
        const write = applyItemStatus(rows, found.id, payload.status as TaskStatus, card, now)
        if (write.refused === 'cardRunning') {
          return '这一条挂着的卡还在进行中：这一轮跑完再改它的状态——现在改，这一行与那张卡会说出两个故事。'
        }
        if (write.refused === 'executorOnly') {
          return '这一条挂着看板卡片，状态只能给到待规划 / 待办 / 已完成——进行中与待审核是执行器落的事实，写不上去。'
        }
        cardMove = write.move
        // The no-op law: the shared writer always hands back a fresh array, so
        // "did this edit change anything" is decided by the row's own field.
        if (write.rows.find(item => item.id === found.id)?.status !== found.status) rows = write.rows
      }
      /* AND THE CARD LANDS THE WAY THE INTERFACE LANDS IT, because that is what
       * moving it IS: the same two shared functions the drag walks through
       * （**位置**归 `applyCardOrder`，**内容**归 `moveTaskToStatus`），于是两边的名次
       * 逐项相同——名次就是屏上的顺序。 */
      let nextDoc = doc
      if (cardMove !== undefined) {
        const target = doc.tasks.find(task => task.id === cardMove!.cardId)
        if (target !== undefined) {
          const transitioned = moveTaskToStatus(target, cardMove.status, now)
          if (!transitioned.ok) return transitioned.why
          const tasks = landCardInColumn(doc.tasks, target.id, cardMove.status, undefined, now, transitioned.task)
          if (tasks !== doc.tasks) nextDoc = { ...doc, tasks }
        }
      }
      if (rows === items.items && nextDoc === doc) return { doc, items, item: found, unchanged: true }
      const next = rows.find(item => item.id === found.id) ?? found
      const note = steps === undefined ? undefined : mintedNote(steps.minted)
      return note === undefined
        ? { doc: nextDoc, items: withItemRows(items, rows), item: next }
        : { doc: nextDoc, items: withItemRows(items, rows), item: next, note }
    }
    case 'item.delete': {
      const found = findItem()
      if (found === undefined) return `清单里没有 #${refOf(payload.of)}。`
      // The list half only. The tombstone that makes this recoverable is the
      // merge grammar's, and the receipt says 「已生效」 either way — which is
      // true, because a tombstoned delete IS the deletion this document means.
      const rows = removeItemRecord(items.items, found.id)
      return { doc, items: withItemRows(items, rows), item: found }
    }
    case 'item.step': {
      const found = findItem()
      if (found === undefined) return `清单里没有 #${refOf(payload.of)}。`
      if (typeof payload.done !== 'boolean') return 'done 要么是 true（勾上）要么是 false（取消勾上），没给就不知道你想干什么。'
      const stepId = String(payload.step ?? '')
      const at = found.steps.findIndex(step => step.id === stepId)
      // A step id that names nothing is a question, not an error to swallow:
      // the step list is something only the document knows, so the answer has
      // to be read, not guessed at.
      if (at < 0) {
        const names = found.steps.length === 0
          ? '这一条还没有步骤。'
          : `这一条的步骤是：${found.steps.map(step => `${step.id}${step.done ? '（已勾）' : ''}`).join('、')}。`
        return `这一条里没有 id 为 ${stepId} 的步骤。${names}`
      }
      // Only that one entry moves, and a step already in this state is not a
      // write at all. Both halves of that live in the shared writer, which the
      // capture box's checkbox calls too.
      const rows = applyItemStep(items.items, found.id, stepId, payload.done, now)
      if (rows === items.items) return { doc, items, item: found, unchanged: true }
      return { doc, items: withItemRows(items, rows), item: rows.find(item => item.id === found.id) ?? found }
    }
    case 'item.promote': {
      const found = findItem()
      if (found === undefined) return `清单里没有 #${refOf(payload.of)}。`
      // The four judgments are the SHARED plan, and the panel's 转成卡片 button
      // goes through the very same one — a row that the model may promote and a
      // row a person may promote have to be the same question, or the button and
      // the action disagree about when it is allowed. The plan answers with a
      // CODE; the sentences below are this surface's, because the reader of a
      // model receipt is not the reader of a panel.
      const plan = planItemPromotion(found, {
        ...payload.cardTitle === undefined ? {} : { cardTitle: String(payload.cardTitle) },
        ...payload.cardPrompt === undefined ? {} : { cardPrompt: String(payload.cardPrompt) },
      })
      if (plan.kind === 'refused') {
        if (plan.why === 'alreadyLinked') {
          // Already promoted. Re-promoting would make a second card and leave
          // the item pointing at whichever one was written last, so this is
          // reported as the state it is rather than performed again.
          return `这一条已经挂在卡片上了（${plan.taskId}），没有再建一张。`
        }
        return '这条没有标题，正文也是空的——建出来的卡会是一个没有名字的东西。先给它写一句话。'
      }
      // The card is created BEFORE the link, and the order is not arbitrary: a
      // half-finished promote that leaves the card without its link shows up as
      // an untouched note, which is indistinguishable from "not promoted yet".
      // The other order would leave the note pointing at a card that does not
      // exist — a state the interface would have to render as a defect.
      // 出生栏是**提升计划自己算出来的那一个**（这一条现在的状态，见 `planItemPromotion`）
      // ——这里不再写一遍 `status`：写上就等于把那条推导丢掉，于是同一条行由模型提升与由
      // 面板提升会产出两张落在不同栏的卡，而 `createTask` 自己的默认值本来就已经是「待办」。
      const task = createTask(plan.task, now, deps.uuid())
      // The link AND the row's own tier, in one frame: `mountItemRecord` is the
      // one door a row is attached to a card through, and the interface's
      // 「挂到已有卡」 button goes through it too. Writing only the link would
      // leave the row saying one tier and the card another — and the panel's
      // own sync would then quietly rewrite the row behind the reader's back.
      const rows = mountItemRecord(items.items, found.id, task.id, plan.task.status, now)
      return {
        doc: { ...doc, tasks: [...doc.tasks, task] },
        items: withItemRows(items, rows),
        task,
        item: rows.find(item => item.id === found.id) ?? found,
      }
    }
    case 'item.ask': {
      const found = findItem()
      if (found === undefined) return `清单里没有 #${refOf(payload.of)}。`
      /* THE CARD, READ THE WAY THE INTERFACE READS IT.
       *
       * 「挂没挂卡」只有那一个判据（`linkedCardIdOf`）：卡不在板上就不算挂着，界面那一侧
       * 也是这么读的（`cardColumns` 里没有就是没有）。所以模型说「这一条没有挂卡」与界面
       * 说「没有挂卡」是同一件事——而模型若按文档里那个链接去找卡，就会找到一张已经被删掉的
       * 卡，然后对一个不存在的对话开口。 */
      const cardLink = linkedCardOf(found, cardStatusMapOf(doc.tasks))
      const card = cardLink === undefined ? undefined : doc.tasks.find(task => task.id === cardLink.id)
      // THE SAME PLAN THE PANEL'S BUTTON CALLS. Which conversation a row's words
      // go to, and whether this is 开始 or 继续, is one judgment — the model asking
      // the same question the person asked must reach the same answer, or the row
      // behaves differently depending on who typed, which is the one thing a
      // shared action cannot be.
      const verdict = planItemAsk({
        item: found,
        card,
        sessions: card === undefined ? [] : relatedSessionIdsOf(card, undefined, undefined),
        // 上面那两个 `undefined` 是**明确写出的判决**：宿主这一处看不到原生名单的可用性，所以
        // 它不判存在性（`relatedSessionIdsOf` 的那个参数是必填的，正是为了让每个调用点把话说出来）。
        isRunning: sessionId => sessionRunningOf(deps.sources, sessionId).value === true,
      })
      if (verdict.kind === 'refused') {
        // The refusals say what to DO, not only what is wrong: a model that is
        // told 「no card」 and nothing else will try again the same way.
        if (verdict.why === 'noCard') return '这一条没有挂在任何看板卡片上。先用 item.promote 把它变成一张卡——那张卡就是它的对话。'
        return '这一条挂的不是那张卡，别替它挑一张。'
      }
      /* THE CARRIER IS THE ANSWER, and it is this op that knows it rather than the
       * catalog: whether the row starts a run or speaks into a conversation is a
       * fact about the card, and the catalog has one `relay` per action, not one
       * per state. Both carriers are the engine's ordinary work — the same doors
       * the panel's own press reaches through the controller — so a model and a
       * person asking the same question get the same behaviour, which is the only
       * reason this action shares `planItemAsk` with the button at all. */
      const titled = card?.id ?? ''
      /* **这一条自己的附件跟着载具走。** `planItemAsk` 读的是**文档里**那一行（`attachmentsOf`），
         不是模型给的参数——模型手里没有字节，也就不该有第二个说法。少了这一行，同一次
         `item.ask` 在界面上带图、在模型这边只有字，而两种调用点共用的正是这一个计划。 */
      const carried = verdict.attachments
      return verdict.kind === 'start'
        ? { doc, items, item: found, carrier: { kind: 'run', payload: { of: titled, kickoff: verdict.text, ...carried.length > 0 ? { attachments: carried } : {} } } }
        : { doc, items, item: found, carrier: { kind: 'comment', payload: { of: titled, session: verdict.sessionId, text: verdict.text, ...carried.length > 0 ? { attachments: carried } : {} } } }
    }
    case 'item.purge': {
      // ADDRESSED BY ITS SHORT NUMBER, the same name `item.restore` takes: it is
      // the one a person and a model say out loud, and the uuid is never spoken.
      // So the row is found among the deletions first, exactly as the restore
      // finds it — and a number that is in neither list is answered out loud
      // rather than by guessing which of the two situations it is.
      const wanted = refOf(payload.of)
      const carried = deletedItemsOf(items).find(item => String(item.ref) === wanted)
      if (carried === undefined) {
        // A row that is STILL THERE is the one refusal worth making: answering
        // 「已彻底删除」 about something the reader can scroll up and see would
        // be a receipt about a row that exists. The tool does not purge it
        // either — this action's price is 「undo that is gone」, and an unasked
        // irreversible write is not something to spring on a model that was
        // pointing at the wrong number.
        const live = items.items.find(item => String(item.ref) === wanted)
        if (live !== undefined) {
          return `清单里的 #${wanted} 没有删过，没有可清除的删除记录。要删它用 item.delete（那条还能找回）。`
        }
        // Neither in the list nor behind a tombstone that still holds text: it
        // was already purged, or it never existed. The model's own snapshot is
        // the document's truth here, so no write is needed to say so.
        return { doc, items, unchanged: true, note: `（#${wanted} 之前已经清干净了，或者从来没有过；这次没有可清除的内容）` }
      }
      // The local copy is what a rehearsal reports and what the receipt names;
      // the erasure itself is the service's, because only it may write one.
      const outcome = purgeItemTombstone(items, carried.id)
      return { doc, items: outcome.doc, item: carried, purge: carried.id }
    }
    case 'item.restore': {
      const wanted = refOf(payload.of)
      // The row to bring back is the one the TOMBSTONE holds, not one rebuilt
      // from what the caller remembers — and it is re-stamped above the
      // tombstone, because a tombstone outranks the row it removed and would
      // otherwise eat the put that carries it back. See `restoredItemOf`.
      //
      // It is FOUND BY ITS SHORT NUMBER, because that is the name a person and
      // a model both say out loud; the uuid is never spoken. A row that is
      // merely deleted is not a candidate: it is not behind a tombstone, it is
      // still in the document, and "restoring" it would be a second row.
      const carried = deletedItemsOf(items).find(item => String(item.ref) === wanted)
      if (carried === undefined) {
        // Four situations read as one here and the tool CANNOT tell them apart
        // from a number alone, because the number lived in the text: the row was
        // purged (this document no longer holds its number anywhere), the
        // tombstone aged out, the delete predates text-keeping, or it never
        // existed. Every one of them means the same thing to a caller, and the
        // sentence says all four rather than naming one and being wrong three
        // times.
        return `清单里没有 #${wanted}，也没有一条删掉之后还留着的：它要么已经彻底清掉了，要么删掉超过 30 天，要么从来没有过。找不回内容，只能重新记一条。`
      }
      const restored = restoredItemOf(items, carried.id, now)
      if (restored === undefined) {
        return `#${wanted} 的删除记录里没有正文（是更早的版本删的），所以找不回内容，只能重新记一条。`
      }
      return { doc, items: { ...items, items: [...items.items, restored] }, item: restored }
    }
    default:
      // Every remaining document-lane action is real, but this knife ships the
      // board/item core of the vocabulary; naming the gap is better than
      // pretending an op landed.
      return `「${id}」这一刀还没有接到执行路径上。已生效的部分在上面，别把它当成做过了。`
  }
}

/**
 * Is this row still working? Read through the ONE session derivation
 * (`sessionRunningOf`) and the ONE related-session set (`relatedSessionIdsOf`)
 * — the same two the board reads, so a decision taken for the model and one
 * taken for a person can never disagree.
 *
 * `unknown` is a real answer, not a fallback: a host that cannot see a session
 * may not conclude that nothing is running, and the shared transition decides
 * what to do with that rather than this module guessing.
 */
function livenessOf(sources: SessionPostureSources, task: TaskRecord): TaskLiveState {
  // 两个 `undefined` 是明确写出的判决：这一层按**轮次台账**回答在不在跑，判不了原生名单的
  // 可用性，所以不判存在性（参数必填就是为了让这句话写在每个调用点上）。
  const sessions = relatedSessionIdsOf(task, undefined, undefined).map(fact => fact.sessionId)
  if (sessions.length === 0) return 'idle'
  const seen = sessions.map(id => sessionRunningOf(sources, id).value)
  if (seen.some(value => value === true)) return 'running'
  if (seen.some(value => value === 'unknown')) return 'unknown'
  return 'idle'
}

/** The sentence a caller shows when steps had to be given ids. */
function mintedNote(minted: number): string | undefined {
  return minted === 0 ? undefined : `（${minted} 个步骤没有 id，已按顺序铸号，没有丢）`
}

/**
 * The checklist document carrying `rows` — or THE SAME DOCUMENT when the shared
 * writer moved nothing.
 *
 * The identity is the point, exactly as it is for the rows themselves: the batch
 * loop commits a document only when it is handed a different one, so a receipt
 * that says 「没有改动」 and a commit that burns a revision would be two
 * different stories about one keystroke. The copy is here rather than in the
 * shared writer because the writer promises never to hand back a mutable array
 * it did not build (a caller's list is `readonly`), while the document owns a
 * mutable one.
 */
function withItemRows(doc: ItemsDoc, rows: readonly ItemRecord[]): ItemsDoc {
  return rows === doc.items ? doc : { ...doc, items: [...rows] }
}

/**
 * 挂卡链接的读法：零张或一张，只存链接。
 * 空串与 null 读作“没有挂”，非字符串读作“没有挂”而不是一条断链。
 * `null` 与空串是"摘掉挂卡"的意思，所以返回 undefined；别的形状不是断链，是没说清。
 */
function linkOf(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/** The written content of a card, as prose, or nothing on a brief row. */
function taskBodyOf(row: TaskRow & Partial<TaskDetail>): string {
  if (row.description === undefined && row.prompt === undefined) return ''
  return [`详情：${row.description ?? ''}`, `Prompt：${row.prompt ?? ''}`]
    .map(line => line.replace(/\s+$/, ''))
    .filter(line => !line.endsWith('：'))
    .map(line => `  ${line}`)
    .join('\n')
}

/**
 * The deep half of a card, as prose: what the model may WRITE, printed so that a
 * model can read it before it writes it.
 *
 * THIS RENDERS WHAT THE PROJECTION CARRIES. A deep query that put the schedule
 * and the rules into JSON and printed nothing here would repeat the exact defect
 * the `detail` parameter used to have — the answer is right there, the reader
 * still cannot use it, and nothing says so.
 *
 * Only the PARTS THAT EXIST are printed, and each one carries the words a WRITE
 * uses (`runConfig`, the rule's trigger and send, the schedule's mode). Reading
 * one vocabulary and writing another is how 「cron」 becomes 「schedule」 and the
 * model's next call is refused for a field name.
 */
function taskDeepBodyOf(row: TaskRow & Partial<TaskDetail> & Partial<TaskDeep>): string {
  const lines: string[] = []
  const config = row.runConfig ?? {}
  const configKeys = Object.keys(config)
  if (configKeys.length > 0) {
    lines.push(`  运行配置：${configKeys.map(key => `${key}=${config[key]}`).join('、')}`)
  }
  if (row.schedule !== undefined) {
    const schedule = row.schedule
    // 「排期」 in the exact words `task.schedule` takes: mode, cron, and whether
    // it is armed right now.
    lines.push(`  排期：${schedule.enabled ? '已上膛' : '未上膛'}，mode=${schedule.mode}${schedule.mode === 'cron' ? `，cron=${schedule.cron}` : ''}${schedule.maxRuns === undefined ? '' : `，最多 ${schedule.maxRuns} 次`}${schedule.runCount === undefined ? '' : `，已跑 ${schedule.runCount} 次`}`)
  }
  if (row.rules !== undefined && row.rules.length > 0) {
    lines.push(`  会话规则（${row.rules.length} 条）：`)
    for (const rule of row.rules) {
      lines.push(`    ${rule.enabled ? '[上膛]' : '[解甲]'} trigger=${rule.trigger}${rule.trigger === 'cron' ? ` cron=${rule.cron}` : ''} send=${rule.send} 送到 ${rule.session}，内容是「${rule.sends}」（规则 id ${rule.id}）`)
    }
  }
  if (row.binds !== undefined && row.binds.length > 0) lines.push(`  挂的来源：${row.binds.join('、')}`)
  if (row.sessions !== undefined && row.sessions.length > 0) {
    lines.push(`  会话（${row.sessions.length} 条）：`)
    for (const session of row.sessions) {
      // The id AND the name: the id is what every session action takes, and the
      // name is what the reader can recognize.
      lines.push(`    ${session.title ?? '（没有名字）'}（${session.session}，${session.rounds} 轮${session.unread ? '，有未读' : ''}）`)
    }
  }
  if (row.attachments !== undefined) lines.push(`  附件：${row.attachments} 个`)
  if (row.live !== undefined) lines.push(`  现在：${row.live}（running = 正在跑，waiting = 等你，idle = 闲着，unknown = 这台机器看不见它的会话）`)
  if (row.unread === true) lines.push('  有未读的回复')
  return lines.join('\n') === '' ? '' : `\n${lines.join('\n')}`
}

/** The written content of a checklist row, as prose, or nothing on a brief row. */
function itemBodyOf(row: ItemRow & Partial<ItemDetail>): string {
  if (row.body === undefined) return ''
  const lines: string[] = []
  if (row.body !== '') lines.push(`  正文：${row.body}`)
  if (row.notes !== undefined && row.notes !== '') lines.push(`  备注：${row.notes}`)
  if (row.tags !== undefined && row.tags.length > 0) lines.push(`  标签：${row.tags.join('、')}`)
  if (row.steps !== undefined && row.steps.length > 0) {
    lines.push(`  步骤：${row.steps.map(step => `${step.done ? '[x]' : '[ ]'} ${step.text}（id ${step.id}）`).join('；')}`)
  }
  if (row.progress !== undefined) lines.push(`  进度：${row.progress.done}/${row.progress.total}`)
  // The dates are printed as the raw stamp AND the local day, because the reader
  // of this line is a model that has been told the unit is a day — so a bare
  // 13-digit number is the one thing that would make it guess.
  // 三个日期的**词与界面、与动作目录同一套**（开始 / 计划 / 截止）：这一行是模型读给自己
  // 听的，而它答给读者的那句话里会带上这些词——一个词两套写法，读者看到的是两个名字指同一件事。
  for (const [label, at] of [['开始', row.startsAfter], ['计划', row.dueAt], ['截止', row.hardDueAt]] as const) {
    if (at !== undefined) lines.push(`  ${label}：${at}（${localDayOf(at)}）`)
  }
  /* THE VERDICT, printed — not left for the caller to derive.
   *
   * The three stamps above say WHEN; this says WHAT IT MEANS, and the two are
   * different questions: the precedence between a gate, a hard deadline and a
   * soft plan is a judgment with an order, and a row whose dates contradict each
   * other has no honest "how late" answer at all. The interface has printed this
   * verdict all along (`datePostureOf`); the model was handed three numbers and
   * had to recompute a derivation it cannot reproduce correctly — local-day
   * boundaries included. */
  if (row.datePosture !== undefined) lines.push(`  日期态势：${row.datePosture}`)
  if (row.taskId !== undefined && row.taskId !== '') lines.push(`  关联卡片：${row.taskId}`)
  if (row.storedStatus !== undefined && row.storedStatus !== row.status) {
    lines.push(`  存储状态：${row.storedStatus}`)
  }
  return lines.join('\n')
}

/** A stamp as the local calendar day it names, for a reader that thinks in days. */
function localDayOf(at: number): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/* ── the three tools, assembled from the catalog ─────────────────────────── */

const CAPABILITIES_DESCRIPTION =
  '查这块板现在支持哪些动作、每个动作要哪些参数、做完能不能撤销、谁有权做。先查后做：不要凭印象拼参数表。返回的 reachable 是你能用的全部动作，humanOnly 是只有人能做的（列出来是为了让你别浪费一轮去试）。'

const QUERY_DESCRIPTION =
  '看板与任务清单的只读查询。filter 用和界面同一套筛选语法（空格分隔，key:value 是筛选、其余是字面搜索）。返回的每一行都带短编号（#12）而不是 uuid —— 要接着改就在下一次调用里用它。清单条目按编号引用，没有编号的行一律不返回。'

const EXECUTE_DESCRIPTION =
  '按顺序执行一批写操作。ops 逐条执行，第一条失败就停后面，已生效的不会回滚，每条都有回执。破坏性动作（danger 是 irreversible）先 dry_run 看一遍。参数表用 taskboard_capabilities 查，不要猜。'

/** Build the three tool definitions. Registration is the caller's job, so this
 *  stays a pure function of the catalog and the host faces. */
export function createTaskboardTools(deps: ToolDeps): readonly ToolDefinition[] {
  const opEnum = [...TOOL_ACTION_IDS]
  /**
   * The envelope's published shape is DERIVED from the spec's own shape field.
   *
   * A `type: 'boolean'` for every entry is how
   * `idempotencyKey` — a string, read as a string, stored in a `Map<string, …>`
   * — comes out of this schema as a boolean. A model that obeys it sends `true`,
   * the reader's `typeof === 'string'` guard yields `''`, and the whole
   * retry-safety feature does nothing while the schema claims it is in force.
   *
   * Reading `spec.boolean` instead means the shape is stated once, in the
   * catalog, and a parameter that changes kind cannot be published as the wrong
   * one — the renderer has nothing to hardcode.
   */
  const envelope = Object.fromEntries(
    Object.entries(EXECUTE_ENVELOPE_PARAMS).map(([name, spec]) => [name, {
      type: spec.boolean === true ? 'boolean' : 'string',
      description: spec.about,
    }]),
  )

  const capabilities: ToolDefinition = {
    name: 'taskboard_capabilities',
    description: CAPABILITIES_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        /* THE COST STRUCTURE, FIXED. This tool is documented as 「先查后做」, and its
         * full answer is ~7,000 characters for 36 actions — so every single write
         * began by paying for the entire catalog a caller about to move one card
         * did not need. Narrowing here means the common call pays for the names
         * and the rare call pays for the parameters. */
        topic: {
          type: 'string',
          description: '不填 = 摘要（动作名 + 一句话 + 有哪些域，不含参数）。给一个域（task / item / board / session / rule / preset / cruise）看那个域的全部动作；给一个动作 id（task.create）看那一个的完整参数。',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          verbs: { type: 'array', items: { type: 'string' } },
          reachable: { type: 'array', items: { type: 'string' } },
          humanOnly: { type: 'array', items: { type: 'string' } },
          actions: { type: 'array', items: { type: 'object' } },
          scoped: { type: 'string' },
          domains: { type: 'array', items: { type: 'string' } },
          hint: { type: 'string' },
        },
        required: ['verbs', 'reachable', 'humanOnly', 'actions'],
        additionalProperties: false,
      },
      // One line per action: its id, then what it DOES. The model is deciding
      // what to try next, and that needs the sentence, not the JSON path to
      // it. Parameters follow, because the conditions are what make a batch
      // half-succeed.
      render: (_args, value) => {
        const view = value as unknown as ReturnType<typeof capabilityView>
        const lines = view.actions.map(action => {
          /* THE LEGAL VALUES ARE PART OF THE RULE, so they are printed with it.
           *
           * `renderParam` has always carried `oneOf` into the data — and this
           * template then printed only `about`, so THIRTY-SIX actions' closed
           * value sets never reached the model. What that produced is the defect
           * this whole surface is being rebuilt around: the description said
           * 「五档之一：待规划 / 待办 / 进行中 / 待审核 / 已完成」 (the reader's words)
           * while `checkParams` compared against `backlog/todo/running/review/done`
           * (the stored words), so a model that followed the description exactly
           * was refused every time — and the refusal named values the
           * description had never shown it.
           *
           * A default stated in prose is not a default anybody can check; the
           * same sentence here, rendered from the FIELD the validator reads, is
           * one fact with one home. */
          const entries = Object.entries(action.params)
          const params = entries
            .map(([name, spec]) => {
              const condition = spec.required ? '（必填）' : spec.requiredWhen === undefined ? '' : `（${spec.requiredWhen} 时必填）`
              const allowed = spec.oneOf === undefined || spec.oneOf.length === 0 ? '' : `（可选：${spec.oneOf.join(' / ')}）`
              const absent = spec.appliesWhen === undefined ? '' : `（${spec.appliesWhen}）`
              return `    ${name}${condition}：${spec.about}${allowed}${absent}`
            })
            .join('\n')
          const head = `${action.id} —— ${action.summary}`
          // A compact answer carries no parameters, so it must not print an empty
          // 「危险级…」 block either: that would be three lines per action saying
          // nothing the summary has not said.
          return entries.length === 0 ? head : `${head}\n  危险级 ${action.danger}；经 ${action.lane} 写入\n${params}`
        })
        return text([
          `你能用 ${view.reachable.length} 个动作，动词只有这些：${view.verbs.join(' / ')}`,
          `只有人能做（别试）：${view.humanOnly.join('、') || '（无）'}`,
          ...(view.scoped === undefined ? [] : [`范围：${view.scoped}`]),
          ...(view.domains === undefined || view.domains.length === 0 ? [] : [`可以按域查：${view.domains.join(' / ')}`]),
          ...(view.hint === undefined ? [] : [view.hint]),
          '',
          ...lines,
        ])
      },
    },
    execute: async (args) => {
      const topic = (args as { topic?: unknown }).topic
      return capabilityView(typeof topic === 'string' ? topic : undefined)
    },
  }

  const query: ToolDefinition = {
    name: 'taskboard_query',
    description: QUERY_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        // **THE VALUES GO IN TOO.** Naming `has:` without saying `has:auto` is one of
        // its values leaves the model knowing the key exists and still guessing what
        // goes after the colon, which is the same silence as not knowing the key at
        // all. Both halves come from the registries, so neither can go stale on its
        // own.
        filter: {
          type: 'string',
          description: `${filterHelp().syntax}。可用的筛选：${filterHelp().keys.join(' ')}。可用的取值：${filterHelp().values.join(' ')}`,
        },
        of: {
          type: 'string',
          description: '只读一条：给一张卡的名字或它的短编号（清单条目用 #12）。回来的是这一条的全部——运行配置、排期、会话规则、挂的来源、它的会话、附件数量、在跑还是闲。重名会给一句拒绝并列出候选，不会替你挑一张。',
        },
        detail: {
          type: 'string',
          enum: ['brief', 'full', 'deep'],
          /* The description is the whole contract for this parameter, so it states
           * what each value RETURNS rather than gesturing at "more": a phrase like
           * 「full 连正文一起回」 describes a value no branch has to read. */
          description: 'brief：编号、标题、状态（默认，只回答「板子上有什么」）。full：再加正文、备注、步骤、标签、进度与三个日期。deep：再加你能写的全部东西——六项运行配置、排期、会话规则、挂的来源、它的会话（名字、几轮、未读）、附件数量、在跑还是闲。deep 贵得多，配合 limit 用。清单条目的状态是「派生」的：挂在正在跑的卡上的行读作 inProgress（存的那一档在 storedStatus 里）。',
        },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['comments', 'rounds'] },
          description: '点名要才回的重内容。comments：这张卡的完整评论（按会话分组、全文，不截断）；rounds：执行轮次账目（哪条会话、何时、怎么结束，可配 rounds 限条数）。默认都不回：评论是你自己写的话，不该被每一次「看一下板」顺手倒进上下文。',
        },
        rounds: { type: 'number', description: 'include 里有 rounds 时，最多回多少条轮次（默认 50，上限 200）。' },
        limit: { type: 'number', description: '最多回多少行（默认 20，上限 100）。AI 侧查询在服务端就截断，不会把整份清单塞进上下文。' },
        posture: { type: 'string', description: '给一个会话 id，连它的在跑/归档/等批准/等回答态势一起回。态势是会话的事实，卡片不是会话，所以要会话 id。' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          filter: { type: 'string' },
          /** Echoed so a model can tell a brief answer from a full one without
           *  inferring it from which fields happen to be absent. */
          detail: { type: 'string' },
          tasks: { type: 'array', items: { type: 'object' } },
          items: { type: 'array', items: { type: 'object' } },
          /** Whether either list hit the limit — so a short answer is never
           *  mistaken for a complete one. */
          truncated: { type: 'boolean' },
        },
        required: ['ok', 'filter', 'detail', 'tasks', 'items'],
        additionalProperties: true,
      },
      // The count first, because "how much is there" is the question behind
      // every further turn; then the rows with the short number the model must
      // quote back.
      //
      // `detail: 'full'` RENDERS ITS CONTENT HERE, not in a second render path:
      // a caller that asked for the body of a note and gets a title has been
      // lied to, and the lie is invisible because the JSON is right there. So the
      // prose carries what the projection carries.
      render: (_args, value) => {
        const result = value as {
          ok?: boolean
          detail?: string
          filter?: string
          truncated?: boolean
          narrow?: string
          tasks?: readonly (TaskRow & Partial<TaskDetail> & Partial<TaskDeep>)[]
          items?: readonly (ItemRow & Partial<ItemDetail>)[]
          comments?: readonly { session: string; title?: string; rounds: readonly { at: number; text: string; state: string }[] }[]
          rounds?: readonly { round: string; session?: string; at?: number; result?: string; error?: string }[]
        }
        if (result.ok === false) return text([(result as { detail?: string }).detail ?? '这次查询没有读到数据。'])
        const tasks = result.tasks ?? []
        const items = result.items ?? []
        return text([
          `卡片 ${tasks.length} 条，清单条目 ${items.length} 条${result.filter === undefined || result.filter === '' ? '' : `（筛选：${result.filter}）`}。${result.truncated === true ? '（已达 limit 的上限，还有更多。）' : ''}`,
          ...(result.narrow === undefined ? [] : [result.narrow]),
          ...tasks.map(row => `卡片：${row.title}（${row.status}）\n${taskBodyOf(row)}${taskDeepBodyOf(row)}`),
          ...items.map(row => `${row.ref} ${row.title}（${row.status}）\n${itemBodyOf(row)}`),
          // The heavy halves, rendered because the model asked for them: a
          // projection that carries the words in JSON and prints nothing here
          // would be the same lie the detail parameter used to tell.
          ...(result.comments ?? []).map(group => [
            `评论（${group.title ?? group.session}）：`,
            ...group.rounds.map(entry => `  [${entry.state}] ${entry.text}`),
          ]).flat(),
          ...(result.rounds ?? []).length === 0 ? [] : [
            `轮次（${(result.rounds ?? []).length} 条，最近在后）：`,
            ...(result.rounds ?? []).map(entry => `  ${entry.result ?? '未结算'}${entry.error === undefined ? '' : `：${entry.error}`}`),
          ],
        ])
      },
    },
    execute: async (args, exec) => runQuery(deps, args, exec),
  }

  const execute: ToolDefinition = {
    name: 'taskboard_execute',
    description: EXECUTE_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          description: '要执行的动作序列，按顺序跑',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: opEnum, description: '动作 id，取自 taskboard_capabilities 的 reachable' },
              payload: { type: 'object', description: '这个动作的参数，字段见该动作的 params' },
            },
            required: ['op'],
            additionalProperties: false,
          },
        },
        ...envelope,
      },
      required: ['ops'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          dryRun: { type: 'boolean' },
          ok: { type: 'boolean' },
          summary: { type: 'string' },
          boardRevision: { type: 'number' },
          itemsRevision: { type: 'number' },
          reports: { type: 'array', items: { type: 'object' } },
          changed: { type: 'object' },
        },
        required: ['dryRun', 'ok', 'summary', 'boardRevision', 'itemsRevision', 'reports'],
        additionalProperties: true,
      },
      // THE RECEIPT, IN THE ORDER THE MODEL NEEDS IT: whether anything was
      // written first, then the sentence, then the short numbers, then what
      // each op actually said. The dry-run distinction LEADS, because a
      // rehearsal rendered as "added 3 items" is the one line that must never
      // be wrong.
      render: (_args, value) => {
        const result = value as unknown as ExecuteResult
        /* THE FIRST LINE IS A MEASUREMENT, NOT AN OPENING COURTESY.
         *
         * It used to be `dryRun ? 演练 : 已落盘` — so a batch that only relayed a
         * run to the engine, and wrote no document at all, opened with
         * 「已落盘」. Nothing had been written; the model's next turn was built
         * on that sentence. Now the head is derived from what the reports say
         * landed, and the "nothing was written" case has words of its own. */
        const wroteAny = result.reports.some(report => report.outcome?.lane === 'document'
          && report.outcome.unchanged !== true
          && report.outcome.wrote.length > 0)
        const relayedAny = result.reports.some(report => report.outcome?.lane === 'engine')
        const head = result.dryRun
          ? '演练：一个字节都没有落盘。'
          : wroteAny ? '已落盘。'
            // Pure-relay batches land here: a real thing happened, and it was
            // NOT a write.
            : relayedAny ? '这一批只交给了引擎，没有写文档。'
              : '这一批没有产生任何写入。'
        const touched = [
          ...(result.changed?.items ?? []).map(row => `${row.ref} ${row.title}`),
          ...(result.changed?.tasks ?? []).map(row => `卡片「${row.title}」`),
        ]
        return text([
          head,
          result.summary,
          ...(touched.length > 0 ? [`受影响的：${touched.join('、')}`] : []),
          ...(result.enginePending.length > 0 ? [`已受理但引擎不在线：${result.enginePending.join('、')}`] : []),
          // The third state, in the model's own words: nothing happened, and
          // the reason is the page, not the board.
          ...(result.engineUnsupported.length > 0
            ? [`没有执行（持席位的浏览器不支持这条载具，换一台设备或刷新后再试）：${result.engineUnsupported.join('、')}`]
            : []),
          ...result.reports.filter(report => !report.ok).map(report => `未生效：${report.op} —— ${report.detail}`),
        ])
      },
      presentationMeta: (_args, value) => presentationOf(value as unknown as ExecuteResult),
    },
    execute: async (args, exec) => runBatch(deps, (args ?? {}) as ExecuteRequest, exec),
  }

  return [capabilities, query, execute]
}

/**
 * THE ONE CONSTRUCTOR FOR A READ THAT FOUND NOTHING.
 *
 * The query's output schema declares five REQUIRED fields. Every `ok: false`
 * branch used to return `{ ok, detail }` and nothing else, so the host's own
 * validator rejected the answer — 「missing required property "value.filter"」 —
 * and a model that asked about a row which does not exist got a TOOL ERROR
 * instead of the sentence the branch had carefully written for it.
 *
 * That is the worst class of defect this project names: THE ERROR PATH VIOLATED
 * ITS OWN CONTRACT. The refusal sentence existed and was correct; the envelope
 * around it was malformed, so the caller never saw it.
 *
 * One constructor, so the next branch cannot forget: a refusal is a first-class
 * ANSWER (nothing matched, here is what I looked for) with empty lists, not a
 * malformed success.
 * @param detail - the sentence the caller reads.
 * @param filter - what was asked, echoed as the success path does.
 * @returns a schema-complete refusal.
 */
function queryRefusal(detail: string, filter = ''): {
  readonly ok: false
  readonly filter: string
  readonly detail: string
  readonly tasks: readonly never[]
  readonly items: readonly never[]
} {
  return { ok: false, filter, detail, tasks: [], items: [] }
}

/** The words each date field uses, in the model's own vocabulary AND the reader's.
 *
 *  Two labels because the two must be sayable back: the model reads the field
 *  name in the catalog (`startsAfter`) and the person reads 「开始」 on the row, and
 *  a refusal that names only one of them is a refusal the other party cannot
 *  follow. Kept here rather than derived from the locale table, which the host
 *  half cannot read — and rather than in the catalog, because the catalog's job
 *  is what a parameter IS, not what to say when two of them disagree. */
const DATE_FIELD_WORDS: Readonly<Record<string, string>> = {
  startsAfter: '开始（startsAfter）',
  dueAt: '计划（dueAt）',
  hardDueAt: '截止（hardDueAt）',
}

/**
 * The refusal for a row whose three dates cannot all be true.
 *
 * NAMES THE PAIR, not just the field: 「日期有矛盾」 leaves the caller to work out
 * which two, and it has three candidates. The conflict already carries both ends
 * (`field` and `limitField`) — printing one of them would name a field that was
 * never in conflict while pointing at the one that was.
 * @param conflict - the pair that disagrees.
 * @returns the sentence the model reads.
 */
function dateConflictSentence(conflict: ItemDateConflict): string {
  const a = DATE_FIELD_WORDS[conflict.field] ?? conflict.field
  const b = DATE_FIELD_WORDS[conflict.limitField] ?? conflict.limitField
  return `${a} 不能晚于 ${b}：这一组日期自相矛盾，所以什么都没写。改掉其中一个再来，或者先只写一个日期。`
}

/**
 * The read tool's body.
 *
 * ── WHY THIS IS THE HALF THAT MATTERED ─────────────────────────────────────
 *
 * The write surface has always been larger than the read surface. A model could
 * set six run-config fields, arm a schedule, create a session rule, bind a
 * source — and `taskboard_query` could tell it a card's TITLE and STATUS. So
 * 「给这张卡加一条规则」 was impossible to do correctly: `rule.create` requires a
 * session id, and no query in the system returned one. The model's remaining
 * moves were to guess, or to ask the person to copy an identifier out of the
 * screen they were looking at.
 *
 * A tool that can write what it cannot read is a tool that makes its caller
 * guess, and a guess is indistinguishable from an answer until something breaks.
 *
 * ── THREE DEPTHS, AND WHY THE DEFAULT IS THE SHALLOW ONE ───────────────────
 *
 *  · `brief` — the name and the column. The default, because 「看一下板上有什
 *    么」 is the overwhelmingly common question and the answer to it is a list;
 *  · `full` — plus what a person typed (body, notes, steps, dates);
 *  · `deep` — plus everything the model may WRITE: run config, schedule, session
 *    rules, binds, sessions, attachment counts, live state.
 *
 * `deep` is not the default because it is not free: a card's sessions and rules
 * are paid for in context on EVERY turn, and a model that only wanted the board's
 * shape should not carry them. Depth is the caller's decision, `limit` is the
 * other knob, and `truncated` is what tells the caller the two interacted.
 *
 * `of` is the fourth way in: one card, by title or short number, in deep — the
 * 「X 这张卡现在什么情况」 question, which is a different question from 「板上有
 * 什么」 and deserves its own answer rather than a filtered list of one.
 *
 * ── THE HEAVY THINGS ARE OPT-IN (`include`) ────────────────────────────────
 *
 * Round transcripts and comment threads are the person's own words. They are
 * readable in full — that is a product requirement, not an optimisation target —
 * but they are not what 「看一下板」 means, so they are read only when asked for.
 * A default that dragged every comment into context would make the person's own
 * writing the most expensive thing in the tool.
 */
async function runQuery(deps: ToolDeps, args: unknown, exec?: ToolRunContext): Promise<unknown> {
  if (exec?.signal.aborted === true) return queryRefusal('这次调用已经被取消，没有读到数据。')
  const board = deps.board()
  if (board === undefined || !board.available) {
    return queryRefusal('看板存储不可用，这次查询没有读到任何数据。')
  }
  const request = (args ?? {}) as {
    filter?: string
    of?: unknown
    detail?: string
    include?: readonly string[]
    limit?: number
    posture?: string
    rounds?: number
  }
  const limit = Math.min(100, Math.max(1, request.limit ?? 20))
  const requested = request.detail
  const depth: 'brief' | 'full' | 'deep' = requested === 'deep' ? 'deep' : requested === 'full' ? 'full' : 'brief'
  const doc = board.getDoc()
  const items = board.getItemsDoc()
  const filter = (request.filter ?? '').trim()
  /* THE TWO SIDE TABLES every projection reads, built once.
   *
   * `cards` is the status map the FILTER judged with, so the rows a filter
   * returned and the status printed on them come from one read of the board — a
   * row that matched `status:review` cannot come back labelled `todo`.
   * `titles` is what turns a row's `taskId` from a uuid into the name a caller
   * can say back. */
  /* ONE CLOCK FOR THE WHOLE ANSWER. Read once, so two rows in one reply cannot
   * disagree about whether a day has passed — the same rule the date module
   * states by taking `now` as an argument. */
  const clock = deps.now()
  const itemCtx = itemSearchContext(clock, undefined, cardStatusMapOf(doc.tasks))
  const cards = itemCtx.cards
  const titles = cardTitlesOf(doc.tasks)

  /* `of` — ONE TARGET, READ COMPLETELY.
   *
   * TWO DOCUMENTS, ONE ADDRESS PARAMETER. The description has always promised
   * 「一张卡的名字或它的短编号（清单条目用 #12）」, but this branch only ever asked
   * `resolveCard` — so the checklist half of the promise was a sentence with no
   * implementation behind it, and 「#54」 came back as 「看板上没有叫「#54」的卡」.
   * That is the worst possible answer: the model has just been handed `#54` by a
   * receipt, and the surface tells it the row does not exist.
   *
   * WHICH DOCUMENT IS DECIDED BY THE SPELLING, and the spelling is the grammar
   * this project already has: a `#`-prefixed number is a checklist address
   * (`refOf` is the one home of that grammar, and `verify-address-grammar` keeps
   * it that way). A bare number is ALSO a checklist ref — cards have no short
   * numbers at all, so nothing else could be meant. Everything else is a card
   * title or id, exactly as before.
   *
   * `#` STAYS OUT OF `filter`. `#54` in the search box is a TAG (the reader's own
   * word) under `item-query`'s grammar, and two grammars starting with the same
   * character is the collision the address-grammar gate exists to keep separate.
   * Teaching `filter` to read it as a ref would make `#54` mean one thing in `of`
   * and another in `filter`. */
  if (request.of !== undefined && String(request.of).trim() !== '') {
    const spoken = String(request.of).trim()
    const looksLikeRef = /^#?\d+$/.test(spoken)
    if (looksLikeRef) {
      const ref = Number(refOf(spoken))
      const found = items.items.find(item => item.ref === ref)
        // A caller that opened a card and got its title might paste the row's
        // URL-bearing id instead; the number is the documented address, but
        // matching the id too costs one comparison and cannot confuse the two.
        ?? items.items.find(item => item.id === spoken)
      if (found === undefined) {
        const known = items.items.slice(0, 20).map(item => `#${item.ref} ${itemTitleOf(item)}`).join('、')
        return queryRefusal(`清单里没有 #${ref}。清单上现在有：${known || '（一条都没有）'}`)
      }
      return compact({
        ok: true,
        filter,
        detail: 'full',
        tasks: [],
        items: [itemDetailRow(found, cards, titles, clock)],
        truncated: false,
      })
    }
    const looked = resolveCard(doc.tasks, spoken)
    if (looked.kind === 'missing') {
      return queryRefusal(`看板上没有叫「${spoken}」的卡。用 filter 先看一眼板上有哪些卡。`)
    }
    if (looked.kind === 'ambiguous') {
      return queryRefusal(ambiguousCardWhy(spoken, looked.matches))
    }
    const card = looked.task
    const sessionTitles = await sessionTitlesOf(deps, card)
    const deep = taskDeepRow(card, sessionTitles, liveOf(deps, card))
    return compact({
      ok: true,
      filter,
      detail: 'deep',
      tasks: [deep],
      items: items.items
        .filter(item => item.taskId === card.id)
        .map(item => itemDetailRow(item, cards, titles, clock)),
      truncated: false,
      ...await includedOf(deps, request.include, card, request.rounds),
    })
  }

  /* The CARDS run the board's own grammar, the same one the board's search box
   * runs. The facets are the ones the board itself supplies, from the same core
   * functions its own components read (`hasLiveAutomation`, `taskUnviewed`), so
   * 「which cards are on fire」 has one answer rather than one per surface. A
   * workspace title is the one facet the HOST owns, so it is passed in rather
   * than guessed: a card with no workspace is not in any workspace, and saying
   * so is better than matching it against a name nobody gave it. */
  const workspaceTitle = deps.workspaceTitle
  const matchedTasks = doc.tasks.filter(task => matchTask(task, filter, [], {
    ...(task.workspaceId !== undefined && workspaceTitle !== undefined
      ? { workspaceTitle: workspaceTitle(task.workspaceId) }
      : {}),
    hasAutomation: hasLiveAutomation(task),
    isUnviewed: taskUnviewed(task),
  }))
  // The checklist is matched by the SAME grammar the search box a person types
  // into uses, reached through the one door that leads to it. 看板的栏跟着一起
  // 进去，而这不是优化：一条挂卡的行「在哪一栏」由那张卡回答，不带上它，
  // `status:` 就成了界面给得出、这个查询复现不了的筛子。
  const matchedItems = items.items.filter(item => matchItemQuery(item, filter, itemCtx))

  /* TRUNCATION IS MEASURED, NOT INFERRED FROM THE CAP.
   *
   * It used to be `list.length >= limit`, which answers a DIFFERENT question:
   * a board holding exactly `limit` cards reported 「还有更多」 with the whole
   * board in hand. The caller's next move is to narrow the filter, so a false
   * positive costs a turn and teaches the model that the flag is noise. Taking
   * one MORE row than asked for is what makes 「there is more」 a fact. */
  const taskSlice = matchedTasks.slice(0, limit)
  const itemSlice = matchedItems.slice(0, limit)
  const truncated = matchedTasks.length > limit || matchedItems.length > limit

  const rows = depth === 'deep'
    ? await Promise.all(taskSlice.map(async task =>
      taskDeepRow(task, await sessionTitlesOf(deps, task), liveOf(deps, task))))
    : depth === 'full' ? taskSlice.map(taskDetailRow) : taskSlice.map(taskRow)
  const itemRows = depth === 'brief'
    ? itemSlice.map(item => itemRow(item, cards, titles))
    : itemSlice.map(item => itemDetailRow(item, cards, titles, clock))

  const view = compact({
    ok: true,
    filter,
    detail: depth,
    tasks: rows,
    items: itemRows,
    truncated,
    // The three ways to get a bigger answer, stated where the caller is
    // deciding rather than only in the parameter's own description.
    ...truncated ? { narrow: '结果被 limit 截断了：加 filter 收窄，或把 limit 调大（上限 100）。' } : {},
    ...request.posture !== undefined && request.posture !== ''
      // Posture is a fact about a SESSION, and a card is not a session — so the
      // caller names the session, rather than this tool guessing which of a
      // card's bindings it meant.
      ? { posture: await deps.posture(request.posture) }
      : {},
  })
  return view
}

/** A card's live state, or undefined when this host cannot see its sessions. */
function liveOf(deps: ToolDeps, task: TaskRecord): string | undefined {
  const sessions = relatedSessionIdsOf(task, undefined, undefined)
  if (sessions.length === 0) return undefined
  const seen = sessions.map(fact => sessionRunningOf(deps.sources, fact.sessionId).value)
  if (seen.some(value => value === true)) return 'running'
  if (seen.some(value => value === 'unknown')) return 'unknown'
  return 'idle'
}

/**
 * `sessionId → title` for the sessions this card is related to.
 *
 * Read one card at a time and only when the row is deep: the titles are a nicety
 * on a brief row and a necessity on a deep one, and paying for them on every
 * list would make 「看一下板上有什么」 cost a lookup per card.
 *
 * A session this host cannot name is reported by its id rather than dropped:
 * 「there is a session I cannot name」 is a fact, and a missing row would read as
 * a card with fewer sessions than it has.
 */
async function sessionTitlesOf(deps: ToolDeps, task: TaskRecord): Promise<ReadonlyMap<string, string> | undefined> {
  const ids = relatedSessionIdsOf(task, undefined, undefined).map(fact => fact.sessionId)
  if (ids.length === 0) return undefined
  const out = new Map<string, string>()
  for (const id of ids) {
    const facts = await deps.posture(id)
    const title = typeof (facts as { title?: unknown }).title === 'string' ? String((facts as { title?: unknown }).title) : ''
    if (title !== '') out.set(id, title)
  }
  return out.size === 0 ? undefined : out
}

/**
 * The opt-in heavy content: comment threads and round transcripts.
 *
 * `include` is a list because these are independent questions and a caller
 * sometimes needs one without the other. Neither is ever returned by default:
 * they are the person's own words, and a tool that dragged them into every
 * 「看一下板」 would make their writing the most expensive thing in the context.
 * @returns the extra fields, or an empty object when nothing was asked for.
 */
async function includedOf(
  deps: ToolDeps,
  include: readonly string[] | undefined,
  task: TaskRecord,
  rounds: number | undefined,
): Promise<Record<string, unknown>> {
  const asked = new Set((include ?? []).map(name => String(name)))
  if (asked.size === 0) return {}
  const extra: Record<string, unknown> = {}
  // ONE lookup, shared by both halves: the threads are grouped by session, and a
  // group headed by an id is a group the reader cannot name.
  const titles = asked.has('comments') ? await sessionTitlesOf(deps, task) : undefined
  if (asked.has('comments')) {
    // FULL text, per round, grouped by session. The product requirement is that
    // a person can read their whole comment and its whole context; this is the
    // model's view of the same words, not a summary of them.
    const bySession = new Map<string, { round: string; at: number; text: string; state: string }[]>()
    for (const round of task.executions) {
      const text = round.comment ?? ''
      if (text === '') continue
      const key = round.sessionId ?? '(未定会话)'
      const list = bySession.get(key) ?? []
      list.push({
        round: round.id,
        at: round.startedAt,
        text,
        state: round.result ?? (round.injectedAt === undefined ? 'queued' : 'sent'),
      })
      bySession.set(key, list)
    }
    extra.comments = [...bySession].map(([session, list]) => compact({
      session,
      title: titles?.get(session),
      rounds: list,
    }))
  }
  if (asked.has('rounds')) {
    // The ledger, without the payloads: which session, when, how it ended.
    const cap = Math.min(200, Math.max(1, rounds ?? 50))
    extra.rounds = task.executions.slice(-cap).map(round => compact({
      round: round.id,
      session: round.sessionId,
      at: round.startedAt,
      endedAt: round.endedAt,
      result: round.result,
      error: round.error,
      direct: round.direct,
      // Whether this round ran the line as a slash command rather than sending
      // it as text. Writable (`task.comment` publishes `command`), so readable:
      // it is also the difference between 「说了一句话」 and 「执行了一条命令」.
      command: round.command,
    }))
  }
  return extra
}
