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
   * When a comment continuation was actually injected into its session (ms
   * epoch). Absent = the comment is still saved/queued and can be cancelled;
   * present = the session is (or was) running it and the round can only be
   * observed.
   */
  injectedAt?: number
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
   * Whether the rule has been activated by a manual run. Auto rules never
   * drive a task that has not been started by hand: arming the rule does
   * not run anything; the first manual run (Run button or dragging to
   * 'running') primes the rule, and only then do cron triggers and chain
   * hand-offs fire. Legacy rules normalize to false.
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
}

/** Input for creating a task. */
export interface NewTaskInput {
  title: string
  description: string
  prompt: string
  /** Landing column; defaults to 'todo'. */
  status?: 'backlog' | 'todo'
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

/** Statuses in which an armed + primed auto rule keeps driving the task. */
export const RULE_ACTIVE_STATUSES: readonly TaskStatus[] = ['todo', 'running']

/** All valid statuses (closed union guard). */
export const ALL_STATUSES: readonly TaskStatus[] = [
  'backlog', 'todo', 'running', 'review', 'done',
]

/** Brand an unknown string as a status; undefined when it is not one. */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (ALL_STATUSES as readonly string[]).includes(value)
}

/**
 * How an armed schedule rule behaves for a task right now. One shared
 * judgment used by the scheduler (what may trigger), the controller (what
 * a chain may own) and the detail panel (what to display):
 * - `disabled`: the rule is not armed — nothing to consider.
 * - `standby`: armed but never started by a manual run (`primed` false).
 *   The rule never triggers by itself and the user is told to start it by
 *   hand; its next-run instant is kept for the day it becomes active.
 * - `paused`: armed and started, but the task sits in a state the rule must
 *   not drive (backlog = shelved, review = a human decision is pending,
 *   done = completed). Any manual action that leaves these states (run, or
 *   move to todo/done) resumes the rule; missed due instants are skipped,
 *   never caught up. Completion additionally disarms the rule outright (see
 *   {@link disarmSchedule}) — `paused` here is the safety net for legacy/
 *   repaired rows that would otherwise hold a stale enabled flag.
 * - `active`: armed, started, and the task is in a drivable state
 *   (todo/running) — cron due instants and chain hand-offs fire.
 */
export type RuleReadiness =
  | { kind: 'disabled' }
  | { kind: 'standby' }
  | { kind: 'paused'; status: 'backlog' | 'review' | 'done' }
  | { kind: 'active' }

/** The readiness of a task's schedule rule (see {@link RuleReadiness}). */
export function ruleReadiness(task: TaskRecord): RuleReadiness {
  const schedule = task.schedule
  if (schedule === undefined || !schedule.enabled) return { kind: 'disabled' }
  if (schedule.primed !== true) return { kind: 'standby' }
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
    primed: current?.primed ?? false,
  }
  if ('enabled' in patch) schedule.enabled = patch.enabled ?? false
  if ('mode' in patch) schedule.mode = patch.mode ?? 'cron'
  if ('cron' in patch) schedule.cron = patch.cron ?? ''
  if ('nextRunAt' in patch) schedule.nextRunAt = patch.nextRunAt
  if ('lastTriggeredAt' in patch) schedule.lastTriggeredAt = patch.lastTriggeredAt
  if ('maxRuns' in patch) schedule.maxRuns = patch.maxRuns
  if ('runCount' in patch) schedule.runCount = patch.runCount ?? 0
  if ('primed' in patch) schedule.primed = patch.primed ?? false
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
  }
  return {
    task: { ...task, status: 'running', updatedAt: now, executions: [...task.executions, execution] },
    execution,
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

/** A settled-execution summary string for the detail view. */
export function executionLabel(execution: ExecutionRecord): string {
  if (execution.result === 'succeeded') return 'succeeded'
  if (execution.result === 'failed') return 'failed'
  if (execution.result === 'cancelled') return 'cancelled'
  return 'running'
}

/**
 * Whether the task is genuinely executing right now: its status is
 * 'running' AND its latest round has not settled. A pending comment round
 * (saved while the cruise is off, the task not running) is NOT an open run
 * — it must never show a spinner on the card, block a rerun, or block a
 * drag. One shared judgment for the card, the drop rules and the run guard.
 */
export function hasOpenRun(task: TaskRecord): boolean {
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
    if (round.comment !== undefined && round.injectedAt === undefined && round.endedAt === undefined) count += 1
  }
  return count
}

/** What a card drop onto a column means (drag-and-drop decision). */
export type CardDropDecision =
  | { kind: 'none' }
  | { kind: 'move'; status: TaskStatus }
  | { kind: 'run' }
  | { kind: 'reject'; reason: 'busy' | 'scheduled' }

/**
 * Decide what dropping a card onto a column does, reconciling the manual
 * move with the execution and schedule owners:
 * - A chain that actually owns the card — armed, primed by a manual run,
 *   and still 'running' (every settled run hands off to the next, so any
 *   other column would be overwritten) — is refused (`scheduled`). A chain
 *   in standby or paused (review/backlog/cancelled) owns nothing: the card
 *   can be moved freely, which is also how a paused chain resumes (move to
 *   todo/done or run again).
 * - Dropping on 'running' reruns the task (the same "run again" semantics
 *   as the detail button), unless its latest execution is still open — the
 *   run guard is shared with manual runs and the scheduler, so a live run
 *   can never be started twice from any surface.
 * - While an execution is open, 'review'/'done' are refused: the runner
 *   owns those transitions and would overwrite a manual move when the run
 *   settles.
 * - Anything else is a plain manual move; dropping on the current column is
 *   a no-op (except 'running', which still means "run" when free).
 */
export function resolveCardDrop(task: TaskRecord, target: TaskStatus): CardDropDecision {
  const busy = hasOpenRun(task)
  const chainOwns = task.schedule?.enabled === true
    && task.schedule.mode === 'chain'
    && task.schedule.primed === true
    && task.status === 'running'
  if (chainOwns) {
    if (target !== 'running') return { kind: 'reject', reason: 'scheduled' }
    return busy ? { kind: 'reject', reason: 'busy' } : { kind: 'run' }
  }
  if (target === 'running' && !busy) return { kind: 'run' }
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
