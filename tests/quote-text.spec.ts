/**
 * 引用文本的纯文法（quote-text.ts）：把一段选中文字编码成 Markdown 引用行，以及
 * 把它插到光标的正确位置。
 *
 * 这三条契约钉的是「引用发出去之后还是一段引用」，而不是「字符串长得像引用」：
 * 每一条断言后面都能对应一个真实后果——空行丢前缀会把引用截成两块、不补空行会把
 * 后一行正文并进引用、光标不落在末尾会让读者再点一次输入框。
 */
import { describe, expect, it } from 'vitest'
import { insertQuote, quoteTextOf } from '../src/client/board/quote-text.ts'
import { parseMarkdown } from '../src/client/board/markdown-parser.ts'

describe('quoteTextOf', () => {
  it('prefixes every line, so the block stays ONE quote after parsing', () => {
    expect(quoteTextOf('first line\nsecond line')).toBe('> first line\n> second line')
  })

  it('keeps a blank line inside the quote by giving it a prefix too', () => {
    /* 这一段是承重的：`> a\n\n> b` 在 Markdown 里是两段引用，中间那一行落到引用外面，
       于是读者引的两段话发出去变成两块。带前缀的空行（`> `）仍属于同一块。 */
    const quote = quoteTextOf('paragraph one\n\nparagraph two')
    expect(quote).toBe('> paragraph one\n> \n> paragraph two')
    const blocks = parseMarkdown(quote)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.t).toBe('quote')
  })

  it('normalises CRLF so a Windows selection is not split by stray carriage returns', () => {
    expect(quoteTextOf('a\r\nb')).toBe('> a\n> b')
    expect(quoteTextOf('a\rb')).toBe('> a\n> b')
  })

  it('trims whitespace at the selection ends and keeps every line in between intact', () => {
    /* `trim()` 去的是**整段文本**两端的空白：选区边缘常常捎带换行与缩进，留着会让引用
       多出空白行。它只管最外两侧——中间那些行的缩进是原文的一部分。 */
    expect(quoteTextOf('\n\nindented line  \n\n')).toBe('> indented line')
    expect(quoteTextOf('first\n    indented\nlast')).toBe('> first\n>     indented\n> last')
  })

  it('returns empty for a selection with nothing to quote', () => {
    expect(quoteTextOf('')).toBe('')
    expect(quoteTextOf('  \n\n \t ')).toBe('')
  })

  it('parses back to a quote block holding the original words', () => {
    const blocks = parseMarkdown(quoteTextOf('keep me'))
    expect(blocks).toEqual([{ t: 'quote', children: [{ t: 'paragraph', children: [{ t: 'text', s: 'keep me' }] }] }])
  })
})

describe('insertQuote', () => {
  it('inserts into an empty composer with no leading air and the caret after it', () => {
    const result = insertQuote('', 0, '> quoted')
    expect(result.text).toBe('> quoted')
    expect(result.caret).toBe('> quoted'.length)
  })

  it('separates the quote from text above it with one blank line', () => {
    const result = insertQuote('my words', 8, '> quoted')
    expect(result.text).toBe('my words\n\n> quoted')
    /* 光标落在末尾：读者按下按钮就要接着说自己的话，不必再点一下输入框。 */
    expect(result.caret).toBe(result.text.length)
  })

  it('does not pile up blank lines when the caret already sits after one', () => {
    const result = insertQuote('my words\n\n', 10, '> quoted')
    expect(result.text).toBe('my words\n\n> quoted')
  })

  it('puts a blank line between the quote and the text after it', () => {
    const result = insertQuote('abcdef', 3, '> quoted')
    expect(result.text).toBe('abc\n\n> quoted\n\ndef')
    /* 光标落在**引用块之后**：读者按下按钮就要接着说自己的话。落在插入内容的最末尾
       意味着它夹在「引用」与「原来后面的正文」之间——正好是下一段话该开始的地方。 */
    expect(result.caret).toBe('abc\n\n> quoted\n\n'.length)
  })

  it('does not add a trailing blank line when inserting at the very end', () => {
    const result = insertQuote('abc', 3, '> quoted')
    expect(result.text).toBe('abc\n\n> quoted')
  })

  it('clamps a caret outside the text instead of slicing it wrong', () => {
    expect(insertQuote('abc', -5, '> q').text).toBe('> q\n\nabc')
    expect(insertQuote('abc', 99, '> q').text).toBe('abc\n\n> q')
  })

  it('is a no-op for an empty quote', () => {
    expect(insertQuote('abc', 1, '')).toEqual({ text: 'abc', caret: 1 })
  })

  it('yields two separate quote blocks when quoting twice — never a merged one', () => {
    /* 连引两次是合法需求（引用两段不同的话）。两块之间必须有空行，否则第二个 `>` 会
       并进第一块，读者引的两段话在发送后读成一段。 */
    const first = insertQuote('', 0, '> one')
    const second = insertQuote(first.text, first.caret, '> two')
    const blocks = parseMarkdown(second.text)
    expect(blocks.map(block => block.t)).toEqual(['quote', 'quote'])
  })
})
