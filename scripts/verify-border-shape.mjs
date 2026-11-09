#!/usr/bin/env node
/**
 * **一个自定义属性的值，必须放得进读它的那个槽。**
 *
 * ── 这条门禁守的是什么 ──────────────────────────────────────────────────────
 *
 * CSS 里同一个「边」有两种语法，而它们的形状不一样：
 *
 *   `border: <宽度> <线型> <颜色>`          整个 shorthand，一次说三件事
 *   `border-color: <颜色>`                  只要**一段**
 *   `border-inline-start-width: <宽度>`     只要**一段**
 *   `box-shadow: inset 0 0 0 <宽度> <颜色>` 要两段，但**不能带线型**
 *
 * 所以一个值是 `1px solid #ddd` 的令牌，只能读进第一种槽。读进第二、第三种时，
 * 浏览器把**整条声明丢弃**——规则还在表里、选择器还匹配、样式表合法、类型不报错，
 * 屏上只是没有那条线。这正是这个仓库反复栽的那一类：不报错的缺陷。
 *
 * 实测（Chromium，同一张页面、同一份令牌）：
 *
 *   `border-color: var(--dsh-tb-border)`          → `border-top-color: rgb(0, 0, 0)`（初始值）
 *   `border-inline-start: 2px solid var(--dsh-tb-border-soft)`
 *                                                 → `border-inline-start-width: 0px`（整条丢弃）
 *   `box-shadow: inset 0 0 0 1px var(--dsh-tb-border)`
 *                                                 → `box-shadow: none`
 *   `border: 1px solid var(--dsh-tb-border-soft)` → 两个宽度，同样丢弃
 *
 * ── 判据 ────────────────────────────────────────────────────────────────────
 *
 * 先求出**哪些自定义属性的值是复合边框**（含 `<长度> <线型>`），再把 `var(--x)` 别名
 * 闭包打开（`--item-hair: var(--dsh-tb-border-soft)` 也是复合的），然后逐条看读取点：
 *
 *   · 槽只收一段（`border-*-color` / `-width` / `-style`、`box-shadow`、
 *     `outline-color` 等）→ **红**
 *   · 槽是完整 shorthand，但值里**另带了长度或线型** → **红**（两个宽度）
 *   · 槽是完整 shorthand，值就是那枚令牌 → 放行
 *   · 槽是另一个自定义属性（别名） → 放行，形状由闭合传下去
 *
 * **它不判「该用哪一枚令牌」**：那要判语义（这条线是分隔还是对象的边），归人。
 * 它只判「这一枚放得进这个槽吗」——那一半是纯语法，机械可判。
 *
 * 用法：`node scripts/verify-border-shape.mjs [根目录]`
 * 自测：`--probe-wrong-slot`（把复合令牌读进 `border-color`，必须报红）
 *       `--probe-alias`（别名间接读错槽，必须报红）
 *       `--probe-double-line`（shorthand 里多带一个长度，必须报红）
 *       `--probe-clean`（正确用法，必须放行）
 *
 * @module dsh-task-board/scripts/verify-border-shape
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { probeOf } from './probe-args.mjs'

/** 一张表的完整路径集合（与 `sheet-files.mjs` 同一个发现口径：只看 `src/client`）。 */
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

/** 注释剥掉，**保留行号**（等长空白替换）。注释里写 `border-color: var(--x)` 不是一次读取。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
}

/** 一个值里出现了 `<长度> <线型>` 这一对，就是一个**完整边框**，不是一段。 */
const COMPOUND_VALUE = /(?:^|[\s:])(?:\d+(?:\.\d+)?(?:px|rem|em)|thin|medium|thick)\s+(?:solid|dashed|dotted|double)\b/

/** 槽只要一段：颜色、宽度、线型，以及 `box-shadow`（它连线型都不收）。 */
const ONE_PART_SLOT = /^(?:border(?:-(?:block|inline)(?:-(?:start|end))?|-(?:top|right|bottom|left))?-(?:color|width|style)|box-shadow|outline-color|outline-width|outline-style|background-color|color|fill|stroke)$/

/** 槽要整个 shorthand。 */
const FULL_SLOT = /^(?:border(?:-(?:block|inline)(?:-(?:start|end))?|-(?:top|right|bottom|left))?|outline)$/

/** 读取点：`<属性>: <值>;` */
const DECLARATION = /^\s*([a-z-]+)\s*:\s*([^;]+);/

/**
 * 哪些自定义属性的值是复合边框（含别名闭包）。
 * @param sheets - `{ rel, code }` 数组，`code` 已剥注释。
 * @returns 这些属性的名字集合。
 */
export function compoundBorderProps(sheets) {
  const declared = new Map()
  for (const sheet of sheets) {
    for (const m of sheet.code.matchAll(/(--[a-z][\w-]*)\s*:\s*([^;{}]+);/g)) {
      if (!declared.has(m[1])) declared.set(m[1], m[2].trim())
    }
  }
  const compound = new Set()
  for (const [name, value] of declared) if (COMPOUND_VALUE.test(value)) compound.add(name)
  /* 别名闭包：一个属性若被声明成 `var(--other)`，它继承对方的形状。跑到不动点为止——
     闭包可能有两层（`--item-hair-color: var(--dsh-tb-hair-color)`）。 */
  for (let pass = 0; pass < 8; pass += 1) {
    let grew = false
    for (const [name, value] of declared) {
      if (compound.has(name)) continue
      const only = value.match(/^var\(\s*(--[a-z][\w-]*)\s*\)$/)
      if (only !== null && compound.has(only[1])) { compound.add(name); grew = true }
    }
    if (!grew) break
  }
  return compound
}

