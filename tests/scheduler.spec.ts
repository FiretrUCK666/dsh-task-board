/**
 * Scheduler tests: the schedule heartbeat — due triggering, roll-forward,
 * gates (ready/disposed/disabled), and tab-visibility recovery. Drives
 * `tick` directly (no real timers).
 */
import { describe, expect, it } from 'vitest'
import { SchedulerService, isHeartbeatStale, type SchedulerDeps } from '../src/core/scheduler.ts'
import { createTask, settleExecution, startExecution, withSchedule, withStatus, type TaskRecord } from '../src/core/tasks.ts'

/** Local-time ms epoch helper. */
function at(year: number, month: number, day: number, hour: number, minute: number, second = 0): number {
  return new Date(year, month - 1, day, hour, minute, second).getTime()
}

/** A task carrying an armed, manually-primed schedule rule. */
function scheduledTask(id: string, cron: string, nextRunAt: number | undefined, enabled = true): TaskRecord {
  // A real prompt keeps the fixture OUT of the blocked state — these tests
  // exercise the schedule machine, not the empty-prompt gate (which has its
  // own dedicated test).
  const base = createTask({ title: id, description: '', prompt: 'run' }, at(2026, 1, 1, 0, 0), `t-${id}`)
  return withSchedule(base, { enabled, cron, nextRunAt, lastTriggeredAt: undefined, primed: true }, at(2026, 1, 1, 0, 0))
}

interface Harness {
  scheduler: SchedulerService
  runs: string[]
  applied: Array<{ id: string; nextRunAt: number | undefined; lastTriggeredAt: number | undefined }>
  setTasks(tasks: TaskRecord[]): void
  setNow(ms: number): void
  setReady(ready: boolean): void
}

/** Build a scheduler with a controllable task list, clock, and ready gate. */
function makeHarness(overrides: Partial<SchedulerDeps> = {}): Harness {
  let tasks: TaskRecord[] = []
  let now = at(2026, 1, 1, 10, 0, 30)
  let ready = true
  const runs: string[] = []
  const applied: Array<{ id: string; nextRunAt: number | undefined; lastTriggeredAt: number | undefined }> = []
  const scheduler = new SchedulerService({
    tasks: () => tasks,
    now: () => now,
    runTask: async id => { runs.push(id); return true },
    applySchedule: (id, nextRunAt, lastTriggeredAt) => {
      applied.push({ id, nextRunAt, lastTriggeredAt })
      // Keep the in-memory task list consistent with what a controller would
      // persist, so a second tick sees the rolled-forward rule.
      tasks = tasks.map(task => task.id === id
        ? { ...task, schedule: { ...task.schedule!, nextRunAt, lastTriggeredAt } }
        : task)
    },
    ready: () => ready,
    ...overrides,
  })
  return {
    scheduler, runs, applied,
    setTasks: value => { tasks = value },
    setNow: value => { now = value },
    setReady: value => { ready = value },
  }
}

