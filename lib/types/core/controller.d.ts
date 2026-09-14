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
import { ExecutionService } from './execution.ts';
import { type LinkedSessionRow } from './linked-sessions.ts';
import { type LatestUserMessage } from './session-activity.ts';
import { type TaskLiveState } from './task-live.ts';
import { type TaskSessionRow } from './session-list.ts';
import type { QuestionAnswerEntry, QuestionRpcFace, WireQuestion } from './question-rpc.ts';
import { type GoalActivationChanged, type GoalServiceFace, type GoalVerbs } from './goal-verbs.ts';
import type { TaskStore } from './store.ts';
import type { SkipLedger } from './scheduler.ts';
import { type ExecutionRecord, type NewTaskInput, type ScheduleMode, type TaskBind, type TaskRecord, type TaskStatus } from './tasks.ts';
/** Default auto-cruise concurrency when the user has not configured one. */
export declare const DEFAULT_CRUISE_LIMIT = 5;
/** The concurrency budget's real ceiling — the shared board-doc bound (writes
 *  clamp and reads normalize to one pair). Re-exported so board surfaces
 *  keep importing it from the controller. */
export declare const MAX_CRUISE_LIMIT = 20;
/** The native session-list "waiting for the user" signal (sidebar amber dot). */
export type PendingInteractionKind = 'approval' | 'plan-review' | 'question';
/** The sessions face the controller needs for navigation awareness. */
export interface SessionsControllerFace {
    list: {
        getSnapshot(): {
            current: string | undefined;
            /** Session ids in native list order (the workspace's own section order). */
            ids?: readonly string[];
            /**
             * List baseline readiness (the native face serves it; absent = an old
             * wiring or a fake — treated as ready, i.e. today's behavior). The
             * FIRST reconcile pass gates on it (see start): a pass against a
             * still-loading list sees no running sessions while the user watches
             * them run — the "刷新后进行中不点亮" race. Every later pass stays
             * subscription-driven.
             */
            phase?: 'pending' | 'ready';
            /** Host session list rows; used to judge whether an execution session finished. */
            byId: Record<string, {
                running: boolean;
                /** User interaction the session is blocked on (approval / plan review / question). */
                pendingInteraction?: PendingInteractionKind;
                /** The session's real workspace root, when the host recorded one. */
                cwd?: string;
                /** The workspace id the host attributes the session to, when known. */
                workspaceId?: string;
                /** Host "never started" flag (a blank session is a slot, not a conversation). */
                blank?: boolean;
                /** The agent preset the session's agent was composed from, when known. */
                agentPreset?: string;
                /** The session's display title, when the host recorded one (execution-row identity). */
                title?: string;
            }>;
        };
        subscribe(fn: () => void): () => void;
    };
    /** Whether a session still exists in the host session list. */
    exists(id: string): boolean;
    /** Select a session as current (navigates the conversation view). */
    open(id: string): void;
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
            items: readonly {
                id: string;
                title: string;
                sessionIds?: readonly string[];
            }[];
            archivedSessionIds: readonly string[];
        };
        subscribe(fn: () => void): () => void;
    };
}
/** One workspace row the new-task form can target. */
export interface WorkspaceRow {
    id: string;
    title: string;
}
/** One reasoning effort a model advertises. */
export interface EffortRow {
    id: string;
    name?: string;
}
/** One model row inside a provider group. */
export interface ModelRow {
    id: string;
    name?: string;
    efforts: readonly EffortRow[];
}
/** One provider group of the host model catalog. */
export interface ModelGroupRow {
    provider: string;
    models: readonly ModelRow[];
}
/** One agent preset the new-task form can target. */
export interface AgentPresetRow {
    /** Preset id (also the directory name). */
    id: string;
    /** Display name the preset published, absent when it published none. */
    name?: string;
    /** One sentence on what the preset is for. */
    description?: string;
    /** Whether a session that names no preset gets this one. */
    isDefault?: boolean;
}
/** One permission preset the new-task form can target (the host's native preset table). */
export interface PermissionRow {
    /** Preset machine value (the key the `/permission` command accepts). */
    id: string;
    /** Display name the preset published, absent when it published none. */
    name?: string;
    /** One sentence on what the preset means. */
    description?: string;
}
/** One slash-menu candidate for the prompt autocomplete (command or skill). */
export interface SlashCandidate {
    /** Name without the leading slash (the user types `/name`). */
    name: string;
    /** Human-readable summary. */
    description: string;
    /** Free-form input hint; commands with one take an argument (trailing space). */
    hint?: string;
    /** Skill entries rank after commands and always insert with a trailing space. */
    kind: 'command' | 'skill';
}
/** Optional run-catalog face feeding the new-task form's run-configuration selects. */
export interface RunCatalogFace {
    listWorkspaces(): readonly WorkspaceRow[];
    listModelGroups(): Promise<readonly ModelGroupRow[]>;
    /** Agent presets the deployment composes (absent = the host has no roster). */
    listAgentPresets(): Promise<readonly AgentPresetRow[]>;
    /**
     * Permission presets the deployment advertises through its native
     * permission service; undefined = the capability is unavailable (no
     * permission service composed, or the catalog fetch failed) and the form
     * hides the permission selector.
     */
    listPermissions(): Promise<readonly PermissionRow[] | undefined>;
    /**
     * Slash-menu candidates for the prompt autocomplete, straight from the
     * native sources the composer's '/' menu merges: host commands (the live
     * command registry) plus skills (the skill catalog, one entry per skill
     * name). undefined = no session to scope the catalog to; individual
     * sources degrade to empty when their fetch fails. Nothing is hard-coded,
     * so registry/catalog changes show up without a plugin update.
     */
    listSlashCandidates(): Promise<readonly SlashCandidate[] | undefined>;
}
/** One file/directory candidate of the OFFICIAL `@file` discovery (the
 *  `remote.fileReferences.list` result row). Structural — no SDK import. */
export interface ReferenceFileCandidate {
    kind: 'file' | 'directory';
    path: string;
}
/** One session candidate of the OFFICIAL session-reference discovery (the
 *  `remote.sessionReferenceResolver.candidates` result row). Structural —
 *  no SDK import. `mention` is the canonical `@[label](dsh-session:…)`
 *  prompt text, pre-serialized by the host. */
export interface ReferenceSessionCandidate {
    sessionId: string;
    label: string;
    cwd?: string;
    createdAt: number;
    mention: string;
}
/** The structural face of the two Remote namespaces behind the OFFICIAL '@'
 *  reference source (the harness's ui-reference calls exactly these). */
export interface ReferenceRemoteFace {
    fileReferences?: {
        list(sessionId: string, query: string, signal: AbortSignal): Promise<{
            ok: true;
            value: readonly ReferenceFileCandidate[];
        } | {
            ok: false;
            error: unknown;
        }>;
    };
    sessionReferenceResolver?: {
        candidates(sessionId: string, query: string, signal: AbortSignal): Promise<{
            ok: true;
            value: readonly ReferenceSessionCandidate[];
        } | {
            ok: false;
            error: unknown;
        }>;
    };
}
/** The editable slice of a task (content + run configuration). */
export type TaskUpdatePatch = Partial<Pick<TaskRecord, 'title' | 'description' | 'prompt' | 'promptImages' | 'promptFiles' | 'workspaceId' | 'provider' | 'model' | 'reasoningEffort' | 'agentPreset' | 'permission' | 'color'>>;
/** The auto-cruise state: the current on/off truth, the last manual intent,
 *  concurrency, and the scheduled windows that flip it at their boundaries
 *  (see cruise.ts — `enabled` IS the truth: manual toggles set it directly
 *  and never touch the schedule; window start/end instants flip it and take
 *  over from the manual intent; expired windows prune). */
