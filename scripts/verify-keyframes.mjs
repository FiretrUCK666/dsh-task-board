#!/usr/bin/env node
/**
 * **关键帧只有一处家，而且那个家真的有人在读。**
 *
 * ── 这条门禁守的是什么 ──────────────────────────────────────────────────────
 *
 * CSS Modules 把 `@keyframes` 的名字**连同表的作用域一起哈希**（构建产物里是
 * `QeuTqq_dshTbBoardIn` 与 `Sr3ygG_dshTbBoardIn` 两个不同的名字）。所以
 *
 *   · 一张表里 `animation: … dshTbFadeIn` 指向的，只可能是**这张表自己**那份定义；
 *     别的表里同名的那一份**拿不到**——静默无效，动画不跑。
 *   · 反过来，跨表共享一段动画**只能各表各写一份**，这是机制限制，不是懒。
 *
 * 两个方向都是不报错的：写错方向的那一半屏上只是「没有动画」，而样式表合法、
 * 构建成功、测试看着也绿。这个仓库已经同时存在这两种残留：
 *
 *   · `board.module.css` 里两个关键帧（`dshTbDialogIn` / `dshTbFadeIn`）**零个读者**
 *     ——它们是共享层那两份的旧拷贝，共享层自己已经有了活的定义；
 *   · 而那里的注释曾写着「`verify-motion` 会比对同名的 keyframes 体」——**没有任何
 *     门禁比对过**，于是「两处必须逐字相同」这条规矩其实没人守。
 *
 * ── 它守的两条 ──────────────────────────────────────────────────────────────
 *
 *   A. **孤儿**：每张表里的每个 `@keyframes`，必须被**同一张表**里至少一条
 *      `animation` / `animation-name` 读到。
 *   B. **分家**：同一个名字出现在两张以上的表里时，它们的**帧体必须逐字相同**
 *      （空白归一后比较）。名字相同、动效不同，是两份实现；名字相同、体也相同，
 *      才是那条机制限制允许的那一份。
 *
 * **它不判「这段动画该不该存在」**——那要判语义（这个入场是这一页的还是一次共用的
 * 语法），归人。它只判两件机械事实：有没有人读它，同名的是不是同一段。
 *
 * 用法：`node scripts/verify-keyframes.mjs [根目录]`
 * 自测：`--probe-orphan`（种一个没人读的关键帧，必须报红）
 *       `--probe-diverged`（种两个同名异体的关键帧，必须报红）
 *       `--probe-clean`（同名同体 + 都有读者，必须放行）
 *
 * @module dsh-task-board/scripts/verify-keyframes
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { probeOf } from './probe-args.mjs'

/** 客户端半区的每一张表（与 `sheet-files.mjs` 同一个发现口径）。 */
function clientSheets(root) {
  const out = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.module.css')) out.push(full)
    }
  }
  walk(join(root, 'src', 'client'))
  return out.sort()
}

/**
 * 注释剥掉，**保留行号与字符位置**（等长空白替换）。
 *
 * 注释里出现 `@keyframes x` 不是一次定义，出现 `animation: x` 也不是一次使用——
 * 硬性规范 14：判据只读结构，不读字样。而剥成等长空白之后，下标还能拿回真实行号。
 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
}

/** 行号（1 起），从剥过注释的文本里的字符下标算。 */
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

/**
 * 一张表里定义了哪些关键帧、各自被谁读。
 * @param css - 已剥注释的表文本。
 * @returns `{ defs, readers }`；`defs` 是 `{ name, line, body }`，`readers` 是名字集合。
 */
export function keyframesIn(css) {
  const defs = []
  /* 手动配平花括号取体：帧块里还会再嵌一层 `{ … }`，正则配平会切错。 */
  for (const m of css.matchAll(/@(?:-[a-z]+-)?keyframes\s+([\w-]+)\s*\{/g)) {
    const open = m.index + m[0].length - 1
    let depth = 1
    let i = open + 1
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    defs.push({
      name: m[1],
      line: lineOf(css, m.index),
      /* 空白归一：同一个体排版不同不算分家，改一个数才算。 */
      body: css.slice(open + 1, i - 1).replace(/\s+/g, ' ').trim(),
    })
  }
  const readers = new Set()
  /* 声明可以由 `;` 结束，也可以是规则里的**最后一条**（后面直接是 `}`）——两种都算。
     只认分号的版本读不到最后一条声明，那恰好是最常见的位置，于是门禁会把活的关键帧
     报成孤儿。自测 `--probe-clean` 就是为这一条种的。 */
  for (const m of css.matchAll(/\banimation(?:-name)?\s*:\s*([^;{}]+?)\s*(?=[;}])/g)) {
    for (const word of m[1].matchAll(/[A-Za-z_][\w-]*/g)) {
      const token = word[0]
      /* `animation` 的值里还混着时长、缓动、迭代次数这些关键字；只有「本表真的定义过」
         这个名字才算一次读取，剩下的由这里自然滤掉。 */
      if (defs.some((def) => def.name === token)) readers.add(token)
    }
  }
  return { defs, readers }
}

