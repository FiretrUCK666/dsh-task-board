/**
 * Session posture (host half): the four questions about a conversation that the
 * board and the model must answer with ONE derivation — is it working, is it
 * archived, is it parked waiting for an approval, is it parked waiting for an
 * answer. The model gets its answers from here, so a second derivation on the
 * AI side would be a second opinion on the same fact.
 *
 * NOT `session-state-route.ts`. That one is the narrow read-only bridge the
 * comment surfaces use (plan mode, goal, subagents); this one is the posture
 * the AI queries. They read the same services and share no derivation, so
 * they are named apart: the route serves a *view of a session's own state*,
 * this answers *what is true of the session right now*.
 *
 * ── WHAT EACH ANSWER IS ACTUALLY MADE OF (all four checked against the
 * installed packages, not assumed) ────────────────────────────────────────────
 *
 *  - WORKING: `agent.status`, whose own type is `'idle' | 'running'`. A
 *    native fact with no interpretation on our side. Note that a session
 *    waiting for an approval is `running`: the turn is alive, it is the human
 *    who is not there — so "running" and "waiting" are not opposites, and a
 *    reader that treats them as such drops half the truth.
 *  - ARCHIVED: `workspaceRegistry.archivedSessionIds` — a first-class field,
 *    orthogonal to workspace membership. "Not a member" and "archived" are
 *    different facts and only one of them is this.
 *  - WAITING FOR AN APPROVAL: the session log. An `approval/asked` event is
 *    paired by its `id` with the `approval/decided` that the host's own
 *    contract guarantees to append exactly once per ask. So the answer is a
 *    set difference over the log — a durable, replayable fact, not an
 *    inference about how long a tool has been silent.
 *  - WAITING FOR AN ANSWER: NOT IN THE LOG. The question waterfall
 *    (`user-questions/request`) is in-flight only, so the durable log cannot
 *    answer it. We bracket the dispatch instead (see
 *    {@link attachQuestionWaitRecorder}).
 *
 * ── WHY THE BYPASS IS SAFE (verified, not assumed) ───────────────────────────
 *
 * The question waterfall is scope-filtered: its listeners are dispatched
 * through a scope carrier, and the scope primitive's own filter admits an
 * UNTAGGED listener globally (`if (tag === undefined) return true` in
 * `@deepseek-ai/dsh-scope`). A listener registered on the root context is
 * therefore untagged and does receive agent-scoped dispatches — which is what
 * a standing observation needs. Our listener never CLAIMS: it records the
 * in-flight window and always delegates through `next()`, so if the premise
 * were ever wrong the only casualty would be an empty observation, never a
 * swallowed question.
 *
 * ── TWO LAWS ────────────────────────────────────────────────────────────────
 *
 * 1. NOTHING IS STORED. Posture is volatile by nature: a running flag flips
 *    twice a minute. Persisting it would mean a commit broadcast to every
 *    replica for every flip, which is pure noise on the one channel the board
 *    already uses for real edits. So this module READS and never writes; a
 *    reader that needs a memory of it must take one itself.
 * 2. NOTHING IS ANSWERED. Approving and answering are statements about what the
 *    human has seen, and a model making one on the human's behalf is closing
 *    its own door while claiming the human opened it. This module observes
 *    waiting; it never settles it.
 *
 * Every answer is a `Posture`, which is a three-state: a service that is
 * absent or a read that fails says `unknown` and names the reason, rather than
 * reporting `false` — "I cannot see it" and "it is not so" are different
 * claims, and only the second one is a promise.
 */

/** One answer: `true` / `false` when the host could see it, `unknown` when it
 *  could not. `false` is a claim about the world; `unknown` is a claim about
 *  this host's reach. */
export type Posture = boolean | 'unknown'

/** One answer plus, when it is `unknown`, why the host could not see it. */
export interface PostureFact {
  readonly value: Posture
  /** Present only when `value === 'unknown'`: the honest reason, in one line. */
  readonly unreadable?: string
}

/** The four answers, one derivation. */
export interface SessionPosture {
  readonly sessionId: string
  /** Is the turn alive right now (`agent.status === 'running'`)? */
  readonly running: PostureFact
  /** Is it in the archive set? */
  readonly archived: PostureFact
  /** Is an approval asked and not yet decided? */
  readonly awaitingApproval: PostureFact
  /** Is a question asked and not yet answered? */
  readonly awaitingAnswer: PostureFact
}

/** A seen answer. */
function seen(value: boolean): PostureFact {
  return { value }
}

