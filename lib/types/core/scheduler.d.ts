import { type TaskRecord } from './tasks.ts';
/**
 * Heartbeat liveness (Healthchecks `Period + Grace`, single-machine edition):
 * the scheduler is stale when no tick fully completed within one period plus
 * one grace window. An absent stamp (no tick yet) reads alive — a fresh load
 * must never flash red — as does a future stamp (a clock that stepped back).
 */
export declare function isHeartbeatStale(lastOkAt: number | undefined, now: number, periodMs?: number, graceMs?: number): boolean;
/** Tick cadence when the host wires none (one minute — the missed-tolerance
 *  default and the heartbeat period both derive from the tick, so a custom
 *  cadence retunes the whole scheduler by passing `tickMs`). */
export declare const SCHEDULER_TICK_MS = 60000;
/** Forbid-policy skip ledger: due slots skipped while the task still ran
 *  (`overlap`) vs. slots too stale to catch up (`missed`). THE telemetry
 *  shape — the sink, the accessor and the controller mirror all name it, so
 *  a third counter lands in one place. In-memory only, never persisted. */
export interface SkipLedger {
    overlap: number;
    missed: number;
}
/** Everything the scheduler needs from its host (the board controller). */
export interface SchedulerDeps {
    /** Read the current task ledger (the controller snapshot). */
    tasks(): readonly TaskRecord[];
    /** Clock; defaults to Date.now in the controller wiring. */
    now(): number;
    /** Trigger one task's real execution (the controller's runTask); resolves
     *  true when the run was accepted, false when rejected (e.g. the task is
     *  already running). */
    runTask(id: string): Promise<boolean>;
    /**
     * Persist a rolled-forward schedule: next due instant + this trigger
     * instant, the incremented run counter, and optionally disarm the schedule
     * (after the final budgeted run).
     */
    applySchedule(id: string, nextRunAt: number | undefined, lastTriggeredAt: number | undefined, runCount?: number, disable?: boolean): void;
    /** Tick cadence; defaults to SCHEDULER_TICK_MS. */
    tickMs?: number;
    /**
     * Skip telemetry sink: invoked with the cumulative skip ledger whenever a
     * Forbid/missed skip lands (at most once per tick per task). Absent = the
     * counts stay readable through `skipStats` only (tests, headless hosts).
     */
    onSkips?: (stats: SkipLedger) => void;
    /**
     * Heartbeat telemetry sink: invoked with the tick/ok stamps after every
     * fully completed tick (at most once per tick). Absent = the stamps stay
     * readable through `heartbeat` only (tests, headless hosts).
     */
    onHeartbeat?: (hb: {
        tickAt: number;
        okAt: number;
    }) => void;
    /**
     * Gate: while false the tick no-ops (e.g. the session list baseline has not
     * arrived on page load, so executions would fail). Defaults to always ready.
     */
    ready?: () => boolean;
    /**
     * Optional cruise-window heartbeat (the controller's tickCruise): evaluated
     * on every tick so a scheduled window's start/end flips the cruise on/off
     * at its boundary. Minute granularity is enough for scheduled times.
     */
    cruiseTick?: (now: number) => void;
    /**
     * Optional session-rule heartbeat (the controller's tickSessionRules):
     * evaluated on every tick so a rule whose due instant passed sends its
     * preset instruction to the target session.
     */
    sessionRulesTick?: (now: number) => Promise<void>;
    /** Environment listeners for tab-visibility recovery (browser only). */
    environment?: {
        addEventListener(type: 'visibilitychange', listener: () => void): void;
        removeEventListener(type: 'visibilitychange', listener: () => void): void;
    };
}
/**
 * The schedule heartbeat (see module doc). `tick` is public so tests and
 * callers can drive a check without waiting for the interval.
 */
export declare class SchedulerService {
    private readonly deps;
    private timer;
    private disposed;
    /** Forbid-policy skip ledger (in-memory only — skips are telemetry, never
     *  persisted, so a minute of overlap can never spam the synced document). */
    private skippedOverlap;
    private skippedMissed;
    /** Heartbeat stamps (in-memory only, same telemetry discipline as the skip
     *  ledger): the last tick entry vs. the last fully completed tick. */
    private lastTickAt;
    private lastOkAt;
    /** @param deps - tasks/clock/trigger/apply faces (see {@link SchedulerDeps}). */
    constructor(deps: SchedulerDeps);
    /** Forbid-policy telemetry: how many due slots were skipped while the task
     *  still ran (`overlap`) vs. how many were too stale to catch up (`missed`). */
    skipStats(): SkipLedger;
    /** Heartbeat stamps for liveness checks (read-only; undefined = no tick yet). */
    heartbeat(): {
        lastTickAt: number | undefined;
        lastOkAt: number | undefined;
    };
    /** Start ticking: one immediate check (catch-up after reload) + the interval. */
    start(): void;
    /** Stop ticking and drop listeners (idempotent). */
    dispose(): void;
    /**
     * Check every enabled schedule and trigger the due ones. Idempotent per
     * task per tick: the schedule is rolled forward only after runTask accepts
     * the run, so a rejected run keeps its due slot and is retried on the next
     * tick instead of being silently dropped.
     */
    tick(): Promise<void>;
    private readonly onVisibility;
}