export interface CruiseState {
    enabled: boolean;
    /** Last explicit manual intent (true=手动开, false=手动关); undefined = none yet. */
    manual?: boolean;
    limit: number;
    /** Scheduled windows `[startAt?, endAt?]`; empty = no auto schedule. */
    schedule: import('./cruise.ts').CruiseWindow[];
}
/** Persistence seam for the cruise state (localStorage in the browser). */
export interface CruiseStorageFace {
    read(): Partial<CruiseState> | undefined;
    write(state: CruiseState): void;
}
/** Raw session-history event (the structural slice the review page folds). */
export interface TranscriptEventShape {
    type: string;
    seq?: number;
    time?: number;
    data?: unknown;
}
/**
 * One history page the transcript reader serves: the raw events plus whether
 * the host holds EARLIER messages (`hasMore`) and the oldest seq covered
 * (`floorSeq`, for the next `beforeSeq` request). The tail and every earlier
 * page share this shape — the hook accumulates them oldest-first.
 */
export interface TranscriptPage {
    events: readonly TranscriptEventShape[];
    /** True when the host holds messages older than this page. */
    hasMore: boolean;
    /** The oldest event seq covered by this page (undefined when empty). */
    floorSeq?: number;
    /**
     * The host refused the page (no events): the wire error code (e.g.
     * `remote/unavailable` when the deployment serves no page endpoint).
     * Present = this page carries no data and must not move the window —
     * the hook turns it into the honest terminal sentence, never a retry
     * loop against an endpoint that does not exist.
     */
    refused?: string;
}
/**
 * The native context-pressure projection (see dsh-token-meter): provider
 * sample, its projection forward over surface movement, and the route
 * capacity. Narrowed structurally; absent keys mean the value is not known
 * yet (capability absence is key absence).
 */
export interface ContextPressureShape {
    pressureTokens?: number;
    projectedTokens?: number;
    contextWindow?: number;
}
/** The native context-composition projection: heuristic system/tools/messages split. */
export interface ContextBreakdownShape {
    systemTokens: number;
    toolsTokens: number;
    messageTokens: number;
}
/** One permission-preset option the session's select can switch to (native PermissionSelect). */
export interface PermissionOptionShape {
    value: string;
    name: string;
    description?: string;
}
/** The session's real permission select (native `permissions` projection): the
 *  effective current value plus the switchable options — the authority the
 *  review page's permission switcher must read (the task card's permission
 *  field only configures the next fresh run). */
export interface PermissionSelectShape {
    options: readonly PermissionOptionShape[];
    currentValue: string;
}
/** The native todo item shape (the official `todos` projection's row — the
 *  same `TodoItem` the harness's own TodoPanel renders; read structurally so
 *  future reshapes degrade, never crash). */
export interface SessionTodoShape {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}
/** The native cumulative token usage (the official `tokenUsage` projection:
 *  durable whole-log totals, independent of paged history windows). The four
 *  buckets are disjoint; reasoning tokens are already inside outputTokens. */
