#!/usr/bin/env node
/**
 * **定高的盒子不许装会换行的内容。**
 *
 * ── 这条门禁守的是一个读者截图报上来的真实缺陷 ──────────────────────────────
 *
 * 日程页那串「截止已过 0 · 计划已过 0 · 今天 0 · …」被塞进一枚**固定 24px 高**的胶囊里。
 * 宽屏上它正好一行，看不出问题；手机上一行放不下，折成三行——而盒子还是 24px，于是
 * 第二、三行**画到胶囊外面**，露在页面底色上，右边也溢出。
 *
 * 根因不是某个数写错了，是**两条属性在同一个盒子上互斥却没人拦**：
 *
 *   `block-size: <固定值>`  —— 我说这个盒子的高就是这个数
 *   `flex-wrap: wrap`       —— 而它的内容要折行，行数不定
 *
 * 两条同时成立时，浏览器只能让内容溢出。它们各自都对，放在一起就错。
 *
 * ── 为什么门禁能判，而 jsdom 不能 ──────────────────────────────────────────
 *
 * 这不是"量出来才知道"的那类问题：**两条声明同时出现在一个规则体里，就已经是缺陷**，
 * 与字体、宽度、文案长度都无关。所以它读源码就够，不需要真浏览器——这也是它能进
 * `pnpm verify` 的原因（几何判据进不去，静态判据进得去）。
 *
 * 判定按**生效值的来源**而不是「同一个块里有没有这两行」：本仓库大量使用共享家族规则
 * （`.itemGroupHead, .itemEmptyGroups { block-size: … }`），于是在另一个块里写
 * `flex-wrap: wrap` 同样会撞上。要判得准，就得把同一个选择器出现的所有规则合起来看。
 *
 * 用法：`node scripts/verify-fixed-height-wrap.mjs [根目录]`
 * 自测：`--probe-collision`（定高 + 可换行同一个块，必须红）
 *       `--probe-cancelled`（定高被后来改成 auto，必须放行）
 *       `--probe-other-selector`（定高在 A、换行在 B，必须放行）
 */

import { existsSync } from 'node:fs'
import { rulesOf, declOf } from './css-core.mjs'
import { clientSheetFiles } from './sheet-files.mjs'
import { probeOf } from './probe-args.mjs'

/**
 * 一条规则选中的**承载盒**是哪个类。
 *
 * 一条选择器可能命中好几个元素，但**盒子只有承载它的那一个**：
 * `.boardModes .notifyBell` 里定高的是铃铛（`.notifyBell`），`.boardModes` 只是祖先。
 * 所以承载盒 = **最后一个类**。
 *
 * 组合选择器（`.a, .b`）里每一段各有各的承载盒——`.a` 与 `.b` 是两个盒子。所以这里
 * 返回**数组**：一段组合选择器可以给多个盒子各发一份声明。
 * @param {string} selector - 规则的选择器。
 * @returns {string[]} 承载盒的类名（不含点）。
 */
export function holderOf(selector) {
  const out = []
  for (const part of selector.split(',')) {
    const trimmed = part.trim().replace(/\s+/g, ' ')
    if (trimmed === '') continue
    /* 伪类/伪元素挂在最后一个类上（`.a:hover` 的盒子还是 `.a`），所以要把它们剥掉。 */
    const classes = [...trimmed.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])
    const last = classes[classes.length - 1]
    if (last !== undefined && last !== '') out.push(last)
  }
  return out
}

/**
 * 一个 `block-size` / `height` 的值是不是**固定**的（不是 `auto`、不是随内容的）。
 *
 * `auto` / `fit-content` / `100%` 都可能随内容或容器变，所以不算定高；像素、rem、
 * 令牌（`var(--x)`）都算——令牌最终解析成一个定值，那正是这一族胶囊的写法。
 * @param value - 声明的值。
 * @returns 是否为定高。
 */
export function isFixedHeight(value) {
  const v = value.trim()
  if (v === '') return false
  if (/^(auto|inherit|initial|unset|revert|fit-content|min-content|max-content)$/i.test(v)) return false
  if (/^(min|max|fit)-content$/i.test(v)) return false
  /* 百分比随容器，不随内容——它不会因为内容折行而变，所以仍是定高。 */
  return true
}

