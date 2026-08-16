/**
 * Execution service: runs a task through dsh's real session machinery.
 *
 * The board's "run" button must make dsh actually work, not fake a status:
 * the service connects a real session (workspace blank-session reuse or
 * `session.create` on the host via the workspaces service), renames it to
 * the task title, sends the task prompt with `session.prompt`, and then
 * watches the session's conversation snapshot until its turn settles. The
 * task board controller consumes {@link ExecutionEvent}s to move the card
 * running → done/failed and to keep the execution record.
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
      items: readonly { workspaceId: string }[]
      recentWorkspaceId: string | undefined
    }
  }
  connectWorkspace(workspaceId: string): Promise<string>
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
 */
export interface CommentSendFace {
  (sessionId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }>
}

/**
 * Optional slash-command face: executes one command line against an existing
 * execution session through the native command registry (the same
 * `remote.commands.execute` RPC the composer's '/' submissions use — never
 * the plain prompt path, which would deliver the line to the model as text).
 * `matched` reports whether the registry recognized the name; when it did,
 * `outcome` carries the command's settled result (a recognized command may
 * still fail, e.g. an unknown preset name). When absent the service treats
 * command rounds as plain text.
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
  /** Applies a task's configured model route; absent = tasks always run on session defaults. */
  selectModel?: ModelSelectFace
  /** Applies a task's configured agent preset; absent = sessions run on the deployment default. */
  selectAgentPreset?: AgentPresetSelectFace
  /** Sends comment continuations to existing execution sessions (host API). */
  sendComment?: CommentSendFace
  /** Executes slash-command comment rounds through the native command registry. */
  sendCommand?: CommentCommandFace
}

/** The behavior verbs the service invokes on an execution session. */
export interface SessionDriver {
  rename(title: string): Promise<unknown>
  prompt(
    content: readonly unknown[],
    mode: 'queue',
  ): Promise<{ ok: true } | { ok: false; error: unknown }>
  /**
   * Execute one slash-command line against the session's agent (the native
   * write path for per-session switches such as `/permission <preset>`).
   * `value.matched` reports whether the host command registry recognized the
   * command name.
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

/** Human copy for a run failure. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Whether a `turn/end` payload closed the turn with an error reason. */
function isErrorTurnEnd(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const reason = (data as { reason?: unknown }).reason
  return typeof reason === 'object' && reason !== null
    && (reason as { kind?: unknown }).kind === 'error'
}

/**
 * Run one task to completion (or to a settled failure).
 *
 * @param task - the task being executed.
 * @param execution - the freshly opened execution record (id + start time).
 * @param onEvent - callback for started/settled events.
 * @returns resolves when the run settles (or fails to start); never rejects —
 *   every failure path is reported as a settled event.
 */
export class ExecutionService {
  /** @param env - the runtime faces (real or fake). */
  constructor(private readonly env: ExecutionEnvironment) {}

  async run(
    task: TaskRecord,
    execution: ExecutionRecord,
    onEvent: (event: ExecutionEvent) => void,
  ): Promise<void> {
    try {
      const sessionId = await this.connectSession(task.workspaceId)
      onEvent({ kind: 'started', taskId: task.id, executionId: execution.id, sessionId })
      const driver = this.driverOf(sessionId)
      if (driver === undefined) {
        onEvent({ kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed', error: 'execution session is not ready' })
        return
      }
      // Best-effort rename so the execution is recognizable in the session list.
      await driver.rename(task.title).catch(() => { /* rename is cosmetic */ })
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
      // run), so this must happen before any prompt is sent. A rejected
      // switch (session no longer blank, preset missing…) fails the run.
      if (task.agentPreset !== undefined && this.env.selectAgentPreset !== undefined) {
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
      // Baseline the turn counter BEFORE the prompt round-trip: a turn that
      // completes while prompt is in flight must still advance past this
      // baseline, or the watch below would never observe it settle.
      const baseline = driver.getSnapshot().turnEnds.size
      const accepted = await this.sendPrompt(driver, task)
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
   * A round flagged `command` is a slash command, not a turn: it is executed
   * through the native command registry (never sent to the model as text).
   * A matched command settles immediately as succeeded (its outcome text is
   * carried in the error field for display); an unmatched line falls back to
   * plain-text delivery — the native composer's default-sink semantics, so
   * no user input is ever dropped. Without a command face the round degrades
   * to plain text.
   */
  async commentRun(
    task: TaskRecord,
    execution: ExecutionRecord,
    sessionId: string,
    text: string,
    onEvent: (event: ExecutionEvent) => void,
  ): Promise<void> {
    try {
      if (execution.command === true) {
        await this.runCommentCommand(task, execution, sessionId, text, onEvent)
        return
      }
      const driver = this.driverOf(sessionId)
      const send = this.env.sendComment
        ?? (async (id, content) => {
          const bound = this.driverOf(id)
          if (bound === undefined) return { ok: false as const, error: 'comment session is not ready' }
          return bound.prompt([{ type: 'text', text: content }], 'queue')
        })
      const result = await send(sessionId, text)
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
   * Execute a slash-command comment round through the native command
   * registry (see {@link CommentCommandFace}). A matched command settles
   * immediately — the host durably logs its lifecycle and the outcome is a
   * flow node, never a model turn, so there is nothing to watch. An
   * unmatched line (or a missing command face) falls back to the plain-text
   * path, preserving the native "unknown command → send as text" behavior.
   */
  private async runCommentCommand(
    task: TaskRecord,
    execution: ExecutionRecord,
    sessionId: string,
    line: string,
    onEvent: (event: ExecutionEvent) => void,
  ): Promise<void> {
    const command = this.env.sendCommand
    if (command === undefined) {
      // No native command surface: degrade to a plain-text comment round.
      await this.commentRun(task, { ...execution, command: false }, sessionId, line, onEvent)
      return
    }
    const result = await command(sessionId, line)
    if (!result.ok) {
      onEvent({
        kind: 'settled', taskId: task.id, executionId: execution.id, outcome: 'failed',
        error: `command rejected: ${result.error}`,
      })
      return
    }
    if (!result.matched) {
      // Unknown command: native default-sink — deliver the line as text.
      await this.commentRun(task, { ...execution, command: false }, sessionId, line, onEvent)
      return
    }
    // The registry recognized the line and logged its lifecycle; the command
    // itself may still report failure (e.g. an unknown preset name) — that
    // is a failed round, never a model turn.
    const outcome = result.outcome
    onEvent({
      kind: 'settled', taskId: task.id, executionId: execution.id,
      outcome: outcome?.kind === 'error' ? 'failed' : 'succeeded',
      ...outcome !== undefined && outcome.text !== undefined && outcome.text !== ''
        ? { error: outcome.text }
        : {},
    })
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
   * @param task - a task whose latest execution has no endedAt.
   * @returns a settled event when the session state proves completion, else undefined.
   */
  async reconcile(task: TaskRecord): Promise<ExecutionEvent | undefined> {
    const execution = task.executions[task.executions.length - 1]
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
    return this.env.workspaces.connectWorkspace(resolved)
  }

  private driverOf(sessionId: string): SessionDriver | undefined {
    return this.env.sessions.binding(sessionId)?.session
  }

  private async sendPrompt(
    driver: SessionDriver,
    task: TaskRecord,
  ): Promise<{ ok: true } | { ok: false; error: unknown }> {
    const text = task.prompt.trim() !== '' ? task.prompt : task.title
    try {
      const result = await driver.prompt([{ type: 'text', text }], 'queue')
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
