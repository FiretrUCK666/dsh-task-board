/**
 * Task board domain model: task lifecycle statuses, the task record shape,
 * and the pure transition functions the controller and tests share.
 * Framework-free (no cordis, no runtime imports) so the state machine is
 * unit-testable in isolation.
 */

/** Task lifecycle status, one per kanban column. */
export type TaskStatus = 'backlog' | 'todo' | 'running' | 'review' | 'done'

/**
 * One execution round: a full run attempt (or a comment continuation that
 * kept an existing session going). The run's own id, the dsh session that
 * carried it (filled once known), and the settled outcome once the session's
 * turn ended. A round with `comment` set is a comment continuation: it never
 * appears in the execution-history list (comments live in the review page's
 * comment thread), but it is a first-class round for settlement, persistence
 * and the running-state machine.
 */
export interface ExecutionRecord {
  /** Execution attempt id (uuid). */
  id: string
  /** The dsh session that ran this attempt; absent until creation resolves. */
  sessionId: string | undefined
  /** When the run started (ms epoch). */
  startedAt: number
  /** When the run settled; absent while still running. */
  endedAt: number | undefined
  /** Outcome once settled. */
  result: 'succeeded' | 'failed' | 'cancelled' | undefined
  /** Human failure text when the run failed (prompt rejection or agent error). */
  error: string | undefined
  /** The comment text when this round is a comment continuation (absent = a plain run). */
  comment?: string
  /**
   * When the user last opened this execution's review page (ms epoch),
   * clearing its unread reminder. Absent on legacy rows — the display layer
   * falls back to the run's own latest activity, so old content never lights
   * up as unread after an upgrade.
   */
  viewedAt?: number
  /**
   * Whether this comment round is a slash command rather than a turn: the
   * line is executed through the native command registry (never delivered
   * to the model as text). Unknown commands fall back to plain text.
   */
  command?: boolean
  /**
   * When a comment continuation was actually injected into its session (ms
   * epoch). Absent = the comment is still saved/queued and can be cancelled;
   * present = the session is (or was) running it and the round can only be
   * observed.
   */
  injectedAt?: number
  /**
   * The plain execution this comment round continues (the record whose
   * review page the comment was submitted from; its session is reused).
   * Present on rounds created after this field existed; older persisted
   * rounds omit it and are attributed by session instead. Comment rounds
   * only ever carry it — plain runs never do.
   */
  parentExecutionId?: string
  /**
   * The linked session this comment round continues (submitted from a
   * linked-session panel's drive-mode composer; `sessionId` points at the
   * same session). The session-anchored counterpart of
   * `parentExecutionId`: a round anchored this way has no parent execution
   * — it keeps the linked session's conversation alive and drives the task
   * exactly like any other comment round (same per-task FIFO queue, same
   * dispatcher injection). Only comment rounds carry it, and a round never
   * carries both anchors.
   */
  sessionAnchor?: string
  /**
   * A direct-send round: a message the user sent straight to the native
   * session (直发模式) — recorded so it appears in the session's comment
   * thread next to drive comments and execution comments, but never queued,
   * injected or driven (it is already delivered: `endedAt` and `result` are
   * set at creation, there is no `injectedAt`). Purely a thread record —
   * task state, dispatcher and queues ignore it.
   */
  direct?: boolean
  /**
   * A requirement-refinement round: one turn in the task's bound refine
   * session (see `TaskRecord.refineSessionId`) that researches and fleshes
   * out the task's prompt. Distinct from plain runs and comment rounds: it
   * never appears in the execution history or the comment thread, and its
   * settlement never moves the task out of its column.
   */
  refine?: boolean
  /**
   * An externally-observed round: the task's related session had real
   * activity OUTSIDE the board (a user chatted directly in the native UI,
   * or the agent did something the board did not record) — detected from the
   * session list's running flip. Unlike comment/direct rounds it is
   * populated by observation, not submission: it drives the card into 「进行中」
   * and settles to 「待审核」 like a real round, appears in the session's
   * comment thread (its text is filled at settle when history yields it),
   * but is NEVER queued or injected (it is already running out-of-band), and
   * a refine-external round keeps the task in its column while `refining`.
   */
  external?: boolean
}

