#!/usr/bin/env node
/**
 * verify-ink.mjs — the gate for the board's text-grade ink tier.
 *
 * Usage: node scripts/verify-ink.mjs <plugin-dir> [--probe-dull]
 *
 * THE REGRESSION THIS EXISTS FOR. The ink tokens were once derived by mixing a
 * state fill toward a NEUTRAL dark ink (`color-mix(in srgb, <fill> N%,
 * --dsw-alias-label-primary)`). That reaches a contrast number and destroys the
 * colour: measured on the amber chip, the result kept 0.61 of its source chroma
 * and the reader's words for it were 「颜色变暗淡」. A dark yellow is brown, and a
 * brown chip says nothing about which state it is. Nothing else caught it — the
 * contrast check it was written to satisfy kept passing.
 *
 * THE LAW (three mechanical rules):
 *
 *   1. NAMING IS THE PAIRING. `--dsh-tb-status-<x>-ink` derives from
 *      `--dsh-tb-status-<x>`; `--dsh-tb-ink-<x>` from `--dsh-tb-<x>`. There is no
 *      table here to fall out of step: the name already says which fill an ink
 *      belongs to, and an ink deriving from ANYTHING ELSE is a finding.
 *   2. ONE STEP DARKER, NOTHING ELSE. Each ink is either the raw fill
 *      (`var(--dsh-tb-<x>)`) or `oklch(from var(--dsh-tb-<x>) calc(l * k) c h)`
 *      with `0.75 <= k <= 1`: lightness moves, hue and chroma are passed through
 *      untouched. `k` below 0.75 is refused because the hue's identity changes
 *      there — the measured case: review reached 3:1 only at k=0.31, keeping
 *      0.34 of its chroma.
 *   3. INK IS FOR TEXT. These nine names may appear only in `color:` /
 *      `caret-color:` declarations. A dot, a bead or a border keeps its fill
 *      token: darkening a mark removes a signal from the screen without making
 *      one letter easier to read.
 *
 * Plus one structural fact: the dark-theme block RESETS all nine to the raw
 * fills. The correction belongs to the light theme — on a dark surface the fills
 * already clear the floor, and darkening them there only makes them less legible.
 *
 * WHAT IT ALSO PRINTS. With the host installed it resolves each pair through the
 * host's own token tables and prints a PREDICTED chroma kept, hue drift and
 * contrast on white — labelled as predictions, and deliberately not a threshold.
 * The achieved chroma belongs to the ENGINE's gamut mapping (CSS Color 4's
 * local-MINDE search), and this file models it with a plain chroma binary search
 * that disagrees by up to ~0.07 on the out-of-gamut cases: the amber ink predicts
 * 0.799 here and renders 0.865 in Chromium. A gate built on that prediction would
 * fail a colour the reader is looking at, which is the one failure mode worse
 * than no gate. The rendered numbers are taken with `shot-panel.mjs` and recorded
 * in DESIGN.md, together with the method that produced them.
 *
 * On a machine without the host the numeric half is skipped and SAID to be
 * skipped: a check that cannot run must never read as a check that passed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const MIN_K = 0.75
const MAX_K = 1

// ── the law, as pure functions (so the probe can plant inputs in them) ───────

/** The fill an ink name derives from. The NAME carries the pairing. */
function sourceOfInk(name) {
  const status = /^--dsh-tb-(status-[a-z-]+)-ink$/.exec(name)
  if (status !== null) return `--dsh-tb-${status[1]}`
  const plain = /^--dsh-tb-ink-([a-z-]+)$/.exec(name)
  if (plain !== null) return `--dsh-tb-${plain[1]}`
  return undefined
}

