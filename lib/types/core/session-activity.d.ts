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
 *
 * THE other half of this module — {@link sessionActivityOf} and the index
 * behind it — answers the DIFFERENT question the board's surfaces ask: "is this
 * session still working?" (its own turn OR a subagent descendant it summoned).
 * The two must never be confused: the detector below reads the session's OWN
 * turn flag verbatim (one native turn = one observed round), while the activity
 * layer rolls the same flag up the lineage (see session-lineage.ts). Feeding
 * the rolled-up value into the detector would lengthen a session's run period
 * behind a descendant and fabricate external rounds that never happened.
 * Pure and framework-free.
 */
import { type DescendantRollup, type LineageIndex, type LineageRow } from './session-lineage.ts';
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
}
/** The per-task facts the detector needs to avoid false positives. */
export interface ActivityCandidate {
    /** Every related session (de-duplicated). */
    sessions: ReadonlyArray<{
        sessionId: string;
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
/**
 * One session's activity answer — the complete truth, so a caller can never
 * mistake "no verdict" for "not working".
 * - `'own'` — this session's own turn is running;
 * - `'descendant'` — a subagent-origin descendant of this session is running,
 *   even when this session's own turn already stopped (the official sidebar's
 *   「N 个子代理运行中」 case);
 * - `'idle'` — the session is PRESENT in a ready list and neither holds;
 * - `'unknown'` — no verdict: the list has not arrived (`phase === 'pending'`)
 *   or the session's row is missing from the snapshot (the host list is the
 *   only truth, and an absent row cannot tell "not working" from "not listed").
 *   Callers must neither read it as idle (that is how a working card gets
 *   written out of 进行中 and persisted) nor as active (that would park a card
 *   forever on a session that no longer exists).
 */
export type SessionActivity = 'own' | 'descendant' | 'idle' | 'unknown';
/**
 * Whether one session is still working: its own turn or a running
 * subagent-origin descendant. `ready` is the caller's snapshot-readiness fact
 * (`phase !== 'pending'`); a list that has not arrived testifies about
 * nothing, so every session reads `unknown` there — the same law the round
 * watchdogs already follow.
 * @param sessionId - the session to judge.
 * @param rows - the list snapshot's `byId` (verbatim, including subagent rows).
 * @param rollup - the lineage index over those rows (session-lineage.ts).
 * @param ready - whether the list has served its baseline.
 */
export declare function sessionActivityOf(sessionId: string, rows: Readonly<Record<string, LineageRow | undefined>>, rollup: LineageIndex, ready?: boolean): SessionActivity;
/**
 * Whether a session counts as working right now — THE boolean every surface
 * that used to read the bare `running` flag wants (the card's session dots,
 * the session rows' glow, the detail/review state chips, the card's live leg).
 * `unknown` is false: "no verdict" must never be rendered as working; the
 * leave-running side reads the three-valued form instead.
 */
export declare function sessionActiveOf(sessionId: string, rows: Readonly<Record<string, LineageRow | undefined>>, rollup: LineageIndex, ready?: boolean): boolean;
/**
 * The O(1) activity lookup for one snapshot: the index the callers hold. Built
 * once per snapshot REFERENCE (the controller's cache), so the board's
 * per-card / per-row asks are lookups and the lineage is never re-walked per
 * query.
 */
export interface SessionActivityIndex {
    /** Whether the snapshot behind this index may be used as evidence at all. */
    readonly ready: boolean;
    /** The three-valued answer (see {@link SessionActivity}). */
    activityOf(sessionId: string): SessionActivity;
    /** The two-valued answer: own ∨ descendant (see {@link sessionActiveOf}). */
    active(sessionId: string): boolean;
    /** How many subagent descendants of this session are running right now. */
    descendantRunningCount(sessionId: string): number;
}
/**
 * Build the activity index for one snapshot: the lineage rollup plus the
 * O(1) lookups over it.
 * @param rows - the list snapshot's `byId`.
 * @param rollup - the lineage index over those rows (session-lineage.ts).
 * @param ready - the snapshot's readiness (`phase !== 'pending'`).
 */
export declare function buildSessionActivityIndex(rows: Readonly<Record<string, LineageRow | undefined>>, rollup: LineageIndex, ready?: boolean): SessionActivityIndex;
/** Build the lineage index + the activity index over one snapshot in one call —
 *  the ONE construction site (the controller's snapshot-keyed cache; tests
 *  build the same pair). */
export declare function buildSessionActivity(rows: Readonly<Record<string, LineageRow | undefined>>, ready?: boolean): {
    rollup: LineageIndex;
    activity: SessionActivityIndex;
};
/** Re-exported for the callers that need the rollup's shape (display counts). */
export type { DescendantRollup };
