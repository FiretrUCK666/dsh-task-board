/**
 * Task persistence: a small storage seam with a localStorage backend.
 *
 * The task-board client plugin runs in the browser, and dsh exposes no
 * browser-writable file channel, so tasks persist in the browser's
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
import { normalizeSessionRules } from './automation.ts'
import type { ScheduleRule, TaskRecord, TaskStatus } from './tasks.ts'
import { isScheduleMode, isTaskStatus, normalizeLabels, normalizePriority, type TaskBind } from './tasks.ts'

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
  const missedToleranceMs = rule.missedToleranceMs
  return {
    enabled: rule.enabled === true,
    mode,
    cron: typeof rule.cron === 'string' ? rule.cron : '',
    nextRunAt: typeof rule.nextRunAt === 'number' ? rule.nextRunAt : undefined,
    lastTriggeredAt: typeof rule.lastTriggeredAt === 'number' ? rule.lastTriggeredAt : undefined,
    maxRuns: typeof maxRuns === 'number' && Number.isInteger(maxRuns) && maxRuns > 0 ? maxRuns : undefined,
    runCount: typeof runCount === 'number' && Number.isInteger(runCount) && runCount >= 0 ? runCount : 0,
    // Missed-slot tolerance is newer still: older persisted rules lack it and
    // read it as undefined (one scheduler tick), same defaulting discipline
    // as maxRuns/runCount above.
    missedToleranceMs: typeof missedToleranceMs === 'number' && Number.isFinite(missedToleranceMs) && missedToleranceMs > 0
      ? Math.floor(missedToleranceMs)
      : undefined,
    // Legacy activation gate (see ScheduleRule.primed): automation is active
    // as soon as it is armed, so persisted rules always read primed — the
    // field is kept only so old documents parse losslessly.
    primed: true,
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
    // The live binding (session/workspace dragged in from the sidebar) and the
    // display-hidden row sets are optional and forward-compatible: normalize
    // them strictly and drop a malformed value rather than failing the row.
    const rawBind = (row as Record<string, unknown>).bind
    if (
      (rawBind as { kind?: unknown } | undefined)?.kind === 'session'
      && typeof (rawBind as { sessionId?: unknown }).sessionId === 'string'
    ) {
      task.bind = { kind: 'session', sessionId: (rawBind as { sessionId: string }).sessionId }
    } else if (
      (rawBind as { kind?: unknown } | undefined)?.kind === 'workspace'
      && typeof (rawBind as { workspaceId?: unknown }).workspaceId === 'string'
    ) {
      task.bind = { kind: 'workspace', workspaceId: (rawBind as { workspaceId: string }).workspaceId }
    } else {
      delete task.bind
    }
    // The multi-source bindings list (the current shape): validated entry by
    // entry, malformed rows dropped, an absent/empty list cleared.
    const rawBinds = (row as Record<string, unknown>).binds
    if (Array.isArray(rawBinds)) {
      const binds = rawBinds
        .map((entry): TaskBind | undefined => {
          if (typeof entry !== 'object' || entry === null) return undefined
          const source = entry as Record<string, unknown>
          if (source.kind === 'session' && typeof source.sessionId === 'string') {
            return { kind: 'session' as const, sessionId: source.sessionId }
          }
          if (source.kind === 'workspace' && typeof source.workspaceId === 'string') {
            return { kind: 'workspace' as const, workspaceId: source.workspaceId }
          }
          return undefined
        })
        .filter((entry): entry is TaskBind => entry !== undefined)
      if (binds.length > 0) task.binds = binds
      else delete (task as { binds?: unknown }).binds
    } else {
      delete (task as { binds?: unknown }).binds
    }
    const rawHidden = (row as Record<string, unknown>).hidden
    const cleanIdArray = (value: unknown): string[] | undefined => {
      if (!Array.isArray(value)) return undefined
      const ids = value.filter((item): item is string => typeof item === 'string')
      return ids.length > 0 ? ids : undefined
    }
    if (rawHidden !== null && typeof rawHidden === 'object') {
      const executions = cleanIdArray((rawHidden as { executions?: unknown }).executions)
      const sessions = cleanIdArray((rawHidden as { sessions?: unknown }).sessions)
      if (executions !== undefined || sessions !== undefined) {
        task.hidden = { ...executions !== undefined ? { executions } : {}, ...sessions !== undefined ? { sessions } : {} }
      }
    }
    if (task.hidden === undefined) delete task.hidden
    // Sessions permanently removed from the task: the same id-array shape as
    // hidden's session set, kept as its own field (removed ≠ hidden — a
    // removed session must never re-derive from a bound workspace).
    const removedSessions = cleanIdArray((row as Record<string, unknown>).removedSessions)
    if (removedSessions !== undefined) task.removedSessions = removedSessions
    else delete (task as { removedSessions?: unknown }).removedSessions
    // The manual session-list order (top first), the same id-array shape.
    const sessionsOrder = cleanIdArray((row as Record<string, unknown>).sessionsOrder)
    if (sessionsOrder !== undefined) task.sessionsOrder = sessionsOrder
    else delete (task as { sessionsOrder?: unknown }).sessionsOrder
    // The per-card accent color is a forward-compatible optional field:
    // validate it loosely (old data keeps working untouched). The legacy tag
    // ids field is dropped silently — tags were removed, color only remains.
    delete (task as { tags?: unknown }).tags
    const rawColor = (row as Record<string, unknown>).color
    if (typeof rawColor === 'string' && rawColor !== '') task.color = rawColor
    else delete task.color
    // Due instant: a finite positive instant survives, anything else reads
    // absent (old data keeps working untouched).
    const rawDue = (row as Record<string, unknown>).dueAt
    if (typeof rawDue === 'number' && Number.isFinite(rawDue) && rawDue > 0) task.dueAt = Math.floor(rawDue)
    else delete task.dueAt
    // Priority: 1/2/3 survives, anything else reads absent.
    const priority = normalizePriority((row as Record<string, unknown>).priority)
    if (priority !== undefined) task.priority = priority
    else delete task.priority
    // Status history: valid {status, positive at} entries survive in
    // chronological order, then align to the row's column — three laws, one
    // place: (1) stable-sort by instant; (2) an empty/absent ledger backfills
    // the birth column from createdAt (known birth beats "always this
    // column"); (3) a diverged last entry appends the current column at
    // updatedAt (the column is always the history's last entry).
    const rawHistory = (row as Record<string, unknown>).statusHistory
    const birthAt = typeof task.createdAt === 'number' && Number.isFinite(task.createdAt) && task.createdAt > 0
      ? task.createdAt
      : task.updatedAt
    if (Array.isArray(rawHistory)) {
      const history = rawHistory
        .filter((entry): entry is { status: TaskStatus; at: number } =>
          typeof entry === 'object' && entry !== null
          && isTaskStatus((entry as Record<string, unknown>).status)
          && typeof (entry as Record<string, unknown>).at === 'number'
          && Number.isFinite((entry as Record<string, unknown>).at)
          && ((entry as Record<string, unknown>).at as number) > 0)
        .map(entry => ({ status: entry.status, at: entry.at }))
        .sort((a, b) => a.at - b.at)
      if (history.length === 0) history.push({ status: task.status, at: birthAt })
      const last = history[history.length - 1]
      if (last !== undefined && last.status !== task.status) {
        history.push({ status: task.status, at: task.updatedAt })
      }
      task.statusHistory = history
    } else {
      task.statusHistory = [{ status: task.status, at: birthAt }]
    }
    // Labels: normalized (lowercase/dedupe/cap) or absent.
    const labels = normalizeLabels((row as Record<string, unknown>).labels)
    if (labels !== undefined) task.labels = labels
    else delete task.labels
    // Session automation rules: valid rows kept, malformed dropped (old data
    // keeps working untouched).
    const rules = normalizeSessionRules((row as Record<string, unknown>).rules)
    if (rules !== undefined) task.rules = rules
    else delete task.rules
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
    return this.ledger.map(cloneRecord)
  }

  save(tasks: readonly TaskRecord[]): void {
    this.ledger = tasks.map(cloneRecord)
  }

  clear(): void {
    this.ledger = []
  }
}

/** Deep-copy one ledger row (every nested array gets its own identity —
 *  cloning `executions` while aliasing `statusHistory` is exactly how a
 *  reader's push pollutes the store). One function, both directions. */