/** Rule 1 + 2 for one declaration. Returns a finding, or null when it obeys. */
function inkFinding(name, value) {
  const source = sourceOfInk(name)
  if (source === undefined) return `${name} is not an ink name (--dsh-tb-status-<x>-ink or --dsh-tb-ink-<x>)`
  const text = value.trim()
  if (/^var\(\s*\)$/.test(text) || !/^var\(|^oklch\(/.test(text)) {
    return `${name}: must be var(${source}) or oklch(from var(${source}) calc(l * k) c h) — got ${text}`
  }
  if (text === `var(${source})`) return null
  const derived = /^oklch\(\s*from\s+var\(\s*(--[\w-]+)\s*\)\s+calc\(\s*l\s*\*\s*([0-9.]+)\s*\)\s+c\s+h\s*\)$/.exec(text)
  if (derived === null) {
    return `${name}: the only derivation allowed is oklch(from var(${source}) calc(l * k) c h) — a mix toward a neutral destroys the hue's chroma`
  }
  if (derived[1] !== source) return `${name}: derives from ${derived[1]}, but its name says it belongs to ${source}`
  const k = Number(derived[2])
  if (!Number.isFinite(k) || k < MIN_K || k > MAX_K) {
    return `${name}: k=${derived[2]} is outside ${MIN_K}..${MAX_K} — below ${MIN_K} the hue's identity changes (a dark yellow is brown)`
  }
  return null
}

/** Rule 3: the ink names are text-only. */
const NON_TEXT_PROPERTY = /(^|[;{\s])(background|background-color|border|border-color|border-block-color|border-inline-color|outline|outline-color|box-shadow|fill|stroke|text-decoration-color)\s*:([^;}]*)/g

function textOnlyFindings(name, css) {
  const findings = []
  for (const match of css.matchAll(NON_TEXT_PROPERTY)) {
    if (!match[3].includes(`var(${name})`)) continue
    findings.push(`${name} is used as ${match[2]} — ink is for text; a mark or a boundary keeps its fill token`)
  }
  return findings
}

/** Drop comments so a ban reads CODE, not the prose that explains it (硬性规范 14). */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

// ── the probe: the gate must be shown to bite ───────────────────────────────

if (process.argv.includes('--probe-dull')) {
  const plants = [
    // The exact mechanism this gate exists for.
    ['--dsh-tb-status-review-ink', 'color-mix(in srgb, var(--dsh-tb-status-review) 52%, var(--dsw-alias-label-primary))'],
    ['--dsh-tb-ink-accent', 'color-mix(in srgb, var(--dsh-tb-accent) 70%, black)'],
    // A derivation from somebody else's fill.
    ['--dsh-tb-status-todo-ink', 'oklch(from var(--dsh-tb-accent) calc(l * 0.8) c h)'],
    // Out of the band, both directions.
    ['--dsh-tb-ink-success', 'oklch(from var(--dsh-tb-success) calc(l * 0.4) c h)'],
    ['--dsh-tb-ink-danger', 'oklch(from var(--dsh-tb-danger) calc(l * 1.4) c h)'],
    // A derivation that drops the chroma passthrough.
    ['--dsh-tb-ink-attention', 'oklch(from var(--dsh-tb-attention) calc(l * 0.79) calc(c * 0.5) h)'],
    // A hand-written literal.
    ['--dsh-tb-status-done-ink', '#7a8a20'],
  ]
  const missed = plants.filter(([name, value]) => inkFinding(name, value) === null)
  const obeying = [
    ['--dsh-tb-status-todo-ink', 'var(--dsh-tb-status-todo)'],
    ['--dsh-tb-ink-attention', 'oklch(from var(--dsh-tb-attention) calc(l * 0.79) c h)'],
    ['--dsh-tb-status-done-ink', 'oklch(from var(--dsh-tb-status-done) calc(l * 0.82) c h)'],
  ]
  const falsePositives = obeying.filter(([name, value]) => inkFinding(name, value) !== null)
  const textOnlyPlants = textOnlyFindings('--dsh-tb-ink-danger', '.x { border-color: var(--dsh-tb-ink-danger); }')
  const textOnlyClean = textOnlyFindings('--dsh-tb-ink-danger', '.x { color: var(--dsh-tb-ink-danger); }')
  const ok = missed.length === 0 && falsePositives.length === 0 && textOnlyPlants.length === 1 && textOnlyClean.length === 0
  if (!ok) {
    for (const [name, value] of missed) console.error(`probe: NOT reported — ${name}: ${value}`)
    for (const [name, value] of falsePositives) console.error(`probe: wrongly reported — ${name}: ${value}`)
    if (textOnlyPlants.length !== 1) console.error(`probe: a border use was not reported (${textOnlyPlants.length})`)
    if (textOnlyClean.length !== 0) console.error('probe: a plain color: use was reported')
    console.error('verify-ink probe FAILED: the gate does not bite')
    process.exit(1)
  }
  console.log(`verify-ink self-test OK: ${plants.length} planted breaks all reported, ${obeying.length} lawful lines all accepted, the text-only rule bites`)
  process.exit(0)
}

// ── the real run ────────────────────────────────────────────────────────────

const root = resolve(process.argv[2] ?? '.')
const files = ['src/client/board.module.css', 'src/client/item/item.module.css'].map(rel => join(root, rel))
const missing = files.filter(file => !existsSync(file))
if (missing.length > 0) {
  console.error(`verify-ink: missing ${missing.join(', ')}`)
  process.exit(1)
}

const sheet = readFileSync(files[0], 'utf8')
const raw = files.map(file => readFileSync(file, 'utf8'))
const css = raw.map(stripComments).join('\n')

// Every declaration of an ink name, in source order, with its line.
const declarations = []
for (const [index, text] of raw.entries()) {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(--dsh-tb-(?:status-[a-z-]+-ink|ink-[a-z-]+))\s*:\s*([^;]+);/.exec(lines[i])
    if (match === null) continue
    declarations.push({ file: files[index], line: i + 1, name: match[1], value: match[2].trim() })
  }
}

const findings = []
/* WHICH NAMES ARE THE DERIVATION FAMILY, without a table to keep in step: an ink
   belongs to it exactly when the fill its name points at IS DECLARED IN THIS
   SHEET. `--dsh-tb-ink-on-fill` is therefore not a member (there is no
   `--dsh-tb-on-fill`) — it is a standalone token, which rule 3 still covers. */
const sheetNames = new Set([...stripComments(sheet).matchAll(/(--dsh-tb-[\w-]+)\s*:/g)].map(match => match[1]))
const declaredInkNames = [...new Set(declarations.map(decl => decl.name))]
const family = declaredInkNames.filter((name) => {
  const source = sourceOfInk(name)
  return source !== undefined && sheetNames.has(source)
})
const familySet = new Set(family)

for (const decl of declarations) {
  if (!familySet.has(decl.name)) continue
  const finding = inkFinding(decl.name, decl.value)
  if (finding !== null) findings.push(`${decl.file}:${decl.line}: ${finding}`)
}

// An ink that is not a family member must at least be READ by something: a
// declared token nobody consumes is how a typo'd name survives review.
for (const name of declaredInkNames) {
  if (familySet.has(name) || css.includes(`var(${name})`)) continue
  findings.push(`src/client/board.module.css: ${name} is declared but nothing reads it — a dangling ink (a typo'd name looks exactly like this)`)
}

// The dark block resets the whole family (the correction is light-theme only).
const darkBlock = /body\[data-ds-dark-theme\][^{]*\{([\s\S]*?)\n\}/.exec(stripComments(sheet))?.[1] ?? ''
for (const name of family) {
  if (!darkBlock.includes(`${name}: var(`)) {
    findings.push(`src/client/board.module.css: the dark block does not reset ${name} to its raw fill — the correction belongs to the light theme`)
  }
}

// Rule 3 across both sheets, for every ink-shaped name.
for (const name of declaredInkNames) findings.push(...textOnlyFindings(name, css))

if (findings.length > 0) {
  for (const finding of findings) console.error(`verify-ink: ${finding}`)
  console.error(`verify-ink FAILED: ${findings.length} finding(s)`)
  process.exit(1)
}
console.log(`verify-ink: ${family.length} ink token(s) obey the law — one step darker at most, same hue and chroma, text only, reset in dark`)

// ── the numbers, when the host is here to resolve them ──────────────────────

const bundle = [
  join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'),
  join(process.env.HOME ?? '', '.npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'),
].find(existsSync)

if (bundle === undefined) {
  console.log('note: ink numbers NOT measured — the host is not installed here, so no token table is available to resolve. The structural rules above still ran.')
  process.exit(0)
}

const hostSource = readFileSync(bundle, 'utf8')
const values = new Map()
const remember = (name, value) => { if (!values.has(name)) values.set(name, value.trim()) }
for (const match of hostSource.matchAll(/(\w+)_css_default\s*=\s*"/g)) {
  const open = match.index + match[0].length - 1
  let end = open + 1
  while (end < hostSource.length) {
    if (hostSource[end] === '\\') { end += 2; continue }
    if (hostSource[end] === '"') break
    end += 1
  }
  let text = ''
  try { text = JSON.parse(hostSource.slice(open, end + 1)) } catch { continue }
  for (const decl of text.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) remember(decl[1], decl[2])
}
for (const decl of stripComments(sheet).matchAll(/(--dsh-tb-[\w-]+)\s*:\s*([^;}]+)/g)) remember(decl[1], decl[2])

const resolveVar = (name, depth = 0) => {
  if (depth > 12) return undefined
  const value = values.get(name)
  if (value === undefined) return undefined
  const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)
  if (reference !== null) return resolveVar(reference[1], depth + 1)
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : /^rgb/.test(value) ? value : undefined
}
const channels = (value) => {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(value)
  if (hex !== null) return [0, 2, 4].map(at => parseInt(hex[1].slice(at, at + 2), 16) / 255)
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value)
  return rgb === null ? undefined : [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255]
}
const linear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const toOklab = ([r, g, b]) => {
  const R = linear(r), G = linear(g), B = linear(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ]
}
const toLch = (rgb) => {
  const [L, a, b] = toOklab(rgb)
  return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI]
}
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)

