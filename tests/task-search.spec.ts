/**
 * Board-wide task search (core/task-search.ts): AND-of-terms across
 * title/description/prompt/comments/session-titles, case-insensitive, blank
 * matches all.
 *
 * It lives in core, not the client, because BOTH halves read the qualifier
 * registry: the search box parses it and the agent's query tool renders its
 * parameters from it. A filter vocabulary in the client folder is a vocabulary
 * the host has to reach across the boundary to read.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyCompletion,
  completeBoardQuery,
  matchItemQuery,
  matchTask,
  parseBoardQuery,
  parseItemSearch,
  itemSearchContext,
  removeFilterToken,
  splitFilterTokens,
  taskHaystack,
  QUALIFIER_KEYS,
} from '../src/core/task-search.ts'
import { itemMatches, parseItemQuery } from '../src/core/item-view.ts'
import { ITEM_STATUSES, type ItemRecord } from '../src/core/item.ts'

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

// ── the checklist's grammar lives elsewhere, and this file only points at it ──

const T0 = 1_700_000_000_000
const DAY = 86_400_000

/** One checklist row, with only what a test cares about overridden. */
function item(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 3,
    title: '给猫换一张壁纸',
    body: '水彩风格，暖色',
    notes: '等猫不在家的时候换',
    steps: [],
    status: 'open',
    priority: 'high',
    tags: ['画廊'],
    startsAfter: undefined,
    dueAt: undefined,
    hardDueAt: undefined,
    taskId: undefined,
    origin: { source: 'human', at: T0 },
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  }
}

describe('the checklist grammar is delegated, never restated', () => {
  const now = T0 + 30 * DAY
  const ctx = itemSearchContext(now)

  it('gives the same answer as the grammar it points at, for every shape of query', () => {
    // THE drift gate. Two consumers read this grammar — the panel's search box
    // and the agent's query tool — and the failure nobody reports is a filter
    // that quietly does nothing on one of them. There is no honest way to test
    // "they agree" against a second implementation, because a second
    // implementation is the defect. So this asserts the delegation is an
    // IDENTITY over a table of queries: if anyone re-implements matching inside
    // this file, the two columns part company here.
    const queries = [
      '',
      '猫',
      '水彩',
      '不存在的东西',
      '猫 暖色',
      '猫 不存在的东西',
      '#画廊',
      '#别处',
      'status:open',
      'status:blocked',
      'status:done',
      'status:inprogress',
      'p1',
      'p4',
      '!2',
      'has:undated',
      'has:linked',
      'has:hardOverdue',
      'status:open #画廊',
      'status:open 猫 不存在的东西',
      'notes:xyz',
      '猫 status:blocked',
    ]
    const rows = [
      item(),
      item({ id: 'i-2', priority: 'urgent', tags: [], dueAt: now - DAY, updatedAt: now - 20 * DAY }),
      item({ id: 'i-3', status: 'blocked', startsAfter: now + DAY }),
      item({ id: 'i-4', status: 'done', hardDueAt: now - 2 * DAY, taskId: 't-1' }),
    ]
    for (const query of queries) {
      const parsed = parseItemQuery(query)
      expect(parseItemSearch(query)).toEqual(parsed)
      for (const row of rows) {
        expect(matchItemQuery(row, query, ctx), `delegation diverged on ${JSON.stringify(query)} / ${row.id}`)
          .toBe(itemMatches(row, parsed, ctx))
      }
    }
  })

  it('parses and matches through ONE grammar when called in either order', () => {
    // Order independence: composing by hand and composing through the door must
    // not differ, or "the panel" and "the model" stop being the same question.
    const row = item({ dueAt: now - DAY })
    expect(matchItemQuery(row, 'has:behind', ctx)).toBe(true)
    expect(itemMatches(row, parseItemSearch('has:behind'), ctx)).toBe(true)
    expect(matchItemQuery(row, 'has:undated', ctx)).toBe(false)
  })
})

