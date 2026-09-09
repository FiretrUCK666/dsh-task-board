/**
 * Board-wide task search (client/board/task-search.ts): AND-of-terms across
 * title/description/prompt/comments/session-titles, case-insensitive, blank
 * matches all.
 */
import { describe, expect, it } from 'vitest'
import { boardShortcutOf, matchTask, taskHaystack } from '../src/client/board/task-search.ts'

const task = {
  title: '给猫画一幅画',
  description: '水彩风格',
  prompt: '用暖色画猫',
  executions: [
    { comment: '先从草稿开始' },
    { comment: undefined },
  ],
}

describe('matchTask', () => {
  it('blank query matches everything (a sieve, not a gate)', () => {
    expect(matchTask(task, '')).toBe(true)
    expect(matchTask(task, '   ')).toBe(true)
  })

  it('matches title, description and prompt (case-insensitive)', () => {
    expect(matchTask(task, '猫')).toBe(true)
    expect(matchTask(task, '水彩')).toBe(true)
    expect(matchTask(task, '暖色')).toBe(true)
    expect(matchTask(task, '不存在')).toBe(false)
  })

  it('matches comment bodies and linked-session titles', () => {
    expect(matchTask(task, '草稿')).toBe(true)
    expect(matchTask(task, '草稿', ['无关会话'])).toBe(true)
    expect(matchTask(task, '深夜会话', ['深夜会话'])).toBe(true)
    expect(matchTask(task, '深夜会话')).toBe(false)
  })

  it('multi-term queries narrow (AND, order-free)', () => {
    expect(matchTask(task, '猫 暖色')).toBe(true)
    expect(matchTask(task, '暖色 猫')).toBe(true)
    expect(matchTask(task, '猫 油画')).toBe(false)
  })

  it('latin case folds', () => {
    const latin = { ...task, title: 'Draw a Cat' }
    expect(matchTask(latin, 'cat')).toBe(true)
    expect(matchTask(latin, 'DRAW')).toBe(true)
  })
})

describe('taskHaystack', () => {
  it('joins every surface, skipping empty comments', () => {
    const hay = taskHaystack(task, ['s1'])
    expect(hay).toContain('给猫画一幅画')
    expect(hay).toContain('先从草稿开始')
    expect(hay).toContain('s1')
  })
})

describe('boardShortcutOf (single keys, never while typing, never with modifiers)', () => {
  it('maps the three board keys', () => {
    expect(boardShortcutOf({ key: '/' }, false)).toBe('focus-search')
    expect(boardShortcutOf({ key: 'x' }, false)).toBe('clear-filter')
    expect(boardShortcutOf({ key: 'X' }, false)).toBe('clear-filter')
    expect(boardShortcutOf({ key: '?' }, false)).toBe('toggle-help')
  })

  it('stays silent while typing or with modifiers held', () => {
    expect(boardShortcutOf({ key: '/' }, true)).toBeUndefined()
    expect(boardShortcutOf({ key: 'x' }, true)).toBeUndefined()
    expect(boardShortcutOf({ key: '?' }, true)).toBeUndefined()
    expect(boardShortcutOf({ key: '/', ctrlKey: true }, false)).toBeUndefined()
    expect(boardShortcutOf({ key: '/', metaKey: true }, false)).toBeUndefined()
    expect(boardShortcutOf({ key: 'x', altKey: true }, false)).toBeUndefined()
  })

  it('ignores every other key', () => {
    expect(boardShortcutOf({ key: 'Enter' }, false)).toBeUndefined()
    expect(boardShortcutOf({ key: 'a' }, false)).toBeUndefined()
    expect(boardShortcutOf({ key: 'Escape' }, false)).toBeUndefined()
  })
})