function cloneRecord(task: TaskRecord): TaskRecord {
  const next: TaskRecord = { ...task, executions: [...task.executions] }
  if (task.statusHistory !== undefined) {
    next.statusHistory = task.statusHistory.map(entry => ({ ...entry }))
  }
  if (task.binds !== undefined) next.binds = task.binds.map(bind => ({ ...bind }))
  if (task.labels !== undefined) next.labels = [...task.labels]
  if (task.promptImages !== undefined) {
    next.promptImages = task.promptImages.map(image => ({ ...image }))
  }
  if (task.promptFiles !== undefined) {
    next.promptFiles = task.promptFiles.map(file => ({ ...file }))
  }
  if (task.rules !== undefined) next.rules = task.rules.map(rule => ({ ...rule }))
  if (task.hidden !== undefined) {
    next.hidden = {
      ...task.hidden,
      ...(task.hidden.executions !== undefined ? { executions: [...task.hidden.executions] } : {}),
      ...(task.hidden.sessions !== undefined ? { sessions: [...task.hidden.sessions] } : {}),
    }
  }
  if (task.removedSessions !== undefined) next.removedSessions = [...task.removedSessions]
  if (task.sessionsOrder !== undefined) next.sessionsOrder = [...task.sessionsOrder]
  return next
}
