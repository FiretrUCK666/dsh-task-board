/**
 * Scheduler tests: the schedule heartbeat — due triggering, roll-forward,
 * gates (ready/disposed/disabled), and tab-visibility recovery. Drives
 * `tick` directly (no real timers).
 */
import { describe, expect, it } from 'vitest'
import { SchedulerService, type SchedulerDeps } from '../src/core/scheduler.ts'
import { createTask, startExecution, withSchedule, type TaskRecord } from '../src/core/tasks.ts'

/** Local-time ms epoch helper. */
function at(year: number, month: number, day: number, hour: number, minute: number, second = 0): number {
  return new Date(year, month - 1, day, hour, minute, second).getTime()
}

/** A task carrying an armed, manually-primed schedule rule. */
function scheduledTask(id: string, cron: string, nextRunAt: number | undefined, enabled = true): TaskRecord {
  const base = createTask({ title: id, description: '', prompt: '' }, at(2026, 1, 1, 0, 0), `t-${id}`)
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

  it('never triggers a rule a manual run has not primed', async () => {
    const h = makeHarness()
    // Armed + due, but not primed: arming a rule must never execute anything.
    const base = createTask({ title: 'a', description: '', prompt: '' }, at(2026, 1, 1, 0, 0), 't-a')
    h.setTasks([withSchedule(base, { enabled: true, cron: '* * * * *', nextRunAt: at(2026, 1, 1, 10, 0, 0) }, at(2026, 1, 1, 0, 0))])
    await h.scheduler.tick()
    expect(h.runs).toEqual([])
    // The due slot is untouched: once a manual run primes the rule, the
    // schedule takes over at its next due instant (never an instant catch-up).
    expect(h.applied).toEqual([])
    // A manual run primes it (as the controller's runTask does), and the
    // still-due slot fires on the next tick.
    h.setTasks([withSchedule(base, { enabled: true, cron: '* * * * *', nextRunAt: at(2026, 1, 1, 10, 0, 0), primed: true }, at(2026, 1, 1, 10, 0, 30))])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-a'])
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
    // A stalled chain = previously primed + running before a reload; the
    // rule's primed flag is persisted, so the recovery tick relaunches it.
    const task = createTask({ title: 'c', description: '', prompt: '' }, at(2026, 1, 1, 0, 0), 't-c')
    const chain = withSchedule(task, { enabled: true, mode: 'chain', cron: '', primed: true }, at(2026, 1, 1, 0, 0))
    h.setTasks([chain])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-c'])
    // A second tick while the run is open in the ledger must not relaunch.
    const { task: running } = startExecution(chain, at(2026, 1, 1, 10, 0, 31), 'e1')
    h.setTasks([running])
    await h.scheduler.tick()
    expect(h.runs).toEqual(['t-c'])
  })

  it('does not restart a chain that reached its budget', async () => {
    const h = makeHarness()
    const task = createTask({ title: 'c', description: '', prompt: '' }, at(2026, 1, 1, 0, 0), 't-c')
    const chain = withSchedule(task, { enabled: true, mode: 'chain', cron: '', primed: true, maxRuns: 2, runCount: 2 }, at(2026, 1, 1, 0, 0))
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
