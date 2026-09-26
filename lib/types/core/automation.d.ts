/**
 * Session automation rules: "send a preset instruction to THIS session" —
 * one per session, scoped to a session the task owns; firing the instruction
 * is exactly "typing in the native conversation" (queue by default), never a
 * task execution — so a session rule and the task's own execution prompt
 * never conflict: one drives the task, the other talks to its session.
 *
 * Model: rule = target(session) + trigger + action(send instruction,
 * queue|steer). TWO triggers, one shared row/appearance grammar:
 * - cron ("按时间表"): fired by the minute heartbeat (tickSessionRules);
 * - on-complete ("任务完成后"): fired when a plain run of the task settles.
 *   No due slot, no cron expression — the completion IS the appointment.
 * Pure and unit-testable.
 */
import type { TaskRecord } from './tasks.ts';
/** A rule's trigger: cron (schedule) or on-complete (fires at run settle). */
export type SessionRuleTrigger = 'cron' | 'on-complete';
/** One session-scoped automation rule of a task. */
export interface SessionRule {
    id: string;
    /** The target native session this task owns (by id). */
    sessionId: string;
    /** The preset instruction/text to send; a leading '/' goes through the
     *  native command registry (slashes = commands, everything = plain text).
     *  Only meaningful when `usePrompt` is false. */
    instruction: string;
    /** 发送内容模式：true = 发送任务当前的执行 Prompt（每次发送时取任务记录，
     *  非快照——改 Prompt 即时生效）；false/缺省 = 发送 `instruction`。
     *  绘画场景：对单个会话定时/每次完成时注入执行 Prompt。 */
    usePrompt?: boolean;
    /** 触发方式: cron = 按时间表 (default; legacy rows normalize to this);
     *  on-complete = 任务一次执行结算时发送. */
    trigger: SessionRuleTrigger;
    /** Five-segment cron ("分钟 小时 日 月 周"); due instants computed on tick.
     *  Empty for on-complete rules (no schedule slot). */
    cron: string;
    /** Send mode: 'queue' appends to the session's queue; 'steer' is reserved
     *  for immediate interruption (mapped the same for now — no interrupt RPC
     *  yet, so steer degrades to queue until the native interrupt surface is
     *  available). */
    send: 'queue' | 'steer';
    enabled: boolean;
    /** Next due instant (ms); cron rules only, recomputed on fire / when missing. */
    nextAt?: number;
    /** Last fired instant. */
    lastAt?: number;
}
/** Brand an unknown value as a valid rule (persisted-state guard). */
export declare function isSessionRule(value: unknown): value is SessionRule;
/** Parse + validate a persisted rule list (invalid rows dropped; legacy rows
 *  without a trigger normalize to cron, without usePrompt to custom text). */
export declare function normalizeSessionRules(raw: unknown): SessionRule[] | undefined;
/** The projection row back to a full rule (the rows are the single read shape;
 *  this is the one bridge back for consumers that need the rule's own shape,
 *  e.g. the readiness judgment). */
export declare function sessionRuleOf(row: Extract<AutomationRow, {
    kind: 'session-rule';
}>): SessionRule;
/**
 * The readiness of a session rule — ONE semantics with the task-level
 * schedule (ruleReadiness): a rule is active only while its task sits in a
 * drivable column (todo/running); backlog/review/done pause it (the reason
 * is the task's own status); a toggled-off rule is disabled; an EMPTY
 * execution prompt blocks it (nothing to drive — a reason, not a pause).
 * The ticker skips paused/blocked rules (keeping their due slot — the pause
 * is a hold, not a drop), exactly like the task scheduler treats a paused
 * schedule.
 *
 * NOTE — the column pause governs the CRON heartbeat only: an on-complete
 * rule fires AT the settle instant (the task was drivable when the run
 * started; the settle itself is the appointment), so the column that the
 * settlement lands in never cancels it.
 */
