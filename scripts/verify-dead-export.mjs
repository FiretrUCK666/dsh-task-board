#!/usr/bin/env node
/**
 * **没人读的东西不许留在那儿。**
 *
 * ── 为什么要有这条 ──────────────────────────────────────────────────────────
 *
 * 一个导出没人引用，**不会报任何错**——它既不碍编译，也不碍运行。
 * 但它的代价是**骗人**：
 *
 *   1. 某人删掉了一个词的用法，顺手把那个词也删了；
 *   2. 忘了删**导出**——于是 `export const STATUS_KEY = ...` 还在那儿，
 *      读的人以为「状态词有定义」，于是去查它，查到一份**没人维护的**拷贝；
 *   3. 于是下一个要改状态词的人，改的是那份没人读的。
 *
 * 这正是「删一个词是那次改名的一部分」那条规矩的机械后半截：
 * **删干净**不是风格，是**不许留一个假的定义处**。
 *
 * ── 它守的是什么 ────────────────────────────────────────────────────────────
 *
 * **一个导出必须有人在另一个文件里用它。** 只在自己文件里出现 = 没人读。
 *
 * 判据是**结构**的：数这个名字在**别的文件**里出现几次（代码、类型位置、JSX
 * 都算）。扫描**先剥注释再匹配**——一段说明里提到那个名字不算一次引用。
 *
 * ── 不在管辖范围内的 ────────────────────────────────────────────────────────
 *
 *   · **入口文件**（`src/index.ts` / `src/client/index.ts`）——它们的导出**就是**
 *     这个包对外的界面，由外面的人读；
 *   · **`export default`**——默认导出没有名字可查；
 *   · **脚本**（`scripts/`、`tests/`）——它们读的是源码，不是包的界面。
 *
 * @module dsh-task-board/scripts/verify-dead-export
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { probeOf } from './probe-args.mjs'
import { stripSourceComments } from './source-core.mjs'

/** 入口文件：它们的导出就是包对外的界面。 */
export const ENTRY_FILES = new Set(['src/index.ts', 'src/client/index.ts'])

/**
 * 取一个文件里的导出名。
 *
 * 只认**顶层**的 `export`（`export function` / `export const` / `export class` /
 * `export interface` / `export type`）。`export default` 不算——它没有名字可查。
 *
 * **棘轮例外**：紧挨着 `@ts-expect-error` 的声明**不算**导出名——
 * 它是**故意写错**的载荷（见 `item-transitions.ts` 的 `REFUSED_BY_THE_RULING_TABLE`），
 * 它的作用就是让「模型允许写某个字段」这件事**变成构建失败**。
 * 把它当死代码删掉，棘轮就哑了：退化从此静悄悄地漏下去。
 *
 * @param {string} text - 文件原文。
 * @returns {{name: string, kind: string, line: number}[]}
 */
