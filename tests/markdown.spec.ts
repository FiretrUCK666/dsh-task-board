/**
 * Markdown parser tests (markdown.ts): the safe, common subset the board
 * previews in transcripts and comments — headings, bold/italic, inline and
 * fenced code, lists, quotes, links, rules — plus escaping and the guarantee
 * that nothing but plain text can leak through (no raw HTML/href injection).
 */
import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, type BlockNode } from '../src/client/board/markdown-parser.ts'

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
    expect(bullet).toEqual({ t: 'list', ordered: false, items: [[{ t: 'text', s: 'a' }], [{ t: 'text', s: 'b' }]] })
    const numbered = parseMarkdown('1. a\n2. b')[0] as BlockNode
    expect(numbered).toEqual({ t: 'list', ordered: true, items: [[{ t: 'text', s: 'a' }], [{ t: 'text', s: 'b' }]] })
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