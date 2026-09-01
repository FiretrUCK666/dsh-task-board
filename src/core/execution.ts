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
import type { ExecutionRecord, TaskRecord } from './tasks.ts'

/** The narrow sessions face the service needs. */
export interface SessionsExecutionFace {
  list: {
    getSnapshot(): {
      /** Baseline arrival lifecycle — 'pending' until the host list has loaded. */
      phase: 'pending' | 'ready'
      byId: Record<string, { running: boolean; completed?: boolean }>
    }
    subscribe(fn: () => void): () => void
  }
  binding(id: string): { session: SessionDriver } | undefined
}

/** The narrow workspaces face the service needs. */
export interface WorkspacesExecutionFace {
  list: {
    getSnapshot(): {
      items: readonly {
        workspaceId: string
        /** The workspace's own working directory (alpha.3 official `path`). */
        path?: string
        /** Sessions the workspace owns (alpha.3 official `sessionIds`). */
        sessionIds?: readonly string[]
      }[]
      recentWorkspaceId: string | undefined
    }
  }
}

/**
 * Optional host session-creation face: resolves a guaranteed-FRESH session
 * (`sessions.create` on the client runtime; the host guarantees the session
 * lands in the list store and is addressable by resolution). Absent, a
 * workspace with no sessions cannot start a run (see {@link ExecutionService.connectSession}).
 */
export interface SessionCreateFace {
  (workspaceId: string | undefined): Promise<string>
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
  (sessionId: string, title: string): Promise<{ ok: true } | { ok: false; error: string }>
}

/** One raw session-history event narrowed to the failure signal reconcile needs. */
export interface ExecutionHistoryEvent {
  type: string
  data?: unknown
}

/** Optional raw-history face used to detect failures of never-opened sessions. */
export interface HistoryExecutionFace {
  loadTail(sessionId: string): Promise<{ events: readonly ExecutionHistoryEvent[] } | undefined>
}

/** One model selection submitted to the host for an execution session. */
export interface ModelSelectionInput {
  provider: string
  model: string
  reasoningEffort?: string
}

/** Optional model-selection face: applies a per-task model route before prompting. */
export interface ModelSelectFace {
  (sessionId: string, selection: ModelSelectionInput): Promise<{ ok: true } | { ok: false; error: string }>
}

/** Optional agent-preset face: composes the execution session from a preset before prompting. */
export interface AgentPresetSelectFace {
  (sessionId: string, agentPreset: string): Promise<{ ok: true } | { ok: false; error: string }>
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
  (sessionId: string, text: string, mode?: 'queue' | 'steer'): Promise<{ ok: true } | { ok: false; error: string }>
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
  (sessionId: string, line: string): Promise<
    | { ok: true; matched: boolean; outcome?: { kind: 'success' | 'error'; text?: string } }
    | { ok: false; error: string }
  >
}

/** Everything the service needs from the runtime. */
export interface ExecutionEnvironment {
  sessions: SessionsExecutionFace
  workspaces: WorkspacesExecutionFace
  /** Raw-history reader for failure detection of never-opened sessions. */
  history?: HistoryExecutionFace
  /** Guaranteed-fresh session creation (never blank-reuse); absent = degrade to connectWorkspace. */
  createSession?: SessionCreateFace
  /** Official user-title write (pins against auto naming); absent = degrade to the binding driver. */
  renameSession?: SessionRenameFace
  /** Applies a task's configured model route; absent = tasks always run on session defaults. */
  selectModel?: ModelSelectFace
  /** Applies a task's configured agent preset; absent = sessions run on the deployment default. */
  selectAgentPreset?: AgentPresetSelectFace
  /** Sends comment continuations to existing execution sessions (host API). */
  sendComment?: CommentSendFace
  /** Executes slash-command comment rounds through the native command registry. */
  sendCommand?: CommentCommandFace
  /**
   * How long a matched command's session is watched for a real turn before
   * the command is judged a pure configuration command (one that logs its
   * lifecycle but never opens a turn — `/permission`, `/goal`, `/plan off`,
   * a bare `/plan`, …) and settled immediately. A command that DID start a
   * turn flips the session `running` right after the RPC resolves (the turn
   * begins before any model I/O), so this window only needs to cover the
   * command round-trip plus the agent loop's scheduling. Defaults to 2000ms.
   */
  commandGraceMs?: number
}