/**
 * 收集每个选择器「最终生效」的定高与换行两件事。
 *
 * 后出现的规则覆盖先出现的（CSS 层叠的简化版：同特异性、同来源，后者胜）。这里不判
 * 特异性——本仓库的写法是同一族规则集中在一处，误判方向是"少报"而不是"误报"，
 * 而少报一条真缺陷比误报十次让人关掉门禁要轻。
 * @param css - 一张表的全文。
 * @returns `{ selector, fixedHeight?, wraps, line }[]`。
 */
export function collisionsIn(css) {
  /* **按「单个类名」记账，不按完整选择器字符串。**
   *
   * 这一条是判得准的关键，而它来自一次真实的失败：第一版用完整选择器当身份，于是
   * `.itemGroupHead, .itemEmptyGroups { block-size: … }` 与
   * `.itemEmptyGroups { flex-wrap: wrap }` 被当成两个不同的东西，那个真缺陷**没有被
   * 抓到**（把修复撤掉，门禁照样通过）。
   *
   * 一个规则给高，命中的是它选择器里出现的**每一个**类；另一条给换行，命中它自己的。
   * 所以：把每个类名收集起来，再看同一个类名有没有同时被「定高」和「可换行」命中。
   * 组合选择器因此自然展开——那正是本仓库共享家族规则的写法。
   *
   * ── **作用域怎么算** ──────────────────────────────────────────────────────
   * 第二版按 at-rule 把 key 分开（`scope\0cls`），理由是「宽档的定高与窄档的换行不同时
   * 生效」。**那个理由是错的**，而且它藏着一个真漏报：
   *
   *   `.itemRowMarks { block-size: … }`            ← 顶层
   *   `@container (max-width: 559px) { .itemRowMarks { flex-wrap: wrap } }`
   *
   * 窄屏上，容器查询里的规则**只加**了 wrap，顶层那条定高**仍然生效**——两者同时成立，
   * 于是内容会溢出。这正是本门禁要抓的那一类，而按作用域分开的第二版**报不出来**
   * （实测：这样的形状返回空数组）。
   *
   * 所以判定改成：**同一个类，在任何一个「作用域链」上同时拿到定高与可换行，就是冲突。**
   * 作用域链 = 它所在的作用域 + 它的所有外层作用域。顶层是所有作用域链的公共部分，
   * 所以「顶层定高 + 窄档换行」在窄档那条链上撞上——正是要的。
   *
   * `auto`（或其它非定高值）仍然算一次**撤销**，但它只撤销**它自己那条链**上的定高：
   * 顶层写 `auto` 撤掉顶层那条定高，而容器查询里的定高仍要由容器查询自己撤销。
   * 这就是为什么记账要按「类 + 作用域」两份，而不是一个扁平的类表。
   *
   * ── **记账的键是「承载盒」，不是选择器里的每一个类** ──────────────────────
   *
   * 一条规则可能选中好几个类，但**盒子只有承载它的那一个**：
   *
   *   `.boardModes .notifyBell { block-size: … }`   ← 定高的是**铃铛**
   *   `.boardRowTools .boardModes  { flex-wrap: … }` ← 换行的是**模式组**
   *
   * 那是**两个不同的盒子**，把它们算成冲突就是误报（第二版就误报了这两条）。
   * 承载盒 = 选择器的**最后一个类**（后代选择器里，被逗号分开的前半段是祖先）。
   * 只有承载盒相同才是同一个盒子，才谈得上「既有定高又有换行」。 */
  /** @type {Map<string, Map<string, { value: string, line: number }>>} 承载盒 -> 作用域 -> 定高 */
  const heights = new Map()
  /** @type {Map<string, Map<string, { value: string, line: number }>>} 承载盒 -> 作用域 -> 换行 */
  const wraps = new Map()

  for (const rule of rulesOf(css)) {
    const scope = rule.at
    const holders = holderOf(rule.selector)
    if (holders.length === 0) continue
    const height = declOf(rule.body, 'block-size') ?? declOf(rule.body, 'height')
    const wrap = declOf(rule.body, 'flex-wrap')
    for (const holder of holders) {
      if (height !== undefined) {
        const perScope = heights.get(holder) ?? new Map()
        /* 非定高的值（`auto` 等）是一次**撤销**：记下来，让它把这条链上的定高顶掉。 */
        perScope.set(scope, { value: height.trim(), line: rule.line })
        heights.set(holder, perScope)
      }
      if (wrap !== undefined) {
        const perScope = wraps.get(holder) ?? new Map()
        perScope.set(scope, { value: wrap.trim(), line: rule.line })
        wraps.set(holder, perScope)
      }
    }
  }

  const out = []
  for (const [cls, heightScopes] of heights) {
    const wrapScopes = wraps.get(cls)
    if (wrapScopes === undefined) continue
    /* **遍历换行的作用域，而不是定高的作用域。**
     * 冲突发生在「换行的那一档」——因为定高是它的外层祖先（顶层），而外层的声明在
     * 内层生效时**不会被撤销**（内层只加不减）。反过来，从定高那一档去找换行是找不到的：
     * 顶层的 scope 是 `""`，而 `""` 不是任何内层 scope 的前缀。
     *
     * 于是对每个换行作用域，找这条链上**最终生效**的那一份高度：内层优先，外层兜底
     * （内层可以写 `auto` 撤销外层的定高）。 */
    for (const [wrapScope, wrapEntry] of wrapScopes) {
      const wrapValue = wrapEntry.value
      if (wrapValue !== 'wrap' && wrapValue !== 'wrap-reverse') continue
      const chain = [...heightScopes.entries()]
        .filter(([at]) => at === wrapScope || wrapScope.startsWith(at))
        .sort((a, b) => b[0].length - a[0].length)
      const effectiveHeight = chain[0]
      if (effectiveHeight === undefined) continue
      const value = effectiveHeight[1].value
      if (!isFixedHeight(value)) continue
      out.push({
        selector: `.${cls}`,
        height: value,
        line: effectiveHeight[1].line,
        scope: wrapScope === '' ? '（顶层）' : wrapScope,
      })
      break
    }
  }
  return out
}

