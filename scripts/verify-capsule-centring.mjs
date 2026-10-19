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
import { rulesOf, stripComments } from './css-core.mjs'
import { probeOf } from './probe-args.mjs'

/**
 * 图形的类名记号：出现这些词的类，是记号而不是文字。
 *
 * **`\b` 在 camelCase 里不成立，而本仓库的类名全是 camelCase。** 第一版写的是
 * `/\b(dot|bar|…)\b/i`，实测在 1144 个类名里只命中 **1 个**（`.icon`）：因为
 * `statusDot` / `cardSessionDot` / `reviewMeterBar` 里 `dot` 与 `bar` 两侧都是字母，
 * 词边界根本不存在。于是「类名说明它是记号」这条判据对**这个项目几乎完全失效**，
 * 真正在起作用的只剩另外两条（`line-height: 1em` 家族、`display: inline-flex`）。
 *
 * 读法是**按词切分再比对**，不是正则去凑边界：camelCase 的每个大写字母都是一个新词的
 * 开始，`-` 与 `_` 也一样。切出来逐段比，`statusDot` → `status` + `dot`（命中），
 * `galleryBandButton` → `gallery` + `band` + `button`（不命中——`band` 不是 `bar`，
 * 这正是想要的：它是分段控件的按钮，不是进度条）。
 */
const GRAPHIC_WORDS = ['dot', 'bar', 'meter', 'icon', 'glyph', 'pip', 'tick', 'mark', 'swatch', 'bead', 'spark']

/** 类名（或选择器里的任意一处）是否含一个记号词。 */
function namesAGraphic(text) {
  const words = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_-]+/)
  return words.some((word) => GRAPHIC_WORDS.includes(word.toLowerCase()))
}

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

/**
 * 一条规则的选择器里，末段是否指向「该容器里的一个子元素」。
 *
 * **直接子（`>`）与后代（空格）都算。** 第一版只认 `>`，理由是「行盒的居中只对直接
 * 子元素成立」——那个理由对**居中**成立，对**这条判据**不成立：判据要回答的是「这条
 * 基线行里有没有不参与基线的东西」，而一个包在中间层里的圆点同样没有基线，同样会把
 * 盒底贴到基线上。实测：`.row{baseline}` + `.row .dot{尺寸}` 这一对在旧读法下静默，
 * 和「at-rule 里的行」「驼峰类名」是同一类漏读。
 *
 * 判据仍然是结构：一个复合选择器的**前缀**等于容器选择器，后面还有别的东西——那就是
 * 「容器里的某个后代」，与它中间隔着几层无关。
 */
