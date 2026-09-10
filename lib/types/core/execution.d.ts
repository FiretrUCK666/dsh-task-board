/**
 * Execution service: runs a task through dsh's real session machinery.
 *
 * The board's "run" button must make dsh actually work, not fake a status:
 * the service connects a real session (workspace blank-session reuse or
 * `session.create` on the host via the workspaces service), renames it to
 * the task title, sends the task prompt — slash lines through the native
 * command registry (the composer's '/' path), everything else through
 * `session.prompt` — and then watches the session's conversation snapshot
 * until its turn settles. The task board controller consumes
 * {@link ExecutionEvent}s to move the card running → done/failed and to keep
 * the execution record.
 *
 * Deliberately framework-free: the runtime faces are declared structurally
 * (a narrow slice of the real `ctx.sessions` / `ctx.workspaces` contracts)
 * so tests drive it with plain fakes.
 */
import type { ExecutionRecord, TaskFile, TaskImage, TaskRecord } from './tasks.ts';
/** The narrow sessions face the service needs. */
export interface SessionsExecutionFace {
    list: {
        getSnapshot(): {
            /** Baseline arrival lifecycle — 'pending' until the host list has loaded. */
            phase: 'pending' | 'ready';
            byId: Record<string, {
                running: boolean;
                completed?: boolean;
                blank?: boolean;
            }>;
        };
        subscribe(fn: () => void): () => void;
    };
    binding(id: string): {
        session: SessionDriver;
    } | undefined;
}
/** The narrow workspaces face the service needs. */
export interface WorkspacesExecutionFace {
    list: {
        getSnapshot(): {
            items: readonly {
                workspaceId: string;
                /** The workspace's own working directory (alpha.3 official `path`). */
                path?: string;
                /** Sessions the workspace owns (alpha.3 official `sessionIds`). */
                sessionIds?: readonly string[];
            }[];
            recentWorkspaceId: string | undefined;
        };
    };
}
/**
 * Optional host session-creation face: resolves a guaranteed-FRESH session
 * (`sessions.create` on the client runtime; the host guarantees the session
 * lands in the list store and is addressable by resolution). Absent, a
 * workspace with no sessions cannot start a run (see {@link ExecutionService.connectSession}).
 */
export interface SessionCreateFace {
    (workspaceId: string | undefined): Promise<string>;
}
/**
 * Optional host session-rename face: the OFFICIAL user-title write
 * (`sessions.rename` — appends a `session/title` event with the `user`
 * source). The native semantics do the conflict-free work by themselves:
 * a user rename PINS the title against automatic regeneration and
 * supersedes any in-flight automatic generation; leaving a session
 * unnamed leaves the automatic naming chain (first-prompt fallback +
 * provider cadence) fully intact. Absent = renaming degrades to the
 * client binding driver (`session.rename` on the face below).
 */
