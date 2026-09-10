/**
 * Native-side activity detection — the "两端同步" contract. When a user chats
 * in the native conversation UI (not through the board), the board learns of
 * the turn through complementary channels:
 * - the WAKE channel (0.1.5): the host's `api-session/activity` event (or
 *   the equivalent list `updatedAt` advance) fires per durable user message;
 *   the controller records its stamp and the scan below re-checks the
 *   session even when the running flag did not move — so a turn that starts
 *   AND finishes between two reconcile passes can never be missed;
 * - the legacy live frame (pre-0.5 `user/message` stream events, parsed by
 *   `nativeTurnOf`), which the engine records the instant it arrives — kept
 *   as the fast path on hosts that still serve it;
 * - the CATCH-UP backstop here: a STATE rule on every reconcile pass — a
 *   related session that is running RIGHT NOW with no board-owned round for
 *   this run period fires an external round. "Running now" covers the cases
 *   the old edge (flip) rule silently missed: a session already running when
 *   the page loaded (the "行显示进行中、卡片不过列" gap), a session born
 *   running at its first message, and frames lost while the tab was frozen.
 *
 * One rule per RUNNING PERIOD: `book.recorded` consumes a session's current
 * run (set when it fires or is suppressed by an open board round / the
 * direct-send grace; cleared the moment the session reads idle), so the same
 * native turn is never recorded twice, while every NEW turn re-arms it. Past
 * completed turns are never re-fired (a finished turn is not running).
 * Pure and framework-free.
 */
/** Bookkeeping the controller keeps between passes (baselines + grace). */
export interface ActivityBook {
    /** Last observed running flag per session (baseline bookkeeping). */
    running: Map<string, boolean>;
    /** When an external round was created per session (for the settle grace). */
    externalSince: Map<string, number>;
    /**
     * Sessions whose CURRENT running period is already consumed (fired or
     * suppressed by a board-owned turn). Cleared when the session reads idle,
     * so the next native turn re-arms detection — one external round per turn,
     * never two, never zero.
     */
    recorded: Set<string>;
}
/** The renderable facts of the newest native user message. */
export interface LatestUserMessage {
    /** The message's text (absent when the message carried no text). */
    text?: string;
    /** Whether the message carried image blocks. */
    hasImage: boolean;
    /** The native log seq of the message that started the turn — THE anchor
     *  identifying this turn across detection channels, devices and engines
     *  (same session, same seq = same turn; never record it twice). */
    anchor?: number;
}
/**
 * THE newest native user message in a transcript tail — the line the user
 * typed in the native chat that started the observed turn. The LATEST user
 * message is the truth and never falls back to an older one: a picture-only
 * message reports `{ text: undefined, hasImage: true }` so the thread shows a
 * 图片消息 placeholder instead of stale text from an earlier message.
 * undefined when the tail carries no user message at all.
 */
export declare function latestUserMessage(events: readonly unknown[]): LatestUserMessage | undefined;
/**
 * Parse ONE native event into the turn facts the board records: a
 * `user/message` from the user source (the legacy live stream's
 * `session/event` payload carries exactly this shape). undefined for
 * anything else — the caller ignores assistant chatter, tool events and
 * system frames.
 */
export declare function nativeTurnOf(event: unknown): LatestUserMessage | undefined;
/**
 * Join a native message's text blocks (each trimmed); returns '' when the
 * content carries no text. THE shared block-joiner for native content — the
 * activity reader and the review transcript read the same wire shape, so the
 * join grammar lives here, not in two private copies.
 */
export declare function contentTextOf(content: unknown): string;
/** One concrete detection: record an external round on this task's session. */
export interface DetectedExternalTurn {
    taskId: string;
    sessionId: string;
    /** The session is the task's refine session — its round must not move the column. */
    refine: boolean;
}
/** The per-task facts the detector needs to avoid false positives. */
export interface ActivityCandidate {
    /** Every related session: executions + bound sessions + refine (de-duplicated). */
    sessions: ReadonlyArray<{
        sessionId: string;
        refine: boolean;
    }>;
    /** Whether the task already has an open round on this session (board-owned or previously detected). */
    hasOpenRoundOn(sessionId: string): boolean;
    /** Whether the session's CURRENT turn is board-owned already: the live
     *  direct-send grace OR a direct round the board recorded for this same
     *  running period (survives reloads — the in-memory grace alone would let
     *  a long direct turn be double-recorded after 60s). */
    inBoardTurnOn(sessionId: string): boolean;
}
/**
 * Scan all candidates for out-of-band turns — the STATE rule (see the module
 * doc): a related session running RIGHT NOW whose current run period is not
 * consumed yet fires one external round. Board-owned turns (the direct-send
 * grace, a direct round of this run) consume the period WITHOUT firing —
 * the turn is already in the ledger, by identity, not by coverage. A lane
 * veto (`hasOpenRoundOn`: another round is holding the lane) is COVERAGE,
 * not identity: it must NOT consume — the veto can lift while the session
 * is still running (a queued comment settles, a stale round clears), and a
 * consumed-but-unfired period never re-arms until idle. Consuming on a
 * transient veto is the "card never lights" machine: the one edge that
 * could have fired is eaten, and a long native turn offers no second edge.
 * (Turns that finished before the pass are covered by the controller's
 * wake-evidence pass, not here.)
 */
export declare function detectExternalTurns(candidates: ReadonlyArray<{
    taskId: string;
    candidate: ActivityCandidate;
}>, book: ActivityBook, byId: Readonly<Record<string, {
    running: boolean;
} | undefined>>): DetectedExternalTurn[];
/** Whether a grace deadline (epoch ms) is still in the future. */
export declare function withinGrace(graceUntil: number | undefined, now: number): boolean;
/** How long after a board direct-send a running flip is NOT a new external turn. */
export declare const DIRECT_GRACE_MS = 60000;
/** How long an external round may wait for settle evidence before it is cancelled as spurious. */
export declare const EXTERNAL_SETTLE_GRACE_MS = 90000;
