/**
 * Task persistence: a small storage seam with a localStorage backend.
 *
 * The task-board client plugin runs in the browser, and dsh exposes no
 * browser-writable file channel , so tasks persist in the browser's
 * localStorage under a versioned key — the same persistence mechanism dsh's
 * own client snapshot stores use (`createSnapshotStore` persist). Data
 * survives page refreshes and dsh restarts (same origin), and survives
 * plugin uninstall (the key is simply left in place).
 *
 * The seam keeps the backend swappable (e.g. an IndexedDB or a host-file
 * channel later); tests run against the in-memory backend and a jsdom
 * localStorage backend.
 */
import { isValidCron } from './schedule.ts'
import type { ScheduleRule, TaskRecord, TaskStatus } from './tasks.ts'
import { isScheduleMode, isTaskStatus } from './tasks.ts'

/** Persistence seam for the task ledger. */
export interface TaskStore {
  /** Read the persisted ledger (empty when nothing is stored yet). */
  load(): TaskRecord[]
  /** Persist the whole ledger (replaces the stored document). */
  save(tasks: readonly TaskRecord[]): void
  /** Drop the persisted ledger (leaves the in-memory state alone). */
  clear(): void
}

/** Storage key for the task ledger document. */
export const DEFAULT_STORAGE_KEY = 'dsh.taskBoard.v1'

/**
 * Structural row check with the status left unvalidated (see {@link parseLedger}).
 * The `schedule` field is deliberately NOT checked here: a malformed schedule
 * never drops the task row — {@link normalizeSchedule} repairs or drops the
 * schedule alone.
 */
function isTaskRecordShape(value: unknown): value is Omit<TaskRecord, 'status'> & { status: unknown } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id === '') return false
  if (typeof record.title !== 'string') return false
  if (typeof record.description !== 'string') return false
  if (typeof record.prompt !== 'string') return false
  if (typeof record.createdAt !== 'number') return false
  if (typeof record.updatedAt !== 'number') return false
  if (!Array.isArray(record.executions)) return false
  for (const execution of record.executions) {
    if (typeof execution !== 'object' || execution === null) return false
    const entry = execution as Record<string, unknown>
    if (typeof entry.id !== 'string') return false
    if (entry.sessionId !== undefined && typeof entry.sessionId !== 'string') return false
    if (typeof entry.startedAt !== 'number') return false
    if (entry.endedAt !== undefined && typeof entry.endedAt !== 'number') return false
    if (entry.result !== undefined && entry.result !== 'succeeded' && entry.result !== 'failed' && entry.result !== 'cancelled') return false
    if (entry.error !== undefined && typeof entry.error !== 'string') return false
  }
  return true
}

/** A task record is structurally valid if it round-trips through the UI. */
export function isTaskRecord(value: unknown): value is TaskRecord {
  return isTaskRecordShape(value) && isTaskStatus(value.status)
}

/** Normalize an unknown persisted status back into the closed status union. */
function normalizeStatus(status: unknown): TaskStatus {
  if (isTaskStatus(status)) return status
  // The 'failed' column was removed in favor of the human 'review' gate:
  // legacy failed tasks land in review so their outcome is inspected.
  if (status === 'failed') return 'review'
  return 'todo'
}

/**
 * Repair a persisted schedule rule: drop rules without a usable cron string
 * (cron mode), coerce booleans/numbers, normalize the mode (legacy rules
 * default to 'cron'), and leave `nextRunAt`/`lastTriggeredAt` undefined
 * when missing (a fresh recompute or the next tick fixes them).
 */
function normalizeSchedule(schedule: unknown): ScheduleRule | undefined {
  if (typeof schedule !== 'object' || schedule === null) return undefined
  const rule = schedule as Record<string, unknown>
  const mode = isScheduleMode(rule.mode) ? rule.mode : 'cron'
  // Reject (drop) a cron-mode rule whose cron is not a well-formed 5-field
  // expression: a malformed rule would otherwise linger as a never-firing
  // schedule instead of being dropped for later repair. Chain rules carry
  // no cron and never fire on the clock.
  if (typeof rule.cron !== 'string') {
    if (mode !== 'chain') return undefined
  } else if (mode === 'cron' && (rule.cron.trim() === '' || !isValidCron(rule.cron))) {
    return undefined
  }
  // `maxRuns`/`runCount` are newer fields: persisted rules from older
  // versions lack them, so they are defaulted here (unlimited / zero) rather
  // than treated as corrupt.
  const maxRuns = rule.maxRuns
  const runCount = rule.runCount
  return {
    enabled: rule.enabled === true,
    mode,
    cron: typeof rule.cron === 'string' ? rule.cron : '',
    nextRunAt: typeof rule.nextRunAt === 'number' ? rule.nextRunAt : undefined,
    lastTriggeredAt: typeof rule.lastTriggeredAt === 'number' ? rule.lastTriggeredAt : undefined,
    maxRuns: typeof maxRuns === 'number' && Number.isInteger(maxRuns) && maxRuns > 0 ? maxRuns : undefined,
    runCount: typeof runCount === 'number' && Number.isInteger(runCount) && runCount >= 0 ? runCount : 0,
    primed: rule.primed === true,
  }
}