/** How a scheduled task is driven: cron = fire at fixed times; chain = rerun right after each run settles. */
export type ScheduleMode = 'cron' | 'chain'

/** Brand an unknown string as a schedule mode. */
export function isScheduleMode(value: unknown): value is ScheduleMode {
  return value === 'cron' || value === 'chain'
}

/**
 * A scheduled-run rule attached to a task. Two modes share one rule:
 * - `cron`: the browser-side scheduler ticks every minute and triggers the
 *   task when `nextRunAt` is due (a 5-field cron expression).
 * - `chain`: the task reruns as soon as its previous run settles — "run
 *   after completion". `cron`/`nextRunAt` are unused; the rule fires the
 *   first run on enable and every settled run starts the next, until
 *   `maxRuns` is reached (undefined = unlimited, i.e. continuously running)
 *   or a run fails.
 * The rule is persisted with the task (localStorage), so scheduling
 * survives refreshes.
 */
export interface ScheduleRule {
  /** Whether the schedule is armed. */
  enabled: boolean
  /** Driving mode; defaults to 'cron' (legacy rules normalize to it). */
  mode: ScheduleMode
  /** 5-field cron expression: `分 时 日 月 周` (cron mode). */
  cron: string
  /** Next due instant (ms epoch); maintained by the scheduler/controller (cron mode). */
  nextRunAt: number | undefined
  /** Instant of the latest scheduled trigger (ms epoch). */
  lastTriggeredAt: number | undefined
  /** How many scheduled runs may fire in total; undefined = unlimited. */
  maxRuns: number | undefined
  /** How many scheduled runs have fired so far (monotone; automatic triggers only). */
  runCount: number
  /**
   * Legacy activation gate: automation now fires as soon as it is armed —
   * there is no "manual run first" step (see {@link ruleReadiness}). Kept on
   * the persisted shape so old data parses; every load/merge normalizes it
   * to true, so no live code ever sees it as false.
   */
  primed: boolean
}

/** One task on the board. */
export interface TaskRecord {
  /** Stable task id (uuid). */
  id: string
  /** Short display title. */
  title: string
  /** Longer human description shown in the detail view. */
  description: string
  /** The prompt sent to dsh when this task is executed. */
  prompt: string
  /** Current column. */
  status: TaskStatus
  /** Column sort key (ascending; legacy rows are normalized on load). */
  order: number
  /** Creation instant (ms epoch). */
  createdAt: number
  /** Last mutation instant (ms epoch). */
  updatedAt: number
  /** Every execution attempt, most recent last. */
  executions: ExecutionRecord[]
  /** Optional scheduled-run rule (absent on tasks without a schedule). */
  schedule?: ScheduleRule
  /** Per-task run configuration (absent fields fall back to defaults). */
  workspaceId?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  /** Agent preset to compose the execution session from (absent = deployment default). */
  agentPreset?: string
  /** Permission preset key applied to the execution session before its first prompt (absent = session default). */
  permission?: string
  /** The task's bound requirement-refinement session (created lazily on the
   * first refine round and reused for every later round — the whole
   * refinement conversation lives in one session). The task's run
   * configuration applies to it, so nothing needs configuring.
   */
  refineSessionId?: string
  /**
   * A live binding to a native source — either a single session or a whole
   * workspace folder (dragged in from the sidebar). The bind decides the
   * source of the card's "链接会话" (linked sessions) section — a pure,
   * live-synced view of the bound workspace's sessions / the bound session —
   * and nothing else: the card keeps its own title, description, prompt,
   * run config, scheduling, executions and refinement exactly as a plain
   * task. Absent = a plain prompt-driven task (the pre-bind behavior).
   */
  bind?: { kind: 'session'; sessionId: string } | { kind: 'workspace'; workspaceId: string }
  /**
   * Display-only row hiding sets — rows the user chose not to see, neither
   * deleted nor archived (hiding keeps task numbering stable). `executions`
   * holds execution-record ids, `sessions` holds linked-session ids. The
   * "同步 / 恢复全部已隐藏" actions clear the relevant set.
   */
  hidden?: { executions?: string[]; sessions?: string[] }
  /**
   * When the user last opened this task's detail (ms epoch), clearing the
   * card's unread reminder. Absent on legacy rows — the display layer falls
   * back to the task's newest round activity, so already-seen content stays
   * quiet after an upgrade. New tasks start viewed at their creation.
   */
  viewedAt?: number
}

