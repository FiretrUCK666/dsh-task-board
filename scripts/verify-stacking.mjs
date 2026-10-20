#!/usr/bin/env node
/**
 * **层叠只有一张表。**
 *
 * ── 它守的是哪一件事 ─────────────────────────────────────────────────────
 *
 * 界面元素互相盖住时，谁在上面由 `z-index` 决定。这个数散在两张表里各写一套：
 * 清单页 3/4/5，看板与共享层 12/30/40。两套互不相干。
 *
 * 于是真的出过一次：**底部的拇指栏（12）压过了新建弹层的遮罩（5）**。弹层其实
 * 开了、数据也进去了，但一条浮在栏上的按钮盖住了弹层和它的背景——读者眼前看到的
 * 是「点了没反应，什么都新建不了」，而那看起来完全像一个逻辑 bug。
 *
 * 根因不是某个数字挑错了，是**项目里没有一张层叠表**：每个新浮层都在自己那张表里
 * 挑一个「比旁边几个大」的数，而它没看见的第三张表里有个更大的。
 *
 * ── 判据 ────────────────────────────────────────────────────────────────
 *
 *   A. **任何 `z-index` 都不许写裸数字**，必须读 `--dsh-tb-layer-*`；
 *   B. 那五档的名称与顺序由本文件钉住，令牌层少一档即红。
 *
 * 不检查「某个具体元素该在哪一档」——那需要知道设计意图，机器读不出来。它守的是
 * **数字不再散落**，而这件事恰好是那个 bug 的唯一成因。
 *
 * 用法：`node scripts/verify-stacking.mjs [根目录]`
 * 自测：`--probe-bare`（种一个裸数字，必须报红）
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { rulesOf } from './css-core.mjs'
import { probeOf } from './probe-args.mjs'

/** 五档的名称，**按从下到上的顺序**。令牌层必须正好声明这些、且严格递增。 */
export const LAYERS = ['content', 'menu', 'rail', 'overlay', 'modal']

/** 令牌文件（相对仓库根）。 */
const TOKEN_SHEET = 'src/client/design/tokens.module.css'

/**
 * 一张表里所有 `z-index` 声明。
 * @param rel - 相对路径（报错用）。
 * @param css - 源文本。
 * @returns {{ rel: string, line: number, selector: string, value: string }[]}
 */
export function stackingsIn(rel, css) {
  const out = []
  for (const rule of rulesOf(css)) {
    const m = /z-index:\s*([^;]+)/.exec(rule.body)
    if (m === null) continue
    out.push({
      rel,
      line: css.slice(0, rule.offset).split('\n').length,
      selector: rule.selector,
      value: m[1].trim(),
    })
  }
  return out
}

/**
 * 走遍每张样式表。
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
 * 从令牌表里读那五档的值。
 * @param css - 令牌表文本。
 * @returns {Map<string, number>} 名称到数值。
 */
export function layerValuesOf(css) {
  const out = new Map()
  /* 逐行判定，不用跨行正则。
   *
   * 跨行正则会踩两个坑：`1;` 后面那一段被同一段匹配吃进来（名字里混进上一行的值），
   * 以及注释里举的例子（`--dsh-tb-layer-menu` 那种行内引用）被当成一次声明。
   * **声明行的形状是确定的**：整行 `--dsh-tb-layer-<name>: <number>;`，别的一律不算。
   * 所以先剥注释（`rulesOf` 不做这件事，这里自己按行判），再逐行比对。 */
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const line of withoutComments.split('\n')) {
    const m = /^\s*--dsh-tb-layer-([a-z]+):\s*(\d+)\s*;\s*$/.exec(line)
    if (m === null) continue
    out.set(m[1], Number(m[2]))
  }
  return out
}

function main() {
  const probe = probeOf(['--probe-bare'])
  const root = process.argv[2] ?? '.'

  if (probe === '--probe-bare') {
    const planted = stackingsIn('src/client/x.module.css', '.thing {\n  position: relative;\n  z-index: 5;\n}')
    if (planted.length === 0 || /var\(/.test(planted[0].value)) {
      console.error('FAIL 自测：种了一个裸数字，判据没认出来。')
      process.exit(1)
    }
    const good = stackingsIn('src/client/y.module.css', '.thing {\n  z-index: var(--dsh-tb-layer-menu);\n}')
    if (good.length !== 1 || !/var\(--dsh-tb-layer-menu\)/.test(good[0].value)) {
      console.error('FAIL 自测：合法的令牌写法被误判了。')
      process.exit(1)
    }
    console.log('OK 自测：裸数字被认出来，令牌写法放行。')
    return
  }

  const tokens = readFileSync(join(root, TOKEN_SHEET), 'utf8')
  const values = layerValuesOf(tokens)
  const problems = []

  /* B：五档齐全且严格递增。 */
  let previous = 0
  for (const name of LAYERS) {
    const value = values.get(name)
    if (value === undefined) {
      problems.push(`令牌层缺了 --dsh-tb-layer-${name}`)
      continue
    }
    if (value <= previous) {
      problems.push(`--dsh-tb-layer-${name}（${String(value)}）不大于它下面那一档（${String(previous)}）——层叠表必须严格递增`)
    }
    previous = value
  }
  for (const name of values.keys()) {
    if (!LAYERS.includes(name)) {
      problems.push(`令牌层多了一档 --dsh-tb-layer-${name}：层叠表是这五档，加一档要同时改门禁与法则`)
    }
  }

  /* A：全仓不许有裸数字。 */
  const all = sheetsOf(root).flatMap((abs) => {
    const rel = abs.split(/[\\/]/).slice(-4).join('/').replace(/^.*?(src\/)/, '$1')
    return stackingsIn(rel, readFileSync(abs, 'utf8'))
  })
  for (const one of all) {
    if (!/var\(--dsh-tb-layer-/.test(one.value)) {
      problems.push(
        `${one.rel}:${String(one.line)}  ${one.selector.trim().split('\n')[0]} —— z-index 写了裸数字 ${one.value}，` +
          '层叠只有一张表（--dsh-tb-layer-*）',
      )
    }
  }

  if (problems.length === 0) {
    console.log(
      `verify-stacking OK: ${String(all.length)} 处 z-index 全部读 --dsh-tb-layer-*，` +
        `五档 ${LAYERS.join(' < ')} 严格递增。`,
    )
    return
  }
  console.error(`FAIL ${String(problems.length)} 处层叠不符合「一张表」：`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}

main()
