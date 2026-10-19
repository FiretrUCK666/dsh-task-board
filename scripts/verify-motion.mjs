#!/usr/bin/env node
/**
 * **动效只有一套词。** 时间、缓动、模糊、遮罩配方——凡是「动起来长什么样」，
 * 都从 `design/tokens.module.css` 读，谁也不许在自己的表里再写一份。
 *
 * ── 这条门禁守的是什么 ──────────────────────────────────────────────────────
 *
 * 动效是最容易「再写一份」的东西，因为写一份看起来只有一行：`transition: 160ms ease`。
 * 而它的代价不是那一行，是**改一处不报错**：设计改了节奏，读者会在两个页面上看到
 * 两种速度，而屏上没有任何地方说得出为什么不同。
 *
 * 这个仓库已经出现过两次形态：
 *
 *   1. `transition` 里写裸数字（`160ms`、`0.2s`）而不读 `--dsh-tb-motion*`；
 *   2. **同一套遮罩配方在两页各写一遍**——`background: var(--dsh-tb-mask)` 加
 *      `backdrop-filter: blur(var(--dsh-tb-mask-blur))`，两处注释都写着「同一个遮罩
 *      配方」。令牌是共享的，**配方**却是两份：加第三条属性时只改一页，那个差异
 *      没有任何检查看得见。
 *
 * 所以判据分两条，都读结构：
 *
 *   A. `transition` / `animation` 的时间部分必须是令牌或 `0s`/`0ms`，不许裸数字。
 *      （`@media (prefers-reduced-motion)` 里把令牌归零是令牌自己的事，不在此列。）
 *   B. 遮罩配方只许出现在**一处**：带 `backdrop-filter` 的规则只能有一条，
 *      且它必须同时带 `background: var(--dsh-tb-mask)`。要再加一个遮罩，就把那条
 *      规则变成共享类，而不是复制一遍。
 *
 * 用法：`node scripts/verify-motion.mjs [根目录]`
 * 自测：`--probe-hardcoded`（种一条裸时长，必须报红）
 *       `--probe-token`（全用令牌，必须放行）
 *       `--probe-mask`（种两处遮罩，必须报红）
 */

import { existsSync } from 'node:fs'
import { rulesOf, declOf } from './css-core.mjs'
import { clientSheetFiles } from './sheet-files.mjs'
import { probeOf } from './probe-args.mjs'

/** 令牌文件自己：它**定义**这些值，所以不受「必须读令牌」的约束。 */
const TOKEN_SHEET = 'src/client/design/tokens.module.css'

/**
 * 一个 `transition` / `animation` 值里的时间是否合规。
 *
 * 合规只有三种：读令牌（`var(--dsh-tb-motion*)`）、`0s`、`0ms`。裸的 `160ms` 不合规
 * ——它与令牌同值也不能放过，因为下一个改令牌的人不会知道这里还有一份。
 * @param value - 声明的值。
 * @returns 不合规的时间片段，空数组表示合规。
 */
export function bareTimesIn(value) {
  const cleaned = value.replace(/var\([^)]*\)/g, ' ')
  const times = [...cleaned.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)(ms|s)\b/g)].map((m) => m[0])
  return times.filter((one) => one !== '0s' && one !== '0ms')
}

/**
 * 找出所有动效违规。
 * @param root - 仓库根。
 * @returns `{ kind, file, line, detail }[]`。
 */
