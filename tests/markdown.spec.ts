/**
 * Markdown parser tests (markdown.ts): the safe, common subset the board
 * previews in transcripts and comments — headings, bold/italic, inline and
 * fenced code, lists, quotes, links, rules — plus escaping and the guarantee
 * that nothing but plain text can leak through (no raw HTML/href injection).
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseInline, parseMarkdown, type BlockNode } from '../src/client/board/markdown-parser.ts'
import { Markdown } from '../src/client/board/Markdown.tsx'

describe('parseMarkdown blocks', () => {
  it('turns plain text into a single paragraph', () => {
    const blocks = parseMarkdown('hello\nworld')
    // Consecutive lines stay inside one paragraph; the newline is preserved.
    expect(blocks).toEqual([{ t: 'paragraph', children: [{ t: 'text', s: 'hello\nworld' }] }])
  })

  it('parses headings with levels 1-3', () => {
    const blocks = parseMarkdown('# T1\n\n## T2\n\n### T3')
    expect(blocks.map(block => (block as { t: string; level?: number }).t)).toEqual(['heading', 'heading', 'heading'])
    expect(blocks.map(block => (block as { t: string; level?: number }).level)).toEqual([1, 2, 3])
  })

  it('parses fenced code blocks with a language', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1\n```')
    expect(blocks).toEqual([{ t: 'codeblock', lang: 'ts', text: 'const a = 1' }])
  })

  it('parses bullet and numbered lists', () => {
    const bullet = parseMarkdown('- a\n- b')[0] as BlockNode
    expect(bullet).toEqual({
      t: 'list',
      ordered: false,
      items: [
        { children: [{ t: 'text', s: 'a' }], blocks: [] },
        { children: [{ t: 'text', s: 'b' }], blocks: [] },
      ],
    })
    const numbered = parseMarkdown('1. a\n2. b')[0] as BlockNode
    expect(numbered).toEqual({
      t: 'list',
      ordered: true,
      items: [
        { children: [{ t: 'text', s: 'a' }], blocks: [] },
        { children: [{ t: 'text', s: 'b' }], blocks: [] },
      ],
    })
  })

  it('nests a deeper list UNDER the item above it instead of flattening it', () => {
    /* 这一条钉的是「层次没有被抹掉」：一份计划几乎一定是「几条，每条下面几条」，
       而缩进被丢掉之后子项会变成兄弟项——屏上是一串并排的短句，读者看不出哪几条属于
       同一步。缩进就是那一条信息，所以它必须落在结构里（`blocks`），不是排版上的空档。 */
    const [list] = parseMarkdown('- 第一步\n  - 细项 A\n  - 细项 B\n- 第二步') as [Extract<BlockNode, { t: 'list' }>]
    expect(list.items).toHaveLength(2)
    expect(list.items[0]?.children).toEqual([{ t: 'text', s: '第一步' }])
    expect(list.items[0]?.blocks).toEqual([{
      t: 'list',
      ordered: false,
      items: [
        { children: [{ t: 'text', s: '细项 A' }], blocks: [] },
        { children: [{ t: 'text', s: '细项 B' }], blocks: [] },
      ],
    }])
    // 兄弟项不受影响：深的那一层回到了它自己上一条下面。
    expect(list.items[1]?.children).toEqual([{ t: 'text', s: '第二步' }])
    expect(list.items[1]?.blocks).toEqual([])
  })

  it('a level of the OTHER kind is its own nested list, not a flattened sibling', () => {
    const [list] = parseMarkdown('- 头\n  1. 一\n  2. 二') as [Extract<BlockNode, { t: 'list' }>]
    expect(list.ordered).toBe(false)
    expect(list.items[0]?.blocks[0]).toMatchObject({ t: 'list', ordered: true })
  })

  it('task-list marks become a state on the item, not the text `[x]`', () => {
    const [list] = parseMarkdown('- [ ] 还没做\n- [x] 做完了') as [Extract<BlockNode, { t: 'list' }>]
    expect(list.items[0]).toMatchObject({ checked: false, children: [{ t: 'text', s: '还没做' }] })
    expect(list.items[1]).toMatchObject({ checked: true, children: [{ t: 'text', s: '做完了' }] })
    // 普通圆点项没有这一栏（`undefined` 与「没做完」不是同一件事）。
    const [plain] = parseMarkdown('- 只是圆点') as [Extract<BlockNode, { t: 'list' }>]
    expect('checked' in (plain.items[0] ?? {})).toBe(false)
  })

  it('parses a pipe table only when the separator row is really there', () => {
    const [table] = parseMarkdown('| 步骤 | 谁 |\n| :-- | --: |\n| 换灯 | 我 |') as [Extract<BlockNode, { t: 'table' }>]
    expect(table.t).toBe('table')
    expect(table.align).toEqual(['left', 'right'])
    expect(table.head).toEqual([[{ t: 'text', s: '步骤' }], [{ t: 'text', s: '谁' }]])
    expect(table.rows).toEqual([[[{ t: 'text', s: '换灯' }], [{ t: 'text', s: '我' }]]])
    // 没有分隔行时它只是一句带竖线的字——**不许**框成一张单格表。
    expect(parseMarkdown('| a | b |')[0]).toEqual({ t: 'paragraph', children: [{ t: 'text', s: '| a | b |' }] })
  })

  it('a table row with fewer cells than the head still parses (the renderer leaves the gap empty)', () => {
    const [table] = parseMarkdown('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |') as [Extract<BlockNode, { t: 'table' }>]
    expect(table.rows[0]).toHaveLength(2)
  })

  it('parses blockquotes recursively', () => {
    const blocks = parseMarkdown('> quote line\n> second line')
    expect(blocks).toEqual([{ t: 'quote', children: [{ t: 'paragraph', children: [{ t: 'text', s: 'quote line\nsecond line' }] }] }])
  })

  it('parses thematic breaks', () => {
    expect(parseMarkdown('---')).toEqual([{ t: 'hr' }])
    expect(parseMarkdown('***')).toEqual([{ t: 'hr' }])
  })
})

