#!/usr/bin/env node
/**
 * **画圆角的滚动体，必须让它的滚动条轨道缩进。**
 *
 * ── 这条门禁守的是一个读者截图报上来的真实缺陷 ──────────────────────────────
 *
 * 「那个上下滑动条有点爆出来的感觉……他感觉要冲出来了，它那个头。」
 *
 * 根因不是滚动条样式，是**两个几何事实互不相容**：
 *
 *   滚动条永远跑在一条**方角**的轨道上（那是引擎画的，不是我们画的），
 *   而盒子的右下角是**圆的**。
 *
 * 轨道铺到那截弧上时，滑块就压在弧外面。所以读者看到的是「条从圆角里长出去」，
 * 而在他拉动它的时候，它还会一路跑到边框之外。
 *
 * 修法不是加一层外框，是**把轨道两头各缩一档**——滑块的活动范围于是被关在直边
 * 以内，与圆角多大、内容多长都无关。官方自己的输入框就是这么写的
 * （`::-webkit-scrollbar-track { margin-top: 8px }`）。
 *
 * ── 为什么门禁能判，而目测不行 ────────────────────────────────────────────────
 *
 * 「滚动体有没有声明缩进」是**声明层面**的事实：一个会滚的盒子写了 `border-radius`
 * 却只字未提 `--dsh-tb-scroll-inset`，那它一定会犯这个错——与内容多长、窗口多宽、
 * 谁在什么设备上看都无关。所以它读源码就够，能进 `pnpm verify`。
 * 反过来「量它到底越界了几个像素」是几何判据，进不了静态门禁（那是 `shot-panel` 的事）。
 *
 * ── 判据按**承载盒**合并，不按单条规则 ────────────────────────────────────────
 *
 * 圆角与滚动经常不在一条规则里：`textarea.input` 声明「会滚」，而圆角在 `.input`
 * 那一条。单条规则去判，就会漏掉截图里那个框本身。所以判据按**承载盒**（末段
 * compound 的类，见 `css-core.mjs` 的 `holderClassesOf`）把同一张表里同名盒子的
 * 声明合起来看——这与 `verify-fixed-height-wrap.mjs` 是同一读法：一条属性在别处
 * 被声明，与写在同一个块里等价。
 *
 * ── 这条判据的边界（写下来，免得下一个人以为它看得更全） ────────────────────
 *
 *   - 它只认 `--dsh-tb-scroll-inset` 这个变量名。用别的写法达到同一效果（给滚动体
 *     加一层方角内衬）是靠 `border-radius: 0` 让判据放行的——那也确实没有这个病。
 *   - `border-radius: inherit` / `0` / `initial` / `unset` **放行**：继承解析到 0 时
 *     盒子是方的，没有弧可以越。
 *   - 它**不判断缩进量对不对**。缩进写 `1px` 也能过。量对不对是几何判据的事；
 *     静态判据只回答「有没有声明」。
 *   - 兄弟作用域（两个可同时成立的 `@media`）各自合并，不互链——与本仓库另外两条
 *     按作用域合并的门禁保持同一条近似。
 *
 * 用法：`node scripts/verify-scroll-corner.mjs [根目录]`
 * 自测：`--probe-scroll-corner`（种五条：三对本对错，必须全部读对）
 */
import { existsSync } from 'node:fs'
import { rulesOf, declOf, holderClassesOf, declsOf } from './css-core.mjs'
import { clientSheetFiles } from './sheet-files.mjs'
import { probeOf } from './probe-args.mjs'

/**
 * 滚动条轨道缩进的**唯一变量名**。
 *
 * 共享层（`design/base.module.css`）读它，各页面表声明它。写两处名字的那天，
 * 其中一处会失效而屏上不说话——这就是它被导出成一个常量的原因。
 */
export const SCROLL_INSET_VAR = '--dsh-tb-scroll-inset'