export interface SessionRenameFace {
    (sessionId: string, title: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
}
/** One raw session-history event narrowed to the failure signal reconcile needs. */
export interface ExecutionHistoryEvent {
    type: string;
    data?: unknown;
}
/** Optional raw-history face used to detect failures of never-opened sessions. */
export interface HistoryExecutionFace {
    loadTail(sessionId: string): Promise<{
        events: readonly ExecutionHistoryEvent[];
    } | undefined>;
}
/** One model selection submitted to the host for an execution session. */
export interface ModelSelectionInput {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/** Optional model-selection face: applies a per-task model route before prompting. */
export interface ModelSelectFace {
    (sessionId: string, selection: ModelSelectionInput): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
}
/** Optional agent-preset face: composes the execution session from a preset before prompting. */
export interface AgentPresetSelectFace {
    (sessionId: string, agentPreset: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
}
/**
 * Optional comment face: sends one comment continuation to an existing
 * execution session through the host-level `session.prompt` API (works for
 * any session id, not just the currently staged one). When absent the
 * service falls back to the client binding driver.
 * `mode` is the OFFICIAL prompt disposition: 'queue' (inject in order) or
 * 'steer' (interrupt the current turn now) — a session-rule steer lives here,
 * so an immediate rule message is genuinely immediate.
 */
export interface CommentSendFace {
    (sessionId: string, text: string, mode?: 'queue' | 'steer', images?: readonly TaskImage[], files?: readonly TaskFile[]): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
}
/**
 * Optional slash-command face: executes one command line against an existing
 * execution session through the native command registry (the same
 * `remote.commands.execute` RPC the composer's '/' submissions use — never
 * the plain prompt path, which would deliver the line to the model as text).
 * `matched` reports whether the registry recognized the name; when it did,
 * `outcome` carries the command's settled result (a recognized command may
 * still fail, e.g. an unknown preset name). A matched command may have
 * STARTED A REAL MODEL TURN (e.g. `/plan <message>` turns plan mode on and
 * steers the message into the agent): the caller must observe the session
 * and only settle when that turn really ends — commands are never settled
 * on `matched` alone. When absent the service treats command lines as
 * plain text.
 */
export interface CommentCommandFace {
    (sessionId: string, line: string): Promise<{
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
}
/** Everything the service needs from the runtime. */
export interface ExecutionEnvironment {
    sessions: SessionsExecutionFace;
    workspaces: WorkspacesExecutionFace;
    /** Raw-history reader for failure detection of never-opened sessions. */
    history?: HistoryExecutionFace;
    /** Guaranteed-fresh session creation (`sessions.create`); absent = reuse the workspace's own session only. */
    createSession?: SessionCreateFace;
    /** Official user-title write (pins against auto naming); absent = degrade to the binding driver. */
    renameSession?: SessionRenameFace;
    /** Applies a task's configured model route; absent = tasks always run on session defaults. */
    selectModel?: ModelSelectFace;
    /** Applies a task's configured agent preset; absent = sessions run on the deployment default. */
    selectAgentPreset?: AgentPresetSelectFace;
    /**
     * Fired after a preset switch SUCCEEDS (createSession + launch paths both
     * report here — the only two places a preset is ever applied). The
     * wiring records it into the applied-preset ledger (the display's
     * fallback — the host offers no read-back). Failures never fire (the
     * session kept its previous preset; recording it would be a lie).
     */
    onAgentApplied?: (sessionId: string, preset: string) => void;
    /** Sends comment continuations to existing execution sessions (host API). */
    sendComment?: CommentSendFace;
    /** Executes slash-command comment rounds through the native command registry. */
    sendCommand?: CommentCommandFace;
    /**
     * How long a matched command's session is watched for a real turn before
     * the command is judged a pure configuration command (one that logs its
     * lifecycle but never opens a turn — `/permission`, `/goal`, `/plan off`,
     * a bare `/plan`, …) and settled immediately. A command that DID start a
     * turn flips the session `running` right after the RPC resolves (the turn
     * begins before any model I/O), so this window only needs to cover the
     * command round-trip plus the agent loop's scheduling. Defaults to 2000ms.
     */
    commandGraceMs?: number;
}
/** The behavior verbs the service invokes on an execution session. */
export interface SessionDriver {
    rename(title: string): Promise<unknown>;
    prompt(content: readonly unknown[], mode: 'queue' | 'steer'): Promise<{
        ok: true;
    } | {
        ok: false;
        error: unknown;
    }>;
    /**
     * Execute one slash-command line against the session's agent (the native
     * write path for per-session switches such as `/permission <preset>`).
     * `value.matched` reports whether the host command registry recognized the
     * command name. NOTE: a recognized command may have started a real model
     * turn (e.g. `/plan <message>`); the permission path only relies on
     * `/permission` — which never opens a turn — and callers of the general
     * command path must observe the session, never trust `matched` alone.
     */
    command(line: string): Promise<{
        ok: true;
        value: {
            matched: boolean;
        };
    } | {
        ok: false;
        error: unknown;
    }>;
    getSnapshot(): {
        running: boolean;
        lastAgentError: string | null;
        turnEnds: ReadonlyMap<number, number>;
    };
    subscribe(fn: () => void): () => void;
}
/** Outcome events the service emits to the controller. */
export type ExecutionEvent = {
    kind: 'started';
    taskId: string;
    executionId: string;
    sessionId: string;
} | {
    kind: 'settled';
    taskId: string;
    executionId: string;
    outcome: 'succeeded' | 'failed' | 'cancelled';
    error?: string;
};
/**
 * The run configuration one fresh session is composed with (the task card's
 * own run-config slice — the same fields a run applies before its first
 * prompt). Absent fields follow the deployment defaults.
 */
export interface SessionLaunchConfig {
    workspaceId?: string;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    agentPreset?: string;
    permission?: string;
}
/** The result of {@link ExecutionService.createSession}. */
export type SessionLaunchResult = {
    ok: true;
    sessionId: string;
    configError?: string;
} | {
    ok: false;
    error: string;
};
/**
 * Default command-turn detection window: how long a matched command's session
 * is watched for a real turn before the command is judged a pure
 * configuration command (see `ExecutionEnvironment.commandGraceMs`).
 */
export declare const DEFAULT_COMMAND_GRACE_MS = 2000;
/** Launch options for {@link ExecutionService.run}. */
export interface RunOptions {
    /** The prompt text to send instead of the task's own (refine instructions, …). */
    prompt?: string;
    /** The session to run in instead of a freshly connected one (refine reuse). */
    sessionId?: string;
    /** Display name for the session (cosmetic rename; default = task title). */
    renameTo?: string;
    /**
     * Whether the session is freshly created: blank-session-only setup (agent
     * preset switch) applies only then. A reused session skips it. Defaults to
     * true (plain runs always start a fresh session).
     */
    fresh?: boolean;
    /**
     * Images to send with the prompt (the official temporary-bytes parts).
     * A plain run omits this and takes the TASK's own persisted prompt images;
     * a refine answer passes its freshly-attached images instead.
     */
    images?: readonly {
        mediaType: string;
        data: string;
        name?: string;
    }[];
    /**
     * File refs to send with the prompt (the official `{type:'file',
     * receiptId}` parts). Same override rule as images: a plain run omits this
     * and takes the TASK's own persisted prompt files.
     */
    files?: readonly {
        receiptId: string;
        name: string;
        bytes: number;
    }[];
}
/**
 * Run one task to completion (or to a settled failure).
 *
 * @param task - the task being executed.
 * @param execution - the freshly opened execution record (id + start time).
 * @param onEvent - callback for started/settled events.
 * @param options - launch variant (refine rounds reuse the task's refine
 *   session and send the refine instruction; see {@link RunOptions}).
 * @returns resolves when the run settles (or fails to start); never rejects —
 *   every failure path is reported as a settled event.
 */
export declare class ExecutionService {
    private readonly env;
    /** @param env - the runtime faces (real or fake). */
    constructor(env: ExecutionEnvironment);
    /**
     * Sessions missing from the host list, by consecutive passes that missed
     * them. A destructive verdict (cancel for "no longer exists") requires TWO
     * consecutive misses: a single absent snapshot is a list race (host
     * restart, pagination, a mid-rebuild read), never proof the session is
     * gone — and a one-pass cancel is exactly the "finished sessions fall back
     * to 待办" machine (the card's real outcome is discarded for a transient
     * gap). Seen sessions clear immediately.
     */
    private readonly missingSessions;
    /**
     * Create one guaranteed-fresh native session and compose it with a run
     * configuration — the board's "新建会话" engine. Deliberately NOT a task
     * execution: no execution record, no dispatcher, no watch. The session is
     * created first (via the createSession face; degraded to the workspace
     * blank-reuse entry when the face is absent), then the SAME per-session
     * setup chain a plain run uses is applied in the same order — model route,
     * agent preset (safe: a fresh session is always blank), permission.
     *
     * Failure policy: the session creation itself failing is THE failure (the
     * caller gets ok:false, nothing exists). A CONFIG step failing is NOT: the
     * session already exists on the host and is perfectly usable — it is
     * returned with `configError` so the caller can surface an honest partial
     * success instead of silently dropping a created session or pretending
     * nothing happened. Never rejects.
     */
    createSession(config: SessionLaunchConfig): Promise<SessionLaunchResult>;
    /**
     * Rename a native session with an explicit user title — the OFFICIAL
     * user-title write. Prefers the host-level face (any session id, exactly
     * like the comment channel); degraded to the client binding driver when
     * no face is wired (works only for sessions with a live binding). Never
     * rejects.
     */
    renameSession(sessionId: string, title: string): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
    /**
     * The session id a "new session" lands in: the createSession face wins
     * (a guaranteed-fresh host session); without it the workspace blank-reuse
     * entry degrades gracefully (the native New Session flow itself).
     */
    private resolveNewSessionId;
    run(task: TaskRecord, execution: ExecutionRecord, onEvent: (event: ExecutionEvent) => void, options?: RunOptions): Promise<void>;
    /**
     * Continue an existing execution session with a comment: send the text to
     * the session's agent (a fresh turn) and watch it settle like a plain run.
     * The comment round carries the same session — no new session is created.
     * Settlement uses the host session list + raw history signals, which work
     * for sessions that are not the currently staged one; when a binding
     * driver is available its snapshot watch is used as an additional fast
     * path. Never rejects: every failure path reports a settled event.
     *
     * A round flagged `command` is a slash command, not necessarily just a
     * turn: the line is executed through the native command registry (never
     * sent to the model as text). A matched command that opened a real turn
     * (e.g. `/plan <message>`) is watched to that turn's end — the board never
     * settles on `matched` alone, so a plan-mode turn stays 「进行中」 through
     * its plan review and execution — while a matched pure-configuration
     * command (e.g. `/permission`) settles right after the detection window. An
     * unmatched line falls back to plain-text delivery — the native
     * composer's default-sink semantics, so no user input is ever dropped.
     * Without a command face the round degrades to plain text.
     */
    commentRun(task: TaskRecord, execution: ExecutionRecord, sessionId: string, text: string, onEvent: (event: ExecutionEvent) => void, mode?: 'queue' | 'steer'): Promise<void>;
    /**
     * Deliver one slash-command line through the native command registry — the
     * single shared path for BOTH the execution prompt (run) and every comment
     * composer (review page / linked-session drive mode). Mirrors the native
     * composer's '/' semantics exactly:
     * - matched commands execute through the registry (never as prompt text);
     * - a matched command may START A REAL MODEL TURN (e.g. `/plan <message>`
     *   turns plan mode on and steers the message into the agent): the round is
     *   then watched until that turn truly settles — never on `matched` alone;
     * - a matched command that opens no turn (a pure configuration command:
     *   `/permission`, `/goal`, `/plan off`, a bare `/plan`, `/compact`, …)
     *   settles right after the bounded detection window;
     * - an unmatched line (or a missing command face) returns 'fallback' so the
     *   caller delivers the line as plain text (the native default-sink).
     * Never rejects: every failure path reports a settled event or 'fallback'.
     */
    private deliverCommandLine;
    /**
     * Watch a session after a matched command to decide whether it started real
     * model work (a turn) or was a pure configuration command. A turn's start
     * flips the session `running` (live list summary or driver snapshot) or, if
     * it finished unusually fast, grows the driver's turn-end counter past the
     * pre-command baseline; either proves the command opened a turn. When
     * `graceMs` elapses with no such evidence the command is judged a
     * configuration command. Subscriptions and the timer are always disposed.
     * @returns true = a turn started (the caller watches to its end); false =
     *   the command settled by itself (the caller settles the round at once).
     */
    private waitForCommandWork;
    /**
     * The resolved delivery line of a run: the prompt override / task prompt,
     * verbatim (no title fallback — `taskExecutable` is THE one execution
     * gate in the controller; the service never guesses intent from the title.
     * A blank line with no attachments fails fast in `run` below).
     */
    private promptLine;
    /**
     * Inspect a reloaded/background task that was left 'running' and emit a
     * settled event when its session already finished.
     *
     * A session that was never opened keeps a cold conversation snapshot (the
     * runtime only maintains the window for the staged/current session), so the
     * settled outcome is decided by the strongest available signal, in order:
     * 1. the list summary — missing session → cancelled; still running → pending;
     * 2. a warm conversation snapshot → `lastAgentError` decides failed/succeeded;
     * 3. the raw history tail (when a history face is wired) — a `turn/end`
     *    error reason proves failure;
     * 4. otherwise a finished session counts as succeeded.
     *
     * @param task - a task with an open round.
     * @param executionId - WHICH open round to judge. A card may run several
     *   sessions at once, so "the last record" is not "the running one"; the
     *   caller sweeps every open round and names the one it is asking about.
     *   Absent = the latest round (the legacy single-lane call).
     * @returns a settled event when the session state proves completion, else undefined.
     */
    reconcile(task: TaskRecord, executionId?: string): Promise<ExecutionEvent | undefined>;
    /**
     * Probe the raw history tail for a finished turn. Returns the outcome the
     * turn proves — 'failed' when its `turn/end` carries an error reason,
     * 'succeeded' for any other `turn/end` — or undefined when the tail shows
     * no turn at all (the session was created but never ran) or history is
     * unavailable. A failed history read must not block settlement; it reports
     * "no signal" and the caller decides.
     */
    private historyTurnEndSignal;
    private connectSession;
    private driverOf;
    private sendPrompt;
    /**
     * Apply a task's permission preset to the execution session through the
     * native `/permission` command (the GUI picker's write path). A rejected
     * command or a name the host does not recognize reports failure so the
     * caller can settle the run; the command itself never starts a turn.
     */
    private applyPermission;
    /**
     * Subscribe to the execution session and settle the run once the accepted
     * turn completes (turn counter advanced past the acceptance baseline and
     * the session is no longer running). Never settles while the session is
     * still running; unsubscribes on settle.
     *
     * The execution session is usually NOT the UI's current session, so its
     * conversation snapshot stays cold (the runtime only maintains the window
     * for the staged/current session) and the driver watch above would never
     * observe the turn — and for comment continuations the session may not
     * even have a binding. The host session list is the completion signal
     * there: subscribe to it as well, and settle once the list reports the
     * session no longer running AND a turn actually finished (driver snapshot
     * or raw history tail) — a session that was merely created but never
     * started (queue window) must not settle.
     */
    private watchForSettlement;
}