describe('SchedulerService.tick', () => {
  it('triggers a due task and rolls its schedule forward to the next cron match', async () => {
    const h = makeHarness()
    // Due at 10:00:00; tick runs at 10:00:30.
    h.setTasks([scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 0, 0))])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-a'])
    expect(h.applied).toHaveLength(1)
    expect(h.applied[0].nextRunAt).toBe(at(2026, 1, 1, 10, 1, 0))
    expect(h.applied[0].lastTriggeredAt).toBe(at(2026, 1, 1, 10, 0, 30))
  })

  it('keeps the due slot when the run is rejected and retries on the next tick', async () => {
    let accept = false
    const h = makeHarness({ runTask: async id => { h.runs.push(id); return accept } })
    h.setTasks([scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 0, 0))])
    await h.scheduler.tick()
    // Rejected: the run was attempted but the schedule did not advance.
    expect(h.runs).toEqual(['t-a'])
    expect(h.applied).toEqual([])
    // Still due, so the next tick retries and now applies the roll-forward.
    accept = true
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-a', 't-a'])
    expect(h.applied).toHaveLength(1)
    expect(h.applied[0].nextRunAt).toBe(at(2026, 1, 1, 10, 1, 0))
  })

  it('skips (Forbid) a due task that is still running: rolls forward, counts, never queues', async () => {
    const h = makeHarness()
    h.setNow(at(2026, 1, 1, 10, 0, 30))
    // Due at 10:00 and still running since 09:59: the live run is never
    // queued behind nor killed — the slot is skipped, the grid advances from
    // the due instant, and the skip is counted (not retried, not a failure).
    const base = scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 0, 0))
    const { task: running } = startExecution(base, at(2026, 1, 1, 9, 59, 0), 'e-1')
    h.setTasks([running])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    expect(h.applied).toEqual([{ id: 't-a', nextRunAt: at(2026, 1, 1, 10, 1, 0), lastTriggeredAt: undefined }])
    expect(h.scheduler.skipStats()).toEqual({ overlap: 1, missed: 0 })
  })

  it('skips a long-superseded due slot without firing (no catch-up avalanche)', async () => {
    const h = makeHarness()
    h.setNow(at(2026, 1, 1, 10, 0, 30))
    // Due at 09:00, an hour of grid points passed since: stale. One jump to
    // the next grid point from now (10:01), never a one-step crawl.
    h.setTasks([scheduledTask('a', '* * * * *', at(2026, 1, 1, 9, 0, 0))])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    expect(h.applied).toEqual([{ id: 't-a', nextRunAt: at(2026, 1, 1, 10, 1, 0), lastTriggeredAt: undefined }])
    expect(h.scheduler.skipStats()).toEqual({ overlap: 0, missed: 1 })
  })

  it('emits the cumulative skip ledger through onSkips (wiring sink, optional)', async () => {
    const seen: Array<{ overlap: number; missed: number }> = []
    const h = makeHarness({ onSkips: stats => { seen.push({ ...stats }) } })
    h.setNow(at(2026, 1, 1, 10, 0, 30))
    const base = scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 0, 0))
    const { task: running } = startExecution(base, at(2026, 1, 1, 9, 59, 0), 'e-1')
    h.setTasks([running])
    await h.scheduler.tick()
    expect(seen).toEqual([{ overlap: 1, missed: 0 }])
    // No sink configured: skips stay readable through skipStats only.
    const h2 = makeHarness()
    h2.setNow(at(2026, 1, 1, 10, 0, 30))
    h2.setTasks([scheduledTask('a', '* * * * *', at(2026, 1, 1, 9, 0, 0))])
    await h2.scheduler.tick()
    expect(h2.scheduler.skipStats()).toEqual({ overlap: 0, missed: 1 })
  })

  it('still fires a merely-late slot, and honours a per-rule tolerance', async () => {
    // 90 seconds late with a 120-second tolerance: superseded but forgiven.
    const h = makeHarness()
    h.setNow(at(2026, 1, 1, 10, 0, 30))
    const due = at(2026, 1, 1, 9, 59, 0)
    const base = scheduledTask('a', '* * * * *', due)
    const tolerant = withSchedule(base, { missedToleranceMs: 120_000 }, at(2026, 1, 1, 10, 0, 30))
    expect(tolerant.schedule?.missedToleranceMs).toBe(120_000)
    h.setTasks([tolerant])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-a'])
    expect(h.scheduler.skipStats()).toEqual({ overlap: 0, missed: 0 })
    // Same lateness under the default one-tick tolerance: skipped.
    const h2 = makeHarness()
    h2.setNow(at(2026, 1, 1, 10, 0, 30))
    h2.setTasks([scheduledTask('a', '* * * * *', due)])
    await h2.scheduler.tick()
    expect(h2.runs).toEqual([])
    expect(h2.scheduler.skipStats()).toEqual({ overlap: 0, missed: 1 })
  })

  it('rolls */5 schedules to the next 5-minute boundary', async () => {
    const h = makeHarness()
    h.setNow(at(2026, 1, 1, 10, 3, 0))
    h.setTasks([scheduledTask('a', '*/5 * * * *', at(2026, 1, 1, 10, 0, 0))])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-a'])
    expect(h.applied[0].nextRunAt).toBe(at(2026, 1, 1, 10, 5, 0))
  })

  it('does not trigger before the due instant', async () => {
    const h = makeHarness()
    h.setTasks([scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 1, 0))])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    expect(h.applied).toEqual([])
  })

  it('fires an armed+due rule on the tick (arming alone is enough)', async () => {
    const h = makeHarness()
    // Armed + due: automation is active as soon as the rule is on — arming
    // alone triggers, there is no manual-first step to gate it.
    const base = createTask({ title: 'a', description: '', prompt: 'run' }, at(2026, 1, 1, 0, 0), 't-a')
    h.setTasks([withSchedule(base, { enabled: true, cron: '* * * * *', nextRunAt: at(2026, 1, 1, 10, 0, 0) }, at(2026, 1, 1, 10, 0, 30))])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-a'])
  })

  it('skips due instants while paused (review/backlog) and resumes from the next match', async () => {
    const h = makeHarness()
    h.setNow(at(2026, 1, 1, 10, 0, 30))
    const base = createTask({ title: 'a', description: '', prompt: 'run' }, at(2026, 1, 1, 0, 0), 't-a')
    // A primed rule on a paused (here: review) card: no trigger, the missed
    // due instant rolls forward (skip, never catch up). Backlog shares the
    // same path — both come out of ruleReadiness as 'paused'.
    h.setTasks([withStatus(withSchedule(base, { enabled: true, cron: '* * * * *', nextRunAt: at(2026, 1, 1, 10, 0, 0), primed: true }, at(2026, 1, 1, 0, 0)), 'review', at(2026, 1, 1, 10, 0, 0))])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    expect(h.applied).toEqual([{ id: 't-a', nextRunAt: at(2026, 1, 1, 10, 1, 0), lastTriggeredAt: undefined }])
    // Resume by moving to todo: the rule is active again and fires at the
    // next due instant (the rolled-forward one).
    h.setNow(at(2026, 1, 1, 10, 1, 30))
    h.setTasks([withStatus(withSchedule(base, { enabled: true, cron: '* * * * *', nextRunAt: at(2026, 1, 1, 10, 1, 0), primed: true }, at(2026, 1, 1, 10, 1, 0)), 'todo', at(2026, 1, 1, 10, 1, 0))])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-a'])
  })

  it('holds an armed rule whose prompt is empty (blocked): no run, due slot rolls forward', async () => {
    const h = makeHarness()
    h.setNow(at(2026, 1, 1, 10, 0, 30))
    const base = createTask({ title: 'a', description: '', prompt: '' }, at(2026, 1, 1, 0, 0), 't-a')
    h.setTasks([withSchedule(base, { enabled: true, cron: '* * * * *', nextRunAt: at(2026, 1, 1, 10, 0, 0) }, at(2026, 1, 1, 10, 0, 30))])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    expect(h.applied).toEqual([{ id: 't-a', nextRunAt: at(2026, 1, 1, 10, 1, 0), lastTriggeredAt: undefined }])
  })

  it('ignores disabled rules and tasks without a schedule', async () => {
    const h = makeHarness()
    h.setTasks([
      scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 0, 0), false),
      createTask({ title: 'b', description: '', prompt: '' }, at(2026, 1, 1, 0, 0), 't-b'),
    ])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    expect(h.applied).toEqual([])
  })

  it('recomputes a missing next-run instant instead of firing immediately', async () => {
    const h = makeHarness()
    // Enabled but nextRunAt lost (repaired/legacy data): recompute + wait.
    h.setTasks([scheduledTask('a', '*/5 * * * *', undefined)])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    expect(h.applied).toEqual([{ id: 't-a', nextRunAt: at(2026, 1, 1, 10, 5, 0), lastTriggeredAt: undefined }])
    // The repaired rule is now armed for the future.
    await h.scheduler.tick()
    expect(h.applied).toHaveLength(1)
  })

  it('skips rules whose cron cannot be recomputed', async () => {
    const h = makeHarness()
    h.setTasks([scheduledTask('a', 'not a cron', undefined)])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    expect(h.applied).toEqual([])
  })

  it('does not double-fire within consecutive ticks (schedule rolled forward)', async () => {
    const h = makeHarness()
    h.setTasks([scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 0, 0))])
    await h.scheduler.tick()
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-a'])
    expect(h.applied).toHaveLength(1)
  })

  it('no-ops while the ready gate is closed, then fires once it opens', async () => {
    const h = makeHarness()
    h.setTasks([scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 0, 0))])
    h.setReady(false)
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    expect(h.applied).toEqual([])
    h.setReady(true)
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-a'])
  })

  it('stops triggering after dispose', async () => {
    const h = makeHarness()
    h.setTasks([scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 0, 0))])
    h.scheduler.dispose()
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
  })

  it('disarms the schedule after the final budgeted run (maxRuns)', async () => {
    const h = makeHarness()
    // runCount 1/2 → this run is the second and final: schedule disarms.
    const task = withSchedule(
      scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 0, 0)),
      { runCount: 1, maxRuns: 2 },
      at(2026, 1, 1, 10, 0, 0),
    )
    h.setTasks([task])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-a'])
    expect(h.applied).toHaveLength(1)
    expect(h.applied[0].nextRunAt).toBeUndefined() // no next slot: disarmed
    expect(h.applied[0].lastTriggeredAt).toBe(at(2026, 1, 1, 10, 0, 30))
    // The harness records applySchedule arguments; the disable flag is not
    // part of the applied record — the controller persists `enabled:false`.
    // Assert the in-memory roll reflects a disarmed rule via a second tick:
    // nothing fires again because nextRunAt is undefined.
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-a'])
  })

  it('rolls forward while the run budget remains (runCount below maxRuns)', async () => {
    const h = makeHarness()
    const task = withSchedule(
      scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 0, 0)),
      { runCount: 1, maxRuns: 5 },
      at(2026, 1, 1, 10, 0, 0),
    )
    h.setTasks([task])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-a'])
    expect(h.applied).toHaveLength(1)
    expect(h.applied[0].nextRunAt).toBe(at(2026, 1, 1, 10, 1, 0)) // rolled forward
  })
})

