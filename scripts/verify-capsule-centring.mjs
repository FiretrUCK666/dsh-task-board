#!/usr/bin/env node
/**
 * 混排行的居中判据：**一行里只要有图形或不同字号，`baseline` 就一定错**。
 *
 * ── 为什么这必须是门禁，而不是一次修改 ────────────────────────────────────────
 *
 * `align-items: center` 居中的是**行盒**；`baseline` 对齐的是**字的底边**。两者在
 * 「一行只有一种字号、而且全是文字」时结果一样，所以差别平时看不见。一旦那一行里
 *
 *   - 出现了**图形**（圆点、小方块、进度条、图标），它没有基线可对，只能把盒底贴上去；
 *   - 或者出现了**两种字号**（18px 的标题 + 12px 的计数），两种字的行盒高度不同，
 *     基点对齐之后它们的**盒心必然错开**（量到过 19.5 对 20.5，就是一个像素）；
 *
 * 读者看到的就是「这一行的字偏下一点点」——而它会被归咎于「字体问题」「浏览器问题」，
 * 于是有人去写一个像素补偿。那个补偿会在另一款字体上变成新的偏差，这才是这件事被
 * 反复「修好」又反复出现的原因。
 *
 * 所以判据不是「哪几行在我屏幕上看着歪」，而是**结构**：这一行的子元素里有没有
 * 不参与基线的东西。有，就必须 `center` + 每段 `line-height: 1em`。
 *
 * ── 门禁怎么读（只读结构，不读字样） ────────────────────────────────────────
 *
 * 1. 逐张客户端样式表，找 `align-items: baseline`（或 `align-self: baseline`）的规则。
 * 2. 对每条这样的规则，找它在**同一张表**里声明的子元素规则（`<该选择器> > *`、
 *    `> x`、`:is(...)` 等形式）。
 * 3. 若那些子元素规则里出现下面任一条，这条 `baseline` 就是**错的**：
 *      - `line-height: 1em` 或令牌化的等价物 —— 那说明作者已经在按段处理行盒，
 *        却把容器留在基线上；
 *      - `display: inline-block` + 明确的固定尺寸（`inline-size` / `block-size` /
 *        `width` / `height`）—— 那是图形；
 *      - 名字里带 `dot` / `bar` / `meter` / `icon` / `glyph` / `pip` / `tick` 的类
 *        —— 这些是**记号**，不是文字。
 * 4. 完全由文字组成的行（例如 30px 的数 + 12px 的标签，两者都是字）**放行**：
 *    在那一类行上 `baseline` 是正确的、也是想要的——它让两个字族坐在同一条线上。
 *
 * ── 为什么它覆盖「以后新增的组件」 ──────────────────────────────────────────
 *
 * 第 3 条读的是**结构特征**，不是任何具体类名。新写一个组件、新加一颗圆点、新拉一条
 * 进度条，只要它落在一条 `baseline` 的容器里，这个门禁就会在 `pnpm verify` 里报出来
 * ——不需要有人记得「上次那个坑」。
 *
 * 用法：`node scripts/verify-capsule-centring.mjs [根目录]`
 * 自测：`--probe-mixed`（种一条混排，必须报红） / `--probe-text`（种一条纯文字，必须放行）
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/** 图形的类名记号：出现这些词的类，是记号而不是文字。 */
const GRAPHIC_HINTS = /\b(dot|bar|meter|icon|glyph|pip|tick|mark|swatch|bead|spark)\b/i

/** 收集客户端样式表，跳过 node_modules 与产物目录。 */
function sheetsUnder(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'lib' || name === 'dist' || name.startsWith('.')) continue
      const full = join(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (name.endsWith('.css')) out.push(full)
    }
  }
  walk(join(root, 'src'))
  return out
}

/** 去掉注释，保留行号（用等长空白替换，行号才对得上）。 */
function stripCommentsKeepingLines(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
}

/** 把一张表拆成 { selector, body, line } 的规则列表（只看单层，嵌套由调用方处理）。 */
function rulesOf(css) {
  const rules = []
  let i = 0
  let line = 1
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const selector = css.slice(i, open)
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    const body = css.slice(open + 1, j - 1)
    const lineAt = line + (css.slice(0, i).match(/\n/g)?.length ?? 0)
    rules.push({ selector: selector.trim(), body, line: lineAt })
    line += (css.slice(i, j).match(/\n/g)?.length ?? 0)
    i = j
  }
  return rules
}

/** 一条规则的选择器里，末段是否指向「该容器的子元素」。 */
function isChildSelectorOf(childSel, parentSel) {
  const last = childSel.split(',').map((s) => s.trim())
  return last.some((part) => {
    if (!part.startsWith(parentSel)) return false
    const tail = part.slice(parentSel.length).trim()
    if (tail === '') return false
    // `> *`、`> x`、`> span`、`> :is(a, b)`、` > *[class]`
    return /^>\s*\S/.test(tail)
  })
}