/** Input for creating a task. */
export interface NewTaskInput {
  title: string
  description: string
  prompt: string
  /** Landing column; defaults to 'todo'. Any column is legal — an external
   *  sidebar drop lands in exactly the column it was dropped into. */
  status?: TaskStatus
  workspaceId?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  agentPreset?: string
  permission?: string
}

/** The five kanban columns, in display order. */
export const COLUMNS: readonly { status: TaskStatus; label: string }[] = [
  { status: 'backlog', label: '待规划' },
  { status: 'todo', label: '待办' },
  { status: 'running', label: '进行中' },
  { status: 'review', label: '待审核' },
  { status: 'done', label: '已完成' },
]

/** Statuses a user may move a card to manually (execution states are owned by the runner). */
export const MANUAL_STATUSES: readonly TaskStatus[] = ['backlog', 'todo', 'done']

/** All valid statuses (closed union guard). */
export const ALL_STATUSES: readonly TaskStatus[] = [
  'backlog', 'todo', 'running', 'review', 'done',
]

/** Brand an unknown string as a status; undefined when it is not one. */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (ALL_STATUSES as readonly string[]).includes(value)
}

/**
 * The landing column of a task created by an external sidebar drop: the
 * column the item was dropped into — all five columns are respected, so a
 * drop on 进行中 / 待审核 / 已完成 stays exactly where it landed.
 */
export function landingStatusOf(dropStatus: TaskStatus): TaskStatus {
  return dropStatus
}

/**
 * How an armed schedule rule behaves for a task right now. One shared
 * judgment used by the scheduler (what may trigger), the controller (what
 * a chain may own) and the detail panel (what to display):
 * - `disabled`: the rule is not armed — nothing to consider.
 * - `paused`: armed, but the task sits in a state the rule must not drive
 *   (backlog = shelved, review = a human decision is pending, done =
 *   completed). Any manual action that leaves these states (run, or move to
 *   todo/done) resumes the rule; missed due instants are skipped, never
 *   caught up. Completion additionally disarms the rule outright (see
 *   {@link disarmSchedule}) — `paused` here is the safety net for legacy/
 *   repaired rows that would otherwise hold a stale enabled flag.
 * - `active`: armed and the task is in a drivable state (todo/running) —
 *   cron due instants and chain hand-offs fire. Arming alone is enough:
 *   automation is active as soon as it is enabled (no manual-first-run
 *   gate).
 */
export type RuleReadiness =
  | { kind: 'disabled' }
  | { kind: 'paused'; status: 'backlog' | 'review' | 'done' }
  | { kind: 'active' }

/** The readiness of a task's schedule rule (see {@link RuleReadiness}). */
export function ruleReadiness(task: TaskRecord): RuleReadiness {
  const schedule = task.schedule
  if (schedule === undefined || !schedule.enabled) return { kind: 'disabled' }
  // Every status outside the rule's active set (backlog/review/done) is a
  // pause: the rule must never drive a task a human is holding.
  if (task.status === 'backlog' || task.status === 'review' || task.status === 'done') {
    return { kind: 'paused', status: task.status }
  }
  return { kind: 'active' }
}

