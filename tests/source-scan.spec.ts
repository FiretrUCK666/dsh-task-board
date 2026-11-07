/**
 * 门禁读源码之前先剥注释——剥不干净，**每一条判据都会说谎**。
 *
 * ── 这一条 spec 为什么存在 ────────────────────────────────────────────────────
 *
 * 十一道门禁（`verify-dead-export`、`verify-one-implementation`、
 * `verify-address-grammar`、`verify-read-write-parity` …）都 import 同一个
 * `scripts/source-core.mjs`。它们全都声称「先剥注释再匹配」，而这句话**只在那一个
 * 函数正确时成立**：一旦它把某段源码读错，那些门禁读到的「代码」里就混着散文，
 * 于是**注释里提到过的每一个名字都成了「有人读」**。
 *
 * 这不报错、不变红、不影响运行时——它只是让十一道门禁一起变成绿灯的装饰。
 *
 * ── 被钉住的那个错 ────────────────────────────────────────────────────────────
 *
 * `/` 有两种读法（除法与正则），分界线是前一个字符。`<` 之后按「表达式可以开始」
 * 读，于是 JSX 的 `</div>` 被当成一个正则的开头；正则不许跨行，可那个读法不知道
 * 这一点，于是它一路吞到文件尾——**从那以后所有注释都不再被剥掉**。
 *
 * 实测：`const a = <div>hi</div>` 之后写一段块注释，剥完那段注释**原样还在**。
 */

import { describe, expect, it } from 'vitest'
import { scanSource, stripSourceComments, SOURCE_CODE, SOURCE_LITERAL_BODY } from '../scripts/source-core.mjs'

/** 判断这段文字在剥完之后还在不在（在 = 没剥掉）。 */
function kept(source: string, needle: string): boolean {
  return stripSourceComments(source).includes(needle)
}

describe('剥注释：JSX 的结束标签不是正则的开头', () => {
  it('`</div>` 之后的那段块注释**必须**被剥掉', () => {
    const source = 'const a = <div>hi</div>\n/* ghostOnly */\nexport const x = 1\n'
    expect(kept(source, 'ghostOnly'), 'JSX 结束标签被读成正则开头，后面整段注释都没剥——十一道门禁从此读的是散文').toBe(false)
  })

  it('同形的几处也都不该被吞：自闭合标签、属性里的斜杠、多行 JSX', () => {
    expect(kept('const a = <br />\n/* gone */\n', 'gone')).toBe(false)
    expect(kept('const a = <a href="x/y" />\n/* gone */\n', 'gone')).toBe(false)
    expect(kept('const a = (\n  <div>\n    <span>hi</span>\n  </div>\n)\n/* gone */\n', 'gone')).toBe(false)
  })

  it('JSX 里的注释也照剥', () => {
    expect(kept('const a = <div>{/* insideJsx */}</div>\n', 'insideJsx')).toBe(false)
  })
})

describe('剥注释：真正的正则与除法仍然读得对', () => {
  it('一行之内的正则字面量仍然是字面量（它的内容不是代码）', () => {
    const source = "const re = /task\\.create/\nre.test(x)\n"
    const scan = scanSource(source)
    const at = source.indexOf('task')
    expect(scan.state[at], '正则体被读成了代码：里面的点号与括号会被当成结构').toBe(SOURCE_LITERAL_BODY)
  })

  it('正则后面的注释照样被剥掉', () => {
    expect(kept("const re = /a\\/b/g\n/* gone */\n", 'gone')).toBe(false)
  })

  it('除号不被误认成正则（否则后面整行都不算代码）', () => {
    const source = 'const x = a / b\ncallSomething()\n'
    const scan = scanSource(source)
    const at = source.indexOf('callSomething')
    expect(scan.state[at], '除号被读成正则开头，于是同一行的代码被吞进字面量').toBe(SOURCE_CODE)
    expect(kept('const x = 1 / 2\n/* gone */\n', 'gone')).toBe(false)
  })

  it('`if (x) /re/.test(y)` 这种写法按除法读，是已知的、写下来的让步', () => {
    // 这一条**不是**要求修好的缺陷：`source-core.mjs` 的头注释写明按词表读就够，
    // 仓库里没有一处判据依赖那种写法。钉住它是为了让「哪天它变了」有人看得见。
    expect(kept('if (x) /re/.test(y)\n/* gone */\n', 'gone')).toBe(false)
  })
})
