/**
 * 「滚动区不许有固定地板」的机械判据。
 *
 * ── 它守的那一条真事 ─────────────────────────────────────────────────────
 *
 * 读者的原话是「那个滚动条的头感觉要突破天际」——会话上下文那一块，滚动条从
 * 卡片的圆角里长出来，一路画到面板顶上。
 *
 * 根因不是滚动条样式，是一个**固定地板**：
 *
 * ```css
 * .reviewTranscriptScroll { flex: 1; min-height: 120px; overflow-y: auto; }
 * ```
 *
 * `flex: 1` 说的是「占满剩下的空间」，而 `min-height: 120px` 说的是「无论如何
 * 不许比 120 矮」。在一台矮屏手机（视口 1568、导航吃掉 300 多，内容区只剩几百）
 * 上，那个 120 比它所在的列还高 —— 于是滚动区**长出卡片之外**，滚动条跟着出去。
 *
 * 而 flex 项的下限**默认就是内容高**，所以「让它能让位」的唯一写法是
 * `min-height: 0`。写一个 px 地板在任何「容器可能比它矮」的地方都是同一个 bug，
 * 只是发作得早晚不同。
 *
 * ── 判据 ────────────────────────────────────────────────────────────────
 *
 * 一条规则同时满足下面三条就算违规：
 *
 *   1. 它是**滚动容器**（`overflow-y: auto|scroll`，或简写 `overflow` 含这两个值）；
 *   2. 它是 **flex 项**（`flex` 或 `flex-grow` 非零，或 `display: flex` 的父级里
 *      明确写了 `flex: 1`）；
 *   3. 它声明了一个 **px 的 `min-height`**（或 `min-block-size`）。
 *
 * 不判 `min-width`：横向的地板不会被视口高度压塌，那一条没有同一个病。
 *
 * 用法：`node scripts/verify-scroll-floor.mjs [根目录]`（随 `pnpm verify` 跑）。
 * 自测：`--probe-scroll-floor`（种四条，两对两错）。
 *
 * **自测开关必须经 `probe-args.mjs` 读。** 这里原先是 `process.argv.includes(…)`，
 * 而它对着一串不存在的字样回答 false —— 于是
 * `node scripts/verify-scroll-floor.mjs . --probe-typo` 会走进正常分支、跑完全部
 * 检查、打印 OK、退出 0，而调用方以为它验了探针。探针拼错不会报错，只会**静默地
 * 变成一次没人要求过的正常检查**。
 */
import { declOf, rulesOf } from './css-core.mjs'
import { probeOf } from './probe-args.mjs'
import { clientSheetFiles } from './sheet-files.mjs'

const target = process.argv[2] ?? '.'
/* 走目录，不列名单：新加一张表的那天它就被检查，不必有人记得回来改这里。 */
const SHEETS = clientSheetFiles(target)

/**
 * **一张表都没找到就是判据失效，不是「仓库很干净」。**
 *
 * 这里原先在 `target` 缺省成空串时拿到零张表，于是循环一次都不跑、`checked` 停在
 * 0、脚本打印 `OK: 0 overflow rule(s) checked` 并退出 0。那是一条**永远绿**的
 * 门禁：它看起来在守，实际上一个字节都没读。一条静默的空扫描比没有门禁更糟。
 */
if (SHEETS.length === 0) {
  console.error(`FAIL 一张样式表都没找到（根目录给的是 "${target}"）——判据没读任何东西，不能报 OK。`)
  process.exit(1)
}

/**
 * 这条规则是不是「滚动 + flex 项 + 固定地板」。
 * @param body - 声明块。
 * @returns `undefined` 表示合法；否则返回那个地板值（用于报错）。
 */
export function badFloorOf(body) {
  const overflowY = declOf(body, 'overflow-y')
  const overflow = declOf(body, 'overflow')
  const scrolls = overflowY === 'auto' || overflowY === 'scroll'
    || (overflow !== undefined && /\b(auto|scroll)\b/.test(overflow))
  if (!scrolls) return undefined

  const flex = declOf(body, 'flex')
  const grow = declOf(body, 'flex-grow')
  const isFlexItem = (flex !== undefined && /(^|\s)1(\s|$)/.test(flex))
    || (grow !== undefined && grow !== '0')
  if (!isFlexItem) return undefined

  const minHeight = declOf(body, 'min-height') ?? declOf(body, 'min-block-size')
  if (minHeight === undefined) return undefined
  /* 只判 px 地板：`0` / `auto` / `min-content` 都是合法的「可以让位」。 */
  return /^\d+(\.\d+)?px$/.test(minHeight) ? minHeight : undefined
}

if (probeOf(['--probe-scroll-floor']) === '--probe-scroll-floor') {
  const planted = [
    /* 合法：滚动 + flex，但地板归零。 */
    { selector: '.ok', body: 'flex: 1; min-height: 0; overflow-y: auto;' },
    /* 合法：有 px 地板，但不滚动。 */
    { selector: '.ok2', body: 'flex: 1; min-height: 120px;' },
    /* 违规：三样同时成立。 */
    { selector: '.bad', body: 'flex: 1; min-height: 120px; overflow-y: auto;' },
    /* 违规：简写 overflow + flex 简写的另一种写法。 */
    { selector: '.bad2', body: 'flex: 1 1 auto; min-height: 80px; overflow: hidden auto;' },
  ]
  const heard = planted.map(rule => ({ selector: rule.selector, bad: badFloorOf(rule.body) ?? null }))
  const expected = [
    { selector: '.ok', bad: null },
    { selector: '.ok2', bad: null },
    { selector: '.bad', bad: '120px' },
    { selector: '.bad2', bad: '80px' },
  ]
  if (JSON.stringify(heard) !== JSON.stringify(expected)) {
    console.error(`verify-scroll-floor self-test FAILED: expected ${JSON.stringify(expected)}, read ${JSON.stringify(heard)}`)
    process.exit(1)
  }
  console.log('verify-scroll-floor self-test OK: 4 planted rule(s) read as expected (a zero floor and a non-scrolling box pass; a px floor on a scrolling flex item is reported in both spellings)')
  process.exit(0)
}

const findings = []
let checked = 0
for (const sheet of SHEETS) {
  /* `clientSheetFiles()` 已经把文本一起给了——再 `readFileSync` 一次是多余的，
     而且那份文件读不到时它会静默 `continue`，于是一条都没查却打印 OK。 */
  for (const rule of rulesOf(sheet.css)) {
    if (!/overflow/.test(rule.body)) continue
    checked += 1
    const floor = badFloorOf(rule.body)
    if (floor !== undefined) {
      findings.push(`${sheet.rel}: ${rule.selector.slice(0, 46)} — a scrolling flex item with min-height: ${floor}; on a short viewport it grows past its container and the scrollbar leaves the card`)
    }
  }
}

if (findings.length > 0) {
  console.error(`verify-scroll-floor FAILED: ${findings.length} finding(s)`)
  console.error('')
  console.error('  一个滚动区同时是 flex 项时，给它一个 px 地板就是以「不许让位」写「占满空间」。')
  console.error('  矮屏上它会长出容器、滚动条跟着出去。flex 项的下限默认就是内容高，')
  console.error('  唯一能让位的写法是 min-height: 0。')
  console.error('')
  for (const one of findings) console.error(`  - ${one}`)
  process.exit(1)
}

console.log(`verify-scroll-floor OK: ${checked} overflow rule(s) checked; no scrolling flex item pins itself to a px floor, so no scrollbar can leave its card`)