const rows = []
const unresolved = []
// The FIRST declaration of a name is the light-theme one (the dark block resets
// the same nine further down and is checked by the rules, not measured twice).
const firstByName = new Map()
for (const decl of declarations) if (!firstByName.has(decl.name)) firstByName.set(decl.name, decl)
for (const decl of firstByName.values()) {
  if (!familySet.has(decl.name)) continue
  const source = sourceOfInk(decl.name)
  if (source === undefined) continue
  const fillRaw = resolveVar(source)
  if (fillRaw === undefined) { unresolved.push(source); continue }
  const rgb = channels(fillRaw)
  if (rgb === undefined) continue
  const derived = /calc\(\s*l\s*\*\s*([0-9.]+)\s*\)/.exec(decl.value)
  const k = derived === null ? 1 : Number(derived[1])
  const [L, C, h] = toLch(rgb)
  // The derivation is exactly "same hue, same chroma, L scaled" — so the numbers
  // below are computed the way the engine computes them, not sampled from it.
  const inkRgb = k === 1 ? rgb : oklchToSrgb(L * k, C, h)
  const [inkL, inkC, inkH] = toLch(inkRgb)
  rows.push({
    name: decl.name.replace('--dsh-tb-', ''),
    source,
    k,
    fill: fillRaw,
    chromaKept: inkC / Math.max(C, 1e-6),
    hueDrift: hueDelta(inkH, h),
    contrast: 1.05 / (luminance(inkRgb) + 0.05),
  })
}

