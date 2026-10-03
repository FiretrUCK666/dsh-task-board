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
  type ActionDanger,
  type ActionDomain,
  type ActionId,
  type ActionLane,
  type ActionSurface,
  type ParamSpec,
} from '../../core/board-actions.ts'
import { QUALIFIER_KEYS, completeBoardQuery, itemSearchContext, matchItemQuery } from '../../core/task-search.ts'
import { itemQualifierVocabulary } from '../../core/item-query.ts'
import { clampCruiseLimit, type BoardCommand, type BoardCommit, type BoardDoc, type BoardView, type CruiseValue } from '../../core/board-doc.ts'
import { applyItemsCommit, deletedItemsOf, purgeItemTombstone, restoredItemOf, type ItemPurge, type ItemsCommit, type ItemsDoc } from '../../core/items-doc.ts'
import { createTask, taskBindsOf, type TaskBind, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
import type { SessionRule } from '../../core/automation.ts'
import { nextRunAtMs, isValidCron } from '../../core/schedule.ts'
import type { SchedulePreset } from '../../core/presets.ts'
import { RUN_CONFIG_KEYS, type RunConfigPresetConfig, type RunPresetsDocument } from '../../core/run-presets.ts'

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
import { armSchedule, moveTaskToStatus, removeSessionFromTask, type TransitionResult } from '../../core/task-transitions.ts'
// The checklist's write semantics: the SAME four functions the capture box and
// the detail pane call. A field write the tool does itself is a second answer to
// a question two surfaces already share, and the checklist is the second synced
// document — two writers with two no-op laws is a document whose replicas
// disagree about which edits happened.
import {
  applyItemPatch,
  applyItemStep,
  captureItemRecord,
  isItemListValue,
  planItemPromotion,
  readItemStepList,
  removeItemRecord,
} from '../../core/item-transitions.ts'
import { ITEM_PRIORITIES, ITEM_STATUSES, itemProgressOf, itemTagsOf, itemTitleOf, type ItemRecord, type ItemStatus, type ItemStatusView } from '../../core/item.ts'
import { derivedStatusOf } from '../../core/item-membership.ts'
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
  /** Relay one command to whichever replica holds the seat. `queued` = no
   *  engine. The whole union: the catalog decides which carrier an action
   *  rides, and the relay carries it as-is. */
  submitCommand(command: BoardCommand): { queued: boolean }
  available: boolean
}

