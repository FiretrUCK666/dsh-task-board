/**
 * Automation core: the unified read-side projection (task-level schedule +
 * session rules in ONE shape) plus the rule model guards.
 */
import { describe, expect, it } from 'vitest'
import { automationRowsOf, isSessionRule, normalizeSessionRules, withSessionRules, type SessionRule } from '../src/core/automation.ts'
import { createTask } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

function rule(): SessionRule {
  return { id: 'r1', sessionId: 's-1', instruction: '/goal', cron: '0 9 * * *', send: 'queue', enabled: true, nextAt: NOW + 3_600_000 }
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
})
