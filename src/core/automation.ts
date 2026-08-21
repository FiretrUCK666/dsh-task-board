/**
 * Session automation rules: scheduled "send a preset instruction to THIS
 * session" rules — one per session, fired by the minute heartbeat (cron).
 * A rule is scoped to a session the task owns; firing the instruction is
 * exactly "typing in the native conversation" (queue by default), never a
 * task execution — so a session rule and the task's own execution prompt
 * never conflict: one drives the task, the other talks to its session.
 *
 * Model (research-backed): rule = target(session) + trigger(cron) +
 * action(send instruction, queue|steer). Pure and unit-testable.
 */
import type { TaskRecord } from './tasks.ts'
import { taskColumnAllowsAutomation } from './tasks.ts'
import { nextRunAtMs } from './schedule.ts'

/** One session-scoped automation rule of a task. */
export interface SessionRule {
  id: string
  /** The target native session this task owns (by id). */
  sessionId: string
  /** The preset instruction/text to send; a leading '/' goes through the
   *  native command registry (slashes = commands, everything = plain text). */
  instruction: string
  /** Five-segment cron ("分钟 小时 日 月 周"); due instants computed on tick. */
  cron: string
  /** Send mode: 'queue' appends to the session's queue; 'steer' is reserved
   *  for immediate interruption (mapped the same for now — no interrupt RPC
   *  yet, so steer degrades to queue until the native interrupt surface is
   *  available). */
  send: 'queue' | 'steer'
  enabled: boolean
  /** Next due instant (ms); recomputed on fire / when missing. */
  nextAt: number
  /** Last fired instant. */
  lastAt?: number
}

/** Brand an unknown value as a valid rule (persisted-state guard). */
export function isSessionRule(value: unknown): value is SessionRule {
  if (typeof value !== 'object' || value === null) return false
  const rule = value as Record<string, unknown>
  return typeof rule.id === 'string' && rule.id !== ''
    && typeof rule.sessionId === 'string' && rule.sessionId !== ''
    && typeof rule.instruction === 'string' && rule.instruction !== ''
    && typeof rule.cron === 'string' && rule.cron !== ''
    && (rule.send === 'queue' || rule.send === 'steer')
    && typeof rule.enabled === 'boolean'
    && typeof rule.nextAt === 'number' && Number.isFinite(rule.nextAt)
}

/** Parse + validate a persisted rule list (invalid rows dropped). */
export function normalizeSessionRules(raw: unknown): SessionRule[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: SessionRule[] = []
  const seen = new Set<string>()
  for (const row of raw) {
    if (!isSessionRule(row) || seen.has(row.id)) continue
    seen.add(row.id)
    out.push({
      id: row.id,
      sessionId: row.sessionId,
      instruction: row.instruction,
      cron: row.cron,
      send: row.send,
      enabled: row.enabled,
      nextAt: row.nextAt,
      ...(typeof row.lastAt === 'number' ? { lastAt: row.lastAt } : {}),
    })
  }
  return out.length > 0 ? out : undefined
}

/** Read-only rule view lifted off a task (empty when none). */
export function sessionRulesOf(task: TaskRecord): SessionRule[] {
  return task.rules ?? []
}

/** The projection row back to a full rule (the rows are the single read shape;
 *  this is the one bridge back for consumers that need the rule's own shape,
 *  e.g. the readiness judgment). */
export function sessionRuleOf(row: Extract<AutomationRow, { kind: 'session-rule' }>): SessionRule {
  return {
    id: row.ruleId,
    sessionId: row.sessionId,
    instruction: row.instruction,
    cron: row.cron,
    send: row.send,
    enabled: row.enabled,
    nextAt: row.nextAt,
    ...row.lastAt !== undefined ? { lastAt: row.lastAt } : {},
  }
}

/**
 * The readiness of a session rule — ONE semantics with the task-level
 * schedule (ruleReadiness): a rule is active only while its task sits in a
 * drivable column (todo/running); backlog/review/done pause it (the reason
 * is the task's own status); a toggled-off rule is disabled. The ticker
 * skips paused rules (keeping their due slot — the pause is a hold, not a
 * drop), exactly like the task scheduler treats a paused schedule.
 */
export type SessionRuleReadiness =
  | { kind: 'disabled' }
  | { kind: 'paused'; status: 'backlog' | 'review' | 'done' }
  | { kind: 'active' }

export function sessionRuleReadiness(task: TaskRecord, rule: SessionRule): SessionRuleReadiness {
  if (!rule.enabled) return { kind: 'disabled' }
  return taskColumnAllowsAutomation(task)
    ? { kind: 'active' }
    : { kind: 'paused', status: task.status as 'backlog' | 'review' | 'done' }
}

/**
 * One unified automation view row — the single read-side projection every
 * automation surface renders (the panel's rule rows read this; the task
 * detail derives from the same task fields). Locale-free: components map
 * `kind` + fields to their own labels.
 */
export type AutomationRow =
  | {
    kind: 'schedule'
    mode: 'cron' | 'chain'
    enabled: boolean
    cron?: string
    runCount: number
    maxRuns?: number
    nextRunAt?: number
  }
  | {
    kind: 'session-rule'
    ruleId: string
    sessionId: string
    instruction: string
    cron: string
    send: 'queue' | 'steer'
    enabled: boolean
    nextAt: number
    lastAt?: number
  }

/** The task's unified automation projection: session rules first, then the
 *  task-level schedule rule (when present) — every surface reads one shape. */
export function automationRowsOf(task: TaskRecord): AutomationRow[] {
  const rows: AutomationRow[] = (task.rules ?? []).map(rule => ({
    kind: 'session-rule' as const,
    ruleId: rule.id,
    sessionId: rule.sessionId,
    instruction: rule.instruction,
    cron: rule.cron,
    send: rule.send,
    enabled: rule.enabled,
    nextAt: rule.nextAt,
    ...rule.lastAt !== undefined ? { lastAt: rule.lastAt } : {},
  }))
  const schedule = task.schedule
  if (schedule !== undefined) {
    rows.push({
      kind: 'schedule',
      mode: schedule.mode,
      enabled: schedule.enabled,
      ...schedule.cron !== undefined ? { cron: schedule.cron } : {},
      runCount: schedule.runCount,
      ...schedule.maxRuns !== undefined ? { maxRuns: schedule.maxRuns } : {},
      ...schedule.nextRunAt !== undefined ? { nextRunAt: schedule.nextRunAt } : {},
    })
  }
  return rows
}

/**
 * When a rule should fire next given its current due instant (the next cron
 * match AFTER that instant, like the task scheduler's forward roll). Returns
 * the new due instant, or undefined when the expression is unparseable.
 */
export function nextSessionRuleAt(rule: SessionRule): number | undefined {
  return nextRunAtMs(rule.cron, rule.nextAt)
}

/** Repair a rule whose due instant is missing (legacy/paused): recompute from
 *  now and return the new rule; undefined keeps it un-repaired (skipped). */
export function repairedNextAt(rule: SessionRule, now: number): number | undefined {
  return nextRunAtMs(rule.cron, now)
}

/** Add / replace rules immutably on a task. */
export function withSessionRules(task: TaskRecord, rules: SessionRule[] | undefined): TaskRecord {
  if (rules === undefined || rules.length === 0) {
    const next = { ...task }
    if ('rules' in next) delete next.rules
    return next
  }
  return { ...task, rules }
}
