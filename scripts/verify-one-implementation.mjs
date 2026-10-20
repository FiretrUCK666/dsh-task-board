#!/usr/bin/env node
/**
 * **一件事只能有一个家。**
 *
 * ── 为什么要有这条 ──────────────────────────────────────────────────────────
 *
 * 这个项目里最贵的一种债不是「写错了」，是**「同一个东西有两个家」**：
 *
 *   1. 清单页要一种药丸底，于是有人把看板那一份**抄**进了 `item/item.module.css`。
 *   2. 抄的时候顺手改了一个数（内衬 10px 写成 12px），所以**声明体不再相同**——
 *      而按声明体判重的门禁（`verify-design-docs` 的 `duplicateBodies`）**没报**。
 *   3. 从此两份各改各的：改设计系统那份，清单页那份不动；改清单页那份，看板上还是旧的。
 *   4. **屏幕上没有任何一处会说明为什么。**
 *
 * 第 2 步是关键：**改了一个数的抄法，躲过了按声明体判重的门禁**。
 * 所以本门禁判的是**归属**（这个名字有几个家），不是**长相**（两个家写得像不像）。
 *
 * 抄一份的代价也不是那几行：读者要「两处颜色一致」时，其中一处不会跟着变，
 * 而屏上不会有人说一句话。所以规矩只有一条：**其余全部 import**。
 *
 * ── 它守的是什么 ────────────────────────────────────────────────────────────
 *
 * **一个顶层名字只能在一个文件里被定义。** 分两种情况报：
 *
 *   · **同名同体**（两个家的代码逐字相同）——那一定是抄的，没有例外；
 *   · **同名异体**（两个家写的不一样）——那是「同一件事的两个版本」，
 *     或者「两件不同的事碰巧用了同一个名字」。后者由**豁免表**说清（见下）。
 *
 * 跨半区（host 与 client 各定义一份）会单独标出来：那是**同一个概念跨了半区**，
 * 比同半区里的两份拷贝更值得警惕——因为读者会以为「界面和模型各有一份没关系」，
 * 而实际上模型那份和界面那份**必须说同一句话**。
 *
 * ── 为什么不用「按声明体判重」 ──────────────────────────────────────────────
 *
 * 已经有那条了（`verify-design-docs` 的 `duplicateBodies`），它按**声明体相同**判。
 * 它漏掉的正是上面第 2 步那种「抄了改了一个数」——所以两条并存，不是重复。
 *
 * ── 豁免 ────────────────────────────────────────────────────────────────────
 *
 * 有些名字天生会在多个文件里出现，而那不是「抄」：
 *
 *   · **框架定的插件入口名**（`inject` / `apply`）——cordis 的插件契约，
 *     每个半区各有一个入口，它们不是同一件事。
 *
 * 豁免是**声明**，不是字样启发：名单在这里，理由也在这里。
 *
 * ── 新增登记 ────────────────────────────────────────────────────────────────
 *
 * 「先复用，再扩展，最后才新增」这条规矩最难守的地方不是没人想复用，
 * 而是**没人记得自己查过什么**。所以每加一个共享单元，要在
 * `src/client/design/addition-records.ts` 留一条记录（四个字段）。
 * 本门禁读那张表：**后两个字段空着即红**，「最接近的既有」**必须真的存在**。
 *
 * @module dsh-task-board/scripts/verify-one-implementation
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { probeOf } from './probe-args.mjs'
import { stripSourceComments } from './source-core.mjs'

/**
 * 框架定的插件入口名：每个半区各有一个入口，**不是同一件事**。
 * @type {ReadonlySet<string>}
 */
export const EXEMPT_NAMES = new Set(['inject', 'apply'])

/** 新增登记表的位置。 */
export const RECORDS_FILE = 'src/client/design/addition-records.ts'

/**
 * 归一化一段代码：去注释、去多余空白——只留下**结构**。
 * @param {string} code
 * @returns {string}
 */
function normalize(code) {
  return code.replace(/\s+/g, ' ').trim()
}

/**
 * 取一个文件里的顶层声明。
 *
 * **只认行首**（顶层）：`export` 出来的，或没有缩进的 `function` / `const` / `class`。
 * 对象字面量里的属性（插件的 `apply` 方法体之类）不算顶层声明。
 *
 * @param {string} text - 文件原文。
 * @returns {{kind: string, name: string, body: string, line: number}[]}
 */
