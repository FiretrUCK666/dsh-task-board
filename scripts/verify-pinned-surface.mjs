#!/usr/bin/env node
/**
 * 一条边界：**压在滚动内容之上、又自己画了分隔线的头，必须自带不透明的底。**
 *
 * ── 这条为什么需要门禁 ──────────────────────────────────────────────────────
 *
 * 头部通常坐在一个有底的面板里，所以「头部不写背景」看着只省了一行。它省掉的
 * 是一次**依赖**：正文在头部下面滚过时，读者看见的是谁的底，取决于那层底是否真的
 * 不透明。主题把面板底调透（渐变、模糊、或干脆 rgba）之后，头部就成一扇窗——正文
 * 从标题和状态胶囊后面透出来，读作「上面被砍了一下」。
 *
 * 这个失效**三层检查全绿**：样式表合法、类名都在、测试全过，屏幕上却少了一块。
 * 它也不是「某个皮肤的问题」——任何把面板底做透的主题都会撞上，而这类表面是唯一
 * 一处「下面有东西滚过去」的地方。
 *
 * ── 判据做到哪里，以及为什么不再往前 ────────────────────────────────────────
 *
 * 能机械判的只有**这一个元素自己的声明**：
 *
 *   1. 它自己画了下边界（`border-bottom` 用的是分隔线令牌）；
 *   2. 它是「不伸缩」的一层（`flex: none` 且有固定的 `min-height` / `block-size`）；
 *   3. 它没有自己的不透明底（读 `transparent` 的洗底不算遮挡）。
 *
 * 再往前一步就不可靠了：**「它下面到底有没有东西滚过去」不在样式表里**——那取决于
 * 兄弟节点与滚动区，是 DOM 关系。硬猜会做出一个「不看上下文的检查器」，然后逼着人
 * 给本来没问题的元素加背景。已经验证过的两个反例：`.sessionRailHead` 在滚动块**内部**
 * （跟着内容一起滚，没有东西从它下面过），`.interactionStrip` 的父卡片自带底。
 *
 * 所以这一档报的是**候选**，而候选必须被**逐个表态**：要么加底，要么进下面的豁免表
 * 并写清为什么不需要。豁免表里的理由过时了（那条规则已经改了形状）会红，所以它不会
 * 变成一张只增不减的名单。
 *
 * 用法：`node scripts/verify-pinned-surface.mjs [根目录]`
 * 自测：`--probe-missing`（缺底的必须报）/ `--probe-present`（自带底的必须放行）
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { probeOf } from './probe-args.mjs'

/**
 * 已知「父容器已经替它挡住」或「它不在滚动区上方」的表头，逐条写清理由。
 *
 * 这个表**不是豁免清单式的偷懒**：每一条都说得出「透出来的是谁的底」。规则形状一变
 * （不再 `flex: none`、不再画分隔线、不再有固定高度），下面那条 `stale` 检查会让对应
 * 行报红，逼着人回来重新判断——所以它不会悄悄变成一份没人看的旧名单。
 *
 * **目前是空的，而这是判据精确的结果**：三条起初被报出来的候选
 * （`.sessionRailHead` / `.interactionStrip` / `.columnHeader`）都没有固定高度——
 * 它们在「不伸缩的一层」这条之前就被排除了，其中一个在滚动块**内部**跟着滚、一个的父
 * 卡片自带底、一个本身就是一枚要透明的洗底带。留着它们的豁免只会变成三行谎。
 *
 * 表空着也有用：它把「这里允许有例外，但每条都要说话」这条通道留在原地，下一个人遇到
 * 真例外时知道该往哪写、以及写了会被检查。
 */
const KNOWN_SAFE = []

/** 客户端样式表。 */
function sheets(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'lib' || name === 'dist' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.css')) out.push(full)
    }
  }
  walk(join(root, 'src/client'))
  return out
}

/**
 * 把一张表拆成**叶子规则**（不含嵌套块的）。
 *
 * 拆块器把 `@media` / `@container` 也当成一条拆出来，它的「选择器」位置是 at-rule
 * 前言——那里出现 `border-bottom` 纯属巧合。判据落在「选择器得真的选元素、且这条规则
 * 没有嵌套块」上，两层一起把这类假规则挡掉。
 */
