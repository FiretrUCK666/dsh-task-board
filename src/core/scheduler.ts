/**
 * Browser-side scheduler: the heartbeat behind scheduled task runs.
 *
 * The board is a pure client plugin with no server channel, so "定时任务"
 * lives in the tab: a timer ticks every minute (plus immediately on tab
 * visibility recovery) and triggers any task whose `schedule.nextRunAt` is
 * due, rolling the schedule forward to the next cron match before triggering
 * so the same tick never double-fires. Missed runs are skipped, never queued:
 * a task still running at its due instant is skipped by the controller's
 * runTask guard and simply waits for the next cron match.
 *
 * Overlap policy is Forbid, explicit (K8s `concurrencyPolicy: Forbid`,
 * node-cron `noOverlap`, shell `flock -n`: three names, one semantic) — a
 * due instant that arrives while the task still runs is SKIPPED (never queued
 * behind the run, never killing it) and counted, and a due instant that a
 * newer grid point already superseded AND that is older than the missed-slot
 * tolerance is skipped without catch-up (a slept tab never avalanches; a
 * merely-late tick still fires). Skips are observable through
 * {@link skipStats}; they never enter the retry path (a skip is not a failure).
 *
 * Framework-free: all runtime access flows through the injected deps
 * (structural faces), so tests drive ticks directly without timers.
 */
import { nextRunAtMs } from './schedule.ts'
import { hasOpenRun, plainRunsOf, ruleReadiness, type TaskRecord } from './tasks.ts'

/**
 * Heartbeat liveness (Healthchecks `Period + Grace`, single-machine edition):
 * the scheduler is stale when no tick fully completed within one period plus
 * one grace window. An absent stamp (no tick yet) reads alive — a fresh load
 * must never flash red — as does a future stamp (a clock that stepped back).
 */
export function isHeartbeatStale(
  lastOkAt: number | undefined,
  now: number,
  periodMs = SCHEDULER_TICK_MS,
  graceMs = periodMs,
): boolean {
  if (lastOkAt === undefined || now <= lastOkAt) return false
  return now - lastOkAt > periodMs + graceMs
}

/** Tick cadence when the host wires none (one minute — the missed-tolerance
 *  default and the heartbeat period both derive from the tick, so a custom
 *  cadence retunes the whole scheduler by passing `tickMs`). */
export const SCHEDULER_TICK_MS = 60_000

/** Forbid-policy skip ledger: due slots skipped while the task still ran
 *  (`overlap`) vs. slots too stale to catch up (`missed`). THE telemetry
 *  shape — the sink, the accessor and the controller mirror all name it, so
 *  a third counter lands in one place. In-memory only, never persisted. */
export interface SkipLedger {
  overlap: number
  missed: number
}

/** Everything the scheduler needs from its host (the board controller). */
export interface SchedulerDeps {
  /** Read the current task ledger (the controller snapshot). */
  tasks(): readonly TaskRecord[]
  /** Clock; defaults to Date.now in the controller wiring. */
  now(): number
  /** Trigger one task's real execution (the controller's runTask); resolves
   *  true when the run was accepted, false when rejected (e.g. the task is
   *  already running). */
  runTask(id: string): Promise<boolean>
  /**
   * Persist a rolled-forward schedule: next due instant + this trigger
   * instant, the incremented run counter, and optionally disarm the schedule
   * (after the final budgeted run).
   */
  applySchedule(
    id: string,
    nextRunAt: number | undefined,
    lastTriggeredAt: number | undefined,
    runCount?: number,
    disable?: boolean,
  ): void
  /** Tick cadence; defaults to SCHEDULER_TICK_MS. */
  tickMs?: number
  /**
   * Skip telemetry sink: invoked with the cumulative skip ledger whenever a
   * Forbid/missed skip lands (at most once per tick per task). Absent = the
   * counts stay readable through `skipStats` only (tests, headless hosts).
   */
  onSkips?: (stats: SkipLedger) => void
  /**
   * Heartbeat telemetry sink: invoked with the tick/ok stamps after every
   * fully completed tick (at most once per tick). Absent = the stamps stay
   * readable through `heartbeat` only (tests, headless hosts).
   */
  onHeartbeat?: (hb: { tickAt: number; okAt: number }) => void
  /**
   * Gate: while false the tick no-ops (e.g. the session list baseline has not
   * arrived on page load, so executions would fail). Defaults to always ready.
   */
  ready?: () => boolean
  /**
   * Optional cruise-window heartbeat (the controller's tickCruise): evaluated
   * on every tick so a scheduled window's start/end flips the cruise on/off
   * at its boundary. Minute granularity is enough for scheduled times.
   */
  cruiseTick?: (now: number) => void
  /**
   * Optional session-rule heartbeat (the controller's tickSessionRules):
   * evaluated on every tick so a rule whose due instant passed sends its
   * preset instruction to the target session.
   */
  sessionRulesTick?: (now: number) => Promise<void>
  /** Environment listeners for tab-visibility recovery (browser only). */
  environment?: {
    addEventListener(type: 'visibilitychange', listener: () => void): void
    removeEventListener(type: 'visibilitychange', listener: () => void): void
  }
}

