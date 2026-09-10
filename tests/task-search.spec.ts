/**
 * Board-wide task search (client/board/task-search.ts): AND-of-terms across
 * title/description/prompt/comments/session-titles, case-insensitive, blank
 * matches all.
 */
import { describe, expect, it } from 'vitest'
import { applyCompletion, completeBoardQuery, matchTask, parseBoardQuery, removeFilterToken, splitFilterTokens, taskHaystack } from '../src/client/board/task-search.ts'

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
    expect(completeBoardQuery('has:')).toEqual(['has:auto', 'has:color'])
    expect(completeBoardQuery('has:a')).toEqual(['has:auto'])
    expect(completeBoardQuery('is:')).toEqual(['is:unread', 'is:read'])
    expect(completeBoardQuery('has:auto ')).toEqual([])
  })

  it('offers nothing for free-text keys and quoted fragments', () => {
    expect(completeBoardQuery('ws:')).toEqual([])
    expect(completeBoardQuery('ws:"深')).toEqual([])
    expect(completeBoardQuery('has:zzz')).toEqual([])
  })

  it('offers nothing for an already-complete enumerated value', () => {
    expect(completeBoardQuery('has:auto')).toEqual([])
    expect(completeBoardQuery('is:read')).toEqual([])
  })
})

describe('qualifier single source (parse + complete + match agree)', () => {
  it('every enumerated pair parses, completes and matches', () => {
    // has:auto (facet-gated).
    expect(parseBoardQuery('has:auto')).toEqual({ terms: [], qualifiers: [{ key: 'has', value: 'auto' }] })
    expect(completeBoardQuery('has:a')).toContain('has:auto')
    expect(matchTask(task, 'has:auto', [], { hasAutomation: true })).toBe(true)
    expect(matchTask(task, 'has:auto', [], { hasAutomation: false })).toBe(false)
    // has:color (task-field-gated).
    expect(matchTask({ ...task, color: '#fff' }, 'has:color')).toBe(true)
    expect(matchTask(task, 'has:color')).toBe(false)
    // is:unread / is:read (facet-gated).
    expect(matchTask(task, 'is:unread', [], { isUnviewed: true })).toBe(true)
    expect(matchTask(task, 'is:read', [], { isUnviewed: false })).toBe(true)
  })

  it('free-text keys parse and match without completion', () => {
    expect(parseBoardQuery('ws:深夜').qualifiers).toEqual([{ key: 'ws', value: '深夜' }])
    expect(completeBoardQuery('ws:')).toEqual([])
    expect(matchTask(task, 'ws:深夜', [], { workspaceTitle: '深夜食堂' })).toBe(true)
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

  it('never tears a quoted span, even with a stray candidate', () => {
    expect(applyCompletion('猫 ws:"深 夜"', 'has:')).toBe('猫 has:')
    expect(applyCompletion('ws:"a b" has:a', 'has:auto')).toBe('ws:"a b" has:auto')
    expect(completeBoardQuery('猫 ws:"深 夜"')).toEqual([])
  })
})

describe('splitFilterTokens / removeFilterToken (overview chips)', () => {
  it('splits quote-aware (ws:"a b" is one token)', () => {
    expect(splitFilterTokens('')).toEqual([])
    expect(splitFilterTokens('  ')).toEqual([])
    expect(splitFilterTokens('猫 has:color')).toEqual(['猫', 'has:color'])
    expect(splitFilterTokens('猫 ws:"深 夜"')).toEqual(['猫', 'ws:"深 夜"'])
  })

  it('splits non-ws quotes like the parser does (single scanner, no fork)', () => {
    // has:"a b": the parser reads two literal terms — the chips show two.
    expect(splitFilterTokens('has:"a b"')).toEqual(['has:"a', 'b"'])
    expect(parseBoardQuery('has:"a b"')).toEqual({ terms: ['has:"a', 'b"'], qualifiers: [] })
    // Unclosed ws quote: literal terms on both sides.
    expect(splitFilterTokens('ws:"深 夜')).toEqual(['ws:"深', '夜'])
    expect(parseBoardQuery('ws:"深 夜').qualifiers).toEqual([])
  })

  it('removes one token by index, out-of-range returns the query', () => {
    expect(removeFilterToken('猫 has:color', 0)).toBe('has:color')
    expect(removeFilterToken('猫 has:color', 1)).toBe('猫')
    expect(removeFilterToken('猫 ws:"深 夜" has:auto', 1)).toBe('猫 has:auto')
    expect(removeFilterToken('猫', 5)).toBe('猫')
  })
})