describe('SchedulerService lifecycle', () => {
  it('start performs an immediate catch-up tick', () => {
    const h = makeHarness()
    h.setTasks([scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 0, 0))])
    h.scheduler.start()
    h.scheduler.dispose()
    expect(h.runs).toEqual(['t-a'])
  })

  it('restarts a stalled chain schedule with no open execution', async () => {
    const h = makeHarness()
    // A stalled chain = a 'running' card whose last run settled without a
    // hand-off (e.g. the settle hand-off was lost to a reload); the rule is
    // primed, so the recovery tick relaunches it.
    const task = createTask({ title: 'c', description: '', prompt: '' }, at(2026, 1, 1, 0, 0), 't-c')
    const chain = withSchedule(task, { enabled: true, mode: 'chain', cron: '', primed: true }, at(2026, 1, 1, 0, 0))
    const { task: running } = startExecution(chain, at(2026, 1, 1, 10, 0, 0), 'e1')
    // Open execution: the tick must not relaunch.
    h.setTasks([running])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    // The run settles (reconcile) and the card stays 'running' — but the
    // hand-off is lost; the recovery tick restarts the chain.
    const settled = settleExecution(running, 'e1', 'succeeded', at(2026, 1, 1, 10, 0, 31), undefined)
    expect(settled.status).toBe('running')
    h.setTasks([settled])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-c'])
  })

  it('a SAVED comment row does not block chain recovery, and an open lane on another session does', async () => {
    const h = makeHarness()
    const base = withSchedule(
      createTask({ title: 'c', description: '', prompt: '' }, at(2026, 1, 1, 0, 0), 't-c'),
      { enabled: true, mode: 'chain', cron: '', primed: true },
      at(2026, 1, 1, 0, 0),
    )
    const { task: ran } = startExecution(base, at(2026, 1, 1, 10, 0, 0), 'e1')
    const settled = settleExecution(ran, 'e1', 'succeeded', at(2026, 1, 1, 10, 0, 31), undefined)
    // A comment saved afterwards (cruise off — never injected) is the LAST row
    // and has no endedAt. The retired last-row check read it as "still
    // running" and stalled the chain forever.
    const withSavedComment: typeof settled = {
      ...settled,
      executions: [...settled.executions, {
        id: 'c1', sessionId: 's-2', startedAt: at(2026, 1, 1, 11, 0, 0), endedAt: undefined,
        result: undefined, error: undefined, comment: '挂着的一条',
      }],
    }
    h.setTasks([withSavedComment])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-c'])
    // But a lane that is genuinely IN FLIGHT (an injected round on another
    // session) must hold the next link back — recovery must not stack a run on
    // top of a conversation the card is still working.
    h.runs.length = 0
    const withLiveLane: typeof settled = {
      ...settled,
      executions: [...settled.executions, {
        id: 'c2', sessionId: 's-2', startedAt: at(2026, 1, 1, 11, 0, 0), endedAt: undefined,
        result: undefined, error: undefined, comment: '正在跑的一条', injectedAt: at(2026, 1, 1, 11, 0, 1),
      }],
    }
    h.setTasks([withLiveLane])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
  })

  it('never restarts a chain whose last PLAIN run failed (失败不续)', async () => {
    const h = makeHarness()
    const base = withSchedule(
      createTask({ title: 'c', description: '', prompt: '' }, at(2026, 1, 1, 0, 0), 't-c'),
      { enabled: true, mode: 'chain', cron: '', primed: true },
      at(2026, 1, 1, 0, 0),
    )
    const { task: ran } = startExecution(base, at(2026, 1, 1, 10, 0, 0), 'e1')
    const failed = settleExecution(ran, 'e1', 'failed', at(2026, 1, 1, 10, 0, 31), 'boom')
    // A comment round settling afterwards must not make the failed run look
    // like a success (the retired last-row read did exactly that).
    const withGoodComment: typeof failed = {
      ...failed,
      executions: [...failed.executions, {
        id: 'c1', sessionId: 's-2', startedAt: at(2026, 1, 1, 11, 0, 0), endedAt: at(2026, 1, 1, 11, 0, 5),
        result: 'succeeded', error: undefined, comment: '后来跑通的留言',
      }],
    }
    h.setTasks([withGoodComment])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
  })

  it('restarts a stalled chain FROM ANY SETTLED COLUMN — 完成后接续 never waits for a manual re-run', async () => {
    const h = makeHarness()
    const task = createTask({ title: 'c', description: '', prompt: '' }, at(2026, 1, 1, 0, 0), 't-c')
    // A settled review card whose hand-off was lost to a reload is restarted
    // by the recovery tick: the rule is armed and within budget, and the
    // stalled state means the chain should be running again.
    const review = withStatus(withSchedule(task, { enabled: true, mode: 'chain', cron: '', primed: true }, at(2026, 1, 1, 0, 0)), 'review', at(2026, 1, 1, 10, 0, 0))
    h.setTasks([review])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-c'])
  })

  it('never restarts a chain with an open run, a hit budget, or a completed (done) card', async () => {
    const h = makeHarness()
    const task = createTask({ title: 'c', description: '', prompt: '' }, at(2026, 1, 1, 0, 0), 't-c')
    // Open execution: the tick must not relaunch.
    const chain = withSchedule(task, { enabled: true, mode: 'chain', cron: '', primed: true }, at(2026, 1, 1, 0, 0))
    const { task: running } = startExecution(chain, at(2026, 1, 1, 10, 0, 0), 'e1')
    h.setTasks([running])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    // Budget reached: disarmed? No — runCount cap is the guard.
    h.setTasks([withSchedule(task, { enabled: true, mode: 'chain', cron: '', primed: true, maxRuns: 2, runCount: 2 }, at(2026, 1, 1, 0, 0))])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    // Done card: completion is the hard stop (legacy rows with a stale
    // enabled flag are still skipped outright).
    const done = withStatus(withSchedule(task, { enabled: true, mode: 'chain', cron: '', primed: true }, at(2026, 1, 1, 0, 0)), 'done', at(2026, 1, 1, 10, 0, 0))
    h.setTasks([done])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
  })

  it('does not restart a chain that reached its budget', async () => {
    const h = makeHarness()
    const task = createTask({ title: 'c', description: '', prompt: '' }, at(2026, 1, 1, 0, 0), 't-c')
    const chain = withSchedule(task, { enabled: true, mode: 'chain', cron: '', primed: true, maxRuns: 2, runCount: 2 }, at(2026, 1, 1, 0, 0))
    h.setTasks([chain])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
  })

  it('does not restart a chain when the budget is filled by the uncounted first run', async () => {
    // runCount = 1 means the hand-off has launched 2 runs so far (the armed
    // first run is never counted) — maxRuns = 2, the budget is exhausted, so
    // a recovery launch would over-run it. The guard must read
    // `runCount + 1 >= maxRuns` (one ahead of the counter).
    const h = makeHarness()
    const task = createTask({ title: 'c', description: '', prompt: '' }, at(2026, 1, 1, 0, 0), 't-c')
    const chain = withSchedule(task, { enabled: true, mode: 'chain', cron: '', primed: true, maxRuns: 2, runCount: 1 }, at(2026, 1, 1, 0, 0))
    h.setTasks([chain])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
  })

  it('ticks on tab-visibility recovery through the environment listener', () => {
    let listener: (() => void) | undefined
    const environment: SchedulerDeps['environment'] = {
      addEventListener: (_type, fn) => { listener = fn },
      removeEventListener: () => { listener = undefined },
    }
    const h = makeHarness({ environment })
    h.setTasks([scheduledTask('a', '* * * * *', at(2026, 1, 1, 10, 1, 0))])
    h.scheduler.start() // 10:00:30 → due 10:01:00, not due yet
    h.setNow(at(2026, 1, 1, 10, 1, 30))
    listener!() // visibilitychange → immediate tick → due
    h.scheduler.dispose()
    expect(h.runs).toEqual(['t-a'])
    expect(listener).toBeUndefined() // listener unregistered on dispose
  })
})

