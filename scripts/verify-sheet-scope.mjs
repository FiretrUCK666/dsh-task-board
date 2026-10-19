#!/usr/bin/env node
/**
 * 一张表的选择器**只能命名它自己声明的类**。
 *
 * ── 这条门禁守的是什么 ──────────────────────────────────────────────────────
 *
 * 构建给每张 `*.module.css` 按**文件名**算一个哈希前缀（`[hash]_[local]`）。所以
 * 表 A 里写下 `.chip` 时，它指的是 `A_hash_chip`；而 `.chip` 真正声明在表 B 里，
 * 渲染时元素带的是 `B_hash_chip`。两个字符串**永不相同**，这条选择器匹配不到任何
 * 节点——它不报错、不抛异常、样式表合法，只是**什么都不做**。
 *
 * 这个仓库里已经栽过三次：
 *
 *   board.module.css  `.thumbRail > .thumbPrimary`   缩放布局里「主按钮吃满宽度」
 *                                                           从来没生效过
 *   board.module.css  `.waitingNotice .chip`           芯片的 `flex: none` 从来没生效过
 *   board.module.css  `.sessionRowLeading .sessionRowName`
 *                                                           标题被自动排进 12px 的 icon 列
 *
 * 三次都是「有一半是本表的类，所以看起来像对的」——**复合选择器只要有一个类名
 * 属于别的表，整条就不成立**。而人眼看不出这件事：屏上只是「那里没生效」，没有
 * 任何地方说得出为什么。
 *
 * ── 为什么它现在才存在 ──────────────────────────────────────────────────────
 *
 * 因为拆表会让这个风险**从个例变成批量**：把一张 7000 行的表按域拆成九张之后，
 * 任何一条跨域的 `:is(.a, .b, .c)` 都会当场失效。所以这条门禁必须在拆表**之前**
 * 建好——它是那次拆分的许可证，不是事后检查。
 *
 * ── 判据为什么是「本表声明的类」而不是「所有表声明的类」 ────────────────────
 *
 * 一个类名如果**两张表都声明**（共享类），那么它在两边各自解析正确，是合法的。
 * 只有「本表没声明、别的表声明了」才只可能指向另一张表——那才是死的。
 *
 * 用法：`node scripts/verify-sheet-scope.mjs [根目录]`
 * 自测：`--probe-crosssheet`（种一个跨表选择器，必须报红）
 *       `--probe-own`（全在本表内，必须放行）
 */

import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { classNamesIn, declaredClassesOf, rulesOf } from './css-core.mjs'
import { clientSheetFiles } from './sheet-files.mjs'
import { probeOf } from './probe-args.mjs'

/**
 * 找出所有「命中了别的表独有的类」的选择器。
 *
 * @param root - 仓库根。
 * @returns `{ file, line, selector, at, foreign }[]`，`foreign` 是那些类名。
 */
export function crossSheetFindings(root) {
  const sheets = clientSheetFiles(root)
  const declared = new Map()
  for (const sheet of sheets) declared.set(sheet.rel, declaredClassesOf(sheet.css))

  /* 「在几张表里被声明」——只有恰好一张表声明的类，才可能被判成跨表。两张都有的
     共享类在两边都正确解析，不算缺陷。 */
  const owners = new Map()
  for (const [rel, names] of declared) {
    for (const name of names) {
      const list = owners.get(name) ?? []
      list.push(rel)
      owners.set(name, list)
    }
  }

  const findings = []
  for (const sheet of sheets) {
    const mine = declared.get(sheet.rel)
    for (const rule of rulesOf(sheet.css)) {
      const foreign = classNamesIn(rule.selector).filter((name) => {
        if (mine.has(name)) return false
        const declaredIn = owners.get(name)
        return declaredIn !== undefined && declaredIn.length > 0
      })
      if (foreign.length === 0) continue
      findings.push({
        file: sheet.rel,
        line: rule.line,
        selector: rule.selector.replace(/\s+/g, ' ').trim(),
        at: rule.at,
        foreign: [...new Set(foreign)],
      })
    }
  }
  return findings
}

/**
 * 自测用的最小现场：造几张表，看判据咬不咬。
 * @param probe - `--probe-crosssheet` 或 `--probe-own`。
 * @returns 判定结果，供调用方断言。
 */
