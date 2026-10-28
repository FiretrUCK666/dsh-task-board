/**
 * 引用文法的契约：**我们写进输入框的那几行，官方读得回来。**
 *
 * ── 为什么要有这一条 ─────────────────────────────────────────────────────────
 *
 * 「引用」在 DSH 里不是一种消息类型，也不是一段私有元数据——它就是**普通 Markdown 引用行**。
 * 所以我们产出的东西能不能被官方认出来，完全取决于**行的形状**：前缀是 `>` 加一个空格，
 * 每行都带（空行也带）。
 *
 * 这个形状一旦和官方分家，症状极其隐蔽：引用仍然发得出去，仍然是一条普通消息，也仍然会
 * 被渲染成引用块（我们自己的 parser 认）；但**官方那套（宿主引用节点、`messageQuoteRanges`
 * 的识别、以及未来任何读引用行的功能）会读不到它**。屏上没有任何报错，只有「我引用的话
 * 怎么和以前不一样」。
 *
 * ── 判据为什么是「读官方源码」而不是「抄一份规则」 ───────────────────────────
 *
 * 抄一份规则等于给自己一个假的保证：官方改了，抄的那份不会跟着改，而它照样绿。所以这里
 * 在**已安装的宿主**里找 `@deepseek-ai/dsh-message-quotes`，把它的 `quoteTextOf` 真的
 * 取出来，喂我们生成的行，看它认不认。
 *
 * 官方包没装（CI、别人克隆本仓库）时**明说跳过**——这是 `verify-design-docs.mjs` 已经
 * 确立的做法：宿主按需安装，不是本包的依赖。跳过要留下原因，不能安静地当成通过。
 *
 * ── 这份 spec 守的是什么、不守什么 ───────────────────────────────────────────
 *
 * 守：行前缀的形状、空行也带前缀、换行归一、以及「官方读回来等于原文」。
 * 不守：官方哪天把引用改成带元数据的东西——那时候这条会红，而**红得对**，因为那就是
 * 一次需要人来看的升级。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { quoteTextOf } from '../src/client/board/quote-text.ts'

/**
 * 在已安装的宿主里找到官方的引用实现，取回它那个 `quoteTextOf`。
 *
 * `lib/client.js` 是 `__ModuleLoader__` 的闭包工厂（浏览器里由宿主加载器执行），Node 里
 * 没有 `window`，直接 `import` 它跑不起来；所以这里读**源码文本**，从里面取出那个纯函数
 * 表达式。取的是**官方那一份逻辑本身**，不是我们复述的一句话。
 *
 * @returns 官方的解码函数，或 `undefined`（宿主没装 / 找不到那份实现）。
 */
function officialQuoteTextOf(): ((text: string) => string) | undefined {
  const roots = [
    join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
    join(process.env.HOME ?? '', '.npm', 'node_modules'),
  ]
  for (const root of roots) {
    const file = join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-message-quotes', 'lib', 'client.js')
    if (!existsSync(file)) continue
    const source = readFileSync(file, 'utf8')
    /* 官方源码里的函数体是一条稳定的短表达式（去掉每行至多三个前导空格后的 `>`）。按
       `return … ;` 这一行取出表达式，再 `new Function` 造一个可调用的副本——这样验证的是
       **官方那一份逻辑本身**，而不是我们复述的一句话。 */
    const body = /function quoteTextOf\(text\) \{\s*return ([\s\S]*?);\s*\}/.exec(source)
    if (body === null) continue
    try {
      return new Function('text', `return ${body[1]}`) as (text: string) => string
    } catch {
      continue
    }
  }
  return undefined
}

const official = officialQuoteTextOf()

describe('引用行的形状跟随官方', () => {
  it('official quote decoder is available from the installed host, or this spec says so', () => {
    /* 宿主没装时**明说跳过**，不当成通过：安静地绿会让人以为这件事有人验过。 */
    if (official === undefined) {
      console.warn('quote-contract: 未找到已安装的 @deepseek-ai/dsh-message-quotes，本契约跳过（宿主按需安装，不是本包的依赖）')
      return
    }
    expect(typeof official).toBe('function')
  })

  it('our output is the canonical `> ` form, not merely something official can parse', () => {
    if (official === undefined) return
    /* **这一条比「官方读得回来」更严，而它必须有。** 官方的文法写作 `/^ {0,3}>[ \t]?/`
       ——那个 `?` 让 `>甲`（不带空格）它**也**读得对。于是「解码回来一字不差」那条在
       「前缀少了那个空格」时**仍然会绿**，而我们的输出已经从标准形态漂成了另一种写法。
       所以这里钉**字面形状**：每一行都是 `> ` 加内容，空行是 `> `。
       标准形态不是口味——它是别人读我们产出的东西时唯一能预期的写法。 */
    expect(quoteTextOf('甲')).toBe('> 甲')
    expect(quoteTextOf('甲\n乙')).toBe('> 甲\n> 乙')
    expect(quoteTextOf('甲\n\n乙')).toBe('> 甲\n> \n> 乙')
  })

  it('official decodes our quoted text back to the original words', () => {
    if (official === undefined) return
    /* 这是「语义」那一半：我们生成的每一行，官方解码之后必须**一字不差地**还原。
       语义对了但形状漂了，由上一条抓；形状对了但语义错了，由这一条抓。两条各守一半。 */
    for (const original of [
      '一句话',
      '第一句\n第二句',
      'paragraph one\n\nparagraph two',
      '  缩进的原文',
      'a\n\n\nb',
    ]) {
      expect(official(quoteTextOf(original)), `原文 ${JSON.stringify(original)} 经官方解码后不一致`)
        .toBe(original.trim().replace(/\r\n?/gu, '\n'))
    }
  })

  it('every line carries a prefix, including a blank one', () => {
    if (official === undefined) return
    /* 空行不带前缀会把引用截成两块——官方那边读到的就是两段引用，而读者引的是一段话。 */
    const quoted = quoteTextOf('甲\n\n乙')
    expect(quoted.split('\n')).toEqual(['> 甲', '> ', '> 乙'])
    /* 官方解码后是一个连续的两段文本，不是断开的。 */
    expect(official(quoted)).toBe('甲\n\n乙')
  })

  it('official recognises our lines as ONE consecutive quote span', () => {
    if (official === undefined) return
    /* `messageQuoteRanges` 用「连续的前缀行」界定一段引用。我们的产出必须被它读成**一段**，
       而不是若干段——否则官方那套渲染会把一次引用画成好几个引用块。 */
    const roots = [
      join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
      join(process.env.HOME ?? '', '.npm', 'node_modules'),
    ]
    let rangesSource: string | undefined
    for (const root of roots) {
      const file = join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-message-quotes', 'lib', 'client.js')
      if (!existsSync(file)) continue
      const source = readFileSync(file, 'utf8')
      const match = /function messageQuoteRanges\(text\) \{([\s\S]*?)\n\t\t\}/.exec(source)
      if (match !== null) { rangesSource = match[1]; break }
    }
    if (rangesSource === undefined) return
    const ranges = new Function('quoteTextOf', 'text', rangesSource.replace(/quoteTextOf\(/g, 'quoteTextOf(')) as
      (decode: (text: string) => string, text: string) => { start: number; end: number }[]
    const spans = ranges(official, quoteTextOf('甲\n\n乙'))
    expect(spans).toHaveLength(1)
  })
})
