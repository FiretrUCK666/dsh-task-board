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
import { nextSessionRuleAt, withSessionRules } from './automation.ts'
import { buildRefinePrompt } from './refine.ts'
import { deriveLinkedSessions, type LinkedSessionRow, type LinkedSessionSource } from './linked-sessions.ts'
import { boundSourceTitle, resolveExternalKind } from './linked-sessions.ts'
import { applyManualToggle, isCruiseWindow, normalizeWindow, setCruiseSchedule as applySchedule, sortWindows, tickCruise as tickSchedule } from './cruise.ts'
import { DIRECT_GRACE_MS, EXTERNAL_SETTLE_GRACE_MS, detectExternalTurns, latestUserMessage, withinGrace, type ActivityBook, type LatestUserMessage } from './session-activity.ts'
import { withTaskColor } from './colors.ts'
import { taskSessionsOf, type TaskSessionRow } from './session-list.ts'
import type { QuestionAnswerEntry, QuestionRpcFace, WireQuestion } from './question-rpc.ts'
import type { TaskStore } from './store.ts'
import {
  applyCardOrder, createTask, disarmSchedule, hasOpenRun, newCommentRound, newDirectRound, newExternalRound, promoteToColumnTop, ruleReadiness, sameBind, settleExecution, settleRefine, startExecution, supplementLaunchFields, taskBindsOf, taskColumnAllowsAutomation, taskExecutable, withRefineSession, withSchedule, withStatus,
  type ExecutionRecord, type NewTaskInput, type ScheduleMode, type TaskBind, type TaskRecord, type TaskStatus,
} from './tasks.ts'

/** Default auto-cruise concurrency when the user has not configured one. */
export const DEFAULT_CRUISE_LIMIT = 5

/** The concurrency budget's real ceiling — the same cap the board's number
 *  input advertises (max=20). The controller clamps, so the advertised bound
 *  is enforced at the single write point, never just decorated in the UI. */
export const MAX_CRUISE_LIMIT = 20

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
        /** The session's display title, when the host recorded one (execution-row identity). */
        title?: string
      }>
    }
    subscribe(fn: () => void): () => void
  }
  /** Whether a session still exists in the host session list. */
  exists(id: string): boolean
  /** Select a session as current (navigates the conversation view). */
  open(id: string): void
}

/**
 * The workspaces face the controller needs for live "链接会话" derivation:
 * one workspace's accounted sessions (in order) plus the registry-global
 * archive set — exactly the facts the native workspace browser groups by.
 */
export interface WorkspacesControllerFace {
  list: {
    getSnapshot(): {
      items: readonly { id: string; title: string; sessionIds: readonly string[] }[]
      archivedSessionIds: readonly string[]
    }
    subscribe(fn: () => void): () => void
  }
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

/** One file/directory candidate of the OFFICIAL `@file` discovery (the
 *  `remote.fileReferences.list` result row). Structural — no SDK import. */
export interface ReferenceFileCandidate {
  kind: 'file' | 'directory'
  path: string
}

/** One session candidate of the OFFICIAL session-reference discovery (the
 *  `remote.sessionReferenceResolver.candidates` result row). Structural —
 *  no SDK import. `mention` is the canonical `@[label](dsh-session:…)`
 *  prompt text, pre-serialized by the host. */
export interface ReferenceSessionCandidate {
  sessionId: string
  label: string
  cwd?: string
  createdAt: number
  mention: string
}

/** The structural face of the two Remote namespaces behind the OFFICIAL '@'
 *  reference source (the harness's ui-reference calls exactly these). */
export interface ReferenceRemoteFace {
  fileReferences?: {
    list(sessionId: string, query: string, signal: AbortSignal): Promise<
      | { ok: true; value: readonly ReferenceFileCandidate[] }
      | { ok: false; error: unknown }
    >
  }
  sessionReferenceResolver?: {
    candidates(sessionId: string, query: string, signal: AbortSignal): Promise<
      | { ok: true; value: readonly ReferenceSessionCandidate[] }
      | { ok: false; error: unknown }
    >
  }
}

/** The editable slice of a task (content + run configuration). */
export type TaskUpdatePatch = Partial<Pick<TaskRecord,
  'title' | 'description' | 'prompt' | 'workspaceId' | 'provider' | 'model'
  | 'reasoningEffort' | 'agentPreset' | 'permission'
>>

/** The auto-cruise state: the current on/off truth, the last manual intent,
 *  concurrency, and the scheduled windows that flip it at their boundaries
 *  (see cruise.ts — `enabled` IS the truth: manual toggles set it directly
 *  and never touch the schedule; window start/end instants flip it and take
 *  over from the manual intent; expired windows prune). */
export interface CruiseState {
  enabled: boolean
  /** Last explicit manual intent (true=手动开, false=手动关); undefined = none yet. */
  manual?: boolean
  limit: number
  /** Scheduled windows `[startAt?, endAt?]`; empty = no auto schedule. */
  schedule: import('./cruise.ts').CruiseWindow[]
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

/** The native todo item shape (the official `todos` projection's row — the
 *  same `TodoItem` the harness's own TodoPanel renders; read structurally so
 *  future reshapes degrade, never crash). */
export interface SessionTodoShape {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** The projection slice the review page reads (the history tail page's block). */
export interface TranscriptProjectionsShape {
  contextPressure?: ContextPressureShape
  contextBreakdown?: ContextBreakdownShape
  permissions?: PermissionSelectShape
  /** The agent's whole todo list (the official `todos` projection, last-write
   *  wins); absent when the domain package/deployment does not serve it. */
  todos?: readonly SessionTodoShape[]
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
  /** Optional workspaces face (workspace-bound "链接会话" derivation + live refresh). */
  workspaces?: WorkspacesControllerFace
  /** Optional run-catalog surface (workspace/model pickers in the new-task form). */
  runCatalog?: RunCatalogFace
  /**
   * Optional official reference bridge for the '@' mention menus: the SAME
   * two Remote namespaces the harness's own ui-reference source calls
   * (file discovery + session-reference discovery). Structurally narrowed so
   * no SDK package is imported; unavailable surfaces degrade to no '@' menu.
   */
  reference?: ReferenceRemoteFace
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
  /** Sends one plain message directly to any native session (linked-session
   *  panel's composer — the host `sessions.prompt` endpoint; absent = the
   *  direct composer is disabled with a hint). This is deliberately NOT the
   *  task-execution path: it never creates execution records, never enters
   *  the dispatcher and never affects task state — it is exactly "typing in
   *  the native conversation". Images are durable attachment refs (admitted
   *  through the host attachment bridge) appended to the prompt content. */
  sessionMessage?: (sessionId: string, text: string, images?: readonly HostImageRef[] | undefined) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Executes one slash-command line against any native session through the
   *  host command registry (matched = recognized; unmatched = the caller
   *  falls back to sending the line as plain text). Absent = slash lines
   *  degrade to plain text. */
  sessionCommand?: (sessionId: string, line: string) => Promise<
    | { ok: true; matched: boolean; outcome?: { kind: 'success' | 'error'; text?: string } }
    | { ok: false; error: string }
  >
  /** The live pending-question tracker (native mux channel): the only path
   *  that can settle a suspended `ask_user_question` — a plain message never
   *  does. Absent = the interaction card degrades (the native side still
   *  answers it). */
  questionRpc?: QuestionRpcFace
}

/** A durable attachment ref returned by the host attachment bridge (the
 *  mirror of the wire refs the review page attaches to a message). */
export interface HostImageRef {
  attachmentId: string
  mediaType: string
  bytes?: number
  width?: number
  height?: number
  name?: string
}

/** Immutable controller snapshot for UI subscriptions. */
export interface ControllerSnapshot {
  tasks: readonly TaskRecord[]
  boardOpen: boolean
  selectedTaskId: string | undefined
  /** Auto-cruise toggle + concurrency limit. */
  cruise: CruiseState
  /** Live execution stats for the board's quiet status line: how many
   *  sessions are running right now, and how many auto launches are queued
   *  for a freed slot. Both zero → the status line hides itself. */
  stats: { running: number; queued: number }
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
    this.cruiseState = {
      enabled: stored?.enabled === true,
      ...(stored?.manual === true || stored?.manual === false ? { manual: stored.manual } : {}),
      limit: storedLimit,
      // Old documents carry no schedule; only well-formed windows load
      // (cross-midnight normalization applied on read too).
      schedule: Array.isArray(stored?.schedule)
        ? sortWindows(stored!.schedule.filter(isCruiseWindow).map(normalizeWindow))
        : [],
    }
  }

  // --- lifecycle -------------------------------------------------------------

  /** Load the persisted ledger and start the navigation/status subscriptions. */
  start(): void {
    this.tasks = this.deps.store.load()
    void this.reconcileRunningTasks()
    this.disposers.push(this.deps.sessions.list.subscribe(() => {
      this.onSessionsChanged()
    }))
    // Live "链接会话" refresh: workspace membership and the archive set change
    // as sessions are created/archived in the native sidebar — mirror those
    // changes into the board (linked rows are pure derivations, so any
    // snapshot change is enough to re-render).
    if (this.deps.workspaces !== undefined) {
      this.disposers.push(this.deps.workspaces.list.subscribe(() => { this.notify() }))
    }
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
      stats: { running: this.inFlightCount(), queued: this.queuedLaunches.length },
    }
  }

  /** Set (or clear, with undefined) a task's accent color. */
  setTaskColor(taskId: string, color: string | undefined): void {
    this.tasks = this.tasks.map(task => task.id === taskId
      ? withTaskColor({ ...task, updatedAt: this.now() }, color)
      : task)
    this.persistAndNotify()
  }

  /** The run-catalog face for form selects, or undefined when not wired. */
  runCatalog(): RunCatalogFace | undefined {
    return this.deps.runCatalog
  }

  /** The OFFICIAL '@' reference bridge (file + session discovery), or
   *  undefined when the deployment does not expose the Remote namespaces —
   *  the '@' menu then stays closed (the same graceful degradation as a
   *  missing slash catalog). */
  referenceSources(): ReferenceRemoteFace | undefined {
    return this.deps.reference
  }

