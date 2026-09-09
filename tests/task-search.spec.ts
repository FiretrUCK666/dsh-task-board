/**
 * Board-wide task search (client/board/task-search.ts): AND-of-terms across
 * title/description/prompt/comments/session-titles, case-insensitive, blank
 * matches all.
 */
import { describe, expect, it } from 'vitest'
import { applyCompletion, boardShortcutOf, completeBoardQuery, isShortcutTyping, matchCheatRow, matchTask, parseBoardQuery, taskHaystack } from '../src/client/board/task-search.ts'

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

describe('matchCheatRow (cheatsheet filter sieve)', () => {
  it('blank query keeps every row', () => {
    expect(matchCheatRow({ key: '/', text: 'Focus' }, '')).toBe(true)
    expect(matchCheatRow({ key: '/', text: 'Focus' }, '   ')).toBe(true)
  })

  it('matches key or description substring, case-insensitive', () => {
    expect(matchCheatRow({ key: '/', text: '聚焦任务筛选' }, '/')).toBe(true)
    expect(matchCheatRow({ key: 'x', text: '清空筛选' }, '清空')).toBe(true)
    expect(matchCheatRow({ key: '?', text: 'Toggle this cheatsheet' }, 'toggle')).toBe(true)
    expect(matchCheatRow({ key: '/', text: '聚焦任务筛选' }, '不存在')).toBe(false)
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

  it('takes quoted ws: values with spaces as one qualifier', () => {
    expect(parseBoardQuery('ws:"主 工作区" 猫')).toEqual({
      terms: ['猫'],
      qualifiers: [{ key: 'ws', value: '主 工作区' }],
    })
    expect(matchTask(task, 'ws:"深夜 工作区"', [], { workspaceTitle: '深夜 工作区' })).toBe(true)
    expect(matchTask(task, 'ws:"深夜 工作区"', [], { workspaceTitle: '深夜工作区' })).toBe(false)
  })

  it('keeps empty and unclosed quotes literal (honest zero-match, never a silent pass-all)', () => {
    expect(parseBoardQuery('ws:""')).toEqual({ terms: ['ws:""'], qualifiers: [] })
    expect(matchTask(task, 'ws:""', [], { workspaceTitle: '深夜工作区' })).toBe(false)
    expect(parseBoardQuery('ws:"深夜工作区')).toEqual({ terms: ['ws:"深夜工作区'], qualifiers: [] })
    expect(matchTask(task, 'ws:"深夜工作区', [], { workspaceTitle: '深夜工作区' })).toBe(false)
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

  it('has:priority tests the card priority (any of P1/P2/P3)', () => {
    expect(matchTask({ ...task, priority: 1 }, 'has:priority')).toBe(true)
    expect(matchTask({ ...task, priority: 3 }, 'has:priority')).toBe(true)
    expect(matchTask(task, 'has:priority')).toBe(false)
    expect(parseBoardQuery('HAS:PRIORITY')).toEqual({ terms: [], qualifiers: [{ key: 'has', value: 'priority' }] })
  })

  it('label: tests one normalized label', () => {
    expect(matchTask({ ...task, labels: ['等车', '电话'] }, 'label:等车')).toBe(true)
    expect(matchTask({ ...task, labels: ['等车'] }, 'label:电话')).toBe(false)
    expect(matchTask(task, 'label:等车')).toBe(false)
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

describe('completeBoardQuery (qualifier key completion)', () => {
  it('offers keys for key prefixes and nothing for blank input', () => {
    expect(completeBoardQuery('')).toEqual([])
    expect(completeBoardQuery('h')).toEqual(['has:'])
    expect(completeBoardQuery('HAS')).toEqual(['has:'])
    expect(completeBoardQuery('猫 h')).toEqual(['has:'])
    expect(completeBoardQuery('xyz')).toEqual([])
  })

  it('offers values for bare keys and narrows by value prefix', () => {
    expect(completeBoardQuery('has:')).toEqual(['has:auto', 'has:color', 'has:priority'])
    expect(completeBoardQuery('has:a')).toEqual(['has:auto'])
    expect(completeBoardQuery('is:')).toEqual(['is:unread', 'is:read'])
    expect(completeBoardQuery('has:auto ')).toEqual([])
  })

  it('offers nothing for free-text keys and quoted fragments', () => {
    expect(completeBoardQuery('ws:')).toEqual([])
    expect(completeBoardQuery('label:')).toEqual([])
    expect(completeBoardQuery('ws:"深')).toEqual([])
    expect(completeBoardQuery('has:zzz')).toEqual([])
  })

  it('offers nothing for an already-complete enumerated value', () => {
    expect(completeBoardQuery('has:auto')).toEqual([])
    expect(completeBoardQuery('is:read')).toEqual([])
  })
})

describe('applyCompletion (whole-query assembly)', () => {
  it('replaces the last token in place, preserving the head verbatim', () => {
    expect(applyCompletion('h', 'has:')).toBe('has:')
    expect(applyCompletion('猫 h', 'has:')).toBe('猫 has:')
    expect(applyCompletion('猫  has:a', 'has:auto')).toBe('猫  has:auto')
    expect(applyCompletion('HAS', 'has:')).toBe('has:')
  })

  it('appends after a trailing separator and handles exotic whitespace', () => {
    expect(applyCompletion('', 'has:')).toBe('has:')
    expect(applyCompletion('猫 ', 'has:')).toBe('猫 has:')
    expect(applyCompletion('a\rhas:a', 'has:auto')).toBe('a\rhas:auto')
  })
})
