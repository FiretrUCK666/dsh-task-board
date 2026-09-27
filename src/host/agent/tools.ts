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
import { QUALIFIER_KEYS, completeBoardQuery } from '../../core/task-search.ts'
import { clampCruiseLimit, type BoardCommit, type BoardDoc, type BoardView, type CruiseValue } from '../../core/board-doc.ts'
import { applyItemsCommit, type ItemsCommit, type ItemsDoc } from '../../core/items-doc.ts'
import { createTask, taskBindsOf, type TaskBind, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
import type { SessionRule } from '../../core/automation.ts'
import { nextRunAtMs, isValidCron } from '../../core/schedule.ts'
import type { SchedulePreset } from '../../core/presets.ts'
import type { RunConfigPresetConfig, RunPresetsDocument } from '../../core/run-presets.ts'

/** Read a run-config patch, keeping only the keys the preset model actually
 *  has. An unknown key is dropped rather than stored: the section's grammar
 *  would drop it too, so a silent loss here would be a lie about what landed. */
function readRunConfig(raw: unknown): RunConfigPresetConfig {
  if (typeof raw !== 'object' || raw === null) return {}
  const source = raw as Record<string, unknown>
  const config: RunConfigPresetConfig = {}
  for (const key of ['workspaceId', 'provider', 'model', 'reasoningEffort', 'agentPreset', 'permission'] as const) {
    const value = source[key]
    if (typeof value === 'string' && value !== '') config[key] = value
  }
  return config
}
import { armSchedule, moveTaskToStatus, removeSessionFromTask, type TransitionResult } from '../../core/task-transitions.ts'
import type { ItemRecord, ItemStep } from '../../core/item.ts'
import type { SessionPosture, SessionPostureSources } from '../session-state.ts'
import { sessionRunningOf } from '../session-state.ts'
import { relatedSessionIdsOf, type TaskLiveState } from '../../core/task-live.ts'

/* ── the host faces this tool reads ────────────────────────────────────────
 * Structural and late-bound: the same discipline as session-state.ts. Nothing
 * here imports an SDK runtime, so the whole tool surface is testable with
 * plain objects and the plugin keeps an empty `dependencies`. */

export interface ToolCommitFace {
  getDoc(): BoardDoc
  getItemsDoc(): ItemsDoc
  commit(commit: BoardCommit): Promise<BoardDoc>
  commitItems(commit: ItemsCommit): Promise<ItemsDoc>
  /** Relay one run to whichever replica holds the seat. `queued` = no engine. */
  submitCommand(command: { type: 'run'; taskId: string; trigger: 'manual' | 'schedule' | 'chain'; clientId: string }): { queued: boolean }
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

interface ToolParameterSchema { readonly [key: string]: unknown }

/** The tool registration shape (structural — no SDK import). */
export interface ToolDefinitionLike {
  readonly name: string
  readonly description: string
  readonly parameters: ToolParameterSchema
  readonly output: {
    readonly schema: ToolParameterSchema
    render(args: unknown, value: unknown): { type: 'text'; text: string }[]
    /** The tool's own vocabulary, persisted verbatim for the card to narrow —
     *  the host's contract, and the same words the model reads. */
    presentationMeta?(args: unknown, value: unknown): Record<string, unknown>
  }
  execute(args: unknown, exec?: { signal?: AbortSignal }): Promise<unknown>
}

/** One canonical-JSON result, rendered as the text the model reads. */
function jsonResult(value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
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

/** The filter syntax, in the words the registry uses. */
export function filterHelp(): { keys: readonly string[]; values: readonly string[]; syntax: string } {
  return {
    keys: QUALIFIER_KEYS,
    values: enumeratedFilters(),
    syntax: '空格分隔；`key:value` 是筛选，其余是字面搜索；未识别的 key 当普通文字处理，不会报错',
  }
}

/* ── receipts the model can read back ────────────────────────────────────── */

interface TaskRow { readonly title: string; readonly status: string }
interface ItemRow { readonly ref: string; readonly id: string; readonly title: string; readonly status: string }

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

/** An item's number is the document-minted one (`#12`), never its uuid. */
function itemRow(item: ItemRecord): ItemRow {
  return { ref: `#${item.ref}`, id: item.id, title: item.title, status: item.status }
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

/** The batch in the tool's OWN vocabulary, for the tool card to narrow. Not an
 *  envelope: it is the same words the model reads, so the person and the model
 *  cannot be told two different stories about the same batch. */
function presentationOf(result: ExecuteResult): Record<string, unknown> {
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
    reports: result.reports,
  }
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
  /** What happened, or what to change. Never a bare error code. */
  readonly detail: string
}

/** Why an op cannot run, in the words the catalog itself uses. */
export function refuseOp(id: string): { ok: false; detail: string } {
  const spec = ACTIONS[id as ActionId]
  if (spec === undefined) {
    return { ok: false, detail: `没有 ${id} 这个动作。可用动作见 taskboard_capabilities，动词只有这十二个：${BOARD_VERBS.join(' / ')}` }
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
}

/**
 * Run a batch. Order, stop-at-first-failure, no rollback, report every op —
 * and `dry_run` rehearses the SAME code path against a clone, so a rehearsal
 * that disagrees with the real thing cannot happen.
 */
export async function runBatch(deps: ToolDeps, request: ExecuteRequest): Promise<ExecuteResult> {
  const now = deps.now()
  const board = deps.board()
  const reports: OpReport[] = []
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
    if (spec.lane === 'engine') {
      // WHICH CARRIER carries an engine action is CATALOG state (`spec.relay`),
      // never a comparison of the action's name: the engine holds the
      // carriers, the catalog says which action rides which, and a relay that
      // decides by string is one rename away from forwarding something as a
      // run when it is not. An engine action with no `relay` is a statement
      // ("perform this some other way"), not a gap.
      if ((spec as { relay?: 'run' }).relay !== 'run') {
        raw.push({ op: step.op, ok: false, detail: `「${id}」不走「跑一次这张卡」这条通道，目录也没给它派发一种，所以这里明确拒绝——转发它会跑错东西。` })
        failed = true
        continue
      }
      // Engine ops are requests, not writes: say which, and whether a seat is
      // holding. A relayed run that nobody executes yet is accepted, not done.
      const target = String(payload.of ?? '')
      const found = doc.tasks.find(task => task.id === target || task.title === target)
      if (found === undefined) {
        raw.push({
          op: step.op,
          ok: false,
          detail: `卡 ${target} 不存在。看板上现在有：${doc.tasks.slice(0, 20).map(taskRow).map(row => row.title).join('，') || '（一张卡都没有）'}`,
        })
        failed = true
        continue
      }
      if (request.dry_run === true) {
        raw.push({ op: step.op, ok: true, title: found.title, detail: '会经引擎执行一次。' })
        continue
      }
      const { queued } = board.submitCommand({ type: 'run', taskId: found.id, trigger: 'manual', clientId: 'model' })
      raw.push({
        op: step.op,
        ok: true,
        title: found.title,
        detail: queued ? '已受理，引擎当前不在线，将在引擎上线后执行。' : '已交给引擎。',
      })
      continue
    }

    // Document lane: build the next document through the merge grammar, the
    // same lane every device writes through.
    const next = applyOne(doc, items, id, payload, deps, now)
    if (typeof next === 'string') {
      raw.push({ op: step.op, ok: false, detail: next })
      failed = true
      continue
    }
    const { doc: nextDoc, items: nextItems, task, item } = next
    if (request.dry_run !== true) {
      if (nextDoc !== doc) doc = await board.commit(boardCommitOf(doc, nextDoc))
      if (nextItems !== items) items = await board.commitItems(itemsCommitOf(items, nextItems))
    } else {
      doc = nextDoc
      items = nextItems
    }
    if (task !== undefined && next.unchanged !== true) changedTasks.push(task)
    if (item !== undefined) changedItems.push(item)
    raw.push({
      op: step.op,
      ok: true,
      ...(task === undefined ? {} : { title: task.title }),
      ...(item === undefined ? {} : { ref: `#${item.ref}`, title: item.title }),
      // A transition that moved nothing is a real answer, not a silent one.
      detail: `${next.unchanged === true ? '这一条已经是这样了，没有改动。' : '已生效。'}${next.note ?? ''}`,
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
  return {
    dryRun: request.dry_run === true,
    ok,
    reports,
    summary,
    boardRevision: doc.revision,
    itemsRevision: items.revision,
    counts,
    enginePending,
    ...(request.dry_run === true ? {} : { changed: { tasks: changedTasks.map(taskRow), items: changedItems.map(itemRow) } }),
  }
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
): { doc: BoardDoc; items: ItemsDoc; task?: TaskRecord; item?: ItemRecord; unchanged?: true; note?: string; relay?: true } | string {
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
    case 'task.run': {
      // The ONE action the catalog marks `relay: 'run'`. Whether a card can
      // be found is the relay's business, not this function's.
      //
      // The other engine actions deliberately have NO case here: the catalog
      // marks them `lane: 'engine'` with no `relay`, and the batch runner
      // refuses them off that field. A third copy of the same refusal — one
      // per action — is what made the coverage gate read a refusal as a
      // working execution path. The model learns WHY from the catalog summary
      // before it acts, which is a better place than a wall it hits later.
      last = findTask()
      if (last === undefined) return `卡 ${String(payload.of)} 不存在。`
      return { doc, items, relay: true, task: last }
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
      const next = edited({ ...found, title: patch.title ?? found.title, description: patch.description ?? found.description, prompt: patch.prompt ?? found.prompt })
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
      // The row arrives with no number at all: the document mints it, which is
      // the only thing that may hand one out.
      const made = createItemFrom(payload, deps, now)
      const merged = applyItemsCommit(items, { clientId: 'model', items: [...items.items, made.item], deleted: [] }, now)
      const stored = merged.items.find(item => item.id === made.item.id) ?? made.item
      return { doc, items: merged, item: stored, note: mintedNote(made.mintedSteps) }
    }
    case 'item.update': {
      const found = findItem()
      if (found === undefined) return `清单里没有 #${String(payload.of).replace('#', '')}。`
      const patch = payload as Partial<ItemRecord>
      const steps = payload.steps === undefined ? undefined : readSteps(payload.steps, deps)
      const next: ItemRecord = {
        ...found,
        title: patch.title ?? found.title,
        body: patch.body ?? found.body,
        notes: patch.notes ?? found.notes,
        ...(steps === undefined ? {} : { steps: steps.steps }),
        updatedAt: now,
      }
      const note = steps === undefined ? undefined : mintedNote(steps.minted)
      return note === undefined
        ? { doc, items: { ...items, items: items.items.map(item => (item.id === found.id ? next : item)) }, item: next }
        : { doc, items: { ...items, items: items.items.map(item => (item.id === found.id ? next : item)) }, item: next, note }
    }
    case 'item.delete': {
      const found = findItem()
      if (found === undefined) return `清单里没有 #${String(payload.of).replace('#', '')}。`
      return { doc, items: { ...items, items: items.items.filter(item => item.id !== found.id) }, item: found }
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
 * Read a step list the way the document stores one: `{ id, text, done }`.
 *
 * A step without an `id` is DROPPED SILENTLY by the row grammar — so a model
 * that writes three steps and gets one back would never know two of them
 * vanished. Each missing id is therefore minted here, in order, and the fact
 * is reported back: a repaired row is fine, a silently shortened one is not.
 */
function readSteps(raw: unknown, deps: ToolDeps): { steps: ItemStep[]; minted: number } {
  if (raw === undefined || raw === null) return { steps: [], minted: 0 }
  if (!Array.isArray(raw)) return { steps: [], minted: 0 }
  const steps: ItemStep[] = []
  let minted = 0
  for (const entry of raw) {
    if (typeof entry === 'string') {
      steps.push({ id: deps.uuid(), text: entry, done: false })
      minted += 1
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    const step = entry as { id?: unknown; text?: unknown; done?: unknown }
    if (typeof step.text !== 'string' || step.text.trim() === '') continue
    if (typeof step.id === 'string' && step.id !== '') {
      steps.push({ id: step.id, text: step.text, done: step.done === true })
      continue
    }
    steps.push({ id: deps.uuid(), text: step.text, done: step.done === true })
    minted += 1
  }
  return { steps, minted }
}

/** The sentence a caller shows when steps had to be given ids. */
function mintedNote(minted: number): string | undefined {
  return minted === 0 ? undefined : `（${minted} 个步骤没有 id，已按顺序铸号，没有丢）`
}

function createItemFrom(payload: Record<string, unknown>, deps: ToolDeps, now: number): { item: ItemRecord; mintedSteps: number } {
  const { steps, minted } = readSteps(payload.steps, deps)
  return {
    mintedSteps: minted,
    item: {
    id: deps.uuid(),
    ref: 0,
    title: String(payload.title ?? ''),
    body: String(payload.body ?? ''),
    notes: String(payload.notes ?? ''),
    steps,
    status: (payload.status as ItemRecord['status']) ?? 'open',
    priority: (payload.priority as ItemRecord['priority']) ?? 'normal',
    tags: [],
    startsAfter: undefined,
    dueAt: undefined,
    hardDueAt: undefined,
    taskId: undefined,
    origin: { source: 'ai', at: now },
    createdAt: now,
    updatedAt: now,
    },
  }
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
export function createTaskboardTools(deps: ToolDeps): readonly ToolDefinitionLike[] {
  const opEnum = [...TOOL_ACTION_IDS]
  const envelope = Object.fromEntries(
    Object.entries(EXECUTE_ENVELOPE_PARAMS).map(([name, spec]) => [name, { type: 'boolean', description: spec.about }]),
  )

  const capabilities: ToolDefinitionLike = {
    name: 'taskboard_capabilities',
    description: CAPABILITIES_DESCRIPTION,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => jsonResult(value),
    },
    execute: async () => capabilityView(),
  }

  const query: ToolDefinitionLike = {
    name: 'taskboard_query',
    description: QUERY_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: `${filterHelp().syntax}。可用的筛选：${filterHelp().keys.join(' ')}` },
        detail: { type: 'string', enum: ['brief', 'full'], description: 'brief 只回标题与状态；full 连正文一起回' },
        limit: { type: 'number', description: '最多回多少行（默认 20，上限 100）。AI 侧查询在服务端就截断，不会把整份清单塞进上下文。' },
        posture: { type: 'string', description: '给一个会话 id，连它的在跑/归档/等批准/等回答态势一起回。态势是会话的事实，卡片不是会话，所以要会话 id。' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_args, value) => jsonResult(value) },
    execute: async (args) => runQuery(deps, args),
  }

  const execute: ToolDefinitionLike = {
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
      schema: { type: 'object' },
      render: (_args, value) => jsonResult(value),
      presentationMeta: (_args, value) => presentationOf(value as ExecuteResult),
    },
    execute: async (args) => runBatch(deps, (args ?? {}) as ExecuteRequest),
  }

  return [capabilities, query, execute]
}

/** The read tool's body: rows carry their short number, the truncation happens
 *  here so the model never receives a whole board in one context. */
async function runQuery(deps: ToolDeps, args: unknown): Promise<unknown> {
  const board = deps.board()
  if (board === undefined || !board.available) {
    return { ok: false, detail: '看板存储不可用，这次查询没有读到任何数据。' }
  }
  const request = (args ?? {}) as { filter?: string; detail?: string; limit?: number; posture?: string }
  const limit = Math.min(100, Math.max(1, request.limit ?? 20))
  const doc = board.getDoc()
  const items = board.getItemsDoc()
  const filter = (request.filter ?? '').trim()
  const needle = filter.toLowerCase()
  const tasks = doc.tasks.filter(task => needle === '' || task.title.toLowerCase().includes(needle)).slice(0, limit)
  const rows = tasks.map(taskRow)
  if (request.posture !== undefined && request.posture !== '') {
    // Posture is a fact about a SESSION, and a card is not a session — so the
    // caller names the session, rather than this tool guessing which of a
    // card's bindings it meant.
    return {
      ok: true,
      filter,
      tasks: rows,
      items: items.items.slice(0, limit).map(itemRow),
      posture: await deps.posture(request.posture),
    }
  }
  return { ok: true, filter, tasks: rows, items: items.items.slice(0, limit).map(itemRow), truncated: tasks.length >= limit }
}
