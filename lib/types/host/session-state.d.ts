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
export type Posture = boolean | 'unknown';
/** One answer plus, when it is `unknown`, why the host could not see it. */
export interface PostureFact {
    readonly value: Posture;
    /** Present only when `value === 'unknown'`: the honest reason, in one line. */
    readonly unreadable?: string;
}
/** The four answers, one derivation. */
export interface SessionPosture {
    readonly sessionId: string;
    /** Is the turn alive right now (`agent.status === 'running'`)? */
    readonly running: PostureFact;
    /** Is it in the archive set? */
    readonly archived: PostureFact;
    /** Is an approval asked and not yet decided? */
    readonly awaitingApproval: PostureFact;
    /** Is a question asked and not yet answered? */
    readonly awaitingAnswer: PostureFact;
}
/**
 * The host's agent registry, narrowed to what this plugin reads off it.
 *
 * `followup` is OPTIONAL rather than required because most of the readers here
 * only read `status` and a test double should not have to invent a hand-off to
 * satisfy them. It is listed at all because the plugin really does call it — the
 * two slash commands, the checklist's hand-off and `item.ask` all put a sentence
 * into a live agent — and the face used to declare only `status`, so every one of
 * those three call sites had to cast its way past the type. **A face that lies
 * about what it carries pushes every caller into a cast, and a cast is a place
 * where a wrong shape goes unremarked.**
 */
export interface AgentsFace {
    get(id: string): {
        status?: unknown;
        followup?: (message: unknown) => void;
    } | undefined;
}
export interface WorkspaceRegistryFace {
    archivedSessionIds?: readonly string[];
}
export interface SessionQueryFace {
    readSession(id: string): Promise<{
        events?: unknown;
    }>;
}
export interface SessionPostureSources {
    agents?: () => AgentsFace | undefined;
    workspaceRegistry?: () => WorkspaceRegistryFace | undefined;
    sessionQuery?: () => SessionQueryFace | undefined;
}
/**
 * `agent.status` is the native lifecycle word and nothing else decides it.
 * A session the host has no agent for is not a session that is idle: it is a
 * session this host cannot see, and the answer says so.
 */
export declare function sessionRunningOf(sources: SessionPostureSources, sessionId: string): PostureFact;
/** Archive membership, read from the registry's own field — never inferred
 *  from workspace membership, which is a different question. */
export declare function sessionArchivedOf(sources: SessionPostureSources, sessionId: string): PostureFact;
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
export declare function awaitingApprovalIn(events: readonly unknown[]): boolean;
/** The durable half: replay the session log and look for an unpaired ask. */
export declare function awaitingApprovalOf(sources: SessionPostureSources, sessionId: string): Promise<PostureFact>;
/**
 * The in-flight ledger for the question waterfall.
 *
 * A COUNT per session, not a flag: two questions may be open on one session at
 * once, and a boolean would let the first answer clear the second's wait.
 */
export interface QuestionWaitRecorder {
    /** The waterfall dispatched for this session. */
    noteAsk(sessionId: string): void;
    /** The dispatch settled, however it settled. */
    noteSettled(sessionId: string): void;
    /** Whether this host is currently inside a question dispatch for the session. */
    awaitingOf(sessionId: string): boolean;
    /** Whether any dispatch was ever observed (i.e. the bypass is live). */
    readonly observed: boolean;
    /** Forget every open window. */
    dispose(): void;
}
export declare function createQuestionWaitRecorder(): QuestionWaitRecorder;
/** The structural face of the one registration this module ever makes. */
export interface BypassTarget {
    on(event: string, listener: (...args: never[]) => unknown): unknown;
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
export declare function attachQuestionWaitRecorder(target: BypassTarget, recorder: QuestionWaitRecorder): () => void;
/**
 * The in-flight half, and the honest part: a recorder that has never observed
 * a dispatch has NOT told us nobody is waiting — it has told us this host was
 * not looking. Those are different claims, and the second one must never be
 * dressed as the first.
 */
export declare function awaitingAnswerOf(recorder: QuestionWaitRecorder | undefined, sessionId: string): PostureFact;
/**
 * All four answers for one session, read fresh. A caller that wants three of
 * them cannot accidentally use a different rule for one.
 */
export declare function sessionPostureOf(sources: SessionPostureSources, recorder: QuestionWaitRecorder | undefined, sessionId: string): Promise<SessionPosture>;
