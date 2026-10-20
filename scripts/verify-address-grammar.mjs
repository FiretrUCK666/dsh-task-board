#!/usr/bin/env node
/**
 * **`#` 开头的两门文法，各自有且只有一个家。**
 *
 * ── 为什么要有这条 ──────────────────────────────────────────────────────────
 *
 * `#` 在这个项目里不是一个记号，是**两门**：
 *
 *   · **地址**：`#12` 指一张卡（清单里的那条）。它是**给人说的**——界面上的回执
 *     就这么写，模型也这么读。
 *   · **标签**：`#要做` 是搜索框里的限定词。它是**读者自己的词**。
 *
 * 两门文法都用 `#` 开头，于是「这个 `#` 是什么意思」这件事**必须各说各的**——
 * 一门文法一个家，两个家都清楚。
 *
 * ── 真实发生过什么 ──────────────────────────────────────────────────────────
 *
 * 地址文法曾经被抄了**十份**，其中**六份少一个 `.trim()`**。于是：
 *
 *   - `#12`（带空格）在**一个动作**里找得到，在**另一个动作**里找不到；
 *   - 而**没有任何一条测试会红**——两边各自都对，只是对得不一样。
 *
 * 这类债最贵的地方在于它**不可见**：读者看到两个动作都认 `#12`，会以为它们
 * 认的是同一个东西。抄一份改一个数（这里改的是「要不要 trim」）就是这么发生的。
 *
 * ── 它守的是什么 ────────────────────────────────────────────────────────────
 *
 * **一门文法一个家。** `#` 这个记号的每一种用法，都必须落在下面声明的那两个
 * 家里（或下面声明的例外里）。别处再写一遍 `#` 的判断，就是第二个家。
 *
 * 判据是**结构**的：扫的是**代码里那个孤零零的 `'#'` 字面量**——
 * 而格式化一个显示串（`` `#${item.ref}` ``）是**模板字面量**，不是这个形状，
 * 所以「说一个编号」不会被误判成「读一个编号」。
 *
 * 扫描**先剥注释再匹配**：一段说明里提到 `#` 不算一次用法。
 *
 * ── 声明 ────────────────────────────────────────────────────────────────────
 *
 * 这张表是**声明**，不是探测：家在哪、为什么是那门文法，都写在这里。
 * 门禁只核对「实际用法有没有落进声明里」。
 *
 * @module dsh-task-board/scripts/verify-address-grammar
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { probeOf } from './probe-args.mjs'
import { stripSourceComments } from './source-core.mjs'

/**
 * `#` 的两门文法，各自有且只有一个家。
 *
 * @type {Readonly<Record<string, string>>}
 */
export const GRAMMAR_HOMES = {
  'src/core/item-navigate.ts': '地址文法：`#12` 指一张卡（refOf 剥掉 `#` 再 trim）',
  'src/core/item-query.ts': '标签文法：`#要做` 是搜索框里的限定词（读者自己的词）',
}

/**
 * 合法但不属于那两门文法的用法，逐条写明理由。
 *
 * @type {Readonly<Record<string, string>>}
 */
export const EXEMPT_SIGILS = {
  'src/core/update-check.ts': 'URL 片段（`https://…#anchor`）——既不是卡片地址，也不是标签。',
}

/**
 * 这个文件里有没有**孤零零的** `'#'` 字面量。
 *
 * 模板字面量（`` `#${x}` ``）不算——那是**说**一个编号（格式化），
 * 不是**读**一个编号（解析）。这个区别是这道门禁的全部依据。
 *
 * @param {string} text - 文件原文。
 * @returns {{line: number, text: string}[]}
 */
export function sigilUses(text) {
  const code = stripSourceComments(text)
  const out = []
  const lines = code.split('\n')
  for (const [index, line] of lines.entries()) {
    if (/(['"])#\1/.test(line)) out.push({ line: index + 1, text: line.trim() })
  }
  return out
}

/**
 * 找出**不在声明里的家**的 `#` 用法。
 *
 * @param {{file: string, text: string}[]} files - 待查的文件。
 * @returns {{file: string, line: number, text: string}[]}
 */
export function straySigils(files) {
  const out = []
  for (const f of files) {
    if (GRAMMAR_HOMES[f.file] !== undefined) continue
    if (EXEMPT_SIGILS[f.file] !== undefined) continue
    for (const use of sigilUses(f.text)) {
      out.push({ file: f.file, line: use.line, text: use.text })
    }
  }
  return out
}

/**
 * 声明的家必须真的存在——一个指向空处的家，等于没有家。
 *
 * @param {string} root - 仓库根。
 * @returns {string[]}
 */
export function missingHomes(root) {
  const out = []
  for (const file of Object.keys(GRAMMAR_HOMES)) {
    try {
      readFileSync(join(root, file))
    } catch {
      out.push(file)
    }
  }
  return out
}

/**
 * 递归列目录下的 .ts / .tsx。
 * @param {string} dir
 * @returns {string[]}
 */
export function tsFilesOf(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsFilesOf(p))
    else if (/\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

function main() {
  const probe = probeOf(['--probe-stray', '--probe-home'])
  const root = resolve(process.argv[2] ?? '.')

  if (probe === '--probe-stray') {
    // 自测：别处自己写了一遍 `#` 的判断——必须被抓住。
    const fake = [{ file: 'src/client/thing.ts', text: "if (token.startsWith('#')) return true\n" }]
    if (straySigils(fake).length !== 1) {
      console.error('FAIL 自测：别处的 `#` 用法没被抓住')
      process.exit(1)
    }
    console.log('OK 自测：别处的 `#` 用法被抓住。')
    return
  }
  if (probe === '--probe-home') {
    // 自测：家自己写 `#` 是允许的。
    const fake = [
      { file: 'src/core/item-navigate.ts', text: "return String(x).replace('#', '').trim()\n" },
    ]
    if (straySigils(fake).length !== 0) {
      console.error('FAIL 自测：家自己的 `#` 用法被误伤')
      process.exit(1)
    }
    console.log('OK 自测：家自己的 `#` 用法放行。')
    return
  }

  const files = tsFilesOf(join(root, 'src')).map((p) => ({
    file: relative(root, p).split(sep).join('/'),
    text: readFileSync(p, 'utf8'),
  }))
  const stray = straySigils(files)
  const missing = missingHomes(root)
  const problems = []
  for (const s of stray) problems.push(`  ${s.file}:${String(s.line)}  ${s.text}`)
  for (const m of missing) problems.push(`  声明的家不存在：${m}`)

  if (problems.length === 0) {
    console.log(
      `verify-address-grammar OK: ${String(files.length)} 个文件，` +
        `两门 # 文法各有其家（${Object.keys(GRAMMAR_HOMES).length} 个家），0 处野生用法。`,
    )
    return
  }
  console.error(`FAIL ${String(problems.length)} 处「# 的第二个家」：`)
  for (const p of problems) console.error(p)
  console.error('')
  console.error('  「#」在项目里是两门文法：地址（#12 指一张卡）与标签（#要做 是搜索限定词）。')
  console.error('  每门文法一个家：家在哪、为什么是那门文法，都写在这道门禁的声明里。')
  console.error('  别处再写一遍 `#` 的判断，就是第二个家——而抄一份改一个数（这里改的是')
  console.error('  「要不要 trim」）的后果是：同一个地址在一个动作里找得到，另一个动作里找不到，')
  console.error('  而没有任何一条测试会红。')
  process.exit(1)
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  main()
}