/**
 * 找出所有「定高 + 可换行」的规则。
 * @param root - 仓库根。
 * @returns `{ file, line, selector, height }[]`。
 */
export function fixedHeightWrapFindings(root) {
  const findings = []
  for (const sheet of clientSheetFiles(root)) {
    for (const one of collisionsIn(sheet.css)) {
      /* **`height` 不是 `fixedHeight`。** `collisionsIn` 产出的键叫 `height`，这里读
         `fixedHeight` 会拿到 `undefined`——于是报错那一行印的是
         「block-size: undefined」，恰好在读者最需要知道那个数的时候把它吞了。
         `.mjs` 没有类型检查，所以这个错不会在构建时冒出来。 */
      findings.push({ file: sheet.rel, line: one.line, selector: one.selector, height: one.height })
    }
  }
  return findings
}

function main() {
  const root = process.argv[2] ?? '.'
  const probe = probeOf(['--probe-collision', '--probe-cancelled', '--probe-other-selector'])

  if (probe !== undefined) {
    const fixtures = {
      '--probe-collision': { css: '.a { block-size: 24px; flex-wrap: wrap; }', want: 1 },
      '--probe-cancelled': { css: '.a { block-size: 24px; flex-wrap: wrap; }\n.a { block-size: auto; }', want: 0 },
      '--probe-other-selector': { css: '.a { block-size: 24px; }\n.b { flex-wrap: wrap; }', want: 1 - 1 },
    }
    const one = fixtures[probe]
    const got = collisionsIn(one.css).length
    if (got === one.want) {
      console.log(`OK 自测（${probe}）：读到 ${String(got)} 处，与预期一致（门禁是活的）。`)
      return
    }
    console.error(`verify-fixed-height-wrap self-test FAILED（${probe}）：读到 ${String(got)} 处，应为 ${String(one.want)}`)
    process.exit(1)
  }

  if (!existsSync(root)) {
    console.error('verify-fixed-height-wrap: 根目录给错了？')
    process.exit(1)
  }

  const findings = fixedHeightWrapFindings(root)
  if (findings.length === 0) {
    console.log('verify-fixed-height-wrap OK: 没有哪个定高的盒子同时允许内容换行。')
    return
  }
  console.error(`FAIL ${String(findings.length)} 处「定高 + 可换行」——内容折行时会画到盒子外面：`)
  for (const one of findings) {
    console.error(`  ${one.file}:${String(one.line)}  ${one.selector}`)
    console.error(`    block-size: ${String(one.height)} 与 flex-wrap: wrap 同时成立：行数不定而高度定死，`)
    console.error('    多出来的行只能溢出。要么把高改成 auto，要么别让它换行。')
  }
  process.exit(1)
}

main()
