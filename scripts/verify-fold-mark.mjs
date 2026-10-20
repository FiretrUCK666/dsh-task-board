#!/usr/bin/env node
/**
 * **折叠记号的旋转只有一个家。**
 *
 * ── 它守的是哪一件事 ─────────────────────────────────────────────────────
 *
 * 一枚「可以展开」的箭头，收着朝右、开着朝下。这句话看起来只有两行，于是它被抄过
 * **四份**，每一份都绑死一个容器类：
 *
 *   `.detailDisclosure[aria-expanded] .detailChevron`
 *   `.notifyMain[aria-expanded] .notifyChevron`
 *   `.autoTaskExpand[aria-expanded] .autoTaskChevron`
 *   `.sessionContextHead[aria-expanded] .sessionContextChevron`
 *
 * 抄一份的代价在某一次真的兑现了：`TaskBoard` 的折叠把 `aria-expanded` 挪到了**兄弟
 * 按钮**上（`feedAction`），而那条规则要求它在 `.notifyMain` 上——于是箭头永远朝下、
 * 怎么点都不转，而它下面那块内容是真的在开合。**读者被一枚记号骗了**，而屏上唯一的
 * 线索是「点了没反应」。
 *
 * 治法是共享的 `.foldMark`：判据只认「祖先里有 `aria-expanded`」，不绑任何类名或
 * DOM 结构。于是这条门禁要守两件事：
 *
 *   A. 旋转语法（`rotate(-90deg)` / `rotate(90deg)`）只许出现在**共享层**的那一条
 *      规则里，且它的选择器里只许有 `[aria-expanded]` 与 `.foldMark` 两个部件；
 *   B. 全仓不许再出现第二个「绑定容器类的折叠旋转」。
 *
 * ── 为什么读结构而不读字样 ────────────────────────────────────────────────
 *
 * 判据读的是**声明**（这条规则里有没有 `rotate`）与**选择器的部件**（它挂了几个类名
 * 才够到那个记号），不是「文件里有没有出现过某个字符串」。注释里提到 `.foldMark`
 * 不是一次使用——所以扫描先剥注释（`css-core.mjs` 的 `rulesOf` 已经做了）。
 *
 * 用法：`node scripts/verify-fold-mark.mjs [根目录]`
 * 自测：`--probe-copy`（种一条手抄旋转，必须报红）
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { rulesOf } from './css-core.mjs'
import { probeOf } from './probe-args.mjs'

/** 共享层：折叠记号的唯一家。 */
export const SHARED_LAYER = 'src/client/design/'

/** 那个家的选择器里只许有这两个部件。 */
export const HOME_SELECTOR_PARTS = ["[aria-expanded='true']", "[aria-expanded='false']", '.foldMark']

/**
 * 一张表里所有「旋转 90 度」的规则。
 * @param rel - 相对路径（报错用）。
 * @param css - 源文本。
 * @returns {{ rel: string, line: number, selector: string }[]}
 */
export function rotationsIn(rel, css) {
  const out = []
  for (const rule of rulesOf(css)) {
    if (!/rotate\(\s*-?90deg\s*\)/.test(rule.body)) continue
    out.push({
      rel,
      line: css.slice(0, rule.offset).split('\n').length,
      selector: rule.selector,
    })
  }
  return out
}

/**
 * 走过 `<root>/src/client` 下每张样式表。
 * @param root - 仓库根。
 * @returns {string[]} 绝对路径。
 */
function sheetsOf(root) {
  const base = join(root, 'src', 'client')
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith('.module.css')) found.push(p)
    }
  }
  walk(base)
  return found.sort()
}

/**
 * 一个选择器够到 `.foldMark` 用了几个**类名**部件。
 *
 * 判据：只许 `[aria-expanded]` 这种属性选择器出现在前面；出现任何 `.某类` 前缀，
 * 就意味着这条旋转又绑死在某个具体结构上了。
 * @param selector - 规则选择器。
 * @returns {string[]} 多余的类名前缀（空数组 = 合格）。
 */
export function strayClassPrefixes(selector) {
  const head = selector.split('.foldMark')[0] ?? ''
  return [...head.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1])
}

function main() {
  const probe = probeOf(['--probe-copy'])
  const root = process.argv[2] ?? '.'

  if (probe === '--probe-copy') {
    /* 自测：种一条手抄旋转，判据必须认出它。 */
    const planted = [
      { rel: 'src/client/board.module.css', css: `.notifyMain[aria-expanded='false'] .notifyChevron {\n  transform: rotate(-90deg);\n}` },
      { rel: 'src/client/design/components.module.css', css: `.foldMark {\n  transition: transform var(--dsh-tb-motion-fast);\n}\n\n[aria-expanded='false'] .foldMark {\n  transform: rotate(-90deg);\n}` },
    ]
    const found = planted.flatMap((sheet) => rotationsIn(sheet.rel, sheet.css))
    const copies = found.filter((one) => !one.rel.startsWith(SHARED_LAYER))
    if (copies.length === 0) {
      console.error('FAIL 自测：种了一条手抄旋转，判据没认出来。')
      process.exit(1)
    }
    const stray = found
      .filter((one) => one.rel.startsWith(SHARED_LAYER))
      .flatMap((one) => strayClassPrefixes(one.selector))
    if (stray.length !== 0) {
      console.error('FAIL 自测：共享层那条合格的选择器被误判了：' + stray.join(', '))
      process.exit(1)
    }
    console.log(`OK 自测：手抄的旋转被认出来 ${String(copies.length)} 条，共享层那条放行。`)
    return
  }

  const all = sheetsOf(root).flatMap((abs) => {
    const rel = abs.split(/[\\/]/).slice(-4).join('/').replace(/^.*?(src\/)/, '$1')
    return rotationsIn(rel, readFileSync(abs, 'utf8'))
  })

  const copies = all.filter((one) => !one.rel.startsWith(SHARED_LAYER))
  const home = all.filter((one) => one.rel.startsWith(SHARED_LAYER))

  const problems = []
  for (const one of copies) {
    problems.push(`${one.rel}:${String(one.line)}  ${one.selector.trim()} —— 折叠旋转抄了一份，共享层有那个家（.foldMark）`)
  }
  for (const one of home) {
    const stray = strayClassPrefixes(one.selector)
    if (stray.length !== 0) {
      problems.push(`${one.rel}:${String(one.line)}  ${one.selector.trim()} —— 共享层那条判据绑了类名（${stray.join(', ')}），换一个结构就不转`)
    }
  }

  if (problems.length === 0) {
    console.log(
      `verify-fold-mark OK: ${String(all.length)} 条折叠旋转，全部住在共享层，` +
        '判据只认 aria-expanded（不绑任何类名或结构）。',
    )
    return
  }
  console.error(`FAIL ${String(problems.length)} 处折叠旋转不符合「只有一个家」：`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}

main()