/** The behavior verbs the service invokes on an execution session. */
export interface SessionDriver {
  rename(title: string): Promise<unknown>
  prompt(
    content: readonly unknown[],
    mode: 'queue' | 'steer',
  ): Promise<{ ok: true } | { ok: false; error: unknown }>
  /**
   * Execute one slash-command line against the session's agent (the native
   * write path for per-session switches such as `/permission <preset>`).
   * `value.matched` reports whether the host command registry recognized the
   * command name. NOTE: a recognized command may have started a real model
   * turn (e.g. `/plan <message>`); the permission path only relies on
   * `/permission` — which never opens a turn — and callers of the general
   * command path must observe the session, never trust `matched` alone.
   */
  command(line: string): Promise<
    { ok: true; value: { matched: boolean } } | { ok: false; error: unknown }
  >
  getSnapshot(): { running: boolean; lastAgentError: string | null; turnEnds: ReadonlyMap<number, number> }
  subscribe(fn: () => void): () => void
}

/** Outcome events the service emits to the controller. */
export type ExecutionEvent =
  | { kind: 'started'; taskId: string; executionId: string; sessionId: string }
  | { kind: 'settled'; taskId: string; executionId: string; outcome: 'succeeded' | 'failed' | 'cancelled'; error?: string }

/**
 * The run configuration one fresh session is composed with (the task card's
 * own run-config slice — the same fields a run applies before its first
 * prompt). Absent fields follow the deployment defaults.
 */
export interface SessionLaunchConfig {
  workspaceId?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  agentPreset?: string
  permission?: string
}

/** The result of {@link ExecutionService.createSession}. */
export type SessionLaunchResult =
  | { ok: true; sessionId: string; configError?: string }
  | { ok: false; error: string }

/** Human copy for a run failure. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Default command-turn detection window: how long a matched command's session
 * is watched for a real turn before the command is judged a pure
 * configuration command (see `ExecutionEnvironment.commandGraceMs`).
 */
export const DEFAULT_COMMAND_GRACE_MS = 2_000

/** Whether a `turn/end` payload closed the turn with an error reason. */
function isErrorTurnEnd(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const reason = (data as { reason?: unknown }).reason
  return typeof reason === 'object' && reason !== null
    && (reason as { kind?: unknown }).kind === 'error'
}