/**
 * Disarm a task's schedule rule for good — the completed-task shut-off. The
 * rule's identity (cron expression, mode, budget, prime, counters) is kept
 * so re-arming it later resumes from the same configured behavior; only
 * `enabled` and the pending `nextRunAt` are cleared. A no-op on tasks with
 * no rule or an already-disarmed one.
 */
export function disarmSchedule(task: TaskRecord, now: number): TaskRecord {
  const schedule = task.schedule
  if (schedule === undefined || !schedule.enabled) return task
  return withSchedule(task, { enabled: false, nextRunAt: undefined }, now)
}

/** Whether a manual move target is allowed from the given status. */
export function canMoveManually(_from: TaskStatus, to: TaskStatus): boolean {
  return (MANUAL_STATUSES as readonly TaskStatus[]).includes(to)
}

/** Create a task from user input. */
export function createTask(input: NewTaskInput, now: number, id: string, order = 0): TaskRecord {
  return {
    id,
    title: input.title.trim(),
    description: input.description.trim(),
    prompt: input.prompt.trim(),
    status: input.status ?? 'todo',
    order,
    createdAt: now,
    updatedAt: now,
    viewedAt: now,
    executions: [],
    ...input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {},
    ...input.provider !== undefined ? { provider: input.provider } : {},
    ...input.model !== undefined ? { model: input.model } : {},
    ...input.reasoningEffort !== undefined ? { reasoningEffort: input.reasoningEffort } : {},
    ...input.agentPreset !== undefined ? { agentPreset: input.agentPreset } : {},
    ...input.permission !== undefined ? { permission: input.permission } : {},
  }
}

/** Clone a task with an updated status and a fresh updatedAt. */
export function withStatus(task: TaskRecord, status: TaskStatus, now: number): TaskRecord {
  return { ...task, status, updatedAt: now }
}

/**
 * Merge a schedule patch into a task's schedule rule (creating it when
 * absent), with a fresh updatedAt. Keys present in the patch overwrite the
 * current value — including explicit `undefined`, which clears a field (used
 * to disarm `nextRunAt`); absent keys keep their current value.
 */
export function withSchedule(
  task: TaskRecord,
  patch: Partial<ScheduleRule>,
  now: number,
): TaskRecord {
  const current = task.schedule
  const schedule: ScheduleRule = {
    enabled: current?.enabled ?? false,
    mode: current?.mode ?? 'cron',
    cron: current?.cron ?? '',
    nextRunAt: current?.nextRunAt,
    lastTriggeredAt: current?.lastTriggeredAt,
    maxRuns: current?.maxRuns,
    runCount: current?.runCount ?? 0,
    // Legacy activation gate: automation is active as soon as it is armed
    // (nothing awaits a manual first run), so any merged rule reads primed —
    // old data normalizes the same way in the store.
    primed: true,
  }
  if ('enabled' in patch) schedule.enabled = patch.enabled ?? false
  if ('mode' in patch) schedule.mode = patch.mode ?? 'cron'
  if ('cron' in patch) schedule.cron = patch.cron ?? ''
  if ('nextRunAt' in patch) schedule.nextRunAt = patch.nextRunAt
  if ('lastTriggeredAt' in patch) schedule.lastTriggeredAt = patch.lastTriggeredAt
  if ('maxRuns' in patch) schedule.maxRuns = patch.maxRuns
  if ('runCount' in patch) schedule.runCount = patch.runCount ?? 0
  return { ...task, updatedAt: now, schedule }
}

/**
 * Open a fresh execution on a task: move it to 'running' and append a
 * running execution record. Returns the new task and the new execution.
 */
