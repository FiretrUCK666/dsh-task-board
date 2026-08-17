/**
 * Board controller: the single owner of task-ledger state and view state.
 *
 * It keeps the ledger in memory, persists every mutation through the
 * {@link TaskStore}, drives real executions through the
 * {@link ExecutionService}, and closes the board view whenever the user
 * navigates to a session (the sessions-list `current` selection changes).
 * Every launch — manual runs, cron/schedule triggers, chain hand-offs, the
 * auto-cruise and comment continuations — flows through one concurrency
 * bounded dispatcher ({@link BoardController.dispatch}), so the user-set
 * limit is a hard cap on simultaneously running sessions and no surface can
 * ever bypass it. Framework-free (structural runtime faces) so the whole
 * orchestration is unit-testable with fakes.
 */
import { ExecutionService, type ExecutionEvent } from './execution.ts'
import { isValidCron, nextRunAtMs } from './schedule.ts'
import { buildRefinePrompt } from './refine.ts'
import type { TaskStore } from './store.ts'
import {
  applyCardOrder, createTask, disarmSchedule, hasOpenRun, ruleReadiness, settleExecution, settleRefine, startExecution, withRefineSession, withSchedule, withStatus,
  type ExecutionRecord, type NewTaskInput, type ScheduleMode, type TaskRecord, type TaskStatus,
} from './tasks.ts'

/** Default auto-cruise concurrency when the user has not configured one. */
export const DEFAULT_CRUISE_LIMIT = 5

/** The native session-list "waiting for the user" signal (sidebar amber dot). */
export type PendingInteractionKind = 'approval' | 'plan-review' | 'question'

