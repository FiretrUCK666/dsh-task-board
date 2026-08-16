/**
 * Board controller: the single owner of task-ledger state and view state.
 *
 * It keeps the ledger in memory, persists every mutation through the
 * {@link TaskStore}, drives real executions through the
 * {@link ExecutionService}, and closes the board view whenever the user
 * navigates to a session (the sessions-list `current` selection changes).
 * Framework-free (structural runtime faces) so the whole orchestration is
 * unit-testable with fakes.
 */
import { ExecutionService, type ExecutionEvent } from './execution.ts'
import { isValidCron, nextRunAtMs } from './schedule.ts'
import type { TaskStore } from './store.ts'
import { CruiseService } from './cruise.ts'
import {
  applyCardOrder, createTask, settleExecution, startExecution, withSchedule, withStatus,
  type ExecutionRecord, type NewTaskInput, type ScheduleMode, type TaskRecord, type TaskStatus,
} from './tasks.ts'

/** Default auto-cruise concurrency when the user has not configured one. */
export const DEFAULT_CRUISE_LIMIT = 5

/** The sessions face the controller needs for navigation awareness. */
export interface SessionsControllerFace {
  list: {
    getSnapshot(): {
      current: string | undefined
      /** Host session list rows; used to judge whether an execution session finished. */
      byId: Record<string, { running: boolean }>
    }
    subscribe(fn: () => void): () => void
  }
  /** Whether a session still exists in the host session list. */
  exists(id: string): boolean
  /** Select a session as current (navigates the conversation view). */
  open(id: string): void
}

/** One workspace row the new-task form can target. */
export interface WorkspaceRow {
  id: string
  title: string
}

/** One reasoning effort a model advertises. */
export interface EffortRow {
  id: string
  name?: string
}

/** One model row inside a provider group. */
export interface ModelRow {
  id: string
  name?: string
  efforts: readonly EffortRow[]
}

/** One provider group of the host model catalog. */
export interface ModelGroupRow {
  provider: string
  models: readonly ModelRow[]
}

/** One agent preset the new-task form can target. */
export interface AgentPresetRow {
  /** Preset id (also the directory name). */
  id: string
  /** Display name the preset published, absent when it published none. */
  name?: string
  /** One sentence on what the preset is for. */
  description?: string
  /** Whether a session that names no preset gets this one. */
  isDefault?: boolean
}

/** One permission preset the new-task form can target (the host's native preset table). */
export interface PermissionRow {
  /** Preset machine value (the key the `/permission` command accepts). */
  id: string
  /** Display name the preset published, absent when it published none. */
  name?: string
  /** One sentence on what the preset means. */
  description?: string
}

/** One slash-menu candidate for the prompt autocomplete (command or skill). */
export interface SlashCandidate {
  /** Name without the leading slash (the user types `/name`). */
  name: string
  /** Human-readable summary. */
  description: string
  /** Free-form input hint; commands with one take an argument (trailing space). */
  hint?: string
  /** Skill entries rank after commands and always insert with a trailing space. */
  kind: 'command' | 'skill'
}

/** Optional run-catalog face feeding the new-task form's run-configuration selects. */
export interface RunCatalogFace {
  listWorkspaces(): readonly WorkspaceRow[]
  listModelGroups(): Promise<readonly ModelGroupRow[]>
  /** Agent presets the deployment composes (absent = the host has no roster). */
  listAgentPresets(): Promise<readonly AgentPresetRow[]>
  /**
   * Permission presets the deployment advertises through its native
   * permission service; undefined = the capability is unavailable (no
   * permission service composed, or the catalog fetch failed) and the form
   * hides the permission selector.
   */
  listPermissions(): Promise<readonly PermissionRow[] | undefined>
  /**
   * Slash-menu candidates for the prompt autocomplete, straight from the
   * native sources the composer's '/' menu merges: host commands (the live
   * command registry) plus skills (the skill catalog, one entry per skill
   * name). undefined = no session to scope the catalog to; individual
   * sources degrade to empty when their fetch fails. Nothing is hard-coded,
   * so registry/catalog changes show up without a plugin update.
   */
  listSlashCandidates(): Promise<readonly SlashCandidate[] | undefined>
}

/** The editable slice of a task (content + run configuration). */
export type TaskUpdatePatch = Partial<Pick<TaskRecord,
  'title' | 'description' | 'prompt' | 'workspaceId' | 'provider' | 'model'
  | 'reasoningEffort' | 'agentPreset' | 'permission'