export function startExecution(
  task: TaskRecord,
  now: number,
  executionId: string,
): { task: TaskRecord; execution: ExecutionRecord } {
  const execution: ExecutionRecord = {
    id: executionId,
    sessionId: undefined,
    startedAt: now,
    endedAt: undefined,
    result: undefined,
    error: undefined,
    // The row starts viewed at its own start: while it runs nothing is new
    // (the user can see it running); its settlement (or a later comment)
    // then lights the unread dot until the review page is opened.
    viewedAt: now,
  }
  return {
    task: { ...task, status: 'running', updatedAt: now, executions: [...task.executions, execution] },
    execution,
  }
}

/** Paused-readiness explanation keyed by the pausing status. */

/**
 * Create an externally-observed round (see `ExecutionRecord.external`): the
 * board detected native-side activity on a related session (out-of-band
 * chat). It enters the session's comment thread and drives the task state
 * like a running round, but is never queued/injected — it is already
 * happening. `refine: true` marks a refinement-session round, which keeps
 * the task in its column.
 */
export function newExternalRound(options: { id: string; now: number; sessionId: string; refine?: boolean }): ExecutionRecord {
  return {
    id: options.id,
    sessionId: options.sessionId,
    startedAt: options.now,
    endedAt: undefined,
    result: undefined,
    error: undefined,
    comment: '',
    sessionAnchor: options.sessionId,
    external: true,
    ...(options.refine === true ? { refine: true } : {}),
  }
}

/**
 * Create a new comment-continuation round (pure): the single factory for
 * both comment anchors. An execution-anchored comment (`parentExecutionId`)
 * continues a settled run and reuses its session; a session-anchored
 * comment (`sessionAnchor`) continues a linked session and reuses that
 * session. Either way the round carries the session id it will be injected
 * into, so the dispatcher's eligibility scan and the injection hand-off work
 * unchanged — one queue, one model, two surfaces.
 */
export function newCommentRound(options: {
  id: string
  now: number
  /** The trimmed comment text. */
  text: string
  /** Whether the line is a slash command rather than a turn. */
  command?: boolean
  /** The session the comment will be injected into (reused, never created). */
  sessionId: string
  /** The settled execution this comment continues (execution-anchored). */
  parentExecutionId?: string
  /** The linked session this comment continues (session-anchored). */
  sessionAnchor?: string
}): ExecutionRecord {
  return {
    id: options.id,
    sessionId: options.sessionId,
    startedAt: options.now,
    endedAt: undefined,
    result: undefined,
    error: undefined,
    comment: options.text,
    ...(options.command === true ? { command: true } : {}),
    ...(options.parentExecutionId !== undefined ? { parentExecutionId: options.parentExecutionId } : {}),
    ...(options.sessionAnchor !== undefined ? { sessionAnchor: options.sessionAnchor } : {}),
  }
}

/**
 * Create a direct-send round (直发模式): the message was already delivered to
 * the native session, so the round is settled-succeeded at birth — it exists
 * to make the line visible in the session's comment thread (next to drive
 * comments and execution comments), never to queue or drive anything.
 */
export function newDirectRound(options: {
  id: string
  now: number
  /** The trimmed message text that was sent. */
  text: string
  /** The native session the message was sent to. */
  sessionId: string
}): ExecutionRecord {
  return {
    id: options.id,
    sessionId: options.sessionId,
    startedAt: options.now,
    endedAt: options.now,
    result: 'succeeded',
    error: undefined,
    comment: options.text,
    sessionAnchor: options.sessionId,
    direct: true,
  }
}

/**
 * Settle a running execution: record the outcome and move the task into the
 * matching column. No-op (returns the input task) when the execution is not
 * the task's latest or is already settled.
 *
 * A settled run always lands in 'review' — the human gate between execution
 * and completion: succeeded runs await human confirmation, failed runs await
 * a decision (comment to steer, rerun, or move on). The only exception is a
 * scheduled batch that keeps the card 'running' between runs: a succeeded
 * run belonging to an armed schedule whose next automatic run is already
 * committed stays 'running' — for a budgeted cron batch
 * (`runCount + 1 < maxRuns`, the counter is incremented by the scheduler
 * only after this settle) and for chain mode (unlimited, or a further
 * budgeted run remains). A cancelled run returns to 'todo'.
 */
