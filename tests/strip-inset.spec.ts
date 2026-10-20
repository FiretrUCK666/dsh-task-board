/**
 * 条带的横向内衬只有一处家。
 *
 * ── 这一道门禁为什么存在 ───────────────────────────────────────────────────────
 *
 * 它抓的是一个**不会报错的**缺陷：版面上有两层横向空气——滚动体自己付一档（框架
 * 空气），条带里的东西再付一档（行内衬）——
 *
 *   - **滚动体外面**的条带（顶栏、归档顶栏、左栏）：它吃不到滚动体自己付的那一档，
 *     所以两端各付**两档**（框架空气 + 行内衬）；
 *   - **滚动体里面**的条带（回执、日分段、空态）：那一档框架空气已经由滚动体付过，
 *     它只付**行内衬那一档**。
 *
 * 付错层次与没付**一样错**，而两种错都不报错、不影响任何功能测试。真实发生过两次：
 *
 *   1. 回执是一条新加出来的条带，它一档都没付，于是它比下面的行各往左 16px，屏上
 *      读作「这一条没对齐」——读者截图报上来的正是它。
 *   2. **这一道门禁自己写漏了**：它只认 `padding-inline:` 这一种写法，而清单表里剩下
 *      的三份拷贝全是 `padding:` 简写；它那份名单又是手写的三个类名，而**真正写内衬
 *      的两个容器根本不在名单里**。于是门禁绿着，形状还有三个家。
 *
 * ── 判据读结构，不读数值 ───────────────────────────────────────────────────────
 *
 * 这条门禁**不**检查某个类的 `padding` 等于多少像素（那会随档位变，也会逼着人改
 * 数字）。它检查的是**归属**：这条内衬住在 `design/base.module.css` 的两个类里，
 * 页面表里再写一份就是第二个定义处。
 *
 * **怎么认出「一份拷贝」而不误伤合法的用法**：条带内衬是**两档**（框架空气 + 行
 * 内衬），而清单表里另外两种内衬各自只读一档——
 *
 *   - 行卡自己的内衬只读**行内衬**（`--dsh-tb-row-pad`）；
 *   - 滚动体与行卡的外沿只读**框架空气**（`--item-air`）。
 *
 * 所以判据是「**一份 padding 声明同时带上了两档**」——那一档只有条带内衬是它。
 * 另有一条更死的：那两个旧别名（`--item-inset-x` / `--item-inset-x-end`）**已经删除**，
 * 页面表里再出现就是有人在引用一个不存在的名字。
 *
 * ── 它不检查什么（说清楚，不让人以为它被保护着）──────────────────────────────
 *
 * 它**不**能发现「一条新带子既没抄本地内衬、也没挂共享类」——那种带子根本没有内衬，
 * CSS 层面无从判断。**那一档由几何量法兜着**：`pnpm run audit` 在真 Chromium 里量
 * 各条带的第一个字与行卡第一个字是否同一条竖线（见 `DESIGN.md` 的量法一节）。
 * 这一道门禁守的是**抄一份**这一档，量法守的是**没付**那一档。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

/** The shared class per layer, and the token that layer is supposed to read. */
const SHARED = {
  outer: { className: 'stripInsetOuter', token: '--dsh-tb-row-pad' },
  inner: { className: 'stripInsetInner', token: '--dsh-tb-row-pad' },
} as const

/** The two tiers the strip inset is made of. */
const FRAME_AIR = /--dsh-tb-frame-air|--item-air/
const ROW_PAD = /--dsh-tb-row-pad|--item-row-pad/
/** The aliases that were deleted — naming one means naming something that is not there. */
const DEAD_ALIAS = /--item-inset-x/

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/** A rule's body, by its selector — the sheet's own text, comments already gone. */
function bodyOf(sheet: string, selector: string): string {
  const at = sheet.indexOf(selector)
  if (at < 0) return ''
  const open = sheet.indexOf('{', at)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < sheet.length; i++) {
    if (sheet[i] === '{') depth++
    else if (sheet[i] === '}') {
      depth--
      if (depth === 0) return sheet.slice(open + 1, i)
    }
  }
  return sheet.slice(open + 1)
}