/** Launch options for {@link ExecutionService.run}. */
export interface RunOptions {
  /** The prompt text to send instead of the task's own (refine instructions, …). */
  prompt?: string
  /** The session to run in instead of a freshly connected one (refine reuse). */
  sessionId?: string
  /** Display name for the session (cosmetic rename; default = task title). */
  renameTo?: string
  /**
   * Whether the session is freshly created: blank-session-only setup (agent
   * preset switch) applies only then. A reused session skips it. Defaults to
   * true (plain runs always start a fresh session).
   */
  fresh?: boolean
  /**
   * Images to send with the prompt (the official temporary-bytes parts).
   * A plain run omits this and takes the TASK's own persisted prompt images;
   * a refine answer passes its freshly-attached images instead.
   */
  images?: readonly { mediaType: string; data: string; name?: string }[]
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
export class ExecutionService {
  /** @param env - the runtime faces (real or fake). */
  constructor(private readonly env: ExecutionEnvironment) {}

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
  async createSession(config: SessionLaunchConfig): Promise<SessionLaunchResult> {
    try {
      const sessionId = await this.resolveNewSessionId(config.workspaceId)
      const driver = this.driverOf(sessionId)
      if (driver === undefined) {
        return { ok: true, sessionId, configError: 'execution session is not ready' }
      }
      let configError: string | undefined
      if (config.provider !== undefined && config.model !== undefined && this.env.selectModel !== undefined) {
        const selection = await this.env.selectModel(sessionId, {
          provider: config.provider,
          model: config.model,
          ...config.reasoningEffort !== undefined ? { reasoningEffort: config.reasoningEffort } : {},
        })
        if (!selection.ok) configError = `model selection failed: ${selection.error}`
      }
      if (configError === undefined && config.agentPreset !== undefined && this.env.selectAgentPreset !== undefined) {
        const applied = await this.env.selectAgentPreset(sessionId, config.agentPreset)
        if (!applied.ok) configError = `agent preset switch failed: ${applied.error}`
      }
      if (configError === undefined && config.permission !== undefined) {
        const applied = await this.applyPermission(driver, config.permission)
        if (!applied.ok) configError = applied.error
      }
      return { ok: true, sessionId, ...configError !== undefined ? { configError } : {} }
    } catch (error) {
      return { ok: false, error: messageOf(error) }
    }
  }

  /**
   * Rename a native session with an explicit user title — the OFFICIAL
   * user-title write. Prefers the host-level face (any session id, exactly
   * like the comment channel); degraded to the client binding driver when
   * no face is wired (works only for sessions with a live binding). Never
   * rejects.
   */
  async renameSession(sessionId: string, title: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const trimmed = title.trim()
    if (trimmed === '') return { ok: false, error: 'empty title' }
    if (this.env.renameSession !== undefined) {
      return this.env.renameSession(sessionId, trimmed)
    }
    const driver = this.driverOf(sessionId)
    if (driver === undefined) return { ok: false, error: 'rename channel unavailable' }
    try {
      const result = await driver.rename(trimmed) as { ok: true } | { ok: false; error: unknown }
      return result.ok ? { ok: true } : { ok: false, error: messageOf(result.error) }
    } catch (error) {
      return { ok: false, error: messageOf(error) }
    }
  }

  /**
   * The session id a "new session" lands in: the createSession face wins
   * (a guaranteed-fresh host session); without it the workspace blank-reuse
   * entry degrades gracefully (the native New Session flow itself).
   */
  private async resolveNewSessionId(workspaceId?: string): Promise<string> {
    if (this.env.createSession !== undefined) {
      const workspace = this.env.workspaces.list.getSnapshot()
      const resolved = workspaceId ?? workspace.recentWorkspaceId ?? workspace.items[0]?.workspaceId
      if (resolved === undefined) {
        throw new Error('no workspace available to run the task in')
      }
      return this.env.createSession(resolved)
    }
    return this.connectSession(workspaceId)
  }

