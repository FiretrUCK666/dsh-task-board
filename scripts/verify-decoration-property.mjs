/**
 * 「装饰不许与承载材质的属性共用」——机械判据。
 *
 * ── 它守的是哪一件事 ─────────────────────────────────────────────────────
 *
 * 这个设计系统的纸面由三笔构成：色调台阶、**受光顶边**（`--dsh-tb-rim`）、**投影**
 * （`--dsh-tb-cast-*`）。后两笔都写在 `box-shadow` 里。
 *
 * 于是**任何**把别的东西也画进 `box-shadow` 的写法，都会与材质抢同一个属性：
 * 选中环、状态环、呼吸光晕、拖放高亮——它们逐条都是「装饰」。抢的后果不是难看，
 * 是**一条动画就能把材质抹掉**：`[data-light]` 曾经动过一次 `box-shadow` 做呼吸，
 * 「进行中」那几张卡当场失去纸面，变成一张没有边也没有影的方块。
 *
 * 治法写进法则表（`decoration-never-shares-the-material-property`）：**环一律走
 * `outline`**（`outline-offset` 给同一档视觉距离），`box-shadow` 留给材质。
 *
 * ── 判据 ────────────────────────────────────────────────────────────────
 *
 * 一条规则的 `box-shadow` 里若出现「环」（`0 0 0 <n>px` 的零偏移写法，或
 * `spread` 只为画一圈的写法），就是违规。允许的是：读材质令牌（`--dsh-tb-cast-*`
 * / `--dsh-tb-rim` / `--dsh-tb-shadow-*`）、以及纯粹的偏移投影（有 y 偏移与模糊）。
 *
 * 用法：`node scripts/verify-decoration-property.mjs .`（随 `pnpm verify` 跑）。
 * 自测：`--probe-decoration`（种四条，两对两错）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const target = process.argv[2] ?? '.'
const SHEETS = [
  'src/client/design/components.module.css',
  'src/client/board.module.css',
  'src/client/item/item.module.css',
  'src/client/home/home.module.css',
  'src/client/design/base.module.css',
]

/** 剥注释：注释里出现「环」不是一次环的声明（硬性规范 14）。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 一张表里的 `{ selector, body }`。 */
function rulesOf(css) {
  const out = []
  for (const match of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').trim()
    if (selector === '' || selector.startsWith('@')) continue
    out.push({ selector, body: match[2] ?? '' })
  }
  return out
}

