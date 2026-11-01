#!/usr/bin/env node
/**
 * **字面量 `font-size` 还剩多少处** —— 一个可观测的数，不是一句形容。
 *
 * ── 它为什么存在 ────────────────────────────────────────────────────────────
 *
 * `DESIGN.md` 的欠账表里有一条「字面量字号还没全部迁到 `--dsh-tb-type-*`」，
 * 它的解除条件是「降到 0」。而那条欠账原先写的解除条件是
 * 「`tests/card-contract.spec.ts` 报出的字面量计数降到 0」——
 *
 * **那句从机制上不可能达成**：那条 spec 根本不输出「字面量计数」，它只断言
 * 「越档的项为空」并 `toEqual([])`。而越档项今天已经是 0，spec 早就是绿的。
 * 于是那条欠账的解除条件既不会触发、也观测不到——它不是欠账，是一句托词。
 *
 * 所以这里补上那个「可观测的数」：一个能在任何时候跑、并给出确切数字的命令。
 * 欠账的解除条件指向它，它就能真的被判定。
 *
 * ── 它不是什么 ──────────────────────────────────────────────────────────────
 *
 * **它不判红。** 字面量落在允许的档位上时并不违规（`card-contract.spec.ts` 守
 * 那件事）。这条只是把「还剩多少」量出来，让欠账可以被观测，而不是假装已经还清。
 *
 * 用法：`node scripts/report-type-literals.mjs [根目录]`
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** 客户端半区全部 `*.module.css`，按路径排序。 */
function sheets(root) {
  const found = []
  const walk = dir => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (entry.name.endsWith('.module.css')) found.push(full)
    }
  }
  walk(join(root, 'src', 'client'))
  return found.sort()
}

/** 注释剥掉（注释里写 `font-size: 12px` 不是一次声明——硬性规范 14）。 */
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 每一张表的字面量字号计数。
 * @param root - 仓库根。
 * @returns `{ rel, literals, tokenReads }` 数组。
 */
export function countTypeLiterals(root) {
  const out = []
  for (const path of sheets(root)) {
    const code = stripComments(readFileSync(path, 'utf8'))
    const literals = (code.match(/font-size:\s*\d+(?:\.\d+)?px/g) ?? []).length
    const tokenReads = (code.match(/font-size:\s*var\(--dsh-tb-type-[\w-]+\)/g) ?? []).length
    out.push({ rel: relative(root, path).split('\\').join('/'), literals, tokenReads })
  }
  return out
}

function main() {
  const root = resolve(process.argv[2] ?? '.')
  const rows = countTypeLiterals(root)
  if (rows.length === 0) {
    console.error('report-type-literals: 没找到任何样式表——根目录给错了？')
    process.exit(1)
  }
  const totalLiterals = rows.reduce((sum, row) => sum + row.literals, 0)
  const totalTokens = rows.reduce((sum, row) => sum + row.tokenReads, 0)

  for (const row of rows) {
    if (row.literals === 0 && row.tokenReads === 0) continue
    console.log(`  ${row.rel.padEnd(48)} 字面量 ${String(row.literals).padStart(4)}   读令牌 ${String(row.tokenReads).padStart(4)}`)
  }
  console.log('')
  console.log(`字面量合计 ${String(totalLiterals)} 处；读令牌合计 ${String(totalTokens)} 处。`)
  console.log('（这不判红：字面量落在允许的档位上并不违规。这张表是那条欠账的解除条件的观测量。）')
}

main()