/**
 * 一条 `border-radius` 的值是不是**画出了一个圆角**。
 *
 * 只有「明确的零」和「继承来的零」是方的：
 *   - `0` / `0px` / `initial` / `unset` → 放行（没有弧）；
 *   - `inherit` → 放行。它会解析到父元素，而判据在静态层面读不到父元素的值；
 *     本仓库里唯一的 `inherit` 挂在 `.reviewTranscriptScroll` 上，父级是方角的
 *     `.reviewMain`。放行它换来的是**不误报**，代价是「继承到一个圆角父级」这一
 *     形状看不见——那个形状今天不存在，写下来。
 *   - 其余（`var(--x)` / `8px` / `50%`）→ 画出了圆角。
 * @param value - `border-radius` 的声明值（或 undefined）。
 * @returns 是否画出了圆角。
 */
export function roundsCorners(value) {
  if (value === undefined) return false
  const first = value.trim().split(/\s+/)[0] ?? ''
  if (first === '' ) return false
  if (/^(0|0px|initial|unset|inherit)$/i.test(first)) return false
  return true
}

/**
 * 一个声明块里**任何一条**会画圆角的半径声明（含四角长写）。
 *
 * **长写必须一起认。** 只写 `border-bottom-right-radius` 的盒子，右下角是圆的、
 * 滚动条照样越出去——而只读 `border-radius` 简写的判据看不见它。角落恰恰是这条
 * 缺陷发生的那个角，所以漏掉长写等于漏掉一半现场。
 * @param body - 规则体。
 * @returns 画了圆角的那些半径声明值（空数组 = 方的）。
 */
export function radiusValuesOf(body) {
  const out = []
  for (const decl of declsOf(body)) {
    if (!/^border(-(start|end)-(start|end)|-(top|bottom)-(left|right))?-radius$/.test(decl.property)) continue
    if (roundsCorners(decl.value)) out.push(decl.value)
  }
  return out
}

/**
 * 一条声明块是不是**会滚**。
 *
 * 两种写法都认：`overflow-y: auto|scroll`，或 `overflow` 简写里含这两个值
 * （`.itemProse` 用的就是 `overflow: auto`）。
 * @param body - 规则体。
 * @returns 是否滚动。
 */
export function scrollsVertically(body) {
  const overflowY = declOf(body, 'overflow-y')
  if (overflowY === 'auto' || overflowY === 'scroll') return true
  const overflow = declOf(body, 'overflow')
  return overflow !== undefined && /\b(auto|scroll)\b/.test(overflow)
}

/**
 * 一条规则体是不是声明了这个变量（哪怕值是 0）。
 * @param body - 规则体。
 * @returns 是否声明。
 */
export function declaresInset(body) {
  return declsOf(body).some((decl) => decl.property === SCROLL_INSET_VAR)
}

/**
 * 把一张表里**同一个承载盒**的全部声明合起来。
 *
 * 这是判据能看见 `textarea.input` 的前提：它声明「会滚」，圆角却在 `.input` 那条。
 * 按单条规则判，截图里那个框本身会被漏掉。
 * @param css - 一张表的文本。
 * @returns `Map<承载盒类名, 合并后的声明文本>`。
 */
export function mergedHolders(css) {
  const holders = new Map()
  for (const rule of rulesOf(css)) {
    for (const group of holderClassesOf(rule.selector)) {
      /* 一个 compound 上的多个类属于**同一个盒子**（`.a.b` 选中的是同时有这两个类的
         元素），所以它们共享一份合并声明。 */
      const key = group.join('.')
      if (key === '') continue
      holders.set(key, `${holders.get(key) ?? ''};${rule.body}`)
    }
  }
  return holders
}

/**
 * 一张表里所有「画了圆角、会滚、却没声明轨道缩进」的承载盒。
 * @param css - 一张表的文本。
 * @returns 承载盒类名数组（排序、去重）。
 */