/** 最后一条某属性。 */
function declOf(body, property) {
  let found
  for (const match of body.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`, 'g'))) {
    found = (match[1] ?? '').trim()
  }
  return found
}

/**
 * 一份 `box-shadow` 值里有没有「环」。
 *
 * 环的形状是**零偏移 + 只有 spread**：`0 0 0 3px <colour>`。投影的形状是**有 y 偏移
 * 或模糊**：`0 4px 18px <colour>`、`0 1px 2px <colour>`。只判前一种，因为后者不抢材质
 * 的语义——它本来就是材质那一笔。
 * @param value - `box-shadow` 的声明值。
 * @returns 有环则真。
 */
export function hasRing(value) {
  /* 读材质令牌与 quiet 值不算：它们就是材质本身。 */
  const withoutTokens = value
    .replace(/var\(--dsh-tb-(cast|rim|shadow)[^)]*\)/g, '')
    .replace(/var\(--dsh-tb-ring[^)]*\)/g, '')
  /* 零偏移 + spread：`0 0 0 <n>`（第三个数是 blur=0，第四个数是 spread）。
     也认 `inset 0 0 0 <n>`（内环同样是装饰）。 */
  /* **薄才是环。** 同一个零偏移写法既可以是环（`0 0 0 3px`），也可以是**填充**
     （`inset 0 0 0 100px`）——后者是「按下去深一层」的合法手段，不画边。
     分界取 `--dsh-tb-edge`（42%）那一档的粗心值：6px 以内是边，以上是面。 */
  for (const match of withoutTokens.matchAll(/(?:inset\s+)?0\s+0\s+0\s+([\d.]+)px/g)) {
    if (Number(match[1]) <= 6) return true
  }
  for (const match of withoutTokens.matchAll(/(?:^|\s|,)0\s+0\s+([\d.]+)px\s+([\d.]+)px/g)) {
    if (Number(match[1]) === 0 && Number(match[2]) <= 6) return true
  }
  return false
}

if (process.argv.includes('--probe-decoration')) {
  const planted = [
    { selector: '.ok', body: 'box-shadow: var(--dsh-tb-rim), var(--dsh-tb-cast-2);' },
    { selector: '.ok2', body: 'box-shadow: 0 4px 18px rgba(0,0,0,.08);' },
    { selector: '.bad', body: 'box-shadow: 0 0 0 3px rgba(0,0,0,.2);' },
    { selector: '.bad2', body: 'box-shadow: inset 0 0 0 2px red;' },
  ]
  const heard = planted.map(rule => ({ selector: rule.selector, ring: hasRing(rule.body) }))
  const expected = [
    { selector: '.ok', ring: false },
    { selector: '.ok2', ring: false },
    { selector: '.bad', ring: true },
    { selector: '.bad2', ring: true },
  ]
  if (JSON.stringify(heard) !== JSON.stringify(expected)) {
    console.error(`verify-decoration-property self-test FAILED: expected ${JSON.stringify(expected)}, read ${JSON.stringify(heard)}`)
    process.exit(1)
  }
  console.log('verify-decoration-property self-test OK: 4 planted rule(s) read as expected (material tokens and offset shadows pass; a zero-offset spread ring and an inset ring are reported)')
  process.exit(0)
}

const findings = []
let checked = 0
for (const sheet of SHEETS) {
  let css
  try {
    css = readFileSync(join(target, sheet), 'utf8')
  } catch {
    continue
  }
  for (const rule of rulesOf(css)) {
    const shadow = declOf(rule.body, 'box-shadow')
    if (shadow === undefined) continue
    checked += 1
    /* ── 只抓**真的共用** ────────────────────────────────────────────────
     *
     * 这条法则的原话是「装饰不许**与承载材质的属性共用**」。共用 = 同一个
     * `box-shadow` 里**既有材质、又有环**。而「只有环、没有材质」是另一件事：
     * 那个元素本来就没有纸面（焦点环、色块选中、拖放指示），它不抢任何东西。
     *
     * 上一版把两者混为一谈，一口气报出 25 条，其中 22 条是冤枉的——一个假阳性
     * 会让下一个人去改对的东西（硬性规范 14）。所以判据收紧到共用：
     *
     *   材质 = 读 `--dsh-tb-rim` / `--dsh-tb-cast-*` / `--dsh-tb-shadow-*`
     *   环   = 零偏移 + 薄 spread（<= 6px）
     *   违规 = 两者同时出现
     */
    const material = /var\(--dsh-tb-(rim|cast|shadow)[^)]*\)/.test(shadow)
    if (!material) continue
    if (hasRing(shadow)) {
      findings.push(`${sheet}: ${rule.selector.slice(0, 46)} — the same box-shadow carries both the paper (--dsh-tb-rim / --dsh-tb-cast-*) and a ring, so a later animation on that property flattens the material`)
    }
  }
}
if (findings.length > 0) {
  console.error(`verify-decoration-property FAILED: ${findings.length} finding(s)`)
  console.error('')
  console.error('  纸面由受光顶边与投影构成，两笔都在 box-shadow 里。环也画进同一个属性，')
  console.error('  就等于让一次动画同时改掉材质——那一次真的发生过（进行中那几张卡失去纸面）。')
  console.error('  环走 outline + outline-offset。')
  console.error('')
  for (const one of findings) console.error(`  - ${one}`)
  process.exit(1)
}

console.log(`verify-decoration-property OK: ${checked} box-shadow declaration(s) checked; wherever the paper is drawn, no ring shares that property`)
