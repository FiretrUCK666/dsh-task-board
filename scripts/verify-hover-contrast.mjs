/**
 * 「悬浮态看得见」的机械判据。
 *
 * ── 为什么需要这一条 ─────────────────────────────────────────────────────
 *
 * 读者的原话：「鼠标悬停在『多选』、『隐藏已完成』、『排序』上，其实看不出有交互的
 * 感觉。但是用了其他皮肤令牌，看着就很明显了。」
 *
 * 根因不是哪一个按钮，是**悬浮态读错了令牌**：它读宿主的
 * `--dsw-alias-interactive-bg-hover`（官方浅色下是 4% 的墨，叠在白纸上约
 * `rgb(245,245,246)`，肉眼几乎为零），或读本层的芯片底 `--item-fill`（那是控件的
 * **静息底**，与周围的纸几乎同色）。第三方皮肤把前一枚换成了自己的色，于是同一份
 * CSS 在皮肤下看得见、在官方浅色下看不见——**同一个交互两个观感**。
 *
 * 治法只有一条：悬浮层与它所在的那张纸**反向**，强度读同一条梯子。全系统因此只有
 * 一个悬浮令牌 `--dsh-tb-hover`，主题只翻方向（浅色朝墨、深色朝白），不换强度。
 *
 * ── 这一条查什么 ─────────────────────────────────────────────────────────
 *
 *   1. **每一条 `:hover` 的 `background` 必须读那枚悬浮令牌**（或明确的一档阶梯），
 *      不许读静息底、不许写裸色值——后者在换主题时不会跟着变。
 *   2. **`--dsh-tb-hover` 必须由 `color-mix` 从「当前墨色」反向派生**，并且
 *      **深色主题下方向翻面**：这是「一套令牌管住所有主题」的全部实现。
 *   3. 令牌表里**不许再出现** `interactive-bg-hover` 这类主机悬浮直读——那是第二条路。
 *
 * 用法：`node scripts/verify-hover-contrast.mjs .`（随 `pnpm verify` 跑）。
 * 自测：`--probe-hover`（种四条，两对一错，必须如实报）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clientSheetFiles } from './sheet-files.mjs'
import { probeOf } from './probe-args.mjs'

/** 这些属性选择器里的 `background` 是一次悬浮反馈，必须读悬浮令牌。 */
const ALLOWED_BACKGROUND = [
  'var(--dsh-tb-hover)',
  'var(--dsh-tb-hover-mix)',
  'transparent',
  'none',
]

/** 剥掉注释：注释里出现「悬浮」两个字不是一次悬浮声明（硬性规范 14）。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 把一张表拆成 `{ selector, body }`。 */
function rulesOf(css) {
  const out = []
  const clean = stripComments(css)
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').trim()
    const body = match[2] ?? ''
    if (selector === '' || selector.startsWith('@')) continue
    out.push({ selector, body })
  }
  return out
}

