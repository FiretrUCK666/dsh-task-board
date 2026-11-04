/**
 * THE SCROLLBAR MUST BE ABLE TO PAINT AT ALL.
 *
 * Every rule for the bar can be present, correct, and green in every existing
 * check while the bar renders as NOTHING on screen. That is what happened, three
 * times, each for a different reason and none of them visible to a static scan:
 *
 *  1. `scrollbar-width: none` on the board's scrollers. It OUTRANKS the whole
 *     `::-webkit-scrollbar` family, so every styled piece was discarded and the
 *     column had no indicator at all. The rules were all there; they just lost.
 *  2. The end buttons were painted but the arrows never appeared: the UA
 *     stylesheet puts its own chevron in that pseudo-element as a
 *     `background-image`, and a zero-specificity `:where(...)` author rule loses
 *     to it. Painting the button red proved the box existed — the image was the
 *     part being overridden.
 *  3. The track's end margin read the container's corner radius (14px), which is
 *     wider than the whole bar — the inset ate both arrow buttons.
 *
 * So this gate asserts the three properties whose absence is INVISIBLE:
 *
 *   a. no `scrollbar-width: none` (or `display:none` on the bar itself) may
 *      apply to a surface this plugin says scrolls on screen;
 *   b. the button rules must not be `:where()`-wrapped — zero specificity cannot
 *      beat the UA chevron;
 *   c. the track's end inset must be smaller than the bar's own width, or the
 *      buttons have nowhere to live.
 *
 * It reads STRUCTURE (hard rule 14): comments are stripped first, and the check
 * is about which declarations exist where, not about any wording.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { probeOf } from './probe-args.mjs'

const root = process.argv[2] ?? '.'
const activeProbe = probeOf(['--probe-width-none', '--probe-where', '--probe-inset'])

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every `selector { body }` pair in a sheet, comments already gone. */
function rulesOf(css) {
  const out = []
  const source = stripComments(css)
  let depth = 0
  let selStart = 0
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '{') {
      if (depth === 0) {
        const selector = source.slice(selStart, i).trim()
        let j = i + 1
        let inner = 0
        for (; j < source.length; j += 1) {
          if (source[j] === '{') inner += 1
          if (source[j] === '}') {
            if (inner === 0) break
            inner -= 1
          }
        }
        out.push({ selector, body: source.slice(i + 1, j) })
        i = j
        selStart = j + 1
      }
    }
  }
  return out
}

const SHEETS = {
  shape: 'src/client/design/base.module.css',
  tokens: 'src/client/design/tokens.module.css',
  board: 'src/client/board.module.css',
  components: 'src/client/design/components.module.css',
  item: 'src/client/item/item.module.css',
}

const read = (rel) => {
  const p = join(root, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

const findings = []

// ── (a) nothing may silence the bar on a surface we say scrolls ──────────────
// The board's column track is the surface this whole plugin reads in; hiding its
// bar is what made a long column look like a short one.
const boardRules = rulesOf(read(SHEETS.board))
for (const rule of boardRules) {
  if (!/\.cards\b/.test(rule.selector)) continue
  if (/scrollbar-width:\s*none/.test(rule.body)) {
    findings.push(`${SHEETS.board}: .cards declares \`scrollbar-width: none\` — that outranks every ::-webkit-scrollbar rule, so the column paints no bar`)
  }
}

// ── (b) the button rules must be able to beat the UA chevron ─────────────────
const shapeCss = read(SHEETS.shape)
const buttonRules = rulesOf(shapeCss).filter(r => /scrollbar-button/.test(r.selector))
if (buttonRules.length === 0) {
  findings.push(`${SHEETS.shape}: no ::-webkit-scrollbar-button rule — the bar paints no arrows`)
}
for (const rule of buttonRules) {
  if (/display:\s*none/.test(rule.body)) continue
  if (!/background-image/.test(rule.body)) continue
  // A direction rule that carries the image must not be zero-specificity.
  if (/^:where\(/.test(rule.selector.trim())) {
    findings.push(`${SHEETS.shape}: an arrow rule is wrapped in :where() (specificity 0) — the UA chevron wins and the arrow never paints`)
  }
}

// ── (c) the track inset must leave room for the buttons ──────────────────────
const tokenCss = stripComments(read(SHEETS.tokens))
const pxOf = (name) => {
  const m = new RegExp(`--${name}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(tokenCss)
  return m === null ? undefined : Number(m[1])
}
const barWidth = pxOf('dsh-tb-scroll-bar')
const trackRule = rulesOf(shapeCss).find(r => /scrollbar-track/.test(r.selector) && /margin/.test(r.body))
if (barWidth === undefined) {
  findings.push(`${SHEETS.tokens}: --dsh-tb-scroll-bar is not declared as a px value`)
}
if (trackRule !== undefined && barWidth !== undefined) {
  // `margin-block: calc(var(--dsh-tb-scroll-bar) / 2)` is fine; a literal or a
  // radius token larger than the bar is not.
  const literal = /margin-block:\s*(\d+(?:\.\d+)?)px/.exec(trackRule.body)
  if (literal !== null && Number(literal[1]) >= barWidth) {
    findings.push(`${SHEETS.shape}: the track's end margin (${literal[1]}px) is >= the bar width (${barWidth}px) — the arrow buttons are squeezed out`)
  }
  const radiusBacked = /margin-block:\s*var\(--dsh-tb-scroll-inset/.test(trackRule.body)
  if (radiusBacked) {
    findings.push(`${SHEETS.shape}: the track's end margin reads the container corner radius — on a rounded column that is wider than the bar and eats the buttons`)
  }
}

// ── self-tests: each check must be able to fire ──────────────────────────────
if (activeProbe !== undefined) {
  const plants = {
    '--probe-width-none': () => {
      const css = '.cards { overflow-y: auto; scrollbar-width: none; }'
      const hit = rulesOf(css).some(r => /\.cards\b/.test(r.selector) && /scrollbar-width:\s*none/.test(r.body))
      if (!hit) throw new Error('the width-none check cannot see a planted `scrollbar-width: none`')
    },
    '--probe-where': () => {
      const css = ':where([data-x])::-webkit-scrollbar-button:vertical { background-image: url("data:,"); }'
      const hit = rulesOf(css).some(r => /scrollbar-button/.test(r.selector) && /background-image/.test(r.body) && /^:where\(/.test(r.selector.trim()))
      if (!hit) throw new Error('the :where() check cannot see a planted zero-specificity arrow rule')
    },
    '--probe-inset': () => {
      const css = '::-webkit-scrollbar-track { margin-block: 14px; }'
      const rule = rulesOf(css).find(r => /scrollbar-track/.test(r.selector))
      const m = /margin-block:\s*(\d+(?:\.\d+)?)px/.exec(rule.body)
      if (m === null || Number(m[1]) < 10) throw new Error('the inset check cannot measure a planted oversized margin')
    },
  }
  try {
    plants[activeProbe]()
    console.log(`verify-scroll-paints ${activeProbe.slice(2)} probe OK: the planted defect was seen`)
    process.exit(0)
  } catch (error) {
    console.error(`verify-scroll-paints ${activeProbe.slice(2)} probe FAILED: ${error.message}`)
    process.exit(1)
  }
}

if (findings.length > 0) {
  console.error(`verify-scroll-paints FAILED for ${root} (${findings.length})`)
  for (const f of findings) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(`verify-scroll-paints OK: the bar can paint — no scrollbar-width:none on the column, ${buttonRules.length} arrow rule(s) at usable specificity, and the track inset leaves the buttons room`)