/** The unsigned angle between two hues, in degrees (0..180). */
function hueDelta(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180)
}

/** OKLCH → sRGB with the spec's gamut mapping (reduce chroma, keep L and h). */
function oklchToSrgb(L, C, hDeg) {
  const rad = (hDeg * Math.PI) / 180
  const at = (c) => {
    const [a, b] = [c * Math.cos(rad), c * Math.sin(rad)]
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
    const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
    const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3)
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ]
  }
  const encode = (v) => Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055))
  const inGamut = (lin) => lin.every(v => v >= -0.0005 && v <= 1.0005)
  if (!inGamut(at(C))) {
    let lo = 0, hi = C
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(at(mid))) lo = mid; else hi = mid
    }
    return at(lo).map(encode)
  }
  return at(C).map(encode)
}

for (const row of rows) {
  console.log(`note: ink ${row.name.padEnd(20)} k=${row.k}  chroma kept ~${row.chromaKept.toFixed(3)} (predicted)  hue drift ~${row.hueDrift.toFixed(2)} deg (predicted)  contrast on white ${row.contrast.toFixed(2)}`)
}
for (const name of [...new Set(unresolved)]) {
  console.log(`note: ink ${name} NOT measured — the host's table does not resolve it to a literal colour here`)
}
/* THESE NUMBERS ARE A PREDICTION, NOT A MEASUREMENT, and they are printed as
   such on purpose. The achieved chroma depends on the ENGINE's gamut mapping
   (CSS Color 4's local-MINDE search); this file models it with a plain chroma
   binary search, and the two disagree by up to ~0.07 on the out-of-gamut cases
   (measured: the amber ink predicts 0.799 here and renders 0.865 in Chromium).
   So the PASS/FAIL above is the structural law, which is exact and model-free,
   and the number that matters is the engine-measured one — taken with
   `shot-panel.mjs` and recorded in DESIGN.md. A gate built on a prediction that
   disagrees with the renderer would fail the right colour (硬性规范 14). */
console.log(`verify-ink OK: ${rows.length} token pair(s) obey the law; the numbers above are the model's prediction, the rendered ones live in DESIGN.md`)