>>

/** The auto-cruise state: whether it picks up 'todo' tasks, and at what concurrency. */
export interface CruiseState {
  enabled: boolean
  limit: number
}

/** Persistence seam for the cruise state (localStorage in the browser). */
export interface CruiseStorageFace {
  read(): Partial<CruiseState> | undefined
  write(state: CruiseState): void
}

/** Raw session-history event (the structural slice the review page folds). */
export interface TranscriptEventShape {
  type: string
  seq?: number
  time?: number
  data?: unknown
}

/** Controller dependencies (all swappable in tests). */
export interface ControllerDeps {
  store: TaskStore
  exec: ExecutionService
  sessions: SessionsControllerFace
  /** Optional run-catalog surface (workspace/model pickers in the new-task form). */
  runCatalog?: RunCatalogFace
  /** Clock; defaults to Date.now. */
  now?: () => number
  /** Id minting; defaults to a random-uuid. */
  uuid?: () => string
  /** Debounce (ms) for session-list-changed reconciles; defaults to 350. */
  reconcileDebounceMs?: number
  /** Cruise-state persistence; absent = cruise defaults that are not persisted. */
  cruiseStorage?: CruiseStorageFace
  /** Reads a session's recent history events (review-page transcript); absent = the page shows a hint. */
  transcript?: (sessionId: string) => Promise<readonly TranscriptEventShape[] | undefined>
}

/** Immutable controller snapshot for UI subscriptions. */
export interface ControllerSnapshot {
  tasks: readonly TaskRecord[]
  boardOpen: boolean
  selectedTaskId: string | undefined
  /** Auto-cruise toggle + concurrency limit. */
  cruise: CruiseState
}

/** The selected task (resolved from the ledger), or undefined. */
export function selectedTaskOf(snapshot: ControllerSnapshot): TaskRecord | undefined {
  if (snapshot.selectedTaskId === undefined) return undefined
  return snapshot.tasks.find(task => task.id === snapshot.selectedTaskId)
}

/**
 * What initiated a run: 'manual' (Run button / dragging to 'running' — also
 * primes an enabled schedule rule), 'schedule' (cron trigger) or 'chain'
 * (run-after-completion hand-off).
 */
export type RunTrigger = 'manual' | 'schedule' | 'chain'