describe('parseInline', () => {
  it('parses bold, italic, inline code and links', () => {
    expect(parseInline('a **b** c')).toEqual([
      { t: 'text', s: 'a ' },
      { t: 'bold', children: [{ t: 'text', s: 'b' }] },
      { t: 'text', s: ' c' },
    ])
    expect(parseInline('*i*')).toEqual([{ t: 'italic', children: [{ t: 'text', s: 'i' }] }])
    expect(parseInline('`code`')).toEqual([{ t: 'code', s: 'code' }])
    expect(parseInline('[text](https://x.com)')).toEqual([{ t: 'link', url: 'https://x.com', children: [{ t: 'text', s: 'text' }] }])
  })

  it('escapes marker characters so they render literally', () => {
    expect(parseInline('\\*not bold\\*')).toEqual([{ t: 'text', s: '*not bold*' }])
    expect(parseInline('a \\` b')).toEqual([{ t: 'text', s: 'a ` b' }])
  })

  it('renders unknown syntax as plain text (no HTML ever escapes)', () => {
    const html = parseInline('<script>alert(1)</script>')
    expect(html).toEqual([{ t: 'text', s: '<script>alert(1)</script>' }])
    expect(parseMarkdown('<div onclick=x>y</div>')).toEqual([
      { t: 'paragraph', children: [{ t: 'text', s: '<div onclick=x>y</div>' }] },
    ])
  })

  it('never turns an href into javascript:', () => {
    const blocks = parseMarkdown('[x](javascript:alert(1))')
    const link = blocks[0] as { t: 'paragraph'; children: { t: string; url?: string }[] }
    // The parser rejects the scheme by rendering the whole thing as text —
    // no <a> with a javascript: href can ever be produced.
    expect(link.children[0].t).toBe('text')
    expect(link.children[0].url).toBeUndefined()
  })
})

describe('compose with paragraphs', () => {
  it('groups consecutive lines into one paragraph and splits on blank lines', () => {
    const blocks = parseMarkdown('line one\nline two\n\nnew paragraph')
    expect(blocks).toEqual([
      { t: 'paragraph', children: [{ t: 'text', s: 'line one\nline two' }] },
      { t: 'paragraph', children: [{ t: 'text', s: 'new paragraph' }] },
    ])
  })
})

/**
 * 渲染这一步也要有判据，理由是**解析对了不等于屏上对了**：一棵正确的树如果被画成
 * `<span>{source}</span>`，读者看到的仍然是 `## 步骤` 与 `- [x] …`（这正是那份计划在
 * 只读那张卡上的样子）。所以这里断言的是**画出来的元素**，不是树。
 */
describe('the renderer draws the source as elements, never as its own markers', () => {
  const html = (text: string): string => renderToStaticMarkup(createElement(Markdown, { text }))

  it('headings, nesting, task marks and tables all become elements', () => {
    const out = html([
      '## 步骤',
      '',
      '- [x] 先看现场',
      '- 换灯',
      '  1. 断电线',
      '',
      '| 谁 | 什么时候 |',
      '| :-- | --: |',
      '| 我 | 明天 |',
    ].join('\n'))
    expect(out).toContain('<h3')
    expect(out).toContain('<ul')
    expect(out).toContain('<ol')
    expect(out).toContain('<table')
    expect(out).toContain('<th')
    expect(out).toContain('<td')
    // 记号本身不许出现在屏上：它们是**怎么写的**，不是**写了什么**。
    expect(out, '任务清单的记号被原样打印出来了').not.toContain('[x]')
    expect(out, '标题记号被原样打印出来了').not.toContain('##')
    expect(out, '表格的分隔行被原样打印出来了').not.toContain('| ---')
    // 字还在（渲染不是把内容吃掉）。
    expect(out).toContain('先看现场')
    expect(out).toContain('断电线')
    expect(out).toContain('明天')
  })

  it('the checkbox is drawn, and it carries the state as an attribute rather than as text', () => {
    const out = html('- [ ] 还没做\n- [x] 做完了')
    expect(out).toContain('data-done')
    expect(out).toContain('还没做')
    expect(out).toContain('做完了')
  })

  it('an empty source renders nothing at all (no stray empty paragraph)', () => {
    expect(html('')).toBe('')
  })
})