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
   * 分工仍然按 at-rule 隔开：宽档的定高与窄档的换行永远不同时生效，不算冲突。 */
  const heights = new Map()
  const wraps = new Map()
  const lineOf = new Map()
  for (const rule of rulesOf(css)) {
    const scope = rule.at
    const classes = [...new Set([...rule.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))]
    if (classes.length === 0) continue
    const height = declOf(rule.body, 'block-size') ?? declOf(rule.body, 'height')
    if (height !== undefined) {
      for (const cls of classes) {
        const key = `${scope}\u0000${cls}`
        /* 后写的 `auto` 是一次**撤销**，不是"没有定高"。 */
        if (isFixedHeight(height)) {
          heights.set(key, height.trim())
          lineOf.set(key, rule.line)
        } else {
          heights.delete(key)
        }
      }
    }
    const wrap = declOf(rule.body, 'flex-wrap')
    if (wrap !== undefined) {
      for (const cls of classes) {
        const key = `${scope}\u0000${cls}`
        if (wrap.trim() === 'wrap' || wrap.trim() === 'wrap-reverse') {
          wraps.set(key, true)
          if (!lineOf.has(key)) lineOf.set(key, rule.line)
        } else {
          wraps.delete(key)
        }
      }
    }
  }
  const out = []
  /* **只报「此刻同时成立」的那一种。** 一个被 `auto` 撤销过的定高不是缺陷——那正是
     修法。第一版把「撤销过」也当成可疑报了出来，于是修好之后门禁反而红，那会把下一个人
     推向删掉那行 `auto`（缺陷回来）或者关掉门禁。
     撤销行本身受另一层保护：`verify-design-docs` 的类漂移扫描会看见它有没有读者，
     而 `tests/` 里有一条渲染断言（日程页窄档的安静行不许溢出）。 */
  for (const [key, height] of heights) {
    if (wraps.get(key) !== true) continue
    const cls = key.split('\u0000')[1]
    out.push({
      selector: `.${String(cls)}`,
      height,
      line: lineOf.get(key) ?? 0,
    })
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
      findings.push({ file: sheet.rel, line: one.line, selector: one.selector, height: one.fixedHeight })
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