/**
 * 找出孤儿关键帧与分家的同名关键帧。
 * @param sheets - `{ rel, code }` 数组，`code` 已剥注释。
 * @returns `{ kind, rel, line, detail }` 数组。
 */
export function keyframeFindings(sheets) {
  const out = []
  /** 名字 -> 每一份定义（跨表）。 */
  const byName = new Map()
  for (const sheet of sheets) {
    const { defs, readers } = keyframesIn(sheet.code)
    for (const def of defs) {
      if (!readers.has(def.name)) {
        out.push({
          kind: 'orphan',
          rel: sheet.rel,
          line: def.line,
          detail: `@keyframes ${def.name} — no \`animation\` in THIS sheet reads it`,
        })
      }
      if (!byName.has(def.name)) byName.set(def.name, [])
      byName.get(def.name).push({ rel: sheet.rel, line: def.line, body: def.body })
    }
  }
  /* 分家：同一名字来自两张以上的表，体却不全相同。 */
  for (const [name, defs] of byName) {
    if (new Set(defs.map((one) => one.rel)).size < 2) continue
    const bodies = new Set(defs.map((one) => one.body))
    if (bodies.size < 2) continue
    for (const def of defs) {
      out.push({
        kind: 'diverged',
        rel: def.rel,
        line: def.line,
        detail: `@keyframes ${name} — ${bodies.size} different bodies across sheets; this table must carry the SAME one as its twins`,
      })
    }
  }
  return out
}

/** 读磁盘上的每一张客户端表，剥好注释。 */
function readSheets(root) {
  return clientSheets(root).map((path) => ({
    rel: relative(root, path).split('\\').join('/'),
    code: stripComments(readFileSync(path, 'utf8')),
  }))
}

/* ── 自测：种**文本**断言，不碰真实文件（硬性规范 16） ───────────────────────── */

const IN = '@keyframes fade { from { opacity: 0 } to { opacity: 1 } }\n.x { animation: fade 160ms ease }\n'

const CASES = {
  '--probe-orphan': {
    sheets: [{ rel: 'probe/a.module.css', code: '@keyframes nobody { from { opacity: 0 } }\n.y { color: red }\n' }],
    want: 1,
    why: 'a keyframe nothing in its own sheet animates',
  },
  '--probe-diverged': {
    sheets: [
      { rel: 'probe/a.module.css', code: IN },
      { rel: 'probe/b.module.css', code: '@keyframes fade { from { opacity: 0; transform: translateY(6px) } to { opacity: 1 } }\n.z { animation: fade var(--m) }\n' },
    ],
    want: 2,
    why: 'the same keyframe name carrying two different bodies',
  },
  '--probe-clean': {
    sheets: [
      { rel: 'probe/a.module.css', code: IN },
      { rel: 'probe/b.module.css', code: IN },
    ],
    want: 0,
    why: 'the same name, the same body, both read by their own sheet',
  },
}

const probe = probeOf(Object.keys(CASES))
if (probe !== undefined) {
  const one = CASES[probe]
  if (one === undefined) { console.error(`unknown probe ${probe}`); process.exit(1) }
  const found = keyframeFindings(one.sheets)
  if (found.length !== one.want) {
    console.error(`verify-keyframes PROBE FAILED: "${one.why}" reported ${found.length} finding(s), wanted ${one.want}`)
    for (const f of found) console.error(`  ${f.kind} ${f.rel}:${f.line} ${f.detail}`)
    process.exit(1)
  }
  console.log(`verify-keyframes probe OK: "${one.why}" -> ${found.length} finding(s) as expected`)
  process.exit(0)
}

/* ── 真判据 ───────────────────────────────────────────────────────────────── */

const root = process.argv[2] ?? '.'
const sheets = readSheets(root)
const findings = keyframeFindings(sheets)
if (findings.length > 0) {
  console.error(`verify-keyframes FAILED: ${findings.length} finding(s). A keyframe name is hashed per sheet, so a name it does not define locally can only resolve to another table's — which this one cannot reach.`)
  for (const f of findings) {
    console.error(`  [${f.kind}] ${f.rel}:${f.line}  ${f.detail}`)
  }
  console.error('  Fix: an orphan is a leftover copy of a definition the shared sheet already owns — delete it. Two different bodies under one name are two implementations — make the twin identical, or give the second one its own name.')
  process.exit(1)
}
const defs = sheets.reduce((sum, sheet) => sum + keyframesIn(sheet.code).defs.length, 0)
console.log(`verify-keyframes OK: ${defs} keyframe definition(s) across ${sheets.length} sheet(s), none orphaned, no same-name twin out of step.`)