/** 子元素规则里是否带了「这不是纯文字」的结构信号。 */
function childHasGraphicSignal(selector, body) {
  if (/line-height:\s*(1em|var\(--dsh-tb-[a-z-]*line[a-z-]*\))/.test(body)) {
    return 'the child rule sets a per-run line box (line-height: 1em family)'
  }
  if (/display:\s*inline-block/.test(body)
    && /(inline-size|block-size|(^|[^-])width|(^|[^-])height):/.test(body)) {
    return 'the child rule sizes a box explicitly — a graphic has no baseline to sit on'
  }
  /* **自己也是一个 flex/grid 容器的子元素不是一段文字。** 它是「一个盒子」——
     图标、圆点、按钮、缩略图都长这样。按基线对齐时它的盒底会被贴到基线上，而
     它没有基线。这一条比猜类名可靠得多：`itemRailMark` 的名字里没有 dot，但它
     是 `inline-flex` 装着一枚图标，那一刻它就是图形。
     纯文字的子元素只会声明字号、字重、颜色，不会把自己变成一个容器。 */
  if (/display:\s*(inline-)?(flex|grid)/.test(body)) {
    return 'the child is itself a flex/grid container (a box, not a run of text)'
  }
  if (GRAPHIC_HINTS.test(selector) && /(inline-size|block-size|(^|[^-])width|(^|[^-])height|border-radius)/.test(body)) {
    return 'the child selector names a mark (dot / bar / icon) and sizes it'
  }
  return null
}

/**
 * 容器**自己**身上就写着「这一行里有图形」的信号。
 *
 * 两种形态都真实存在，而且都不经过子元素规则：
 *
 *   - **grid 的模板列**里有记号宽度：`grid-template-columns: var(--dsh-tb-dot) 5.5em …`
 *     —— 圆点是第一列，它没有子元素规则可查（管道的行就是这个形状）；
 *   - **子选择器**直接写在容器规则里：`.row > .dot { … }` 之外，还有
 *     `.row :is(.dot, .bar) { … }` 这类。
 *
 * 只看子元素规则会漏掉 grid 那一类——而它恰恰是最常见的一类。
 */
function containerDeclaresGraphic(selector, body) {
  const template = body.match(/grid-template-columns:\s*([^;]+);/)
  if (template !== null) {
    const columns = template[1]
    if (GRAPHIC_HINTS.test(columns)) {
      return 'its grid template gives a column to a mark (dot / bar / icon)'
    }
    /* 记号宽度也常以令牌出现：`var(--dsh-tb-dot)`、`var(--dsh-tb-mark-*)`。 */
    if (/var\(--dsh-tb-[a-z-]*(dot|mark|pip|bead)/.test(columns)) {
      return 'its grid template sizes a mark column from a mark token'
    }
  }
  if (GRAPHIC_HINTS.test(selector)
    && /(inline-size|block-size|(^|[^-])width|(^|[^-])height):/.test(body)) {
    return 'the container names a mark and sizes it'
  }
  return null
}

/** 找出所有错的 baseline：容器在基线上，而它有一个带图形信号的子元素规则。 */
export function findMixedBaselineRows(root) {
  const findings = []
  for (const file of sheetsUnder(root)) {
    const raw = readFileSync(file, 'utf8')
    const css = stripCommentsKeepingLines(raw)
    const rules = rulesOf(css)
    for (const rule of rules) {
      const usesBaseline = /align-(items|self):\s*baseline/.test(rule.body)
      if (!usesBaseline) continue
      const containerSelectors = rule.selector.split(',').map((s) => s.trim()).filter(Boolean)
      /* 先问容器自己：grid 模板列里给记号留了位置，就已经是混排行了，
         不需要（也查不到）子元素规则。 */
      const selfSignal = containerDeclaresGraphic(rule.selector, rule.body)
      if (selfSignal !== null) {
        findings.push({
          file: relative(root, file).replace(/\\/g, '/'),
          line: rule.line,
          container: rule.selector,
          childSelector: '(这一行自己)',
          why: selfSignal,
        })
        continue
      }
      for (const child of rules) {
        for (const container of containerSelectors) {
          if (!isChildSelectorOf(child.selector, container)) continue
          const signal = childHasGraphicSignal(child.selector, child.body)
          if (signal === null) continue
          findings.push({
            file: relative(root, file).replace(/\\/g, '/'),
            line: rule.line,
            container,
            childSelector: child.selector,
            why: signal,
          })
          break
        }
      }
    }
  }
  return findings
}

function main() {
  const root = process.argv[2] ?? '.'
  const probeMixed = process.argv.includes('--probe-mixed')
  const probeText = process.argv.includes('--probe-text')

  if (probeMixed || probeText) {
    /* 自测种在 tests/ 里，不碰真实样式表（硬性规范 16）。 */
    const findings = findMixedBaselineRows(join(root, probeMixed ? 'tests/fixtures/centring-mixed' : 'tests/fixtures/centring-text'))
    if (probeMixed) {
      if (findings.length === 0) {
        console.error('FAIL 自测：一条混排行（baseline + 图形子元素）必须被报出来，但一条都没有。')
        process.exit(1)
      }
      console.log(`OK 自测：混排行被认出 ${findings.length} 条（门禁确实是活的）。`)
      return
    }
    if (findings.length !== 0) {
      console.error('FAIL 自测：纯文字行（baseline + 两个字号）必须放行，却报了：')
      for (const f of findings) console.error(`  ${f.file}:${f.line} ${f.container} -> ${f.childSelector}`)
      process.exit(1)
    }
    console.log('OK 自测：纯文字行放行（不误伤正确的 baseline）。')
    return
  }

  const findings = findMixedBaselineRows(root)
  if (findings.length === 0) {
    console.log('verify-capsule-centring OK: 没有一行在基线上混排图形。')
    return
  }
  console.error(`FAIL ${findings.length} 行在基线上混排了图形或不同行盒——它会读作「这一行的字偏下一点点」：`)
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}`)
    console.error(`    容器 ${f.container} 用了 baseline，而它的子元素 ${f.childSelector}`)
    console.error(`    原因：${f.why}`)
    console.error('    改法：容器改 align-items: center，并在子元素规则里给每段 line-height: 1em。')
  }
  process.exit(1)
}

main()
