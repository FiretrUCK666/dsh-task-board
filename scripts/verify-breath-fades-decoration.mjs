#!/usr/bin/env node
/**
 * **状态光只许淡它自己那一层，绝不许淡承载内容的那一层。**
 *
 * ── 它守的是哪一件事 ─────────────────────────────────────────────────────
 *
 * 一条呼吸光有两条路可以走：
 *
 *   A. **光住在一个没有内容的装饰层上**（伪元素 / 一枚只有描边的空元素），
 *      关键帧淡的是那一层。内容一动不动；
 *   B. **光直接住在有内容的元素上**，于是 `opacity` 关键帧把**整块内容**一起
 *      淡进淡出——卡片上的标题、时间、芯片，连同它们背后的纸，全在一呼一吸。
 *
 * B 在源码里看起来完全正常：一条 `outline` + 一条 `animation`，合法、不报错、
 * 两种主题都渲染得出。它只在**屏上**暴露：未读的卡片每 2.6 秒消失一次，而它
 * 正是读者最需要读的那一条（「跑完了，你还没看过」）。
 *
 * 这不是假设。`probe-ring-fade.js` 在真 Chromium 里量到：`.card[data-light='ring']`
 * 的 computed `opacity` 在 0.005 与 0.995 之间来回，`cardItselfFades: true`。
 * 也就是说**卡片本身就是那盏灯**。
 *
 * ── 判据（读结构，不读字样）─────────────────────────────────────────────
 *
 *   1. 任何一条用到 `animation: <名>` 的规则，如果 `<名>` 的关键帧里出现
 *      `opacity`，那么这条规则的**主体元素上不许有内容**：
 *        · 选择器末段是伪元素（`::before` / `::after` / `::marker`）→ 合格；
 *        · 规则声明了 `content:` → 合格（它是一层画的皮，不是一个装字的东西）；
 *        · 其余一律不合格，除非它出现在 `SELF_OWNED` 里并写清理由——**那是
 *          一枚空元素**（8px 的圆点、6px 的珠子），它没有字可淡，淡它就是淡光本身。
 *
 *   2. `SELF_OWNED` 是一张**带理由的名册**，不许多一条没有理由的。
 *
 * ── 为什么它读结构而不是读某个具体选择器 ──────────────────────────────────
 *
 * 具体的类名会改名、会被合并、会搬到另一张表。这条判据问的是「这一层里有没有
 * 内容」，而那是**元素在 DOM 里的角色**，不是它叫什么。
 *
 * 用法：`node scripts/verify-breath-fades-decoration.mjs [根目录]`
 * 自测：`--probe-card`（种一条「卡片自己淡」的规则，必须报红）
 *       `--probe-layer`（种一条合格的光层，必须放行）
 */

import { readFileSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { rulesOf } from './css-core.mjs'
import { probeOf } from './probe-args.mjs'

/**
 * 那一层**本身就是一枚空记号**：没有字、没有可读内容，淡它就是淡这盏灯。
 *
 * 每一条都要写清「为什么它不是承载内容的那一层」——理由空着即红。
 */
export const SELF_OWNED = {
  // 卡片右上角那颗会话点：8px 的圆，里面没有字，它存在的全部意义就是这盏灯。
  'cardSessionDot': '8px 的会话圆点：没有文字，淡它就是淡这盏灯。',
  // 会话行末尾那颗未读点：同上。
  'notifyPulse': '通知未读点：同上，空记号。',
}

/** 关键帧名 → 它的 `50%` 档里有没有 `opacity`。 */
function opacityKeyframes(css) {
  const out = new Set()
  for (const rule of rulesOf(css)) {
    if (!rule.selector.startsWith('@keyframes')) continue
    const name = rule.selector.replace('@keyframes', '').trim().split(/\s+/)[0] ?? ''
    if (name === '') continue
    if (/(^|[\s{;])opacity\s*:/.test(rule.body)) out.add(name)
  }
  return out
}

/** 这条规则动画的名字（`animation` / `animation-name`，简写只看第一个词）。 */
function animationNamesOf(body) {
  const names = []
  for (const match of body.matchAll(/(?:^|[\s;])animation(?:-name)?\s*:\s*([^;]+);/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const first = part.trim().split(/\s+/)[0] ?? ''
      // 关键字与时间不是动画名。
      if (first === '' || /^(none|infinite|linear|ease|ease-in|ease-out|ease-in-out|\d)/.test(first)) continue
      names.push(first)
    }
  }
  return names
}

/**
 * 这条规则是不是「画的皮」——淡它不影响任何可读内容。
 * @param {string} selector
 * @param {string} body
 * @returns {boolean}
 */
export function isDecorationLayer(selector, body) {
  const last = selector.split(',').pop()?.trim() ?? ''
  if (/::(before|after|marker|backdrop)\b/.test(last)) return true
  if (/(^|[\s;])content\s*:/.test(body)) return true
  for (const cls of Object.keys(SELF_OWNED)) {
    if (new RegExp(`\\.${cls}(?![\\w-])`).test(last)) return true
  }
  return false
}

/**
 * 这个元素上有没有**无限循环**的淡出进场。
 *
 * 一次性进场（`dshTbBoardIn` / `dshTbDialogIn`）淡的是**出现的那一下**：从透明到
 * 不透明，之后永远不透明。它淡的也是内容，但那是「到达」，不是「呼吸」——把两者
 * 混成一条规则会让这条门禁去告十处正确的进场，而它一旦开始告正确的东西，就会被
 * 整体忽略。
 * @param body - 规则体。
 * @returns {boolean}
 */
function loopsForever(body) {
  for (const match of body.matchAll(/(?:^|[\s;])animation(?:-iteration-count)?\s*:\s*([^;]+);/g)) {
    const value = match[1] ?? ''
    if (/\binfinite\b/.test(value)) return true
  }
  return false
}

/**
 * 一份样式表里的违规：有内容的层被一条**无限循环**的淡 opacity 关键帧带着一呼一吸。
 * @param {string} rel - 相对路径（报错用）。
 * @param {string} css - 源文本。
 * @returns {{rel: string, selector: string, animation: string}[]}
 */
export function fadingContentLayersIn(rel, css) {
  const fading = opacityKeyframes(css)
  const out = []
  for (const rule of rulesOf(css)) {
    if (rule.selector.startsWith('@')) continue
    if (!loopsForever(rule.body)) continue
    for (const name of animationNamesOf(rule.body)) {
      if (!fading.has(name)) continue
      if (isDecorationLayer(rule.selector, rule.body)) continue
      out.push({ rel: basename(rel), selector: rule.selector.trim(), animation: name })
    }
  }
  return out
}

/**
 * 一份样式表里的违规：**会呼吸却不画任何东西**的层。
 *
 * 「呼吸」是一条 `opacity` 0→1→0 的关键帧。它只有落在一层**画了东西**的盒子上才
 * 看得见：底色、影、描边、边框、或背景图。少了一样，那条动画就在一层全透明的空气
 * 上跑——规则合法、关键帧在跑、`data-*` 属性也对，**屏上什么也没有**。
 *
 * 这不是假设。会话行那盏「冒黄光的呼吸」正是这样消失的：`::after` 只有 `content`、
 * `inset`、`opacity` 与 `animation`，没有任何可见声明，于是 `opacity: 0 → 1` 在一层
 * 透明盒子上闪了很久，而「会话在冒黄光」这件事静默地不存在了。
 *
 * 判据是「**这一条规则自己**要画」。不追查「另一条选择器可能画了同一个元素」——那
 * 需要判断两个选择器是否命中同一颗节点，而猜错的代价是漏报（正是要防的那一种）。
 * 反过来要求自画会带来一次误报，那一次会在它出现时被读到并改写；漏报永远不会。
 * @param {string} rel - 相对路径（报错用）。
 * @param {string} css - 源文本。
 * @returns {{rel: string, selector: string, animation: string}[]}
 */
export function invisibleBreathsIn(rel, css) {
  const fading = opacityKeyframes(css)
  const PAINTS = /(?:^|[\s;{])(background|background-color|background-image|box-shadow|outline|border|border-top|border-color)\s*:/
  const out = []
  for (const rule of rulesOf(css)) {
    if (rule.selector.startsWith('@')) continue
    if (!loopsForever(rule.body)) continue
    for (const name of animationNamesOf(rule.body)) {
      if (!fading.has(name)) continue
      if (PAINTS.test(rule.body)) continue
      out.push({ rel: basename(rel), selector: rule.selector.trim(), animation: name })
    }
  }
  return out
}

function sheetsOf(root) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith('.module.css')) found.push(p)
    }
  }
  walk(join(root, 'src', 'client'))
  return found.sort()
}