/** An answer the host could not reach, and why. */
function blind(why: string): PostureFact {
  return { value: 'unknown', unreadable: why }
}

/* ── the host faces, as shapes ──────────────────────────────────────────────
 * Declared, never imported: this module is testable without the SDK and keeps
 * the plugin free of a runtime dependency on it. Every face is a THUNK so the
 * wiring resolves the service at call time — a service resolved once at
 * startup would be a handle held across the moment the host finishes booting. */

export interface AgentsFace {
  get(id: string): { status?: unknown } | undefined
}
export interface WorkspaceRegistryFace {
  archivedSessionIds?: readonly string[]
}
export interface SessionQueryFace {
  readSession(id: string): Promise<{ events?: unknown }>
}

export interface SessionPostureSources {
  agents?: () => AgentsFace | undefined
  workspaceRegistry?: () => WorkspaceRegistryFace | undefined
  sessionQuery?: () => SessionQueryFace | undefined
}

/* ── 1 · is the session working ─────────────────────────────────────────── */

/**
 * `agent.status` is the native lifecycle word and nothing else decides it.
 * A session the host has no agent for is not a session that is idle: it is a
 * session this host cannot see, and the answer says so.
 */
export function sessionRunningOf(sources: SessionPostureSources, sessionId: string): PostureFact {
  const { face: agents, why } = read(sources.agents, 'ctx.agents')
  if (agents === undefined) return blind(why ?? 'no agents service on this host')
  let agent: { status?: unknown } | undefined
  try {
    agent = agents.get(sessionId)
  } catch (error) {
    return blind(`agents.get threw: ${describe(error)}`)
  }
  if (agent === undefined) return blind(`no live agent for session ${sessionId}`)
  const status = agent.status
  if (status !== 'idle' && status !== 'running') return blind(`unknown agent status ${describe(status)}`)
  return seen(status === 'running')
}

/* ── 2 · is it archived ─────────────────────────────────────────────────── */

/** Archive membership, read from the registry's own field — never inferred
 *  from workspace membership, which is a different question. */
export function sessionArchivedOf(sources: SessionPostureSources, sessionId: string): PostureFact {
  const { face: registry, why } = read(sources.workspaceRegistry, 'ctx.workspaceRegistry')
  if (registry === undefined) return blind(why ?? 'no workspaceRegistry on this host')
  const archived = registry.archivedSessionIds
  if (!Array.isArray(archived)) return blind('workspaceRegistry carries no archivedSessionIds')
  return seen(archived.includes(sessionId))
}

/* ── 3 · is it waiting for an approval (from the log) ───────────────────── */

/**
 * THE PAIRING LAW: an `approval/asked` is waiting until an `approval/decided`
 * carrying the SAME `id` exists. The host's contract appends exactly one
 * decision per ask, so the difference of two id sets is the whole answer —
 * and pairing by id rather than by position means a log whose order surprises
 * us still answers correctly.
 *
 * Events whose shape we do not recognize are SKIPPED, never counted as a
 * decision: a malformed record must not be able to fake a settled approval.
 */
export function awaitingApprovalIn(events: readonly unknown[]): boolean {
  const asked = new Set<string>()
  const decided = new Set<string>()
  for (const raw of events) {
    if (typeof raw !== 'object' || raw === null) continue
    const event = raw as { type?: unknown; data?: { id?: unknown } }
    const id = event.data?.id
    if (typeof id !== 'string' || id === '') continue
    if (event.type === 'approval/asked') asked.add(id)
    else if (event.type === 'approval/decided') decided.add(id)
  }
  for (const id of asked) if (!decided.has(id)) return true
  return false
}

/** The durable half: replay the session log and look for an unpaired ask. */
export async function awaitingApprovalOf(sources: SessionPostureSources, sessionId: string): Promise<PostureFact> {
  const { face: query, why } = read(sources.sessionQuery, 'ctx.sessionQuery')
  if (query === undefined) return blind(why ?? 'no sessionQuery on this host')
  let snapshot: { events?: unknown }
  try {
    snapshot = await query.readSession(sessionId)
  } catch (error) {
    return blind(`session log unreadable: ${describe(error)}`)
  }
  const events = snapshot?.events
  if (!Array.isArray(events)) return blind('session log carries no event list')
  return seen(awaitingApprovalIn(events))
}

/* ── 4 · is it waiting for an answer (bracketing the in-flight window) ──── */

/**
 * The in-flight ledger for the question waterfall.
 *
 * A COUNT per session, not a flag: two questions may be open on one session at
 * once, and a boolean would let the first answer clear the second's wait.
 */