/** The sessions face the controller needs for navigation awareness. */
export interface SessionsControllerFace {
  list: {
    getSnapshot(): {
      current: string | undefined
      /** Host session list rows; used to judge whether an execution session finished. */
      byId: Record<string, {
        running: boolean
        /** User interaction the session is blocked on (approval / plan review / question). */
        pendingInteraction?: PendingInteractionKind
        /** The session's real workspace root, when the host recorded one. */
        cwd?: string
        /** The agent preset the session's agent was composed from, when known. */
        agentPreset?: string
      }>
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

/**
 * The native context-pressure projection (see dsh-token-meter): provider
 * sample, its projection forward over surface movement, and the route
 * capacity. Narrowed structurally; absent keys mean the value is not known
 * yet (capability absence is key absence).
 */
export interface ContextPressureShape {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
}

/** The native context-composition projection: heuristic system/tools/messages split. */
export interface ContextBreakdownShape {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}

/** One permission-preset option the session's select can switch to (native PermissionSelect). */
export interface PermissionOptionShape {
  value: string
  name: string
  description?: string
}

/** The session's real permission select (native `permissions` projection): the
 *  effective current value plus the switchable options — the authority the
 *  review page's permission switcher must read (the task card's permission
 *  field only configures the next fresh run). */
export interface PermissionSelectShape {
  options: readonly PermissionOptionShape[]
  currentValue: string
}

/** The projection slice the review page reads (the history tail page's block). */
export interface TranscriptProjectionsShape {
  contextPressure?: ContextPressureShape
  contextBreakdown?: ContextBreakdownShape
  permissions?: PermissionSelectShape
}

/** The review-page transcript: raw events plus the session's projection baseline. */
export interface TranscriptLoadResult {
  events: readonly TranscriptEventShape[]
  /** Native projection values riding the history tail page; absent when the deployment has no registry. */
  projections?: TranscriptProjectionsShape
}

/** The live model selection of one execution session (native `sessions.models`). */
export interface SessionModelChoice {
  provider: string
  model: string
  reasoningEffort?: string
}

/** One selectable reasoning effort of a model route. */
export interface SessionEffortRow {
  id: string
  name?: string
}

/** One selectable model route (with its reasoning efforts). */
export interface SessionModelRow {
  id: string
  name?: string
  reasoning?: { efforts: readonly SessionEffortRow[]; defaultEffort?: string }
}

/** One provider group of the session's model directory. */
export interface SessionModelGroup {
  provider: string
  models: readonly SessionModelRow[]
}

/** What the review page's session-config panel needs from the runtime. */
export interface SessionConfigFace {
  /** The session's current selection + selectable directory (native models API). */
  readModels(sessionId: string): Promise<{
    current: SessionModelChoice
    groups: readonly SessionModelGroup[]
  } | undefined>
  /** Apply a new model selection to the session (native selectModel API). */
  selectModel(
    sessionId: string,
    selection: SessionModelChoice,
  ): Promise<{ ok: true } | { ok: false; error: string }>
  /** Apply a permission preset through the native `/permission` command. */
  setPermission(sessionId: string, permission: string): Promise<{ ok: true } | { ok: false; error: string }>
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
  transcript?: (sessionId: string) => Promise<TranscriptLoadResult | undefined>
  /** Session-config surface (review-page model/permission panel); absent = the panel degrades gracefully. */
  sessionConfig?: SessionConfigFace
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
  }

  // --- lifecycle -------------------------------------------------------------

  /** Load the persisted ledger and start the navigation/status subscriptions. */
  start(): void {
    this.tasks = this.deps.store.load()
    void this.reconcileRunningTasks()
    this.disposers.push(this.deps.sessions.list.subscribe(() => {
      this.onSessionsChanged()
    }))
    // Restore the dispatch queue after a reload: with the cruise on, pick up
    // todo tasks again and inject comment continuations that were waiting
    // (each launch re-validates eligibility, so nothing stale can fire).
    if (this.cruiseState.enabled) this.dispatch()
    this.notify()
  }

  /** Stop all subscriptions and drop retained state (idempotent). */
  dispose(): void {
    this.disposed = true
    for (const dispose of this.disposers.splice(0)) dispose()
    this.queuedLaunches.length = 0
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
   * (the fold happens in the UI), together with the native projection
   * baseline (context pressure / breakdown) riding the history tail page.
   * undefined when no reader is wired.
   */
  loadTranscript(sessionId: string): Promise<TranscriptLoadResult | undefined> {
    return this.deps.transcript?.(sessionId) ?? Promise.resolve(undefined)
  }

  /** The session-config face (review page's model/permission panel), or undefined. */
  sessionConfig(): SessionConfigFace | undefined {
    return this.deps.sessionConfig
  }

  /**
   * The user interaction an execution session is currently blocked on
   * (`approval` / `plan-review` / `question`), straight from the native
   * session-list summary (the same signal as the sidebar's amber dot).
   * undefined = the session is not waiting (or no longer listed).
   */
  pendingInteractionOf(sessionId: string | undefined): PendingInteractionKind | undefined {
    if (sessionId === undefined) return undefined
    return this.deps.sessions.list.getSnapshot().byId[sessionId]?.pendingInteraction
  }

  /** The session's real workspace root + composed agent preset (native list summary). */
  sessionInfo(sessionId: string | undefined): { cwd?: string; agentPreset?: string } | undefined {
    if (sessionId === undefined) return undefined
    const summary = this.deps.sessions.list.getSnapshot().byId[sessionId]
    if (summary === undefined) return undefined
    return {
      ...summary.cwd !== undefined ? { cwd: summary.cwd } : {},
      ...summary.agentPreset !== undefined ? { agentPreset: summary.agentPreset } : {},
    }
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
   *
   * Moving a card to 'done' is the completion hand-off: any armed schedule
   * rule is disarmed outright ({@link disarmSchedule}) — a completed task's
   * timer/chain must never fire again, and moving it back to a live column
   * leaves the rule off until the user re-arms it.
   */
  moveTask(id: string, status: TaskStatus, beforeId?: string): void {
    this.tasks = applyCardOrder(this.tasks, id, status, beforeId, this.now())
    if (status === 'done') {
      // Disarm any armed rule: completion is a hard stop, not a pause. The
      // rule's configuration survives, so re-arming from the detail editor
      // resumes the same schedule.
      this.tasks = this.tasks.map(task =>
        task.id === id ? disarmSchedule(task, this.now()) : task)
    }
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

  // --- unified execution dispatcher ------------------------------------------

  /**
   * Auto launches waiting for a free slot. Only schedule/chain triggers ever
   * queue here: a manual run is an explicit user action that always starts
   * immediately (it still occupies a slot, so auto launches wait for the
   * budget it consumes).
   */
  private queuedLaunches: Array<{ taskId: string; trigger: 'schedule' | 'chain' }> = []

  /** How many rounds are genuinely open right now (the concurrency truth). */
  private inFlightCount(): number {
    let count = 0
    for (const task of this.tasks) {
      if (hasOpenRun(task)) count += 1
    }
    return count
  }

  /** Reentrancy guard for {@link dispatch} (launches notify → re-dispatch). */
  private dispatching = false
  private dispatchQueued = false
  private disposed = false

  /**
   * The one concurrency-bounded launch decision point. Called after every
   * ledger mutation (through {@link persistAndNotify}) and the cruise
   * switches: while the in-flight budget has room, it starts work in
   * priority order — queued schedule/chain launches first, then comment
   * continuations (a human instruction beats a fresh run), then cruise
   * pickups of todo tasks. Every candidate is re-validated at launch time,
   * so stale work (a task moved to done, deleted, or busy in between) is
   * dropped instead of launched; reentrant notifications are folded into
   * the current pass, never nested.
   */
  private dispatch(): void {
    if (this.disposed) return
    if (this.dispatching) {
      this.dispatchQueued = true
      return
    }
    this.dispatching = true
    this.dispatchQueued = false
    try {
      // 1. Queued schedule/chain launches (they were accepted while the
      // budget was full; their eligibility is re-checked on drain).
      while (this.inFlightCount() < this.cruiseState.limit) {
        if (!this.drainQueuedLaunch()) break
      }
      // 2+3. Comment continuations then cruise pickups fill remaining slots.
      while (this.inFlightCount() < this.cruiseState.limit) {
        const next = this.nextEligible()
        if (next === undefined) break
        if (next.kind === 'comment') this.launchComment(next.task, next.round)
        else this.launchTask(next.task, 'manual')
      }
    } finally {
      this.dispatching = false
      if (this.dispatchQueued) this.dispatch()
    }
  }

  /**
   * Start the oldest queued schedule/chain launch, or drop it when it went
   * stale (task deleted, completed, paused, or busy). Returns whether a
   * request was consumed (so the caller keeps draining).
   */
  private drainQueuedLaunch(): boolean {
    const queued = this.queuedLaunches[0]
    if (queued === undefined) return false
    this.queuedLaunches.shift()
    const task = this.tasks.find(candidate => candidate.id === queued.taskId)
    // A rule may no longer drive the task (moved to review/backlog/done, or
    // deleted): the request is stale — drop it. A busy task also drops its
    // queued auto run (the same "skip when busy" semantics as a direct hit).
    if (task === undefined || hasOpenRun(task) || ruleReadiness(task).kind !== 'active') return true
    this.launchTask(task, queued.trigger)
    return true
  }

  /**
   * The next runnable unit under the budget, or undefined: the earliest
   * eligible comment continuation across tasks (global FIFO by submission
   * time; a task's own comments always run in order because its first
   * uninjected round is the only one eligible while the task is drivable),
   * else the first todo task the cruise may pick up (skipping tasks that
   * still own queued comments — the comment has priority over a fresh run).
   * Comments and pickups only flow while the cruise is on; without it,
   * comments stay saved and todo tasks stay idle.
   */
  private nextEligible():
    | { kind: 'comment'; task: TaskRecord; round: ExecutionRecord }
    | { kind: 'task'; task: TaskRecord }
    | undefined {
    if (!this.cruiseState.enabled) return undefined
    let best: { kind: 'comment'; task: TaskRecord; round: ExecutionRecord } | undefined
    for (const task of this.tasks) {
      // Comment continuations may inject on any non-busy, non-completed task
      // (backlog included — a user's comment keeps its session conversation
      // alive; fresh cruise runs stay todo-only via the pickup below).
      if (task.status === 'running' || task.status === 'done') continue
      const round = task.executions.find(candidate =>
        candidate.comment !== undefined && candidate.sessionId !== undefined
        && candidate.injectedAt === undefined && candidate.endedAt === undefined)
      if (round !== undefined && (best === undefined || round.startedAt < best.round.startedAt)) {
        best = { kind: 'comment', task, round }
      }
    }
    if (best !== undefined) return best
    const todo = this.tasks.find(task => {
      if (task.status !== 'todo' || hasOpenRun(task)) return false
      return !task.executions.some(candidate =>
        candidate.comment !== undefined && candidate.injectedAt === undefined && candidate.endedAt === undefined)
    })
    return todo !== undefined ? { kind: 'task', task: todo } : undefined
  }

  /**
   * Launch a plain execution round: move the task to 'running', append the
   * execution record, and hand off to the ExecutionService. A manual trigger
   * primes an enabled schedule rule (auto triggers never prime).
   */
  private launchTask(task: TaskRecord, trigger: RunTrigger): void {
    let target = task
    if (trigger === 'manual' && task.schedule?.enabled === true && task.schedule.primed !== true) {
      target = withSchedule(task, { primed: true }, this.now())
    }
    const { task: next, execution } = startExecution(target, this.now(), this.uuid())
    this.tasks = this.tasks.map(candidate => candidate.id === task.id ? next : candidate)
    this.persistAndNotify()
    this.activeExecutionIds.add(execution.id)
    void this.deps.exec.run(next, execution, (event) => { this.handleExecutionEvent(event) })
  }

  /**
   * Inject one comment continuation: mark the round injected, move the task
   * to 'running', and send the text to the execution session (a fresh turn
   * in the same session, watched like a plain run). Only ever called by
   * {@link dispatch}, after eligibility was validated.
   */
  private launchComment(task: TaskRecord, round: ExecutionRecord): void {
    if (round.sessionId === undefined || round.comment === undefined) return
    const marked = { ...round, injectedAt: this.now() }
    const running = withStatus({
      ...task,
      executions: task.executions.map(candidate => candidate.id === round.id ? marked : candidate),
    }, 'running', this.now())
    this.tasks = this.tasks.map(candidate => candidate.id === task.id ? running : candidate)
    this.persistAndNotify()
    this.activeExecutionIds.add(round.id)
    void this.deps.exec.commentRun(running, marked, round.sessionId, round.comment, (event) => {
      this.handleExecutionEvent(event)
    })
  }

  /**
   * Execute a task for real. A manual run starts immediately — an explicit
   * user action is never queued — and occupies a slot like any other round.
   * Auto triggers (cron due instants, chain hand-offs) start right away when
   * the in-flight budget has room and otherwise queue for {@link dispatch};
   * either way the call reports accepted so the scheduler rolls the schedule
   * forward exactly once. A second call while the task's latest run is still
   * open is ignored.
   *
   * A manual run primes an enabled schedule rule: auto triggers only drive
   * tasks a manual run has started, so arming a rule never executes anything
   * by itself.
   */
  async runTask(id: string, trigger: RunTrigger = 'manual'): Promise<boolean> {
    const task = this.tasks.find(candidate => candidate.id === id)
    if (task === undefined) return false
    // Only a genuinely open run blocks a new one: a pending comment round
    // (task not running) must never block the Run button or a drag-rerun.
    if (hasOpenRun(task)) return false
    if (trigger === 'manual' || this.inFlightCount() < this.cruiseState.limit) {
      this.launchTask(task, trigger)
      return true
    }
    if (!this.queuedLaunches.some(candidate => candidate.taskId === id)) {
      this.queuedLaunches.push({ taskId: id, trigger })
    }
    return true
  }

  /**
   * Continue an armed chain schedule after a settled run: persist the
   * incremented counter (disarming after the final budgeted run) and start
   * the next run through the shared dispatcher (which queues it when the
   * in-flight budget is full). No-op unless the chain is armed AND primed by
   * a manual run, its latest execution has settled, and a further run is
   * within budget. Runs synchronously after a settle, so the scheduler's
   * recovery tick can never interleave a duplicate launch.
   */
  private maybeContinueChain(id: string): void {
    const task = this.tasks.find(candidate => candidate.id === id)
    const schedule = task?.schedule
    if (schedule === undefined || !schedule.enabled || !schedule.primed || schedule.mode !== 'chain') return
    const latest = task?.executions[task.executions.length - 1]
    // Only a succeeded plain run hands off; a refine round settling must
    // never start a chain (refinement is preparation, not execution).
    if (latest === undefined || latest.endedAt === undefined || latest.result !== 'succeeded' || latest.refine === true) return
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
   * place. Comments are a per-task FIFO queue: any number may be saved, and
   * the shared dispatcher injects them one at a time — a task can run only
   * one round at a time, and the in-flight budget bounds how many sessions
   * run across the board. Injection only happens while the auto-cruise is
   * on; without it the comments stay saved (and cancellable) until the
   * cruise drives the board. A completed task cannot be commented (its work
   * is done); every other state can — a running task's comment queues for
   * when its current round settles.
   *
   * A round with `command` set is a slash command, not a turn: the line is
   * executed through the native command registry when injected (unknown
   * commands fall back to plain text), matching the native composer's '/'
   * behavior. Every round records the execution it continues
   * (`parentExecutionId`), so the review page shows each execution's own
   * comments — never the whole task's.
   * @param taskId - the task owning the execution.
   * @param executionId - the settled execution to continue (its session is reused).
   * @param text - the comment to send to the session's agent.
   * @param command - whether the comment is a slash-command line.
   * @returns the queued comment round, or undefined when rejected (unknown
   *   task/execution, completed task, execution not settled).
   */
  submitComment(taskId: string, executionId: string, text: string, command = false): ExecutionRecord | undefined {
    const trimmed = text.trim()
    if (trimmed === '') return undefined
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined || task.status === 'done') return undefined
    const execution = task.executions.find(candidate => candidate.id === executionId)
    if (execution === undefined || execution.sessionId === undefined || execution.endedAt === undefined) return undefined
    const round: ExecutionRecord = {
      id: this.uuid(),
      sessionId: execution.sessionId,
      startedAt: this.now(),
      endedAt: undefined,
      result: undefined,
      error: undefined,
      comment: trimmed,
      parentExecutionId: execution.id,
      ...command ? { command: true } : {},
    }
    this.tasks = this.tasks.map(candidate => candidate.id === taskId
      ? { ...candidate, updatedAt: this.now(), executions: [...candidate.executions, round] }
      : candidate)
    this.persistAndNotify()
    return round
  }

  /**
   * Cancel a comment round that has not been injected yet: removes it from
   * the task (a saved or queued comment is editable by deleting it and
   * writing a new one). A round that was already injected (the session is
   * running it) or settled cannot be cancelled.
   * @param executionId - the pending comment round's id.
   * @returns true when the round was removed.
   */
  cancelComment(executionId: string): boolean {
    const task = this.tasks.find(candidate =>
      candidate.executions.some(execution => execution.id === executionId))
    if (task === undefined) return false
    const round = task.executions.find(candidate => candidate.id === executionId)
    if (round === undefined || round.comment === undefined) return false
    if (round.injectedAt !== undefined || round.endedAt !== undefined) return false
    this.tasks = this.tasks.map(candidate => candidate.id === task.id
      ? { ...candidate, updatedAt: this.now(), executions: candidate.executions.filter(execution => execution.id !== executionId) }
      : candidate)
    this.persistAndNotify()
    return true
  }

  // --- requirement refinement ---------------------------------------------------

  /**
   * Start (or continue) a backlog task's requirement refinement: launch a
   * refine round in the task's refine session, created lazily through the
   * same session machinery as executions and inheriting the task's run
   * configuration (workspace/model/effort/permission — nothing extra to
   * configure). The first round sends the built-in refine instruction (the
   * agent researches with its own tools, asks the user anything unclear, and
   * delivers a ready-to-run prompt); later rounds are the user's answers.
   * @param taskId - the backlog task to refine.
   * @param english - whether to write the refine instruction in English.
   * @returns true when a round was launched.
   */
  startRefine(taskId: string, english = false): boolean {
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined || task.status !== 'backlog' || hasOpenRun(task)) return false
    const round: ExecutionRecord = {
      id: this.uuid(),
      sessionId: task.refineSessionId,
      startedAt: this.now(),
      endedAt: undefined,
      result: undefined,
      error: undefined,
      refine: true,
    }
    this.tasks = this.tasks.map(candidate => candidate.id === taskId
      ? { ...candidate, updatedAt: this.now(), executions: [...candidate.executions, round] }
      : candidate)
    this.persistAndNotify()
    this.activeExecutionIds.add(round.id)
    const launchTask = this.tasks.find(candidate => candidate.id === taskId)
    if (launchTask === undefined) return true
    void this.deps.exec.run(launchTask, round, (event) => { this.handleExecutionEvent(event) }, {
      prompt: buildRefinePrompt(launchTask, english),
      sessionId: task.refineSessionId,
      fresh: task.refineSessionId === undefined,
      renameTo: `${task.title} · 完善需求`,
    })
    return true
  }

  /**
   * Send the user's answer into the task's refine session (the AI asked and
   * is waiting): launch a refine round with the answer text, delivered
   * immediately — the session is already counted in-flight, so answers never
   * queue behind the cruise gate or the comment FIFO.
   * @param taskId - the task whose refine session receives the answer.
   * @param text - the answer text.
   * @returns true when the answer was launched.
   */
  answerRefine(taskId: string, text: string): boolean {
    const trimmed = text.trim()
    if (trimmed === '') return false
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined || task.refineSessionId === undefined) return false
    const round: ExecutionRecord = {
      id: this.uuid(),
      sessionId: task.refineSessionId,
      startedAt: this.now(),
      endedAt: undefined,
      result: undefined,
      error: undefined,
      refine: true,
    }
    this.tasks = this.tasks.map(candidate => candidate.id === taskId
      ? { ...candidate, updatedAt: this.now(), executions: [...candidate.executions, round] }
      : candidate)
    this.persistAndNotify()
    this.activeExecutionIds.add(round.id)
    const launchTask = this.tasks.find(candidate => candidate.id === taskId)
    if (launchTask === undefined) return true
    void this.deps.exec.run(launchTask, round, (event) => { this.handleExecutionEvent(event) }, {
      prompt: trimmed,
      sessionId: task.refineSessionId,
      fresh: false,
      renameTo: `${task.title} · 完善需求`,
    })
    return true
  }

  /**
   * Write a refined prompt onto the task (the user confirms the text shown
   * in the refine panel; nothing is ever applied automatically).
   * @param taskId - the task to update.
   * @param prompt - the refined execution prompt text.
   * @returns true when the task was updated.
   */
  applyRefineResult(taskId: string, prompt: string): boolean {
    const trimmed = prompt.trim()
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined || trimmed === '') return false
    this.tasks = this.tasks.map(candidate => candidate.id === taskId
      ? { ...candidate, prompt: trimmed, updatedAt: this.now() }
      : candidate)
    this.persistAndNotify()
    return true
  }

  // --- auto-cruise --------------------------------------------------------------

  /** Turn the auto-cruise on or off (persisted). On re-pumps the dispatch
   *  queue immediately — pending comments and todo pickups start under the
   *  concurrency budget, comments first (a human instruction wins over the
   *  cruise picking up a fresh run). */
  setCruiseEnabled(on: boolean): void {
    if (this.cruiseState.enabled === on) return
    this.cruiseState = { ...this.cruiseState, enabled: on }
    this.deps.cruiseStorage?.write(this.cruiseState)
    if (on) this.dispatch()
    this.notify()
  }

  /** Change the concurrency budget (persisted; the dispatcher re-pumps). */
  setCruiseLimit(limit: number): void {
    const clamped = Math.max(1, Math.floor(limit))
    if (this.cruiseState.limit === clamped) return
    this.cruiseState = { ...this.cruiseState, limit: clamped }
    this.deps.cruiseStorage?.write(this.cruiseState)
    this.dispatch()
    this.notify()
  }

  private handleExecutionEvent(event: ExecutionEvent): void {
    if (event.kind === 'started') {
      this.tasks = this.tasks.map(task => task.id === event.taskId
        ? attachSessionId(task, event.executionId, event.sessionId, this.now())
        : task)
      // The first refine round binds the task's refine session — every later
      // refine round reuses it, so the whole refinement conversation stays
      // in one session across refreshes.
      if (this.tasks.some(task =>
        task.id === event.taskId && task.executions.some(round =>
          round.id === event.executionId && round.refine === true))) {
        this.tasks = this.tasks.map(task => task.id === event.taskId
          ? withRefineSession(task, event.sessionId, this.now())
          : task)
      }
      this.persistAndNotify()
      return
    }
    this.activeExecutionIds.delete(event.executionId)
    this.tasks = this.tasks.map(task => task.id === event.taskId
      ? this.settleRound(task, event.executionId, event.outcome, event.error)
      : task)
    // A settled run hands off to the next chained run synchronously, so the
    // scheduler's recovery tick can never interleave a duplicate launch.
    // The chain request precedes the final persist: a chain-armed task keeps
    // 'running' between hand-offs and its next run is queued before any
    // comment/cruise work competes for the freed slot.
    this.maybeContinueChain(event.taskId)
    this.persistAndNotify()
  }

  /** Settle a round with the rule its kind demands: refine rounds keep the
   *  task in its column (settlement of a plain run may move the card). */
  private settleRound(
    task: TaskRecord,
    executionId: string,
    outcome: 'succeeded' | 'failed' | 'cancelled',
    error: string | undefined,
  ): TaskRecord {
    const round = task.executions.find(candidate => candidate.id === executionId)
    if (round?.refine === true) return settleRefine(task, executionId, outcome, this.now(), error)
    return settleExecution(task, executionId, outcome, this.now(), error)
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
    // The session list also carries live wait states (approval / plan-review
    // / question) and the review page's session facts (cwd / agent preset).
    // Re-render consumers so a card's "等待回应" chip and the review page's
    // banner appear the moment the session starts waiting — without a poll.
    this.notify()
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
        const next = this.settleRound(task, event.executionId, event.outcome, event.error)
        if (next === task) continue
        this.tasks = this.tasks.map(candidate => candidate.id === task.id ? next : candidate)
        changed = true
        continued.push(task.id)
      }
      // A reconciled settle hands off to the next chained run like a live one
      // (the chain request precedes the persist so the freed slot is
      // booked before any comment/cruise work competes for it).
      for (const id of continued) this.maybeContinueChain(id)
      if (changed) this.persistAndNotify()
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
    // Every ledger mutation re-evaluates the execution queue: a freed slot,
    // a new comment, a moved card or a cruise switch all funnel through the
    // same bounded dispatch (idempotent — nothing launches twice).
    this.dispatch()
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