  /**
   * The best session to scope an input's '@' menu to — ONE deterministic
   * resolution shared by every board input (the reference RPCs are
   * session-scoped: file discovery uses the session's cwd, session
   * discovery excludes the target itself):
   * 1. the task's own related session (refine → execution → linked, the
   *    same order every surface reads);
   * 2. the currently staged native session;
   * 3. the first session of the native list.
   * undefined only when there is no task and no session at all.
   */
  referenceSessionOf(taskId: string | undefined): string | undefined {
    if (taskId !== undefined) {
      const task = this.tasks.find(candidate => candidate.id === taskId)
      if (task !== undefined) {
        for (const { sessionId } of this.relatedSessionsOf(task)) {
          if (sessionId !== undefined) return sessionId
        }
      }
    }
    const state = this.deps.sessions.list.getSnapshot()
    if (state.current !== undefined) return state.current
    const first = Object.keys(state.byId)[0]
    return first !== undefined ? first : undefined
  }

  /**
   * The board's own session catalog (id + latest title, native list order)
   * for the '@' fallback rows: when the host's candidates half is
   * unavailable (e.g. the target session is subagent-owned and the gateway
   * refuses the lookup with agent-busy), the menu still offers the other
   * sessions — the INSERTED text stays the official canonical mention, so
   * the host's pre-step parser resolves them exactly like host candidates.
   */
  referenceSessionCatalog(): ReadonlyArray<{ sessionId: string; label: string }> {
    const state = this.deps.sessions.list.getSnapshot()
    return Object.entries(state.byId).map(([sessionId, summary]) => ({
      sessionId,
      label: typeof summary.title === 'string' && summary.title !== '' ? summary.title : sessionId,
    }))
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

  // --- pending native questions (mux channel) -----------------------------------

  /** The open ask_user_question batch for a session (the interaction card's
   *  source of truth — frames carry the rpcId an answer must echo). */
  questionPendingOf(sessionId: string | undefined): WireQuestion | undefined {
    return this.deps.questionRpc?.pendingOf(sessionId)
  }

  /** Subscribe to pending-question changes across sessions. */
  subscribeQuestions(listener: () => void): () => void {
    return this.deps.questionRpc?.subscribe(listener) ?? (() => {})
  }

  /** Deliver one answer batch to the suspended ask (true = accepted). */
  answerQuestion(rpcId: string, sessionId: string, answers: readonly QuestionAnswerEntry[]): Promise<boolean> {
    return this.deps.questionRpc?.answer(rpcId, sessionId, answers) ?? Promise.resolve(false)
  }

  /** Reject the whole ask (the model sees ASK_CANCELLED and continues). */
  cancelQuestion(rpcId: string): Promise<boolean> {
    return this.deps.questionRpc?.cancel(rpcId) ?? Promise.resolve(false)
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

  /** The session's display title (native list summary), or undefined when the
   *  session is gone/unknown. Drives the execution row's identity slot. */
  sessionTitle(sessionId: string | undefined): string | undefined {
    if (sessionId === undefined) return undefined
    return this.deps.sessions.list.getSnapshot().byId[sessionId]?.title
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
      // Opening the detail clears the card's unread reminder: the latest
      // content is now visible (per-row unread dots stay until each review
      // page is opened). Persisted so a refresh keeps the cleared state.
      const at = this.now()
      let changed = false
      this.tasks = this.tasks.map(task => {
        if (task.id !== id || task.viewedAt === at) return task
        changed = true
        return { ...task, viewedAt: at }
      })
      if (changed) this.persistAndNotify()
      this.selectedTaskId = id
      this.notify()
    }
  }

  /**
   * Mark one execution as viewed (the user opened its review page), clearing
   * its row's unread dot AND the task card's unread ring — ONE baseline
   * (task.viewedAt) governs the card's glow, the row's dot/halo is the same
   * moment seen; opening the review page means the task's content is seen.
   * Persisted so the cleared state survives refreshes. A no-op (no persist)
   * for unknown tasks or executions.
   */
  markExecutionViewed(taskId: string, executionId: string): void {
    const at = this.now()
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId) return task
      if (!task.executions.some(round => round.id === executionId)) return task
      const executions = task.executions.map(round => {
        if (round.id !== executionId || round.viewedAt === at) return round
        changed = true
        return { ...round, viewedAt: at }
      })
      // The task-level baseline moves with the execution-level one: opening
      // the review page clears the CARD ring too (not just the row dot) —
      // otherwise the same "seen" moment keeps one glow pulsing (the
      // 待审核一直带光效 symptom).
      if (executions !== task.executions || (task.viewedAt ?? 0) < at) {
        changed = true
        return { ...task, executions, viewedAt: Math.max(task.viewedAt ?? 0, at) }
      }
      return task
    })
    if (changed) this.persistAndNotify()
  }

  closeTask(): void {
    if (this.selectedTaskId === undefined) return
    this.selectedTaskId = undefined
    this.notify()
  }

  // --- task mutations ---------------------------------------------------------

  /**
   * 缺则补、填则守：任务被写入（创建/编辑）或被真正启动（唯一发射门 launchTask）
   * 的时刻，空标题/空描述从执行 Prompt 补齐（`supplementLaunchFields` 纯函数）——
   * 已填字段永不覆盖。这是整个特性的唯一作用点：任何路径（手动/重复/接续链/定时/
   * 巡航/自动化/创建/编辑）都得到同一套语义，卡片永远不会无故空着头。
   */
  private supplementedTask(task: TaskRecord): TaskRecord {
    const supplements = supplementLaunchFields(task)
    return supplements !== undefined ? { ...task, ...supplements } : task
  }

  createTask(input: NewTaskInput): TaskRecord | undefined {
    // Title/description/prompt are ALL optional at creation — a blank prompt
    // only makes the task inert (nothing can run); a PRESENT prompt fills the
    // empty title/description at once (缺则补), so the card never reads
    // empty-headed when the content was already there.
    const task = this.supplementedTask(createTask(input, this.now(), this.uuid(), this.nextOrder()))
    // A fresh card reads as the newest of its layout column.
    this.tasks = promoteToColumnTop([...this.tasks, task], task.id, task.status, this.now())
    this.persistAndNotify()
    return this.tasks.find(candidate => candidate.id === task.id) ?? task
  }

  /**
   * Create a task bound to a live native source (a session or a whole
   * workspace folder dragged in from the sidebar). The bind wires the card's
   * "链接会话" section; everything else behaves like a plain task — title is
   * optional like any new task (the first real run supplements it).
   * @param bind - the live binding.
   * @param input - title/description/prompt/landing column.
   * @returns the created task, or undefined for a bad bind.
   */
  createBoundTask(bind: TaskBind, input: NewTaskInput): TaskRecord | undefined {
    if (bind === undefined) return undefined
    const task = this.supplementedTask(createTask(input, this.now(), this.uuid(), this.nextOrder()))
    const boundTask: TaskRecord = { ...task, binds: [bind] }
    this.tasks = promoteToColumnTop([...this.tasks, boundTask], boundTask.id, boundTask.status, this.now())
    this.persistAndNotify()
    // A freshly bound source may be RUNNING right now (the user dragged in a
    // session/workspace mid-conversation): reflect that instantly — the card
    // jumps to 「进行中」 and the running turn is recorded as an external
    // round; it settles to 「待审核」 when the native turn ends.
    void this.reconcileBoundTask(boundTask.id)
    return boundTask
  }

  /**
   * Copy a task as a fresh template ("复制为模板"): the same content, run
   * configuration AND task-level automation rule (enable state, mode, cron,
   * budget — runCount reset to 0, the cron next-run instant recomputed),
   * landing in 待规划. Executions, hide state, live bindings and SESSION
   * RULES are never copied — a template has none of the source's sessions
   * (a session rule automates a SPECIFIC session of the source task; the
   * template is a new blank card, "绘画规则" would point at nothing).
   * @param id - the source task.
   * @returns the new task, or undefined when the source is unknown.
   */
  copyTask(id: string): TaskRecord | undefined {
    const source = this.tasks.find(task => task.id === id)
    if (source === undefined) return undefined
    const now = this.now()
    let task = createTask({
      title: source.title,
      description: source.description,
      prompt: source.prompt,
      status: 'backlog',
      workspaceId: source.workspaceId,
      provider: source.provider,
      model: source.model,
      reasoningEffort: source.reasoningEffort,
      agentPreset: source.agentPreset,
      permission: source.permission,
    }, now, this.uuid(), this.nextOrder())
    const schedule = source.schedule
    if (schedule !== undefined) {
      task = withSchedule(task, {
        enabled: schedule.enabled,
        mode: schedule.mode,
        cron: schedule.cron,
        maxRuns: schedule.maxRuns,
        runCount: 0,
        nextRunAt: schedule.enabled && schedule.mode === 'cron'
          ? nextRunAtMs(schedule.cron, now)
          : undefined,
      }, now)
    }
    // The template keeps the card's SHAPE: the accent color rides along, but
    // session rules do NOT — they are bound to the source's own sessions
    // ("给这个绘画会话定时发指令"), and the template is a new card without
    // them; copying them would silently automate sessions the template does
    // not own.
    task = {
      ...task,
      ...source.color !== undefined ? { color: source.color } : {},
    }
    // A template is a NEW card: it lands at the top of its landing column
    // (待规划) exactly like a manually created task — a copied card reads as
    // the newest of the column, never appended to the bottom.
    this.tasks = promoteToColumnTop([...this.tasks, task], task.id, task.status, this.now())
    this.persistAndNotify()
    // Re-read the promoted row (createTask's contract): the copy the caller
    // sees IS the card on the board, never the pre-promotion object.
    return this.tasks.find(candidate => candidate.id === task.id) ?? task
  }

