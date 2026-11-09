#!/usr/bin/env node
/**
 * **间距里还有多少处写的是裸数字** —— 一个可观测的数，不是一句形容。
 *
 * ── 它为什么存在 ────────────────────────────────────────────────────────────
 *
 * `DESIGN.md` 的欠账表里有一条「字面量字号还没全迁到 `--dsh-tb-type-*`」，它的解除
 * 条件指向 `scripts/report-type-literals.mjs`。**间距是同一个病，却没有那个观测量**：
 * 阶梯（`--dsh-tb-space-1..9` = 2/4/6/8/10/12/16/22/32）早就声明好了，但「还有多少条
 * 声明没读它」没有任何命令答得出来。一条没有观测量的欠账，按本项目自己的说法
 * 「不是欠账，是托词」。
 *
 * 所以这里补上那个数。它照 `report-type-literals.mjs` 的形状：按表列，末行合计。
 *
 * ── 它不是什么 ──────────────────────────────────────────────────────────────
 *
 * **它不判红。** 一个落在阶梯上的裸数字并不违规——量出来的对齐值（行轨、按钮高、
 * 命中环）本来就该各自成令牌，而「这一格是 2 还是 4」是设计决定，不是错误。这条只把
 * 「还剩多少」量出来，让欠账可以被观测，而不是假装已经还清。
 *
 * 用法：`node scripts/report-spacing.mjs [根目录]`
 *
 * @module dsh-task-board/scripts/report-spacing
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** 阶梯上允许的那九档（与 `tokens.module.css` 的 `--dsh-tb-space-1..9` 同一组数）。 */
export const LADDER = [2, 4, 6, 8, 10, 12, 16, 22, 32]

/** 参与统计的间距类属性：它们说的都是「一处与另一处之间有多远」。 */
const SPACING = /^(?:gap|row-gap|column-gap|padding(?:-(?:block|inline))?(?:-(?:start|end|top|right|bottom|left))?|margin(?:-(?:block|inline))?(?:-(?:start|end|top|right|bottom|left))?|inset(?:-(?:block|inline))?(?:-(?:start|end|top|right|bottom|left))?)$/

/** 客户端半区全部 `*.module.css`，按路径排序。 */
function sheets(root) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.module.css')) found.push(full)
    }
  }
  walk(join(root, 'src', 'client'))
  return found.sort()
}

/** 注释剥掉（注释里写 `padding: 8px` 不是一次声明——硬性规范 14）。 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 每一张表的间距统计。
 *
 * `onLadder` 与 `offLadder` 是**互斥的两档**：一条声明里的每个非零 px 都落在阶梯上，
 * 它才算 onLadder；只要有一个阶梯外的数，整条进 offLadder。于是
 * `onLadder + offLadder = bare`，三个数自洽。
 * @param root - 仓库根。
 * @returns `{ rel, tokenReads, bare, onLadder, offLadder }` 数组。
 */
export function countSpacing(root) {
  const out = []
  for (const path of sheets(root)) {
    const code = stripComments(readFileSync(path, 'utf8'))
    let tokenReads = 0
    let bare = 0
    let onLadder = 0
    let offLadder = 0
    for (const line of code.split(/\r?\n/)) {
      const m = line.match(/^\s*([a-z-]+)\s*:\s*([^;]+);/)
      if (m === null || !SPACING.test(m[1])) continue
      const value = m[2]
      if (/var\(/.test(value)) { tokenReads += 1; continue }
      const px = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)]
        .map((one) => Number.parseFloat(one[1]))
        .filter((n) => n !== 0)
      if (px.length === 0) continue
      bare += 1
      if (px.every((n) => LADDER.includes(n))) onLadder += 1
      else offLadder += 1
    }
    out.push({ rel: relative(root, path).split('\\').join('/'), tokenReads, bare, onLadder, offLadder })
  }
  return out
}

function main() {
  const root = resolve(process.argv[2] ?? '.')
  const rows = countSpacing(root)
  if (rows.length === 0) {
    console.error('report-spacing: 没找到任何样式表——根目录给错了？')
    process.exit(1)
  }
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0)

  for (const row of rows) {
    if (row.tokenReads === 0 && row.bare === 0) continue
    console.log(`  ${row.rel.padEnd(46)} 读令牌 ${String(row.tokenReads).padStart(4)}   裸数字 ${String(row.bare).padStart(4)}   （其中全在阶梯上 ${String(row.onLadder).padStart(3)}）`)
  }
  console.log('')
  console.log(`读令牌合计 ${String(sum('tokenReads'))} 处；裸数字合计 ${String(sum('bare'))} 处，其中 ${String(sum('onLadder'))} 处的每个值都落在阶梯上、${String(sum('offLadder'))} 处含阶梯外的数。`)
  console.log(`阶梯是 ${LADDER.join(' / ')}px（\`--dsh-tb-space-1..9\`）。`)
  console.log('（这不判红：落在阶梯上的裸数字并不违规。这张表是那条欠账的解除条件的观测量。）')
}

main()