export function declarationsOf(text) {
  const code = stripSourceComments(text)
  const lines = code.split('\n')
  const found = []
  const TOP = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type)\s+[A-Za-z_$]/
  for (let i = 0; i < lines.length; i++) {
    const m = /^export\s+(?:async\s+)?(function|const|let|var|class|interface|type)\s+([A-Za-z_$][\w$]*)/
      .exec(lines[i])
    if (!m) continue
    let end = i + 1
    while (end < lines.length && !TOP.test(lines[end])) end++
    found.push({
      kind: m[1],
      name: m[2],
      body: normalize(lines.slice(i, end).join('\n')),
      line: i + 1,
    })
    i = end - 1
  }
  return found
}

/**
 * 找出「一个名字有多个家」的地方。
 *
 * @param {{file: string, text: string}[]} files - 待查的文件。
 * @param {ReadonlySet<string>} [exempt] - 豁免的名字。
 * @returns {{name: string, same: boolean, homes: {file: string, line: number}[]}[]}
 */
export function duplicateHomes(files, exempt = EXEMPT_NAMES) {
  const byName = new Map()
  for (const file of files) {
    for (const d of declarationsOf(file.text)) {
      if (exempt.has(d.name)) continue
      if (!byName.has(d.name)) byName.set(d.name, [])
      byName.get(d.name).push({ ...d, file: file.file })
    }
  }
  const out = []
  for (const [name, homes] of byName) {
    if (homes.length < 2) continue
    const bodies = new Set(homes.map((h) => h.body))
    out.push({
      name,
      same: bodies.size === 1,
      homes: homes.map((h) => ({ file: h.file, line: h.line })),
    })
  }
  return out
}

/**
 * 这个名字的多个家是不是**跨了半区**。
 *
 * 判据是**路径**：`src/host/**` 与 `src/client/**` 是两个半区，
 * `src/core/**` 是两边共用的纯逻辑层（它与半区同名的定义才是跨半区）。
 *
 * @param {{file: string}[]} homes
 * @returns {boolean}
 */