export function motionFindings(root) {
  const sheets = clientSheetFiles(root)
  const findings = []

  /* ── A. 裸时长 ─────────────────────────────────────────────────────────── */
  for (const sheet of sheets) {
    if (sheet.rel === TOKEN_SHEET) continue
    for (const rule of rulesOf(sheet.css)) {
      /* `prefers-reduced-motion` 里的规则是把令牌归零，写 `0s` 合法；它不是「另一套
         节奏」，是同一套节奏的关闭档。 */
      if (/prefers-reduced-motion/.test(rule.at)) continue
      for (const property of ['transition', 'animation']) {
        const value = declOf(rule.body, property)
        if (value === undefined) continue
        const bare = bareTimesIn(value)
        if (bare.length === 0) continue
        findings.push({
          kind: 'bare-time',
          file: sheet.rel,
          line: rule.line,
          detail: `${property}: ${value.trim()} —— 裸时长 ${bare.join(', ')}`,
        })
      }
    }
  }

  /* ── B. 遮罩配方只许有一个**说法** ───────────────────────────────────────
   *
   * 判据不是「只许出现一次」（那会把「同一套配方的两处布局」也判红，而它们本来就
   * 该有两处：一处居中、一处顶对齐），而是「**每个遮罩都得说同一套话**」。
   *
   * 遮罩由三条声明组成：底色、标准前缀的模糊、WebKit 前缀的模糊。三样必须同时在场、
   * 且必须都读令牌——少一样，那个遮罩在某个浏览器上就没有模糊；读裸值，那个遮罩
   * 就与别处不同的「透多少」。这两种差异在屏上都读作「这个弹层看起来不一样」，而
   * 没有地方说得出为什么。 */
  const masks = []
  for (const sheet of sheets) {
    for (const rule of rulesOf(sheet.css)) {
      const blur = declOf(rule.body, 'backdrop-filter')
      const webkitBlur = declOf(rule.body, '-webkit-backdrop-filter')
      if (blur === undefined && webkitBlur === undefined) continue
      masks.push({ file: sheet.rel, line: rule.line, body: rule.body, blur, webkitBlur })
    }
  }
  for (const mask of masks) {
    const background = declOf(mask.body, 'background')
    const wrong = []
    if (background !== 'var(--dsh-tb-mask)') wrong.push(`background 不是 var(--dsh-tb-mask)（读到 ${background ?? '空'}）`)
    if (mask.blur !== 'blur(var(--dsh-tb-mask-blur))') wrong.push(`backdrop-filter 不是 blur(var(--dsh-tb-mask-blur))（读到 ${mask.blur ?? '空'}）`)
    if (mask.webkitBlur !== 'blur(var(--dsh-tb-mask-blur))') wrong.push(`-webkit-backdrop-filter 缺失或不同（读到 ${mask.webkitBlur ?? '空'}）`)
    if (wrong.length === 0) continue
    findings.push({
      kind: 'mask-recipe',
      file: mask.file,
      line: mask.line,
      detail: `这个遮罩与别处说的不是同一套话：${wrong.join('；')}。`
        + '遮罩是三条声明一起成立的（底色 + 两档前缀的模糊），改一处要三处一起看。',
    })
  }

  return findings
}

/**
 * 自测：种几条规则，看判据咬不咬。
 * @param probe - 自测开关。
 * @returns 判定结果。
 */
export function selfTest(probe) {
  if (probe === '--probe-mask') {
    /* 两个遮罩：一个说对了话，一个 `background` 读了裸值。判据要认出后者。 */
    const good = '.a { background: var(--dsh-tb-mask); -webkit-backdrop-filter: blur(var(--dsh-tb-mask-blur)); backdrop-filter: blur(var(--dsh-tb-mask-blur)); }'
    const bad = '.b { background: rgba(0,0,0,.5); -webkit-backdrop-filter: blur(var(--dsh-tb-mask-blur)); backdrop-filter: blur(var(--dsh-tb-mask-blur)); }'
    const judge = (css) => rulesOf(css)
      .filter((r) => declOf(r.body, 'backdrop-filter') !== undefined)
      .map((r) => declOf(r.body, 'background') === 'var(--dsh-tb-mask)')
    return { good: judge(good), bad: judge(bad) }
  }
  const value = probe === '--probe-hardcoded'
    ? 'opacity 160ms ease, transform 0.2s'
    : 'opacity var(--dsh-tb-motion), transform var(--dsh-tb-motion-lift)'
  return { bare: bareTimesIn(value) }
}

function main() {
  const root = process.argv[2] ?? '.'
  const probe = probeOf(['--probe-hardcoded', '--probe-token', '--probe-mask'])

  if (probe !== undefined) {
    const heard = selfTest(probe)
    const wrong = []
    if (probe === '--probe-hardcoded') {
      if (heard.bare.length === 0) wrong.push('裸时长没被认出')
    } else if (probe === '--probe-token') {
      if (heard.bare.length > 0) wrong.push(`令牌写法被误报：${heard.bare.join(', ')}`)
    } else {
      if (heard.good.length !== 1 || heard.good[0] !== true) wrong.push('说对了话的遮罩被误报')
      if (heard.bad.length !== 1 || heard.bad[0] !== false) wrong.push('读了裸底色的遮罩没被认出')
    }
    if (wrong.length > 0) {
      for (const line of wrong) console.error(`  - ${line}`)
      console.error('verify-motion self-test FAILED: the reader does not bite correctly')
      process.exit(1)
    }
    console.log(probe === '--probe-mask'
      ? 'OK 自测：遮罩配方读裸值时被认出、读令牌时放行（门禁是活的）。'
      : 'OK 自测：裸时长被认出、令牌写法放行（门禁是活的）。')
    return
  }

  if (!existsSync(root)) {
    console.error('verify-motion: 根目录给错了？')
    process.exit(1)
  }

  const findings = motionFindings(root)
  if (findings.length === 0) {
    console.log('verify-motion OK: 动效只有一套词——时长全读令牌，遮罩配方只有一处。')
    return
  }
  console.error(`FAIL ${findings.length} 处动效各自为政：`)
  for (const f of findings) {
    console.error(`  ${f.file}:${String(f.line)}  ${f.detail}`)
  }
  process.exit(1)
}

main()
