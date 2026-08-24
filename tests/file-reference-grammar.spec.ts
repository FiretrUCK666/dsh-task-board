/**
 * 官方 @file 文法镜像的契约测试 —— file-reference-grammar.ts 与
 * `@deepseek-ai/dsh-file-reference/grammar` 逐字一致（该行为由官方仓库
 * grammar.spec 定义）：引号 token、词边界、控制字符拒绝、目录下钻。任何
 * 文法改动都必须先改官方源、再同步本镜像并更新这些用例，绝不由本插件
 * 自行调整（同一条文法，两个载体，零漂移）。
 */
import { describe, expect, it } from 'vitest'
import { activeAtToken, formatFileMention } from '../src/client/board/file-reference-grammar.ts'

describe('activeAtToken (官方镜像)', () => {
  it('detects a plain @ token at a word boundary', () => {
    expect(activeAtToken('@src/main.ts', 12)).toEqual({ prefix: '@src/main.ts', query: 'src/main.ts', quoted: false })
    expect(activeAtToken('see @notes', 10)).toEqual({ prefix: '@notes', query: 'notes', quoted: false })
  })

  it('detects an OPEN QUOTED token spanning whitespace', () => {
    expect(activeAtToken('@"my file.txt', 14)).toEqual({ prefix: '@"my file.txt', query: 'my file.txt', quoted: true })
  })

  it('keeps an open quote alive after a trailing slash (directory descent)', () => {
    expect(activeAtToken('@"src/', 6)).toEqual({ prefix: '@"src/', query: 'src/', quoted: true })
  })

  it('never treats an @ inside a word (email) as a trigger', () => {
    expect(activeAtToken('a@b.com', 6)).toBeUndefined()
    expect(activeAtToken('x@y', 3)).toBeUndefined()
  })

  it('returns undefined when no @ token ends at the caret', () => {
    expect(activeAtToken('plain text', 10)).toBeUndefined()
    expect(activeAtToken('', 0)).toBeUndefined()
    expect(activeAtToken('@src ', 5)).toBeUndefined() // caret on the space
  })
})

describe('formatFileMention (官方镜像)', () => {
  it('formats plain paths without quotes', () => {
    expect(formatFileMention({ kind: 'file', path: 'src/main.ts' }, false)).toBe('@src/main.ts')
    expect(formatFileMention({ kind: 'directory', path: 'src/components' }, false)).toBe('@src/components/')
  })

  it('quotes paths with whitespace; a quoted directory keeps its quote open', () => {
    expect(formatFileMention({ kind: 'file', path: 'a file.txt' }, false)).toBe('@"a file.txt"')
    expect(formatFileMention({ kind: 'directory', path: 'my folder' }, false)).toBe('@"my folder/')
  })

  it('preserveQuote retains the quote even when unnecessary', () => {
    expect(formatFileMention({ kind: 'file', path: 'src/main.ts' }, true)).toBe('@"src/main.ts"')
  })

  it('rejects paths the grammar cannot represent (control chars / quotes)', () => {
    expect(formatFileMention({ kind: 'file', path: 'bad"name.ts' }, false)).toBeUndefined()
    expect(formatFileMention({ kind: 'file', path: 'bad\u0007name.ts' }, false)).toBeUndefined()
  })
})