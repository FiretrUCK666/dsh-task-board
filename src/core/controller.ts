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
import { boundSourceTitle, realTitleOf, resolveExternalKind } from './linked-sessions.ts'
import { applyManualToggle, setCruiseSchedule as applySchedule, tickCruise as tickSchedule } from './cruise.ts'
import { DIRECT_GRACE_MS, EXTERNAL_SETTLE_GRACE_MS, detectExternalTurns, latestUserMessage, withinGrace, type ActivityBook, type LatestUserMessage } from './session-activity.ts'
import { DIRECT_FALLBACK_STATUS, newestDirectLike, relatedSessionIdsOf, taskLiveStateOf, type TaskLiveState } from './task-live.ts'
import { withTaskColor } from './colors.ts'
import { normalizeCruiseValue, CRUISE_LIMIT_MAX, CRUISE_LIMIT_MIN } from './board-doc.ts'
import { LocalStoragePresetStore } from './presets.ts'
import { appliedPresetOf, LocalStorageSessionAgentStore } from './session-agents.ts'
import { LocalStorageTemplateStore, templateFromTask, templateToNewInput } from './task-templates.ts'
import { LocalStorageRunPresetStore } from './run-presets.ts'
import { taskSessionsOf, type TaskSessionRow } from './session-list.ts'
import type { QuestionAnswerEntry, QuestionRpcFace, WireQuestion } from './question-rpc.ts'
import { verbsOf, type GoalActivationChanged, type GoalServiceFace, type GoalVerbs } from './goal-verbs.ts'
import type { TaskStore } from './store.ts'
import {
  applyCardOrder, createTask, disarmSchedule, hasOpenRun, newCommentRound, newDirectRound, newExternalRound, openRoundsOf, plainRunsOf, promoteToColumnTop, refinable, ruleReadiness, sameBind, sessionIsBusy, settleExecution, settleRefine, startExecution, supplementLaunchFields, taskBindsOf, taskColumnAllowsAutomation, taskExecutable, withRefineSession, withSchedule, withStatus,
  type ExecutionRecord, type NewTaskInput, type ScheduleMode, type TaskBind, type TaskRecord, type TaskStatus,
} from './tasks.ts'

/** Default auto-cruise concurrency when the user has not configured one. */
export const DEFAULT_CRUISE_LIMIT = 5

/** The concurrency budget's real ceiling — the shared board-doc bound (writes
 *  clamp and reads normalize to one pair). Re-exported so board surfaces
 *  keep importing it from the controller. */
export const MAX_CRUISE_LIMIT = CRUISE_LIMIT_MAX

/** The native session-list "waiting for the user" signal (sidebar amber dot). */
export type PendingInteractionKind = 'approval' | 'plan-review' | 'question'