export interface QuestionWaitRecorder {
  /** The waterfall dispatched for this session. */
  noteAsk(sessionId: string): void
  /** The dispatch settled, however it settled. */
  noteSettled(sessionId: string): void
  /** Whether this host is currently inside a question dispatch for the session. */
  awaitingOf(sessionId: string): boolean
  /** Whether any dispatch was ever observed (i.e. the bypass is live). */
  readonly observed: boolean
  /** Forget every open window. */
  dispose(): void
}

export function createQuestionWaitRecorder(): QuestionWaitRecorder {
  const open = new Map<string, number>()
  let observed = false
  return {
    noteAsk(sessionId: string): void {
      observed = true
      open.set(sessionId, (open.get(sessionId) ?? 0) + 1)
    },
    noteSettled(sessionId: string): void {
      const next = (open.get(sessionId) ?? 0) - 1
      if (next > 0) open.set(sessionId, next)
      else open.delete(sessionId)
    },
    awaitingOf(sessionId: string): boolean {
      return (open.get(sessionId) ?? 0) > 0
    },
    get observed(): boolean {
      return observed
    },
    dispose(): void {
      open.clear()
    },
  }
}

/** The structural face of the one registration this module ever makes. */
export interface BypassTarget {
  on(event: string, listener: (...args: never[]) => unknown): unknown
}

/** The session id off a question request, when the payload carries one. */
function sessionIdOfRequest(request: unknown): string | undefined {
  if (typeof request !== 'object' || request === null) return undefined
  const agent = (request as { agent?: { session?: { id?: unknown } } }).agent
  const id = agent?.session?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * Observe the question waterfall without ever claiming it.
 *
 * The listener brackets the dispatch: it marks the session waiting, delegates
 * through `next()`, and unmarks in a `finally` so a thrown or cancelled answer
 * releases the window too. It NEVER returns a value of its own — a bypass that
 * claimed would silently steal every question from the human's own card.
 *
 * @returns the disposer removing the listener.
 */
export function attachQuestionWaitRecorder(target: BypassTarget, recorder: QuestionWaitRecorder): () => void {
  const listener = (request: unknown, next: () => Promise<unknown>): Promise<unknown> => {
    const sessionId = sessionIdOfRequest(request)
    if (sessionId !== undefined) recorder.noteAsk(sessionId)
    return Promise.resolve(next()).finally(() => {
      if (sessionId !== undefined) recorder.noteSettled(sessionId)
    })
  }
  const dispose = target.on('user-questions/request', listener as (...args: never[]) => unknown)
  return typeof dispose === 'function' ? dispose as () => void : () => undefined
}

/**
 * The in-flight half, and the honest part: a recorder that has never observed
 * a dispatch has NOT told us nobody is waiting — it has told us this host was
 * not looking. Those are different claims, and the second one must never be
 * dressed as the first.
 */
export function awaitingAnswerOf(recorder: QuestionWaitRecorder | undefined, sessionId: string): PostureFact {
  if (recorder === undefined) return blind('no question bypass attached on this host')
  if (!recorder.observed) return blind('the question bypass has not seen a dispatch yet')
  return seen(recorder.awaitingOf(sessionId))
}

/* ── the one derivation every caller reads ──────────────────────────────── */

/**
 * All four answers for one session, read fresh. A caller that wants three of
 * them cannot accidentally use a different rule for one.
 */
export async function sessionPostureOf(
  sources: SessionPostureSources,
  recorder: QuestionWaitRecorder | undefined,
  sessionId: string,
): Promise<SessionPosture> {
  return {
    sessionId,
    running: sessionRunningOf(sources, sessionId),
    archived: sessionArchivedOf(sources, sessionId),
    awaitingApproval: await awaitingApprovalOf(sources, sessionId),
    awaitingAnswer: awaitingAnswerOf(recorder, sessionId),
  }
}

/** One optional face, or the reason it could not be resolved. A getter that
 *  throws degrades to "absent" with its reason — resolving a service must
 *  never be the thing that takes a reader down. */
function read<T>(thunk: (() => T | undefined) | undefined, what: string): { face: T | undefined; why?: string } {
  if (thunk === undefined) return { face: undefined, why: `no ${what} wired on this host` }
  try {
    return { face: thunk() }
  } catch (error) {
    return { face: undefined, why: `${what} could not be resolved: ${describe(error)}` }
  }
}

/** A one-line description of an unknown value, for the `unreadable` reason. */
function describe(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  return typeof value
}
