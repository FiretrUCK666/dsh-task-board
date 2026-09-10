/**
 * Minimal 5-field cron parsing and next-run computation for scheduled task
 * runs. Framework-free and dependency-free so the scheduler and controller
 * share one tiny pure module.
 *
 * Grammar: five whitespace-separated fields, 分 时 日 月 周. Every field
 * supports the wildcard, step (wildcard or range + "/n"), single value,
 * inclusive range a-b, and comma lists mixing any of those. Ranges: minutes
 * 0-59, hours 0-23, days 1-31, months 1-12, weekdays 0-7 (0 and 7 both mean
 * Sunday). When both the day and weekday fields are restricted they combine
 * with OR semantics (standard cron). Invalid expressions parse to null and
 * are rejected by the UI/controller.
 */
/** The parsed match sets of one cron expression. */
export interface CronSchedule {
    minutes: ReadonlySet<number>;
    hours: ReadonlySet<number>;
    days: ReadonlySet<number>;
    months: ReadonlySet<number>;
    /** Weekdays 0-6, 0 = Sunday (input 7 normalized to 0). */
    weekdays: ReadonlySet<number>;
    /** Whether the day-of-month field was the literal '*' (unrestricted). */
    dayWildcard: boolean;
    /** Whether the weekday field was the literal '*' (unrestricted). */
    weekdayWildcard: boolean;
}
/**
 * Parse a 5-field cron expression.
 * @returns the match sets, or null when the expression is invalid.
 */
export declare function parseCron(expr: string): CronSchedule | null;
/** Whether the expression parses. */
export declare function isValidCron(expr: string): boolean;
/** A human-readable description of a cron expression (see describeCron). */
export type CronDescription = {
    kind: 'everyMinute';
} | {
    kind: 'everyMinutes';
    minutes: number;
} | {
    kind: 'everyHours';
    hours: number;
} | {
    kind: 'dailyAt';
    time: string;
} | {
    kind: 'weekdaysAt';
    time: string;
} | {
    kind: 'weeklyAt';
    weekdays: readonly number[];
    time: string;
} | {
    kind: 'monthlyAt';
    days: readonly number[];
    time: string;
} | {
    kind: 'custom';
};
/**
 * Describe a cron expression in human terms: every N minutes/hours, daily
 * at a time, on weekdays, weekly on fixed weekdays, or monthly on fixed
 * days. Returns `{ kind: 'custom' }` for valid-but-unusual expressions and
 * undefined for invalid ones. The UI renders the description through its
 * own locale templates.
 */
export declare function describeCron(expr: string): CronDescription | undefined;
/**
 * Compute the next matching instant after `fromMs` (ms epoch), in local time,
 * at minute granularity, strictly greater than `fromMs`. Returns the ms epoch
 * of the matching minute's start, or undefined when nothing matches within
 * 366 days (e.g. `0 0 30 2 *`).
 */
export declare function nextRunAtMs(expr: string, fromMs: number): number | undefined;