describe('isHeartbeatStale (Period + Grace liveness)', () => {
  it('reads alive before the first tick and across a clock step-back', () => {
    expect(isHeartbeatStale(undefined, 1_000)).toBe(false)
    expect(isHeartbeatStale(2_000, 1_000)).toBe(false)
  })

  it('flips only past Period + Grace (default one tick + one grace)', () => {
    const okAt = 1_000_000
    expect(isHeartbeatStale(okAt, okAt + 119_999)).toBe(false)
    expect(isHeartbeatStale(okAt, okAt + 120_000)).toBe(false)
    expect(isHeartbeatStale(okAt, okAt + 120_001)).toBe(true)
  })

  it('scales with a custom tick cadence', () => {
    const okAt = 1_000_000
    expect(isHeartbeatStale(okAt, okAt + 9_999, 5_000)).toBe(false)
    expect(isHeartbeatStale(okAt, okAt + 10_001, 5_000)).toBe(true)
  })
})

describe('SchedulerService heartbeat stamps', () => {
  it('advances lastOkAt on a completed tick and emits the sink', async () => {
    const seen: Array<{ tickAt: number; okAt: number }> = []
    const h = makeHarness({ onHeartbeat: hb => { seen.push(hb) } })
    expect(h.scheduler.heartbeat()).toEqual({ lastTickAt: undefined, lastOkAt: undefined })
    h.setNow(at(2026, 1, 1, 10, 0, 30))
    await h.scheduler.tick()
    expect(h.scheduler.heartbeat()).toEqual({
      lastTickAt: at(2026, 1, 1, 10, 0, 30),
      lastOkAt: at(2026, 1, 1, 10, 0, 30),
    })
    expect(seen).toEqual([{ tickAt: at(2026, 1, 1, 10, 0, 30), okAt: at(2026, 1, 1, 10, 0, 30) }])
  })

  it('records the tick entry but not completion when the rules-tick throws', async () => {
    const h = makeHarness({
      sessionRulesTick: async () => { throw new Error('rules wedged') },
    })
    h.setNow(at(2026, 1, 1, 10, 0, 30))
    await expect(h.scheduler.tick()).rejects.toThrow('rules wedged')
    // Entered (diagnosable as "tick started") but never healthy.
    expect(h.scheduler.heartbeat()).toEqual({
      lastTickAt: at(2026, 1, 1, 10, 0, 30),
      lastOkAt: undefined,
    })
    expect(isHeartbeatStale(undefined, at(2026, 1, 1, 12, 0, 30))).toBe(false)
  })

  it('freezes both stamps while not ready or after dispose', async () => {
    const h = makeHarness()
    h.setReady(false)
    await h.scheduler.tick()
    expect(h.scheduler.heartbeat()).toEqual({ lastTickAt: undefined, lastOkAt: undefined })
    h.setReady(true)
    h.setNow(at(2026, 1, 1, 10, 0, 30))
    await h.scheduler.tick()
    expect(h.scheduler.heartbeat().lastOkAt).toBe(at(2026, 1, 1, 10, 0, 30))
    h.scheduler.dispose()
    h.setNow(at(2026, 1, 1, 10, 5, 30))
    await h.scheduler.tick()
    expect(h.scheduler.heartbeat().lastOkAt).toBe(at(2026, 1, 1, 10, 0, 30))
  })
})