export interface ToolDeps {
  board: () => ToolCommitFace | undefined
  posture: (sessionId: string) => Promise<SessionPosture>
  /** The live host faces, so a decision that needs to know whether a session
   *  is still working asks the SAME derivation the board does — never a second
   *  one written here. */
  sources: SessionPostureSources
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
 *  so a caller that only wants to know "what may I do" reads two lines. */
export function capabilityView(): {
  verbs: readonly string[]
  reachable: readonly string[]
  humanOnly: readonly string[]
  actions: readonly CapabilityAction[]
} {
  return {
    verbs: BOARD_VERBS,
    reachable: TOOL_ACTION_IDS,
    // Named, not omitted: a capability list that silently drops what the model
    // cannot do invites a turn spent discovering it.
    humanOnly: Object.keys(ACTIONS).filter(id => !TOOL_ACTION_IDS.includes(id as ActionId)),
    actions: capabilityActions(),
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
 *  list AND by the board's own search. It used to describe only the board's keys,
 *  so the model was taught board keys (`has:*`, `is:*`) that the list silently
 *  treats as free words — a query that returns nothing and reports no error —
 *  while everything the list actually speaks (`status:`, `p1`–`p4`, `!1`–`!4`,
 *  `has:`, `#标签`) was never mentioned at all. **A vocabulary taught by half is
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
   * It used to be the STORED one, which is the same defect as a facet counting
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
  readonly steps: readonly { readonly id: string; readonly text: string; readonly done: boolean }[]
  /** Millisecond stamps; read them as whole local days (see the catalog). */
  readonly startsAfter: number | undefined
  readonly dueAt: number | undefined
  readonly hardDueAt: number | undefined
  readonly progress: { readonly done: number; readonly total: number } | undefined
}

/**
 * A card is named by its TITLE, and the board has no short number for cards —
 * so a title is the handle a person and a model can both say. Printing the
 * uuid instead would be printing an identifier the model can neither remember
 * nor read back. The checklist is the document that mints `#12`, so that is
 * where a number comes from, and it comes from the document.
 */
function taskRow(task: TaskRecord): TaskRow {
  return { title: task.title, status: task.status }
}

/** The same row with its written content, for `detail: 'full'`. */
function taskDetailRow(task: TaskRecord): TaskDetail {
  return { ...taskRow(task), description: task.description, prompt: task.prompt }
}

/**
 * An item's number is the document-minted one (`#12`), never its uuid — and its
 * status is the DERIVED one, read through the very function the panel reads, so
 * a query answer and the row on screen cannot disagree about the same row.
 */
function itemRow(item: ItemRecord, running?: ReadonlyMap<string, boolean>): ItemRow {
  return {
    ref: `#${item.ref}`,
    id: item.id,
    title: itemTitleOf(item),
    status: derivedStatusOf(item, running),
    storedStatus: item.status,
    taskId: item.taskId,
  }
}

/** The same row with everything a reader typed, for `detail: 'full'`. */
function itemDetailRow(item: ItemRecord, running?: ReadonlyMap<string, boolean>): ItemDetail {
  const read = itemRow(item, running)
  return {
    ...read,
    body: item.body,
    notes: item.notes,
    tags: [...item.tags],
    steps: item.steps.map(step => ({ id: step.id, text: step.text, done: step.done })),
    startsAfter: item.startsAfter,
    dueAt: item.dueAt,
    hardDueAt: item.hardDueAt,
    progress: itemProgressOf(item),
  }
}

/* ── op resolution: the catalog decides what exists and who may do it ────── */

/** The kind a report is filed under, read from the CATALOG's verb — the one
 *  classification in this system. A hand-written op→kind map would be a
 *  second place to forget a new verb. */
function kindOf(id: string, ok: boolean, unchanged: boolean): OpReport['kind'] {
  if (!ok) return 'failed'
  if (unchanged) return 'unchanged'
  const verb = ACTIONS[id as ActionId]?.verb
  if (verb === 'create') return 'created'
  if (verb === 'delete') return 'deleted'
  if (verb === 'move') return 'moved'
  return 'updated'
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
  readonly kind: 'created' | 'updated' | 'moved' | 'deleted' | 'unchanged' | 'failed' | 'skipped'
  /** The short number and title this op touched, when it touched one. */
  readonly ref?: string
  readonly title?: string
  /**
   * WHICH DOCUMENTS ACTUALLY MOVED, and it is here because an action that writes
   * two documents cannot be reported by a subject-less 「已生效」.
   *
   * `item.promote` is the one: it creates a card AND links the row. The two
   * commits are separate, so a medium that takes the first and refuses the
   * second leaves the document in a half state — and the receipt used to say
   * 「没写进去」 about the whole op, which is how a reader learns that this tool's
   * failure sentences do not mean what they say. It is also what the catalog's
   * comment on that action used to CLAIM `applyOne` did, and did not.
   *
   * Absent on a refusal and on a no-op, because those moved nothing.
   */
  readonly documents?: readonly ActionDocument[]
  /** What happened, or what to change. Never a bare error code. */
  readonly detail: string
}

/** Why an op cannot run, in the words the catalog itself uses. */
export function refuseOp(id: string): { ok: false; detail: string } {
  const spec = ACTIONS[id as ActionId]
  if (spec === undefined) {
    // The COUNT is read from the table, never typed. It used to say 「十二个」while
    // `BOARD_VERBS` had thirteen, so every refusal told the model a number the
    // list under it contradicted — and a model that trusts a count it can check
    // will check it, find the mismatch, and stop trusting the rest of the line.
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

/** The one required-parameter check, driven by the catalog's own conditions.
 *  A conditional requirement cannot be decided from the payload alone (it
 *  names a fact about another field), so those are reported as a reminder
 *  rather than guessed at. */
function checkParams(id: ActionId, payload: Record<string, unknown>): string | undefined {
  const spec = ACTIONS[id]
  for (const [name, p] of Object.entries(spec.params)) {
    const value = paramOf(payload, name)
    const missing = value === undefined || value === null || value === ''
    if (!missing) {
      if (p.oneOf !== undefined && !p.oneOf.includes(String(value))) {
        return `${name} 只能是 ${p.oneOf.join(' / ')}，收到的是「${String(value)}」`
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

/* ── the batch runner ────────────────────────────────────────────────────── */

export interface ExecuteRequest {
  readonly ops: readonly { op: string; payload?: unknown }[]
  readonly dry_run?: boolean
  /**
   * The caller's promise that a retried batch is the SAME batch.
   *
   * A model that retries after a timeout cannot tell "my write did not land"
   * from "my write landed and the answer was lost", so it retries — and without
   * a key the retry is a second write. This is what makes the retry safe, and
   * it is why the field exists at all: it was declared, never read, and a
   * promise nobody keeps is worse than no promise, because the caller is told
   * it is protected.
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
  readonly counts: Readonly<Record<'created' | 'updated' | 'moved' | 'deleted' | 'unchanged' | 'failed' | 'skipped', number>>
  /** Rows this op handed to the engine while no replica held the seat. They
   *  are ACCEPTED, not done — a card that renders them as "已执行" is lying. */
  readonly enginePending: readonly string[]
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
      return { command: { type: 'run', taskId: found.id, trigger: 'manual', clientId }, title: found.title }
    }
    case 'comment': {
      const found = card()
      if (found === undefined) return missingCard
      const sessionId = String(payload.session ?? '')
      if (sessionId === '') return '要跟哪个会话说话？给一个 session。'
      const text = String(payload.text ?? '').trim()
      if (text === '') return '要发的话是空的。'
      return { command: { type: 'comment', taskId: found.id, sessionId, text, clientId }, title: found.title }
    }
    case 'session.create': {
      const found = card()
      if (found === undefined) return missingCard
      return { command: { type: 'session.create', taskId: found.id, config: readRunConfig(payload), clientId }, title: found.title }
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
      raw.push({ op: step.op, ok: false, detail: '未执行：这次调用已经被取消。' })
      continue
    }
    if (failed) {
      raw.push({ op: step.op, ok: false, detail: '未执行：上一条失败后本批停止。' })
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
    const problem = checkParams(id, payload)
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
    if (next.relay === true) {
      // WHICH CARRIER carries this action is CATALOG state (`spec.relay`).
      // Which action maps to which payload is the catalog's business, NOT this
      // file's: there is no "if the action is task.comment" here, only "build
      // what `relay` asks for and hand it to `command.type`". A host that knew
      // the action names would own a second copy of that mapping, and the two
      // copies drift the first time the catalog moves a carrier.
      const relay = (spec as { relay?: RelayKind }).relay
      if (relay === undefined) {
        raw.push({ op: step.op, ok: false, detail: `「${id}」在目录里没有 relay 派发，所以这里明确拒绝——转发它会跑错东西。` })
        failed = true
        continue
      }
      const built = buildRelay(relay, payload, doc)
      if (typeof built === 'string') {
        raw.push({ op: step.op, ok: false, detail: built })
        failed = true
        continue
      }
      if (request.dry_run === true) {
        raw.push({ op: step.op, ok: true, title: built.title, detail: `会经引擎${RELAY_VERB[relay]}。` })
        continue
      }
      const { queued } = board.submitCommand(built.command)
      raw.push({
        op: step.op,
        ok: true,
        title: built.title,
        // Accepted is not executed: the receipt names WHICH action was
        // accepted, or a queued request reads as a finished one.
        detail: queued ? `已受理（${RELAY_VERB[relay]}），引擎当前不在线，将在引擎上线后执行。` : `已交给引擎${RELAY_VERB[relay]}。`,
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
      const said = `#${String(payload.of ?? '').replace('#', '').trim()}`
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
          detail: `没写进去：${error instanceof Error ? error.message : String(error)}正文还在，没有回滚。`,
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
    // section stamp older than a section written in the meantime. The op used to
    // report 「已生效」 about the discarded write, list the row under 受影响的, and
    // the model's next turn was built on a fact that had not happened. Deciding
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
          detail: `没写进去：${error instanceof Error ? error.message : String(error)}${kept}`,
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
      // A one-document op keeps the subject-less sentence it always used, so
      // every receipt that was honest stays byte-identical. The two-document
      // form is the only one that had to change, and it is the only one that
      // was previously lying.
      detail: `${declined
        ? '这一条没有改成——另一台设备刚改过它，这次没写进去。'
        : noop ? '这一条已经是这样了，没有改动。' : landedWord(request.dry_run === true, moved)}${next.note ?? ''}`,
    })
  }

  // The kind is the catalog's word for the op, not a name list written here,
  // so a new verb cannot be missing from it.
  reports.push(...raw.map(report => ({
    ...report,
    kind: report.detail.startsWith('未执行') ? 'skipped' as const : kindOf(report.op, report.ok, report.detail.startsWith('这一条已经是这样了')),
  })))
  // The engine-pending set is read BEFORE the summary is written, because the
  // summary must not call an accepted run an effect.
  for (const report of reports) {
    if (report.ok && report.title !== undefined && report.detail.includes('已受理')) enginePending.push(report.title)
  }
  const counts = { created: 0, updated: 0, moved: 0, deleted: 0, unchanged: 0, failed: 0, skipped: 0 }
  for (const report of reports) counts[report.kind] += 1

  const done = reports.filter(report => report.ok)
  const firstFailure = reports.find(report => !report.ok && report.detail.startsWith('未执行') === false)
  const ok = firstFailure === undefined
  const summary = request.dry_run === true
    ? `演练：${done.length} 条会生效${ok ? '' : `，第 ${reports.indexOf(firstFailure!) + 1} 条过不去：${firstFailure!.detail}`}。没有落盘。`
    : ok
      // An accepted-but-unexecuted run is NOT an effect: saying "生效" for a
      // row that is only queued is the one sentence this tool must never say.
      ? `${done.length - enginePending.length} 条已生效${enginePending.length > 0 ? `，${enginePending.length} 条已受理（${enginePending.join('、')}）但引擎当前不在线，将在引擎上线后执行` : ''}。`
      : `前 ${done.length} 条已生效，第 ${reports.indexOf(firstFailure!) + 1} 条失败：${firstFailure!.detail}。已生效的不回滚。`
  const result: ExecuteResult = {
    dryRun: request.dry_run === true,
    ok,
    reports,
    summary,
    boardRevision: doc.revision,
    itemsRevision: items.revision,
    counts,
    enginePending,
    ...(request.dry_run === true ? {} : {
      // The same derivation the query answers with, over the document as it
      // stands AFTER the batch — so a receipt and a query cannot print two
      // different statuses for the same row.
      changed: {
        tasks: changedTasks.map(taskRow),
        items: changedItems.map(row => itemRow(row, runningMapOf(deps.sources, doc.tasks))),
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
): { doc: BoardDoc; items: ItemsDoc; task?: TaskRecord; item?: ItemRecord; unchanged?: true; note?: string; relay?: true; purge?: string } | string {
  const edited = (task: TaskRecord): TaskRecord => ({ ...task, updatedAt: now })
  const findTask = (): TaskRecord | undefined => doc.tasks.find(task => task.id === payload.of || task.title === payload.of)
  const findItem = (): ItemRecord | undefined => {
    const key = String(payload.of ?? '').replace('#', '')
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
    case 'task.move':
    case 'task.approve': {
      last = findTask()
      if (last === undefined) return `卡 ${String(payload.of)} 不存在。`
      const target = id === 'task.approve' ? 'done' as TaskStatus : String(payload.status) as TaskStatus
      const moved = through(moveTaskToStatus(last, target, now))
      if (typeof moved === 'string') return moved
      const tasks = doc.tasks.map(task => (task.id === last!.id ? moved.task : task))
      return moved.unchanged === true ? { doc, items, task: last, unchanged: true } : { doc: { ...doc, tasks }, items, task: moved.task }
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
      // already report `unchanged` rather than burning a revision; this one did
      // not, so 「改成了它本来的样子」 came back as a success that cost a write.
      if (Object.entries(applied).every(([key, value]) => found[key as keyof TaskRecord] === value)) {
        return { doc, items, task: found, unchanged: true }
      }
      const next = edited({ ...found, ...applied })
      return { doc: { ...doc, tasks: doc.tasks.map(task => (task.id === found.id ? next : task)) }, items, task: next }
    }
    case 'task.create': {
      const created = createTask({
        title: String(payload.title ?? ''),
        description: String(payload.description ?? ''),
        prompt: String(payload.prompt ?? ''),
        ...(payload.status === undefined ? {} : { status: payload.status as TaskStatus }),
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
        startsAfter: payload.startsAfter,
        dueAt: payload.dueAt,
        hardDueAt: payload.hardDueAt,
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
      if (found === undefined) return `清单里没有 #${String(payload.of).replace('#', '')}。`
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
      const nextInstant = (field: 'startsAfter' | 'dueAt' | 'hardDueAt'): number | undefined => {
        const raw = payload[field]
        if (raw === undefined) return found[field]
        if (raw === null || raw === '') return undefined
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw
        return found[field]
      }
      // 挂卡同理：没传沿用，空是摘掉，非空字符串是换链。
      const nextTaskId = payload.taskId === undefined
        ? found.taskId
        : (payload.taskId === null || payload.taskId === '' ? undefined : (typeof payload.taskId === 'string' ? payload.taskId : found.taskId))
      // The step list is read once, against the row it will live in, so the ids
      // it mints are the row's own deterministic ones.
      const steps = payload.steps === undefined ? undefined : readItemStepList(payload.steps, found.id)
      // The patch is a SPREAD, so an explicit undefined clears a promise and an
      // absent key leaves it alone — and the shared writer stamps `updatedAt`
      // ONLY when the patch really changed something, which is what keeps a
      // no-op from burning a revision on every device.
      const rows = applyItemPatch(items.items, found.id, {
        title: payload.title as string | undefined,
        body: payload.body as string | undefined,
        notes: payload.notes as string | undefined,
        status: payload.status as ItemRecord['status'] | undefined,
        priority: payload.priority as ItemRecord['priority'] | undefined,
        tags: payload.tags === undefined ? found.tags : itemTagsOf(payload.tags),
        startsAfter: nextInstant('startsAfter'),
        dueAt: nextInstant('dueAt'),
        hardDueAt: nextInstant('hardDueAt'),
        taskId: nextTaskId,
        ...steps === undefined ? {} : { steps: steps.steps },
      }, now)
      if (rows === items.items) return { doc, items, item: found, unchanged: true }
      const next = rows.find(item => item.id === found.id) ?? found
      const note = steps === undefined ? undefined : mintedNote(steps.minted)
      return note === undefined
        ? { doc, items: withItemRows(items, rows), item: next }
        : { doc, items: withItemRows(items, rows), item: next, note }
    }
    case 'item.delete': {
      const found = findItem()
      if (found === undefined) return `清单里没有 #${String(payload.of).replace('#', '')}。`
      // The list half only. The tombstone that makes this recoverable is the
      // merge grammar's, and the receipt says 「已生效」 either way — which is
      // true, because a tombstoned delete IS the deletion this document means.
      const rows = removeItemRecord(items.items, found.id)
      return { doc, items: withItemRows(items, rows), item: found }
    }
    case 'item.step': {
      const found = findItem()
      if (found === undefined) return `清单里没有 #${String(payload.of).replace('#', '')}。`
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
      if (found === undefined) return `清单里没有 #${String(payload.of).replace('#', '')}。`
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
      // The column is `createTask`'s own default ('todo'), not a decision here.
      const task = createTask({ ...plan.task, status: 'todo' }, now, deps.uuid())
      // The link is a field write on the checklist row, so it goes through the
      // same shared writer as every other one — which is also what keeps this op
      // from appending a SECOND copy of the row instead of editing the one that
      // is already there.
      const rows = applyItemPatch(items.items, found.id, { taskId: task.id }, now)
      return {
        doc: { ...doc, tasks: [...doc.tasks, task] },
        items: withItemRows(items, rows),
        task,
        item: rows.find(item => item.id === found.id) ?? found,
      }
    }
    case 'item.purge': {
      // ADDRESSED BY ITS SHORT NUMBER, the same name `item.restore` takes: it is
      // the one a person and a model say out loud, and the uuid is never spoken.
      // So the row is found among the deletions first, exactly as the restore
      // finds it — and a number that is in neither list is answered out loud
      // rather than by guessing which of the two situations it is.
      const wanted = String(payload.of).replace('#', '').trim()
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
      const wanted = String(payload.of).replace('#', '').trim()
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
  const sessions = relatedSessionIdsOf(task).map(fact => fact.sessionId)
  if (sessions.length === 0) return 'idle'
  const seen = sessions.map(id => sessionRunningOf(sources, id).value)
  if (seen.some(value => value === true)) return 'running'
  if (seen.some(value => value === 'unknown')) return 'unknown'
  return 'idle'
}

/**
 * The board's live state keyed by card id — the shape every checklist derivation
 * that needs 进行中 asks for.
 *
 * The panel builds the same map from the controller's own `liveStateOf`, and the
 * two are the same map: one derivation, read from whichever side is asking. A
 * card this host cannot see is `false` rather than absent, and absent is what
 * would make a running row read as 待办.
 *
 * @param sources - the live host faces.
 * @param tasks - the cards to read, which is the whole board ledger.
 * @returns card id → whether that card is running right now.
 */
function runningMapOf(sources: SessionPostureSources, tasks: readonly TaskRecord[]): Map<string, boolean> {
  const running = new Map<string, boolean>()
  for (const task of tasks) running.set(task.id, livenessOf(sources, task) === 'running')
  return running
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
  for (const [label, at] of [['最早开始', row.startsAfter], ['截止', row.dueAt], ['硬期限', row.hardDueAt]] as const) {
    if (at !== undefined) lines.push(`  ${label}：${at}（${localDayOf(at)}）`)
  }
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
  const envelope = Object.fromEntries(
    Object.entries(EXECUTE_ENVELOPE_PARAMS).map(([name, spec]) => [name, { type: 'boolean', description: spec.about }]),
  )

  const capabilities: ToolDefinition = {
    name: 'taskboard_capabilities',
    description: CAPABILITIES_DESCRIPTION,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: {
          verbs: { type: 'array', items: { type: 'string' } },
          reachable: { type: 'array', items: { type: 'string' } },
          humanOnly: { type: 'array', items: { type: 'string' } },
          actions: { type: 'array', items: { type: 'object' } },
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
          const params = Object.entries(action.params)
            .map(([name, spec]) => `    ${name}${spec.required ? '（必填）' : ''}${spec.requiredWhen === undefined ? '' : `（${spec.requiredWhen} 时必填）`}：${spec.about}`)
            .join('\n')
          return `${action.id} —— ${action.summary}\n  危险级 ${action.danger}；经 ${action.lane} 写入\n${params}`
        })
        return text([
          `你能用 ${view.reachable.length} 个动作，动词只有这些：${view.verbs.join(' / ')}`,
          `只有人能做（别试）：${view.humanOnly.join('、') || '（无）'}`,
          '',
          ...lines,
        ])
      },
    },
    execute: async () => capabilityView(),
  }

  const query: ToolDefinition = {
    name: 'taskboard_query',
    description: QUERY_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        // **THE VALUES GO IN TOO, AND THAT HALF WAS MISSING AS WELL.** The description
        // named `has:` but never said `has:auto` was one of its values — so the model
        // knew the key existed and still had to guess what goes after the colon,
        // which is the same silence as not knowing the key at all. Both halves now
        // come from the registries, so neither can go stale on its own.
        filter: {
          type: 'string',
          description: `${filterHelp().syntax}。可用的筛选：${filterHelp().keys.join(' ')}。可用的取值：${filterHelp().values.join(' ')}`,
        },
        detail: {
          type: 'string',
          enum: ['brief', 'full'],
          // The description is the whole contract for this parameter, so it states
          // what each value RETURNS rather than gesturing at "more". It used to
          // say 「full 连正文一起回」 while no branch anywhere read it.
          description: 'brief 只回编号、标题与状态；full 连正文、备注、步骤、标签、进度与三个日期一起回。full 的体积大得多，请配合 limit 用——清单条目的状态是「派生」的：挂在正在跑的卡上的行读作 inProgress（存的那一档在 storedStatus 里）。',
        },
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
          tasks?: (TaskRow & Partial<TaskDetail>)[]
          items?: (ItemRow & Partial<ItemDetail>)[]
        }
        if (result.ok === false) return text([(result as { detail?: string }).detail ?? '这次查询没有读到数据。'])
        const tasks = result.tasks ?? []
        const items = result.items ?? []
        return text([
          `卡片 ${tasks.length} 条，清单条目 ${items.length} 条${result.filter === undefined || result.filter === '' ? '' : `（筛选：${result.filter}）`}。${result.truncated === true ? '（已达 limit 的上限，还有更多。）' : ''}`,
          ...tasks.map(row => `卡片：${row.title}（${row.status}）\n${taskBodyOf(row)}`),
          ...items.map(row => `${row.ref} ${row.title}（${row.status}）\n${itemBodyOf(row)}`),
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
        const head = result.dryRun ? '演练：一个字节都没有落盘。' : '已落盘。'
        const touched = [
          ...(result.changed?.items ?? []).map(row => `${row.ref} ${row.title}`),
          ...(result.changed?.tasks ?? []).map(row => `卡片「${row.title}」`),
        ]
        return text([
          head,
          result.summary,
          ...(touched.length > 0 ? [`受影响的：${touched.join('、')}`] : []),
          ...(result.enginePending.length > 0 ? [`已受理但引擎不在线：${result.enginePending.join('、')}`] : []),
          ...result.reports.filter(report => !report.ok).map(report => `未生效：${report.op} —— ${report.detail}`),
        ])
      },
      presentationMeta: (_args, value) => presentationOf(value as unknown as ExecuteResult),
    },
    execute: async (args, exec) => runBatch(deps, (args ?? {}) as ExecuteRequest, exec),
  }

  return [capabilities, query, execute]
}

/** The read tool's body: rows carry their short number, the truncation happens
 *  here so the model never receives a whole board in one context. */
async function runQuery(deps: ToolDeps, args: unknown, exec?: ToolRunContext): Promise<unknown> {
  if (exec?.signal.aborted === true) return { ok: false, detail: '这次调用已经被取消，没有读到数据。' }
  const board = deps.board()
  if (board === undefined || !board.available) {
    return { ok: false, detail: '看板存储不可用，这次查询没有读到任何数据。' }
  }
  const request = (args ?? {}) as { filter?: string; detail?: string; limit?: number; posture?: string }
  const limit = Math.min(100, Math.max(1, request.limit ?? 20))
  /* `detail` USED TO BE A LIE, and it was the worst kind of lie this tool can
     tell: the parameter was declared, described in prose as 「full 连正文一起回」,
     destructured here — and then never read by a single branch below. Every row
     came back with its title and its status whatever the caller asked for, so a
     model that asked for the contents of a note and was handed a title had no
     way to tell that it had been given the wrong answer; it just believed it.

     So it is read here, and it decides the PROJECTION, not the wording: `full`
     is the whole written row and `brief` is the name. Both are the model's
     choice, and `limit` is still the only knob that bounds the size — which is
     why the parameter's own text tells the caller to bring it down with `full`. */
  const full = request.detail === 'full'
  const doc = board.getDoc()
  const items = board.getItemsDoc()
  const filter = (request.filter ?? '').trim()
  const needle = filter.toLowerCase()
  const tasks = doc.tasks.filter(task => needle === '' || task.title.toLowerCase().includes(needle)).slice(0, limit)
  const rows = full ? tasks.map(taskDetailRow) : tasks.map(taskRow)
  // The checklist is matched by the SAME grammar the search box a person types
  // into uses, reached through the one door that leads to it. This used to be a
  // second haystack assembled here, and two search boxes that agree today and
  // disagree after the next change is exactly the defect nobody reports until
  // someone says a filter "does nothing". The context is built ONCE and the
  // same clock is handed to every row, so one answer cannot disagree with
  // itself about what "stale" or "overdue" means.
  //
  // The live state goes in with it, and that is not an optimisation: 进行中 is
  // DERIVED, so without it `status:inProgress` is a filter the interface offers
  // and this query cannot reproduce — the model would be told "nothing is
  // running" about a row that is. The map is read through the board's own
  // derivation (`livenessOf` → `sessionRunningOf`), the same one the card's border
  // and breathing read, and a session this host cannot see is NOT counted as
  // running: `unknown` is a real answer, never a guess in the other direction.
  const itemCtx = itemSearchContext(deps.now(), undefined, runningMapOf(deps.sources, doc.tasks))
  const running = itemCtx.running
  const matchedItems = items.items
    .filter(item => matchItemQuery(item, filter, itemCtx))
    .slice(0, limit)
  // The SAME map the filter was judged with is handed to the projection, so the
  // rows a filter returned and the status printed on them come from one read of
  // the board's live state. A row that matched `status:inProgress` because a card
  // is running cannot come back labelled `open`, which is the whole point.
  const itemRows = full
    ? matchedItems.map(item => itemDetailRow(item, running))
    : matchedItems.map(item => itemRow(item, running))
  // Truncation is reported for BOTH lists, not just the cards: the number the
  // caller is given is "how many rows came back", and the two lists are capped
  // by the same `limit`, so a full board of cards could otherwise hide an
  // unbounded list of notes behind a `truncated: false`.
  const truncated = tasks.length >= limit || matchedItems.length >= limit
  if (request.posture !== undefined && request.posture !== '') {
    // Posture is a fact about a SESSION, and a card is not a session — so the
    // caller names the session, rather than this tool guessing which of a
    // card's bindings it meant.
    return {
      ok: true,
      filter,
      detail: full ? 'full' : 'brief',
      tasks: rows,
      items: itemRows,
      truncated,
      posture: await deps.posture(request.posture),
    }
  }
  return { ok: true, filter, detail: full ? 'full' : 'brief', tasks: rows, items: itemRows, truncated }
}