export function settleExecution(
  task: TaskRecord,
  executionId: string,
  outcome: 'succeeded' | 'failed' | 'cancelled',
  now: number,
  error: string | undefined,
): TaskRecord {
  const index = task.executions.findIndex(execution => execution.id === executionId)
  if (index === -1) return task
  const execution = task.executions[index]
  if (execution.endedAt !== undefined) return task
  const settled: ExecutionRecord = { ...execution, endedAt: now, result: outcome, error }
  const executions = [...task.executions]
  executions[index] = settled
  const schedule = task.schedule
  const chainIncomplete = outcome === 'succeeded'
    && schedule !== undefined
    && schedule.enabled
    && schedule.mode === 'chain'
    && (schedule.maxRuns === undefined || schedule.runCount + 1 < schedule.maxRuns)
  const batchIncomplete = outcome === 'succeeded'
    && schedule !== undefined
    && schedule.enabled
    && schedule.mode === 'cron'
    && schedule.maxRuns !== undefined
    && schedule.runCount + 1 < schedule.maxRuns
  const status: TaskStatus = outcome === 'cancelled'
    ? task.status === 'running' ? 'todo' : task.status
    : chainIncomplete || batchIncomplete ? 'running'
      : 'review'
  return { ...task, status, updatedAt: now, executions }
}

/**
 * Whether the task is genuinely executing right now: its status is
 * 'running' AND its latest round has not settled. A pending comment round
 * (saved while the cruise is off, the task not running) is NOT an open run
 * — it must never show a spinner on the card, block a rerun, or block a
 * drag. An open requirement-refinement round IS an open run: the task's
 * session is working, so a plain run must not start on top of it. One
 * shared judgment for the card, the drop rules and the run guard.
 */
export function hasOpenRun(task: TaskRecord): boolean {
  if (task.executions.some(round => round.refine === true && round.endedAt === undefined)) return true
  if (task.status !== 'running') return false
  const latest = task.executions[task.executions.length - 1]
  return latest !== undefined && latest.endedAt === undefined
}

/**
 * How many comment rounds of a task are saved but not yet injected (the
 * task's comment queue). These wait for the dispatcher — the budget, the
 * cruise toggle, or the task's own busy round — and can be cancelled.
 */
export function pendingCommentCount(task: TaskRecord): number {
  let count = 0
  for (const round of task.executions) {
    // External rounds run out-of-band and are never queued — they must not
    // count toward the "saved comments waiting to inject" badge.
    if (round.comment !== undefined && round.injectedAt === undefined && round.endedAt === undefined && round.external !== true) count += 1
  }
  return count
}

/**
 * The task's plain runs in chronological order — every execution record
 * except comment and refine rounds. The single numbering source for the
 * execution history list (TaskDetail) and the review page header ("第 N 次
 * 执行"): continuations and refinements are not part of the run sequence.
 */
export function plainRunsOf(task: TaskRecord): readonly ExecutionRecord[] {
  return task.executions.filter(execution => execution.comment === undefined && execution.refine !== true)
}

/**
 * The task's requirement-refinement rounds in chronological order (the
 * conversation turns of the task's bound refine session).
 */
export function refineRoundsOf(task: TaskRecord): readonly ExecutionRecord[] {
  return task.executions.filter(round => round.refine === true)
}

/** Whether a requirement-refinement round is currently running for the task. */
export function refining(task: TaskRecord): boolean {
  return task.executions.some(round => round.refine === true && round.endedAt === undefined)
}