  async run(
    task: TaskRecord,
    execution: ExecutionRecord,
    onEvent: (event: ExecutionEvent) => void,
    options?: RunOptions,
  ): Promise<void> {
    try {
      const sessionId = options?.sessionId ?? await this.connectSession(task.workspaceId)
      const fresh = options?.fresh ?? true
      onEvent({ kind: 'started', taskId: task.id, executionId: execution.id, sessionId })
      const driver = this.driverOf(sessionId)
      if (driver === undefined) {
        onEvent({ kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed', error: 'execution session is not ready' })
        return
      }
      // Best-effort rename so the execution is recognizable in the session list.
      await driver.rename(options?.renameTo ?? task.title).catch(() => { /* rename is cosmetic */ })
      // Apply the task's configured model route before the first prompt.
      if (task.provider !== undefined && task.model !== undefined && this.env.selectModel !== undefined) {
        const selection = await this.env.selectModel(sessionId, {
          provider: task.provider,
          model: task.model,
          ...task.reasoningEffort !== undefined ? { reasoningEffort: task.reasoningEffort } : {},
        })
        if (!selection.ok) {
          onEvent({
            kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed',
            error: `model selection failed: ${selection.error}`,
          })
          return
        }
      }
      // Apply the task's configured agent preset before the first prompt: a
      // session may only adopt a preset while it is still blank (no turn has
      // run), so this must happen before any prompt is sent — and only on a
      // freshly created session (a reused refine session already has turns).
      // A rejected switch (session no longer blank, preset missing…) fails
      // the run.
      if (fresh && task.agentPreset !== undefined && this.env.selectAgentPreset !== undefined) {
        const applied = await this.env.selectAgentPreset(sessionId, task.agentPreset)
        if (!applied.ok) {
          onEvent({
            kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed',
            error: `agent preset switch failed: ${applied.error}`,
          })
          return
        }
      }
      // Apply the task's configured permission preset through the native
      // `/permission` command — the same write path the GUI's permission
      // picker uses — before the first prompt, while the session is still
      // blank. An unrecognized preset or a host without the command fails the
      // run like a rejected agent-preset switch.
      if (task.permission !== undefined) {
        const applied = await this.applyPermission(driver, task.permission)
        if (!applied.ok) {
          onEvent({
            kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed',
            error: applied.error,
          })
          return
        }
      }
      // Resolve the delivery line first: a slash line routes through the
      // native command registry — the composer's '/' path, never the plain
      // prompt, which would deliver the line to the model as text (the
      // "command doesn't work" symptom). The registry path owns its own
      // baseline and settlement watch; a fallback means the line goes out as
      // plain text with the normal watch below.
      const line = this.promptLine(task, options?.prompt)
      if (this.env.sendCommand !== undefined && line.trimStart().startsWith('/')) {
        const routed = await this.deliverCommandLine(task, execution, sessionId, line.trim(), onEvent, false)
        if (routed !== 'fallback') return
      }
      // Baseline the turn counter BEFORE the prompt round-trip: a turn that
      // completes while prompt is in flight must still advance past this
      // baseline, or the watch below would never observe it settle.
      const baseline = driver.getSnapshot().turnEnds.size
      const accepted = await this.sendPrompt(driver, task, options?.prompt, options?.images)
      if (!accepted.ok) {
        onEvent({
          kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed',
          error: messageOf(accepted.error),
        })
        return
      }
      this.watchForSettlement(driver, task.id, execution.id, sessionId, onEvent, baseline)
    } catch (error) {
      onEvent({
        kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed',
        error: messageOf(error),
      })
    }
  }

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
  async commentRun(
    task: TaskRecord,
    execution: ExecutionRecord,
    sessionId: string,
    text: string,
    onEvent: (event: ExecutionEvent) => void,
    mode: 'queue' | 'steer' = 'queue',
  ): Promise<void> {
    try {
      if (execution.command === true) {
        const routed = await this.deliverCommandLine(task, execution, sessionId, text, onEvent, true)
        if (routed === 'fallback') {
          // Unknown command (or no registry): the native default-sink —
          // deliver the line as text, never drop the user's input.
          await this.commentRun(task, { ...execution, command: false }, sessionId, text, onEvent, mode)
        }
        return
      }
      const driver = this.driverOf(sessionId)
      const send = this.env.sendComment
        ?? (async (id, content) => {
          const bound = this.driverOf(id)
          if (bound === undefined) return { ok: false as const, error: 'comment session is not ready' }
          return bound.prompt([{ type: 'text', text: content }], mode)
        })
      const result = await send(sessionId, text, mode)
      if (!result.ok) {
        onEvent({
          kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed',
          error: `comment rejected: ${result.error}`,
        })
        return
      }
      const baseline = driver !== undefined ? driver.getSnapshot().turnEnds.size : 0
      // The session already exists (it ran the reviewed execution), so its
      // disappearance from the host list means it was deleted/archived —
      // that is a cancellation, never a wait-forever.
      this.watchForSettlement(driver, task.id, execution.id, sessionId, onEvent, baseline, true)
    } catch (error) {
      onEvent({
        kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed',
        error: messageOf(error),
      })
    }
  }

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
  private async deliverCommandLine(
    task: TaskRecord,
    execution: ExecutionRecord,
    sessionId: string,
    line: string,
    onEvent: (event: ExecutionEvent) => void,
    sessionKnown: boolean,
  ): Promise<'watched' | 'settled' | 'fallback'> {
    const command = this.env.sendCommand
    if (command === undefined) return 'fallback'
    const result = await command(sessionId, line)
    if (!result.ok) {
      onEvent({
        kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed',
        error: `command rejected: ${result.error}`,
      })
      return 'settled'
    }
    if (!result.matched) return 'fallback'
    // The registry recognized the line: it always logs its lifecycle and the
    // command may additionally have started a real turn. Decide by observing
    // the session — never by the match alone.
    const driver = this.driverOf(sessionId)
    const baseline = driver !== undefined ? driver.getSnapshot().turnEnds.size : 0
    const outcome = result.outcome
    if (outcome?.kind === 'error') {
      onEvent({
        kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed',
        error: outcome.text,
      })
      return 'settled'
    }
    const startedTurn = await this.waitForCommandWork(
      sessionId, baseline, this.env.commandGraceMs ?? DEFAULT_COMMAND_GRACE_MS)
    if (startedTurn) {
      // Real work: watch the session until that turn truly settles. A plan
      // review wait keeps the session `running`, so the round stays open
      // through the wait exactly like a plain turn awaiting the user.
      this.watchForSettlement(driver, task.id, execution.id, sessionId, onEvent, baseline, sessionKnown)
      return 'watched'
    }
    // Pure configuration command: no turn opened. Settle immediately; the
    // command's outcome text rides the error field for display (comment
    // threads show it under the line).
    onEvent({
      kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'succeeded',
      ...outcome !== undefined && outcome.text !== undefined && outcome.text !== ''
        ? { error: outcome.text }
        : {},
    })
    return 'settled'
  }

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
  private waitForCommandWork(sessionId: string, baseline: number, graceMs: number): Promise<boolean> {
    return new Promise(resolve => {
      let done = false
      const disposers: Array<() => void> = []
      const finish = (startedTurn: boolean): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        for (const dispose of disposers) dispose()
        resolve(startedTurn)
      }
      const timer = setTimeout(() => finish(false), graceMs)
      const check = (): void => {
        if (done) return
        const summary = this.env.sessions.list.getSnapshot().byId[sessionId]
        if (summary !== undefined && summary.running) { finish(true); return }
        const driver = this.driverOf(sessionId)
        if (driver !== undefined) {
          const snapshot = driver.getSnapshot()
          if (snapshot.running || snapshot.turnEnds.size > baseline) { finish(true); return }
        }
      }
      disposers.push(this.env.sessions.list.subscribe(check))
      const driver = this.driverOf(sessionId)
      if (driver !== undefined) disposers.push(driver.subscribe(check))
      check()
    })
  }

  /**
   * The resolved delivery line of a run: the prompt override / task prompt,
   * falling back to the task title when blank (mirrors {@link sendPrompt}).
   */
  private promptLine(task: TaskRecord, promptOverride: string | undefined): string {
    return (promptOverride ?? task.prompt).trim() !== ''
      ? (promptOverride ?? task.prompt)
      : task.title
  }

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
  async reconcile(task: TaskRecord, executionId?: string): Promise<ExecutionEvent | undefined> {
    const execution = executionId === undefined
      ? task.executions[task.executions.length - 1]
      : task.executions.find(candidate => candidate.id === executionId)
    if (execution === undefined || execution.sessionId === undefined || execution.endedAt !== undefined) return undefined
    const list = this.env.sessions.list.getSnapshot()
    // The host list baseline has not arrived yet (page load): a session "not
    // found" now would be a false cancel. Wait for a later list change.
    if (list.phase !== 'ready') return undefined
    const summary = list.byId[execution.sessionId]
    if (summary === undefined) {
      return { kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'cancelled', error: 'execution session no longer exists' }
    }
    if (summary.running) return undefined
    const driver = this.driverOf(execution.sessionId)
    if (driver !== undefined) {
      const snapshot = driver.getSnapshot()
      if (snapshot.turnEnds.size > 0) {
        const outcome = snapshot.lastAgentError !== null ? 'failed' : 'succeeded'
        return {
          kind: 'settled', taskId: task.id, executionId: execution.id, outcome,
          error: snapshot.lastAgentError ?? undefined,
        }
      }
    }
    // Cold session: the driver snapshot never advances, so prove the finished
    // session from the raw history tail — a `turn/end` entry means the run
    // actually executed. Without any turn evidence the session may still be
    // sitting in the queue (created but not started), so stay pending.
    const signal = await this.historyTurnEndSignal(execution.sessionId)
    if (signal !== undefined) {
      return {
        kind: 'settled', taskId: task.id, executionId: execution.id, outcome: signal,
        error: signal === 'failed' ? 'agent turn failed' : undefined,
      }
    }
    // No history face wired: keep the legacy optimistic fallback so a
    // finished-but-unverifiable session still settles.
    if (this.env.history === undefined) {
      return { kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'succeeded' }
    }
    return undefined
  }

  /**
   * Probe the raw history tail for a finished turn. Returns the outcome the
   * turn proves — 'failed' when its `turn/end` carries an error reason,
   * 'succeeded' for any other `turn/end` — or undefined when the tail shows
   * no turn at all (the session was created but never ran) or history is
   * unavailable. A failed history read must not block settlement; it reports
   * "no signal" and the caller decides.
   */
  private async historyTurnEndSignal(sessionId: string): Promise<'succeeded' | 'failed' | undefined> {
    const history = this.env.history
    if (history === undefined) return undefined
    try {
      const tail = await history.loadTail(sessionId)
      if (tail === undefined) return undefined
      for (const event of tail.events) {
        if (event.type === 'turn/end') {
          return isErrorTurnEnd(event.data) ? 'failed' : 'succeeded'
        }
      }
      return undefined
    } catch (error) {
      console.error('[dsh-task-board] history turn probe failed', error)
      return undefined
    }
  }

  private async connectSession(workspaceId?: string): Promise<string> {
    const workspace = this.env.workspaces.list.getSnapshot()
    const resolved = workspaceId ?? workspace.recentWorkspaceId ?? workspace.items[0]?.workspaceId
    if (resolved === undefined) {
      throw new Error('no workspace available to run the task in')
    }
    // alpha.3: a workspace owns its sessions (the official `sessionIds` on
    // the workspace view). Reuse its first session; a workspace with none
    // falls back to the createSession face (host `sessions.create`).
    const row = workspace.items.find(item => item.workspaceId === resolved)
    const existing = row?.sessionIds?.[0]
    if (existing !== undefined) return existing
    if (this.env.createSession !== undefined) {
      return this.env.createSession(resolved)
    }
    throw new Error('no session available to run the task in: the workspace has none and session creation is unavailable')
  }

  private driverOf(sessionId: string): SessionDriver | undefined {
    return this.env.sessions.binding(sessionId)?.session
  }

  private async sendPrompt(
    driver: SessionDriver,
    task: TaskRecord,
    promptOverride: string | undefined,
    images?: readonly { mediaType: string; data: string; name?: string }[],
  ): Promise<{ ok: true } | { ok: false; error: unknown }> {
    const text = (promptOverride ?? task.prompt).trim() !== ''
      ? (promptOverride ?? task.prompt)
      : task.title
    // The prompt's images: an explicit override (a refine answer's fresh
    // attachments) wins; otherwise the TASK's persisted prompt images ride
    // EVERY run path (manual / scheduled / cruise / chain / rerun) — one
    // prompt, one picture, wherever it fires from. The parts are the OFFICIAL
    // image shape (temporary bytes the host admits durably).
    const attached = images ?? task.promptImages ?? []
    const parts: readonly unknown[] = [
      ...(text === '' ? [] : [{ type: 'text', text }]),
      ...attached.map(image => ({
        type: 'image',
        mediaType: image.mediaType,
        data: image.data,
        ...(image.name !== undefined ? { name: image.name } : {}),
      })),
    ]
    try {
      const result = await driver.prompt(parts, 'queue')
      return result
    } catch (error) {
      return { ok: false, error }
    }
  }

  /**
   * Apply a task's permission preset to the execution session through the
   * native `/permission` command (the GUI picker's write path). A rejected
   * command or a name the host does not recognize reports failure so the
   * caller can settle the run; the command itself never starts a turn.
   */
  private async applyPermission(
    driver: SessionDriver,
    permission: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const result = await driver.command(`/permission ${permission}`)
      if (!result.ok) {
        return { ok: false, error: `permission switch failed: ${messageOf(result.error)}` }
      }
      if (!result.value.matched) {
        return { ok: false, error: `permission switch failed: the host offers no /permission command for "${permission}"` }
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: `permission switch failed: ${messageOf(error)}` }
    }
  }

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
  private watchForSettlement(
    driver: SessionDriver | undefined,
    taskId: string,
    executionId: string,
    sessionId: string,
    onEvent: (event: ExecutionEvent) => void,
    baseline: number,
    /** Whether the session is known to have existed before this watch (a
     *  comment continuation): a later disappearance from the host list is a
     *  cancellation, never a creation-in-flight wait. */
    sessionKnown = false,
  ): void {
    let settled = false
    let unsubscribe: Array<() => void> = []
    const settle = (outcome: 'succeeded' | 'failed' | 'cancelled', error?: string): void => {
      if (settled) return
      settled = true
      for (const dispose of unsubscribe) dispose()
      onEvent({
        kind: 'settled', taskId, executionId,
        outcome,
        error,
      })
    }
    const check = (): void => {
      if (settled || driver === undefined) return
      const snapshot = driver.getSnapshot()
      if (snapshot.running || snapshot.turnEnds.size <= baseline) return
      settle(snapshot.lastAgentError !== null ? 'failed' : 'succeeded', snapshot.lastAgentError ?? undefined)
    }
    const checkList = (): void => {
      if (settled) return
      const list = this.env.sessions.list.getSnapshot()
      if (list.phase !== 'ready') return
      const summary = list.byId[sessionId]
      if (summary === undefined) {
        // A known session that vanished was deleted/archived: settle as
        // cancelled instead of waiting forever. Fresh runs keep waiting —
        // their session may still be mid-creation.
        if (sessionKnown) settle('cancelled', 'comment session no longer exists')
        return
      }
      // Still running: keep watching.
      if (summary.running) return
      const snapshot = driver?.getSnapshot()
      if (snapshot !== undefined && snapshot.turnEnds.size > baseline) {
        settle(snapshot.lastAgentError !== null ? 'failed' : 'succeeded', snapshot.lastAgentError ?? undefined)
        return
      }
      void this.historyTurnEndSignal(sessionId).then(signal => {
        if (signal !== undefined) {
          settle(signal, signal === 'failed' ? 'agent turn failed' : undefined)
        }
      })
    }
    unsubscribe = [this.env.sessions.list.subscribe(checkList)]
    if (driver !== undefined) unsubscribe.push(driver.subscribe(check))
    // A turn can complete during the prompt round-trip (before subscribe):
    // re-check immediately so a fast turn is never missed.
    check()
    checkList()
  }
}
