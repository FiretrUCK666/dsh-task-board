/**
 * Automation core: the unified read-side projection (task-level schedule +
 * session rules in ONE shape) plus the rule model guards and the shared
 * readiness semantics (session rules read the same column judgment as the
 * task schedule).
 */
import { describe, expect, it } from 'vitest'
import {
  automationRowsOf, automationTasksOf, hasLiveAutomation, isSessionRule, normalizeSessionRules, sessionRuleReadiness,
  sessionRuleOf, withSessionRules, type SessionRule,
} from '../src/core/automation.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

function rule(): SessionRule {
  return { id: 'r1', sessionId: 's-1', instruction: '/goal', trigger: 'cron', cron: '0 9 * * *', send: 'queue', enabled: true, nextAt: NOW + 3_600_000 }
}

function task(status: TaskRecord['status']): TaskRecord {
  return { ...createTask({ title: 't', description: '', prompt: 'run' }, NOW, 'task-1'), status }
}

describe('automationRowsOf', () => {
  it('projects session rules and the task-level schedule into one row list', () => {
    const task = {
      ...createTask({ title: 't', description: '', prompt: '' }, NOW, 'task-1'),
      schedule: { enabled: true, mode: 'cron' as const, cron: '0 9 * * *', runCount: 2, nextRunAt: NOW + 1, lastTriggeredAt: NOW, maxRuns: 5, primed: false },
    }
    const rows = automationRowsOf(withSessionRules(task, [rule()]))
    expect(rows[0]).toMatchObject({ kind: 'session-rule', ruleId: 'r1', instruction: '/goal', send: 'queue', enabled: true })
    expect(rows[1]).toMatchObject({ kind: 'schedule', mode: 'cron', enabled: true, runCount: 2, nextRunAt: NOW + 1 })
  })

  it('yields an empty list for a task with neither kind', () => {
    expect(automationRowsOf(createTask({ title: 't', description: '', prompt: '' }, NOW, 'task-1'))).toEqual([])
  })
})

describe('automationTasksOf (the overview membership)', () => {
  const bare = createTask({ title: 't', description: '', prompt: '' }, NOW, 'task-1')
  const scheduleOf = (mode: 'cron' | 'chain', enabled: boolean): NonNullable<TaskRecord['schedule']> => ({
    enabled,
    mode,
    cron: mode === 'cron' ? '0 9 * * *' : '',
    runCount: 0,
    nextRunAt: undefined,
    lastTriggeredAt: undefined,
    maxRuns: undefined,
    primed: false,
  })

  it('shows only ARMED schedules (a disarmed one is not listed as running)', () => {
    const armed = { ...bare, id: 'a', schedule: scheduleOf('cron', true) }
    const disarmed = { ...bare, id: 'b', schedule: scheduleOf('chain', false) }
    expect(automationTasksOf([bare, armed, disarmed]).map(t => t.id)).toEqual(['a'])
  })

  it('includes tasks with session rules, and excludes fully plain tasks', () => {
    const ruled = withSessionRules({ ...bare, id: 'c' }, [rule()])
    expect(automationTasksOf([bare, ruled]).map(t => t.id)).toEqual(['c'])
    expect(automationTasksOf([bare])).toEqual([])
  })

  it('excludes tasks whose session rules are all toggled off', () => {
    const off = withSessionRules({ ...bare, id: 'd' }, [{ ...rule(), enabled: false }])
    const mixed = withSessionRules({ ...bare, id: 'e' }, [
      { ...rule(), id: 'r1', enabled: false },
      { ...rule(), id: 'r2', enabled: true },
    ])
    expect(automationTasksOf([off])).toEqual([])
    expect(automationTasksOf([off, mixed]).map(t => t.id)).toEqual(['e'])
  })

  it('hasLiveAutomation is the single-task membership (overview and has:auto agree)', () => {
    const armed = { ...bare, id: 'a', schedule: scheduleOf('cron', true) }
    const ruled = withSessionRules({ ...bare, id: 'c' }, [rule()])
    const off = withSessionRules({ ...bare, id: 'd' }, [{ ...rule(), enabled: false }])
    expect(hasLiveAutomation(armed)).toBe(true)
    expect(hasLiveAutomation(ruled)).toBe(true)
    expect(hasLiveAutomation(off)).toBe(false)
    expect(hasLiveAutomation(bare)).toBe(false)
    // The list derives from it — one predicate, never two judgments.
    for (const task of [bare, armed, ruled, off]) {
      expect(automationTasksOf([task]).length).toBe(hasLiveAutomation(task) ? 1 : 0)
    }
  })
})