export interface TokenUsageShape {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
/** The native whole-log conversation figures (the official `sessionStats`
 *  projection): turn/step counts and wall times folded from the complete
 *  durable log — every field is 0 until its first contributing event lands. */
export interface SessionStatsShape {
    turns: number;
    steps: number;
    llmMs: number;
    toolMs: number;
    ttftMs: number;
    ttftSteps: number;
    decodeMs: number;
    decodeTokens: number;
}
/** The native current goal (the official `goal` projection, flattened):
 *  the durable snapshot plus its replay counters. `blockedReason` is present
 *  exactly while `phase` is `blocked`. A `complete` phase never surfaces
 *  (the official surface renders nothing for it — same rule here). */
export interface SessionGoalShape {
    id: string;
    revision: number;
    objective: string;
    phase: 'active' | 'paused' | 'blocked' | 'complete';
    blockedReason?: {
        code: string;
        message: string;
    };
    maxGoalRounds: number;
    roundsStarted: number;
    createdAt: number;
    updatedAt: number;
}
/** The projection slice the review page reads (the history tail page's block). */
export interface TranscriptProjectionsShape {
    contextPressure?: ContextPressureShape;
    contextBreakdown?: ContextBreakdownShape;
    permissions?: PermissionSelectShape;
    /** The agent's whole todo list (the official `todos` projection, last-write
     *  wins); absent when the domain package/deployment does not serve it. */
    todos?: readonly SessionTodoShape[];
    /** Cumulative whole-log token usage; absent when the meter package is absent. */
    tokenUsage?: TokenUsageShape;
    /** Whole-log turn/step figures; absent when the stats package is absent. */
    sessionStats?: SessionStatsShape;
    /** The session's current goal (`null` = cleared/none); absent when the
     *  goal package is absent. */
    goal?: SessionGoalShape | null;
}
/** The review-page transcript: the tail page plus the session's projection baseline. */
export interface TranscriptLoadResult {
    events: readonly TranscriptEventShape[];
    /** Whether the host holds messages older than this tail (the native "hasMore"). */
    hasMore: boolean;
    /** The oldest event seq covered by this tail (undefined when empty). */
    floorSeq?: number;
    /**
     * The follow opening's log cut (the page grammar's other half — every
     * earlier-page request threads it back as `throughSeq`). Absent when the
     * deployment's snapshot carries no cursor (then pages degrade to the
     * historic cut-less call).
     */
    throughSeq?: number;
    /** Native projection values riding the history tail page; absent when the deployment has no registry. */
    projections?: TranscriptProjectionsShape;
}
/** The live model selection of one execution session (native `sessions.models`). */
export interface SessionModelChoice {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/** One selectable reasoning effort of a model route. */
export interface SessionEffortRow {
    id: string;
    name?: string;
}
/** One selectable model route (with its reasoning efforts). */
export interface SessionModelRow {
    id: string;
    name?: string;
    reasoning?: {
        efforts: readonly SessionEffortRow[];
        defaultEffort?: string;
    };
}
/** One provider group of the session's model directory. */
export interface SessionModelGroup {
    provider: string;
    models: readonly SessionModelRow[];
}
/** What the review page's session-config panel needs from the runtime. */
export interface SessionConfigFace {
    /** The session's current selection + selectable directory (native models API). */
    readModels(sessionId: string): Promise<{
        current: SessionModelChoice;
        groups: readonly SessionModelGroup[];
    } | undefined>;
    /** Apply a new model selection to the session (native selectModel API). */
    selectModel(sessionId: string, selection: SessionModelChoice): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    /** Apply a permission preset through the native `/permission` command. */
    setPermission(sessionId: string, permission: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
}
/** Controller dependencies (all swappable in tests). */
export interface ControllerDeps {
    store: TaskStore;
    exec: ExecutionService;
    sessions: SessionsControllerFace;
    /** Optional workspaces face (workspace-bound "链接会话" derivation + live refresh). */
    workspaces?: WorkspacesControllerFace;
    /** Optional run-catalog surface (workspace/model pickers in the new-task form). */
    runCatalog?: RunCatalogFace;
    /**
     * Optional official reference bridge for the '@' mention menus: the SAME
     * two Remote namespaces the harness's own ui-reference source calls
     * (file discovery + session-reference discovery). Structurally narrowed so
     * no SDK package is imported; unavailable surfaces degrade to no '@' menu.
     */
    reference?: ReferenceRemoteFace;
    /** Clock; defaults to Date.now. */
    now?: () => number;
    /** Id minting; defaults to a random-uuid. */
    uuid?: () => string;
    /** Debounce (ms) for session-list-changed reconciles; defaults to 350. */
    reconcileDebounceMs?: number;
    /** Cruise-state persistence; absent = cruise defaults that are not persisted. */
    cruiseStorage?: CruiseStorageFace;
    /**
     * Schedule-preset persistence. Absent = the localStorage default (the
     * single-browser mode); the synced wiring injects a store over the shared
     * document so preset edits propagate to every replica.
     */
    presetStore?: import('./presets.ts').PresetStore;
    /** Run-preset persistence; same synced/local split as {@link presetStore}. */
    runPresetStore?: import('./run-presets.ts').RunPresetStore;
    /**
     * Applied-preset ledger (device-local display hint — which preset the
     * board last composed each session from). Absent = the localStorage
     * default. The host offers no preset read-back, so without this the
     * session's Agent row can only ever read "部署默认".
     */
    sessionAgentStore?: import('./session-agents.ts').SessionAgentStore;
    /**
     * Template-library persistence (device-local like drafts — templates are
     * personal starters, not board truth). Absent = the localStorage default.
     */
    templateStore?: import('./task-templates.ts').TemplateStore;
    /** Reads a session's recent history events (review-page transcript); absent = the page shows a hint. */
    transcript?: (sessionId: string) => Promise<TranscriptLoadResult | undefined>;
    /** Reads one earlier history page backward from `beforeSeq` (the native
     *  "load earlier" grammar — the follow opening's `throughSeq` cut rides
     *  along; absent = the transcript shows the tail only). */
    transcriptPage?: (sessionId: string, beforeSeq: number, throughSeq?: number) => Promise<TranscriptPage | undefined>;
    /** Reads one durable image back as base64 (the official `sessions.attachment`
     *  read — the host proves the session references the id). Absent = message
     *  images render as quiet placeholders. */
    loadImage?: (sessionId: string, attachmentId: string) => Promise<{
        data: string;
        mediaType: string;
    } | undefined>;
    /** Stages one file's exact bytes on a session (the official file-lane
     *  pre-step: `fileUploads/upload` or the binary HTTP fallback). Absent =
     *  the file lane is closed (images only). */
    uploadFile?: (sessionId: string, file: File) => Promise<{
        ok: true;
        receiptId: string;
    } | {
        ok: false;
        error: string;
    }>;
    /**
     * The native goal service for one session's goal strip (the official
     * `remote.goals` verbs + the live binding's `goal` projection for the
     * call-time CAS ref + the `goal/activation-changed` subscription).
     * Absent = the goal strip stays read-only (legacy bridge text only).
     */
    goalService?: GoalServiceFace;
    /** Session-config surface (review-page model/permission panel); absent = the panel degrades gracefully. */
    sessionConfig?: SessionConfigFace;
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
    sessionMessage?: (sessionId: string, text: string, images?: readonly PromptImage[] | undefined, mode?: 'queue' | 'steer', files?: readonly PromptFile[] | undefined) => Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    /** Executes one slash-command line against any native session through the
     *  host command registry (matched = recognized; unmatched = the caller
     *  falls back to sending the line as plain text). Absent = slash lines
     *  degrade to plain text. */
    sessionCommand?: (sessionId: string, line: string) => Promise<{
        ok: true;
        matched: boolean;
        outcome?: {
            kind: 'success' | 'error';
            text?: string;
        };
    } | {
        ok: false;
        error: string;
    }>;
    /** The live pending-question tracker (the official uiSession mirror face):
   *  a read-only projection of the host's pending interactions — answering
   *  stays in the native session (the board navigates there). Absent = the
   *  interaction card degrades to the waiting banner (the native side still
   *  answers it). */
    questionRpc?: QuestionRpcFace;
    /**
     * Relay one user-initiated launch to the engine (a non-engine replica's
     * Run button): the host forwards it to the lease holder, which runs it
     * through the ordinary pump (one pump = one concurrency budget = no
     * double launch). Absent = this controller never leaves the engine seat
     * (the single-browser/localStorage mode).
     */
    requestLaunch?: (taskId: string, trigger: RunTrigger) => void;
    /** Force one seat re-read from the host (the engine-note dialog's
     *  「重新检查」): the wiring calls the sync client's lease renewal, whose
     *  seat announcement then flows back through setHostProto/setEngine.
     *  Absent = the button hides (fallback mode has no host to re-read). */
    seatRecheck?: () => Promise<void>;
}
/** One image attached to a native prompt — the OFFICIAL `PromptContentPart`
 *  image shape: the browser submits temporary base64 bytes and the HOST
 *  performs the durable admission (promoting them to attachment refs). The
 *  board never admits images by itself; there is no second mechanism. */
export interface PromptImage {
    mediaType: string;
    /** Canonical base64 of the image bytes (no data-URL prefix). */
    data: string;
    name?: string;
}
/** One file attached to a native prompt — the OFFICIAL `PromptContentPart`
 *  file shape: the browser stages the EXACT bytes first (same session) and
 *  the prompt carries only the opaque receipt. Files carry no admission
 *  limits; the stored object is the exact submitted bytes. */
export interface PromptFile {
    /** Opaque receipt from a preceding upload on the SAME session. */
    receiptId: string;
    /** Display name (never an OS path). */
    name: string;
    /** Exact byte size (shown, not gated). */
    bytes: number;
}
/** Immutable controller snapshot for UI subscriptions. */
export interface ControllerSnapshot {
    tasks: readonly TaskRecord[];
    boardOpen: boolean;
    selectedTaskId: string | undefined;
    /** Auto-cruise toggle + concurrency limit. */
    cruise: CruiseState;
    /** Live execution stats for the board's quiet status line: how many
     *  sessions are running right now, and how many auto launches are queued
     *  for a freed slot. Both zero → the status line hides itself. */
    stats: {
        running: number;
        queued: number;
    };
    /** Scheduler Forbid-policy skip ledger (cumulative per board lifetime):
     *  due slots skipped while the task still ran vs. slots too stale to catch
     *  up. Read-only telemetry for the status line (zero → hidden, same quiet
     *  discipline as stats); skips never enter the retry path. */
    skips: SkipLedger;
    /** Scheduler heartbeat: the last fully completed tick (volatile, undefined
     *  = no tick yet). The status line derives staleness from it; persistence
     *  and sync never see it. */
    heartbeat: {
        lastOkAt: number | undefined;
    };
    /** Engine-seat facts for the board's quiet honesty: whether THIS device is
     *  the engine, whether the board runs in synced mode at all, the host's
     *  lease protocol (1 = predates visibility preemption → a queued card may
     *  wait on a frozen device and nothing can be done from here; the board
     *  says so instead of leaving the user guessing), and when that host
     *  process booted (undefined = never read a lease) so the stale-host dialog
     *  can answer "我明明重启了" with a clock reading. */
    engine: {
        held: boolean;
        synced: boolean;
        hostProto: number;
        bootedAt: number | undefined;
    };
}
/** The selected task (resolved from the ledger), or undefined. */
export declare function selectedTaskOf(snapshot: ControllerSnapshot): TaskRecord | undefined;
/**
 * What initiated a run: 'manual' (Run button / dragging to 'running' — also
 * primes an enabled schedule rule), 'schedule' (cron trigger) or 'chain'
 * (run-after-completion hand-off).
 */
export type RunTrigger = 'manual' | 'schedule' | 'chain';
/**
 * Board controller (see module doc). All mutations bump the snapshot and
 * persist through the store; UI and DOM mounts subscribe and re-render.
 */
export declare class BoardController {
    private readonly deps;
    private tasks;
    private boardOpen;
    private selectedTaskId;
    /**
     * The card a `done` move just DISARMED, kept so the move can be undone.
     *
     * Why this is the one undo the board needs: a column change is visible and
     * reversible (drag it back), and delete already asks first. But moving a card to
     * 已完成 silently switches its schedule and every session rule OFF — a documented,
     * deliberate behaviour that nothing on screen announces, and the only way back was
     * to re-arm each rule by hand in the editor. That is the ledger quietly losing a
     * fact, which is exactly what this product must not do.
     *
     * One slot, not a history stack: the board's promise is 「板上不丢事」, not a
     * general undo, and a single named offer is honest about its own limit.
     */
    private lastDisarm;
    private listeners;
    private disposers;
    private readonly now;
    private readonly uuid;
    private cruiseState;
    /** Scheduler Forbid-policy skip ledger mirrored from the `onSkips` sink. */
    private schedulerSkips;
    /** Scheduler heartbeat stamp mirrored from the `onHeartbeat` sink: the last
     *  fully completed tick (volatile — never persisted, never synced). */
    private schedulerHeartbeatOkAt;
    /** @param deps - store, execution service, and the sessions navigation face. */
    constructor(deps: ControllerDeps);
    /** Load the persisted ledger and start the navigation/status subscriptions. */
    start(): void;
    /** Stop all subscriptions and drop retained state (idempotent). */
    dispose(): void;
    /**
     * Take or yield the engine seat (the synced wiring calls this from the
     * host lease callback). Taking the seat immediately re-pumps the queue and
     * reconciles (catch-up for anything that came due while this replica was a
     * viewer); yielding it stops the pump (in-flight launches finish on their
     * own, and the new engine's reconcile picks up the rest).
     */
    setEngine(on: boolean): void;
    /** Whether this replica currently holds the engine seat. */
    isEngine(): boolean;
    /**
     * Whether the native session list has served its baseline (absent phase =
     * ready — old wirings and fakes predate the flag and must not stall).
     */
    private sessionsReady;
    /**
     * Adopt a remotely-authored board view (the sync client's onRemote):
     * replace the ledger and cruise state, notify, and (engine only) re-pump.
     * Deliberately does NOT persist — this state came from the host, saving it
     * back would echo the commit. The controller's own newer-in-flight writes
     * are preserved by the sync client's dirty overlay before this is called.
     */
    applyRemote(view: import('./board-doc.ts').BoardView): void;
    getSnapshot(): ControllerSnapshot;
    /** Whether multi-device sync is live (the wiring reports it once at boot);
     *  in fallback mode this device is always the engine and the lease story
     *  does not apply. */
    syncActive: boolean;
    /** The host's engine-lease protocol version (the wiring mirrors it from the
     *  sync client on every seat announcement). 1 = pre-visibility host. The
     *  default is CURRENT on purpose: a replica that has not read a lease yet
     *  makes no claim, so a boot race can never flash a false stale banner. */
    hostProto: number;
    /** Which host process is answering (undefined = no lease read yet). The
     *  stale-host dialog shows it as a real time, so a user who DID restart the
     *  harness can tell at a glance whether this connection lands on that
     *  process or on a second, un-restarted instance behind the same URL. */
    hostBootedAt: number | undefined;
    /** Mirror the host's boot instant into the snapshot (change → notify). */
    setHostBoot(bootedAt: number | undefined): void;
    /** Mirror the host's lease protocol into the snapshot (change → notify).
     *  A host restart moves the protocol WITHOUT moving the seat — the wiring
     *  calls this from the seat listener, so the stale-host banner clears live
     *  instead of surviving until the next manual refresh. */
    setHostProto(proto: number): void;
    /** Whether a live seat re-read is available (drives the dialog's
     *  「重新检查」 button — it hides in fallback mode, where there is no host
     *  to re-read). */
    canRecheckSeat(): boolean;
    /** Force one seat re-read from the host (the engine-note dialog's
     *  「重新检查」): the sync client renews the lease and its seat announcement
     *  flows back through setHostProto/setEngine, so a stale banner clears in
     *  the same tap once the host has actually restarted. A no-op when the
     *  wiring provides no re-read face. */
    recheckSeat(): Promise<void>;
    /** Set (or clear, with undefined) a task's accent color. */
    setTaskColor(taskId: string, color: string | undefined): void;
    /** The run-catalog face for form selects, or undefined when not wired. */
    runCatalog(): RunCatalogFace | undefined;
    /**
     * The schedule-preset store every preset surface reads/writes: the synced
     * document section when multi-device sync is live, the localStorage default
     * otherwise. One accessor = one source of truth, never a re-`new` per
     * component (which would fork the synced state from the shared document).
     */
    presetStore(): import('./presets.ts').PresetStore;
    /** The run-preset store (same single-source discipline as presetStore()). */
    runPresetStore(): import('./run-presets.ts').RunPresetStore;
    /** The OFFICIAL '@' reference bridge (file + session discovery), or
     *  undefined when the deployment does not expose the Remote namespaces —
     *  the '@' menu then stays closed (the same graceful degradation as a
     *  missing slash catalog). */
    referenceSources(): ReferenceRemoteFace | undefined;
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
    referenceSessionOf(taskId: string | undefined): string | undefined;
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
    referenceSessionCatalog(): ReadonlyArray<{
        sessionId: string;
        label: string;
    }>;
    /**
     * Read a session's recent history events for the review page's transcript
     * (the fold happens in the UI), together with the native projection
     * baseline (context pressure / breakdown) riding the history tail page.
     * undefined when no reader is wired.
     */
    loadTranscript(sessionId: string): Promise<TranscriptLoadResult | undefined>;
    /** Read one earlier history page backward from `beforeSeq`. */
    loadTranscriptPage(sessionId: string, beforeSeq: number, throughSeq?: number): Promise<TranscriptPage | undefined>;
    /** Read one durable message image back as base64 (official attachment read,
     *  cached + deduped by the wiring); undefined when unavailable. */
    loadImage(sessionId: string, attachmentId: string): Promise<{
        data: string;
        mediaType: string;
    } | undefined>;
    /**
     * Stage one file's exact bytes on a session (the official file-lane
     * pre-step): returns a stager bound to `sessionId`, or undefined when the
     * host serves no upload face. Receipts are per-Agent — a receipt minted
     * here MUST NOT cross sessions (the execution send layer re-stages by
     * name when a stored receipt is rejected).
     */
    uploadFile(sessionId: string): ((target: string, file: File) => Promise<{
        ok: true;
        receiptId: string;
    } | {
        ok: false;
        error: string;
    }>) | undefined;
    /** The session-config face (review page's model/permission panel), or undefined. */
    sessionConfig(): SessionConfigFace | undefined;
    /**
     * The native goal verbs for one session's goal strip (official
     * `remote.goals` mutations with the call-time CAS ref), or undefined when
     * the host does not serve them — the strip then stays read-only.
     */
    goalVerbs(sessionId: string): GoalVerbs | undefined;
    /** The goal activation subscription (official `goal/activation-changed`), or undefined. */
    subscribeGoalActivation(sessionId: string, listener: (goal: GoalActivationChanged | undefined) => void): (() => void) | undefined;
    /**
     * The user interaction an execution session is currently blocked on
     * (`approval` / `plan-review` / `question`), straight from the native
     * session-list summary (the same signal as the sidebar's amber dot).
     * undefined = the session is not waiting (or no longer listed).
     */
    pendingInteractionOf(sessionId: string | undefined): PendingInteractionKind | undefined;
    /** The open ask_user_question batch for a session (the interaction card's
     *  content source — the same request the native composer renders). */
    questionPendingOf(sessionId: string | undefined): WireQuestion | undefined;
    /** Subscribe to pending-question changes across sessions. */
    subscribeQuestions(listener: () => void): () => void;
    /** Whether the board can answer a pending question in place. True while the
     *  official snapshot carries an interactive carrier (the native
     *  `PendingQuestion` exposes `answer`/`cancel`; settling through it resolves
     *  the ONE host waterfall call — nothing new is registered, so first answer
     *  still wins). False for a display-only snapshot entry or a host with no
     *  uiSession: the card degrades to its navigate-to-answer shell. */
    get questionAnswerInPlace(): boolean;
    /** Deliver one answer batch to the suspended ask. True = accepted; false =
     *  refused or stale — the card keeps itself open and reports the reason. */
    answerQuestion(rpcId: string, sessionId: string, answers: readonly QuestionAnswerEntry[]): Promise<boolean>;
    /** Reject the whole ask (the model sees ASK_CANCELLED and continues). */
    cancelQuestion(rpcId: string): Promise<boolean>;
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
    sessionInfo(sessionId: string | undefined): {
        cwd?: string;
        agentPreset?: string;
    } | undefined;
    /** The session's display title (native list summary), or undefined when the
     *  session is gone/unknown. Drives the execution row's identity slot.
     *
     *  A durable title equal to the workspace (project) BASENAME is the host's
     *  deterministic auto-name, not a real name — reported as undefined so the
     *  single 未命名 grammar shows 「未命名」 until a provider-generated or
     *  user-pinned title arrives (the recurring "不填标题却显示工作区名" bug).
     *  One judgment with the linked rows: both call `realTitleOf`. */
    sessionTitle(sessionId: string | undefined): string | undefined;
    /** The localized 未命名 placeholder the session rows show for a session
     *  the host has not titled yet (set by the client wiring; undefined in
     *  tests = legacy task-title fallback). */
    untitledSessionLabel?: string;
    subscribe(fn: () => void): () => void;
    openBoard(): void;
    closeBoard(): void;
    toggleBoard(): void;
    openTask(id: string): void;
    /**
     * Mark one execution as viewed (the user opened its review page), clearing
     * its row's unread dot AND the task card's unread ring — ONE baseline
     * (task.viewedAt) governs the card's glow, the row's dot/halo is the same
     * moment seen; opening the review page means the task's content is seen.
     * Persisted so the cleared state survives refreshes. A no-op (no persist)
     * for unknown tasks or executions.
     */
    markExecutionViewed(taskId: string, executionId: string): void;
    closeTask(): void;
    /**
     * Mark every task (and every round) viewed — the notification center's
     * "全部标为已读". One write, one persist: read-state only moves forward
     * (see board-doc authorship), so a bulk clear never clobbers content.
     */
    markAllViewed(): void;
    /**
     * Mark ONE task (and its rounds) viewed without navigating — a triage row's
     * inline "标已读". Same monotone read-state law as `markAllViewed`, scoped
     * to a single record so the board stays where it is.
     */
    markTaskViewed(taskId: string): void;
    /**
     * Open a task FROM the notification center: the same navigation as
     * `openTask`, but the notification's shadow expires — the viewed session's
     * rounds read viewed (other sessions' dots survive: looking at s-1 never
     * clears s-2). ONE funnel for notification/feed opens; pure card clicks
     * keep `openTask` (the card ring clears while row dots wait for their
     * review pages). Unknown ids are ignored.
     */
    openTaskFromNotification(id: string, sessionId?: string): void;
    /**
     * Mark ONE session's rounds viewed (plus the task baseline, so the card
     * ring follows the view) — a notification row's session entering the
     * detail. Same monotone read-state law as `markTaskViewed`, scoped to the
     * session's rounds so sibling sessions keep their dots. No matching round
     * (unknown session) = pure no-op: the baseline never moves for nothing seen.
     */
    markTaskSessionViewed(taskId: string, sessionId: string): void;
    /**
     * Mark an explicit id set viewed (bulk triage of a filtered group). One
     * write, one persist; unknown ids are ignored.
     */
    markTasksViewed(taskIds: readonly string[]): void;
    /**
     * 缺则补、填则守：任务被创建（四出生门：手动/复制/模板实例/绑定创建）或被真正
     * 启动（唯一发射门 launchTask）的时刻，空标题/空描述从执行 Prompt 补齐
     * （`supplementLaunchFields` 纯函数）——已填字段永不覆盖。这是整个特性的唯一
     * 作用点：任何创建与启动路径（手动/重复/接续链/定时/巡航/自动化/创建/启动）
     * 都得到同一套语义，卡片在出生与开跑时永远不会无故空着头；编辑路径永不补
     * （清空即意图）。
     */
    private supplementedTask;
    createTask(input: NewTaskInput): TaskRecord | undefined;
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
    createBoundTask(bind: TaskBind, input: NewTaskInput): TaskRecord | undefined;
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
    private snapshotWorkspaceSessions;
    /** Whether a session row belongs to a workspace (cwd path or id match). */
    private sessionInWorkspace;
    /**
     * Copy a task as a fresh template ("复制为模板"): the same content, run
     * configuration, due date and task-level automation CONFIGURATION (mode,
     * cron, budget — runCount reset to 0), landing in 待规划, DISARMED: like a
     * stamped template, a copy must never surprise-fire (arming is an explicit
     * act on the new card). Executions, hide state, live bindings and SESSION
     * RULES are never copied — a template has none of the source's sessions
     * (a session rule automates a SPECIFIC session of the source task; the
     * template is a new blank card, "绘画规则" would point at nothing).
     * @param id - the source task.
     * @returns the new task, or undefined when the source is unknown.
     */
    copyTask(id: string): TaskRecord | undefined;
    /**
     * The template library (named, reusable blueprints — see task-templates.ts).
     * Templates are device-local; the board document is untouched, so saving
     * and stamping never sync and never need a migration.
     */
    listTemplates(): import('./task-templates.ts').TaskTemplate[];
    /**
     * Snapshot a task as a named template ("存为模板"). The name defaults to
     * the task's title (deduplicated with a numeric suffix); instance state
     * never rides along.
     * @param id - the source task.
     * @param name - the template label (blank = the task's title).
     * @returns the saved template, or undefined when the source is unknown.
     */
    saveTemplate(id: string, name?: string): import('./task-templates.ts').TaskTemplate | undefined;
    /** Delete one template by id (a no-op for unknown ids). */
    deleteTemplate(id: string): boolean;
    /**
     * Stamp a fresh 待规划 card from a template (content + run configuration;
     * schedule/rules never ride — arming is explicit on the new card).
     * @param id - the template id.
     * @returns the new task, or undefined for an unknown template.
     */
    instantiateTemplate(id: string): TaskRecord | undefined;
    /** Whether a session is natively archived (registry-global archive set).
     *  Absent workspaces face = nothing is known archived (degrade open). */
    private archivedOf;
    /**
     * The live linked-session rows of a task (pure derivation over the native
     * session snapshot; see linked-sessions.ts). ONLY explicit session binds
     * contribute — a workspace bind is a source association and surfaces no
     * session rows, so a chat created in the main UI never appears on a card
     * by itself. Dragging more session sources in ADDS to the set (same
     * session, one row).
     */
    linkedOf(task: TaskRecord): LinkedSessionRow[];
    /** Hide one session of the task (run or linked) — the unified per-session
     *  hide: recorded in both families (the derived hidden-session set in
     *  session-list.ts reads either, so a run session and a linked view of the
     *  same session stay hidden together). Non-destructive; numbering stays. */
    hideTaskSession(taskId: string, sessionId: string): void;
    /** Restore every hidden session (the "恢复全部已隐藏" action). */
    unhideTaskSessions(taskId: string): void;
    /**
     * The task's unified session list — see {@link taskSessionsOf}: one
     * de-duplicated view of its run sessions and linked sessions, the single
     * source for the detail's 会话 section.
     */
    sessionsOf(task: TaskRecord): TaskSessionRow[];
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
    reorderTaskSession(taskId: string, sessionId: string, beforeId: string | undefined): boolean;
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
    createTaskSession(taskId: string, config: import('./execution.ts').SessionLaunchConfig & {
        title?: string;
    }): Promise<import('./execution.ts').SessionLaunchResult & {
        titleError?: string;
    }>;
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
    renameTaskSession(taskId: string, sessionId: string, title: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
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
    addTaskSource(taskId: string, bind: TaskBind): boolean;
    /** The sessions a re-added bind contributes to the display set: a session
     *  bind is itself (its removal is reversible by dragging it back); a
     *  workspace bind contributes none — it surfaces no session rows at all. */
    private sourceMemberIdsOf;
    /** Permanently remove ONE session from the task (the hidden-tray 删除):
     *  its rounds are deleted, its hide state is cleared, and it joins the
     *  REMOVED set so a bound workspace can never re-derive it (the delete was
     *  irreversible — deleting a workspace member must actually remove it). A
     *  live session binding that points ONLY at this session is unbound (a
     *  deleted source cannot stay bound). The task itself and every other
     *  session remain.
     *  @returns true when anything was removed. */
    removeTaskSession(taskId: string, sessionId: string): boolean;
    /** Restore ONE hidden session (single-item restore; the bulk "恢复全部"
     *  stays available too — a folder's many hidden rows can be brought back
     *  one by one without restoring everything). */
    unhideTaskSession(taskId: string, sessionId: string): void;
    /** Default title for a freshly dragged-in binding (from its native source). */
    boundSourceTitleOf(bind: TaskBind): string;
    /** Classify a sidebar-drag id (known session / known workspace / unknown). */
    externalKindOf(id: string): 'session' | 'workspace' | undefined;
    /** Next column sort key: one past the largest order in the ledger. */
    private nextOrder;
    /**
     * Update a task's editable fields: content (title/description/prompt) and
     * run configuration. A run-config key present in the patch with an empty
     * string or `undefined` clears the field (the run then falls back to
     * defaults); a value sets it; absent keys keep their current value. Text
     * fields are trimmed; a blank title is allowed and STAYS blank (the card
     * shows an 未命名 placeholder — the 缺则补 supplement runs at birth and
     * at launch only, never on edit). The next execution — manual or
     * scheduled — reads the updated record, so edits apply from the
     * following run onward.
     * @returns true when applied, false when rejected (unknown task).
     */
    updateTask(id: string, patch: TaskUpdatePatch): boolean;
    /**
     * Move a card into a column, optionally at a specific position (before the
     * card with `beforeId`; undefined = column tail). The target column's sort
     * keys are renumbered; a same-column move is reorder-only.
     *
     * Moving a card to 'done' is the completion hand-off: any armed schedule
     * rule is disarmed outright ({@link disarmSchedule}) and every session rule
     * switches off ({@link disarmSessionRules}) — a completed task's
     * timer/chain must never fire again. Moving it back out of done (manual
     * drag or comment revive — one law, whichever hand) resets the spent run
     * budget but leaves the rules OFF until the user re-arms them.
     *
     * Automation never locks a card in place (see resolveCardDrop); leaving
     * the lane speaks its own language: a chain hand-off happens ONLY at a
     * settle — a manual move (except done) never disarms the rule and never
     * starts anything, so 完成后接续 stays armed and matches up ("跑到一半
     * 移动卡片不会误杀链").
     */
    moveTask(id: string, status: TaskStatus, beforeId?: string): void;
    /**
     * Approve a review task from the notification center: mark it viewed and
     * move it to done — but never while any of its rounds is still open. An
     * approve mid-flight would yank the column AND hard-disarm the automation
     * driving the live sessions (moving to done is a hard stop, see
     * {@link moveTask}), so a busy card refuses untouched. The UI disables —
     * or, where the reason must stay reachable, explains — through this same
     * judgment; the card drop and the detail move buttons already enforce the
     * identical busy law at their own doors.
     * @param taskId - the task to approve.
     * @returns true when approved; false when unknown or busy (state untouched).
     */
    approveTask(taskId: string): boolean;
    deleteTask(id: string): void;
    /** What the last `done` move disarmed, for the undo affordance. */
    undoableDisarmOf(): {
        taskId: string;
        title: string;
    } | undefined;
    /**
     * Put a card back the way it was before the `done` move that disarmed it: the
     * stored snapshot is restored wholesale (status, order, schedule and session
     * rules together) and only `updatedAt` is refreshed — the ledger stamps a change
     * when it happens, and this is a change.
     *
     * Wholesale restore rather than a field-by-field inverse on purpose: the move
     * touched several things (`disarmSchedule`, `disarmSessionRules`) and any inverse
     * written by hand would be a second description of what the move does — the one
     * that drifts the first time the move changes. Restoring the snapshot cannot drift
     * from the move it undoes.
     *
     * The task is put back AT ITS OLD POSITION (any tasks that arrived after it stay
     * after it), so undo restores the list the user was looking at.
     *
     * @returns true when a DISARMED card was restored; false when there is nothing to
     *          undo (so the caller can keep the affordance honest).
     */
    undoMoveToDone(): boolean;
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
    setSchedule(id: string, patch: {
        enabled?: boolean;
        cron?: string;
        maxRuns?: number;
        mode?: ScheduleMode;
    }): boolean;
    /**
     * Auto launches waiting for a free slot. Only schedule/chain triggers ever
     * queue here: a manual run is an explicit user action that always starts
     * immediately (it still occupies a slot, so auto launches wait for the
     * budget it consumes). The trigger kind is not read at drain time
     * (re-validation re-derives eligibility), so only the task id is kept.
     */
    private queuedLaunches;
    /** How many rounds are genuinely open right now (the concurrency truth).
     *  ROUNDS, not cards: the budget bounds how many conversations run at once,
     *  and one card may legitimately own several of them at the same time (its
     *  own run plus a comment injected into a second bound session). Counting
     *  cards made 「并行数 3」 silently mean 「三张卡，每卡一条」. */
    private inFlightCount;
    /** Reentrancy guard for {@link dispatch} (launches notify → re-dispatch). */
    private dispatching;
    private dispatchQueued;
    private disposed;
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
    private engine;
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
    private dispatch;
    /**
     * Start the oldest queued schedule/chain launch, or drop it when it went
     * stale (task deleted, completed, paused, or busy). Returns whether a
     * request was consumed (so the caller keeps draining).
     */
    private drainQueuedLaunch;
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
    private nextEligible;
    /**
     * Launch a plain execution round: move the task to 'running', append the
     * execution record, and hand off to the ExecutionService. Automation no
     * longer awaits a manual first run — arming a schedule activates it at
     * once (see setSchedule / ruleReadiness) — so any trigger just starts.
     * THE 缺则补 supplement lives here (plus at every birth): every real
     * launch — manual, rerun, chain, cron, cruise pickup, queued auto run —
     * reads the supplemented record, so no launch path can run a card with an
     * empty head (its title names the fresh session).
     */
    private launchTask;
    /**
     * Inject one comment continuation: mark the round injected, move the task
     * to 'running', and send the text to the execution session (a fresh turn
     * in the same session, watched like a plain run). Only ever called by
     * {@link dispatch}, after eligibility was validated — or by a session
     * rule with `send: 'steer'`, which injects immediately (the same watched
     * round, only the handoff is now instead of the FIFO lane).
     */
    private launchComment;
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
    runTask(id: string, trigger?: RunTrigger): Promise<boolean>;
    /**
     * Continue an armed chain schedule after a settle: persist the incremented
     * counter (disarming after the final budgeted run) and start the next run.
     * The judgment is the CARD's own plain runs, not "the last row" — under
     * per-session lanes a comment or a native turn can be the newest record
     * while the card's execution finished earlier.
     *
     * Every attempt is guarded four ways: the card must be quiet (no lane in
     * flight), its last PLAIN run must have SUCCEEDED (失败不续), and the global
     * budget must have a free slot, and the prompt must be non-empty. An
     * emptied prompt holds the link without consuming budget (except the
     * final run, which still disarms). Any of those failing defers the hand-off
     * without consuming a run — and because the derivation is re-read from the
     * ledger, the next settle or the scheduler's recovery tick picks it up again
     * instead of losing the link.
     */
    private maybeContinueChain;
    /**
     * Roll a task's schedule forward (scheduler callback): persist the next due
     * instant, the trigger instant of this run, the incremented run counter,
     * and optionally disarm the schedule (after the final budgeted run).
     * No-op when the task has no schedule rule (it was deleted mid-tick, for
     * example).
     */
    applyScheduleNextRun(id: string, nextRunAt: number | undefined, lastTriggeredAt: number | undefined, runCount?: number, disable?: boolean): void;
    /**
     * Jump to an execution's session transcript. Selecting the session changes
     * `current`, which closes the board (the conversation view takes over).
     * Refuses to navigate when the session no longer exists (deleted/archived):
     * navigating a stale id would silently land on a fresh-session screen.
     * @param sessionId - the execution session to open.
     * @returns true when the session exists and the navigation was requested.
     */
    openSession(sessionId: string): boolean;
    /** Re-run a settled task: move it back to 'todo' first, then execute. */
    /**
     * Promote the task and start a fresh round, reporting whether the launch was
     * actually accepted — the same answer `runTask` gives.
     *
     * The return value is load-bearing: the detail sheet used to close BEFORE
     * firing, so a refused launch (empty prompt, or a round already open) looked
     * exactly like a successful one — the sheet vanished, nothing ran, and the
     * board said nothing. Callers that want the old fire-and-forget shape can
     * still ignore it; the UI keeps the sheet open and names the reason.
     */
    rerunTask(id: string): Promise<boolean>;
    /** Whether the runtime offers the direct-message channel (the linked
     *  panel's composer is disabled without it). */
    directMessageAvailable(): boolean;
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
    sendSessionMessage(taskId: string, sessionId: string, text: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    /**
     * Related-session labels of a task (for the composer's @ mention): the
     *  task's sessions, each with a native title (falling back to the raw id),
     *  de-duplicated in related-session order. */
    sessionLabelsOf(taskId: string): Array<{
        sessionId: string;
        title: string;
    }>;
    /**
     * Steering send (插话): deliver a comment line to the session IMMEDIATELY —
     * slash-aware, recorded as a settled message round so it stays visible next
     * to queued comments in the same thread. It does NOT enter the dispatcher,
     * does NOT consume the concurrency budget and does NOT respect the cruise
     * gate: it is exactly "interrupt the current turn now" — the counterpart of
     * the default queued send (submitSessionComment). One message, two send
     * modes: queue (调度器注入) vs steer (现在直达).
     */
    steerComment(taskId: string, sessionId: string, text: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    /** The attachment-carrying twin of steerComment: images (temporary bytes)
     *  and files (staged receipts) ride the same direct-send path as text. */
    steerCommentWithImages(taskId: string, sessionId: string, text: string, images: readonly PromptImage[] | undefined, files?: readonly PromptFile[] | undefined): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
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
        sessionId: string;
        instruction: string;
        cron: string;
        trigger?: 'cron' | 'on-complete';
        usePrompt?: boolean;
        send: 'queue' | 'steer';
    }): import('./automation.ts').SessionRule | undefined;
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
        sessionId?: string;
        instruction?: string;
        trigger?: 'cron' | 'on-complete';
        usePrompt?: boolean;
        cron?: string;
        send?: 'queue' | 'steer';
    }): boolean;
    /** Toggle a session rule's enabled state (the row's live switch). Switching
     *  a cron rule back on recomputes its due slot from now (a disarmed rule
     *  carries no appointment — resuming from a stale slot would surprise-fire).
     *  Switching off clears the slots too (one off-shape everywhere: done-disarm
     *  and toggle-off persist identically, so no path can smuggle a stale slot
     *  back to life). */
    toggleSessionRule(taskId: string, ruleId: string, enabled: boolean): void;
    /** Remove a session rule. */
    deleteSessionRule(taskId: string, ruleId: string): void;
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
    tickSessionRules(now: number): Promise<void>;
    /** The raw host send for a direct line (slash-aware, no recording).
     *  Attachments are durable refs appended to the message content (images =
     *  temporary bytes, files = staged receipts); `mode` is the official
     *  prompt disposition (queue / steer). */
    private sendRawMessage;
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
    submitComment(taskId: string, executionId: string, text: string, command?: boolean, images?: readonly PromptImage[], files?: readonly PromptFile[]): ExecutionRecord | undefined;
    /** A comment on a completed task revives it: moving the task back to 待办 is
     *  the SAME column transition as a drag (the schedule re-arms per column
     *  rules), so the comment drives the task instead of hitting a dead end. */
    private reviveTaskIfDone;
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
    submitSessionComment(taskId: string, sessionId: string, text: string, command?: boolean, images?: readonly PromptImage[], files?: readonly PromptFile[]): ExecutionRecord | undefined;
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
    private queueRuleComment;
    /**
     * Cancel a comment round that has not been injected yet: removes it from
     * the task (a saved or queued comment is editable by deleting it and
     * writing a new one). A round that was already injected (the session is
     * running it) or settled cannot be cancelled.
     * @param executionId - the pending comment round's id.
     * @returns true when the round was removed.
     */
    cancelComment(executionId: string): boolean;
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
    startRefine(taskId: string, english?: boolean): boolean;
    /**
     * Send the user's answer into the task's refine session (the AI asked and
     * is waiting): launch a refine round with the answer text, delivered
     * immediately — the session is already counted in-flight, so answers never
     * queue behind the cruise gate or the comment FIFO.
     * @param taskId - the task whose refine session receives the answer.
     * @param text - the answer text.
     * @returns true when the answer was launched.
     */
    answerRefine(taskId: string, text: string, images?: readonly PromptImage[], files?: readonly PromptFile[]): boolean;
    /**
     * Write a refined prompt onto the task (the user confirms the text shown
     * in the refine panel; nothing is ever applied automatically).
     * @param taskId - the task to update.
     * @param prompt - the refined execution prompt text.
     * @returns true when the task was updated.
     */
    applyRefineResult(taskId: string, prompt: string): boolean;
    /** Turn the auto-cruise on or off (persisted) — a MANUAL toggle: it flips
     *  `enabled` directly and NEVER writes the scheduled windows, so clicking
     *  开启/关闭 repeatedly cannot accumulate window records. Scheduled window
     *  boundaries still flip the state (预约语义). On re-pumps the dispatch
     *  queue immediately — pending comments and todo pickups start under the
     *  concurrency budget, comments first. */
    setCruiseEnabled(on: boolean): void;
    /** Change the concurrency budget (persisted; the dispatcher re-pumps). The
     *  one clamp lives in board-doc ({@link clampCruiseLimit}) — writes and
     *  reads share it. Non-finite input is ignored (a NaN write must never
     *  clear the budget). */
    setCruiseLimit(limit: number): void;
    /** Mirror the scheduler's Forbid-policy skip ledger into the snapshot (the
     *  wiring calls this from the scheduler's `onSkips` sink). Cumulative and
     *  read-only: skips are telemetry, never persisted, never retried. */
    setSchedulerSkips(stats: SkipLedger): void;
    /** Mirror the scheduler heartbeat stamp into the snapshot (the wiring calls
     *  this from the scheduler's `onHeartbeat` sink). Volatile telemetry only:
     *  never persisted, never synced, never part of `applyRemote`. */
    setSchedulerHeartbeat(okAt: number): void;
    /** Replace the cruise's scheduled windows (the editor's add/remove path).
     *  The effective state is recomputed at once against the NEW list: a window
     *  may now cover the present (cruise turns on), or the covering window may
     *  have just been removed (cruise turns off). Expired-window pruning is the
     *  heartbeat's job (tickCruise), so a just-added window is never yanked
     *  before its first tick. */
    setCruiseSchedule(windows: readonly import('./cruise.ts').CruiseWindow[]): void;
    /** The scheduler heartbeat for cruise windows (每分钟): a window's start
     *  instant flips the cruise ON, its end instant flips it OFF; fully-past
     *  windows are pruned and persisted away — "到点自动开启 / 到点自动关闭",
     *  过期记录自动消失. Persist and pump dispatch when anything changed. */
    tickCruise(now: number): void;
    private handleExecutionEvent;
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
    private settledFollowUp;
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
    private fireRuleRound;
    /**
     * 任务一次执行结算时触发其 on-complete 会话规则（"完成后续跑"——永续循环：
     * 规则轮成功结算后继续下一轮，直到关闭/删除/会话消失/内容不可用）。发送文法
     * = 一条 ruleId 标记的观察轮（queue/steer，与巡航无关）；判定 = 规则启用 +
     * 内容可得（usePrompt 规则要求任务执行 Prompt 非空；自定义规则内容自带）+
     * 目标会话在场；每次结算每个规则至多一次（lastAt 由 fireRuleRound 记录）。
     * 列暂停不适用：结算瞬间任务刚被移动，这里的"完成"才是约定本身。
     */
    fireOnCompleteRules(taskId: string): Promise<void>;
    /**
     * 完成后续跑：规则自己的指令轮（ruleId 标记）**成功**结算后的再触发——同一
     * 规则再发一条，一轮接一轮；失败/取消不续（错误不风暴）、规则被关/会话消失/
     * 内容不可用即停；用户手写评论（无 ruleId）永不触发。
     */
    fireLoopRule(taskId: string, ruleId: string, sessionId: string): Promise<void>;
    /** Settle a round with the rule its kind demands: refine rounds keep the
     *  task in its column (settlement of a plain run may move the card). */
    private settleRound;
    /** Reconcile running tasks and close the board when the user navigates. */
    private onSessionsChanged;
    private lastCurrent;
    /** Execution ids launched on this page; they settle via their live watch, never list reconciliation. */
    private readonly activeExecutionIds;
    /** One entry per card (the steer round whose completion was already
     *  reported), replaced on the next steer — bounded by the card count. */
    private readonly directFallbackRounds;
    /** Debounce timer for {@link reconcileRunningTasks}. */
    private reconcileTimer;
    /** Whether a reconcile pass is underway (single-flight guard). */
    private reconcileInFlight;
    /**
     * A session-list change arrived but no pass ran yet (debounce pending or a
     * pass in flight). Accumulated instead of dropped so the final
     * running→finished flip of an execution session is never lost.
     */
    private reconcilePending;
    /** Native-activity detection state (see session-activity.ts): observed
     *  running baselines per session, when external rounds were created, and
     *  which sessions' CURRENT run periods are already consumed. */
    private readonly activityBook;
    /** Latest wake stamp per session (see recordActivityWake): a stamp advance
     *  is a turn the status edge may have missed — the next reconcile pass
     *  re-checks the session even when its running flag did not move. */
    private readonly activityWake;
    /** Sessions whose current turn the board itself recorded (a direct-send):
     *  they must not re-trigger external detection while in grace. */
    private readonly directGraceUntil;
    /**
     * Debounce + single-flight trigger for the running-task reconciliation.
     * Session-list notifications arrive in bursts (one per session status
     * change); both guards together keep a burst from reading the history API
     * once per running task. Notifications that arrive while a pass is queued
     * or running are accumulated ({@link reconcilePending}) and re-checked
     * after the pass, so none is silently dropped.
     */
    private scheduleReconcile;
    /** How old an execution must be before list reconciliation may settle it. */
    private static readonly ACTIVE_RECONCILE_GRACE_MS;
    /** The delivery watchdog deadline: an OPEN round whose session has produced
     *  no turn evidence and has sat idle this long is a round that never
     *  reached the agent (a lost inject, a session that vanished mid-flight).
     *  Left open it would hold a concurrency slot AND swallow every future
     *  native turn of that session (hasOpenRoundOn gates external recording),
     *  which is why 「行亮进行中、卡片永远不动」 used to recur forever. The
     *  watchdog releases it as cancelled, and external detection re-arms. */
    private static readonly OPEN_ROUND_WATCHDOG_MS;
    /**
     * The watchdog verdict for one open round: a synthetic `cancelled` settle
     * when the round is past the deadline and its session is NOT running (or
     * gone), undefined while any evidence could still arrive (still connecting,
     * session still working, deadline not reached). Never judges a round whose
     * session is actively working — a long run is not a zombie.
     */
    private zombieRoundEvent;
    /** Settle tasks left 'running' whose sessions already finished. */
    private reconcileRunningTasks;
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
    private driveLiveStates;
    /** THE live-state question for one task (card breathing source): waiting >
     *  running > idle — same single derivation for every surface. The related
     *  set is the task's OWN sessions (refine + explicit binds + execution
     *  rounds; a workspace bind contributes none), so the card and its rows
     *  always answer the same question from the same set. */
    liveStateOf(taskId: string): TaskLiveState;
    /** Whether one session is genuinely running right now (the native truth). */
    nativeRunningOf(sessionId: string): boolean;
    /**
     * Every related session of a task (de-duplicated, refine first) — THE one
     * derivation from task-live.ts, consumed by the external-activity scanner,
     * the bound-task reconcile and the '@' reference scoping. The controller
     * only supplies the linked ids (explicit session binds); everything else
     * (binds, execution rounds, refine session) is pure task shape.
     */
    private relatedSessionsOf;
    /** The ids of every session already RELATED to a task (binds, execution
     *  rounds, the refine session, live linked members) — the single source for
     *  "do not offer this session again". The add-session picker filters on this,
     *  so a refine session (which the old hand-rolled bind+execution set missed)
     *  never shows as a re-bindable candidate. */
    relatedSessionIdSet(task: TaskRecord): Set<string>;
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
    private scanExternalActivity;
    /** Whether the session's CURRENT turn is already board-owned: the live
     *  direct-send grace, or a direct round the board recorded for this same
     *  running period (persisted-startAt window — survives a reload, where the
     *  in-memory grace alone would let a long direct turn be double-recorded). */
    private inBoardTurnOn;
    /**
     * The ONE external-round write (both detection channels land here): append
     * the round to the CURRENT record (anchor-dedup re-checked at write time —
     * a stale snapshot is never written over a newer one), drive the card into
     * 「进行中」 (a refine round keeps its column), promote to the column top and
     * persist. @returns whether the ledger actually moved.
     */
    private recordExternalRound;
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
    recordNativeTurn(sessionId: string, turn: LatestUserMessage): void;
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
    recordActivityWake(sessionId: string, stamp: number): void;
    /** The newest native user message of a session (the line that started the
     *  observed turn, or a picture-only marker); undefined when the transcript
     *  is unavailable or the tail window missed it. */
    private userMessageOf;
    /** The newest native user message TEXT of a session (legacy-path helper). */
    private userTextOf;
    /** The backfill text for an external round settling with an empty body
     *  (legacy records / an observation that missed the text); undefined when
     *  there is nothing to fill. The text lands on the CURRENT record at write
     *  time (Stage 2), never on a pre-await snapshot. */
    private externalTextIfNeeded;
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
    private reconcileBoundTask;
    /**
     * Cancel an open external round whose session has already finished WITHOUT
     * any real turn evidence past the settle grace — the flip was spurious
     * (a session created/unarchived, a transient signal) and the card must not
     * stay stranded in 「进行中」. Real turns settle through the reconcile above
     * (they have evidence), so this only ever cancels noise.
     */
    private cancelSpuriousExternal;
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
    private userEdit;
    private persistAndNotify;
    private notify;
}