function isChildSelectorOf(childSel, parentSel) {
  const last = childSel.split(',').map((s) => s.trim())
  return last.some((part) => {
    if (!part.startsWith(parentSel)) return false
    const tail = part.slice(parentSel.length).trim()
    if (tail === '') return false
    /* `> x`（直接子）、` .x` / `.x`（后代，可能是复合选择器的一部分）。
       排除 `:hover` 这类**状态**写法与 `[data-…]` 这类**同元素**修饰——它们描述的是
       容器自己，不是它里面的东西。 */
    if (/^>/.test(tail)) return true
    if (/^[:[]/.test(tail)) return false
    return /^[.\s#:[]/.test(tail)
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
  if (namesAGraphic(selector) && /(inline-size|block-size|(^|[^-])width|(^|[^-])height|border-radius)/.test(body)) {
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
    if (namesAGraphic(columns)) {
      return 'its grid template gives a column to a mark (dot / bar / icon)'
    }
    /* 记号宽度也常以令牌出现：`var(--dsh-tb-dot)`、`var(--dsh-tb-mark-*)`。 */
    if (/var\(--dsh-tb-[a-z-]*(dot|mark|pip|bead)/.test(columns)) {
      return 'its grid template sizes a mark column from a mark token'
    }
  }
  if (namesAGraphic(selector)
    && /(inline-size|block-size|(^|[^-])width|(^|[^-])height):/.test(body)) {
    return 'the container names a mark and sizes it'
  }
  return null
}

/**
 * 装字的盒子**不许用不对称的块向内衬去假装居中**。
 *
 * 这是那个现象的第五次复发形态，也是唯一一个「结构上可以一眼认出来」的形态：
 *
 *   1. 一个全局令牌（`0.04em` / `0.5px` / `1px` / `1.4px`）；
 *   2. 逐元素测量 + 按元素写一个变量；
 *   3. 两者都写成一对 `padding-block: max(0, -X) max(0, X)`。
 *
 * 三种都失败在同一个地方：块向内衬挪的是**内容盒**，而 `align-items: center` 会把
 * 行盒重新居中到新的内容盒里——两者一起走，相对位置一位小数都没变。它还压扁定高
 * 盒子（28px 的按钮只剩 20.5px 的内容盒）、把字裁掉、并让那个变量被继承（药丸里的
 * 圆点读到了药丸那一档，6×6 变成 6×18 的竖条）。
 *
 * 判据只认**形状**，不认令牌名：一条规则里 `padding-block` 的两个值不相等，而且
 * 其中一个读了一个自定义属性或 `calc()`——那就是一次补偿。**对称**的块向内衬（`0 8px`
 * 这类、或者两边写同一个值）放行：那是留白，不是补偿。
 */
function findAsymmetricCompensation(root) {
  const findings = []
  for (const file of sheetsUnder(root)) {
    const css = stripComments(readFileSync(file, 'utf8'))
    for (const rule of rulesOf(css)) {
      const match = rule.body.match(/padding-block:\s*([^;]+);/)
      if (match === null) continue
      const parts = match[1].trim().split(/\s+/)
      if (parts.length === 1) continue
      const [top, bottom] = [parts[0], parts[parts.length - 1]]
      if (top === bottom) continue
      /* 不带变量、也不带 calc 的两段简写是静态留白（`0 8px`），不是补偿。 */
      if (!/var\(|calc\(/.test(match[1])) continue
      /* **一次补偿的标志是「同一个量、取正负两侧」。**
         上下两段读的是**同一枚**自定义属性（`max(0, -X)` 与 `max(0, X)` 只差一个否定），
         或者其中一段是 `calc(-1 * …)`。两段读**不同**的令牌（`air` 与 `gap`、
         `space-1` 与 `space-3`）是两种不同的留白，放行——把它判成缺陷，就会逼着人
         去改对的排版（硬性规范 14）。 */
      const sameVariable = /calc\(\s*-1\s*\*/.test(match[1])
        || (() => {
          const names = [...match[1].matchAll(/var\((--[\w-]+)/g)].map((one) => one[1])
          return names.length === 2 && names[0] === names[1]
        })()
      if (!sameVariable) continue
      findings.push({
        file: relative(root, file).replace(/\\/g, '/'),
        line: rule.line,
        container: rule.selector,
        childSelector: match[1].trim(),
      })
    }
  }
  return findings
}

/** 找出所有错的 baseline：容器在基线上，而它有一个带图形信号的子元素规则。 */
export function findMixedBaselineRows(root) {
  const findings = []
  for (const file of sheetsUnder(root)) {
    const raw = readFileSync(file, 'utf8')
    const css = stripComments(raw)
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
  const probe = probeOf(['--probe-mixed', '--probe-text', '--probe-compensation', '--probe-blindspots'])
  const probeMixed = probe === '--probe-mixed'
  const probeText = probe === '--probe-text'

  /* **读法的自测：三个曾经静默的盲区各一条，都必须被抓到。**
   *
   * 这份 fixture 存在的理由就是 `centring-mixed` 那份的局限：那一份用的是「顶层规则 +
   * `>` + 名字带记号词」的形状，正好是旧读法唯一的舒服位置，所以它绿的时候并不能证明
   * 另外三种形状安全。实测那三个盲区覆盖 164 条 at-rule 规则与 1144 个类名里的绝大多数。
   * 判据要求**三条全部被认出**：漏一条就说明那一种读法又回去了。 */
  if (probe === '--probe-blindspots') {
    const found = findMixedBaselineRows(join(root, 'tests/fixtures/centring-blindspots'))
    const want = ['inBandRow', 'camelCaseRow', 'descendantRow']
    const missing = want.filter((token) => !found.some((f) => f.container.includes(token)))
    if (missing.length > 0) {
      console.error(`FAIL 自测：这些形状里的混排行没被读到——${missing.join(', ')}`)
      for (const f of found) console.error(`  （读到的：${f.container} -> ${f.childSelector}）`)
      process.exit(1)
    }
    console.log(`OK 自测：at-rule 里、驼峰类名、后代选择器三种形状都被读到（共 ${found.length} 条）。`)
    return
  }

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

  const probeCompensation = probe === '--probe-compensation'
  if (probeCompensation) {
    /* 自测种在 tests/ 里（硬性规范 16）：一条不对称的块向内衬必须报红，对称的必须放行。 */
    const bad = findAsymmetricCompensation(join(root, 'tests/fixtures/centring-compensation-bad'))
    if (bad.length === 0) {
      console.error('FAIL 自测：不对称的块向内衬（一次墨位补偿）必须被报出来，但一条都没有。')
      process.exit(1)
    }
    const good = findAsymmetricCompensation(join(root, 'tests/fixtures/centring-compensation-good'))
    if (good.length !== 0) {
      console.error('FAIL 自测：对称的块向内衬（留白）必须放行，却报了：')
      for (const f of good) console.error(`  ${f.file}:${f.line} ${f.container}`)
      process.exit(1)
    }
    console.log(`OK 自测：补偿被认出 ${bad.length} 条，留白放行（门禁既不瞎也不乱红）。`)
    return
  }

  const findings = findMixedBaselineRows(root)
  const compensations = findAsymmetricCompensation(root)
  if (findings.length === 0 && compensations.length === 0) {
    console.log('verify-capsule-centring OK: 没有一行在基线上混排图形，也没有一处用内衬补墨位。')
    return
  }
  if (compensations.length > 0) {
    console.error(`FAIL ${compensations.length} 处用不对称的块向内衬去补墨位——它在结构上修不好，还会压扁定高盒子：`)
    for (const f of compensations) {
      console.error(`  ${f.file}:${f.line}  ${f.container}`)
      console.error(`    padding-block: ${f.childSelector}`)
      console.error('    改法：删掉那一对补偿，改写 `line-height: var(--dsh-tb-text-line-h)` + `align-items: center`。')
    }
  }
  if (findings.length > 0) {
    console.error(`FAIL ${findings.length} 行在基线上混排了图形或不同行盒——它会读作「这一行的字偏下一点点」：`)
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}`)
      console.error(`    容器 ${f.container} 用了 baseline，而它的子元素 ${f.childSelector}`)
      console.error(`    原因：${f.why}`)
      console.error('    改法：容器改 align-items: center，并在子元素规则里给每段 line-height: 1em。')
    }
  }
  process.exit(1)
}

main()