export function offendersIn(css) {
  const out = []
  for (const [holder, body] of mergedHolders(css)) {
    if (!scrollsVertically(body)) continue
    if (radiusValuesOf(body).length === 0) continue
    if (declaresInset(body)) continue
    out.push(holder)
  }
  return out.sort()
}

if (probeOf(['--probe-scroll-corner']) === '--probe-scroll-corner') {
  const planted = [
    /* 合法：会滚、画圆角、声明了缩进。 */
    '.ok { overflow-y: auto; border-radius: 14px; --dsh-tb-scroll-inset: 14px; }',
    /* 合法：会滚，但盒子是方的——没有弧可以越。 */
    '.ok2 { overflow-y: auto; border-radius: 0; }',
    /* 合法：会滚、有半径写法，但半径是继承来的（解析不到就是 0）。 */
    '.ok3 { overflow-y: auto; border-radius: inherit; }',
    /* 违规：会滚、画圆角、只字未提缩进。 */
    '.bad { overflow-y: auto; border-radius: 14px; }',
    /* 违规：同一件事的另一种写法——只给右下角一个长写半径（缺陷就在那个角）。 */
    '.bad2 { overflow: auto; border-bottom-right-radius: 10px; }',
  ]
  /* 违规的那两条各自单独一张表，免得 `.ok` 的声明被合并进同一个承载盒。 */
  const read = planted.map((one) => offendersIn(one))
  const expected = [[], [], [], ['bad'], ['bad2']]
  if (JSON.stringify(read) !== JSON.stringify(expected)) {
    console.error(`verify-scroll-corner self-test FAILED: expected ${JSON.stringify(expected)}, read ${JSON.stringify(read)}`)
    process.exit(1)
  }
  /* 第二组：圆角与滚动**不在同一条规则**里（截图里那个输入框的真实形状）。
     单条规则去判会漏，合并承载盒才看得见。 */
  const split = [
    '.field { border-radius: 14px; }',
    'textarea.field { overflow-y: auto; }',
  ].join('\n')
  if (offendersIn(split).join(',') !== 'field') {
    console.error('verify-scroll-corner self-test FAILED: 圆角与会滚分在两条规则里时，合并承载盒应报出 field')
    process.exit(1)
  }
  console.log('verify-scroll-corner self-test OK: 7 planted rule(s) read as expected (a declared inset, a square box and an inherited radius pass; the same defect is caught whether the radius shares its rule with the scroll or not)')
  process.exit(0)
}

const root = process.argv[2] ?? '.'
const findings = []
let checked = 0
for (const sheet of clientSheetFiles(root)) {
  for (const holder of offendersIn(sheet.css)) {
    findings.push(`${sheet.rel}: .${holder} 会滚、画了圆角，却没有声明 ${SCROLL_INSET_VAR}——它的滚动条滑块会跑到圆角那段弧上`)
  }
  checked += mergedHolders(sheet.css).size
}

if (findings.length > 0) {
  console.error(`verify-scroll-corner FAILED: ${findings.length} finding(s)`)
  console.error('')
  console.error('  滚动条永远跑在一条方角的轨道上，而盒子右下角是圆的。轨道铺到那截弧上时，')
  console.error('  滑块就压在弧外面——读者说的是「滚动条的头要冲出来」。')
  console.error('')
  console.error('  修法是把轨道两头缩一档（不是加一层外框）：在那个盒子上声明')
  console.error(`    ${SCROLL_INSET_VAR}: var(--dsh-tb-radius-md);   /* 或它自己那一档圆角 */`)
  console.error('  共享层的轨道规则会读它。方角的盒子不需要声明。')
  console.error('')
  for (const one of findings) console.error(`  - ${one}`)
  process.exit(1)
}

console.log(`verify-scroll-corner OK: ${checked} 个承载盒检查过；每一个画了圆角的滚动体都声明了轨道缩进，所以没有滑块能跑到弧外面`)
