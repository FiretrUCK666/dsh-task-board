#!/usr/bin/env node
/**
 * verify-palette.mjs — one palette, not two.
 *
 * Usage: node scripts/verify-palette.mjs <plugin-dir> [--probe-palette]
 *
 * THE REGRESSION THIS EXISTS FOR. The board and the task list paint from six hue
 * families. Twice a change made one family carry two colours at once, and both
 * times the screen said so before any check did:
 *
 *   · a "text grade" derived by mixing the fill toward a neutral ink kept 0.61 of
 *     the source chroma — the reader's words were 「颜色变暗淡」;
 *   · a "text grade" derived by scaling lightness kept the chroma but INVENTED a
 *     colour (#bf7800 beside the dot's #f59e0b) — 「那里的黄色跟别的地方差很多」.
 *
 * A hue split in half is the defect, whatever the half looks like. So the tier is
 * gone: text reads the family colour itself.
 *
 * THE LAW (three rules, all mechanical):
 *
 *   1. NO DERIVED TIER, NO NEW COLOUR. No `--dsh-tb-*-ink` token and no
 *      `oklch(from …)` / `color-mix` derivation of a family colour may exist. A
 *      family colour is declared once, and read.
 *   2. ONE WORD PER COLOUR. Whatever the layer already names, a call site may not
 *      reach past it: if `--dsh-tb-text-2` is declared as
 *      `var(--dsw-alias-label-secondary)`, then `var(--dsw-alias-label-secondary)`
 *      appearing in a declaration is a second road to the same colour — and the
 *      two roads drift (that is how a family ends up with two values).
 *      The banned set is DERIVED from the layer's own declarations: no table here
 *      to fall out of step, and a host token the layer has not named (the hover
 *      step `--dsw-alias-state-warn-primary-hover`) stays allowed.
 *      Scope: the `label` and `state` families — the ones that carry identity.
 *      Borders and shadows are a different vocabulary (geometry, not colour) and
 *      are not this gate's subject.
 *   3. ONE LADDER FOR STRENGTH. `--dsh-tb-wash` / `--dsh-tb-wash-strong` /
 *      `--dsh-tb-edge` are the only numbers a wash or an edge may use: a bare
 *      percentage over `transparent` in a call site is a private decision that
 *      will not match its neighbour's. Non-family mixes (a shadow's shadow, a
 *      card's own picked tint) are not this rule's subject.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, relative, sep } from 'node:path'
import { probeOf } from './probe-args.mjs'

/**
 * Every stylesheet the client half owns, DISCOVERED rather than listed.
 *
 * A named list of sheets goes stale the moment a surface gets a stylesheet of
 * its own: the new sheet is then checked by nothing at all, and it is exactly
 * the new sheet whose colours nobody has reviewed against the ladder. Walking
 * the tree means the next one is covered the day it is created — the same
 * reasoning `verify-design-docs.mjs` records for its own walk.
 *
 * `*.module.css` is the build's own convention (one hashed class scope per
 * sheet), so the walk keys on it rather than on a filename.
 */
function clientStylesheets(root) {
  const clientDir = join(root, 'src', 'client')
  if (!existsSync(clientDir)) return []
  const found = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith('.module.css')) found.push(p)
    }
  }
  walk(clientDir)
  return found.sort()
}

/**
 * The alias layer's home, located by WHAT IT DECLARES rather than by a path.
 *
 * `namedHostTokens` derives the banned set from the layer's own words, so
 * "which sheet is the layer" is a load-bearing question — and a path answers it
 * only until the layer moves. `--dsh-tb-text-1` is the layer's own signature
 * (it is the alias every text level is read through), so the sheet that
 * declares it IS the layer, wherever it lives.
 *
 * Two sheets declaring it is a finding, not a tie to break: one concept with
 * two homes is how a colour family ends up with two values.
 */
const ALIAS_SIGNATURE = '--dsh-tb-text-1'