/** Every padding declaration in the sheet that is a second home for the strip inset. */
export function localInsetCopies(sheet: string): string[] {
  const noComments = sheet.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  for (const rule of noComments.split('}')) {
    const open = rule.indexOf('{')
    if (open < 0) continue
    const selector = rule.slice(0, open).trim()
    if (selector === '') continue
    for (const declaration of rule.slice(open + 1).split(';')) {
      const text = declaration.trim()
      if (!/^padding(?:-inline|-block|-top|-bottom)?\s*:/.test(text)) continue
      if (DEAD_ALIAS.test(text)) {
        out.push(`${selector} → ${text}  （那个别名已经删了）`)
        continue
      }
      /* 两档同时出现 = 这一条声明就是条带内衬，而它住在共享表里。 */
      if (FRAME_AIR.test(text) && ROW_PAD.test(text)) {
        out.push(`${selector} → ${text}  （两档都在 = 条带内衬的第二个定义处）`)
      }
    }
  }
  return out
}

describe('the strip inset has exactly one home', () => {
  it('the page sheet does not write the inset itself', () => {
    /* **反查**：这条内衬住在共享表里，页面表里再写一份就是第二个定义处。
       判据只看**属性与令牌**，不看数值——档位变了它照样红，那正是它要抓的。 */
    const sheet = read('src/client/item/item.module.css')
    const copies = localInsetCopies(sheet)
    expect(
      copies,
      '清单表里又出现了条带内衬的本地拷贝——它只该住在 design/base.module.css：\n'
      + copies.join('\n'),
    ).toEqual([])
  })

  it('the judgement bites: a copy in a sheet is named, a legal inset is not', () => {
    /* **这一条是这道门禁的自证。** 它喂的是**记忆里的表**，不是磁盘上那一张——
       在真实文件上改一下再改回来，证的是「改动生效」而不是「门禁会红」（硬性规范 16）。
       判据与正文用的是同一个函数，所以这里绿了，正文那一条就真的会红。 */
    const copies = localInsetCopies([
      '.a {',
      '  padding: 0 var(--item-inset-x-end) var(--s3) var(--item-inset-x);',
      '}',
      '.b {',
      '  padding-inline: calc(var(--dsh-tb-frame-air) + var(--dsh-tb-row-pad));',
      '}',
      '.c {',
      '  /* 注释里写这两个词不算：先剥注释再匹配。 */',
      '  padding: var(--s2) var(--dsh-tb-row-pad);',
      '}',
      '.d {',
      '  padding-inline: var(--item-air);',
      '}',
    ].join('\n'))
    expect(copies).toHaveLength(2)
    expect(copies[0]).toContain('.a')
    expect(copies[0]).toContain('那个别名已经删了')
    expect(copies[1]).toContain('.b')
    expect(copies[1]).toContain('两档都在')
  })

  it('the shared sheet defines both layers, each reading its own tier', () => {
    const sheet = read('src/client/design/base.module.css')
    for (const layer of Object.keys(SHARED) as (keyof typeof SHARED)[]) {
      expect(sheet.includes(`.${SHARED[layer].className} {`), `共享表里缺少 .${SHARED[layer].className}`).toBe(true)
    }
    const outer = bodyOf(sheet, '.stripInsetOuter')
    const inner = bodyOf(sheet, '.stripInsetInner')
    /* 外面那一档是两档之和；里面那一档只付行内衬。 */
    expect(outer, '外面那一档是「框架空气 + 行内衬」').toMatch(FRAME_AIR)
    expect(outer).toMatch(ROW_PAD)
    expect(inner, '里面那一档只付行内衬——框架空气滚动体已经付过了').toMatch(ROW_PAD)
    expect(inner, '里面那一档不该再付框架空气').not.toMatch(FRAME_AIR)
  })

  it('both shared classes are actually mounted by a page', () => {
    /* 一个**没人挂**的共享类与一个不存在的共享类同样没用：它看着像有一处家，
       其实那处家是空的。 */
    const pages = ['src/client/item/panel.tsx', 'src/client/item/rail.tsx', 'src/client/item/pages/list.tsx']
    const sources = pages.map(read).join('\n')
    for (const layer of Object.keys(SHARED) as (keyof typeof SHARED)[]) {
      const mounted = sources.includes(`base.${SHARED[layer].className}`)
      expect(mounted, `共享类 .${SHARED[layer].className} 没有任何页面挂上它——它就是一个空的家`).toBe(true)
    }
  })
})
