/**
 * Shared session display logic: derive the live state of any execution's
 * underlying session (across all its rounds: the original run + comments).
 * Used by execution rows, task cards, and the reminder
 * system so every surface shows the same truth.
 *
 * Pure functions — no side effects, fully unit-testable.
 */
import type { PendingInteractionKind } from './controller.ts';
import { type TaskRecord, type ExecutionRecord } from './tasks.ts';
/**
 * The live state of an execution's session (aggregating all rounds that share
 * the session: the original run and its comments).
 */
export interface SessionDisplay {
    /** The session's current state (waiting > running > latest settled). */
    state: 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
    /** When the session last saw activity (started or settled a round). */
    lastActivity: number | undefined;
    /** The interaction kind if the session is waiting on the user. */
    waitingKind: PendingInteractionKind | undefined;
}
/**
 * THE EXECUTION'S REVIEW THREAD: the execution plus the comments submitted
 * FROM its review page, plus legacy rows attributed by `parentExecutionId`.
 *
 * This is deliberately NOT the conversation. A session-anchored drive comment
 * belongs to the linked conversation's thread and must never make an
 * execution's review page read as live. EXCEPTION: externally-observed rounds
 * (a native-side turn recorded onto the task) keep their thread slot AND count
 * as the execution's unread, because they are that run's own turn happening out
 * of band.
 *
 * A surface asking "what state is this conversation in" reads
 * {@link conversationRoundsOf}; a surface asking "is there unread content on
 * THIS review page" reads this one.
 */
export declare function executionThreadOf(task: TaskRecord, execution: ExecutionRecord): readonly ExecutionRecord[];
/**
 * The live state of an execution's SESSION, for a row whose identity is that
 * execution. A session-scoped read of the one conversation derivation: a
 * conversation the task both ran in and later drove from a linked panel is
 * still one conversation, and its row must show what it just did rather than
 * the outcome of the run that opened the row. (Session-less legacy rows read
 * their own execution, which is all they have.)
 */
export declare function sessionDisplay(task: TaskRecord, execution: ExecutionRecord, waitingKind: PendingInteractionKind | undefined, active?: boolean): SessionDisplay;
/**
 * The live state of a LINKED session on one task — the same derivation
 * {@link sessionDisplay} uses, addressed by session id. Two entry points into
 * ONE body on purpose: they used to be separate implementations with different
 * round sets, and the narrower one always won for a session that was both run
 * and bound, so the row reported an outcome that had already been superseded.
 */
export declare function linkedSessionDisplay(task: TaskRecord, sessionId: string, waitingKind: PendingInteractionKind | undefined, active: boolean): SessionDisplay;
/**
 * The time window of a conversation on this task (all its rounds, every lane —
 * the same set the state chip and the order key read, so the 开始/结束/耗时
 * line can never describe a different stretch of time than the chip above it).
 * - startedAt = earliest round's start.
 * - endedAt = latest settled round's end; undefined if any round is still open.
 * - duration = endedAt - startedAt; undefined if the session is still open.
 */
export declare function sessionTimes(task: TaskRecord, execution: ExecutionRecord): {
    startedAt: number;
    endedAt: number | undefined;
    duration: number | undefined;
};
/**
 * 「这个会话最后一次有动静」的时刻 —— 会话列的排序键与每会话未读时钟的
 * **同一份**推导（`max(round.endedAt ?? round.startedAt)`，开轮算它自己的开始），
 * 两条读数因此不可能互相矛盾。
 *
 * 它对**这个任务**记录的所有轮次取最大值——普通运行、保存中的评论、旁听到的
 * 原生对话、直发，一视同仁：「这段对话又产出新东西了」不关心是哪条车道产出
 * 的。会话没有轮次时返回 0（读作「没有动过」，调用方自己拿宿主时间兜底）。
 */
export declare function sessionActivityOf(task: TaskRecord, sessionId: string): number;
/**
 * The viewed baseline of an execution row: when the user last opened its
 * review page; absent, the run's own start (every created/normalized run
 * carries a viewedAt, so this only guards test fixtures). A stable anchor —
 * a run starts viewed at its start, its settlement (or a later comment)
 * then lights the unread dot until the review page opens.
 */
export declare function executionViewedBaseline(execution: ExecutionRecord): number;
/**
 * Whether an execution's session has content newer than the last time its
 * review page was opened: any round of the session (the run itself plus its
 * comments) with activity after the baseline. The single source for the
 * execution row's unread dot and the card's "新" badge.
 */
export declare function executionUnviewed(task: TaskRecord, execution: ExecutionRecord): boolean;
/**
 * The viewed baseline of a task card: when the user last opened the task
 * detail; absent (legacy) it equals the task's newest round activity, so
 * already-seen content stays quiet after an upgrade.
 */
export declare function taskViewedBaseline(task: TaskRecord): number;
/**
 * Whether the task has any unviewed content: any round — a run settling, a
 * comment being injected or settling — with activity newer
 * than the card's viewed baseline. Drives the card's breathing glow.
 */
export declare function taskUnviewed(task: TaskRecord): boolean;
/**
 * How many plain-run executions of the task are unviewed — the "新 N" count
 * on the card. Comment-only unread (no unviewed plain runs) shows a
 * bare "新" instead.
 */
export declare function taskUnviewedCount(task: TaskRecord): number;
/**
 * Whether ONE session of a task still owes the user a look — THE per-session
 * read clock, shared by the detail's session-row glow and the card's session
 * dot, so the two surfaces can never disagree about which conversation just
 * finished.
 *
 * ONE sentence: the session's LATEST activity is newer than the last time
 * anything of it was acknowledged. Both edges are maxima over ALL of the
 * session's rounds — plain runs, saved comments, observed native turns and
 * direct sends alike — because "this conversation produced something new"
 * does not care which lane produced it:
 *
 *  - activity = max(round.endedAt ?? round.startedAt) — an open round counts
 *    as its own start, which never beats an equal-or-later acknowledgment;
 *    {@link sessionActivityOf} is that reading, named once for both callers;
 *  - acknowledgment = max(round.viewedAt ?? round.startedAt) — rounds are
 *    born seen (their creator stamps `viewedAt`; storage backfills old rows
 *    to their own activity), and the existing funnels move it forward
 *    (review page open, 标已读 单·组·全部, approve, notification per-session
 *    open). An unstamped round falls back to its start: activity after an
 *    acknowledgment nobody recorded is exactly what should glow.
 *
 * It never writes; opening the task DETAIL does not clear it (reading the
 * list is not acknowledging the conversation — the card ring keeps its own,
 * coarser task-level clock).
 */
export declare function sessionUnviewedOf(task: TaskRecord, sessionId: string): boolean;