/** Bind (or re-bind) the task's requirement-refinement session. */
export function withRefineSession(task: TaskRecord, sessionId: string, now: number): TaskRecord {
  if (task.refineSessionId === sessionId) return task
  return { ...task, refineSessionId: sessionId, updatedAt: now }
}

/**
 * Settle a requirement-refinement round: record the outcome on the round
 * without moving the task out of its column (refinement is preparation, not
 * execution — the card stays exactly where it is). No-op when the round is
 * unknown or already settled.
 */
export function settleRefine(
  task: TaskRecord,
  executionId: string,
  outcome: 'succeeded' | 'failed' | 'cancelled',
  now: number,
  error: string | undefined,
): TaskRecord {
  const index = task.executions.findIndex(round => round.id === executionId)
  if (index === -1) return task
  const round = task.executions[index]
  if (round.endedAt !== undefined) return task
  const executions = [...task.executions]
  executions[index] = { ...round, endedAt: now, result: outcome, error }
  return { ...task, updatedAt: now, executions }
}

/** What a card drop onto a column means (drag-and-drop decision). */
export type CardDropDecision =
  | { kind: 'none' }
  | { kind: 'move'; status: TaskStatus }
  | { kind: 'run' }
  | { kind: 'reject'; reason: 'busy' }

/**
 * Decide what dropping a card onto a column does, reconciling the manual
 * move with the execution owner. Automation is never a drop obstacle: a
 * chain card is freely movable — "leaving the lane" is expressed as a
 * pause/stop in the controller's moveTask, never as a rejection here.
 * - Dropping on 'running' reruns the task (the same "run again" semantics
 *   as the detail button); a live run is a no-op/reject, shared with every
 *   other surface.
 * - While an execution is open, 'review'/'done' are refused: the runner
 *   owns those transitions and would overwrite a manual move when the run
 *   settles.
 * - Anything else is a plain manual move; dropping on the current column is
 *   a no-op (except 'running' via the rerun rule above).
 */
export function resolveCardDrop(task: TaskRecord, target: TaskStatus): CardDropDecision {
  const busy = hasOpenRun(task)
  if (target === 'running') {
    if (!busy) return { kind: 'run' }
    if (task.status === target) return { kind: 'none' }
    return { kind: 'reject', reason: 'busy' }
  }
  if (task.status === target) return { kind: 'none' }
  if (busy && (target === 'review' || target === 'done')) return { kind: 'reject', reason: 'busy' }
  return { kind: 'move', status: target }
}

/**
 * Move a card into a column at a given position, renumbering the target
 * column's sort keys. `beforeId` inserts before that card (undefined =
 * column tail); a same-column move removes the card first, so the insertion
 * index is naturally off-by-one safe. Only the target column's orders are
 * rewritten — other columns keep their relative order (gaps are harmless,
 * since sorting only compares within a column).
 */
export function applyCardOrder(
  tasks: readonly TaskRecord[],
  movedId: string,
  targetStatus: TaskStatus,
  beforeId: string | undefined,
  now: number,
): TaskRecord[] {
  const moved = tasks.find(task => task.id === movedId)
  if (moved === undefined) return [...tasks]
  // Moving a card before itself is a no-op (the card was already removed
  // from the target list, so it could never be found as an anchor).
  if (beforeId === movedId) return [...tasks]
  const others = tasks.filter(task => task.id !== movedId)
  const target = others.filter(task => task.status === targetStatus)
  const at = beforeId === undefined ? target.length : target.findIndex(task => task.id === beforeId)
  const position = at < 0 ? target.length : at
  const ordered = [...target.slice(0, position), moved, ...target.slice(position)]
  return tasks.map(task => {
    if (task.id === movedId) {
      return { ...task, status: targetStatus, order: ordered.findIndex(row => row.id === task.id), updatedAt: now }
    }
    if (task.status === targetStatus) {
      return { ...task, order: ordered.findIndex(row => row.id === task.id) }
    }
    return task
  })
}
