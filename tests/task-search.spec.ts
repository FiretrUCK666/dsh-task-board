/**
 * Board-wide task search (client/board/task-search.ts): AND-of-terms across
 * title/description/prompt/comments/session-titles, case-insensitive, blank
 * matches all.
 */
import { describe, expect, it } from 'vitest'
import { boardShortcutOf, isShortcutTyping, matchTask, parseBoardQuery, taskHaystack } from '../src/client/board/task-search.ts'

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

describe('isShortcutTyping (THE one typing judgment)', () => {
  it('treats IME composing (isComposing / 229) as typing wherever focus sits', () => {
    expect(isShortcutTyping(null, { isComposing: true })).toBe(true)
    expect(isShortcutTyping(null, { keyCode: 229 })).toBe(true)
    expect(isShortcutTyping({ closest: () => null }, { isComposing: true })).toBe(true)
  })

  it('treats editables as typing, plain surfaces as not', () => {
    const input = { closest: (selectors: string) => selectors.includes('input') ? {} : null }
    const board = { closest: () => null }
    expect(isShortcutTyping(input, {})).toBe(true)
    expect(isShortcutTyping(board, {})).toBe(false)
    expect(isShortcutTyping(null, {})).toBe(false)
    expect(isShortcutTyping({}, {})).toBe(false)
  })
})

describe('parseBoardQuery (facet qualifiers)', () => {
  it('splits plain terms from recognized qualifiers (case-insensitive)', () => {
    expect(parseBoardQuery('猫 has:auto')).toEqual({
      terms: ['猫'],
      qualifiers: [{ key: 'has', value: 'auto' }],
    })
    expect(parseBoardQuery('  WS:主  IS:Unread  ')).toEqual({
      terms: [],
      qualifiers: [{ key: 'ws', value: '主' }, { key: 'is', value: 'unread' }],
    })
    expect(parseBoardQuery('')).toEqual({ terms: [], qualifiers: [] })
  })

  it('leaves unknown qualifiers as literal terms (narrowing, never failing)', () => {
    expect(parseBoardQuery('foo:bar has:all is:maybe')).toEqual({
      terms: ['foo:bar', 'has:all', 'is:maybe'],
      qualifiers: [],
    })
    expect(parseBoardQuery('has:')).toEqual({ terms: ['has:'], qualifiers: [] })
  })
})

describe('matchTask qualifiers', () => {
  const colored = { ...task, color: '#e5484d' }

  it('has:auto tests the automation facet', () => {
    expect(matchTask(task, 'has:auto', [], { hasAutomation: true })).toBe(true)
    expect(matchTask(task, 'has:auto', [], { hasAutomation: false })).toBe(false)
    expect(matchTask(task, 'has:auto')).toBe(false)
  })

  it('has:color tests the card accent', () => {
    expect(matchTask(colored, 'has:color')).toBe(true)
    expect(matchTask(task, 'has:color')).toBe(false)
  })

  it('is:unread / is:read test the unviewed facet', () => {
    expect(matchTask(task, 'is:unread', [], { isUnviewed: true })).toBe(true)
    expect(matchTask(task, 'is:unread', [], { isUnviewed: false })).toBe(false)
    expect(matchTask(task, 'is:read', [], { isUnviewed: false })).toBe(true)
    expect(matchTask(task, 'is:read', [], { isUnviewed: true })).toBe(false)
  })

  it('ws: matches the workspace title substring', () => {
    expect(matchTask(task, 'ws:深夜', [], { workspaceTitle: '深夜工作区' })).toBe(true)
    expect(matchTask(task, 'ws:白天', [], { workspaceTitle: '深夜工作区' })).toBe(false)
    expect(matchTask(task, 'ws:x')).toBe(false)
  })

  it('qualifiers AND with plain terms', () => {
    const facets = { hasAutomation: true, isUnviewed: true } as const
    expect(matchTask(colored, '猫 has:color', [], facets)).toBe(true)
    expect(matchTask(colored, '油画 has:color', [], facets)).toBe(false)
    expect(matchTask(colored, '猫 is:read', [], facets)).toBe(false)
  })
})