export function selfTest(probe) {
  /* 两张表，四个类。第二张表**必须真的声明**那些被用来测跨表的类名——否则判据会
     把它们当成「哪里都没声明」而过滤掉，探针于是假红（第一版就是这么错的：拿
     `.chip` / `.waitingNotice` 去测，而 fixture 里根本没声明它们）。 */
  const sheets = [
    { rel: 'a.module.css', css: '.mine { color: red }\n.shared { color: blue }\n.mine:hover { color: green }' },
    { rel: 'b.module.css', css: '.theirs { color: red }\n.shared { color: blue }\n.chip { flex: none }\n.waitingNotice { display: flex }' },
  ]
  const declaredOf = (css) => declaredClassesOf(css)
  const declared = new Map(sheets.map((s) => [s.rel, declaredOf(s.css)]))
  const owners = new Map()
  for (const [rel, names] of declared) {
    for (const name of names) owners.set(name, [...(owners.get(name) ?? []), rel])
  }
  const judge = (rel, selector) => {
    const mine = declared.get(rel)
    return classNamesIn(selector).filter((name) => {
      if (mine.has(name)) return false
      const d = owners.get(name)
      return d !== undefined && d.length > 0
    })
  }
  if (probe === '--probe-crosssheet') {
    /* 三条都必须被认出来：纯跨表、后代、`:is()` 混装。 */
    return {
      pure: judge('a.module.css', '.theirs'),
      descendant: judge('a.module.css', '.waitingNotice .chip'),
      mixedIs: judge('a.module.css', ':is(.mine, .theirs)'),
    }
  }
  /* 四条都必须放行：本表的、共享的、带状态的、本表的后代。 */
  return {
    own: judge('a.module.css', '.mine'),
    shared: judge('a.module.css', '.shared'),
    state: judge('a.module.css', '.mine:hover'),
    ownDescendant: judge('a.module.css', '.mine .mine'),
  }
}

function main() {
  const root = process.argv[2] ?? '.'
  const probe = probeOf(['--probe-crosssheet', '--probe-own'])

  if (probe !== undefined) {
    const heard = selfTest(probe)
    const wrong = []
    if (probe === '--probe-crosssheet') {
      if (heard.pure.length === 0) wrong.push('纯跨表选择器没被认出')
      if (heard.descendant.length === 0) wrong.push('后代选择器里的跨表类没被认出')
      if (heard.mixedIs.length === 0) wrong.push('`:is()` 里混装的跨表类没被认出')
    } else {
      if (heard.own.length > 0) wrong.push(`本表的类被误报：${heard.own.join(', ')}`)
      if (heard.shared.length > 0) wrong.push(`两张表都声明的共享类被误报：${heard.shared.join(', ')}`)
      if (heard.state.length > 0) wrong.push(`带伪类的本表类被误报：${heard.state.join(', ')}`)
      if (heard.ownDescendant.length > 0) wrong.push(`本表内的后代选择器被误报：${heard.ownDescendant.join(', ')}`)
    }
    if (wrong.length > 0) {
      for (const line of wrong) console.error(`  - ${line}`)
      console.error('verify-sheet-scope self-test FAILED: the reader does not bite correctly')
      process.exit(1)
    }
    console.log(probe === '--probe-crosssheet'
      ? 'OK 自测：纯跨表、后代、`:is()` 混装三种形状都被认出（门禁是活的）。'
      : 'OK 自测：本表、共享类、伪类、本表后代四种都放行（不误伤）。')
    return
  }

  if (!existsSync(join(root, 'src', 'client'))) {
    console.error('verify-sheet-scope: 找不到 src/client —— 根目录给错了？')
    process.exit(1)
  }

  const findings = crossSheetFindings(root)
  if (findings.length === 0) {
    console.log('verify-sheet-scope OK: 每张表的选择器都只命名它自己声明的类（跨表即死，一处都没有）。')
    return
  }
  console.error(`FAIL ${findings.length} 条选择器命中了别的表独有的类——按表哈希之后它们匹配不到任何节点：`)
  for (const f of findings) {
    const where = f.at === '' ? '' : `（在 ${f.at} 里）`
    console.error(`  ${f.file}:${f.line}${where}`)
    console.error(`    ${f.selector}`)
    console.error(`    只声明在别的表里：${f.foreign.join(', ')}`)
    console.error('    改法：把它归位到声明它的那张表；真跨域的写成多条规则，或把那几个类做成共享类。')
  }
  process.exit(1)
}

main()