  /**
   * The live linked-session rows of a task (pure derivation over the native
   * snapshots; see linked-sessions.ts). Returns [] for unbound tasks or when
   * the workspaces face is absent. EVERY bound source contributes — dragging
   * more sources into a task ADDS to the set (same session, one row).
   */
  linkedOf(task: TaskRecord): LinkedSessionRow[] {
    const workspaces = this.deps.workspaces
    const binds = taskBindsOf(task)
    if (binds.length === 0 || workspaces === undefined) return []
    const snap = workspaces.list.getSnapshot()
    const byId = this.deps.sessions.list.getSnapshot().byId
    const rows: LinkedSessionRow[] = []
    const seen = new Set<string>()
    // Permanently removed sessions never re-derive — a deleted workspace
    // member must stay deleted (hidden would still re-appear; removed cannot).
    const removed = task.removedSessions ?? []
    for (const bind of binds) {
      for (const row of deriveLinkedSessions(bind, {
        byId: byId as unknown as Readonly<Record<string, LinkedSessionSource>>,
        archived: snap.archivedSessionIds,
        workspaceSessionIds: workspaceId => snap.items.find(item => item.id === workspaceId)?.sessionIds,
        hidden: task.hidden?.sessions ?? [],
        // The bound workspace's title is the stable workspace label fallback
        // for rows whose cwd is unknown (workspace binds only).
        ...bind.kind === 'workspace'
          ? { boundWorkspaceTitle: snap.items.find(item => item.id === bind.workspaceId)?.title }
          : {},
      })) {
        if (seen.has(row.sessionId) || removed.includes(row.sessionId)) continue
        seen.add(row.sessionId)
        rows.push(row)
      }
    }
    return rows
  }

