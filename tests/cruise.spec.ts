/**
 * Cruise tests: the auto-cruise queue — event-driven pump, concurrency
 * limit, disable semantics, and slot release on rejection.
 */
import { describe, expect, it } from 'vitest'
import { CruiseService, type CruiseDeps } from '../src/core/cruise.ts'
import { createTask, withStatus, type TaskRecord } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

/** A controllable cruise harness: ledger, accept gate, limit, and manual settle. */
function makeCruise(overrides: Partial<CruiseDeps> = {}) {
  let tasks: TaskRecord[] = []
  let limit = 5
  let accept = true
  const runs: string[] = []
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const fn of [...listeners]) fn() }
  const deps: CruiseDeps = {
    tasks: () => tasks,
    runTask: async id => {
      if (!accept) return false
      runs.push(id)
      // The controller would move the card to running and notify.
      tasks = tasks.map(task => task.id === id ? { ...task, status: 'running' } : task)
      notify()
      return true
    },
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
    limit: () => limit,
    ...overrides,
  }
  const cruise = new CruiseService(deps)
  cruise.start()
  return {
    cruise, runs, notify,
    setTasks: (value: TaskRecord[]) => { tasks = value },
    setLimit: (value: number) => { limit = value },
    setAccept: (value: boolean) => { accept = value },
    settle: (id: string, status: 'review' | 'todo') => {
      tasks = tasks.map(task => task.id === id ? withStatus(task, status, NOW) : task)
      notify()
    },
  }
}

/** `n` tasks in the todo column. */
function todoTasks(count: number): TaskRecord[] {
  return Array.from({ length: count }, (_, index) =>
    createTask({ title: `t-${index}`, description: '', prompt: '' }, NOW, `t-${index}`))
}

/** Flush pending microtasks (runTask rejections settle in .then callbacks). */
const flush = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

describe('CruiseService', () => {
  it('picks up todo tasks up to the concurrency limit when enabled', async () => {
    const h = makeCruise()
    h.setTasks(todoTasks(100))
    h.cruise.setEnabled(true)
    // The pump runs synchronously on enable: exactly `limit` starts.
    expect(h.runs).toHaveLength(5)
    expect(h.cruise.activeIds()).toHaveLength(5)
  })

  it('fills a freed slot when a run settles (event-driven pump)', async () => {
    const h = makeCruise()
    h.setTasks(todoTasks(100))
    h.cruise.setEnabled(true)
    expect(h.runs).toHaveLength(5)
    // One run settles into review → the pump starts the next todo.
    h.settle('t-0', 'review')
    expect(h.runs).toHaveLength(6)
    expect(h.cruise.activeIds()).toHaveLength(5)
    // A settled run is never re-picked: review tasks stay untouched.
    h.settle('t-1', 'review')
    expect(h.runs).toHaveLength(7)
  })

  it('releases the slot on rejection and refills on the next notification', async () => {
    const h = makeCruise()
    h.setTasks(todoTasks(100))
    h.setAccept(false)
    h.cruise.setEnabled(true)
    await flush()
    // Every start is rejected: the running set stays empty (slots released).
    expect(h.cruise.activeIds()).toHaveLength(0)
    // Rejections never spin: without a state change nothing re-picks.
    h.notify()
    await flush()
    expect(h.cruise.activeIds()).toHaveLength(0)
    // Accepting again + a notification refills the queue.
    h.setAccept(true)
    h.notify()
    expect(h.cruise.activeIds().length).toBeGreaterThan(0)
  })

  it('never starts a task already running (cruise or not)', async () => {
    const h = makeCruise()
    const tasks = todoTasks(3)
    // t-1 is already running from another surface.
    tasks[1] = withStatus(tasks[1], 'running', NOW)
    h.setTasks(tasks)
    h.cruise.setEnabled(true)
    expect(h.runs).toEqual(['t-0', 't-2'])
  })

  it('disabling stops picking new tasks but never aborts in-flight runs', async () => {
    const h = makeCruise()
    h.setTasks(todoTasks(100))
    h.cruise.setEnabled(true)
    expect(h.runs).toHaveLength(5)
    h.cruise.setEnabled(false)
    // Settling frees a slot, but the disabled cruise does not refill it.
    h.settle('t-0', 'review')
    h.settle('t-1', 'review')
    expect(h.runs).toHaveLength(5)
    // Re-enabling refills from where the queue stopped.
    h.cruise.setEnabled(true)
    expect(h.runs.length).toBeGreaterThan(5)
  })

  it('re-pumps with the new limit after kick', async () => {
    const h = makeCruise()
    h.setTasks(todoTasks(100))
    h.cruise.setEnabled(true)
    expect(h.runs).toHaveLength(5)
    h.setLimit(8)
    h.cruise.kick()
    expect(h.runs).toHaveLength(8)
    h.setLimit(2)
    h.cruise.kick()
    // Shrinking the limit never aborts in-flight runs.
    expect(h.runs).toHaveLength(8)
  })

  it('dispose unsubscribes and clears tracking', () => {
    const h = makeCruise()
    h.setTasks(todoTasks(3))
    h.cruise.setEnabled(true)
    h.cruise.dispose()
    h.settle('t-0', 'review')
    expect(h.runs).toHaveLength(3)
  })
})