function leafRulesOf(css) {
  const rules = []
  let i = 0
  while (true) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const selector = css.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    const body = css.slice(open + 1, j - 1)
    const isLeaf = !body.includes('{')
    if (isLeaf && !selector.trimStart().startsWith('@')) {
      rules.push({ selector, body, line: css.slice(0, i).split('\n').length })
    }
    i = j
  }
  return rules
}

/** 这条规则自己画了下边界吗。 */
function drawsLowerEdge(body) {
  return /border-bottom:\s*var\(--dsh-tb-(separator|border)/.test(body)
}

/** 这条规则是「不伸缩的一层」吗（压在上面、不参与剩余空间分配）。 */
function isPinnedLayer(body) {
  if (!/flex:\s*none/.test(body)) return false
  return /(min-height|block-size|height):\s*[\d.]+px/.test(body)
}

/**
 * 这条规则给了自己**不透明**的底吗。
 *
 * 洗底不算：`color-mix(… transparent)` 是一层色调，它给着色，不给遮挡。一条压在滚动
 * 内容上的头用洗底，滚动的东西会照样从它后面露出来——这恰好是最难看出来的一档，因为
 * 静止时它看起来是有颜色的。
 */
function hasOpaqueSurface(body) {
  const decl = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/.exec(body)
  if (decl === null) return false
  const value = decl[1]
  if (value.includes('transparent')) return false
  return value.includes('var(--dsh-tb-')
}

export function audit(root) {
  const findings = []
  for (const file of sheets(root)) {
    const raw = readFileSync(file, 'utf8')
    /* 注释先抹成空白（保长度），否则注释里出现的词会被当成一次声明。 */
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    for (const rule of leafRulesOf(css)) {
      if (!drawsLowerEdge(rule.body)) continue
      if (!isPinnedLayer(rule.body)) continue
      if (hasOpaqueSurface(rule.body)) continue
      findings.push({
        file: relative(root, file).replace(/\\/g, '/'),
        selector: rule.selector,
        line: rule.line,
      })
    }
  }
  return findings
}

function main() {
  const root = process.argv[2] ?? '.'
  const probe = probeOf(['--probe-missing', '--probe-present'])

  if (probe !== undefined) {
    const dir = probe === '--probe-missing' ? 'missing' : 'present'
    const findings = audit(join(root, 'tests/fixtures/pinned-surface', dir))
    if (probe === '--probe-missing') {
      if (findings.length === 0) {
        console.error('FAIL 自测：画了分隔线、压在上面却没有自己底的头，必须被报出来。')
        process.exit(1)
      }
      console.log(`OK 自测：缺底的头被认出 ${findings.length} 条（门禁是活的）。`)
      return
    }
    if (findings.length !== 0) {
      console.error('FAIL 自测：自己带了底的同类头必须放行，却报了：')
      for (const f of findings) console.error(`  ${f.file} ${f.selector}`)
      process.exit(1)
    }
    console.log('OK 自测：自带底的头放行（不误伤）。')
    return
  }

  const findings = audit(root)
  const safe = new Map(KNOWN_SAFE.map((row) => [row.selector, row]))

  /* 反向：表里写着「安全」，但现实里已经不再满足判据——那条理由过时了。 */
  const stale = KNOWN_SAFE.filter((row) => !findings.some((f) => f.selector === row.selector))
  const open = findings.filter((f) => !safe.has(f.selector))

  if (open.length === 0 && stale.length === 0) {
    console.log(`verify-pinned-surface OK: 每个压着滚动内容的头都有底，${KNOWN_SAFE.length} 条已表态。`)
    return
  }
  if (open.length > 0) {
    console.error(`FAIL ${open.length} 处画了边界、却没有自己的底——正文会从它后面透出来：`)
    for (const f of open) console.error(`  ${f.file}:${f.line}  ${f.selector}`)
    console.error('  要么给它一条不透明的 background（读洗底梯子最实的那一级），')
    console.error('  要么在 scripts/verify-pinned-surface.mjs 的 KNOWN_SAFE 里写清为什么不需要。')
  }
  if (stale.length > 0) {
    console.error(`FAIL ${stale.length} 条豁免的理由已经过时（那些规则不再满足判据，说明形状变了）：`)
    for (const row of stale) console.error(`  ${row.selector}`)
    console.error('  回去重新判断，别让一份旧名单替现在的代码说话。')
  }
  process.exit(1)
}

main()