function main() {
  const probe = probeOf(['--probe-card', '--probe-layer', '--probe-empty-light'])
  const root = resolve(process.argv[2] ?? '.')

  if (probe === '--probe-empty-light') {
    const planted = `@keyframes fade { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }
.sessionRow::after {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0;
  animation: fade 2.6s infinite;
}
`
    const found = invisibleBreathsIn('probe.module.css', planted)
    if (found.length === 0) {
      console.error('FAIL 自测：种了一条「会呼吸却不画东西」的规则，判据没认出来。')
      process.exit(1)
    }
    console.log(`OK 自测：空动画被认出来（${found[0]?.selector ?? ''}）。`)
    return
  }

  if (probe === '--probe-card') {
    const planted = `@keyframes fade { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }
.card[data-light='ring'] {
  outline: 3px solid red;
  opacity: 0;
  animation: fade 2.6s infinite;
}
`
    const found = fadingContentLayersIn('probe.module.css', planted)
    if (found.length === 0) {
      console.error('FAIL 自测：种了一条「卡片自己淡」的规则，判据没认出来。')
      process.exit(1)
    }
    console.log(`OK 自测：承载内容的层被淡，认出来了（${found[0]?.selector ?? ''}）。`)
    return
  }
  if (probe === '--probe-layer') {
    const planted = `@keyframes fade { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }
.card::after {
  content: '';
  opacity: 0;
  animation: fade 2.6s infinite;
}
`
    const found = fadingContentLayersIn('probe.module.css', planted)
    if (found.length !== 0) {
      console.error('FAIL 自测：合格的光层被误伤：' + found.map((one) => one.selector).join(', '))
      process.exit(1)
    }
    console.log('OK 自测：装饰层上淡 opacity 放行。')
    return
  }

  const problems = sheetsOf(root).flatMap((abs) => {
    const rel = abs.split(/[\\/]/).slice(-5).join('/').replace(/^.*?(src\/)/, '$1')
    const css = readFileSync(abs, 'utf8')
    return [...fadingContentLayersIn(rel, css), ...invisibleBreathsIn(rel, css)]
  })

  for (const cls of Object.keys(SELF_OWNED)) {
    if (SELF_OWNED[cls].trim() === '') problems.push(`${cls} 进了自持名册却没写理由`)
  }

  if (problems.length === 0) {
    console.log('verify-breath-fades-decoration OK: 每一盏呼吸光都住在没有内容、又真的画了东西的那一层上。')
    return
  }
  console.error(`FAIL ${String(problems.length)} 处呼吸光不是「不存在」就是「闪错了东西」。`)
  for (const one of problems) {
    console.error(`  ${one.rel}  ${one.selector}  (animation: ${one.animation})`)
  }
  console.error('')
  console.error('  两种坏法：')
  console.error('  1. 一条 `opacity` 关键帧住在有内容的元素上 —— 淡的是那块内容本身，')
  console.error('     未读的卡片每 2.6 秒整块消失一次，而它正是最该被读到的那一条。')
  console.error('     治法：把光挪到一个没有内容的层上（伪元素 / 空记号），淡那一层。')
  console.error('  2. 会呼吸的那一层自己什么也没画 —— 底色、影、描边、边框、背景图，')
  console.error('     至少要一样，否则 `opacity: 0 → 1` 闪的是一层空气。')
  process.exit(1)
}

main()