/**
 * The schedule heartbeat (see module doc). `tick` is public so tests and
 * callers can drive a check without waiting for the interval.
 */
export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | undefined
  private disposed = false
  /** Forbid-policy skip ledger (in-memory only — skips are telemetry, never
   *  persisted, so a minute of overlap can never spam the synced document). */
  private skippedOverlap = 0
  private skippedMissed = 0
  /** Heartbeat stamps (in-memory only, same telemetry discipline as the skip
   *  ledger): the last tick entry vs. the last fully completed tick. */
  private lastTickAt: number | undefined = undefined
  private lastOkAt: number | undefined = undefined

  /** @param deps - tasks/clock/trigger/apply faces (see {@link SchedulerDeps}). */
  constructor(private readonly deps: SchedulerDeps) {}

  /** Forbid-policy telemetry: how many due slots were skipped while the task
   *  still ran (`overlap`) vs. how many were too stale to catch up (`missed`). */
  skipStats(): SkipLedger {
    return { overlap: this.skippedOverlap, missed: this.skippedMissed }
  }

  /** Heartbeat stamps for liveness checks (read-only; undefined = no tick yet). */
  heartbeat(): { lastTickAt: number | undefined; lastOkAt: number | undefined } {
    return { lastTickAt: this.lastTickAt, lastOkAt: this.lastOkAt }
  }

  /** Start ticking: one immediate check (catch-up after reload) + the interval. */
  start(): void {
    if (this.disposed) return
    // Immediate catch-up tick: schedules whose due instant passed while the
    // tab was closed are triggered as soon as the runtime is ready.
    this.tick()
    this.timer = setInterval(() => { this.tick() }, this.deps.tickMs ?? SCHEDULER_TICK_MS)
    this.deps.environment?.addEventListener('visibilitychange', this.onVisibility)
  }

  /** Stop ticking and drop listeners (idempotent). */
  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    this.deps.environment?.removeEventListener('visibilitychange', this.onVisibility)
  }

  /**
   * Check every enabled schedule and trigger the due ones. Idempotent per
   * task per tick: the schedule is rolled forward only after runTask accepts
   * the run, so a rejected run keeps its due slot and is retried on the next
   * tick instead of being silently dropped.
   */
  async tick(): Promise<void> {
    if (this.disposed) return
    if (this.deps.ready !== undefined && !this.deps.ready()) return
    const now = this.deps.now()
    this.lastTickAt = now
    // Cruise windows flip on/off at their boundaries on this same heartbeat.
    this.deps.cruiseTick?.(now)
    for (const task of this.deps.tasks()) {
      const schedule = task.schedule
      if (schedule === undefined || !schedule.enabled) continue
      const readiness = ruleReadiness(task)
      // Chain mode: recovery tick only — a stalled chain (e.g. after a page
      // reload, when the settle hand-off was lost) is restarted when no
      // execution is open and a further run is within budget. The card may
      // sit anywhere (the settle lands it in review; 完成后接续 keeps going
      // from there — only a hard done stops it via disarm). The live hand-off
      // runs synchronously after each settle in the controller, so this tick
      // can never double-launch.
      // Budget check: runCount counts hand-off-launched runs (the armed
      // first run is never counted), so the run count so far is one ahead of
      // the counter and this recovery launch WOULD be another uncounted one
      // — the last legal recovery slot is `runCount + 1 < maxRuns` (a
      // settle-then-count style check would over-run the budget by one).
      if (schedule.mode === 'chain') {
        if (task.status === 'done') continue // completed = disarmed already
        // THE SAME derivation the live hand-off uses, read from the shared
        // predicates rather than "the last row": a card can have several
        // sessions in flight, and its newest record is routinely a comment or
        // a native turn that says nothing about the card's own execution.
        //   · any lane still working → nothing to recover yet (re-attempt next
        //     tick; a merely-SAVED comment must never block recovery forever);
        //   · the card's last PLAIN run failed/cancelled → 失败不续 (reading
        //     the last row used to relaunch a failed chain every minute, and
        //     an open-but-not-newest round used to slip through).
        if (hasOpenRun(task)) continue
        const runs = plainRunsOf(task)
        const lastRun = runs[runs.length - 1]
        if (runs.length > 0 && lastRun?.result !== 'succeeded') continue
        if (schedule.maxRuns !== undefined && schedule.runCount + 1 >= schedule.maxRuns) continue
        await this.deps.runTask(task.id)
        continue
      }
      // Paused or BLOCKED: the rule must not drive a shelved/failed task (or
      // one with an empty execution prompt — nothing to execute). Due
      // instants are skipped and rolled forward, never caught up, so a
      // resumed rule continues from the next match instead of firing at once.
      if (readiness.kind === 'paused' || readiness.kind === 'blocked') {
        if (schedule.nextRunAt === undefined || schedule.nextRunAt > now) continue
        const next = nextRunAtMs(schedule.cron, schedule.nextRunAt)
        if (next !== undefined) this.deps.applySchedule(task.id, next, undefined)
        continue
      }
      if (schedule.nextRunAt === undefined) {
        // Missing next-run instant (repaired/legacy data): recompute from the
        // cron expression and wait; an unparseable expression is skipped.
        const repaired = nextRunAtMs(schedule.cron, now)
        if (repaired === undefined) continue
        this.deps.applySchedule(task.id, repaired, undefined)
        continue
      }
      if (schedule.nextRunAt > now) continue
      // Forbid, explicit: a due instant that arrives while the task still
      // runs is skipped — not queued, not killing the live run. The schedule
      // advances from the due instant (the cron grid stays aligned) with no
      // trigger stamp and no run-count bump, and the skip is counted so
      // "why didn't it run" stays answerable.
      if (hasOpenRun(task)) {
        const next = nextRunAtMs(schedule.cron, schedule.nextRunAt)
        if (next !== undefined) this.deps.applySchedule(task.id, next, undefined)
        this.skippedOverlap += 1
        this.deps.onSkips?.(this.skipStats())
        continue
      }
      // Missed-slot tolerance: a due instant that a NEWER grid point already
      // superseded is stale (the tab slept, the clock jumped) — but only once
      // it is also older than the tolerance window, so a merely-late tick
      // still fires. Stale slots skip without catch-up (one jump to the next
      // grid point from now, never a one-step crawl), and the skip is counted.
      // Undefined tolerance = one scheduler tick.
      const tolerance = schedule.missedToleranceMs ?? (this.deps.tickMs ?? SCHEDULER_TICK_MS)
      const nextAfterDue = nextRunAtMs(schedule.cron, schedule.nextRunAt)
      if (nextAfterDue !== undefined && nextAfterDue <= now && now - schedule.nextRunAt > tolerance) {
        const next = nextRunAtMs(schedule.cron, now)
        if (next !== undefined) this.deps.applySchedule(task.id, next, undefined)
        this.skippedMissed += 1
        this.deps.onSkips?.(this.skipStats())
        continue
      }
      // The final budgeted run disarms the schedule after firing; earlier
      // runs advance from the due instant (not this tick's wall-clock) and
      // only after the run is accepted — a rejected run keeps its due slot.
      const runCount = schedule.runCount + 1
      const finalRun = schedule.maxRuns !== undefined && runCount >= schedule.maxRuns
      const accepted = await this.deps.runTask(task.id)
      if (!accepted) continue
      if (finalRun) {
        this.deps.applySchedule(task.id, undefined, now, runCount, true)
      } else {
        const next = nextRunAtMs(schedule.cron, schedule.nextRunAt)
        this.deps.applySchedule(task.id, next, now, runCount)
      }
    }
    // Session automation rules fire their due instructions on this heartbeat
    // too — after the task-schedule loop so a synchronous tick() probes the
    // schedule loop first (tests drive both synchronously).
    await this.deps.sessionRulesTick?.(now)
    // A tick that ran to completion (an exception above skips this line, so a
    // wedged rules-tick never reports healthy).
    this.lastOkAt = now
    this.deps.onHeartbeat?.({ tickAt: this.lastTickAt ?? now, okAt: now })
  }

  private readonly onVisibility = (): void => { this.tick() }
}
