/**
 * Session automation rules: "send a preset instruction to THIS session" —
 * one per session, scoped to a session the task owns; firing the instruction
 * is exactly "typing in the native conversation" (queue by default), never a
 * task execution — so a session rule and the task's own execution prompt
 * never conflict: one drives the task, the other talks to its session.
 *
 * Model: rule = target(session) + trigger + action(send instruction,
 * queue|steer). TWO triggers, one shared row/appearance grammar:
 * - cron ("按时间表"): fired by the minute heartbeat (tickSessionRules);
 * - on-complete ("任务完成后"): fired when a plain run of the task settles.
 *   No due slot, no cron expression — the completion IS the appointment.
 * Pure and unit-testable.
 */
import type { TaskRecord } from './tasks.ts'
import { taskColumnAllowsAutomation, taskExecutable } from './tasks.ts'
import { nextRunAtMs } from './schedule.ts'

/** A rule's trigger: cron (schedule) or on-complete (fires at run settle). */
export type SessionRuleTrigger = 'cron' | 'on-complete'

/** One session-scoped automation rule of a task. */
export interface SessionRule {
  id: string
  /** The target native session this task owns (by id). */
  sessionId: string
  /** The preset instruction/text to send; a leading '/' goes through the
   *  native command registry (slashes = commands, everything = plain text).
   *  Only meaningful when `usePrompt` is false. */
  instruction: string
  /** 发送内容模式：true = 发送任务当前的执行 Prompt（每次发送时取任务记录，
   *  非快照——改 Prompt 即时生效）；false/缺省 = 发送 `instruction`。
   *  绘画场景：对单个会话定时/每次完成时注入执行 Prompt。 */
  usePrompt?: boolean
  /** 触发方式: cron = 按时间表 (default; legacy rows normalize to this);
   *  on-complete = 任务一次执行结算时发送. */
  trigger: SessionRuleTrigger
  /** Five-segment cron ("分钟 小时 日 月 周"); due instants computed on tick.
   *  Empty for on-complete rules (no schedule slot). */
  cron: string
  /** Send mode: 'queue' appends to the session's queue; 'steer' is reserved
   *  for immediate interruption (mapped the same for now — no interrupt RPC
   *  yet, so steer degrades to queue until the native interrupt surface is
   *  available). */
  send: 'queue' | 'steer'
  enabled: boolean
  /** Next due instant (ms); cron rules only, recomputed on fire / when missing. */
  nextAt?: number
  /** Last fired instant. */
  lastAt?: number
}

/** Brand an unknown value as a valid rule (persisted-state guard). */
export function isSessionRule(value: unknown): value is SessionRule {
  if (typeof value !== 'object' || value === null) return false
  const rule = value as Record<string, unknown>
  if (typeof rule.id !== 'string' || rule.id === '') return false
  if (typeof rule.sessionId !== 'string' || rule.sessionId === '') return false
  const usePrompt = rule.usePrompt === true
  if (typeof rule.instruction !== 'string' || (rule.instruction === '' && !usePrompt)) return false
  if (rule.send !== 'queue' && rule.send !== 'steer') return false
  if (typeof rule.enabled !== 'boolean') return false
  const trigger = rule.trigger === 'on-complete' ? 'on-complete' : 'cron'
  if (trigger === 'on-complete') return rule.nextAt === undefined
  return typeof rule.cron === 'string' && rule.cron !== ''
    && typeof rule.nextAt === 'number' && Number.isFinite(rule.nextAt)
}

/** Parse + validate a persisted rule list (invalid rows dropped; legacy rows
 *  without a trigger normalize to cron, without usePrompt to custom text). */
