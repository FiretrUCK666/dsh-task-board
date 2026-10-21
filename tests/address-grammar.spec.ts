/**
 * `#` 开头的两门文法，各自有且只有一个家。
 *
 * ── 这一道门禁为什么存在 ───────────────────────────────────────────────────────
 *
 * `#` 在这个项目里不是一个记号，是**两门**：
 *
 *   · **地址**：`#12` 指一张卡（界面上的回执就这么写，模型也这么读）；
 *   · **标签**：`#要做` 是搜索框里的限定词（读者自己的词）。
 *
 * 两门文法都用 `#` 开头，于是「这个 `#` 是什么意思」必须各说各的——一门文法一个家。
 *
 * 真实发生过什么：地址文法被抄了**十份**，其中**六份少一个 `.trim()`**。于是
 * `# 12`（带空格）在**一个动作**里找得到、在**另一个动作**里找不到，而
 * **没有任何一条测试会红**——两边各自都对，只是对得不一样。
 *
 * ── 判据读结构，不读字样 ───────────────────────────────────────────────────────
 *
 * 扫的是**代码里那个孤零零的 `'#'` 字面量**。格式化一个显示串
 * （`` `#${item.ref}` ``）是**模板字面量**，不是这个形状，所以「说一个编号」
 * 不会被误判成「读一个编号」——这个区别是这道门禁的全部依据。
 * 扫描**先剥注释再匹配**：一段说明里提到 `#` 不算一次用法。
 *
 * ── 自证 ────────────────────────────────────────────────────────────────────
 *
 * 喂一份假面证明它会咬：别处自己写一遍 `#` 的判断必须被抓；家自己写放行。
 */

import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXEMPT_SIGILS,
  GRAMMAR_HOMES,
  missingHomes,
  sigilUses,
  straySigils,
} from '../scripts/verify-address-grammar.mjs'

describe('# 的两门文法各有一个家', () => {
  it('两门文法都声明了家', () => {
    expect(Object.keys(GRAMMAR_HOMES)).toContain('src/core/item-navigate.ts')
    expect(Object.keys(GRAMMAR_HOMES)).toContain('src/core/item-query.ts')
  })

  it('剥注释之后再数——说明里提到 # 不算一次用法', () => {
    const uses = sigilUses([
      "// 它认 '#12' 这种写法",
      '/* 也认 "#13" */',
      "if (token.startsWith('#')) return true",
    ].join('\n'))
    expect(uses).toHaveLength(1)
    expect(uses[0].line).toBe(3)
  })

  it('格式化一个编号（模板字面量）不算一次用法', () => {
    const uses = sigilUses('const said = `#${item.ref}`')
    expect(uses).toHaveLength(0)
  })

  it('别处自己写一遍 —— 必须被抓住', () => {
    const found = straySigils([
      { file: 'src/client/thing.ts', text: "if (token.startsWith('#')) return true\n" },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].file).toBe('src/client/thing.ts')
  })

  it('家自己写 —— 放行', () => {
    const found = straySigils([
      { file: 'src/core/item-navigate.ts', text: "return String(x).replace('#', '').trim()\n" },
      { file: 'src/core/item-query.ts', text: "if (token.startsWith('#')) return true\n" },
    ])
    expect(found).toHaveLength(0)
  })

  it('声明的例外放行，而且例外本身要写明理由', () => {
    for (const reason of Object.values(EXEMPT_SIGILS)) {
      expect(reason.trim().length).toBeGreaterThan(8)
    }
    const found = straySigils([
      { file: Object.keys(EXEMPT_SIGILS)[0], text: "const a = x.split('#')[0]\n" },
    ])
    expect(found).toHaveLength(0)
  })

  it('声明的家必须真的存在', () => {
    /* **自证：读仓库自己的根，家都在。**
     *
     * 取根那条式子曾经是 `new URL('..', import.meta.url).pathname.replace(/^\//, '')`。
     * 它在 Windows 上碰巧是对的：`pathname` 是盘符为第一段的样子，去掉开头那个斜杠
     * 仍然是绝对路径。在 POSIX 上是错的：`pathname` 以根目录开头，**去掉那个斜杠
     * 就变成了相对路径**，于是 `existsSync` 全部落空，这条断言报「家不存在」。
     *
     * 它只在 CI 上红，而 CI 一直红在别处（Node 版本那件事），所以这一条被盖住了；
     * 本地是 Windows，一直是绿的。**判据本身没问题，取根的方式不跨平台。**
     *
     * `fileURLToPath` 就是为这件事存在的：它按平台的规则把 file URL 还原成路径，
     * 两个平台都对，也不需要手写那个 `replace`。
     *
     * **这段注释里不许写出真实的家目录形态。** `verify-standalone` 的家目录泄漏
     * 检查认的是「任何人的家目录形态」，不只是本机的：在 CI 上 `homedir()` 就是
     * runner 的家目录，而一句拿它当例子的注释会被判成泄漏——本地看不出问题，
     * 因为本机的家目录拼写不一样。举例要举抽象的：说「盘符为第一段」和「以根目录
     * 开头」，不写具体路径。 */
    const root = fileURLToPath(new URL('..', import.meta.url))
    expect(missingHomes(root)).toEqual([])
  })
})