/**
 * 找出所有「形状放不进槽」的声明。
 * @param sheets - `{ rel, code }` 数组，`code` 已剥注释。
 * @returns `{ rel, line, prop, detail }` 数组。
 */
export function borderShapeFindings(sheets) {
  const compound = compoundBorderProps(sheets)
  const out = []
  for (const sheet of sheets) {
    sheet.code.split(/\r?\n/).forEach((line, index) => {
      const m = line.match(DECLARATION)
      if (m === null) return
      const prop = m[1]
      const value = m[2]
      if (prop.startsWith('--')) return // 别名的形状由闭包处理，这里不是读取点
      const used = [...value.matchAll(/var\(\s*(--[a-z][\w-]*)/g)]
        .map((one) => one[1])
        .filter((name) => compound.has(name))
      if (used.length === 0) return
      const site = { rel: sheet.rel, line: index + 1, prop, detail: line.trim() }
      if (ONE_PART_SLOT.test(prop)) {
        out.push({ ...site, kind: `the slot takes ONE part, but ${used.join('+')} carries a whole border` })
        return
      }
      if (FULL_SLOT.test(prop)) {
        /* 整个 shorthand 也要看值里有没有**另带**一段：`2px solid <令牌>` 是两个宽度。 */
        const prefix = value.slice(0, value.indexOf('var('))
        if (COMPOUND_VALUE.test(prefix + ' ')) {
          out.push({ ...site, kind: `${used.join('+')} already carries the width and style, and the value adds another` })
        }
        return
      }
      /* 别的槽（`background`、`transform`……）读一个复合边框是可疑的，但那条判据要判语义。 */
    })
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

/* ── 自测：全部拿**种出来的文本**断言，不碰真实文件（硬性规范 16） ───────────── */

const CASES = {
  /* 复合令牌读进只要一段的槽。 */
  '--probe-wrong-slot': {
    sheets: [{ rel: 'probe/a.module.css', code: '.x {\n  border-top-style: solid;\n  border-color: var(--t);\n}\n' }, { rel: 'probe/t.module.css', code: ':root {\n  --t: 1px solid #ddd;\n}\n' }],
    want: 1,
    why: 'a whole border handed to a colour slot',
  },
  /* 别名间接读错槽：`--item-hair` 就是这条判据存在的理由。 */
  '--probe-alias': {
    sheets: [{ rel: 'probe/a.module.css', code: '.x {\n  --hair: var(--t);\n  border-color: var(--hair);\n}\n' }, { rel: 'probe/t.module.css', code: ':root {\n  --t: 1px solid #ddd;\n}\n' }],
    want: 1,
    why: 'a compound token reached through an alias',
  },
  /* shorthand 里多带一段：两个宽度。 */
  '--probe-double-line': {
    sheets: [{ rel: 'probe/a.module.css', code: '.x {\n  border-inline-start: 2px solid var(--t);\n}\n' }, { rel: 'probe/t.module.css', code: ':root {\n  --t: 1px solid #ddd;\n}\n' }],
    want: 1,
    why: 'a second width and style in front of a token that already carries both',
  },
  /* 正确用法必须放行，两个方向都要钉住。 */
  '--probe-clean': {
    sheets: [{
      rel: 'probe/a.module.css',
      code: '.a {\n  border: var(--t);\n}\n.b {\n  border-top: var(--t);\n}\n.c {\n  border-color: var(--c);\n}\n.d {\n  box-shadow: inset 0 0 0 1px var(--c);\n}\n',
    }, { rel: 'probe/t.module.css', code: ':root {\n  --t: 1px solid #ddd;\n  --c: color-mix(in srgb, #000 9%, transparent);\n}\n' }],
    want: 0,
    why: 'the whole shorthand, and a colour-only token in a colour slot',
  },
}

const probe = probeOf(Object.keys(CASES))
if (probe !== undefined) {
  const one = CASES[probe]
  if (one === undefined) { console.error(`unknown probe ${probe}`); process.exit(1) }
  const found = borderShapeFindings(one.sheets)
  if (found.length !== one.want) {
    console.error(`verify-border-shape PROBE FAILED: "${one.why}" reported ${found.length} finding(s), wanted ${one.want}`)
    for (const f of found) console.error(`  ${f.rel}:${f.line} ${f.kind}`)
    process.exit(1)
  }
  console.log(`verify-border-shape probe OK: "${one.why}" -> ${found.length} finding(s) as expected`)
  process.exit(0)
}

/* ── 真判据 ───────────────────────────────────────────────────────────────── */

const root = process.argv[2] ?? '.'
const findings = borderShapeFindings(readSheets(root))
if (findings.length > 0) {
  console.error(`verify-border-shape FAILED: ${findings.length} declaration(s) hand a whole border to a slot that takes one part — the browser drops the entire declaration, so the line is simply not drawn and nothing reports it.`)
  for (const f of findings) {
    console.error(`  ${f.rel}:${f.line}  ${f.prop}: ${f.kind}`)
    console.error(`     ${f.detail}`)
  }
  console.error('  Fix: a slot that wants one part reads the COLOUR token (`--dsh-tb-hair-color` / `--dsh-tb-hair-strong-color`, or the page\'s own `-color` alias); a slot that wants the whole `border` reads `--dsh-tb-border` / `--dsh-tb-border-soft`.')
  process.exit(1)
}
console.log('verify-border-shape OK: every read of a whole-border token lands in a slot that can take one.')