/** The sessions face the controller needs for navigation awareness. */
export interface SessionsControllerFace {
  list: {
    getSnapshot(): {
      current: string | undefined
      /** Session ids in native list order (the workspace's own section order). */
      ids?: readonly string[]
      /**
       * List baseline readiness (the native face serves it; absent = an old
       * wiring or a fake — treated as ready, i.e. today's behavior). The
       * FIRST reconcile pass gates on it (see start): a pass against a
       * still-loading list sees no running sessions while the user watches
       * them run — the "刷新后进行中不点亮" race. Every later pass stays
       * subscription-driven.
       */
      phase?: 'pending' | 'ready'
      /** Host session list rows; used to judge whether an execution session finished. */
      byId: Record<string, {
        running: boolean
        /** User interaction the session is blocked on (approval / plan review / question). */
        pendingInteraction?: PendingInteractionKind
        /** The session's real workspace root, when the host recorded one. */
        cwd?: string
        /** The workspace id the host attributes the session to, when known. */
        workspaceId?: string
        /** Host "never started" flag (a blank session is a slot, not a conversation). */
        blank?: boolean
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
 * The workspaces face the controller needs: the registry's workspace rows
 * (id + title) for source labels, the run-config picker and drag
 * classification. A bound workspace still never surfaces sessions LIVE (see
 * linked-sessions.ts) — but the folder-drop snapshot DOES read membership,
 * once, at creation, from each row's `sessionIds`: the registry's OWN
 * ownership account (display order), never cwd/title guessing; absent = an
 * old host, fall back to the cwd scan. The registry-global ARCHIVE set is
 * read (archived conversations leave the card's session rows — see
 * taskSessionsOf).
 */
export interface WorkspacesControllerFace {
  list: {
    getSnapshot(): {
      items: readonly { id: string; title: string; sessionIds?: readonly string[] }[]
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
  'title' | 'description' | 'prompt' | 'promptImages' | 'promptFiles' | 'workspaceId' | 'provider' | 'model'
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
 * One history page the transcript reader serves: the raw events plus whether
 * the host holds EARLIER messages (`hasMore`) and the oldest seq covered
 * (`floorSeq`, for the next `beforeSeq` request). The tail and every earlier
 * page share this shape — the hook accumulates them oldest-first.
 */
export interface TranscriptPage {
  events: readonly TranscriptEventShape[]
  /** True when the host holds messages older than this page. */
  hasMore: boolean
  /** The oldest event seq covered by this page (undefined when empty). */
  floorSeq?: number
  /**
   * The host refused the page (no events): the wire error code (e.g.
   * `remote/unavailable` when the deployment serves no page endpoint).
   * Present = this page carries no data and must not move the window —
   * the hook turns it into the honest terminal sentence, never a retry
   * loop against an endpoint that does not exist.
   */
  refused?: string
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

/** The native cumulative token usage (the official `tokenUsage` projection:
 *  durable whole-log totals, independent of paged history windows). The four
 *  buckets are disjoint; reasoning tokens are already inside outputTokens. */
export interface TokenUsageShape {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** The native whole-log conversation figures (the official `sessionStats`
 *  projection): turn/step counts and wall times folded from the complete
 *  durable log — every field is 0 until its first contributing event lands. */
export interface SessionStatsShape {
  turns: number
  steps: number
  llmMs: number
  toolMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
}

/** The native current goal (the official `goal` projection, flattened):
 *  the durable snapshot plus its replay counters. `blockedReason` is present
 *  exactly while `phase` is `blocked`. A `complete` phase never surfaces
 *  (the official surface renders nothing for it — same rule here). */
export interface SessionGoalShape {
  id: string
  revision: number
  objective: string
  phase: 'active' | 'paused' | 'blocked' | 'complete'
  blockedReason?: { code: string; message: string }
  maxGoalRounds: number
  roundsStarted: number
  createdAt: number
  updatedAt: number
}

/** The projection slice the review page reads (the history tail page's block). */
export interface TranscriptProjectionsShape {
  contextPressure?: ContextPressureShape
  contextBreakdown?: ContextBreakdownShape
  permissions?: PermissionSelectShape
  /** The agent's whole todo list (the official `todos` projection, last-write
   *  wins); absent when the domain package/deployment does not serve it. */
  todos?: readonly SessionTodoShape[]
  /** Cumulative whole-log token usage; absent when the meter package is absent. */
  tokenUsage?: TokenUsageShape
  /** Whole-log turn/step figures; absent when the stats package is absent. */
  sessionStats?: SessionStatsShape
  /** The session's current goal (`null` = cleared/none); absent when the
   *  goal package is absent. */
  goal?: SessionGoalShape | null
}

/** The review-page transcript: the tail page plus the session's projection baseline. */
export interface TranscriptLoadResult {
  events: readonly TranscriptEventShape[]
  /** Whether the host holds messages older than this tail (the native "hasMore"). */
  hasMore: boolean
  /** The oldest event seq covered by this tail (undefined when empty). */
  floorSeq?: number
  /**
   * The follow opening's log cut (the page grammar's other half — every
   * earlier-page request threads it back as `throughSeq`). Absent when the
   * deployment's snapshot carries no cursor (then pages degrade to the
   * historic cut-less call).
   */
  throughSeq?: number
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
  /**
   * Schedule-preset persistence. Absent = the localStorage default (the
   * single-browser mode); the synced wiring injects a store over the shared
   * document so preset edits propagate to every replica.
   */
  presetStore?: import('./presets.ts').PresetStore
  /** Run-preset persistence; same synced/local split as {@link presetStore}. */
  runPresetStore?: import('./run-presets.ts').RunPresetStore
  /**
   * Applied-preset ledger (device-local display hint — which preset the
   * board last composed each session from). Absent = the localStorage
   * default. The host offers no preset read-back, so without this the
   * session's Agent row can only ever read "部署默认".
   */
  sessionAgentStore?: import('./session-agents.ts').SessionAgentStore
  /**
   * Template-library persistence (device-local like drafts — templates are
   * personal starters, not board truth). Absent = the localStorage default.
   */
  templateStore?: import('./task-templates.ts').TemplateStore
  /** Reads a session's recent history events (review-page transcript); absent = the page shows a hint. */
  transcript?: (sessionId: string) => Promise<TranscriptLoadResult | undefined>
  /** Reads one earlier history page backward from `beforeSeq` (the native
   *  "load earlier" grammar — the follow opening's `throughSeq` cut rides
   *  along; absent = the transcript shows the tail only). */
  transcriptPage?: (sessionId: string, beforeSeq: number, throughSeq?: number) => Promise<TranscriptPage | undefined>
  /** Reads one durable image back as base64 (the official `sessions.attachment`
   *  read — the host proves the session references the id). Absent = message
   *  images render as quiet placeholders. */
  loadImage?: (sessionId: string, attachmentId: string) => Promise<{ data: string; mediaType: string } | undefined>
  /** Stages one file's exact bytes on a session (the official file-lane
   *  pre-step: `fileUploads/upload` or the binary HTTP fallback). Absent =
   *  the file lane is closed (images only). */
  uploadFile?: (sessionId: string, file: File) => Promise<
    | { ok: true; receiptId: string }
    | { ok: false; error: string }
  >
  /**
   * The native goal service for one session's goal strip (the official
   * `remote.goals` verbs + the live binding's `goal` projection for the
   * call-time CAS ref + the `goal/activation-changed` subscription).
   * Absent = the goal strip stays read-only (legacy bridge text only).
   */
  goalService?: GoalServiceFace
  /** Session-config surface (review-page model/permission panel); absent = the panel degrades gracefully. */
  sessionConfig?: SessionConfigFace
  /** Sends one plain message directly to any native session (linked-session
   *  panel's composer — the host `sessions.prompt` endpoint; absent = the
   *  direct composer is disabled with a hint). This is deliberately NOT the
   *  task-execution path: it never creates execution records, never enters
   *  the dispatcher and never affects task state — it is exactly "typing in
   *  the native conversation". Images (temporary bytes) and files (staged
   *  receipts) ride the prompt content as the OFFICIAL parts — the host
   *  admits both, exactly like the native composer does.
   *  `mode` is the OFFICIAL prompt disposition: 'queue' (in order) or
   *  'steer' (interrupt the current turn now) — a 插话 is only a 插话 when
   *  the wire says so. */
  sessionMessage?: (sessionId: string, text: string, images?: readonly PromptImage[] | undefined, mode?: 'queue' | 'steer', files?: readonly PromptFile[] | undefined) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Executes one slash-command line against any native session through the
   *  host command registry (matched = recognized; unmatched = the caller
   *  falls back to sending the line as plain text). Absent = slash lines
   *  degrade to plain text. */
  sessionCommand?: (sessionId: string, line: string) => Promise<
    | { ok: true; matched: boolean; outcome?: { kind: 'success' | 'error'; text?: string } }
    | { ok: false; error: string }
  >
  /** The live pending-question tracker (the official uiSession mirror face):
 *  a read-only projection of the host's pending interactions — answering
 *  stays in the native session (the board navigates there). Absent = the
 *  interaction card degrades to the waiting banner (the native side still
 *  answers it). */
  questionRpc?: QuestionRpcFace
  /**
   * Relay one user-initiated launch to the engine (a non-engine replica's
   * Run button): the host forwards it to the lease holder, which runs it
   * through the ordinary pump (one pump = one concurrency budget = no
   * double launch). Absent = this controller never leaves the engine seat
   * (the single-browser/localStorage mode).
   */
  requestLaunch?: (taskId: string, trigger: RunTrigger) => void
  /** Force one seat re-read from the host (the engine-note dialog's
   *  「重新检查」): the wiring calls the sync client's lease renewal, whose
   *  seat announcement then flows back through setHostProto/setEngine.
   *  Absent = the button hides (fallback mode has no host to re-read). */
  seatRecheck?: () => Promise<void>
}

/** One image attached to a native prompt — the OFFICIAL `PromptContentPart`
 *  image shape: the browser submits temporary base64 bytes and the HOST
 *  performs the durable admission (promoting them to attachment refs). The
 *  board never admits images by itself; there is no second mechanism. */
export interface PromptImage {
  mediaType: string
  /** Canonical base64 of the image bytes (no data-URL prefix). */
  data: string
  name?: string
}

/** One file attached to a native prompt — the OFFICIAL `PromptContentPart`
 *  file shape: the browser stages the EXACT bytes first (same session) and
 *  the prompt carries only the opaque receipt. Files carry no admission
 *  limits; the stored object is the exact submitted bytes. */
export interface PromptFile {
  /** Opaque receipt from a preceding upload on the SAME session. */
  receiptId: string
  /** Display name (never an OS path). */
  name: string
  /** Exact byte size (shown, not gated). */
  bytes: number
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
  /** Engine-seat facts for the board's quiet honesty: whether THIS device is
   *  the engine, whether the board runs in synced mode at all, the host's
   *  lease protocol (1 = predates visibility preemption → a queued card may
   *  wait on a frozen device and nothing can be done from here; the board
   *  says so instead of leaving the user guessing), and when that host
   *  process booted (undefined = never read a lease) so the stale-host dialog
   *  can answer "我明明重启了" with a clock reading. */
  engine: { held: boolean; synced: boolean; hostProto: number; bootedAt: number | undefined }
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
    // The cruise seed reads through the ONE shared normalization grammar
    // (board-doc.normalizeCruiseValue) — the same function the host applies
    // to the synced section, so a persisted cruise value is judged
    // identically on every path.
    this.cruiseState = normalizeCruiseValue(deps.cruiseStorage?.read())
  }

  // --- lifecycle -------------------------------------------------------------

  /** Load the persisted ledger and start the navigation/status subscriptions. */
  start(): void {
    this.tasks = this.deps.store.load()
    // The first pass waits for the list baseline (the SAME gate as the
    // scheduler's first tick — one readiness discipline, not two): a pass
    // against a still-loading list sees no running sessions while the user
    // watches them run, and the miss is timing-shaped (sometimes the list
    // wins the race, sometimes the pass does). Absent phase = an old wiring
    // or a fake: treated as ready (exactly today's behavior, no stall).
    if (this.sessionsReady()) {
      void this.reconcileRunningTasks()
    } else {
      // One-shot: fire the first pass the moment the baseline lands, then
      // detach (later passes stay subscription-driven via onSessionsChanged).
      let fired = false
      const unsub = this.deps.sessions.list.subscribe(() => {
        if (this.disposed || fired) return
        if (this.sessionsReady()) {
          fired = true
          unsub()
          void this.reconcileRunningTasks()
        }
      })
      this.disposers.push(() => {
        if (!fired) {
          fired = true
          unsub()
        }
      })
    }
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

  /**
   * Take or yield the engine seat (the synced wiring calls this from the
   * host lease callback). Taking the seat immediately re-pumps the queue and
   * reconciles (catch-up for anything that came due while this replica was a
   * viewer); yielding it stops the pump (in-flight launches finish on their
   * own, and the new engine's reconcile picks up the rest).
   */
  setEngine(on: boolean): void {
    if (this.disposed || this.engine === on) return
    this.engine = on
    if (on) {
      void this.reconcileRunningTasks()
      this.dispatch()
    }
    this.notify()
  }

  /** Whether this replica currently holds the engine seat. */
  isEngine(): boolean {
    return this.engine
  }

  /**
   * Whether the native session list has served its baseline (absent phase =
   * ready — old wirings and fakes predate the flag and must not stall).
   */
  private sessionsReady(): boolean {
    return this.deps.sessions.list.getSnapshot().phase !== 'pending'
  }

  /**
   * Adopt a remotely-authored board view (the sync client's onRemote):
   * replace the ledger and cruise state, notify, and (engine only) re-pump.
   * Deliberately does NOT persist — this state came from the host, saving it
   * back would echo the commit. The controller's own newer-in-flight writes
   * are preserved by the sync client's dirty overlay before this is called.
   */
  applyRemote(view: import('./board-doc.ts').BoardView): void {
    if (this.disposed) return
    this.tasks = [...view.tasks]
    this.cruiseState = normalizeCruiseValue(view.cruise)
    this.notify()
    if (this.engine) this.dispatch()
  }

  // --- snapshot / subscription ------------------------------------------------

  getSnapshot(): ControllerSnapshot {
    return {
      tasks: this.tasks,
      boardOpen: this.boardOpen,
      selectedTaskId: this.selectedTaskId,
      cruise: { ...this.cruiseState },
      stats: { running: this.inFlightCount(), queued: this.queuedLaunches.length },
      engine: { held: this.engine, synced: this.syncActive, hostProto: this.hostProto, bootedAt: this.hostBootedAt },
    }
  }

  /** Whether multi-device sync is live (the wiring reports it once at boot);
   *  in fallback mode this device is always the engine and the lease story
   *  does not apply. */
  syncActive = false
  /** The host's engine-lease protocol version (the wiring mirrors it from the
   *  sync client on every seat announcement). 1 = pre-visibility host. The
   *  default is CURRENT on purpose: a replica that has not read a lease yet
   *  makes no claim, so a boot race can never flash a false stale banner. */
  hostProto = 2
  /** Which host process is answering (undefined = no lease read yet). The
   *  stale-host dialog shows it as a real time, so a user who DID restart the
   *  harness can tell at a glance whether this connection lands on that
   *  process or on a second, un-restarted instance behind the same URL. */
  hostBootedAt: number | undefined = undefined

  /** Mirror the host's boot instant into the snapshot (change → notify). */
  setHostBoot(bootedAt: number | undefined): void {
    if (this.hostBootedAt === bootedAt) return
    this.hostBootedAt = bootedAt
    this.notify()
  }

  /** Mirror the host's lease protocol into the snapshot (change → notify).
   *  A host restart moves the protocol WITHOUT moving the seat — the wiring
   *  calls this from the seat listener, so the stale-host banner clears live
   *  instead of surviving until the next manual refresh. */
  setHostProto(proto: number): void {
    if (this.hostProto === proto) return
    this.hostProto = proto
    this.notify()
  }

  /** Whether a live seat re-read is available (drives the dialog's
   *  「重新检查」 button — it hides in fallback mode, where there is no host
   *  to re-read). */
  canRecheckSeat(): boolean {
    return this.deps.seatRecheck !== undefined
  }

  /** Force one seat re-read from the host (the engine-note dialog's
   *  「重新检查」): the sync client renews the lease and its seat announcement
   *  flows back through setHostProto/setEngine, so a stale banner clears in
   *  the same tap once the host has actually restarted. A no-op when the
   *  wiring provides no re-read face. */
  recheckSeat(): Promise<void> {
    return this.deps.seatRecheck !== undefined ? this.deps.seatRecheck() : Promise.resolve()
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

  /**
   * The schedule-preset store every preset surface reads/writes: the synced
   * document section when multi-device sync is live, the localStorage default
   * otherwise. One accessor = one source of truth, never a re-`new` per
   * component (which would fork the synced state from the shared document).
   */
  presetStore(): import('./presets.ts').PresetStore {
    return this.deps.presetStore ?? new LocalStoragePresetStore()
  }

  /** The run-preset store (same single-source discipline as presetStore()). */
  runPresetStore(): import('./run-presets.ts').RunPresetStore {
    return this.deps.runPresetStore ?? new LocalStorageRunPresetStore()
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
   * The board's own session catalog (id + latest title, native list order):
   * the '@' MENU's second source for the sessions half. It is used when the
   * host's `candidates` half is unavailable — the gateway refuses the agent
   * lookup for subagent-routed (agent-busy) target sessions, which fails the
   * official discovery too; the board's catalog still lists every session,
   * and its rows carry the OFFICIAL mention text (see session-mention.ts),
   * so a picked row resolves through the host's pre-step parser exactly like
   * a host candidate.
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

  /** Read one earlier history page backward from `beforeSeq`. */
  loadTranscriptPage(sessionId: string, beforeSeq: number, throughSeq?: number): Promise<TranscriptPage | undefined> {
    return this.deps.transcriptPage?.(sessionId, beforeSeq, throughSeq) ?? Promise.resolve(undefined)
  }

  /** Read one durable message image back as base64 (official attachment read,
   *  cached + deduped by the wiring); undefined when unavailable. */
  loadImage(sessionId: string, attachmentId: string): Promise<{ data: string; mediaType: string } | undefined> {
    return this.deps.loadImage?.(sessionId, attachmentId) ?? Promise.resolve(undefined)
  }

  /**
   * Stage one file's exact bytes on a session (the official file-lane
   * pre-step): returns a stager bound to `sessionId`, or undefined when the
   * host serves no upload face. Receipts are per-Agent — a receipt minted
   * here MUST NOT cross sessions (the execution send layer re-stages by
   * name when a stored receipt is rejected).
   */
  uploadFile(sessionId: string): ((target: string, file: File) => Promise<
    | { ok: true; receiptId: string }
    | { ok: false; error: string }
  >) | undefined {
    const upload = this.deps.uploadFile
    if (upload === undefined) return undefined
    return (target: string, file: File) => upload(target === sessionId ? sessionId : target, file)
  }

  /** The session-config face (review page's model/permission panel), or undefined. */
  sessionConfig(): SessionConfigFace | undefined {
    return this.deps.sessionConfig
  }

  /**
   * The native goal verbs for one session's goal strip (official
   * `remote.goals` mutations with the call-time CAS ref), or undefined when
   * the host does not serve them — the strip then stays read-only.
   */
  goalVerbs(sessionId: string): GoalVerbs | undefined {
    const service = this.deps.goalService
    if (service === undefined) return undefined
    return verbsOf(service, sessionId)
  }

  /** The goal activation subscription (official `goal/activation-changed`), or undefined. */
  subscribeGoalActivation(
    sessionId: string,
    listener: (goal: GoalActivationChanged | undefined) => void,
  ): (() => void) | undefined {
    const service = this.deps.goalService
    if (service === undefined) return undefined
    return service.subscribeActivation(sessionId, listener)
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

  // --- pending native questions (official mirror) -----------------------------

  /** The open ask_user_question batch for a session (the interaction card's
   *  read-only source — answering stays in the native session). */
  questionPendingOf(sessionId: string | undefined): WireQuestion | undefined {
    return this.deps.questionRpc?.pendingOf(sessionId)
  }

  /** Subscribe to pending-question changes across sessions. */
  subscribeQuestions(listener: () => void): () => void {
    return this.deps.questionRpc?.subscribe(listener) ?? (() => {})
  }

  /** Whether the board can answer a pending question in place. Always false
   *  on 0.1.5: the waterfall is a claim chain (first answer wins), so the
   *  board never registers its own answerer — the card navigates to the
   *  native session instead. Kept so callers degrade structurally. */
  get questionAnswerInPlace(): boolean {
    return this.deps.questionRpc?.answerInPlace ?? false
  }

  /** Deliver one answer batch to the suspended ask (true = accepted). */
  answerQuestion(rpcId: string, sessionId: string, answers: readonly QuestionAnswerEntry[]): Promise<boolean> {
    return this.deps.questionRpc?.answer(rpcId, sessionId, answers) ?? Promise.resolve(false)
  }

  /** Reject the whole ask (the model sees ASK_CANCELLED and continues). */
  cancelQuestion(rpcId: string): Promise<boolean> {
    return this.deps.questionRpc?.cancel(rpcId) ?? Promise.resolve(false)
  }

  /** The session's real workspace root + composed agent preset.
   *
   *  Truth order (the "显示的必须是生效的" law): the host's served
   *  `summary.agentPreset` first (a future host may serve it — costs nothing
   *  to prefer), then the board's applied-preset ledger (what THIS board
   *  successfully composed the session from — the only source that knows
   *  today), else absent ("部署默认"). Reading the host field alone is how
   *  the row lied 100% of the time: the field is declared "when known" but
   *  no host serves it.
   */
  sessionInfo(sessionId: string | undefined): { cwd?: string; agentPreset?: string } | undefined {
    if (sessionId === undefined) return undefined
    const summary = this.deps.sessions.list.getSnapshot().byId[sessionId]
    if (summary === undefined) return undefined
    const applied = appliedPresetOf(this.deps.sessionAgentStore ?? new LocalStorageSessionAgentStore(), sessionId)
    const agentPreset = summary.agentPreset ?? applied
    return {
      ...summary.cwd !== undefined ? { cwd: summary.cwd } : {},
      ...agentPreset !== undefined ? { agentPreset } : {},
    }
  }

  /** The session's display title (native list summary), or undefined when the
   *  session is gone/unknown. Drives the execution row's identity slot.
   *
   *  A durable title equal to the workspace (project) BASENAME is the host's
   *  deterministic auto-name, not a real name — reported as undefined so the
   *  single 未命名 grammar shows 「未命名」 until a provider-generated or
   *  user-pinned title arrives (the recurring "不填标题却显示工作区名" bug).
   *  One judgment with the linked rows: both call `realTitleOf`. */
  sessionTitle(sessionId: string | undefined): string | undefined {
    if (sessionId === undefined) return undefined
    const row = this.deps.sessions.list.getSnapshot().byId[sessionId]
    return realTitleOf(row?.title, row?.cwd)
  }

  /** The localized 未命名 placeholder the session rows show for a session
   *  the host has not titled yet (set by the client wiring; undefined in
   *  tests = legacy task-title fallback). */
  untitledSessionLabel?: string

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

  /**
   * Mark every task (and every round) viewed — the notification center's
   * "全部标为已读". One write, one persist: read-state only moves forward
   * (see board-doc authorship), so a bulk clear never clobbers content.
   */
  markAllViewed(): void {
    const at = this.now()
    let changed = false
    this.tasks = this.tasks.map(task => {
      const executions = task.executions.map(round => {
        if (round.viewedAt === at) return round
        changed = true
        return { ...round, viewedAt: at }
      })
      if ((task.viewedAt ?? 0) >= at && executions.every((round, index) => round === task.executions[index])) {
        return task
      }
      changed = true
      return { ...task, viewedAt: Math.max(task.viewedAt ?? 0, at), executions }
    })
    if (changed) this.persistAndNotify()
  }

  /**
   * Mark ONE task (and its rounds) viewed without navigating — a triage row's
   * inline "标已读". Same monotone read-state law as `markAllViewed`, scoped
   * to a single record so the board stays where it is.
   */
  markTaskViewed(taskId: string): void {
    const at = this.now()
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId) return task
      const executions = task.executions.map(round => {
        if (round.viewedAt === at) return round
        changed = true
        return { ...round, viewedAt: at }
      })
      if ((task.viewedAt ?? 0) >= at && executions.every((round, index) => round === task.executions[index])) {
        return task
      }
      changed = true
      return { ...task, viewedAt: Math.max(task.viewedAt ?? 0, at), executions }
    })
    if (changed) this.persistAndNotify()
  }

  /**
   * Mark an explicit id set viewed (bulk triage of a filtered group). One
   * write, one persist; unknown ids are ignored.
   */
  markTasksViewed(taskIds: readonly string[]): void {
    if (taskIds.length === 0) return
    const wanted = new Set(taskIds)
    const at = this.now()
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (!wanted.has(task.id)) return task
      const executions = task.executions.map(round => {
        if (round.viewedAt === at) return round
        changed = true
        return { ...round, viewedAt: at }
      })
      if ((task.viewedAt ?? 0) >= at && executions.every((round, index) => round === task.executions[index])) {
        return task
      }
      changed = true
      return { ...task, viewedAt: Math.max(task.viewedAt ?? 0, at), executions }
    })
    if (changed) this.persistAndNotify()
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
   *
   * Workspace snapshot semantics: a workspace bind is a source association,
   * but at CREATION the card also snapshots the workspace's CURRENT live
   * sessions (visible, unarchived, non-blank) as explicit session binds —
   * the user dragged the folder "with what's in it", not an empty shell.
   * Later sessions never auto-join (no flooding); archived sessions leave
   * the rows at once (see linkedOf).
   * @param bind - the live binding.
   * @param input - title/description/prompt/landing column.
   * @returns the created task, or undefined for a bad bind.
   */
  createBoundTask(bind: TaskBind, input: NewTaskInput): TaskRecord | undefined {
    if (bind === undefined) return undefined
    const task = this.supplementedTask(createTask(input, this.now(), this.uuid(), this.nextOrder()))
    const binds = bind.kind === 'workspace'
      ? [bind, ...this.snapshotWorkspaceSessions(bind.workspaceId).map(sessionId => ({ kind: 'session' as const, sessionId }))]
      : [bind]
    const boundTask: TaskRecord = { ...task, binds }
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
   * The workspace's CURRENT live session snapshot for a folder drop.
   * Membership comes from the registry's OWN ownership account (`sessionIds`
   * on the workspace row, display order) — never cwd/title guessing across
   * the whole list (same-named folders elsewhere are not this workspace).
   * Only when the row carries no account (old host) does the legacy cwd scan
   * apply. Either way each candidate must be listed RIGHT NOW, unarchived
   * and non-blank; unknown ids (stale slots) are skipped, never guessed.
   * Pure derivation over the two snapshots (no I/O), so tests drive it with
   * fakes. Later sessions never join (snapshot, not subscription).
   */
  private snapshotWorkspaceSessions(workspaceId: string): string[] {
    const state = this.deps.sessions.list.getSnapshot()
    const workspaces = this.deps.workspaces?.list.getSnapshot()
    const archived = new Set(workspaces?.archivedSessionIds ?? [])
    const owned = workspaces?.items.find(item => item.id === workspaceId)?.sessionIds
    const seen = new Set<string>()
    const out: string[] = []
    let skippedArchived = 0
    let skippedBlank = 0
    let skippedUnknown = 0
    const take = (id: string): void => {
      const row = state.byId[id]
      if (row === undefined) {
        skippedUnknown += 1
        return
      }
      if (archived.has(id)) {
        skippedArchived += 1
        return
      }
      if (row.blank === true) {
        skippedBlank += 1
        return
      }
      if (seen.has(id)) return
      seen.add(id)
      out.push(id)
    }
    if (owned !== undefined) {
      for (const id of owned) take(id)
    } else {
      // Legacy host without the ownership account: scan by workspace signal.
      const order = state.ids ?? Object.keys(state.byId)
      for (const id of order) {
        const row = state.byId[id]
        if (row === undefined || !this.sessionInWorkspace(id, row, workspaceId)) {
          skippedUnknown += 1
          continue
        }
        take(id)
      }
    }
    // One named line per drop (the no-silent-drop law covers the snapshot
    // too — a "where did my sessions go / where did these come from" report
    // is answerable from this single line).
    console.info(
      `[dsh-task-board] workspace snapshot ${workspaceId}: took ${out.length} ` +
      `(archivedSet=${archived.size}, via=${owned !== undefined ? 'ownership' : 'cwd-scan'}, ` +
      `skipped: archived=${skippedArchived} blank=${skippedBlank} unknown-or-unmatched=${skippedUnknown})`,
    )
    return out
  }

  /** Whether a session row belongs to a workspace (cwd path or id match). */
  private sessionInWorkspace(id: string, row: { cwd?: string; workspaceId?: string }, workspaceId: string): boolean {
    if (row.workspaceId !== undefined && row.workspaceId !== '') return row.workspaceId === workspaceId
    const title = this.deps.workspaces?.list.getSnapshot().items.find(item => item.id === workspaceId)?.title
    if (row.cwd !== undefined && row.cwd !== '' && title !== undefined && title !== '') {
      const segment = row.cwd.split(/[\\/]+/).filter(Boolean).pop()
      if (segment === title) return true
    }
    // No workspace signal on the row: the list order is the workspace's own
    // sidebar section, so only an explicit match binds. Never guess by id.
    void id
    return false
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
    // The template keeps the card's SHAPE: the accent color and the prompt's
    // attached images ride along (both are part of how this card looks and
    // what its prompt says), but session rules do NOT — they are bound to the
    // source's own sessions ("给这个绘画会话定时发指令"), and the template is a
    // new card without them; copying them would silently automate sessions the
    // template does not own.
    task = {
      ...task,
      ...source.color !== undefined ? { color: source.color } : {},
      ...source.promptImages !== undefined && source.promptImages.length > 0
        ? { promptImages: source.promptImages.map(image => ({ ...image })) }
        : {},
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
   * The template library (named, reusable blueprints — see task-templates.ts).
   * Templates are device-local; the board document is untouched, so saving
   * and stamping never sync and never need a migration.
   */
  listTemplates(): import('./task-templates.ts').TaskTemplate[] {
    return (this.deps.templateStore ?? new LocalStorageTemplateStore()).load()
  }

  /**
   * Snapshot a task as a named template ("存为模板"). The name defaults to
   * the task's title (deduplicated with a numeric suffix); instance state
   * never rides along.
   * @param id - the source task.
   * @param name - the template label (blank = the task's title).
   * @returns the saved template, or undefined when the source is unknown.
   */
  saveTemplate(id: string, name?: string): import('./task-templates.ts').TaskTemplate | undefined {
    const source = this.tasks.find(task => task.id === id)
    if (source === undefined) return undefined
    const store = this.deps.templateStore ?? new LocalStorageTemplateStore()
    const taken = new Set(store.load().map(template => template.name))
    let label = (name ?? '').trim() === '' ? source.title.trim() : (name ?? '').trim()
    if (label === '') label = 'Untitled template'
    let candidate = label
    for (let n = 2; taken.has(candidate); n++) candidate = `${label} ${n}`
    const template = templateFromTask(source, this.uuid(), candidate)
    store.save([...store.load(), template])
    this.notify()
    return template
  }

  /** Delete one template by id (a no-op for unknown ids). */
  deleteTemplate(id: string): boolean {
    const store = this.deps.templateStore ?? new LocalStorageTemplateStore()
    const next = store.load().filter(template => template.id !== id)
    if (next.length === store.load().length) return false
    store.save(next)
    this.notify()
    return true
  }

  /**
   * Stamp a fresh 待规划 card from a template (content + run configuration;
   * schedule/rules never ride — arming is explicit on the new card).
   * @param id - the template id.
   * @returns the new task, or undefined for an unknown template.
   */
  instantiateTemplate(id: string): TaskRecord | undefined {
    const store = this.deps.templateStore ?? new LocalStorageTemplateStore()
    const template = store.load().find(candidate => candidate.id === id)
    if (template === undefined) return undefined
    const task = createTask(
      templateToNewInput(template),
      this.now(), this.uuid(), this.nextOrder(),
    )
    this.tasks = promoteToColumnTop([...this.tasks, task], task.id, task.status, this.now())
    this.persistAndNotify()
    return this.tasks.find(candidate => candidate.id === task.id) ?? task
  }

  /** Whether a session is natively archived (registry-global archive set).
   *  Absent workspaces face = nothing is known archived (degrade open). */
  private archivedOf(sessionId: string): boolean {
    const snap = this.deps.workspaces?.list.getSnapshot()
    return snap?.archivedSessionIds.includes(sessionId) === true
  }

  /**
   * The live linked-session rows of a task (pure derivation over the native
   * session snapshot; see linked-sessions.ts). ONLY explicit session binds
   * contribute — a workspace bind is a source association and surfaces no
   * session rows, so a chat created in the main UI never appears on a card
   * by itself. Dragging more session sources in ADDS to the set (same
   * session, one row).
   */
  linkedOf(task: TaskRecord): LinkedSessionRow[] {
    const binds = taskBindsOf(task)
    if (binds.length === 0) return []
    const byId = this.deps.sessions.list.getSnapshot().byId
    const rows: LinkedSessionRow[] = []
    const seen = new Set<string>()
    // Permanently removed sessions never re-derive — a deleted source must
    // stay deleted (hidden would still re-appear; removed cannot).
    const removed = task.removedSessions ?? []
    for (const bind of binds) {
      for (const row of deriveLinkedSessions(bind, {
        byId: byId as unknown as Readonly<Record<string, LinkedSessionSource>>,
        hidden: task.hidden?.sessions ?? [],
      })) {
        if (seen.has(row.sessionId) || removed.includes(row.sessionId) || this.archivedOf(row.sessionId)) continue
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
    this.userEdit(taskId, task => {
      const sessions = task.hidden?.sessions ?? []
      if (sessions.includes(sessionId)) return task
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
  }

  /** Restore every hidden session (the "恢复全部已隐藏" action). */
  unhideTaskSessions(taskId: string): void {
    this.userEdit(taskId, task => {
      if (task.hidden === undefined) return task
      const rest = { ...task }
      delete rest.hidden
      return rest
    })
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
      nativeRunningOf: sessionId => this.nativeRunningOf(sessionId),
      archivedOf: sessionId => this.archivedOf(sessionId),
      untitledLabel: this.untitledSessionLabel,
    })
  }

  /**
   * Reorder the task's 会话 list by dragging: the moved row lands BEFORE
   * `beforeId` (or at the end when undefined). The full current display order
   * is persisted as the manual order, so sessions that arrive later keep
   * landing at the TOP (the default newest-activity rule) until the user drags
   * them too. A USER-INTENT write: it bumps `updatedAt` like any edit (a
   * record carrying a new order but the old stamp used to lose the sync
   * merge — the two-device order drift this closes). @returns true when the
   * order changed.
   */
  reorderTaskSession(taskId: string, sessionId: string, beforeId: string | undefined): boolean {
    return this.userEdit(taskId, task => {
      const ids = taskSessionsOf(task, {
        linked: this.linkedOf(task),
        titleOf: sid => this.sessionTitle(sid),
        pendingInteractionOf: sid => this.pendingInteractionOf(sid),
        archivedOf: sid => this.archivedOf(sid),
        untitledLabel: this.untitledSessionLabel,
      }).map(row => row.sessionId)
      if (!ids.includes(sessionId)) return task
      const rest = ids.filter(id => id !== sessionId)
      let at = beforeId === undefined ? rest.length : rest.indexOf(beforeId)
      if (at < 0) at = rest.length
      const next = [...rest.slice(0, at), sessionId, ...rest.slice(at)]
      if (next.join() === ids.join()) return task
      return { ...task, sessionsOrder: next }
    })
  }

  /**
   * Create one fresh native session from a task's detail ("新建会话") and
   * bind it to the task: the session is created through the execution
   * service (composed with the given run configuration — the detail form's
   * fields), then joins the task's source set through {@link addTaskSource}
   * (persisted, additive, and instantly reconciled — the same path a sidebar
   * drag takes). The task itself is untouched: no execution record, no
   * dispatcher, no automation involvement. A config failure after the
   * session exists is an honest partial success: the session stays bound
   * and the error is surfaced for a retry of the config only.
   *
   * Title semantics (conflict-free by the native design): a non-blank title
   * is applied through the OFFICIAL user rename — it pins the title against
   * automatic regeneration, exactly as if typed in the native composer. A
   * blank title sends NOTHING: the host's automatic naming chain (first
   * user message → deterministic fallback + provider cadence) stays fully
   * intact, so an unnamed session names itself after the first real chat —
   * never a guessed placeholder that fights the native behavior. A rename
   * failure is a partial success too (the session exists); it is surfaced
   * as `titleError` alongside `configError`.
   * @param taskId - the task to bind the session to.
   * @param config - the run configuration (plus optional title) to compose
   *   the session with.
   * @returns the session id (+ optional configError/titleError), or
   *   ok:false with the creation error.
   */
  async createTaskSession(
    taskId: string,
    config: import('./execution.ts').SessionLaunchConfig & { title?: string },
  ): Promise<import('./execution.ts').SessionLaunchResult & { titleError?: string }> {
    if (this.deps.exec.createSession === undefined) {
      return { ok: false, error: 'session creation is unavailable' }
    }
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return { ok: false, error: 'unknown task' }
    const title = config.title?.trim() ?? ''
    const { title: _ignored, ...launchConfig } = config
    const result = await this.deps.exec.createSession(launchConfig)
    if (!result.ok) return result
    let titleError: string | undefined
    if (title !== '') {
      const renamed = await this.deps.exec.renameSession?.(result.sessionId, title)
      if (renamed !== undefined && !renamed.ok) titleError = renamed.error
    }
    this.addTaskSource(taskId, { kind: 'session', sessionId: result.sessionId })
    return { ...result, ...titleError !== undefined ? { titleError } : {} }
  }

  /**
   * Rename one of a task's native sessions ("会话行重命名"): the OFFICIAL
   * user-title write — the accepted title pins against automatic
   * regeneration, so the native sidebar, the board rows and every future
   * reload all read the same durable title (one truth, zero drift). A
   * blank title is rejected (the native rename contract normalizes empty
   * to invalid — a session cannot be UN-titled, only re-titled).
   * @param taskId - the task owning the session (an unknown task refuses).
   * @param sessionId - the native session to rename.
   * @param title - the new title (trimmed; blank = rejected).
   * @returns ok, or ok:false with an error string.
   */
  async renameTaskSession(taskId: string, sessionId: string, title: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const trimmed = title.trim()
    if (trimmed === '') return { ok: false, error: 'empty title' }
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return { ok: false, error: 'unknown task' }
    // The session must be a related session of THIS task (a run session,
    // a bound session, or a linked workspace member) — renaming through a
    // task the session does not belong to would be a confusing surface.
    const related = relatedSessionIdsOf(task, this.linkedOf(task).map(row => row.sessionId))
    if (!related.some(entry => entry.sessionId === sessionId)) {
      return { ok: false, error: 'session does not belong to this task' }
    }
    const renamed = await this.deps.exec.renameSession?.(sessionId, trimmed)
    if (renamed === undefined) return { ok: false, error: 'rename channel unavailable' }
    if (!renamed.ok) return renamed
    // The accepted title is already the list truth (the host folded a
    // session/title event); re-render rows and panels immediately.
    this.notify()
    return { ok: true }
  }

  /**
   * ADD a live source (a sidebar session or workspace folder) to an EXISTING
   * task — the "drag a folder/session into the open task's 会话 area" path.
   * NEVER replaces: an already-bound identical source is an idempotent no-op,
   * anything else joins the multi-source set. Persisted. A session bind
   * surfaces its session as a linked row; a workspace bind is a source
   * association only — it NEVER surfaces the folder's conversations (a chat
   * created in the main UI must not appear on a card by itself).
   *
   * An explicit re-add is also the RESTORE gesture: a session bind re-added
   * leaves the removed set (the hidden tray's 删除 is reversible BY THE
   * USER'S HAND — dragging the session back shows it again).
   * @returns true when the binding was added or anything was restored, false
   * for a pure no-op / unknown task.
   */
  addTaskSource(taskId: string, bind: TaskBind): boolean {
    const changed = this.userEdit(taskId, task => {
      const current = taskBindsOf(task)
      const isSame = current.some(existing => sameBind(existing, bind))
      const removed = task.removedSessions
      let next: TaskRecord = task
      let restored = false
      if (removed !== undefined && removed.length > 0) {
        const carried = this.sourceMemberIdsOf(bind)
        const kept = carried.length > 0
          ? removed.filter(id => !carried.includes(id))
          : removed
        if (kept.length !== removed.length) {
          restored = true
          next = { ...next }
          if (kept.length > 0) {
            next.removedSessions = kept
          } else {
            delete next.removedSessions
          }
        }
      }
      if (!isSame) {
        next = { ...next, binds: [...taskBindsOf(next), bind] }
      }
      return restored || !isSame ? next : task
    })
    if (changed) {
      // A newly added / restored source's state joins the card instantly.
      void this.reconcileBoundTask(taskId)
    }
    return changed
  }

  /** The sessions a re-added bind contributes to the display set: a session
   *  bind is itself (its removal is reversible by dragging it back); a
   *  workspace bind contributes none — it surfaces no session rows at all. */
  private sourceMemberIdsOf(bind: TaskBind): string[] {
    return bind.kind === 'session' ? [bind.sessionId] : []
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
    return this.userEdit(taskId, task => {
      const kept = task.executions.filter(round => round.sessionId !== sessionId)
      const wasHidden = task.hidden?.sessions?.includes(sessionId) === true
      if (kept.length === task.executions.length && !wasHidden) return task
      const removed = task.removedSessions ?? []
      const next: TaskRecord = {
        ...task,
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
  }

  /** Restore ONE hidden session (single-item restore; the bulk "恢复全部"
   *  stays available too — a folder's many hidden rows can be brought back
   *  one by one without restoring everything). */
  unhideTaskSession(taskId: string, sessionId: string): void {
    this.userEdit(taskId, task => {
      if (task.hidden === undefined) return task
      const sessions = (task.hidden.sessions ?? []).filter(id => id !== sessionId)
      const executions = (task.hidden.executions ?? []).filter(executionId =>
        task.executions.find(round => round.id === executionId)?.sessionId !== sessionId)
      if (sessions.length === (task.hidden.sessions?.length ?? 0)
        && executions.length === (task.hidden.executions?.length ?? 0)) return task
      const hidden: NonNullable<TaskRecord['hidden']> = {}
      if (sessions.length > 0) hidden.sessions = sessions
      if (executions.length > 0) hidden.executions = executions
      if (Object.keys(hidden).length === 0) {
        const rest = { ...task }
        delete rest.hidden
        return rest
      }
      return { ...task, hidden }
    })
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
    // Prompt attachments: a present key sets/clears the whole set (the form
    // owns the cap; an empty array clears the task's attachments). Images
    // and file refs ride side by side (two lanes, one set semantics).
    if ('promptImages' in patch) {
      applied.promptImages = patch.promptImages !== undefined && patch.promptImages.length > 0
        ? patch.promptImages.map(image => ({ ...image }))
        : undefined
    }
    if ('promptFiles' in patch) {
      applied.promptFiles = patch.promptFiles !== undefined && patch.promptFiles.length > 0
        ? patch.promptFiles.map(file => ({ ...file }))
        : undefined
    }
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
   * budget it consumes). The trigger kind is not read at drain time
   * (re-validation re-derives eligibility), so only the task id is kept.
   */
  private queuedLaunches: Array<{ taskId: string }> = []

  /** How many rounds are genuinely open right now (the concurrency truth).
   *  ROUNDS, not cards: the budget bounds how many conversations run at once,
   *  and one card may legitimately own several of them at the same time (its
   *  own run plus a comment injected into a second bound session). Counting
   *  cards made 「并行数 3」 silently mean 「三张卡，每卡一条」. */
  private inFlightCount(): number {
    let count = 0
    for (const task of this.tasks) count += openRoundsOf(task).length
    return count
  }

  /** Reentrancy guard for {@link dispatch} (launches notify → re-dispatch). */
  private dispatching = false
  private dispatchQueued = false
  private disposed = false

  /**
   * Whether THIS replica holds the engine seat (the host lease). The engine
   * is the only replica that drives time-based automation and launches:
   * scheduler ticks, the dispatch pump, reconciliation, external-turn
   * recording and the settle hand-offs. A non-engine replica still serves
   * user actions (its writes sync; a Run relays to the engine) and mirrors
   * remote state, but never pumps — so many open boards cannot double-fire.
   * Defaults to true: the single-browser/localStorage mode is always the
   * engine, and the synced wiring only ever lowers it after the host says so.
   */
  private engine = true

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
    // Only the engine pumps launches (one concurrency budget across every
    // open replica); a viewer's queued work waits for the engine to see it
    // through the synced ledger.
    if (!this.engine) return
    if (this.dispatching) {
      this.dispatchQueued = true
      return
    }
    this.dispatching = true
    this.dispatchQueued = false
    try {
      // 1. Queued schedule/chain launches (they were accepted while the
      // budget was full; their eligibility is re-checked on drain). The
      // attempt budget is the queue length at entry: an entry that must keep
      // waiting rotates to the back, and without this bound a rotation could
      // spin forever while the budget still has room.
      let attempts = this.queuedLaunches.length
      while (attempts-- > 0 && this.inFlightCount() < this.cruiseState.limit) {
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
    if (task === undefined || ruleReadiness(task).kind !== 'active' || !taskExecutable(task)) return true
    if (hasOpenRun(task)) {
      // A CHAIN link is different in kind from a cron fire: it is not "an
      // attempt that can be missed", it is the next link of a sequence the
      // user armed, and its run was already counted at the hand-off. With
      // per-session lanes a sibling conversation being busy is ordinary, so
      // dropping here would silently end the chain (and a counted-but-unrun
      // link can never come back after a reload). Keep it waiting — rotated to
      // the back so a card that stays busy cannot starve the others.
      if (task.schedule?.mode === 'chain') this.queuedLaunches.push(queued)
      return true
    }
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
    // THE LANE IS THE SESSION. A card may own several independent
    // conversations; a queued comment waits for ITS OWN session (and for the
    // comments submitted to that session before it), never for another
    // session's turn. Blocking on the card's column made a comment on an idle
    // second session wait until a completely unrelated conversation finished
    // — with the budget half empty and the cruise on.
    const head = (task: TaskRecord, rule: boolean): ExecutionRecord | undefined => {
      // A round that is in flight but has no session yet is a LANE BEING
      // ACQUIRED: a plain run resolves its session asynchronously (the
      // workspace's own session or a fresh one — see ExecutionService
      // connectSession). Until it is bound we cannot prove any lane is idle,
      // so the card admits no comment — an unknown lane is not a free lane.
      // This lasts milliseconds and the dispatcher re-pumps on the `started`
      // event.
      if (openRoundsOf(task).some(round => round.sessionId === undefined)) return undefined
      // One candidate per LANE: the earliest saved-but-un-injected round of
      // each session. A busy lane contributes nothing — but it must never
      // silence the card's OTHER lanes (returning early here is how an idle
      // session's comment stayed queued behind an unrelated conversation).
      // ONE ordered queue per lane, whatever wrote the round: the lane's
      // earliest saved round decides what runs next. Filtering by kind BEFORE
      // looking at the lane let a rule instruction saved later jump a user
      // comment already waiting on that same conversation — two queues on one
      // session, which is exactly the ordering this model is meant to keep.
      const laneHead = new Map<string, ExecutionRecord>()
      for (const round of task.executions) {
        if (round.comment === undefined || round.sessionId === undefined) continue
        if (round.injectedAt !== undefined || round.endedAt !== undefined) continue
        if (round.external === true) continue
        const ahead = laneHead.get(round.sessionId)
        if (ahead === undefined || round.startedAt < ahead.startedAt) laneHead.set(round.sessionId, round)
      }
      let best: ExecutionRecord | undefined
      for (const [sessionId, round] of laneHead) {
        // The other lane's turn: this session's next word belongs to the other
        // kind (comments and rule instructions share one queue per session).
        if ((round.ruleId !== undefined) !== rule) continue
        // A session that is mid-turn takes its next comment only after that
        // turn settles — one conversation at a time, in submission order.
        if (sessionIsBusy(task, sessionId)) continue
        if (best === undefined || round.startedAt < best.startedAt) best = round
      }
      return best
    }
    const scan = (rule: boolean): { kind: 'comment'; task: TaskRecord; round: ExecutionRecord } | undefined => {
      let best: { kind: 'comment'; task: TaskRecord; round: ExecutionRecord } | undefined
      for (const task of this.tasks) {
        if (task.status === 'done') continue
        const round = head(task, rule)
        if (round !== undefined && (best === undefined || round.startedAt < best.round.startedAt)) {
          best = { kind: 'comment', task, round }
        }
      }
      return best
    }
    // 规则轮走自己的车道（自动化车道）：cron 排队轮与 on-complete 循环轮都是
    // ruleId 标记的可观察轮——自动化的回合永不等待板级巡航（用户手写评论仍是
    // 巡航门控的普通留言，见下面的 cruise 分支）。车道内严格按提交时间 FIFO +
    // 全局预算：同一瞬间到点的很多规则只会一个个按序注入（插话规则由
    // fireOnCompleteRules 先入队——完成时刻插话先发，之后不再跳队——绝不
    // 饿死排队规则，也绝无瞬时齐发）。
    const ruleRound = scan(true)
    if (!this.cruiseState.enabled) return ruleRound
    // Comments and pickups only flow while the cruise is on; without it,
    // comments stay saved and todo tasks stay idle.
    const best = ruleRound ?? scan(false)
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
   * {@link dispatch}, after eligibility was validated — or by a session
   * rule with `send: 'steer'`, which injects immediately (the same watched
   * round, only the handoff is now instead of the FIFO lane).
   */
  private launchComment(task: TaskRecord, round: ExecutionRecord, mode: 'queue' | 'steer' = 'queue'): void {
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
      mode,
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
   * A manual run is not a prerequisite for an armed rule: arming activates
   * the schedule at once (see setSchedule), so auto triggers drive the task
   * on their own — this door merely reports whether THIS launch was accepted.
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
    // A non-engine replica never launches locally: it relays the request to
    // the engine (the host forwards it to the lease holder), so the single
    // pump and its concurrency budget stay the only source of launches. The
    // run is "accepted" — the engine's ledger write will surface it here.
    if (!this.engine) {
      if (this.deps.requestLaunch === undefined) return false
      this.deps.requestLaunch(id, trigger)
      return true
    }
    // The 缺则补 supplement applies at the ONE launch door (launchTask).
    if (trigger === 'manual' || this.inFlightCount() < this.cruiseState.limit) {
      this.launchTask(task)
      return true
    }
    if (!this.queuedLaunches.some(candidate => candidate.taskId === id)) {
      this.queuedLaunches.push({ taskId: id })
    }
    return true
  }

  /**
   * Continue an armed chain schedule after a settle: persist the incremented
   * counter (disarming after the final budgeted run) and start the next run.
   * The judgment is the CARD's own plain runs, not "the last row" — under
   * per-session lanes a comment or a native turn can be the newest record
   * while the card's execution finished earlier.
   *
   * Every attempt is guarded three ways: the card must be quiet (no lane in
   * flight), its last PLAIN run must have SUCCEEDED (失败不续), and the global
   * budget must have a free slot. Any of those failing defers the hand-off
   * without consuming a run — and because the derivation is re-read from the
   * ledger, the next settle or the scheduler's recovery tick picks it up again
   * instead of losing the link.
   */
  private maybeContinueChain(id: string): void {
    const task = this.tasks.find(candidate => candidate.id === id)
    const schedule = task?.schedule
    if (schedule === undefined || !schedule.enabled || schedule.mode !== 'chain') return
    if (task === undefined) return
    // WAIT while any lane of this card is still working. A chain link is the
    // card's own next run — it must not stack on a sibling conversation (the
    // per-session lanes make that possible now, and the runTask busy guard
    // would simply drop the link, silently losing one iteration). Every settle
    // and the scheduler's recovery tick re-attempt, so a deferred hand-off is
    // never lost: once the card goes quiet, the last PLAIN run decides.
    if (hasOpenRun(task)) return
    const runs = plainRunsOf(task)
    const latest = runs[runs.length - 1]
    // Only a succeeded plain run hands off; refinement (preparation) and
    // comment/native rounds are not the card's own execution completing.
    if (latest === undefined || latest.endedAt === undefined || latest.result !== 'succeeded') return
    if (schedule.maxRuns !== undefined && schedule.runCount >= schedule.maxRuns) return
    // A hand-off already waiting for a slot IS this link: counting again (and
    // queueing again, which the dedup below swallows) would burn budget runs
    // on a card whose sibling lanes keep settling. The pending entry is the
    // record that this succeeded run has already been handed off.
    if (this.queuedLaunches.some(candidate => candidate.taskId === id)) return
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
   * Related-session labels of a task (for the composer's @ mention): the
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

  /** The attachment-carrying twin of steerComment: images (temporary bytes)
   *  and files (staged receipts) ride the same direct-send path as text. */
  steerCommentWithImages(
    taskId: string,
    sessionId: string,
    text: string,
    images: readonly PromptImage[] | undefined,
    files?: readonly PromptFile[] | undefined,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const trimmed = text.trim()
    if (trimmed === '' && (images === undefined || images.length === 0) && (files === undefined || files.length === 0)) {
      return Promise.resolve({ ok: false, error: 'empty message' })
    }
    // A steer on a completed task revives it (moved back to 待办) — the same
    // rule as the queued comment paths: the message drives the task.
    this.reviveTaskIfDone(taskId)
    // A steer is a human message — never gated by the task's execution prompt
    // (that gate belongs to task execution only); the blank-message rejection
    // above is the one guard.
    return this.sendRawMessage(sessionId, trimmed, images, 'steer', files).then(result => {
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
    const created = this.userEdit(taskId, task => {
      if (task.rules?.some(candidate => candidate.sessionId === input.sessionId) === true) return task
      return withSessionRules(task, [...(task.rules ?? []), rule])
    })
    return created ? rule : undefined
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
    return this.userEdit(taskId, task => {
      if (task.rules === undefined) return task
      let touched = false
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
        touched = true
        return updated
      })
      return touched ? withSessionRules(task, rules) : task
    })
  }

  /** Toggle a session rule's enabled state (the row's live switch). */
  toggleSessionRule(taskId: string, ruleId: string, enabled: boolean): void {
    this.userEdit(taskId, task => {
      if (task.rules === undefined) return task
      const current = task.rules
      const rules = current.map(rule => rule.id === ruleId ? { ...rule, enabled } : rule)
      if (!rules.some((rule, index) => rule !== current[index])) return task
      return withSessionRules(task, rules)
    })
  }

  /** Remove a session rule. */
  deleteSessionRule(taskId: string, ruleId: string): void {
    this.userEdit(taskId, task => {
      if (task.rules === undefined) return task
      const rules = task.rules.filter(rule => rule.id !== ruleId)
      if (rules.length === task.rules.length) return task
      return withSessionRules(task, rules)
    })
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
        // ONE due instant, ONE round. A queue-mode rule instruction that is
        // still waiting (its session is busy — the common case now that a lane
        // can be held by a long conversation) already honours this due slot;
        // appending another copy every minute would stack identical
        // instructions onto the same session. Roll the schedule forward
        // instead — the same one-in-flight discipline the on-complete loop
        // enforces in `fireRuleRound`.
        if (task.executions.some(round => round.ruleId === rule.id && round.endedAt === undefined)) {
          const rolled = nextSessionRuleAt(rule)
          rule.lastAt = now
          rule.nextAt = rolled ?? rule.nextAt
          rule.enabled = rolled === undefined ? false : rule.enabled
          taskChanged = true
          continue
        }
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
   *  Attachments are durable refs appended to the message content (images =
   *  temporary bytes, files = staged receipts); `mode` is the official
   *  prompt disposition (queue / steer). */
  private sendRawMessage(sessionId: string, text: string, images?: readonly PromptImage[], mode: 'queue' | 'steer' = 'queue', files?: readonly PromptFile[]): Promise<{ ok: true } | { ok: false; error: string }> {
    const direct = this.deps.sessionMessage
    if (text.startsWith('/')) {
      const command = this.deps.sessionCommand
      if (command !== undefined) {
        return command(sessionId, text).then(result => {
          if (!result.ok) return { ok: false as const, error: result.error }
          if (result.matched) return { ok: true as const }
          // Unknown command: the native default-sink — deliver the line as
          // plain text (never drop a user's input), attachments still ride.
          if (direct === undefined) return { ok: false as const, error: 'direct message unavailable' }
          return direct(sessionId, text, images, mode, files)
        })
      }
    }
    if (direct === undefined) return Promise.resolve({ ok: false, error: 'direct message unavailable' })
    return direct(sessionId, text, images, mode, files)
  }

  // --- comments ---------------------------------------------------------------

  /**
   * Save a comment continuation against a settled execution: a new comment
   * round is appended (same session, not yet injected) and the task stays in
   * place. Comments are a per-SESSION FIFO queue — the lane is the
   * conversation: any number may be saved, and the shared dispatcher injects
   * them one at a time into THAT session (a session takes its next comment
   * only after its current round settles), while other sessions of the same
   * card keep running independently. The in-flight budget bounds how many
   * sessions run across the board. Injection only happens while the
   * auto-cruise is on; without it the comments stay saved (and cancellable)
   * until the cruise drives the board. A completed task cannot be commented
   * (its work is done); every other state can — a comment for a session that
   * is busy queues for when that session settles.
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
  submitComment(taskId: string, executionId: string, text: string, command = false, images?: readonly PromptImage[], files?: readonly PromptFile[]): ExecutionRecord | undefined {
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
      ...(images !== undefined && images.length > 0 ? { images } : {}),
      ...(files !== undefined && files.length > 0 ? { files } : {}),
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
  submitSessionComment(taskId: string, sessionId: string, text: string, command = false, images?: readonly PromptImage[], files?: readonly PromptFile[]): ExecutionRecord | undefined {
    const trimmed = text.trim()
    if (trimmed === '') return undefined
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return undefined
    if (task.status === 'done') this.reviveTaskIfDone(taskId)
    return this.queueRuleComment(taskId, sessionId, trimmed, command, undefined, undefined, images, files)
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
  private queueRuleComment(taskId: string, sessionId: string, text: string, command = false, ruleId?: string, injectedAt?: number, images?: readonly PromptImage[], files?: readonly PromptFile[]): ExecutionRecord | undefined {
    const trimmed = text.trim()
    if (trimmed === '') return undefined
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return undefined
    if (task.status === 'done') this.reviveTaskIfDone(taskId)
    const round = {
      ...newCommentRound({
        id: this.uuid(),
        now: this.now(),
        text: trimmed,
        command,
        sessionId,
        sessionAnchor: sessionId,
        ...ruleId !== undefined ? { ruleId } : {},
        ...(images !== undefined && images.length > 0 ? { images } : {}),
        ...(files !== undefined && files.length > 0 ? { files } : {}),
      }),
      // A STEER rule round is born already-injected: it is handed to the
      // session immediately, so the dispatcher must NEVER see it as a fresh
      // queue entry (the persist below triggers a dispatch pass — marking
      // FIRST is what makes the steer launch single-shot).
      ...injectedAt !== undefined ? { injectedAt } : {},
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
    // An all-blank task has no requirement to research (the refine
    // instruction is built from title/description/prompt) — launching would
    // burn a run and light the card for nothing. The UI disables the entry
    // with the same judgment; this is the backstop, never the messenger.
    if (!refinable(task)) return false
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
  answerRefine(taskId: string, text: string, images?: readonly PromptImage[], files?: readonly PromptFile[]): boolean {
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
      // Freshly-attached answer attachments ride THIS round's prompt (the
      // refine session's own prompt images belong to the original
      // instruction).
      ...(images !== undefined && images.length > 0 ? { images } : {}),
      ...(files !== undefined && files.length > 0 ? { files } : {}),
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
   *  one clamp: the floor/ceiling live in board-doc bounds — writes clamp,
   *  reads normalize, one pair everywhere. */
  setCruiseLimit(limit: number): void {
    const clamped = Math.min(MAX_CRUISE_LIMIT, Math.max(CRUISE_LIMIT_MIN, Math.floor(limit)))
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
    if (!this.engine) return
    const next = tickSchedule(this.cruiseState, now)
    if (next === this.cruiseState) return
    const turnedOn = next.enabled && !this.cruiseState.enabled
    this.cruiseState = next
    this.deps.cruiseStorage?.write(this.cruiseState)
    if (turnedOn) this.dispatch()
    this.notify()
  }

  private handleExecutionEvent(event: ExecutionEvent): void {
    // Late events (a run settling after the board unmounted/disposed) must
    // never mutate the closed controller — no state writes after teardown.
    if (this.disposed) return
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
    // Automation hand-offs are engine-only: a replica that lost the seat
    // mid-run still settles its own watch (idempotent, persisted), but the
    // new engine's reconcile carries the chain/automation forward.
    if (this.engine) this.maybeContinueChain(event.taskId)
    this.persistAndNotify()
    // A settled plain TASK RUN is the on-complete appointment for the task's
    // session rules. Comment rounds carry `comment`, refine rounds carry
    // `refine: true` — neither is a task run, so an on-complete rule can
    // never re-trigger itself through its own queued comment's settle (no
    // send loops). Fired after the persist so the rule bookkeeping layers on
    // the settled object.
    if (this.engine) this.settledFollowUp(settledRound, event.taskId, event.outcome)
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
    // A STEER rule round is born injected (see queueRuleComment) — the
    // dispatcher can never race it; the explicit launch below is the ONE
    // handoff. A queue rule waits for dispatch as before.
    const round = this.queueRuleComment(
      task.id, rule.sessionId, text, text.trimStart().startsWith('/'), rule.id,
      rule.send === 'steer' ? this.now() : undefined,
    )
    if (round === undefined) return
    this.tasks = this.tasks.map(candidate => candidate.id === task.id
      ? withSessionRules(candidate, (candidate.rules ?? []).map(candidateRule =>
        candidateRule.id === rule.id ? { ...candidateRule, lastAt: this.now() } : candidateRule))
      : candidate)
    this.persistAndNotify()
    if (rule.send === 'steer') {
      const current = this.tasks.find(candidate => candidate.id === task.id)
      const currentRound = current?.executions.find(candidate => candidate.id === round.id)
      if (current !== undefined && currentRound !== undefined) {
        this.launchComment(current, currentRound, 'steer')
      }
    }
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
    const next = settleExecution(task, executionId, outcome, this.now(), error)
    // Permanent settle diagnostic: every "finished but landed in the wrong
    // column" dispute ends here (which round, what outcome, which column).
    if (next !== task) {
      console.info(`[dsh-task-board] settled task=${task.id} round=${executionId} outcome=${outcome} ${task.status}->${next.status}${error !== undefined ? ` error=${error}` : ''}`)
    }
    return next
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

  /** One entry per card (the steer round whose completion was already
   *  reported), replaced on the next steer — bounded by the card count. */
  private readonly directFallbackRounds = new Map<string, string>()

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
   *  running baselines per session, when external rounds were created, and
   *  which sessions' CURRENT run periods are already consumed. */
  private readonly activityBook: ActivityBook = { running: new Map(), externalSince: new Map(), recorded: new Set() }
  /** Latest wake stamp per session (see recordActivityWake): a stamp advance
   *  is a turn the status edge may have missed — the next reconcile pass
   *  re-checks the session even when its running flag did not move. */
  private readonly activityWake = new Map<string, number>()
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
    // Reconciliation (settle + external-turn recording) is the engine's job;
    // a viewer's UI still refreshes from the synced ledger + session list.
    if (!this.engine) return
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

  /** The delivery watchdog deadline: an OPEN round whose session has produced
   *  no turn evidence and has sat idle this long is a round that never
   *  reached the agent (a lost inject, a session that vanished mid-flight).
   *  Left open it would hold a concurrency slot AND swallow every future
   *  native turn of that session (hasOpenRoundOn gates external recording),
   *  which is why 「行亮进行中、卡片永远不动」 used to recur forever. The
   *  watchdog releases it as cancelled, and external detection re-arms. */
  private static readonly OPEN_ROUND_WATCHDOG_MS = 3 * 60_000

  /**
   * The watchdog verdict for one open round: a synthetic `cancelled` settle
   * when the round is past the deadline and its session is NOT running (or
   * gone), undefined while any evidence could still arrive (still connecting,
   * session still working, deadline not reached). Never judges a round whose
   * session is actively working — a long run is not a zombie.
   */
  private zombieRoundEvent(task: TaskRecord, execution: ExecutionRecord): Extract<ExecutionEvent, { kind: 'settled' }> | undefined {
    // Age the round from when its WORK began, not from when it was written
    // down: a saved comment has legitimately waited (a long same-session
    // conversation ahead of it is normal on a lane model), and timing the
    // deadline from the save would cancel it seconds after a real injection,
    // before the session's `running` flip ever reached the list snapshot.
    const since = execution.injectedAt ?? execution.startedAt
    if (this.now() - since <= BoardController.OPEN_ROUND_WATCHDOG_MS) return undefined
    if (execution.sessionId === undefined) {
      // A round that NEVER GOT A SESSION (the page died between launching the
      // run and its `started` event) is the one case with nothing to wait on:
      // no session can be running, no turn evidence can arrive, and the
      // delivery watch is gone with the previous page. Under per-session
      // lanes an unbound round behind the newest row would otherwise wedge the
      // card forever — 进行中, holding a budget slot, refusing every drop and
      // re-run, with no sweeper that could see it.
      return { kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'cancelled', error: 'run never reached a session' }
    }
    const summary = this.deps.sessions.list.getSnapshot().byId[execution.sessionId]
    if (summary?.running === true) return undefined
    if (summary !== undefined && summary.pendingInteraction !== undefined) return undefined // waiting on a human is evidence
    return { kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'cancelled', error: 'no turn evidence' }
  }

  /** Settle tasks left 'running' whose sessions already finished. */
  private async reconcileRunningTasks(): Promise<void> {
    if (this.disposed || this.reconcileInFlight || !this.engine) return
    this.reconcileInFlight = true
    this.reconcilePending = false
    try {
      // Stage 0 — native-activity detection: a related session flipping to
      // `running` with no board-owned open round is an out-of-band turn (the
      // user chatted in the native UI). It is recorded as an external round
      // and drives the card state, so the board mirrors the native reality.
      let changed = await this.scanExternalActivity()

      // Stage 0.5 — live-state drive for eventless paths: a direct steer's
      // round is settled at birth, so its only signal is the native session's
      // running flip. While the agent works the task must show 进行中; once
      // the session stops, the steer's completion lands in 待审核 through
      // the SAME post-settle appointments as any completion. Linked ids ride
      // along so a bound workspace's live members count toward the state.
      const linkedIds = this.tasks.map(task => ({ task, ids: this.linkedOf(task).map(row => row.sessionId) }))
      if (this.driveLiveStates(linkedIds)) changed = true

      // Stage 1 — reconcile every task with an open round worth settling:
      // running tasks (plain runs, comment rounds, external rounds) plus any
      // task with an open refinement round (refinement keeps its column).
      // An open round is ALSO swept wherever its card now sits: a manual drag
      // out of 进行中 must never orphan it — a zombie round holds a
      // concurrency slot and (via hasOpenRoundOn) swallows every FUTURE
      // native turn of its session, the exact "行亮着、卡片永远不动" machine.
      type Settled = Extract<ExecutionEvent, { kind: 'settled' }>
      const events: Array<{ taskId: string; round: ExecutionRecord | undefined; event: Settled; externalText: string | undefined }> = []
      for (const task of this.tasks) {
        // EVERY open round, not just the newest one: a card can have several
        // sessions in flight, and a round that is not the last record would
        // otherwise never be swept — it would hold its slot forever.
        for (const execution of openRoundsOf(task)) {
          const drivable = task.status === 'running' || execution.refine === true
          if (!drivable) {
            // Parked card with an open round: no history read (nothing is
            // expected to produce evidence), only the watchdog decides.
            const zombie = this.zombieRoundEvent(task, execution)
            if (zombie !== undefined) events.push({ taskId: task.id, round: execution, event: zombie, externalText: undefined })
            continue
          }
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
          const event = await this.deps.exec.reconcile(task, execution.id)
          // A dispose may land while the history read is in flight — a dead
          // controller must never keep settling into a dropped ledger.
          if (this.disposed) return
          if (event !== undefined && event.kind === 'settled') {
            // Only the backfill TEXT is read here; it lands on the CURRENT
            // record in Stage 2 (a remote apply may have rewritten the row
            // while these reads were in flight — a stale snapshot is never
            // written over a newer one, the reconcileBoundTask discipline).
            const externalText = await this.externalTextIfNeeded(task, event.executionId)
            events.push({ taskId: task.id, round: execution, event, externalText })
            this.activeExecutionIds.delete(event.executionId)
          } else {
          // No turn evidence at all: the delivery watchdog releases the round
          // once its session has sat idle past the deadline (a message that
          // never reached the agent must not hold the queue hostage forever).
          const zombie = this.zombieRoundEvent(task, execution)
          if (zombie !== undefined) events.push({ taskId: task.id, round: execution, event: zombie, externalText: undefined })
        }
        }
      }

      // Stage 2 — apply the settled rounds (refine rounds keep the column),
      // re-reading each record at write time so mid-await changes survive.
      const continued: string[] = []
      const applied: Array<{ round: ExecutionRecord | undefined; event: Settled }> = []
      for (const { taskId, round, event, externalText } of events) {
        const current = this.tasks.find(candidate => candidate.id === taskId)
        if (current === undefined) continue
        const next = this.settleRound(current, event.executionId, event.outcome, event.error)
        if (next === current) continue
        const settled = externalText === undefined ? next : {
          ...next,
          executions: next.executions.map(candidate => candidate.id === event.executionId
            && candidate.external === true
            && (candidate.comment === undefined || candidate.comment === '')
            ? { ...candidate, comment: externalText }
            : candidate),
        }
        this.tasks = this.tasks.map(candidate => candidate.id === taskId ? settled : candidate)
        changed = true
        continued.push(taskId)
        applied.push({ round, event })
      }
      // A reconciled settle hands off to the next chained run like a live one
      // (the chain request precedes the persist so the freed slot is
      // booked before any comment/cruise work competes for it).
      //
      // ENGINE-ONLY, re-checked HERE: the reads above await, and the seat can
      // move to another device while they run (the lease follows visibility).
      // Applying a settle we have evidence for stays (idempotent — the new
      // engine's pass no-ops on an ended round), but a dethroned replica must
      // never LAUNCH: that is how one completion becomes two runs once several
      // lanes can be in flight on the same card.
      if (this.engine) {
        for (const id of continued) this.maybeContinueChain(id)
      }

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
        // Same rule as the chain hand-off above: automation fires on ONE
        // engine, never on a replica that lost the seat mid-pass.
        if (!this.engine) return
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

  /**
   * Drive task status from the native live state for EVENTLESS rounds only:
   * a direct steer (插话) is settled at birth — no turn/end settle event
   * exists — so its life is entirely the session's running flip. When the
   * agent works, the task joins 进行中 (like any real execution); when the
   * session stops, the steer's completion is a completion: it lands in
   * 待审核 and goes through the SAME settledFollowUp appointment (on-complete
   * rules, chain hand-off) as a watched settle. Board-open rounds and
   * refine/external rounds keep their own event paths; this pass never
   * settles anything twice (isDirectLike is only true for already-settled
   * direct rounds, and the fallback fires exactly once — status was
   * 'running' before the transition).
   */
  private driveLiveStates(linked?: ReadonlyArray<{ task: TaskRecord; ids: readonly string[] }>): boolean {
    const byId = this.deps.sessions.list.getSnapshot().byId
    const linkedIdsOf = (taskId: string): readonly string[] | undefined =>
      linked?.find(entry => entry.task.id === taskId)?.ids
    let changed = false
    for (const task of this.tasks) {
      // The newest direct-like round, WHEREVER it sits: a steer round is
      // settled at birth, so any later row (a saved comment on another lane,
      // an observed native turn) pushes it off the end of the array. Reading
      // only the last record stranded the card in 「进行中」 with nothing
      // running once lanes could interleave rows — and its completion (the
      // on-complete appointment below) vanished with it.
      const latest = newestDirectLike(task)
      if (latest === undefined) continue
      const live = taskLiveStateOf(
        task,
        sessionId => byId[sessionId]?.running === true,
        sessionId => byId[sessionId]?.pendingInteraction,
        linkedIdsOf(task.id),
      )
      const now = this.now()
      if (live === 'running') {
        if (task.status !== 'running') {
          this.tasks = promoteToColumnTop(
            this.tasks.map(candidate => candidate.id === task.id ? withStatus(candidate, 'running', now) : candidate),
            task.id,
            'running',
            now,
          )
          changed = true
        }
      } else if (live === 'idle' && task.status === 'running' && !hasOpenRun(task)) {
        // Demote only when NOTHING of this card is in flight any more: with
        // per-session lanes the steered conversation can finish while another
        // session of the same card is still working, and yanking the card out
        // of 进行中 then would lie about the lanes that remain.
        //
        // One completion per steer round, ever. `newestDirectLike` searches the
        // whole history, so a stale steer could otherwise re-fire the
        // on-complete appointment on a later running→idle edge (an automation
        // firing for a completion that already completed). The column check
        // above makes this an edge, not a level; this makes it idempotent.
        if (this.directFallbackRounds.get(task.id) === latest.id) continue
        this.directFallbackRounds.set(task.id, latest.id)
        const next = withStatus(task, DIRECT_FALLBACK_STATUS, now)
        this.tasks = this.tasks.map(candidate => candidate.id === task.id ? next : candidate)
        changed = true
        if (!this.disposed) this.settledFollowUp(latest, task.id, 'succeeded')
      }
    }
    return changed
  }

  /** THE live-state question for one task (card breathing source): waiting >
   *  running > idle — same single derivation for every surface. The related
   *  set is the task's OWN sessions (refine + explicit binds + execution
   *  rounds; a workspace bind contributes none), so the card and its rows
   *  always answer the same question from the same set. */
  liveStateOf(taskId: string): TaskLiveState {
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return 'idle'
    const byId = this.deps.sessions.list.getSnapshot().byId
    return taskLiveStateOf(
      task,
      sessionId => byId[sessionId]?.running === true,
      sessionId => byId[sessionId]?.pendingInteraction,
      this.linkedOf(task).map(row => row.sessionId),
    )
  }

  /** Whether one session is genuinely running right now (the native truth). */
  nativeRunningOf(sessionId: string): boolean {
    return this.deps.sessions.list.getSnapshot().byId[sessionId]?.running === true
  }

  /**
   * Every related session of a task (de-duplicated, refine first) — THE one
   * derivation from task-live.ts, consumed by the external-activity scanner,
   * the bound-task reconcile and the '@' reference scoping. The controller
   * only supplies the linked ids (explicit session binds); everything else
   * (binds, execution rounds, refine session) is pure task shape.
   */
  private relatedSessionsOf(task: TaskRecord): Array<{ sessionId: string; refine: boolean }> {
    return relatedSessionIdsOf(task, this.linkedOf(task).map(row => row.sessionId))
  }

  /** The ids of every session already RELATED to a task (binds, execution
   *  rounds, the refine session, live linked members) — the single source for
   *  "do not offer this session again". The add-session picker filters on this,
   *  so a refine session (which the old hand-rolled bind+execution set missed)
   *  never shows as a re-bindable candidate. */
  relatedSessionIdSet(task: TaskRecord): Set<string> {
    return new Set(this.relatedSessionsOf(task).map(row => row.sessionId))
  }

  /**
   * Detect out-of-band activity on related sessions (see session-activity.ts)
   * and record external rounds: the round enters the session's comment thread,
   * a non-refine round moves the card to 「进行中」, a refine round keeps the
   * column but turns `refining` on. The round body is the user's native
   * message text captured at observation (so the thread shows what was said)
   * and the round carries the message's seq as its TURN ANCHOR — the dedup
   * key shared with the live frame channel (recordNativeTurn), so the same
   * native turn can never be recorded twice, by either channel, on either
   * device. Returns whether anything changed.
   */
  private async scanExternalActivity(): Promise<boolean> {
    const byId = this.deps.sessions.list.getSnapshot().byId
    const now = this.now()
    // Wake stamps consume on read — one wake schedules one re-check, and a
    // restart re-primes from the live list instead of replaying.
    const woken = new Set<string>()
    for (const sessionId of this.activityWake.keys()) {
      this.activityWake.delete(sessionId)
      if (byId[sessionId] === undefined) continue
      woken.add(sessionId)
    }
    const candidates = this.tasks.map(task => ({
      taskId: task.id,
      candidate: {
        sessions: this.relatedSessionsOf(task),
        hasOpenRoundOn: (sessionId: string): boolean => sessionIsBusy(task, sessionId),
        inBoardTurnOn: (sessionId: string): boolean => this.inBoardTurnOn(task, sessionId, now),
      },
    }))
    const turns = detectExternalTurns(candidates, this.activityBook, byId)
    let changed = false
    for (const turn of turns) {
      const msg = await this.userMessageOf(turn.sessionId)
      if (this.disposed) return changed
      if (this.recordExternalRound(turn.taskId, turn.sessionId, turn.refine, msg)) changed = true
    }
    // Wake evidence: a woken session re-checks through the transcript tail
    // even when the running flag did not move — a turn that started AND
    // finished between two passes (or arrived while the flag already read
    // running) is invisible to the state rule above. The write path is the
    // same anchor-deduped one, so a turn the state rule already recorded is
    // never doubled; board-owned turns stay suppressed by the same guards.
    for (const sessionId of woken) {
      if (turns.some(turn => turn.sessionId === sessionId)) continue
      const related: Array<{ taskId: string; refine: boolean }> = []
      for (const task of this.tasks) {
        const candidate = this.relatedSessionsOf(task).find(entry => entry.sessionId === sessionId)
        if (candidate !== undefined) related.push({ taskId: task.id, refine: candidate.refine })
      }
      if (related.length === 0) continue
      const msg = await this.userMessageOf(sessionId)
      if (this.disposed) return changed
      for (const { taskId, refine } of related) {
        if (this.recordExternalRound(taskId, sessionId, refine, msg)) changed = true
      }
    }
    return changed
  }

  /** Whether the session's CURRENT turn is already board-owned: the live
   *  direct-send grace, or a direct round the board recorded for this same
   *  running period (persisted-startAt window — survives a reload, where the
   *  in-memory grace alone would let a long direct turn be double-recorded). */
  private inBoardTurnOn(task: TaskRecord, sessionId: string, now: number): boolean {
    if (withinGrace(this.directGraceUntil.get(sessionId), now)) return true
    return task.executions.some(round =>
      round.direct === true && round.sessionId === sessionId && now - round.startedAt <= DIRECT_GRACE_MS)
  }

  /**
   * The ONE external-round write (both detection channels land here): append
   * the round to the CURRENT record (anchor-dedup re-checked at write time —
   * a stale snapshot is never written over a newer one), drive the card into
   * 「进行中」 (a refine round keeps its column), promote to the column top and
   * persist. @returns whether the ledger actually moved.
   */
  private recordExternalRound(
    taskId: string,
    sessionId: string,
    refine: boolean,
    msg: LatestUserMessage | undefined,
  ): boolean {
    const now = this.now()
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId) return task
      // Re-check every guard on the CURRENT record (the transcript read and
      // the live frame both await; another channel may have recorded meanwhile).
      // "Busy" here is the SAME lane judgment the dispatcher uses: a round is
      // in the way only when it is actually WORKING. A comment that is merely
      // saved-and-queued must never swallow a native turn — the user chatting
      // in the workspace is real activity that belongs in the thread, and the
      // queued comment then waits for it (one session, in order).
      if (sessionIsBusy(task, sessionId)) return task
      if (msg?.anchor !== undefined && task.executions.some(round => round.sessionId === sessionId && round.anchor === msg.anchor)) return task
      if (this.inBoardTurnOn(task, sessionId, now)) return task
      changed = true
      const withRound: TaskRecord = {
        ...task,
        updatedAt: now,
        executions: [...task.executions, newExternalRound({
          id: this.uuid(),
          now,
          sessionId,
          refine,
          ...msg?.text !== undefined ? { text: msg.text } : {},
          ...msg?.anchor !== undefined ? { anchor: msg.anchor } : {},
          ...msg !== undefined && msg.text === undefined && msg.hasImage ? { imageOnly: true } : {},
        })],
      }
      return refine || withRound.status === 'running' ? withRound : { ...withRound, status: 'running' }
    })
    if (!changed) return false
    this.activityBook.externalSince.set(sessionId, now)
    if (!refine) this.tasks = promoteToColumnTop(this.tasks, taskId, 'running', now)
    this.persistAndNotify()
    return true
  }

  /**
   * The legacy live-turn channel: the live frame of a native `user/message`
   * (wired by the client on hosts that still serve it). A turn that starts
   * AND finishes between two reconcile passes can no longer be missed — the
   * frame arrives the instant the user chats. Engine-only (one recorder;
   * replicas get the round through the synced ledger) and idempotent
   * against the state backstop via the persisted turn anchor. On 0.1.5 the
   * legacy stream is gone and `recordActivityWake` is the live channel; both
   * land on the same write path.
   */
  recordNativeTurn(sessionId: string, turn: LatestUserMessage): void {
    if (this.disposed || !this.engine) return
    let related = false
    for (const task of this.tasks) {
      const candidate = this.relatedSessionsOf(task).find(entry => entry.sessionId === sessionId)
      if (candidate === undefined) continue
      related = true
      // The live frame IS the turn: consume the session's run period (the
      // state backstop must not fire for it again) and baseline it running.
      this.activityBook.recorded.add(sessionId)
      this.recordExternalRound(task.id, sessionId, candidate.refine, turn)
    }
    if (related) this.activityBook.running.set(sessionId, true)
  }

  /**
   * The 0.1.5 wake channel: the host's `api-session/activity` event (or the
   * equivalent list `updatedAt` advance) fired for a durable user message.
   * The wake carries no text and no anchor — it only records the stamp and
   * schedules a reconcile pass, which reads the transcript tail for the
   * facts and lands on the same anchor-deduped write path. Engine-only like
   * the legacy frame channel (a viewer never schedules engine work — the
   * lease holder's pass reads the synced ledger); a stale (non-advancing)
   * stamp never re-schedules. Consumed stamps clear when read so a restart
   * re-primes from the live list instead of replaying history.
   */
  recordActivityWake(sessionId: string, stamp: number): void {
    if (this.disposed || !this.engine) return
    if (!Number.isFinite(stamp)) return
    const previous = this.activityWake.get(sessionId)
    if (previous !== undefined && stamp <= previous) return
    this.activityWake.set(sessionId, stamp)
    this.scheduleReconcile()
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

  /** The backfill text for an external round settling with an empty body
   *  (legacy records / an observation that missed the text); undefined when
   *  there is nothing to fill. The text lands on the CURRENT record at write
   *  time (Stage 2), never on a pre-await snapshot. */
  private async externalTextIfNeeded(task: TaskRecord, executionId: string): Promise<string | undefined> {
    const execution = task.executions.find(round => round.id === executionId)
    if (execution === undefined || execution.external !== true) return undefined
    if (execution.comment !== undefined && execution.comment !== '') return undefined
    return await this.userTextOf(execution.sessionId)
  }

  /**
   * Instant state sync for an ACTIVE binding: right after a session is
   * dragged in / created / picked (createBoundTask / addTaskSource /
   * createTaskSession), evaluate its live state — a related session that is
   * running RIGHT NOW gets an open external round and the card jumps to
   * 「进行中」 immediately (its completion later settles to 「待审核」 through
   * the ordinary reconcile), and the new content turns the card unviewed
   * (breathing glow / 「新」) just like native activity. Baselines are set
   * for every related session here too, so the state backstop keeps working
   * from this point on. Idempotent: the shared write path re-checks the
   * open-round and turn-anchor guards at write time — a session with a round
   * for this turn is never double-recorded.
   */
  private async reconcileBoundTask(taskId: string): Promise<void> {
    const task = this.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) return
    const byId = this.deps.sessions.list.getSnapshot().byId
    const now = this.now()
    // The instant-sync facts captured before any await.
    let runningSessionId: string | undefined
    let runningRefine = false
    // Running sessions the instant sync leaves behind (lane-busy, or past
    // the one-record instant grant below): NOT consumed — the scheduled
    // pass after this records them through the normal channel.
    let leftover = false
    for (const session of this.relatedSessionsOf(task)) {
      const current = byId[session.sessionId]?.running ?? false
      this.activityBook.running.set(session.sessionId, current)
      if (!current) {
        this.activityBook.recorded.delete(session.sessionId)
        continue
      }
      // Identity veto (this turn IS board-owned): consume, never fire.
      if (this.inBoardTurnOn(task, session.sessionId, now)) {
        this.activityBook.recorded.add(session.sessionId)
        continue
      }
      // Coverage veto (the lane is held right now) or the one-record
      // instant grant already spent: leave the period UNCONSUMED — the turn
      // must fire when the veto lifts, and a consumed-but-unfired period
      // never re-arms until idle (the "card never lights" machine: THE lane
      // judgment, shared with the dispatcher and the external recorder: a
      // merely-SAVED comment on this session is not a round in flight, so it
      // must never veto the instant sync of a turn the user is running right
      // now — the round is recorded below, and the period is consumed here;
      // vetoing it silently dropped that native turn: no thread entry, card
      // never jumped to 「进行中」).
      if (runningSessionId !== undefined || sessionIsBusy(task, session.sessionId)) {
        leftover = true
        continue
      }
      runningSessionId = session.sessionId
      runningRefine = session.refine
      this.activityBook.recorded.add(session.sessionId)
    }
    // Leftover running turns re-enter through the scheduled pass (engine-gated
    // no-op for viewers — the engine's own notifications drive its passes).
    if (leftover) this.scheduleReconcile()
    if (runningSessionId === undefined) return
    const msg = await this.userMessageOf(runningSessionId)
    // A dispose may land while the transcript read is in flight — a dead
    // controller must never keep writing into a dropped ledger.
    if (this.disposed) return
    if (!this.recordExternalRound(taskId, runningSessionId, runningRefine, msg)) return
    // Unviewed on purpose: this external round is brand-new content the
    // user has not seen (it happened before/while they bound it).
    this.tasks = this.tasks.map(candidate =>
      candidate.id === taskId ? { ...candidate, viewedAt: now - 1 } : candidate)
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
      // EVERY open external round: with per-session lanes a later row (a
      // steer, a second conversation's round) used to hide a noisy first one,
      // leaving the card stranded or letting the history sweep settle it
      // optimistically on some OLDER turn's `turn/end` — a false completion
      // that then fired the on-complete appointment.
      for (const latest of openRoundsOf(task)) {
        const sessionId = latest.sessionId
        if (latest.external !== true || sessionId === undefined) continue
        const summary = byId[sessionId]
        const since = this.activityBook.externalSince.get(sessionId) ?? latest.startedAt
        if (summary?.running === true || now - since <= EXTERNAL_SETTLE_GRACE_MS) continue
        const next = this.settleRound(task, latest.id, 'cancelled', undefined)
        if (next !== task) {
          this.tasks = this.tasks.map(candidate => candidate.id === task.id ? next : candidate)
          changed = true
        }
      }
    }
    return changed
  }

  /**
   * THE funnel for USER-INTENT ledger edits: a mutation returning a new
   * record always carries a fresh `updatedAt` — the sync merge ranks edits by
   * that stamp and the card shows it as 更新于, so forgetting a bump becomes
   * structurally impossible (the class of bug where hide / rule edits were
   * silently swallowed on other replicas dies here). Engine-derived writes
   * (settle, external rounds, nextAt ticks) and read-state writes (viewedAt)
   * deliberately do NOT route through this funnel — they own their own
   * freshness semantics. @returns whether the ledger moved.
   */
  private userEdit(taskId: string, mutate: (task: TaskRecord) => TaskRecord): boolean {
    let changed = false
    this.tasks = this.tasks.map(task => {
      if (task.id !== taskId) return task
      const next = mutate(task)
      if (next === task) return task
      changed = true
      return { ...next, updatedAt: this.now() }
    })
    if (changed) this.persistAndNotify()
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