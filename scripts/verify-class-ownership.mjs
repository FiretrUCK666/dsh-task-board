#!/usr/bin/env node
/**
 * **一个类名只能属于一张表。**
 *
 * ── 为什么要有这条 ──────────────────────────────────────────────────────────
 *
 * 这个项目的样式按表编译，**每张表有自己的类名哈希**。所以：
 *
 *   · `design/base.module.css` 里定义的 `.chipBody`，在 `item/item.module.css` 里
 *     **写不出来**——那张表编译自己的那份字面名，生产包里那个选择器匹配不到任何东西，
 *     **静默失效**。
 *   · 于是两个表面要同一种形态，只有两条路：共用一张表里的那个类，或者**各自写一遍**。
 *
 * 第二条路是绝大多数「屎山」的起点：
 *
 *   1. 某天清单页要用一种「药丸底 + 圆角 + 12/600」，于是有人在
 *      `item/item.module.css` 里**抄了一份** `design/base.module.css` 的那几行。
 *   2. 抄的时候改了一个数（比如内衬从 10px 写成 12px），所以**声明体不再相同**——
 *      而 `verify-design-docs` 的 `duplicateBodies` 判的是**声明体相同**，于是它没报。
 *   3. 从此两份各改各的：改设计系统那份，清单页那份不动；改清单页那份，看板上还是旧的。
 *      **屏幕上没有任何一处会说明为什么。**
 *
 * 第 2 步是关键：**改了一个数的抄法，躲过了按声明体判重的门禁**。这条门禁判的是
 * **类名的归属**，不是声明体的相同——同一个类名出现在两张表里，就是两份所有权，
 * 不管它们写得像不像。
 *
 * ── 它守的是什么 ────────────────────────────────────────────────────────────
 *
 * **一个类名有且只有一张表拥有它。** 抄一份（哪怕改了一个数）必须先把原的那个搬进
 * 共享表（`design/base.module.css` 或 `design/components.module.css`），两边都从那里引。
 *
 * 这与 `design/` 的准入判据是同一件事的两头：
 *   · `design-coverage.spec.ts` 守的是**组件**（tsx）两个面板都渲染的必须在 `design/`；
 *   · 本条守的是**形态类**（css）同一段形态不许有两份所有权。
 *
 * ── 为什么不是「按声明体判重」 ──────────────────────────────────────────────
 *
 * 已经有那条了（`verify-design-docs` 的 `duplicateBodies`），它按**声明体相同**判。
 * 它漏掉的正是上面第 2 步那种「抄了改了一个数」——所以两条门禁并存，不是重复。
 *
 * ── 豁免 ────────────────────────────────────────────────────────────────────
 *
 * 有些类名天生通用，出现在多张表里不是「抄」：
 *   · **元素选择器与伪类**（`.chip`、`.row`、`.active`）——它们各自是本表的东西，
 *     只是名字撞了。撞名本身不是所有权冲突。
 *   · **状态修饰类**（`.is-open`）——加在别人的类上，不定义形态。
 *
 * 所以豁免表按**「这一族名字」**记，而不是逐个类名记：一次记一族，以后这一族新增
 * 一个成员自动在豁免里，不必回来改表。
 *
 * 用法：`node scripts/verify-class-ownership.mjs [根目录]`
 * 自测：`--probe-crosssheet`（同一类名在两张表里，必须红）
 *       `--probe-samesheet`（同一张表里两次，必须放行）
 *       `--probe-excused`（豁免族里的名字在两张表里，必须放行）
 *       `--probe-different`（两张表各自不同的类名，必须放行）
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { rulesOf } from './css-core.mjs'
import { clientSheetFiles } from './sheet-files.mjs'
import { probeOf } from './probe-args.mjs'

/**
 * 豁免：这些名字在多张表里出现不算「两份所有权」。
 *
 * 记的是**族**（前缀），不是逐个类名——这样这一族以后新增成员不用回来改表。
 * @type {readonly { prefix: string, why: string }[]}
 */
export const EXCUSED = [
  {
    prefix: 'is-',
    why: '状态修饰类：加在别人的类上，自己不定义形态（`.is-open` 之于任何元素）。'
      + '它们天生住在每张表里，不构成两份所有权。',
  },
  {
    prefix: 'has-',
    why: '状态修饰类，同 `is-`：加在祖先上，自己不定义形态。',
  },
  {
    prefix: 'js-',
    why: '行为标记类：由脚本加上去，不定义形态。',
  },
]

/**
 * 这个类名是否在豁免族里。
 * @param {string} name - 类名（不含点）。
 * @returns {boolean}
 */
export function isExcused(name) {
  return EXCUSED.some((one) => name.startsWith(one.prefix))
}