export function normalizeSessionRules(raw: unknown): SessionRule[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: SessionRule[] = []
  const seen = new Set<string>()
  for (const row of raw) {
    if (!isSessionRule(row) || seen.has(row.id)) continue
    seen.add(row.id)
    const trigger = row.trigger === 'on-complete' ? 'on-complete' : 'cron'
    out.push({
      id: row.id,
      sessionId: row.sessionId,
      instruction: row.instruction,
      ...row.usePrompt === true ? { usePrompt: true } : {},
      trigger,
      ...trigger === 'cron' ? { cron: row.cron, nextAt: row.nextAt } : { cron: '' },
      send: row.send,
      enabled: row.enabled,
      ...(typeof row.lastAt === 'number' ? { lastAt: row.lastAt } : {}),
    })
  }
  return out.length > 0 ? out : undefined
}

/** The projection row back to a full rule (the rows are the single read shape;
 *  this is the one bridge back for consumers that need the rule's own shape,
 *  e.g. the readiness judgment). */
export function sessionRuleOf(row: Extract<AutomationRow, { kind: 'session-rule' }>): SessionRule {
  return {
    id: row.ruleId,
    sessionId: row.sessionId,
    instruction: row.instruction,
    ...row.usePrompt === true ? { usePrompt: true } : {},
    trigger: row.trigger,
    cron: row.cron,
    send: row.send,
    enabled: row.enabled,
    ...row.nextAt !== undefined ? { nextAt: row.nextAt } : {},
    ...row.lastAt !== undefined ? { lastAt: row.lastAt } : {},
  }
}

/**
 * The readiness of a session rule — ONE semantics with the task-level
 * schedule (ruleReadiness): a rule is active only while its task sits in a
 * drivable column (todo/running); backlog/review/done pause it (the reason
 * is the task's own status); a toggled-off rule is disabled; an EMPTY
 * execution prompt blocks it (nothing to drive — a reason, not a pause).
 * The ticker skips paused/blocked rules (keeping their due slot — the pause
 * is a hold, not a drop), exactly like the task scheduler treats a paused
 * schedule.
 *
 * NOTE — the column pause governs the CRON heartbeat only: an on-complete
 * rule fires AT the settle instant (the task was drivable when the run
 * started; the settle itself is the appointment), so the column that the
 * settlement lands in never cancels it.
 */
export type SessionRuleReadiness =
  | { kind: 'disabled' }
  | { kind: 'blocked' }
  | { kind: 'paused'; status: 'backlog' | 'review' | 'done' }
  | { kind: 'active' }

export function sessionRuleReadiness(task: TaskRecord, rule: SessionRule): SessionRuleReadiness {
  if (!rule.enabled) return { kind: 'disabled' }
  // The task-prompt gate applies ONLY to a rule that sends the prompt itself:
  // a custom-instruction rule has its own content and never reads the task's
  // execution prompt ("对单个会话发指令" 与任务 Prompt 无关).
  if (rule.usePrompt === true && !taskExecutable(task)) return { kind: 'blocked' }
  if (rule.trigger === 'on-complete') return { kind: 'active' }
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
    usePrompt?: boolean
    trigger: SessionRuleTrigger
    cron: string
    send: 'queue' | 'steer'
    enabled: boolean
    nextAt?: number
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
    ...rule.usePrompt === true ? { usePrompt: true } : {},
    trigger: rule.trigger,
    cron: rule.cron,
    send: rule.send,
    enabled: rule.enabled,
    ...rule.nextAt !== undefined ? { nextAt: rule.nextAt } : {},
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
 * the new due instant, or undefined when the expression is unparseable (or
 * the rule has no cron slot — an on-complete rule never rolls).
 */
export function nextSessionRuleAt(rule: SessionRule): number | undefined {
  if (rule.trigger !== 'cron' || rule.nextAt === undefined) return undefined
  return nextRunAtMs(rule.cron, rule.nextAt)
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

/** Tasks with LIVE automation — an ENABLED schedule, or at least one ENABLED
 *  session rule. The overview's membership: only what is actually armed shows (a
 *  disarmed schedule is managed from the task detail / the expanded editor,
 *  never listed as if it were running). */
export function automationTasksOf(tasks: readonly TaskRecord[]): TaskRecord[] {
  return tasks.filter(task =>
    task.schedule?.enabled === true || (task.rules !== undefined && task.rules.some(rule => rule.enabled)))
}