/** Parse + validate a persisted ledger document; invalid rows are dropped. */
export function parseLedger(raw: string | null): TaskRecord[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.error('[dsh-task-board] persisted task ledger is not valid JSON; starting empty', error)
    return []
  }
  if (!Array.isArray(parsed)) {
    console.error('[dsh-task-board] persisted task ledger is not an array; starting empty')
    return []
  }
  const tasks: TaskRecord[] = []
  for (const row of parsed) {
    // Status is normalized (an unknown status from a future version lands in
    // todo instead of dropping the row); the schedule is repaired field by
    // field; every other field must be valid.
    if (!isTaskRecordShape(row)) {
      console.warn('[dsh-task-board] dropping invalid task row from persisted ledger', row)
      continue
    }
    // Always (re)assign the schedule: a repair that returns undefined must
    // clear a malformed persisted rule rather than leave it in the row.
    const task: TaskRecord = { ...row, status: normalizeStatus(row.status) }
    task.schedule = normalizeSchedule(row.schedule)
    // Legacy rows carry no sort key: assign the array position so the
    // previous relative order is preserved.
    const rawOrder = (row as Record<string, unknown>).order
    task.order = typeof rawOrder === 'number' && Number.isFinite(rawOrder) ? rawOrder : tasks.length
    // Legacy rows carry no viewed baseline: default it to the task's newest
    // round activity, so content that predates the unread reminder never
    // lights up as unviewed; anything settling after that stays unread.
    const rawViewed = (row as Record<string, unknown>).viewedAt
    task.viewedAt = typeof rawViewed === 'number'
      ? rawViewed
      : task.executions.reduce((latest, round) => Math.max(latest, round.endedAt ?? round.startedAt), 0)
    // Same for execution rows: a run without a viewed baseline defaults to
    // its own latest activity at load (a running one to its start), so old
    // content stays quiet and only newer settlement/comment activity lights
    // the row's unread dot.
    task.executions = task.executions.map(round => {
      if (round.viewedAt !== undefined) return round
      return { ...round, viewedAt: round.endedAt ?? round.startedAt }
    })
    tasks.push(task)
  }
  return tasks
}

/** localStorage-backed store (the browser backend). */
export class LocalStorageTaskStore implements TaskStore {
  /**
   * @param key - storage key for the ledger document.
   * @param storage - storage backend (defaults to the global localStorage; tests inject fakes).
   */
  constructor(
    private readonly key: string = DEFAULT_STORAGE_KEY,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = globalThis.localStorage,
  ) {}

  load(): TaskRecord[] {
    if (this.storage === undefined) return []
    try {
      return parseLedger(this.storage.getItem(this.key))
    } catch (error) {
      // Storage read failures (private mode, quota) degrade to an empty ledger,
      // never break the board.
      console.error('[dsh-task-board] task ledger read failed; starting empty', error)
      return []
    }
  }

  save(tasks: readonly TaskRecord[]): void {
    if (this.storage === undefined) return
    try {
      this.storage.setItem(this.key, JSON.stringify(tasks))
    } catch (error) {
      // Write failures only skip persistence; in-memory state stays live.
      console.error('[dsh-task-board] task ledger write failed (persistence skipped)', error)
    }
  }

  clear(): void {
    if (this.storage === undefined) return
    try {
      this.storage.removeItem(this.key)
    } catch (error) {
      console.error('[dsh-task-board] task ledger clear failed', error)
    }
  }
}

/** In-memory backend (tests, and a fallback when storage is unavailable). */
export class InMemoryTaskStore implements TaskStore {
  private ledger: TaskRecord[] = []

  load(): TaskRecord[] {
    return this.ledger.map(task => ({ ...task, executions: [...task.executions] }))
  }

  save(tasks: readonly TaskRecord[]): void {
    this.ledger = tasks.map(task => ({ ...task, executions: [...task.executions] }))
  }

  clear(): void {
    this.ledger = []
  }
}