describe('a qualifier is answered by the model\'s own keys, never by its words', () => {
  const now = T0 + 30 * DAY
  const ctx = itemSearchContext(now)

  it('accepts every status the model stores, and the derived one', () => {
    for (const status of ITEM_STATUSES) {
      expect(parseItemQuery(`status:${status}`).status, status).toEqual([status])
    }
    expect(parseItemQuery('status:inprogress').status).toEqual(['inProgress'])
    // And a status the model does not store is not a status, in either
    // direction: 进行中 is derived from a running card, so it is accepted as a
    // word, while a state nobody defined is refused.
    expect(parseItemQuery('status:running').status).toEqual([])
    expect(parseItemQuery('status:running').words).toEqual(['status:running'])
  })

  it('accepts every priority the model stores', () => {
    // Spelled out rather than derived from the array's order, on purpose.
    // `ITEM_PRIORITIES` runs lowest-first (it is the sort order) while `p1` is
    // the MOST urgent, so the two are deliberately not the same sequence —
    // reading the mapping off the array would have pinned the wrong meaning.
    for (const [token, priority] of [['p1', 'urgent'], ['p2', 'high'], ['p3', 'normal'], ['p4', 'low']] as const) {
      expect(parseItemQuery(token).priority, token).toEqual([priority])
      expect(parseItemQuery(`!${token.slice(1)}`).priority, `!${token.slice(1)}`).toEqual([priority])
    }
    // A priority outside the four is not a priority: it is text to search for.
    expect(parseItemQuery('p5').priority).toEqual([])
    expect(parseItemQuery('p5').words).toEqual(['p5'])
  })

  it('refuses a DISPLAY word, and falls back to searching for it literally', () => {
    // The load-bearing rule, and the reason for it: a filter saved against a
    // label stops matching the moment the label is reworded, and nobody finds
    // out — the search box just quietly returns less. So the grammar parses
    // `status:open` and NEVER `status:待办`; a display word is not a key, so it
    // falls through to a literal term and matches nothing, which is the honest
    // answer rather than a silent reinterpretation of the reader's words.
    const parsed = parseItemQuery('status:待办')
    expect(parsed.status).toEqual([])
    expect(parsed.words).toEqual(['status:待办'])
    expect(matchItemQuery(item(), 'status:待办', ctx)).toBe(false)
    expect(matchItemQuery(item(), 'status:open', ctx)).toBe(true)
  })

  it('keeps the two vocabularies disjoint, so neither can answer for the other', () => {
    // A card filter and a note filter are different questions about different
    // rows. If the board's registry ever learned the checklist's keys, or the
    // checklist's grammar learned the board's, a query would mean two different
    // things depending on which surface ran it — and the tool that describes
    // them would be describing something that does not exist.
    expect(QUALIFIER_KEYS).not.toContain('status:')
    expect(QUALIFIER_KEYS).not.toContain('p1')
    // `has:` exists on both sides with DIFFERENT values, which is exactly why
    // they cannot share a table: `has:auto` is a card's automation rule and
    // means nothing to a note.
    expect(QUALIFIER_KEYS).toContain('has:')
    expect(parseItemQuery('has:auto').flags.size).toBe(0)
    expect(matchItemQuery(item(), 'has:auto', ctx)).toBe(false)
  })
})

describe('the checklist haystack is built in exactly one place', () => {
  const srcRoot = fileURLToPath(new URL('../src', import.meta.url))
  const coreRoot = join(srcRoot, 'core')

  /** Every source file under a root, as paths relative to src. */
  function sources(root: string): string[] {
    const out: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx)$/.test(entry)) out.push(path)
      }
    }
    walk(root)
    return out
  }

  /** The files that join a row's text fields together, repo-relative. */
  function haystackBuilders(root: string): string[] {
    return sources(root)
      .filter(path => readFileSync(path, 'utf8').split('\n')
        // A line is a copy when it joins two of the row's text fields at once.
        // There is no other reason to read `body` and `notes` together, so this
        // finds a copied haystack and nothing else.
        .some(line => /\.(?:body|notes)\b[^\n]*\.(?:body|notes)\b[^\n]*join/.test(line)))
      .map(path => path.slice(srcRoot.length + 1).replaceAll('\\', '/'))
  }

  it('exists once across ALL of core, in the file the grammar lives in', () => {
    // The second copy is the failure, and it is a quiet one: the search box
    // starts matching a field the model does not, or stops matching one it
    // does, and the report is "筛选好像没反应". A scan is the only thing that
    // catches it, because a second CORRECT implementation passes every
    // behavioural test in this file.
    //
    // Scanned over all of `src/core`, not just the file the grammar is expected
    // to be in: `item.ts` and `item-view.ts` are where a copy would actually
    // land — they are the two files that already hold the row's fields and the
    // row's derivations, so they are the two places a re-implementation feels
    // like it belongs.
    expect(haystackBuilders(coreRoot)).toEqual(['core/item-view.ts'])
  })

  it('exists once across ALL of src, host included', () => {
    // Wider than core on purpose. The host's query tool is the third consumer
    // of this grammar, it is the one that answers a model rather than a person,
    // and it is the one most likely to be "just this once, inline" — which is
    // exactly how the copy that drifts in silently arrives.
    expect(haystackBuilders(srcRoot)).toEqual(['core/item-view.ts'])
  })

  it('the door names the module, so the dependency is visible in the import list', () => {
    expect(readFileSync(join(coreRoot, 'task-search.ts'), 'utf8')).toMatch(/from '\.\/item-view\.ts'/)
  })

  it('the board keeps its own haystack and never reaches into a row it does not own', () => {
    // The mirror of the rule above. The board's table is the board's; a card has
    // no `body`, so a search that started reading one would be a search that had
    // stopped knowing what document it was searching.
    const source = readFileSync(join(srcRoot, 'core', 'task-search.ts'), 'utf8')
    const table = source.slice(source.indexOf('const QUALIFIER_DEFS'), source.indexOf('export const QUALIFIER_KEYS'))
    expect(table).not.toMatch(/startsAfter|hardDueAt|priority|origin/)
  })
})