function randomUuid(): string {
  const bytes = globalThis.crypto?.getRandomValues(new Uint8Array(16))
  if (bytes === undefined) {
    // Non-secure fallback (tests, odd environments).
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Read the current selection off a session-list snapshot (structural). */
function currentOf(sessions: SessionsControllerFace): string | undefined {
  return sessions.list.getSnapshot().current
}

/**
 * Board controller (see module doc). All mutations bump the snapshot and
 * persist through the store; UI and DOM mounts subscribe and re-render.
 */
export class BoardController {
  private tasks: TaskRecord[] = []
  private boardOpen = false
  private selectedTaskId: string | undefined
  private listeners = new Set<() => void>()
  private disposers: Array<() => void> = []
  private readonly now: () => number
  private readonly uuid: () => string
  private cruiseState: CruiseState
  private readonly cruise: CruiseService

  /** @param deps - store, execution service, and the sessions navigation face. */
  constructor(private readonly deps: ControllerDeps) {
    this.now = deps.now ?? (() => Date.now())
    this.uuid = deps.uuid ?? randomUuid
    const stored = deps.cruiseStorage?.read()
    const storedLimit = stored !== undefined && typeof stored.limit === 'number'
      && Number.isInteger(stored.limit) && stored.limit >= 1
      ? stored.limit
      : DEFAULT_CRUISE_LIMIT
    this.cruiseState = { enabled: stored?.enabled === true, limit: storedLimit }
    this.cruise = new CruiseService({
      tasks: () => this.tasks,
      runTask: id => this.runTask(id, 'manual'),
      subscribe: fn => this.subscribe(fn),
      limit: () => this.cruiseState.limit,
    })
  }

  // --- lifecycle -------------------------------------------------------------

  /** Load the persisted ledger and start the navigation/status subscriptions. */
  start(): void {
    this.tasks = this.deps.store.load()
    void this.reconcileRunningTasks()
    this.disposers.push(this.deps.sessions.list.subscribe(() => {
      this.onSessionsChanged()
    }))
    this.cruise.start()
    if (this.cruiseState.enabled) {
      // Restore the queue after a reload: pick up todo tasks again and
      // inject comment continuations that were waiting for the cruise.
      this.cruise.setEnabled(true)
      this.injectPendingComments()
    }
    this.notify()
  }

  /** Stop all subscriptions and drop retained state (idempotent). */
  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
    this.cruise.dispose()
    this.listeners.clear()
    if (this.reconcileTimer !== undefined) clearTimeout(this.reconcileTimer)
    this.reconcileTimer = undefined
  }

  // --- snapshot / subscription ------------------------------------------------

  getSnapshot(): ControllerSnapshot {
    return {
      tasks: this.tasks,
      boardOpen: this.boardOpen,
      selectedTaskId: this.selectedTaskId,
      cruise: { ...this.cruiseState },
    }
  }

  /** The run-catalog face for form selects, or undefined when not wired. */
  runCatalog(): RunCatalogFace | undefined {
    return this.deps.runCatalog
  }

  /**
   * Read a session's recent history events for the review page's transcript
   * (the fold happens in the UI). undefined when no reader is wired.
   */
  loadTranscript(sessionId: string): Promise<readonly TranscriptEventShape[] | undefined> {
    return this.deps.transcript?.(sessionId) ?? Promise.resolve(undefined)
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  // --- view state -------------------------------------------------------------

  openBoard(): void {
    if (this.boardOpen) return
    // Baseline the selection the board opened against: the board stays open
    // until the user navigates (selection changes), never on mere status
    // updates of the already-selected session.
    this.lastCurrent = currentOf(this.deps.sessions)
    this.boardOpen = true
    this.notify()
  }

  closeBoard(): void {
    if (!this.boardOpen) return
    this.boardOpen = false
    this.notify()
  }

  toggleBoard(): void {
    if (this.boardOpen) this.closeBoard()
    else this.openBoard()
  }

  openTask(id: string): void {
    if (this.tasks.some(task => task.id === id)) {
      this.selectedTaskId = id
      this.notify()
    }
  }

  closeTask(): void {
    if (this.selectedTaskId === undefined) return
    this.selectedTaskId = undefined
    this.notify()
  }

  // --- task mutations ---------------------------------------------------------

  createTask(input: NewTaskInput): TaskRecord | undefined {
    const title = input.title.trim()
    if (title === '') return undefined
    const task = createTask(input, this.now(), this.uuid(), this.nextOrder())
    this.tasks = [...this.tasks, task]
    this.persistAndNotify()
    return task
  }

  /** Next column sort key: one past the largest order in the ledger. */
  private nextOrder(): number {
    let max = -1
    for (const task of this.tasks) {
      if (task.order > max) max = task.order
    }
    return max + 1
  }

  /**
   * Update a task's editable fields: content (title/description/prompt) and
   * run configuration. A run-config key present in the patch with an empty
   * string or `undefined` clears the field (the run then falls back to
   * defaults); a value sets it; absent keys keep their current value. Text
   * fields are trimmed; a blank title is rejected (returns false, state
   * untouched). The next execution — manual or scheduled — reads the updated
   * record, so edits apply from the following run onward.
   * @returns true when applied, false when rejected (blank title / unknown task).
   */
  updateTask(id: string, patch: TaskUpdatePatch): boolean {
    const task = this.tasks.find(candidate => candidate.id === id)
    if (task === undefined) return false
    const title = patch.title?.trim()
    if (title !== undefined && title === '') return false
    const applied: Partial<TaskRecord> = {}
    if (patch.title !== undefined) applied.title = title
    if (patch.description !== undefined) applied.description = patch.description.trim()
    if (patch.prompt !== undefined) applied.prompt = patch.prompt.trim()
    // Run-config fields: a present key with '' or undefined clears the field
    // (execution falls back to defaults); a value sets it.
    for (const key of ['workspaceId', 'provider', 'model', 'reasoningEffort', 'agentPreset', 'permission'] as const) {
      if (key in patch) {
        const value = patch[key]
        applied[key] = value === undefined || value === '' ? undefined : value
      }
    }
    this.tasks = this.tasks.map(candidate => candidate.id === id
      ? { ...candidate, ...applied, updatedAt: this.now() }
      : candidate)
    this.persistAndNotify()
    return true
  }

  /**
   * Move a card into a column, optionally at a specific position (before the
   * card with `beforeId`; undefined = column tail). The target column's sort
   * keys are renumbered; a same-column move is reorder-only.
   */
  moveTask(id: string, status: TaskStatus, beforeId?: string): void {
    this.tasks = applyCardOrder(this.tasks, id, status, beforeId, this.now())
    this.persistAndNotify()
  }

  deleteTask(id: string): void {
    this.tasks = this.tasks.filter(task => task.id !== id)
    if (this.selectedTaskId === id) this.selectedTaskId = undefined
    this.persistAndNotify()
  }

  // --- scheduling ---------------------------------------------------------------

  /**
   * Update a task's schedule rule. A blank or invalid cron expression is
   * rejected (returns false, state untouched) in cron mode. When the rule
   * ends up enabled the next run instant is computed immediately (cron); a
   * disabled rule carries no next-run instant. Arming a rule never executes
   * anything by itself: auto triggers only drive tasks a manual run has
   * primed (see `primed` on ScheduleRule).
   * @param id - the task to schedule.
   * @param patch - fields to change (absent fields keep their current value).
   *   `maxRuns` sets the total scheduled-run budget (undefined = unlimited);
   *   arming a schedule also resets its run counter when maxRuns changes.
   * @returns true when applied, false when rejected (invalid cron / unknown task).
   */
  setSchedule(id: string, patch: { enabled?: boolean; cron?: string; maxRuns?: number; mode?: ScheduleMode }): boolean {
    const task = this.tasks.find(candidate => candidate.id === id)
    if (task === undefined) return false
    const current = task.schedule
    const mode = patch.mode ?? current?.mode ?? 'cron'
    // The cron expression is only ever replaced by an explicit patch: chain
    // mode merely stops consuming it, it never clears the stored expression
    // (so switching back to cron keeps the last valid value).
    const cron = patch.cron !== undefined ? patch.cron.trim() : (current?.cron ?? '')
    if (mode === 'cron' && (cron === '' || !isValidCron(cron))) return false
    const maxRunsChanged = patch.maxRuns !== undefined && patch.maxRuns !== current?.maxRuns
    const maxRuns = patch.maxRuns !== undefined ? patch.maxRuns : current?.maxRuns
    const enabled = patch.enabled ?? current?.enabled ?? false
    const nextRunAt = enabled && mode === 'cron' ? nextRunAtMs(cron, this.now()) : undefined
    this.tasks = this.tasks.map(candidate =>
      candidate.id === id
        ? withSchedule(candidate, {
            enabled,
            mode,
            cron,
            nextRunAt,
            ...maxRunsChanged ? { maxRuns, runCount: 0 } : {},
          }, this.now())
        : candidate)
    this.persistAndNotify()
    return true
  }

  /** Whether the task's latest execution is still open. */
  private isBusy(id: string): boolean {
    const task = this.tasks.find(candidate => candidate.id === id)
    const latest = task?.executions[task.executions.length - 1]
    return latest !== undefined && latest.endedAt === undefined
  }

  /**
   * Continue an armed chain schedule after a settled run: persist the
   * incremented counter (disarming after the final budgeted run) and start
   * the next run. No-op unless the chain is armed AND primed by a manual
   * run, its latest execution has settled, and a further run is within
   * budget. Runs synchronously after a settle, so the scheduler's recovery
   * tick can never interleave a duplicate launch.
   */
  private maybeContinueChain(id: string): void {
    const task = this.tasks.find(candidate => candidate.id === id)
    const schedule = task?.schedule
    if (schedule === undefined || !schedule.enabled || !schedule.primed || schedule.mode !== 'chain') return
    const latest = task?.executions[task.executions.length - 1]
    // Only a succeeded run hands off; a failure stops the chain (the recovery
    // tick may still retry it like any scheduled run).
    if (latest === undefined || latest.endedAt === undefined || latest.result !== 'succeeded') return
    if (schedule.maxRuns !== undefined && schedule.runCount >= schedule.maxRuns) return
    const finalRun = schedule.maxRuns !== undefined && schedule.runCount + 1 >= schedule.maxRuns
    this.applyScheduleNextRun(id, undefined, this.now(), schedule.runCount + 1, finalRun)
    if (finalRun) return
    void this.runTask(id, 'chain')
  }

  /**
   * Roll a task's schedule forward (scheduler callback): persist the next due
   * instant, the trigger instant of this run, the incremented run counter,
   * and optionally disarm the schedule (after the final budgeted run).
   * No-op when the task has no schedule rule (it was deleted mid-tick, for
   * example).
   */
  applyScheduleNextRun(
    id: string,
    nextRunAt: number | undefined,
    lastTriggeredAt: number | undefined,
    runCount?: number,
    disable?: boolean,
  ): void {
    this.tasks = this.tasks.map(task =>
      task.id === id && task.schedule !== undefined
        ? withSchedule(task, {
            nextRunAt,
            lastTriggeredAt,
            ...runCount !== undefined ? { runCount } : {},
            ...disable === true ? { enabled: false } : {},
          }, this.now())
        : task)
    this.persistAndNotify()
  }

  /**
   * Jump to an execution's session transcript. Selecting the session changes
   * `current`, which closes the board (the conversation view takes over).
   * Refuses to navigate when the session no longer exists (deleted/archived):
   * navigating a stale id would silently land on a fresh-session screen.
   * @param sessionId - the execution session to open.
   * @returns true when the session exists and the navigation was requested.
   */
  openSession(sessionId: string): boolean {
    if (!this.deps.sessions.exists(sessionId)) {
      console.warn(`[dsh-task-board] execution session ${sessionId} no longer exists; refusing to navigate`)
      return false
    }
    this.deps.sessions.open(sessionId)
    return true
  }

  // --- execution ---------------------------------------------------------------

  /**
   * Execute a task for real: move it to 'running', open an execution record,
   * and hand off to the ExecutionService. A second call while the task's
   * latest run is still open is ignored — a settled execution frees the slot
   * even though the card may still read 'running' (a scheduled batch keeps
   * the card in progress between runs and lets the next tick fire the next
   * run).
   *
   * A manual run primes an enabled schedule rule: auto triggers (cron due
   * instants, chain hand-offs) only drive tasks a manual run has started,
   * so arming a rule never executes anything by itself.
   */
  async runTask(id: string, trigger: RunTrigger = 'manual'): Promise<boolean> {
    let task = this.tasks.find(candidate => candidate.id === id)
    if (task === undefined) return false
    if (trigger === 'manual' && task.schedule?.enabled === true && task.schedule.primed !== true) {
      const primed = withSchedule(task, { primed: true }, this.now())
      this.tasks = this.tasks.map(candidate => candidate.id === id ? primed : candidate)
      this.persistAndNotify()
      task = primed
    }
    const latest = task.executions[task.executions.length - 1]
    if (latest !== undefined && latest.endedAt === undefined) return false
    const { task: next, execution } = startExecution(task, this.now(), this.uuid())
    this.tasks = this.tasks.map(candidate => candidate.id === id ? next : candidate)
    this.persistAndNotify()
    // This page owns the settlement of its own launches: the live watch
    // (ExecutionService.run) settles on the turn boundary, and list
    // reconciliation must not pre-empt it with a session that has not
    // started a turn yet (its list row is idle, not completed).
    this.activeExecutionIds.add(execution.id)
    await this.deps.exec.run(next, execution, (event) => { this.handleExecutionEvent(event) })
    return true
  }

  /** Re-run a settled task: move it back to 'todo' first, then execute. */
  async rerunTask(id: string): Promise<void> {
    const task = this.tasks.find(candidate => candidate.id === id)
    if (task === undefined) return
    if (task.status !== 'running') {
      this.tasks = this.tasks.map(candidate => candidate.id === id ? withStatus(candidate, 'todo', this.now()) : candidate)
      this.persistAndNotify()
    }
    await this.runTask(id, 'manual')
  }

  // --- comments ---------------------------------------------------------------

  /**
   * Save a comment continuation against a settled execution: a new comment
   * round is appended (same session, not yet injected) and the task stays in
   * place — the comment is injected when the auto-cruise is on (see
   * {@link continueComment}), so the user's instruction takes effect exactly
   * when the cruise drives the board. Only one open comment round per task
   * is allowed at a time.
   * @param taskId - the task owning the execution.
   * @param executionId - the settled execution to continue (its session is reused).
   * @param text - the comment to send to the session's agent.
   * @returns the pending comment round, or undefined when rejected (unknown
   *   task/execution, execution not settled, another comment already in flight).
   */
  submitComment(taskId: string, executionId: string, text: string): ExecutionRecord | undefined {
    const trimmed = text.trim()
    if (trimmed === '') return undefined
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return undefined
    const execution = task.executions.find(candidate => candidate.id === executionId)
    if (execution === undefined || execution.sessionId === undefined || execution.endedAt === undefined) return undefined
    if (task.executions.some(candidate => candidate.comment !== undefined && candidate.endedAt === undefined)) return undefined
    const round: ExecutionRecord = {
      id: this.uuid(),
      sessionId: execution.sessionId,
      startedAt: this.now(),
      endedAt: undefined,
      result: undefined,
      error: undefined,
      comment: trimmed,
    }
    this.tasks = this.tasks.map(candidate => candidate.id === taskId
      ? { ...candidate, updatedAt: this.now(), executions: [...candidate.executions, round] }
      : candidate)
    this.persistAndNotify()
    if (this.cruiseState.enabled) void this.continueComment(round.id)
    return round
  }

  /**
   * Inject a pending comment round: the task moves to 'running' and the text
   * is sent to the execution session through the execution service; the
   * settled outcome flows through the normal event path (landing in
   * 'review' like any settled run).
   * @param executionId - the pending comment round's id.
   * @returns true when the injection was accepted.
   */
  async continueComment(executionId: string): Promise<boolean> {
    const task = this.tasks.find(candidate =>
      candidate.executions.some(execution => execution.id === executionId))
    if (task === undefined) return false
    const round = task.executions.find(candidate => candidate.id === executionId)
    if (round === undefined || round.comment === undefined || round.sessionId === undefined) return false
    if (round.endedAt !== undefined || task.status !== 'review') return false
    const running = withStatus(task, 'running', this.now())
    this.tasks = this.tasks.map(candidate => candidate.id === task.id ? running : candidate)
    this.persistAndNotify()
    this.activeExecutionIds.add(round.id)
    await this.deps.exec.commentRun(running, round, round.sessionId, round.comment, (event) => {
      this.handleExecutionEvent(event)
    })
    return true
  }

  /** Inject every pending comment round (called when the cruise turns on). */
  private injectPendingComments(): void {
    for (const task of this.tasks) {
      if (task.status !== 'review') continue
      const pending = task.executions.find(candidate =>
        candidate.comment !== undefined && candidate.sessionId !== undefined && candidate.endedAt === undefined)
      if (pending !== undefined) void this.continueComment(pending.id)
    }
  }

  // --- auto-cruise --------------------------------------------------------------

  /** Turn the auto-cruise on or off (persisted; on also injects pending comments). */
  setCruiseEnabled(on: boolean): void {
    if (this.cruiseState.enabled === on) return
    this.cruiseState = { ...this.cruiseState, enabled: on }
    this.deps.cruiseStorage?.write(this.cruiseState)
    this.cruise.setEnabled(on)
    if (on) this.injectPendingComments()
    this.notify()
  }

  /** Change the cruise concurrency limit (persisted; the queue re-pumps). */
  setCruiseLimit(limit: number): void {
    const clamped = Math.max(1, Math.floor(limit))
    if (this.cruiseState.limit === clamped) return
    this.cruiseState = { ...this.cruiseState, limit: clamped }
    this.deps.cruiseStorage?.write(this.cruiseState)
    this.cruise.kick()
    this.notify()
  }

  private handleExecutionEvent(event: ExecutionEvent): void {
    if (event.kind === 'started') {
      this.tasks = this.tasks.map(task => task.id === event.taskId
        ? attachSessionId(task, event.executionId, event.sessionId, this.now())
        : task)
      this.persistAndNotify()
      return
    }
    this.activeExecutionIds.delete(event.executionId)
    this.tasks = this.tasks.map(task => task.id === event.taskId
      ? settleExecution(task, event.executionId, event.outcome, this.now(), event.error)
      : task)
    this.persistAndNotify()
    // A settled run hands off to the next chained run synchronously, so the
    // scheduler's recovery tick can never interleave a duplicate launch.
    this.maybeContinueChain(event.taskId)
  }

  // --- internals ---------------------------------------------------------------

  /** Reconcile running tasks and close the board when the user navigates. */
  private onSessionsChanged(): void {
    // Background/leftover executions settle through the session list (their
    // conversation snapshots stay cold until opened). Coalesce the burst of
    // list notifications into one reconcile pass instead of fanning out a
    // history read per notification; see scheduleReconcile.
    this.scheduleReconcile()
    if (!this.boardOpen) return
    const current = currentOf(this.deps.sessions)
    if (current !== this.lastCurrent) this.closeBoard()
    this.lastCurrent = current
  }

  private lastCurrent: string | undefined = undefined

  /** Execution ids launched on this page; they settle via their live watch, never list reconciliation. */
  private readonly activeExecutionIds = new Set<string>()

  /** Debounce timer for {@link reconcileRunningTasks}. */
  private reconcileTimer: ReturnType<typeof setTimeout> | undefined = undefined

  /** Whether a reconcile pass is underway (single-flight guard). */
  private reconcileInFlight = false

  /**
   * A session-list change arrived but no pass ran yet (debounce pending or a
   * pass in flight). Accumulated instead of dropped so the final
   * running→finished flip of an execution session is never lost.
   */
  private reconcilePending = false

  /**
   * Debounce + single-flight trigger for the running-task reconciliation.
   * Session-list notifications arrive in bursts (one per session status
   * change); both guards together keep a burst from reading the history API
   * once per running task. Notifications that arrive while a pass is queued
   * or running are accumulated ({@link reconcilePending}) and re-checked
   * after the pass, so none is silently dropped.
   */
  private scheduleReconcile(): void {
    this.reconcilePending = true
    if (this.reconcileTimer !== undefined || this.reconcileInFlight) return
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = undefined
      void this.reconcileRunningTasks()
    }, this.deps.reconcileDebounceMs ?? 350)
  }

  /** How old an execution must be before list reconciliation may settle it. */
  private static readonly ACTIVE_RECONCILE_GRACE_MS = 10_000

  /** Settle tasks left 'running' whose sessions already finished. */
  private async reconcileRunningTasks(): Promise<void> {
    if (this.reconcileInFlight) return
    this.reconcileInFlight = true
    this.reconcilePending = false
    try {
      type Settled = Extract<ExecutionEvent, { kind: 'settled' }>
      const events: Array<{ task: TaskRecord; event: Settled }> = []
      for (const task of this.tasks) {
        if (task.status !== 'running') continue
        const execution = task.executions[task.executions.length - 1]
        // Runs launched on this page settle through their live watch (turn
        // boundary / host-list flip); reconciliation exists for
        // background/leftover runs. The watch can still be defeated when the
        // execution session stays cold and its list signal is missed, so as
        // a fallback an active run whose session the host reports finished
        // AND that has lived well past the queue window is handed to
        // reconcile (which requires real turn evidence) and released.
        if (execution !== undefined && this.activeExecutionIds.has(execution.id)) {
          const sessionId = execution.sessionId
          if (sessionId === undefined) continue // still connecting; never judge
          const list = this.deps.sessions.list.getSnapshot()
          const summary = list.byId[sessionId]
          const finished = summary !== undefined && !summary.running
          const pastGrace = this.now() - execution.startedAt > BoardController.ACTIVE_RECONCILE_GRACE_MS
          if (!(finished && pastGrace)) continue
        }
        const event = await this.deps.exec.reconcile(task)
        if (event !== undefined && event.kind === 'settled') {
          events.push({ task, event })
          this.activeExecutionIds.delete(event.executionId)
        }
      }
      if (events.length === 0) return
      let changed = false
      const continued: string[] = []
      for (const { task, event } of events) {
        const next = settleExecution(task, event.executionId, event.outcome, this.now(), event.error)
        if (next === task) continue
        this.tasks = this.tasks.map(candidate => candidate.id === task.id ? next : candidate)
        changed = true
        continued.push(task.id)
      }
      if (changed) this.persistAndNotify()
      // A reconciled settle hands off to the next chained run like a live one.
      for (const id of continued) this.maybeContinueChain(id)
    } finally {
      this.reconcileInFlight = false
      // A list change that arrived while this pass was queued or in flight
      // must not be lost: run another pass.
      if (this.reconcilePending) {
        this.reconcilePending = false
        this.scheduleReconcile()
      }
    }
  }

  private persistAndNotify(): void {
    this.deps.store.save(this.tasks)
    this.notify()
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
  }
}

/** Record which session ran an execution (once the execution service reports it). */
function attachSessionId(
  task: TaskRecord,
  executionId: string,
  sessionId: string,
  now: number,
): TaskRecord {
  return {
    ...task,
    updatedAt: now,
    executions: task.executions.map(execution =>
      execution.id === executionId ? { ...execution, sessionId } : execution),
  }
}
