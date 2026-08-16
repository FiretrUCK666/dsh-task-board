/**
 * Cruise service: the board's auto-cruise — a concurrency-limited queue that
 * picks up 'todo' tasks and runs them one after another while enabled.
 *
 * The pump is event-driven, never timer-driven: every task mutation (a run
 * starting, settling, a card moving) notifies the controller subscribers and
 * the pump re-evaluates the queue. Browsers throttle background timers, so a
 * polling loop would stall hidden tabs; settle notifications are the natural
 * "slot freed" signal anyway. While enabled the service keeps at most
 * `limit()` runs it started in flight; disabling stops picking new tasks but
 * never aborts in-flight runs. Runs that fail simply land in 'review' (the
 * human gate) and are never re-picked — the cruise only ever starts 'todo'
 * tasks, so nothing loops.
 *
 * Framework-free: all runtime access flows through the injected deps, so
 * tests drive the queue with plain fakes.
 */
import type { TaskRecord } from './tasks.ts'

/** Everything the cruise needs from its host (the board controller). */
export interface CruiseDeps {
  /** Read the current task ledger (the controller snapshot). */
  tasks(): readonly TaskRecord[]
  /** Start one task's real execution; resolves true when accepted (the run
   *  guard rejects a busy/deleted task). */
  runTask(id: string): Promise<boolean>
  /** Controller snapshot subscription: any mutation pumps the queue. */
  subscribe(fn: () => void): () => void
  /** Current concurrency limit (live-read, so it may change at runtime). */
  limit(): number
}

/** The auto-cruise queue (see module doc). */
export class CruiseService {
  private enabled = false
  /** Tasks this service started whose run is still open (its in-flight slot). */
  private running = new Set<string>()
  private unsubscribe: (() => void) | undefined = undefined
  private disposed = false
  // Reentrancy guard: a run start notifies the ledger subscribers, which
  // pumps again. Without the guard that nests a new pump inside the running
  // one (unbounded recursion on large ledgers, and a churn-dependent pickup
  // order). With it, notifications arriving mid-pump are folded into the
  // current pass and the loop simply continues until the queue is settled.
  private pumping = false
  private pumpQueued = false

  /** @param deps - ledger/run/subscribe/limit faces (see {@link CruiseDeps}). */
  constructor(private readonly deps: CruiseDeps) {}

  /** Whether the cruise is currently picking up new tasks. */
  get active(): boolean {
    return this.enabled
  }

  /** Task ids this service started that are still running (in-flight slots). */
  activeIds(): readonly string[] {
    return [...this.running]
  }

  /** Start listening to ledger mutations (idempotent). */
  start(): void {
    if (this.disposed || this.unsubscribe !== undefined) return
    this.unsubscribe = this.deps.subscribe(() => { this.pump() })
  }

  /** Stop listening and drop in-flight tracking (idempotent). */
  dispose(): void {
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.running.clear()
  }

  /**
   * Turn the cruise on or off. On: the queue is pumped immediately (any
   * previously accumulated 'todo' tasks start, up to the limit). Off: no
   * new tasks are picked; runs already in flight finish normally.
   */
  setEnabled(on: boolean): void {
    if (this.disposed || this.enabled === on) return
    this.enabled = on
    if (on) this.pump()
  }

  /** Re-evaluate the queue now (e.g. after the concurrency limit changed). */
  kick(): void {
    if (this.enabled) this.pump()
  }

  /**
   * Fill every free slot: drop ids whose task is no longer running (settled,
   * moved, deleted), then start 'todo' tasks until the limit is reached.
   * Reentrant notifications are folded into the current pass (see the
   * reentrancy guard on the class).
   */
  private pump(): void {
    if (this.disposed || !this.enabled) return
    if (this.pumping) {
      this.pumpQueued = true
      return
    }
    this.pumping = true
    try {
      for (;;) {
        this.pumpQueued = false
        const tasks = this.deps.tasks()
        for (const id of [...this.running]) {
          const task = tasks.find(candidate => candidate.id === id)
          if (task === undefined || task.status !== 'running') this.running.delete(id)
        }
        while (this.running.size < this.deps.limit()) {
          const candidate = tasks.find(task => task.status === 'todo' && !this.running.has(task.id))
          if (candidate === undefined) break
          this.running.add(candidate.id)
          void this.deps.runTask(candidate.id).then(accepted => {
            // Rejected (the run guard refused: the task is busy or was
            // deleted mid-pump): free the slot. No immediate re-pick — a
            // rejected task's state change (settle, move) notifies the
            // ledger and the next pump fills the slot, so repeated
            // rejections can never spin.
            if (!accepted) this.running.delete(candidate.id)
          })
        }
        if (!this.pumpQueued) break
      }
    } finally {
      this.pumping = false
    }
  }
}