describe('normalizeSessionRules', () => {
  it('drops invalid rows and duplicates, keeps valid ones', () => {
    const normalized = normalizeSessionRules([
      rule(),
      { ...rule(), id: 'bad', cron: '' },
      rule(), // duplicate id
      'junk',
    ])
    expect(normalized).toHaveLength(1)
    expect(isSessionRule(normalized![0])).toBe(true)
  })

  it('legacy rows (no trigger) normalize to cron; on-complete rows carry no cron slot', () => {
    const legacy = { id: 'old', sessionId: 's-1', instruction: 'hi', cron: '0 9 * * *', send: 'queue' as const, enabled: true, nextAt: 5 }
    const onComplete = { id: 'oc', sessionId: 's-1', instruction: 'hi', trigger: 'on-complete', cron: '', send: 'steer' as const, enabled: true }
    const normalized = normalizeSessionRules([legacy, onComplete])
    expect(normalized).toHaveLength(2)
    expect(isSessionRule(legacy)).toBe(true)
    expect(isSessionRule(onComplete)).toBe(true)
    expect(isSessionRule({ ...onComplete, nextAt: 5 })).toBe(false) // a due slot is cron-only
    expect(isSessionRule({ ...rule(), trigger: 'on-complete' })).toBe(false)
  })
})

describe('sessionRuleReadiness (one semantics with the task schedule)', () => {
  it('is active only while the task sits in a drivable column', () => {
    expect(sessionRuleReadiness(task('todo'), rule())).toEqual({ kind: 'active' })
    expect(sessionRuleReadiness(task('running'), rule())).toEqual({ kind: 'active' })
    expect(sessionRuleReadiness(task('backlog'), rule())).toEqual({ kind: 'paused', status: 'backlog' })
    expect(sessionRuleReadiness(task('review'), rule())).toEqual({ kind: 'paused', status: 'review' })
    expect(sessionRuleReadiness(task('done'), rule())).toEqual({ kind: 'paused', status: 'done' })
  })

  it('a CUSTOM rule ignores the task prompt entirely — its content is its own', () => {
    const blank = { ...task('todo'), prompt: '' }
    expect(sessionRuleReadiness(blank, rule())).toEqual({ kind: 'active' })
    expect(sessionRuleReadiness({ ...blank, status: 'done' }, rule())).toEqual({ kind: 'paused', status: 'done' })
  })

  it('a usePrompt rule is BLOCKED while the task execution prompt is empty', () => {
    const using = { ...rule(), usePrompt: true as const, instruction: '' }
    expect(sessionRuleReadiness({ ...task('todo'), prompt: '' }, using)).toEqual({ kind: 'blocked' })
    expect(sessionRuleReadiness({ ...task('done'), prompt: '' }, using)).toEqual({ kind: 'blocked' })
  })

  it('is disabled when the rule is toggled off — regardless of the column', () => {
    expect(sessionRuleReadiness(task('todo'), { ...rule(), enabled: false })).toEqual({ kind: 'disabled' })
    expect(sessionRuleReadiness(task('done'), { ...rule(), enabled: false })).toEqual({ kind: 'disabled' })
  })

  it('an ON-COMPLETE rule ignores the column pause: the settle IS the appointment', () => {
    const after: SessionRule = { id: 'r2', sessionId: 's-1', instruction: '/goal', trigger: 'on-complete', cron: '', send: 'steer', enabled: true }
    expect(sessionRuleReadiness(task('review'), after)).toEqual({ kind: 'active' })
    expect(sessionRuleReadiness(task('done'), after)).toEqual({ kind: 'active' })
    // Blocked applies to the prompt-sending variant only.
    const usingPrompt: SessionRule = { ...after, usePrompt: true, instruction: '' }
    expect(sessionRuleReadiness({ ...task('done'), prompt: '' }, usingPrompt)).toEqual({ kind: 'blocked' })
  })
})

describe('sessionRuleOf (projection row back to the rule shape)', () => {
  it('round-trips the row fields including the optional last fired instant', () => {
    const row = automationRowsOf(withSessionRules(task('todo'), [{ ...rule(), lastAt: NOW }]))[0]
    expect(sessionRuleOf(row as Extract<ReturnType<typeof automationRowsOf>[number], { kind: 'session-rule' }>)).toMatchObject({
      id: 'r1', sessionId: 's-1', instruction: '/goal', trigger: 'cron', cron: '0 9 * * *', send: 'queue', enabled: true, nextAt: NOW + 3_600_000, lastAt: NOW,
    })
  })

  it('round-trips an on-complete row (no cron slot, no due instant)', () => {
    const after: SessionRule = { id: 'r2', sessionId: 's-1', instruction: '收尾', trigger: 'on-complete', cron: '', send: 'queue', enabled: true }
    const row = automationRowsOf(withSessionRules(task('todo'), [after]))[0]
    expect(sessionRuleOf(row as Extract<ReturnType<typeof automationRowsOf>[number], { kind: 'session-rule' }>)).toEqual(after)
  })

  it('round-trips a usePrompt row (task-execution-prompt content mode)', () => {
    const using: SessionRule = { id: 'r3', sessionId: 's-1', instruction: '', usePrompt: true, trigger: 'on-complete', cron: '', send: 'steer', enabled: true }
    const row = automationRowsOf(withSessionRules(task('todo'), [using]))[0]
    expect(sessionRuleOf(row as Extract<ReturnType<typeof automationRowsOf>[number], { kind: 'session-rule' }>)).toEqual(using)
  })
})