/**
 * 收集每张表**定义**了哪些类。
 *
 * 「定义」= 出现在某条规则的选择器里。引用别的表的类不算——那正是本项目推荐的用法
 * （`import base from '../design/base.module.css'` 然后 `className={base.chipBody}`），
 * 而**引用不产生选择器**，所以不会出现在任何表的选择器里。
 * @param {string} css - 一张表的全文。
 * @returns {string[]} 类名（不含点）。
 */
export function definedClassesOf(css) {
  const out = new Set()
  for (const rule of rulesOf(css)) {
    /* 文件名误匹配要滤掉：`.module.css` 出现在选择器里只可能是一段路径被当成了选择器
       （本仓库的注释里有 `*.module.css` 这样的写法）。 */
    if (/[\w-]+\.(module|css|tsx|ts|md|spec|json)\b/.test(rule.selector)) continue
    for (const m of rule.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
      const name = m[1]
      if (name === undefined || name === '') continue
      out.add(name)
    }
  }
  return [...out]
}

/**
 * 找出被一张以上表定义的类。
 * @param {readonly { rel: string, css: string }[]} sheets - 每张表的全文。
 * @returns {{ name: string, sheets: string[] }[]} 按类名排序。
 */
export function duplicateOwners(sheets) {
  /** @type {Map<string, string[]>} */
  const owners = new Map()
  for (const sheet of sheets) {
    for (const name of definedClassesOf(sheet.css)) {
      const list = owners.get(name) ?? []
      if (!list.includes(sheet.rel)) list.push(sheet.rel)
      owners.set(name, list)
    }
  }
  const out = []
  for (const [name, list] of owners) {
    if (list.length <= 1) continue
    if (isExcused(name)) continue
    out.push({ name, sheets: list.sort() })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function main() {
  const root = process.argv[2] ?? '.'
  const probe = probeOf(['--probe-crosssheet', '--probe-samesheet', '--probe-excused', '--probe-different'])

  if (probe !== undefined) {
    const A = { rel: 'a.module.css', css: '.x { display: flex; }\n.y { color: red; }' }
    const B = { rel: 'b.module.css', css: '.x { display: flex; }\n.z { color: blue; }' }
    const cases = {
      /* 同一个类名在两张表里 —— 哪怕两份写得一模一样，也是两份所有权。 */
      '--probe-crosssheet': { sheets: [A, B], want: 1 },
      /* 同一张表里两次提到同一个类名 —— 那是一张表自己的东西。 */
      '--probe-samesheet': { sheets: [{ rel: 'a.module.css', css: '.x { display: flex; }\n.x { color: red; }' }], want: 0 },
      /* 豁免族里的名字撞名不算。 */
      '--probe-excused': {
        sheets: [
          { rel: 'a.module.css', css: '.is-open { display: flex; }' },
          { rel: 'b.module.css', css: '.is-open { color: red; }' },
        ],
        want: 0,
      },
      /* 两张表各自不同的类名 —— 正常情况。 */
      '--probe-different': {
        sheets: [
          { rel: 'a.module.css', css: '.x { display: flex; }' },
          { rel: 'b.module.css', css: '.z { color: blue; }' },
        ],
        want: 0,
      },
    }
    const one = cases[probe]
    const got = duplicateOwners(one.sheets).length
    if (got === one.want) {
      console.log(`OK 自测（${probe}）：读到 ${String(got)} 处，与预期一致（门禁是活的）。`)
      return
    }
    console.error(`verify-class-ownership self-test FAILED（${probe}）：读到 ${String(got)} 处，应为 ${String(one.want)}`)
    process.exit(1)
  }

  if (!existsSync(root)) {
    console.error('verify-class-ownership: 根目录给错了？')
    process.exit(1)
  }

  const sheets = clientSheetFiles(root)
  const dupes = duplicateOwners(sheets)
  if (dupes.length === 0) {
    console.log(`verify-class-ownership OK: ${String(sheets.length)} 张表，${String(dupes.length)} 个类有两份所有权——每个类只有一张表拥有它。`)
    return
  }
  console.error(`FAIL ${String(dupes.length)} 个类名被不止一张表定义——同一段形态有了两份所有权：`)
  for (const one of dupes) {
    console.error(`  .${one.name}  ←  ${one.sheets.join('  +  ')}`)
  }
  console.error('')
  console.error('  两个表面要同一种形态时，只有两条路：共用一张表里的那个类，')
  console.error('  或者把原定义搬进 design/ 的共享表、两边都从那里引。')
  console.error('  抄一份（哪怕只改了一个数）就是两份所有权——改一处，另一处不会跟着改，')
  console.error('  而屏幕上没有任何一处会说明为什么。')
  process.exit(1)
}

main()