  /** Hide one session of the task (run or linked) — the unified per-session
   *  hide: recorded in both families (the derived hidden-session set in
   *  session-list.ts reads either, so a run session and a linked view of the
   *  same session stay hidden together). Non-destructive; numbering stays. */
  hideTaskSession(taskId: string, sessionId: string): void {
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId) return task
      const sessions = task.hidden?.sessions ?? []
      if (sessions.includes(sessionId)) return task
      changed = true
      // A run session also records the runs that used it, so legacy
      // execution-family consumers and the derived set both see it.
      const runIds = task.executions
        .filter(round => round.sessionId === sessionId)
        .map(round => round.id)
      const executions = [...new Set([...(task.hidden?.executions ?? []), ...runIds])]
      return {
        ...task,
        hidden: {
          ...runIds.length > 0 ? { executions } : {},
          sessions: [...sessions, sessionId],
        },
      }
    })
    if (changed) this.persistAndNotify()
  }

  /** Restore every hidden session (the "恢复全部已隐藏" action). */
  unhideTaskSessions(taskId: string): void {
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId || task.hidden === undefined) return task
      changed = true
      const rest = { ...task }
      delete rest.hidden
      return rest
    })
    if (changed) this.persistAndNotify()
  }

  /**
   * The task's unified session list — see {@link taskSessionsOf}: one
   * de-duplicated view of its run sessions and linked sessions, the single
   * source for the detail's 会话 section.
   */
  sessionsOf(task: TaskRecord): TaskSessionRow[] {
    return taskSessionsOf(task, {
      linked: this.linkedOf(task),
      titleOf: sessionId => this.sessionTitle(sessionId),
      pendingInteractionOf: sessionId => this.pendingInteractionOf(sessionId),
    })
  }

  /**
   * Reorder the task's 会话 list by dragging: the moved row lands BEFORE
   * `beforeId` (or at the end when undefined). The full current display order
   * is persisted as the manual order, so sessions that arrive later keep
   * landing at the TOP (the default newest-activity rule) until the user drags
   * them too. @returns true when the order changed.
   */
  reorderTaskSession(taskId: string, sessionId: string, beforeId: string | undefined): boolean {
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId) return task
      const ids = taskSessionsOf(task, {
        linked: this.linkedOf(task),
        titleOf: sid => this.sessionTitle(sid),
        pendingInteractionOf: sid => this.pendingInteractionOf(sid),
      }).map(row => row.sessionId)
      if (!ids.includes(sessionId)) return task
      const rest = ids.filter(id => id !== sessionId)
      let at = beforeId === undefined ? rest.length : rest.indexOf(beforeId)
      if (at < 0) at = rest.length
      const next = [...rest.slice(0, at), sessionId, ...rest.slice(at)]
      if (next.join() === ids.join()) return task
      changed = true
      return { ...task, sessionsOrder: next }
    })
    if (changed) this.persistAndNotify()
    return changed
  }

  /**
   * ADD a live source (a sidebar session or workspace folder) to an EXISTING
   * task — the "drag a folder/session into the open task's 会话 area" path.
   * NEVER replaces: an already-bound identical source is an idempotent no-op,
   * anything else joins the multi-source set. Persisted; the linked rows then
   * derive live from every bound source (new sessions in a bound folder sync
   * in automatically via deriveLinkedSessions).
   *
   * An explicit re-add is also the RESTORE gesture: the sessions the source
   * carries leave the removed set (the hidden tray's 删除 is reversible BY
   * THE USER'S HAND — dragging the session or its workspace back shows it
   * again), while passive workspace derivation never resurrects a removed
   * session.
   * @returns true when the binding was added or anything was restored, false
   * for a pure no-op / unknown task.
   */
  addTaskSource(taskId: string, bind: TaskBind): boolean {
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId) return task
      const current = taskBindsOf(task)
      const isSame = current.some(existing => sameBind(existing, bind))
      const removed = task.removedSessions
      let next = task
      if (removed !== undefined && removed.length > 0) {
        const carried = this.sourceMemberIdsOf(bind)
        const kept = carried.length > 0
          ? removed.filter(id => !carried.includes(id))
          : removed
        if (kept.length !== removed.length) {
          changed = true
          if (kept.length > 0) {
            next = { ...task, removedSessions: kept }
          } else {
            next = { ...task }
            delete next.removedSessions
          }
        }
      }
      if (!isSame) {
        next = { ...next, binds: [...current, bind], updatedAt: this.now() }
        changed = true
      }
      return next
    })
    if (changed) {
      this.persistAndNotify()
      // A newly added / restored source's state joins the card instantly.
      void this.reconcileBoundTask(taskId)
    }
    return changed
  }

  /** The sessions a bound source carries (a session bind is itself; a
   *  workspace bind is its current members) — the ids an explicit re-add
   *  restores. */
  private sourceMemberIdsOf(bind: TaskBind): string[] {
    if (bind.kind === 'session') return [bind.sessionId]
    const snap = this.deps.workspaces?.list.getSnapshot()
    if (snap === undefined) return []
    return [...(snap.items.find(item => item.id === bind.workspaceId)?.sessionIds ?? [])]
  }

  /** Permanently remove ONE session from the task (the hidden-tray 删除):
   *  its rounds are deleted, its hide state is cleared, and it joins the
   *  REMOVED set so a bound workspace can never re-derive it (the delete was
   *  irreversible — deleting a workspace member must actually remove it). A
   *  live session binding that points ONLY at this session is unbound (a
   *  deleted source cannot stay bound). The task itself and every other
   *  session remain.
   *  @returns true when anything was removed. */
  removeTaskSession(taskId: string, sessionId: string): boolean {
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId) return task
      const kept = task.executions.filter(round => round.sessionId !== sessionId)
      const wasHidden = task.hidden?.sessions?.includes(sessionId) === true
      if (kept.length === task.executions.length && !wasHidden) return task
      changed = true
      const removed = task.removedSessions ?? []
      const next: TaskRecord = {
        ...task,
        updatedAt: this.now(),
        executions: kept,
        ...!removed.includes(sessionId) ? { removedSessions: [...removed, sessionId] } : {},
      }
      const hidden = task.hidden
      if (hidden !== undefined) {
        const sessions = (hidden.sessions ?? []).filter(id => id !== sessionId)
        const executions = (hidden.executions ?? []).filter(id =>
          task.executions.find(round => round.id === id && round.sessionId === sessionId) === undefined)
        if (sessions.length > 0 || executions.length > 0) {
          next.hidden = {
            ...(sessions.length > 0 ? { sessions } : {}),
            ...(executions.length > 0 ? { executions } : {}),
          }
        } else {
          delete next.hidden
        }
      }
      // A removed session cannot stay in the manual order either (it can never
      // rejoin the list) — its slot is gone for good.
      const order = task.sessionsOrder
      if (order !== undefined) {
        const kept = order.filter(id => id !== sessionId)
        if (kept.length > 0) next.sessionsOrder = kept
        else delete next.sessionsOrder
      }
      // A live binding that points ONLY at this session cannot stay: its
      // source no longer exists on the task.
      const binds = taskBindsOf(next)
      if (binds.length === 1 && binds[0].kind === 'session' && binds[0].sessionId === sessionId) {
        const unbound: TaskRecord = { ...next }
        delete unbound.bind
        delete unbound.binds
        return unbound
      }
      return next
    })
    if (changed) this.persistAndNotify()
    return changed
  }

  /** Restore ONE hidden session (single-item restore; the bulk "恢复全部"
   *  stays available too — a folder's many hidden rows can be brought back
   *  one by one without restoring everything). */
  unhideTaskSession(taskId: string, sessionId: string): void {
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId || task.hidden === undefined) return task
      const sessions = (task.hidden.sessions ?? []).filter(id => id !== sessionId)
      const executions = (task.hidden.executions ?? []).filter(executionId =>
        task.executions.find(round => round.id === executionId)?.sessionId !== sessionId)
      const hidden: NonNullable<TaskRecord['hidden']> = {}
      if (sessions.length > 0) hidden.sessions = sessions
      if (executions.length > 0) hidden.executions = executions
      changed = true
      if (Object.keys(hidden).length === 0) {
        const rest = { ...task }
        delete rest.hidden
        return rest
      }
      return { ...task, hidden }
    })
    if (changed) this.persistAndNotify()
  }

  /** Default title for a freshly dragged-in binding (from its native source). */
  boundSourceTitleOf(bind: TaskBind): string {
    const workspaces = this.deps.workspaces?.list.getSnapshot()
    return boundSourceTitle(bind, {
      sessions: this.deps.sessions.list.getSnapshot().byId,
      workspaces: workspaces?.items ?? [],
    })
  }

  /** Classify a sidebar-drag id (known session / known workspace / unknown). */
  externalKindOf(id: string): 'session' | 'workspace' | undefined {
    const workspaces = this.deps.workspaces
    return resolveExternalKind(id, {
      sessions: this.deps.sessions.list.getSnapshot().byId,
      workspaces: workspaces?.list.getSnapshot().items ?? [],
    })
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
   * fields are trimmed; a blank title is allowed (the card shows an 未命名
   * placeholder and the 缺则补 supplement fills empty title/description from
   * a present execution prompt at once). The next execution — manual or
   * scheduled — reads the updated record, so edits apply from the
   * following run onward.
   * @returns true when applied, false when rejected (unknown task).
   */
  updateTask(id: string, patch: TaskUpdatePatch): boolean {
    const task = this.tasks.find(candidate => candidate.id === id)
    if (task === undefined) return false
    const title = patch.title?.trim() ?? ''
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
      ? this.supplementedTask({ ...candidate, ...applied, updatedAt: this.now() })
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
   *
   * Automation never locks a card in place (see resolveCardDrop); leaving
   * the lane speaks its own language: a chain hand-off happens ONLY at a
   * settle — a manual move (except done) never disarms the rule and never
   * starts anything, so 完成后接续 stays armed and matches up ("跑到一半
   * 移动卡片不会误杀链").
   */
  moveTask(id: string, status: TaskStatus, beforeId?: string): void {
    const previous = this.tasks.find(task => task.id === id)
    this.tasks = applyCardOrder(this.tasks, id, status, beforeId, this.now())
    this.tasks = this.tasks.map(task => {
      if (task.id !== id) return task
      // Completion is a hard stop, not a pause. The rule's configuration
      // survives, so re-arming from the detail editor resumes the schedule.
      if (status === 'done') return disarmSchedule(task, this.now())
      return task
    })
    // An armed-but-never-run chain leaving backlog for todo starts its first
    // run (arming already covers any column; this stays as the idempotent
    // resume path — hasOpenRun/taskExecutable gate it either way).
    const after = this.tasks.find(task => task.id === id)
    if (after !== undefined && previous !== undefined && previous.status === 'backlog'
      && status === 'todo' && after.schedule?.enabled === true && after.schedule.mode === 'chain') {
      void this.runTask(id, 'chain')
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
   * disabled rule carries no next-run instant. Arming makes a rule active at
   * once (no manual-first gate): cron fires on its next due instant through
   * the scheduler tick, and an armed chain in a drivable column starts its
   * first run right here.
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
    const enabled = patch.enabled ?? current?.enabled ?? false
    // Arming 完成后接续 on a card with NO execution prompt is rejected
    // outright (returns false, nothing persisted): the rule would never run
    // and the switch would read "on" silently — the editor surfaces the
    // blocked reason instead of a dead arm.
    if (enabled && mode === 'chain' && !taskExecutable(task)) return false
    const maxRunsChanged = patch.maxRuns !== undefined && patch.maxRuns !== current?.maxRuns
    const maxRuns = patch.maxRuns !== undefined ? patch.maxRuns : current?.maxRuns
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
    // "完成后接续" arms AND starts: an enabled chain launches its first run
    // at once whenever the prompt is executable and no run is open — ANY
    // column (a review/done card armed by the user means "keep it running",
    // never "wait for a manual re-run"); an empty prompt was already rejected
    // above (never a silent dead arm). Cron waits for its due instant via the
    // scheduler tick.
    if (enabled && mode === 'chain' && taskExecutable(task) && !hasOpenRun(task)) {
      void this.runTask(id, 'chain')
    }
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
        else this.launchTask(next.task)
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
    // A task with no executable content is dropped too — automation never
    // starts a blank-prompt card (the new-task default).
    if (task === undefined || hasOpenRun(task) || ruleReadiness(task).kind !== 'active' || !taskExecutable(task)) return true
    this.launchTask(task)
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
    // 规则轮走自己的车道（自动化车道）：cron 排队轮与 on-complete 循环轮都是
    // ruleId 标记的可观察轮——自动化的回合永不等待板级巡航（用户手写评论仍是
    // 巡航门控的普通留言，见下面的 cruise 分支）。车道内严格按提交时间 FIFO +
    // 全局预算：同一瞬间到点的很多规则只会一个个按序注入（插话规则由
    // fireOnCompleteRules 先入队——完成时刻插话先发，之后不再跳队——绝不
    // 饿死排队规则，也绝无瞬时齐发）。
    let ruleRound: { kind: 'comment'; task: TaskRecord; round: ExecutionRecord } | undefined
    for (const task of this.tasks) {
      if (task.status === 'running' || task.status === 'done') continue
      const round = task.executions.find(candidate =>
        candidate.comment !== undefined && candidate.ruleId !== undefined
        && candidate.sessionId !== undefined
        && candidate.injectedAt === undefined && candidate.endedAt === undefined
        && candidate.external !== true)
      if (round !== undefined && (ruleRound === undefined || round.startedAt < ruleRound.round.startedAt)) {
        ruleRound = { kind: 'comment', task, round }
      }
    }
    if (!this.cruiseState.enabled) return ruleRound
    let best = ruleRound
    for (const task of this.tasks) {
      // Comment continuations may inject on any non-busy, non-completed task
      // (backlog included — a user's comment keeps its session conversation
      // alive; fresh cruise runs stay todo-only via the pickup below).
      if (task.status === 'running' || task.status === 'done') continue
      const round = task.executions.find(candidate =>
        candidate.comment !== undefined && candidate.sessionId !== undefined
        && candidate.injectedAt === undefined && candidate.endedAt === undefined
        && candidate.external !== true)
      if (round !== undefined && (best === undefined || round.startedAt < best.round.startedAt)) {
        best = { kind: 'comment', task, round }
      }
    }
    if (best !== undefined) return best
    const todo = this.tasks.find(task => {
      if (task.status !== 'todo' || hasOpenRun(task)) return false
      // Automation never starts a blank-prompt card (the new-task default).
      if (!taskExecutable(task)) return false
      return !task.executions.some(candidate =>
        candidate.comment !== undefined && candidate.injectedAt === undefined && candidate.endedAt === undefined && candidate.external !== true)
    })
    return todo !== undefined ? { kind: 'task', task: todo } : undefined
  }

  /**
   * Launch a plain execution round: move the task to 'running', append the
   * execution record, and hand off to the ExecutionService. Automation no
   * longer awaits a manual first run — arming a schedule activates it at
   * once (see setSchedule / ruleReadiness) — so any trigger just starts.
   * THE 缺则补 supplement lives here (plus at create/update): every real
   * launch — manual, rerun, chain, cron, cruise pickup, queued auto run —
   * reads the supplemented record, so no launch path can run a card with an
   * empty head (its title names the fresh session).
   */
  private launchTask(task: TaskRecord): void {
    const launch = this.supplementedTask(task)
    const { task: next, execution } = startExecution(launch, this.now(), this.uuid())
    const withExecution = this.tasks.map(candidate => candidate.id === task.id ? next : candidate)
    this.tasks = promoteToColumnTop(withExecution, task.id, 'running', this.now())
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
    this.tasks = promoteToColumnTop(
      this.tasks.map(candidate => candidate.id === task.id ? running : candidate),
      task.id,
      'running',
      this.now(),
    )
    this.persistAndNotify()
    this.activeExecutionIds.add(round.id)
    void this.deps.exec.commentRun(
      this.tasks.find(candidate => candidate.id === task.id) ?? running,
      marked,
      round.sessionId,
      round.comment,
      (event) => { this.handleExecutionEvent(event) },
    )
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
    // NOTHING can execute an empty prompt — manual, quick-run, re-run,
    // drag-rerun, schedule fire, cruise pickup and chain hand-off all funnel
    // through here (the one launch door); a blank-prompt task stays inert
    // until a real prompt is written.
    if (!taskExecutable(task)) return false
    // Only a genuinely open run blocks a new one: a pending comment round
    // (task not running) must never block the Run button or a drag-rerun.
    if (hasOpenRun(task)) return false
    // The 缺则补 supplement applies at the ONE launch door (launchTask).
    if (trigger === 'manual' || this.inFlightCount() < this.cruiseState.limit) {
      this.launchTask(task)
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
   * in-flight budget is full). No-op unless the chain is armed, its latest
   * execution has settled, and a further run is within budget. Runs
   * synchronously after a settle, so the scheduler's recovery tick can never
   * interleave a duplicate launch.
   */
  private maybeContinueChain(id: string): void {
    const task = this.tasks.find(candidate => candidate.id === id)
    const schedule = task?.schedule
    if (schedule === undefined || !schedule.enabled || schedule.mode !== 'chain') return
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

  // --- direct session messages (linked-session panel) -------------------------

  /** Whether the runtime offers the direct-message channel (the linked
   *  panel's composer is disabled without it). */
  directMessageAvailable(): boolean {
    return this.deps.sessionMessage !== undefined
  }

  /**
   * Send one message directly to any native session — the linked-session
   * panel's composer. This is deliberately NOT the task-execution path: the
   * message is delivered to the native session exactly as if typed in its
   * own conversation (host `sessions.prompt` / command registry), never
   * creating execution records, never entering the dispatcher, never
   * touching task state, cruise, chain or schedules.
   *
   * The one recording: on success a DIRECT round is appended to the task —
   * the sent line becomes visible in the session's comment thread next to
   * drive comments and execution comments (one shared thread per session),
   * while remaining purely a record: never queued, never injected, never
   * driving the task.
   * @param taskId - the task owning the session (its thread records the line).
   * @param sessionId - the native session to address.
   * @param text - the message; a leading '/' routes through the command
   *   registry (unmatched lines fall back to plain text, matching the
   *   native composer's default sink).
   * @returns ok, or ok:false with an error string (faces absent, session
   *   gone, prompt rejected).
   */
  sendSessionMessage(taskId: string, sessionId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const trimmed = text.trim()
    if (trimmed === '') return Promise.resolve({ ok: false, error: 'empty message' })
    const send = this.sendRawMessage(sessionId, trimmed)
    return send.then(result => {
      if (!result.ok) return result
      // The turn this direct-send starts is already recorded as a direct
      // round — keep the running flip from ALSO becoming an external round.
      this.directGraceUntil.set(sessionId, this.now() + DIRECT_GRACE_MS)
      this.tasks = this.tasks.map(task => task.id === taskId
        ? {
            ...task,
            updatedAt: this.now(),
            executions: [...task.executions, newDirectRound({
              id: this.uuid(),
              now: this.now(),
              text: trimmed,
              sessionId,
            })],
          }
        : task)
      this.persistAndNotify()
      return result
    })
  }

  /**
  /** Related-session labels of a task (for the composer's @ mention): the
   *  task's sessions, each with a native title (falling back to the raw id),
   *  de-duplicated in related-session order. */
  sessionLabelsOf(taskId: string): Array<{ sessionId: string; title: string }> {
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return []
    const byId = this.deps.sessions.list.getSnapshot().byId
    const seen = new Set<string>()
    const out: Array<{ sessionId: string; title: string }> = []
    for (const { sessionId } of this.relatedSessionsOf(task)) {
      if (sessionId === undefined || seen.has(sessionId)) continue
      seen.add(sessionId)
      const title = (byId[sessionId] as { title?: unknown } | undefined)?.title
      out.push({ sessionId, title: typeof title === 'string' && title !== '' ? title : sessionId })
    }
    return out
  }

  /**
   * Steering send (插话): deliver a comment line to the session IMMEDIATELY —
   * slash-aware, recorded as a settled message round so it stays visible next
   * to queued comments in the same thread. It does NOT enter the dispatcher,
   * does NOT consume the concurrency budget and does NOT respect the cruise
   * gate: it is exactly "interrupt the current turn now" — the counterpart of
   * the default queued send (submitSessionComment). One message, two send
   * modes: queue (调度器注入) vs steer (现在直达).
   */
  steerComment(taskId: string, sessionId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.steerCommentWithImages(taskId, sessionId, text, undefined)
  }

  /** The image-carrying twin of steerComment: durable attachment refs ride
   *  the same direct-send path as plain text. */
  steerCommentWithImages(
    taskId: string,
    sessionId: string,
    text: string,
    images: readonly HostImageRef[] | undefined,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const trimmed = text.trim()
    if (trimmed === '' && (images === undefined || images.length === 0)) {
      return Promise.resolve({ ok: false, error: 'empty message' })
    }
    // A steer on a completed task revives it (moved back to 待办) — the same
    // rule as the queued comment paths: the message drives the task.
    this.reviveTaskIfDone(taskId)
    // A steer is a human message — never gated by the task's execution prompt
    // (that gate belongs to task execution only); the blank-message rejection
    // above is the one guard.
    return this.sendRawMessage(sessionId, trimmed, images).then(result => {
      if (!result.ok) return result
      // The direct-sent turn is already what the steer created — keep the
      // running flip from ALSO becoming an external round.
      this.directGraceUntil.set(sessionId, this.now() + DIRECT_GRACE_MS)
      this.tasks = this.tasks.map(task => task.id === taskId
        ? {
            ...task,
            updatedAt: this.now(),
            executions: [...task.executions, newDirectRound({
              id: this.uuid(),
              now: this.now(),
              text: trimmed,
              sessionId,
            })],
          }
        : task)
      this.persistAndNotify()
      return { ok: true as const }
    })
  }

  // --- session automation rules (scheduled "send a preset instruction to a session") ---
  /** Create a session rule for one of the task's sessions. Two triggers use
   *  the SAME model: cron (cron via the task schedule parser; an unparseable
   *  expression is rejected) and on-complete (no cron, fires at run settle —
   *  完成后续跑). Content mode: `usePrompt` sends the task's CURRENT execution
   *  prompt (绘画 = 定时/每次完成注入执行 Prompt 到单个会话); otherwise the
   *  custom `instruction` text is sent. ONE rule per session: a second rule
   *  for a session the task already automates is rejected outright — a
   *  session's automation is one definition (change it by editing), never a
   *  stack of conflicting triggers ("同时设 7 个" 不可能出现). */
  createSessionRule(taskId: string, input: {
    sessionId: string
    instruction: string
    cron: string
    trigger?: 'cron' | 'on-complete'
    usePrompt?: boolean
    send: 'queue' | 'steer'
  }): import('./automation.ts').SessionRule | undefined {
    const instruction = input.instruction.trim()
    const usePrompt = input.usePrompt === true
    if (instruction === '' && !usePrompt) return undefined
    const trigger = input.trigger === 'on-complete' ? 'on-complete' : 'cron'
    const cron = trigger === 'cron' ? input.cron.trim() : ''
    const nextAt = trigger === 'cron' ? nextRunAtMs(cron, this.now()) : undefined
    if (trigger === 'cron' && (cron === '' || nextAt === undefined)) return undefined
    const existing = this.tasks.find(task => task.id === taskId)
    if (existing?.rules?.some(rule => rule.sessionId === input.sessionId)) return undefined
    const rule: import('./automation.ts').SessionRule = {
      id: this.uuid(),
      sessionId: input.sessionId,
      instruction: usePrompt ? '' : instruction,
      ...usePrompt ? { usePrompt: true } : {},
      trigger,
      cron,
      send: input.send,
      enabled: true,
      ...nextAt !== undefined ? { nextAt } : {},
    }
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId) return task
      changed = true
      return withSessionRules(task, [...(task.rules ?? []), rule])
    })
    if (changed) {
      this.persistAndNotify()
      return rule
    }
    return undefined
  }

  /**
   * Edit an existing session rule: replace its target / instruction / content
   * mode / trigger / cron / send mode in place (the rule id and enable state
   * stay). An invalid patch (blank instruction for a custom rule, unparseable
   * cron, unknown rule) is rejected outright — the old rule is left
   * untouched, never half-applied. A cron change recomputes the due instant
   * from now (the rule restarts its schedule); switching to on-complete drops
   * the due slot and vice versa.
   * @returns true when the rule was updated.
   */
  updateSessionRule(taskId: string, ruleId: string, patch: {
    sessionId?: string
    instruction?: string
    trigger?: 'cron' | 'on-complete'
    usePrompt?: boolean
    cron?: string
    send?: 'queue' | 'steer'
  }): boolean {
    const now = this.now()
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId || task.rules === undefined) return task
      const rules = task.rules.map(rule => {
        if (rule.id !== ruleId) return rule
        const usePrompt = patch.usePrompt === true
        const instruction = usePrompt ? '' : (patch.instruction ?? rule.instruction).trim()
        const trigger = patch.trigger ?? rule.trigger
        const cron = trigger === 'cron' ? (patch.cron?.trim() ?? rule.cron) : ''
        const sessionId = patch.sessionId ?? rule.sessionId
        const send = patch.send ?? rule.send
        // Validate BEFORE applying: an invalid rule is never half-updated.
        if (sessionId === '') return rule
        if (!usePrompt && instruction === '') return rule
        if (trigger === 'cron') {
          if (cron === '' || (cron !== rule.cron && nextRunAtMs(cron, now) === undefined)) return rule
        }
        const nextAt = trigger === 'cron'
          ? cron !== rule.cron
            ? nextRunAtMs(cron, now) ?? rule.nextAt
            : rule.nextAt
          : undefined
        const updated = {
          ...rule, sessionId, instruction, trigger, cron, send,
          ...usePrompt ? { usePrompt: true } : { usePrompt: undefined },
          ...nextAt !== undefined ? { nextAt } : { nextAt: undefined },
        }
        if (updated.sessionId === rule.sessionId && updated.instruction === rule.instruction
          && updated.trigger === rule.trigger && updated.usePrompt === rule.usePrompt
          && updated.cron === rule.cron && updated.send === rule.send && updated.nextAt === rule.nextAt) return rule
        changed = true
        return updated
      })
      return withSessionRules(task, rules)
    })
    if (changed) this.persistAndNotify()
    return changed
  }

  /** Toggle a session rule's enabled state (the row's live switch). */
  toggleSessionRule(taskId: string, ruleId: string, enabled: boolean): void {
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId || task.rules === undefined) return task
      const current = task.rules
      const rules = current.map(rule => rule.id === ruleId ? { ...rule, enabled } : rule)
      if (rules.some((rule, index) => rule !== current[index])) changed = true
      return withSessionRules(task, rules)
    })
    if (changed) this.persistAndNotify()
  }

  /** Remove a session rule. */
  deleteSessionRule(taskId: string, ruleId: string): void {
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId || task.rules === undefined) return task
      const rules = task.rules.filter(rule => rule.id !== ruleId)
      if (rules.length !== task.rules.length) changed = true
      return withSessionRules(task, rules)
    })
    if (changed) this.persistAndNotify()
  }

  /**
   * The minute heartbeat for CRON session rules (the scheduler's
   * sessionRulesTick): for every enabled cron rule whose due instant has
   * passed, send its preset instruction to the target session (slash-aware;
   * the sent line is recorded as a direct round so it shows in the session's
   * thread), then roll forward to the next cron match. A session that is
   * gone is skipped (its due slot is kept — it fires when the session
   * returns); an unparseable expression auto-disables the rule (错过即跳过),
   * never re-fires forever. On-complete rules have no due slot — they fire
   * at run settle (fireOnCompleteRules), never here.
   */
  async tickSessionRules(now: number): Promise<void> {
    const byId = this.deps.sessions.list.getSnapshot().byId
    const updates = new Map<string, TaskRecord>()
    for (const task of this.tasks) {
      if (task.rules === undefined || task.rules.length === 0) continue
      const rules = task.rules.map(rule => ({ ...rule }))
      let taskChanged = false
      for (const rule of rules) {
        if (!rule.enabled || rule.trigger !== 'cron') continue
        if (rule.nextAt === undefined) continue // defensive: no due slot → skip
        if (byId[rule.sessionId] === undefined) continue // session gone: keep due slot
        // The SAME readiness semantics as the task-level schedule: a rule is
        // active only while the task sits in a drivable column. A paused rule
        // keeps its due slot (the pause is a hold, never a drop) and is NOT
        // retried every tick — the across-status skip is what a pause means.
        if (!taskColumnAllowsAutomation(task)) continue
        if (rule.nextAt > now) continue
        // A usePrompt rule has nothing to send while the task's execution
        // prompt is empty (blocked); a custom rule's content is its own.
        const text = rule.usePrompt === true ? task.prompt.trim() : rule.instruction
        if (text === '') continue
        // Fire, send-mode consistent with the comment SendModeToggle grammar:
        // queue = the instruction becomes a rule-marked round that rides the
        // AUTOMATION lane (not cruise-gated: a scheduled rule must fire on
        // schedule, never wait for the board cruise; the `ruleId` marker is
        // what the lane keys on — the loop hook is inert for cron rules via
        // its trigger guard); steer = delivered straight to the session now,
        // recorded as a direct round.
        let fired: { ok: true } | { ok: false; error: string }
        if (rule.send === 'queue') {
          const round = this.queueRuleComment(task.id, rule.sessionId, text, text.trimStart().startsWith('/'), rule.id)
          if (round === undefined) {
            // The injector refused (blank line / completed task / unknown
            // task): keep the due slot, retried next tick.
            continue
          }
          fired = { ok: true }
        } else {
          fired = await this.sendSessionMessage(task.id, rule.sessionId, text)
        }
        if (!fired.ok) continue
        taskChanged = true
        const next = nextSessionRuleAt(rule)
        rule.lastAt = now
        rule.nextAt = next ?? rule.nextAt // keep a live slot; auto-disable prevents re-fires
        rule.enabled = next === undefined ? false : rule.enabled
      }
      if (taskChanged) {
        // The send already attached a direct round and persisted a NEW task
        // object (this.tasks was replaced in place); layer the rule bookkeeping
        // onto that latest object, never the stale iteration copy.
        const latest = this.tasks.find(candidate => candidate.id === task.id) ?? task
        updates.set(task.id, withSessionRules(latest, rules))
      }
    }
    if (updates.size > 0) {
      this.tasks = this.tasks.map(task => updates.get(task.id) ?? task)
      this.persistAndNotify()
    }
  }

  /** The raw host send for a direct line (slash-aware, no recording).
   *  `images` are durable attachment refs appended to the message content. */
  private sendRawMessage(sessionId: string, text: string, images?: readonly HostImageRef[]): Promise<{ ok: true } | { ok: false; error: string }> {
    const direct = this.deps.sessionMessage
    if (text.startsWith('/')) {
      const command = this.deps.sessionCommand
      if (command !== undefined) {
        return command(sessionId, text).then(result => {
          if (!result.ok) return { ok: false as const, error: result.error }
          if (result.matched) return { ok: true as const }
          // Unknown command: the native default-sink — deliver the line as
          // plain text (never drop a user's input), images still attach.
          if (direct === undefined) return { ok: false as const, error: 'direct message unavailable' }
          return direct(sessionId, text, images)
        })
      }
    }
    if (direct === undefined) return Promise.resolve({ ok: false, error: 'direct message unavailable' })
    return direct(sessionId, text, images)
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
   *   task/execution, execution not settled).
   */
  submitComment(taskId: string, executionId: string, text: string, command = false): ExecutionRecord | undefined {
    const trimmed = text.trim()
    if (trimmed === '') return undefined
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return undefined
    // A comment on a completed task revives it (moved back to 待办) — the
    // same rule as the linked-session composer; the work is driven, never
    // dead-ended.
    if (task.status === 'done') this.reviveTaskIfDone(taskId)
    // A comment is the user's own words — never gated by the task's execution
    // prompt (that gate belongs to task execution only: runTask / chain /
    // cron / cruise / usePrompt rules). The session-anchored round enters the
    // task's FIFO like any drive comment; a blank text or unknown task/round
    // is rejected below.
    const execution = task.executions.find(candidate => candidate.id === executionId)
    if (execution === undefined || execution.sessionId === undefined || execution.endedAt === undefined) return undefined
    const round = newCommentRound({
      id: this.uuid(),
      now: this.now(),
      text: trimmed,
      command,
      sessionId: execution.sessionId,
      parentExecutionId: execution.id,
    })
    this.tasks = this.tasks.map(candidate => candidate.id === taskId
      ? { ...candidate, updatedAt: this.now(), executions: [...candidate.executions, round] }
      : candidate)
    this.persistAndNotify()
    return round
  }

  /** A comment on a completed task revives it: moving the task back to 待办 is
   *  the SAME column transition as a drag (the schedule re-arms per column
   *  rules), so the comment drives the task instead of hitting a dead end. */
  private reviveTaskIfDone(taskId: string): void {
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined || task.status !== 'done') return
    this.moveTask(taskId, 'todo')
  }

  /**
   * Save a comment continuation against a linked session — the drive-mode
   * composer of the linked-session panel. Semantics are identical to
   * {@link submitComment}: the session-anchored round enters the task's
   * per-task FIFO comment queue and the shared dispatcher injects it into
   * the linked session through the same concurrency budget, exactly like a
   * comment submitted from an execution's review page. The only difference
   * is the anchor (`sessionAnchor` instead of `parentExecutionId`), which
   * puts the round in the linked session's own comment thread and reuses
   * that session instead of a settled execution's. A completed task is
   * REVIVED by its comment (moved back to 待办) — the comment drives it
   * instead of being a dead end; every other state queues as usual.
   * @param taskId - the task owning the linked session.
   * @param sessionId - the linked session to continue (never created).
   * @param text - the comment to send to the session's agent.
   * @param command - whether the comment is a slash-command line.
   * @returns the queued comment round, or undefined when rejected (unknown
   *   task).
   */
  submitSessionComment(taskId: string, sessionId: string, text: string, command = false): ExecutionRecord | undefined {
    const trimmed = text.trim()
    if (trimmed === '') return undefined
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return undefined
    if (task.status === 'done') this.reviveTaskIfDone(taskId)
    return this.queueRuleComment(taskId, sessionId, trimmed, command)
  }

  /**
   * Session-RULE enqueue: the same session-anchored round as
   * {@link submitSessionComment} marked with the rule's id. A rule's content
   * (a custom instruction, or the task's own execution prompt for a usePrompt
   * rule — already validated by the readiness judgment) IS the work, so the
   * task's prompt never mis-blocks it ("对单个会话发指令" 与任务 Prompt 无关);
   * same for a user comment: a comment is human words, never a task
   * execution, so no prompt gate applies to any comment path. Every other
   * guard stays: done revival, blank text, unknown task. `ruleId` marks the
   * round as a rule's own turn — a succeeded settle of such a round re-fires
   * its on-complete rule (完成后续跑 loop); a user comment carries none and
   * never loops.
   */
  private queueRuleComment(taskId: string, sessionId: string, text: string, command = false, ruleId?: string): ExecutionRecord | undefined {
    const trimmed = text.trim()
    if (trimmed === '') return undefined
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return undefined
    if (task.status === 'done') this.reviveTaskIfDone(taskId)
    const round = newCommentRound({
      id: this.uuid(),
      now: this.now(),
      text: trimmed,
      command,
      sessionId,
      sessionAnchor: sessionId,
      ...ruleId !== undefined ? { ruleId } : {},
    })
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

  /** Turn the auto-cruise on or off (persisted) — a MANUAL toggle: it flips
   *  `enabled` directly and NEVER writes the scheduled windows, so clicking
   *  开启/关闭 repeatedly cannot accumulate window records. Scheduled window
   *  boundaries still flip the state (预约语义). On re-pumps the dispatch
   *  queue immediately — pending comments and todo pickups start under the
   *  concurrency budget, comments first. */
  setCruiseEnabled(on: boolean): void {
    const next = applyManualToggle(this.cruiseState, on)
    if (next === this.cruiseState) return
    this.cruiseState = next
    this.deps.cruiseStorage?.write(this.cruiseState)
    if (on) this.dispatch()
    this.notify()
  }

  /** Change the concurrency budget (persisted; the dispatcher re-pumps). The
   *  one clamp: the floor is 1, the ceiling MAX_CRUISE_LIMIT — the same bound
   *  the input advertises, enforced at the write point. */
  setCruiseLimit(limit: number): void {
    const clamped = Math.min(MAX_CRUISE_LIMIT, Math.max(1, Math.floor(limit)))
    if (this.cruiseState.limit === clamped) return
    this.cruiseState = { ...this.cruiseState, limit: clamped }
    this.deps.cruiseStorage?.write(this.cruiseState)
    this.dispatch()
    this.notify()
  }

  /** Replace the cruise's scheduled windows (the editor's add/remove path).
   *  The effective state is recomputed at once against the NEW list: a window
   *  may now cover the present (cruise turns on), or the covering window may
   *  have just been removed (cruise turns off). Expired-window pruning is the
   *  heartbeat's job (tickCruise), so a just-added window is never yanked
   *  before its first tick. */
  setCruiseSchedule(windows: readonly import('./cruise.ts').CruiseWindow[]): void {
    const next = applySchedule(this.cruiseState, windows, this.now())
    if (next === this.cruiseState) return
    this.cruiseState = next
    this.deps.cruiseStorage?.write(this.cruiseState)
    if (this.cruiseState.enabled) this.dispatch()
    this.notify()
  }

  /** The scheduler heartbeat for cruise windows (每分钟): a window's start
   *  instant flips the cruise ON, its end instant flips it OFF; fully-past
   *  windows are pruned and persisted away — "到点自动开启 / 到点自动关闭",
   *  过期记录自动消失. Persist and pump dispatch when anything changed. */
  tickCruise(now: number): void {
    const next = tickSchedule(this.cruiseState, now)
    if (next === this.cruiseState) return
    const turnedOn = next.enabled && !this.cruiseState.enabled
    this.cruiseState = next
    this.deps.cruiseStorage?.write(this.cruiseState)
    if (turnedOn) this.dispatch()
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
    const before = this.tasks.find(task => task.id === event.taskId)
    const settledRound = before?.executions.find(round => round.id === event.executionId)
    this.tasks = this.tasks.map(task => task.id === event.taskId
      ? this.settleRound(task, event.executionId, event.outcome, event.error)
      : task)
    // A just-settled card ranks newest at the top of its landed column
    // (待审核 on success/failure — the settlement moved it there).
    const after = this.tasks.find(task => task.id === event.taskId)
    if (before !== undefined && after !== undefined && before.status !== after.status) {
      this.tasks = promoteToColumnTop(this.tasks, event.taskId, after.status, this.now())
    }
    // A settled run hands off to the next chained run synchronously, so the
    // scheduler's recovery tick can never interleave a duplicate launch.
    // The chain request precedes the final persist: a chain-armed task keeps
    // 'running' between hand-offs and its next run is queued before any
    // comment/cruise work competes for the freed slot.
    this.maybeContinueChain(event.taskId)
    this.persistAndNotify()
    // A settled plain TASK RUN is the on-complete appointment for the task's
    // session rules. Comment rounds carry `comment`, refine rounds carry
    // `refine: true` — neither is a task run, so an on-complete rule can
    // never re-trigger itself through its own queued comment's settle (no
    // send loops). Fired after the persist so the rule bookkeeping layers on
    // the settled object.
    this.settledFollowUp(settledRound, event.taskId, event.outcome)
  }

  /**
   * EVERY way a round can settle runs the SAME post-settle appointments —
   * the live run watch ({@link handleExecutionEvent}) and the recovery /
   * background reconcile ({@link reconcileRunningTasks}): a completion found
   * after a page reload, a missed list flip or through a cold session must
   * still keep automation alive ("任务完成了一次却没有任何反应" 正是这个缺口).
   * 1. on-complete rules (fireOnCompleteRules — ANY completion is the
   *    任务完成 appointment: a plain run, a user comment round or a native/
   *    external turn all landed the card in 「待审核」; refine rounds are
   *    preparation, never a completion, and the rule's OWN round is excluded
   *    — its loop is the dedicated fireLoopRule hook, so a settle never
   *    double-fires; the one-in-flight guard is the second backstop);
   * 2. the rule's own loop (fireLoopRule — a ruleId round's succeeded settle
   *    continues 完成后继续; failure/cancel never does).
   * The chain hand-off stays OUTSIDE (both call sites run it BEFORE their
   * persist — a freed slot is booked before any comment/cruise work competes
   * for it).
   */
  private settledFollowUp(
    settledRound: ExecutionRecord | undefined,
    taskId: string,
    outcome: 'succeeded' | 'failed' | 'cancelled',
  ): void {
    if (settledRound?.refine !== true && settledRound?.ruleId === undefined) {
      void this.fireOnCompleteRules(taskId)
    }
    if (settledRound?.ruleId !== undefined && outcome === 'succeeded') {
      void this.fireLoopRule(taskId, settledRound.ruleId, settledRound.sessionId ?? '')
    }
  }

  /**
   * 完成后续跑（on-complete 循环规则）的一次发送：一条带 ruleId 标记的可观察
   * 指令轮（注入成功结算后再触发）。发送只有一种文法——进入自动化车道（下一轮
   * 可用即注入、预算内排队，与巡航开关无关）；queue/steer 只决定同一完成时刻
   * 的发送次序（插话先发，排队按序——车道内一律 FIFO + 预算，绝不瞬时齐发，
   * 也绝不饿死任何一条）。**一条规则同时在途至多一轮**：规则已有未结算的指令轮
   * （在跑或排队中）时跳过本次发送——任何一次任务完成都不会给同一规则叠第二个
   * 轮子，「轮子在跑」就是「继续进行中」；它结算成功时 fireLoopRule 续上下一轮。
   * 「关闭/删除/会话消失/内容不可用」= 停止；失败/取消 = 不续。
   */
  private fireRuleRound(task: TaskRecord, rule: import('./automation.ts').SessionRule, text: string): void {
    if (task.executions.some(candidate => candidate.ruleId === rule.id && candidate.endedAt === undefined)) return
    const round = this.queueRuleComment(task.id, rule.sessionId, text, text.trimStart().startsWith('/'), rule.id)
    if (round === undefined) return
    this.tasks = this.tasks.map(candidate => candidate.id === task.id
      ? withSessionRules(candidate, (candidate.rules ?? []).map(candidateRule =>
        candidateRule.id === rule.id ? { ...candidateRule, lastAt: this.now() } : candidateRule))
      : candidate)
    this.persistAndNotify()
  }

  /**
   * 任务一次执行结算时触发其 on-complete 会话规则（"完成后续跑"——永续循环：
   * 规则轮成功结算后继续下一轮，直到关闭/删除/会话消失/内容不可用）。发送文法
   * = 一条 ruleId 标记的观察轮（queue/steer，与巡航无关）；判定 = 规则启用 +
   * 内容可得（usePrompt 规则要求任务执行 Prompt 非空；自定义规则内容自带）+
   * 目标会话在场；每次结算每个规则至多一次（lastAt 由 fireRuleRound 记录）。
   * 列暂停不适用：结算瞬间任务刚被移动，这里的"完成"才是约定本身。
   */
  async fireOnCompleteRules(taskId: string): Promise<void> {
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined || task.rules === undefined || task.rules.length === 0) return
    const byId = this.deps.sessions.list.getSnapshot().byId
    // 同一完成时刻的多个规则：插话先发（立即注入、排在队头），排队按序——每个
    // 轮子都是可观察的自动化轮，车道 FIFO + 预算保证一次只有一个在跑。
    const due: Array<{ rule: import('./automation.ts').SessionRule; text: string }> = []
    for (const rule of task.rules) {
      if (rule.trigger !== 'on-complete' || !rule.enabled) continue
      const text = rule.usePrompt === true ? task.prompt.trim() : rule.instruction
      if (text === '') continue // usePrompt + 空 Prompt = blocked, nothing to send
      if (byId[rule.sessionId] === undefined) continue
      due.push({ rule, text })
    }
    for (const { rule, text } of [...due].sort((a, b) =>
      (a.rule.send === 'steer' ? 0 : 1) - (b.rule.send === 'steer' ? 0 : 1))) {
      this.fireRuleRound(task, rule, text)
    }
  }

  /**
   * 完成后续跑：规则自己的指令轮（ruleId 标记）**成功**结算后的再触发——同一
   * 规则再发一条，一轮接一轮；失败/取消不续（错误不风暴）、规则被关/会话消失/
   * 内容不可用即停；用户手写评论（无 ruleId）永不触发。
   */
  async fireLoopRule(taskId: string, ruleId: string, sessionId: string): Promise<void> {
    const task = this.tasks.find(candidate => candidate.id === taskId)
    const rule = task?.rules?.find(candidate => candidate.id === ruleId)
    if (task === undefined || rule === undefined || rule.trigger !== 'on-complete' || !rule.enabled) return
    if (rule.sessionId !== sessionId) return
    const text = rule.usePrompt === true ? task.prompt.trim() : rule.instruction
    if (text === '') return
    const byId = this.deps.sessions.list.getSnapshot().byId
    if (byId[sessionId] === undefined) return
    this.fireRuleRound(task, rule, text)
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

  /** Native-activity detection state (see session-activity.ts): observed
   *  running baselines per session + when external rounds were created. */
  private readonly activityBook: ActivityBook = { running: new Map(), externalSince: new Map() }
  /** Sessions whose current turn the board itself recorded (a direct-send):
   *  they must not re-trigger external detection while in grace. */
  private readonly directGraceUntil = new Map<string, number>()

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
      // After dispose nothing may reconcile (or schedule again).
      if (this.disposed) return
      void this.reconcileRunningTasks()
    }, this.deps.reconcileDebounceMs ?? 350)
  }

  /** How old an execution must be before list reconciliation may settle it. */
  private static readonly ACTIVE_RECONCILE_GRACE_MS = 10_000

  /** Settle tasks left 'running' whose sessions already finished. */
  private async reconcileRunningTasks(): Promise<void> {
    if (this.disposed || this.reconcileInFlight) return
    this.reconcileInFlight = true
    this.reconcilePending = false
    try {
      // Stage 0 — native-activity detection: a related session flipping to
      // `running` with no board-owned open round is an out-of-band turn (the
      // user chatted in the native UI). It is recorded as an external round
      // and drives the card state, so the board mirrors the native reality.
      let changed = await this.scanExternalActivity()

      // Stage 1 — reconcile every task with an open round worth settling:
      // running tasks (plain runs, comment rounds, external rounds) plus any
      // task with an open refinement round (refinement keeps its column).
      type Settled = Extract<ExecutionEvent, { kind: 'settled' }>
      const events: Array<{ task: TaskRecord; round: ExecutionRecord | undefined; event: Settled }> = []
      for (const task of this.tasks) {
        const execution = task.executions[task.executions.length - 1]
        if (execution === undefined || execution.endedAt !== undefined) continue
        if (task.status !== 'running' && execution.refine !== true) continue
        // Runs launched on this page settle through their live watch (turn
        // boundary / host-list flip); reconciliation exists for
        // background/leftover runs. The watch can still be defeated when the
        // execution session stays cold and its list signal is missed, so as
        // a fallback an active run whose session the host reports finished
        // AND that has lived well past the queue window is handed to
        // reconcile (which requires real turn evidence) and released.
        if (task.status === 'running' && this.activeExecutionIds.has(execution.id)) {
          const sessionId = execution.sessionId
          if (sessionId === undefined) continue // still connecting; never judge
          const list = this.deps.sessions.list.getSnapshot()
          const summary = list.byId[sessionId]
          const finished = summary !== undefined && !summary.running
          const pastGrace = this.now() - execution.startedAt > BoardController.ACTIVE_RECONCILE_GRACE_MS
          if (!(finished && pastGrace)) continue
        }
        const event = await this.deps.exec.reconcile(task)
        // A dispose may land while the history read is in flight — a dead
        // controller must never keep settling into a dropped ledger.
        if (this.disposed) return
        if (event !== undefined && event.kind === 'settled') {
          events.push({ task: await this.fillExternalText(task, event.executionId), round: execution, event })
          this.activeExecutionIds.delete(event.executionId)
        }
      }

      // Stage 2 — apply the settled rounds (refine rounds keep the column).
      const continued: string[] = []
      const applied: Array<{ round: ExecutionRecord | undefined; event: Settled }> = []
      for (const { task, round, event } of events) {
        const next = this.settleRound(task, event.executionId, event.outcome, event.error)
        if (next === task) continue
        this.tasks = this.tasks.map(candidate => candidate.id === task.id ? next : candidate)
        changed = true
        continued.push(task.id)
        applied.push({ round, event })
      }
      // A reconciled settle hands off to the next chained run like a live one
      // (the chain request precedes the persist so the freed slot is
      // booked before any comment/cruise work competes for it).
      for (const id of continued) this.maybeContinueChain(id)

      // Stage 3 — cancel external rounds whose session finished with no turn
      // evidence past the grace (a spurious flip must not strand the card).
      if (this.cancelSpuriousExternal()) changed = true

      if (changed) this.persistAndNotify()
      // Stage 4 — the SAME post-settle appointments as a live settle: a
      // recovery/background settlement is a completion too, and automation
      // (on-complete rules + the rule's own loop) must keep working exactly
      // as if the live watch had seen it.
      for (const { round, event } of applied) {
        if (this.disposed) return
        this.settledFollowUp(round, event.taskId, event.outcome)
      }
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

  /** Every related session of a task (de-duplicated): the refine session
   *  first (so it always reads `refine: true`), then execution sessions, then
   *  linked sessions. */
  private relatedSessionsOf(task: TaskRecord): Array<{ sessionId: string; refine: boolean }> {
    const seen = new Set<string>()
    const out: Array<{ sessionId: string; refine: boolean }> = []
    const push = (sessionId: string | undefined, refine: boolean): void => {
      if (sessionId === undefined || seen.has(sessionId)) return
      seen.add(sessionId)
      out.push({ sessionId, refine })
    }
    push(task.refineSessionId, true)
    // Every bound session source is a related session (instant-sync works
    // whenever the native list knows them).
    for (const bind of taskBindsOf(task)) {
      if (bind.kind === 'session') push(bind.sessionId, false)
    }
    for (const execution of task.executions) push(execution.sessionId, false)
    for (const linked of this.linkedOf(task)) push(linked.sessionId, false)
    return out
  }

  /**
   * Detect out-of-band activity on related sessions (see session-activity.ts)
   * and record external rounds: the round enters the session's comment thread,
   * a non-refine round moves the card to 「进行中」, a refine round keeps the
   * column but turns `refining` on. The round body is the user's native
   * message text captured at observation (so the thread shows what was said).
   * Returns whether anything changed.
   */
  private async scanExternalActivity(): Promise<boolean> {
    const byId = this.deps.sessions.list.getSnapshot().byId
    const now = this.now()
    const candidates = this.tasks.map(task => ({
      taskId: task.id,
      candidate: {
        sessions: this.relatedSessionsOf(task),
        hasOpenRoundOn: (sessionId: string): boolean =>
          task.executions.some(round => round.sessionId === sessionId && round.endedAt === undefined),
        inGrace: (sessionId: string): boolean => withinGrace(this.directGraceUntil.get(sessionId), now),
      },
    }))
    const turns = detectExternalTurns(candidates, this.activityBook, byId)
    if (turns.length === 0) return false
    for (const turn of turns) {
      const msg = await this.userMessageOf(turn.sessionId)
      this.tasks = this.tasks.map(task => {
        if (task.id !== turn.taskId) return task
        const withRound = {
          ...task,
          updatedAt: now,
          executions: [...task.executions, newExternalRound({
            id: this.uuid(),
            now,
            sessionId: turn.sessionId,
            refine: turn.refine,
            ...msg?.text !== undefined ? { text: msg.text } : {},
            ...msg !== undefined && msg.text === undefined && msg.hasImage ? { imageOnly: true } : {},
          })],
        }
        if (turn.refine || withRound.status === 'running') return withRound
        return { ...withRound, status: 'running' }
      })
      this.activityBook.externalSince.set(turn.sessionId, now)
    }
    // Cards that flipped to running rank newest at the top of 「进行中」.
    let nextTasks = [...this.tasks]
    for (const turn of turns) {
      const task = nextTasks.find(candidate => candidate.id === turn.taskId)
      if (task !== undefined && !turn.refine && task.status === 'running') {
        nextTasks = promoteToColumnTop(nextTasks, turn.taskId, 'running', now)
      }
    }
    this.tasks = nextTasks
    return true
  }

  /** The newest native user message of a session (the line that started the
   *  observed turn, or a picture-only marker); undefined when the transcript
   *  is unavailable or the tail window missed it. */
  private async userMessageOf(sessionId: string | undefined): Promise<LatestUserMessage | undefined> {
    if (sessionId === undefined || this.deps.transcript === undefined) return undefined
    const result = await this.deps.transcript(sessionId)
    if (result === undefined) return undefined
    return latestUserMessage(result.events)
  }

  /** The newest native user message TEXT of a session (legacy-path helper). */
  private async userTextOf(sessionId: string | undefined): Promise<string | undefined> {
    return (await this.userMessageOf(sessionId))?.text
  }

  /** Backfill the body of an external round settling empty (legacy records /
   *  an observation that missed the text): reads the native user message of
   *  the session and patches the round's comment. Never changes non-external
   *  rounds; non-empty bodies stay untouched. */
  private async fillExternalText(task: TaskRecord, executionId: string): Promise<TaskRecord> {
    const execution = task.executions.find(round => round.id === executionId)
    if (execution === undefined || execution.external !== true) return task
    if (execution.comment !== undefined && execution.comment !== '') return task
    const text = await this.userTextOf(execution.sessionId)
    if (text === undefined) return task
    return {
      ...task,
      executions: task.executions.map(round => round.id === executionId ? { ...round, comment: text } : round),
    }
  }

  /**
   * Instant state sync for an ACTIVE binding: right after a session/workspace
   * is dragged in (createBoundTask / addTaskSource), evaluate its live state
   * — a related session that is running RIGHT NOW gets an open external round
   * and the card jumps to 「进行中」 immediately (its completion later settles
   * to 「待审核」 through the ordinary reconcile), and the new content turns
   * the card unviewed (breathing glow / 「新」) just like native activity.
   *
   * This is deliberately the opposite of the passive scanner's "first
   * observation only baselines": an explicit bind must show current reality
   * at once, while page-load passive observations still never re-fire history.
   * Baselines are set for every related session here too, so the passive
   * running-flip detection keeps working from this point on. Idempotent: a
   * session with an open round is never double-recorded.
   */
  private async reconcileBoundTask(taskId: string): Promise<void> {
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return
    const byId = this.deps.sessions.list.getSnapshot().byId
    const now = this.now()
    let next = task
    let changed = false
    for (const session of this.relatedSessionsOf(task)) {
      const current = byId[session.sessionId]?.running ?? false
      this.activityBook.running.set(session.sessionId, current)
      if (!current) continue
      if (task.executions.some(round => round.sessionId === session.sessionId && round.endedAt === undefined)) continue
      if (withinGrace(this.directGraceUntil.get(session.sessionId), now)) continue
      const msg = await this.userMessageOf(session.sessionId)
      next = {
        ...next,
        updatedAt: now,
        // Unviewed on purpose: this external round is brand-new content the
        // user has not seen (it happened before/while they bound it).
        viewedAt: now - 1,
        executions: [...next.executions, newExternalRound({
          id: this.uuid(),
          now,
          sessionId: session.sessionId,
          ...msg?.text !== undefined ? { text: msg.text } : {},
          ...msg !== undefined && msg.text === undefined && msg.hasImage ? { imageOnly: true } : {},
        })],
      }
      if (next.status !== 'running') next = { ...next, status: 'running' }
      this.activityBook.externalSince.set(session.sessionId, now)
      changed = true
      break // one external round per bound task per reconcile
    }
    if (!changed) return
    const withRound = this.tasks.map(candidate => candidate.id === taskId ? next : candidate)
    this.tasks = promoteToColumnTop(withRound, taskId, 'running', now)
    this.persistAndNotify()
  }

  /**
   * Cancel an open external round whose session has already finished WITHOUT
   * any real turn evidence past the settle grace — the flip was spurious
   * (a session created/unarchived, a transient signal) and the card must not
   * stay stranded in 「进行中」. Real turns settle through the reconcile above
   * (they have evidence), so this only ever cancels noise.
   */
  private cancelSpuriousExternal(): boolean {
    const now = this.now()
    const byId = this.deps.sessions.list.getSnapshot().byId
    let changed = false
    for (const task of this.tasks) {
      const latest = task.executions[task.executions.length - 1]
      const sessionId = latest?.sessionId
      if (latest === undefined || latest.external !== true || latest.endedAt !== undefined || sessionId === undefined) continue
      const summary = byId[sessionId]
      const since = this.activityBook.externalSince.get(sessionId) ?? latest.startedAt
      if (summary?.running === true || now - since <= EXTERNAL_SETTLE_GRACE_MS) continue
      const next = this.settleRound(task, latest.id, 'cancelled', undefined)
      if (next !== task) {
        this.tasks = this.tasks.map(candidate => candidate.id === task.id ? next : candidate)
        changed = true
      }
    }
    return changed
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