/** Drop comments so a ban reads CODE, not the prose that explains it (硬性规范 14). */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every custom-property declaration, as `name -> value` (the layer's own words). */
function declarations(css) {
  const out = []
  for (const line of css.split('\n')) {
    const match = /^\s*(--[\w-]+)\s*:\s*([^;]+);/.exec(line)
    if (match !== null) out.push({ name: match[1], value: match[2].trim() })
  }
  return out
}

/** The six families, by the names the sheet gives them. */
const FAMILY = /^--dsh-tb-(accent|attention|success|danger|status-[\w-]+)$/

/** Rule 1: a family colour is declared once and read — never derived. */
function derivedTier(css) {
  const findings = []
  for (const decl of declarations(css)) {
    // The derived TEXT tier, by the shape of its name: `--dsh-tb-ink-<x>` and
    // `--dsh-tb-status-<x>-ink`. (`--plan-body-ink` is a type size and
    // `--dsh-tb-ink-on-fill` is a real colour of its own: neither is this.)
    if (/^--dsh-tb-(ink-[\w-]+|status-[\w-]+-ink)$/.test(decl.name) && decl.name !== '--dsh-tb-ink-on-fill' && decl.name !== '--dsh-tb-ink-on-solid') {
      findings.push(`${decl.name}: a derived text tier is back — text reads the family colour itself`)
      continue
    }
    if (FAMILY.test(decl.name) && /^(oklch|color-mix)\(/.test(decl.value)) {
      findings.push(`${decl.name}: a family colour is being derived again (${decl.value.slice(0, 40)}…)`)
    }
  }
  return findings
}

/** Rule 2: the banned host tokens are exactly the ones the layer already names. */
function namedHostTokens(sheet) {
  const banned = new Set()
  for (const decl of declarations(sheet)) {
    if (!decl.name.startsWith('--dsh-tb-')) continue
    for (const match of decl.value.matchAll(/var\(\s*(--dsw-alias-(?:label|state)-[\w-]+)\s*\)/g)) banned.add(match[1])
  }
  return banned
}

function secondRoadFinding(name, css) {
  const findings = []
  for (const line of css.split('\n')) {
    if (/^\s*--[\w-]+\s*:/.test(line)) continue
    if (line.includes(`var(${name})`)) findings.push(`${name} is read at a call site — the layer names it; read the layer name`)
  }
  return findings
}

/** Rule 3: a family wash's strength comes from the ladder.
 *  Declarations are where the authoritative numbers live (that is what the layer
 *  is for); it is the CALL SITES that may not improvise one. */
function privateAlphaFinding(css) {
  const findings = []
  for (const line of css.split('\n')) {
    if (/^\s*--[\w-]+\s*:/.test(line)) continue
    for (const result of line.matchAll(/color-mix\(\s*in\s+srgb\s*,\s*(var\(--dsh-tb-[\w-]+\))\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)/g)) {
      findings.push(`${result[1]} takes a private ${result[2]}% — wash and edge read --dsh-tb-wash / --dsh-tb-wash-strong / --dsh-tb-edge`)
    }
  }
  return findings
}

// ── the probe: the gate must be shown to bite ───────────────────────────────

if (probeOf(['--probe-palette']) === '--probe-palette') {
  const planted = [
    ['a derived tier came back', derivedTier('--dsh-tb-status-todo-ink: oklch(from var(--dsh-tb-status-todo) calc(l * 0.8) c h);'), 1],
    ['a family colour derived again', derivedTier('--dsh-tb-attention: color-mix(in srgb, var(--dsw-static-amber-500) 60%, black);'), 1],
    ['the on-fill twin is lawful', derivedTier('--dsh-tb-ink-on-fill: var(--dsw-static-neutral-bluish-1000);'), 0],
    ['a type token named -ink is lawful', derivedTier('--plan-body-ink: 13px;'), 0],
    ['a neutral mask is lawful', derivedTier('--dsh-tb-mask: color-mix(in srgb, var(--dsw-alias-bg-mask-1) 60%, var(--dsw-alias-bg-mask-3));'), 0],
    ['a declaration may name a host token', derivedTier('--dsh-tb-text-2: var(--dsw-alias-label-secondary);'), 0],
    ['the second road is reported', secondRoadFinding('--dsw-alias-label-secondary', '.x { color: var(--dsw-alias-label-secondary); }'), 1],
    ['a declaration is not a call site', secondRoadFinding('--dsw-alias-label-secondary', '--dsh-tb-text-2: var(--dsw-alias-label-secondary);'), 0],
    ['a private alpha is reported', privateAlphaFinding('.x { background: color-mix(in srgb, var(--dsh-tb-danger) 42%, transparent); }'), 1],
    ['the ladder is lawful', privateAlphaFinding('.x { background: color-mix(in srgb, var(--dsh-tb-danger) var(--dsh-tb-edge), transparent); }'), 0],
    ['a declaration may hold the number', privateAlphaFinding('--dsh-tb-attention-alpha-soft: color-mix(in srgb, var(--dsh-tb-attention) 10%, transparent);'), 0],
    ['a shadow may keep its own alpha', privateAlphaFinding('.x { box-shadow: 0 1px 3px color-mix(in srgb, var(--dsw-static-neutral-1000) 32%, transparent); }'), 0],
    ['a card may keep its own tint', privateAlphaFinding('.x { box-shadow: 0 0 0 1px color-mix(in srgb, var(--card-tint) 30%, transparent); }'), 0],
  ]
  const wrong = []
  for (const [what, found, expected] of planted) {
    if (found.length !== expected) wrong.push(`${what}: expected ${expected} finding(s), got ${found.length}${found.length > 0 ? ` — ${found[0]}` : ''}`)
  }
  if (wrong.length > 0) {
    for (const line of wrong) console.error(`probe: ${line}`)
    console.error('verify-palette probe FAILED: the gate does not bite')
    process.exit(1)
  }
  console.log(`verify-palette self-test OK: ${planted.length} planted lines behave (a derived tier, a second road and a private alpha all reported; their lawful twins accepted)`)
  process.exit(0)
}

// ── the real run ────────────────────────────────────────────────────────────

const root = resolve(process.argv[2] ?? '.')
const FILES = clientStylesheets(root).map(abs => relative(root, abs).split(sep).join('/'))
if (FILES.length === 0) {
  console.error('verify-palette: no client stylesheet found under src/client — the walk read nothing, so every rule below is vacuous')
  process.exit(1)
}
const missing = FILES.map(rel => join(root, rel)).filter(file => !existsSync(file))
if (missing.length > 0) {
  console.error(`verify-palette: missing ${missing.join(', ')}`)
  process.exit(1)
}

const sheets = FILES.map(rel => ({ rel, css: stripComments(readFileSync(join(root, rel), 'utf8')) }))
const layerSheets = sheets.filter(sheet => declarations(sheet.css).some(decl => decl.name === ALIAS_SIGNATURE))
if (layerSheets.length !== 1) {
  console.error(
    `verify-palette: ${layerSheets.length} sheet(s) declare ${ALIAS_SIGNATURE} (${layerSheets.map(s => s.rel).join(', ') || 'none'}) — `
    + 'the alias layer must have exactly one home, or "the layer names it once" has no subject',
  )
  process.exit(1)
}
const sheet = layerSheets[0].css
const both = sheets.map(entry => entry.css).join('\n')

const findings = []
for (const { rel, css } of sheets) {
  for (const finding of derivedTier(css)) findings.push(`${rel}: ${finding}`)
  for (const finding of privateAlphaFinding(css)) findings.push(`${rel}: ${finding}`)
}

const banned = namedHostTokens(sheet)
for (const name of banned) {
  for (const finding of secondRoadFinding(name, both)) findings.push(finding)
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`verify-palette: ${finding}`)
  console.error(`verify-palette FAILED: ${findings.length} finding(s)`)
  process.exit(1)
}
console.log(`verify-palette: one colour per family — ${banned.size} host token(s) named once by the layer (${layerSheets[0].rel}) and reached only through it, no derived tier, no private wash; ${FILES.length} sheet(s) walked`)