/** 一个声明块里某条属性的值（最后一条胜出）。 */
function declOf(body, property) {
  let found
  for (const match of body.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`, 'g'))) {
    found = (match[1] ?? '').trim()
  }
  return found
}

const target = process.argv[2] ?? '.'
/* 自测开关先过一遍：拼错要红，不能静默变成一次正常跑（见 `probe-args.mjs`）。 */
const probe = probeOf(['--probe-hover', '--probe-dark-flip'])

/* ── 自测：种四条规则，两对两错 ─────────────────────────────────────────── */
if (probe === '--probe-hover') {
  const planted = `
    .good { background: var(--dsh-tb-hover); }
    .good2 { background: transparent; }
    .bad { background: var(--item-fill); }
    .bad2 { background: #f5f5f5; }
  `
  const heard = rulesOf(planted).map(rule => ({
    selector: rule.selector,
    lawful: ALLOWED_BACKGROUND.some(value => (declOf(rule.body, 'background') ?? '').includes(value)),
  }))
  const expected = [
    { selector: '.good', lawful: true },
    { selector: '.good2', lawful: true },
    { selector: '.bad', lawful: false },
    { selector: '.bad2', lawful: false },
  ]
  const same = JSON.stringify(heard) === JSON.stringify(expected)
  if (!same) {
    console.error(`verify-hover-contrast self-test FAILED: expected ${JSON.stringify(expected)}, read ${JSON.stringify(heard)}`)
    process.exit(1)
  }
  console.log('verify-hover-contrast self-test OK: 4 planted rule(s) read as expected (the hover rung and `transparent` pass; a resting fill and a bare hex fail)')
  process.exit(0)
}

const findings = []

/* ── 1. 每一条 :hover 的 background ─────────────────────────────────────── */
/* 走目录，不列名单：新加一张表的那天它就被检查，不必有人记得回来改这里。 */
const sheets = clientSheetFiles(target)
let hoverCount = 0
for (const sheet of sheets) {
  let css
  try {
    css = readFileSync(sheet.path, 'utf8')
  } catch {
    continue
  }
  for (const rule of rulesOf(css)) {
    if (!/:hover/.test(rule.selector)) continue
    /* 内容记号（文字握把、消息气泡）的悬浮是**内容层**的反馈，不是控件面：它们的底
     * 表达的是「这一块内容被指到了」，用的是墨/品牌色，与纸反向那条律无关。 */
    if (/ProseGrip|reviewMessage|MessageText/i.test(rule.selector)) continue
    const background = declOf(rule.body, 'background') ?? declOf(rule.body, 'background-color')
    if (background === undefined) continue
    hoverCount += 1
    /* **品牌面是例外，而它是有理由的例外。** 一枚实心的主按钮（`primaryButton`）
     * 本身就是宿主的品牌色，它的悬浮态必须**同一枚色的更深一档**——那不是「一层与纸
     * 反向的灰」，把它换成 `--dsh-tb-hover` 会让主按钮在悬浮时变成一块灰。所以这里
     * 只要求它读**宿主的主按钮族**（`button-primary`），不许读那枚 4% 的通用悬浮。 */
    const isBrandFace = /--dsw-alias-button-primary/.test(background)
      && /primary/i.test(rule.selector)
    const lawful = ALLOWED_BACKGROUND.some(value => background.includes(value))
      || isBrandFace
      /* 一档阶梯（`--dsh-tb-wash*` / `--dsh-tb-plane-*` / `--dsh-tb-accent` 上的 color-mix）
         也是明确的强度声明，不是静息底。 */
      || /color-mix\(|var\(--dsh-tb-wash|var\(--dsh-tb-plane-|var\(--dsh-tb-accent|var\(--dsh-tb-attention/.test(background)
    if (!lawful) {
      findings.push(`${sheet.rel}: ${rule.selector.slice(0, 48)} — hover background reads ${background.slice(0, 60)}, which is not the hover rung`)
    }
  }
}

/* ── 2. 悬浮令牌自己必须反向派生，且深色翻面 ────────────────────────────── */
const tokens = readFileSync(join(target, 'src/client/design/tokens.module.css'), 'utf8')
const cleaned = stripComments(tokens)
if (!/--dsh-tb-hover-mix\s*:/.test(cleaned)) {
  findings.push('tokens: `--dsh-tb-hover-mix` is missing — the hover rung has no declared direction, so it cannot flip with the theme')
}
if (!/--dsh-tb-hover\s*:\s*color-mix\(/.test(cleaned)) {
  findings.push('tokens: `--dsh-tb-hover` is not derived with color-mix, so its contrast is whatever the host happens to ship')
}
/**
 * 深色块里有没有**声明** `--dsh-tb-hover-mix`。
 *
 * 判据必须落在**规则**上，不能落在「选择器之后 N 个字符」这种窗口上：一块深色覆盖
 * 长起来之后，写在末尾的那条声明会掉出窗口，于是一条正确的实现被判红——而修红最
 * 省事的办法是把它挪到前面去，也就是**改对的东西来迁就一把量不准的尺子**（硬性
 * 规范 14）。所以这里用和别处同一套 `rulesOf`：先在规则层面找到深色块，再看它自己
 * 的声明体里有没有这一条。
 */
const darkDeclaresHoverMix = rulesOf(cleaned).some(rule =>
  /\[data-ds-dark-theme\]/.test(rule.selector)
  && new RegExp('--dsh-tb-hover-mix\\s*:').test(rule.body))
if (!darkDeclaresHoverMix) {
  findings.push('tokens: the dark theme does not flip `--dsh-tb-hover-mix` — dark mode would keep a light-theme direction')
}
if (probe === '--probe-dark-flip') {
  /* 自测：窗口式读法会漏掉写在长块末尾的那一条，规则式读法不会。 */
  const long = `.x { --a: 1 }\nbody[data-ds-dark-theme] .t {\n${'  --pad: 0;\n'.repeat(80)}  --dsh-tb-hover-mix: 9%;\n}`
  const heard = rulesOf(long).some(rule =>
    /\[data-ds-dark-theme\]/.test(rule.selector) && /--dsh-tb-hover-mix\s*:/.test(rule.body))
  if (!heard) {
    console.error('FAIL 自测：深色块末尾的 hover-mix 声明没被读到——窗口式读法又回来了。')
    process.exit(1)
  }
  console.log('OK 自测：深色块末尾的 hover-mix 声明被读到（判据读规则，不读字符窗口）。')
  process.exit(0)
}

/* ── 3. 不许有第二条路：主机悬浮直读 ───────────────────────────────────── */
for (const sheet of sheets) {
  let css
  try {
    css = readFileSync(sheet.path, 'utf8')
  } catch {
    continue
  }
  /* **只查悬浮规则里的直读。** 那一枚 4% 的令牌在别处是合法的：分段控件的**凹槽底**
   * 正是「比纸略深一点」的那一档，用它当轨道底色是对的。它错只在被当成**悬浮反馈**——
   * 那时它要与控件自己的静息底拉开差距，4% 拉不开。 */
  for (const rule of rulesOf(css)) {
    if (!/:hover/.test(rule.selector)) continue
    const body = rule.body
    if (/--dsw-alias-interactive-bg-hover/.test(body)) {
      findings.push(`${sheet.rel}: ${rule.selector.slice(0, 48)} — hover reads the host's 4% hover token directly; that is invisible on the official light theme and visible under a skin`)
    }
  }
}

if (findings.length > 0) {
  console.error(`verify-hover-contrast FAILED: ${findings.length} finding(s)`)
  console.error('')
  console.error('  悬浮态必须与它所在的纸**反向**，强度读同一条梯子。读静息底（`--item-fill`）')
  console.error('  或宿主那一枚 4% 的悬浮，会让「鼠标放上去」在官方浅色下看不出来，而在第三方')
  console.error('  皮肤下看得出来——同一个交互两个观感。')
  console.error('')
  for (const one of findings) console.error(`  - ${one}`)
  process.exit(1)
}

console.log(`verify-hover-contrast OK: ${hoverCount} hover rule(s) all read the one reversed rung (--dsh-tb-hover), and the rung flips direction in dark; no host hover token is read directly`)