export function exportsOf(text) {
  const code = stripSourceComments(text)
  const rawLines = text.split('\n')
  const out = []
  const lines = code.split('\n')
  for (const [index, line] of lines.entries()) {
    const m = /^export\s+(?:async\s+)?(function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/
      .exec(line)
    if (!m) continue
    // 棘轮判断读**原文**（指令是注释，剥注释时会被抹掉；行号仍是对齐的）
    if (isRatchet(rawLines, index)) continue
    out.push({ name: m[2], kind: m[1], line: index + 1 })
  }
  return out
}

/**
 * 这一行是不是**棘轮**（紧挨着 `@ts-expect-error` 的故意写错的声明）。
 *
 * 读的是 **TypeScript 的指令**（结构性标记），不是散文里的字样。
 *
 * @param {string[]} lines - 已剥注释的代码行。
 * @param {number} index - 声明所在行（0 起）。
 * @returns {boolean}
 */
export function isRatchet(lines, index) {
  for (let i = index - 1; i >= 0 && i >= index - 3; i--) {
    const line = lines[i].trim()
    if (line === '') continue
    return line.includes('@ts-expect-error')
  }
  return false
}

/**
 * 一个文本里出现过哪些**标识符**，各几次。
 *
 * 一次扫描出全部，而不是每个名字扫一遍——后者是 O(名字 × 文件)，
 * 跑一次要好几分钟。**门禁慢到没人愿意跑，就等于没有门禁。**
 *
 * @param {string} text - 文本（原文或已剥注释的代码）。
 * @returns {Map<string, number>}
 */
export function identifiersIn(text) {
  const code = stripSourceComments(text)
  const counts = new Map()
  for (const m of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const name = m[0]
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return counts
}

/**
 * 这个名字在文本里出现几次（**自己剥注释**，所以调用方传原文也行）。
 * @param {string} text - 文本（原文或已剥注释的代码）。
 * @param {string} name
 * @returns {number}
 */
export function mentionsOf(text, name) {
  const code = stripSourceComments(text)
  const re = new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'g')
  return (code.match(re) ?? []).length
}

/**
 * 找出**完全没人用**的导出。
 *
 * 判据：数这个名字在**全部文件**里出现几次，**扣掉它自己那处声明**。
 * 剩下的次数是 0 ⇒ 没人读它 ⇒ 死代码（连同只给它写的 spec 一起删）。
 *
 * **注意**：一个符号**只在本文件里用**是**活着的**—— 它只是不必要地导出了。
 * 那不是死代码，判它会把门禁变成一场大扫除，而门禁一旦开始逼人做无关的清理，
 * 就会被整体忽略  ⇒ 那时它守的就不是它该守的东西了。
 *
 * @param {{file: string, text: string}[]} files - 全部源文件（含 tests/、scripts/）。
 * @returns {{file: string, name: string, line: number}[]}
 */
export function deadExports(files) {
  // 每个文件扫一遍，记下它出现过哪些标识符、各几次 
  const perFile = files.map((f) => ({ file: f.file, counts: identifiersIn(f.text) }))
  const out = []
  for (const f of files) {
    if (ENTRY_FILES.has(f.file)) continue
    // 导出名从**原文**里取（棘轮判断要看 `@ts-expect-error` 指令）
    for (const exp of exportsOf(f.text)) {
      let used = 0
      for (const other of perFile) {
        const hits = other.counts.get(exp.name) ?? 0
        // 自己那处声明不算「有人用」
        used += other.file === f.file ? hits - 1 : hits
      }
      if (used <= 0) out.push({ file: f.file, name: exp.name, line: exp.line })
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
  const probe = probeOf(['--probe-dead', '--probe-used'])
  const root = resolve(process.argv[2] ?? '.')

  if (probe === '--probe-dead') {
    const fake = [
      { file: 'src/a.ts', text: 'export function nobody() {\n  return 1\n}\n' },
      { file: 'src/b.ts', text: 'export function somebody() {\n  return 2\n}\n' },
      { file: 'src/c.ts', text: 'import { somebody } from "./b"\nsomebody()\n' },
    ]
    const dead = deadExports(fake)
    if (dead.length !== 1 || dead[0].name !== 'nobody') {
      console.error('FAIL 自测：没人用的导出没被抓住')
      process.exit(1)
    }
    console.log('OK 自测：没人用的导出被抓住。')
    return
  }
  if (probe === '--probe-used') {
    const fake = [
      { file: 'src/a.ts', text: 'export function used() {\n  return 1\n}\n' },
      { file: 'src/b.ts', text: 'import { used } from "./a"\nused()\n' },
    ]
    if (deadExports(fake).length !== 0) {
      console.error('FAIL 自测：有人读的导出被误伤')
      process.exit(1)
    }
    console.log('OK 自测：有人读的导出放行。')
    return
  }

  const files = []
  for (const dir of ['src', 'tests', 'scripts']) {
    const abs = join(root, dir)
    for (const p of tsFilesOf(abs)) {
      files.push({ file: relative(root, p).split(sep).join('/'), text: readFileSync(p, 'utf8') })
    }
  }
  const dead = deadExports(files)
  if (dead.length === 0) {
    console.log(`verify-dead-export OK: ${String(files.length)} 个文件，0 个没人读的导出。`)
    return
  }
  console.error(`FAIL ${String(dead.length)} 个导出没人读：`)
  for (const d of dead) {
    console.error(`  ${d.file}:${String(d.line)}  ${d.name}`)
  }
  console.error('')
  console.error('  没人读的导出不会报任何错，但它会骗人：')
  console.error('  读的人以为「这个东西有定义」，去查它，查到一份没人维护的拷贝。')
  console.error('  要么用起来，要么连同它的 spec 一起删干净。')
  process.exit(1)
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  main()
}