export function spansHalves(homes) {
  const halves = new Set()
  for (const h of homes) {
    if (h.file.startsWith('src/client/')) halves.add('client')
    else if (h.file.startsWith('src/host/')) halves.add('host')
    else if (h.file.startsWith('src/core/')) halves.add('core')
  }
  return halves.has('client') && (halves.has('host') || halves.has('core'))
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

/**
 * 从一段文字里取出**第一个路径形的字样**。
 *
 * 登记表的 `unit` 写的是「路径 —— 一句话」，所以路径是**首词**；`nearest` 有时写
 * 「路径 与 另一个路径」，所以要逐个看。路径形 = 以仓库里那几个目录开头
 * （`src/` `design/` `scripts/` `tests/` `lib/`）。
 *
 * @param {string} text
 * @returns {string[]}
 */
export function pathsIn(text) {
  return text.match(/(?:src|design|scripts|tests|lib)\/[A-Za-z0-9_./-]+/g) ?? []
}

/**
 * 读新增登记表并查那四个字段。
 *
 * **「最接近的既有」必须真的存在**：字段里出现的路径形字样（`src/…`、`design/…`）
 * 要在仓库里找得到。写「无」等于说没查过。
 * **「单元」也一样**：它写的路径必须存在——一条记录指向一个不存在的文件，
 * 等于这张表在骗人。
 *
 * @param {string} root - 仓库根。
 * @returns {{ok: boolean, problems: string[]}}
 */
export function checkAdditionRecords(root) {
  const problems = []
  const file = join(root, RECORDS_FILE)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return { ok: false, problems: [`读不到新增登记表 ${RECORDS_FILE}`] }
  }
  const exists = (p) => {
    try {
      readFileSync(join(root, p))
      return true
    } catch {
      return false
    }
  }
  const code = stripSourceComments(text)
  const blocks = code.split(/\n  \{\n/).slice(1)
  if (blocks.length === 0) {
    problems.push('新增登记表里一条记录都没有——加了共享单元就要留一条')
  }
  for (const [index, block] of blocks.entries()) {
    const field = (name) => {
      const m = new RegExp(`${name}:\\s*'([^']*)'`, 's').exec(block)
      return m ? m[1].trim() : ''
    }
    const unit = field('unit')
    const nearest = field('nearest')
    const whyNot = field('whyNot')
    const askedBy = field('askedBy')
    const at = `第 ${String(index + 1)} 条记录`
    if (!unit) {
      problems.push(`${at}：单元是空的`)
    } else {
      const unitPaths = pathsIn(unit)
      if (unitPaths.length === 0) {
        problems.push(`${at}：单元里没有路径（${unit}）`)
      } else if (!unitPaths.some(exists)) {
        problems.push(`${at}：单元指向的文件不存在（${unitPaths[0]}）`)
      }
    }
    if (!whyNot) problems.push(`${at}：为什么不能用是空的——说不出就是没查过`)
    if (!askedBy) problems.push(`${at}：谁要求新增是空的`)
    if (!nearest) {
      problems.push(`${at}：最接近的既有是空的`)
    } else {
      const nearestPaths = pathsIn(nearest)
      if (nearestPaths.length === 0 || !nearestPaths.some(exists)) {
        problems.push(`${at}：最接近的既有里没有指着一个真实存在的文件（${nearest}）`)
      }
    }
  }
  return { ok: problems.length === 0, problems }
}

function main() {
  const probe = probeOf(['--probe-copy', '--probe-clean'])
  const root = process.argv[2] ?? process.cwd()

  if (probe === '--probe-copy') {
    // 自测：两份逐字相同的东西必须被抓住。
    const fake = [
      { file: 'src/a.ts', text: "export function same(x: number) {\n  return x + 1\n}\n" },
      { file: 'src/b.ts', text: "export function same(x: number) {\n  return x + 1\n}\n" },
    ]
    const found = duplicateHomes(fake)
    if (found.length !== 1 || !found[0].same) {
      console.error('FAIL 自测：两份逐字相同的东西没被抓住')
      process.exit(1)
    }
    console.log('OK 自测：两份逐字相同的东西被抓住。')
    return
  }
  if (probe === '--probe-clean') {
    // 自测：两个不同的名字不该被当成重复。
    const fake = [
      { file: 'src/a.ts', text: 'export function one() {\n  return 1\n}\n' },
      { file: 'src/b.ts', text: 'export function two() {\n  return 2\n}\n' },
    ]
    if (duplicateHomes(fake).length !== 0) {
      console.error('FAIL 自测：两个不同的名字被当成了重复')
      process.exit(1)
    }
    console.log('OK 自测：两个不同的名字放行。')
    return
  }

  const srcDir = join(root, 'src')
  const files = tsFilesOf(srcDir).map((p) => ({
    file: relative(root, p).split(sep).join('/'),
    text: readFileSync(p, 'utf8'),
  }))
  const dupes = duplicateHomes(files)
  const records = checkAdditionRecords(root)

  const problems = []
  for (const d of dupes) {
    const where = d.homes.map((h) => `${h.file}:${String(h.line)}`).join('  +  ')
    const kind = d.same ? '逐字相同——那是一份拷贝' : '写法不同——同一个名字有两个家'
    const cross = spansHalves(d.homes) ? '，而且**跨了半区**' : ''
    problems.push(`  ${d.name}（${kind}${cross}）\n      ${where}`)
  }
  for (const p of records.problems) problems.push(`  新增登记：${p}`)

  if (problems.length === 0) {
    console.log(
      `verify-one-implementation OK: ${String(files.length)} 个文件，` +
        `${String(dupes.length)} 个名字有多个家；新增登记 ${String(records.problems.length)} 处问题。`,
    )
    return
  }
  console.error(`FAIL ${String(problems.length)} 处「一个名字有两个家」：`)
  for (const p of problems) console.error(p)
  console.error('')
  console.error('  同一件事只能有一处实现，其余全部 import。')
  console.error('  抄一份（哪怕只改了一个数）就是两个家——改一处，另一处不会跟着改，')
  console.error('  而屏幕上没有任何一处会说明为什么。')
  console.error('  真要新增，就在 src/client/design/addition-records.ts 留一条记录，')
  console.error('  说得出「最接近的那个是什么、为什么它不行」。')
  process.exit(1)
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  main()
}