export type SessionRuleReadiness = {
    kind: 'disabled';
} | {
    kind: 'blocked';
} | {
    kind: 'paused';
    status: 'backlog' | 'review' | 'done';
} | {
    kind: 'active';
};
export declare function sessionRuleReadiness(task: TaskRecord, rule: SessionRule): SessionRuleReadiness;
/**
 * One unified automation view row — the single read-side projection every
 * automation surface renders (the panel's rule rows read this; the task
 * detail derives from the same task fields). Locale-free: components map
 * `kind` + fields to their own labels.
 */
export type AutomationRow = {
    kind: 'schedule';
    mode: 'cron' | 'chain';
    enabled: boolean;
    cron?: string;
    runCount: number;
    maxRuns?: number;
    nextRunAt?: number;
} | {
    kind: 'session-rule';
    ruleId: string;
    sessionId: string;
    instruction: string;
    usePrompt?: boolean;
    trigger: SessionRuleTrigger;
    cron: string;
    send: 'queue' | 'steer';
    enabled: boolean;
    nextAt?: number;
    lastAt?: number;
};
/** The task's unified automation projection: session rules first, then the
 *  task-level schedule rule (when present) — every surface reads one shape. */
export declare function automationRowsOf(task: TaskRecord): AutomationRow[];
/**
 * When a rule should fire next given its current due instant (the next cron
 * match AFTER that instant, like the task scheduler's forward roll). Returns
 * the new due instant, or undefined when the expression is unparseable (or
 * the rule has no cron slot — an on-complete rule never rolls).
 */
export declare function nextSessionRuleAt(rule: SessionRule): number | undefined;
/** Add / replace rules immutably on a task. */
export declare function withSessionRules(task: TaskRecord, rules: SessionRule[] | undefined): TaskRecord;
/** Tasks with LIVE automation — an ENABLED schedule, or at least one ENABLED
 *  session rule. The overview's membership: only what is actually armed shows (a
 *  disarmed schedule is managed from the task detail / the expanded editor,
 *  never listed as if it were running). */
export declare function automationTasksOf(tasks: readonly TaskRecord[]): TaskRecord[];
/** Whether ONE task carries live automation (THE membership predicate —
 *  the overview filter and the `has:auto` search facet both read this, so
 *  the two can never disagree on what "automated" means). Armed = managed
 *  here: an enabled rule on a paused column (backlog/review/done) still
 *  counts — the heartbeat holds (not drops) its slot, and the overview is
 *  where it is managed. Firing liveness is a ticker concern, not membership. */
export declare function hasLiveAutomation(task: TaskRecord): boolean;
/** Switch every session rule of a task off (the done-column shut-off: a
 *  completed task's rules must never fire again, exactly like its schedule
 *  disarms — the configuration survives, so re-arming resumes each rule).
 *  Due slots clear with the switch (a re-armed rule recomputes from now —
 *  a stale slot must never surprise-fire on resume, task-level disarm law). */
export declare function disarmSessionRules(task: TaskRecord): TaskRecord;
/** Which automation is blocked on the empty prompt — the NAMED cause, so a
 *  surface can say which one it was (and the card's chip, the detail
 *  disclosure and the overview row all read the one predicate below). */
export type RuleBlockedCause = 'schedule' | 'session' | 'both';
/** Which automation is blocked on the empty prompt (THE cause predicate —
 *  card chips, tooltips, the detail disclosure and the overview row all read
 *  this, so the explanation can never name a different cause than the badge).
 *  `both` reads schedule-first (the task rule is the louder signal); session
 *  rules keep their own cause word downstream. */
export declare function blockedCauseOf(task: TaskRecord): RuleBlockedCause | undefined;
/**
 * Whether the last work on a task FAILED while the task waits in review — the
 * reason a rule is paused *because of a failure* (the card tooltip, the detail
 * disclosure and the overview row read this instead of each computing "failed?"
 * their own way).
 *
 * It reads the newest finished work over EVERY lane, not the last NUMBERED
 * run: a card that failed because a comment round or an observed native turn
 * failed is just as paused, and a failure the board cannot see is a rule that
 * silently stops for a reason nothing on screen names. `lastPlainResult` still
 * exists for the run sequence (`N 次执行`) — the two are different questions
 * and this one is the work, not the counter.
 */
export declare function pausedFailedOf(task: TaskRecord): boolean;
