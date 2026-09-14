/**
 * Design-doc check: DESIGN.md and its sidecar record DSH token values, and nothing
 * used to notice when the shell's tokens moved out from under them.
 *
 * What this proves, and what it deliberately does not:
 *
 * - It resolves the theme's own token tables (the same two `body` blocks the shell
 *   ships) and then holds the documentation to them:
 *     every `--dsw-*` name the docs rely on must still be declared, and
 *     every hex the docs record must equal what that token resolves to today.
 * - It is a BASELINE check, not a theme audit. A green run means "the docs still
 *   describe the tokens they claim", never "every token is fine".
 * - It never rewrites the docs. Regenerating them is `document`'s job; this only
 *   refuses to let them drift in silence.
 *
 * When the DSH install cannot be located the check reports SKIP and exits 0: the
 * docs are not wrong, this machine simply cannot resolve tokens. Run it where DSH
 * lives (a dev machine), which is where the values are read in the first place.
 *
 * usage: node scripts/verify-design-docs.mjs [plugin-dir]
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(process.argv[2] ?? '.')
const failures = []
const notes = []

// --- locate the DSH install ---------------------------------------------------
// The plugin's own node_modules is a pnpm virtual store: it holds the SDK
// packages this plugin depends on, NOT the DSH application, and not the theme
// package. The running DSH has to be found through a global install root.
//
// Spawning a package manager (`npm root -g`) is deliberately NOT the primary
// path: under a restricted sandbox a child process whose output is captured over
// a pipe fails outright (spawnSync EINVAL), so a check that depended on it would
// report "unverified" for reasons that have nothing to do with the docs. The
// install root is derived from the running Node instead, and the package
// managers remain only as a best-effort fallback.

/** Where a global install of @deepseek-ai/dsh keeps the file this check reads. */
function themeEntry(root) {
  return join(root, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js')
}

/** Best-effort `root -g`; silent on any failure (see the note above). */
function globalRoot(tool) {
  // On Windows the shims are .cmd and are not directly executable by execFile.
  for (const name of process.platform === 'win32' ? [`${tool}.cmd`, tool] : [tool]) {
    try {
      const out = execFileSync(name, ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (out !== '') return out
    } catch { /* try the next shim */ }
  }
  return null
}

function dshRoot() {
  const home = process.env.USERPROFILE ?? process.env.HOME
  const candidates = []
  if (process.env.DSH_ROOT) candidates.push(process.env.DSH_ROOT)

  // Primary: walk up from the running Node, which lives inside the install prefix.
  let dir = dirname(process.execPath)
  for (let i = 0; i < 4; i++) {
    candidates.push(dir)
    dir = dirname(dir)
  }
  // Fallback: conventions, then whatever the package managers report.
  if (home) {
    candidates.push(join(home, 'AppData', 'Roaming', 'npm'), join(home, '.npm-global'), join(home, '.local', 'share', 'pnpm'))
  }
  candidates.push('/usr/local', '/usr', '/opt/homebrew')
  for (const tool of ['pnpm', 'npm']) {
    const g = globalRoot(tool)
    if (g !== null) candidates.push(g)
  }
  for (const c of candidates) {
    if (c !== undefined && existsSync(themeEntry(c))) return c
  }
  return null
}

const dsh = dshRoot()
if (dsh === null) {
  console.log('verify-design-docs SKIP: DSH install not found (set DSH_ROOT to enable); docs are unverified here, not wrong')
  process.exit(0)
}

// --- read the theme's token tables -------------------------------------------
// The stylesheet ships inside JS string literals and holds FOUR relevant blocks:
// two static ramps (byte-identical light/dark) and two semantic alias tables
// selected by `body` / `body[data-ds-dark-theme]`. Blocks are found by CONTENT,
// never by index: the selector names repeat, so order is not identity.

const themeJs = themeEntry(dsh)
const css = readFileSync(themeJs, 'utf8').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')

const blockList = []
{
  const re = /([^{}]{0,300})\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css)) !== null) {
    const body = m[2]
    if ((body.match(/--dsw-/g) || []).length > 5) {
      blockList.push({ sel: m[1].trim().replace(/^["'\s=;]+/, ''), body })
    }
  }
}
const declarations = (body) => {
  const map = new Map()
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/g)) map.set(m[1], m[2].trim())
  return map
}
const rampTable = blockList.find((b) => b.body.includes('--dsw-static-neutral-bluish-00'))
const semanticBlocks = blockList.filter((b) => b.body.includes('--dsw-alias-bg-base')).map((b) => declarations(b.body))
if (!rampTable || semanticBlocks.length < 2) {
  console.log('verify-design-docs SKIP: theme tables not found in the DSH build (layout changed?); docs are unverified here, not wrong')
  process.exit(0)
}
const ramp = declarations(rampTable.body)
const lightTable = semanticBlocks.find((t) => (t.get('--dsw-alias-bg-base') ?? '').includes('bluish-00'))
const darkTable = semanticBlocks.find((t) => (t.get('--dsw-alias-bg-base') ?? '').includes('bluish-950'))

/** Resolve one token through `var()` chains inside its own table. */
function resolveToken(name, table) {
  let value = table.get(name) ?? ramp.get(name)
  for (let i = 0; i < 12 && typeof value === 'string'; i++) {
    const m = value.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/)
    if (m === null) break
    const next = table.get(m[1]) ?? ramp.get(m[1])
    if (next === undefined) { value = m[2] === undefined ? undefined : m[2].trim(); break }
    value = next
  }
  return value
}
/** Every token name the theme declares anywhere (for existence checks). */
const declared = new Set([...ramp.keys(), ...lightTable.keys(), ...darkTable.keys()])

// Existence must be judged against ALL declarations in the install, not just the
// two color tables above: the shell also declares --dsw-shadow-*, --dsw-font-*,
// --dsw-elevation-* and friends in neighbouring blocks and packages. Judging a
// name against a partial set produced false "the theme moved" reports — the exact
// failure this check exists to prevent, so the scan is deliberately broad.
//
// The depth limit is load-bearing: measured from this root the theme package sits
// at @deepseek-ai / dsh / node_modules / @deepseek-ai / dsh-client-ui-theme, i.e.
// FIVE levels down. An earlier limit of 4 stopped just short of it and reported
// four live tokens as missing. Nested node_modules is what makes it deep.
{
  const roots = [join(dsh, 'node_modules', '@deepseek-ai'), join(dsh, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets')]
  const seen = new Set()
  const walk = (dir, depth) => {
    if (depth > 8 || !existsSync(dir)) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!/\.(js|mjs|css)$/.test(e.name)) continue
      let text
      try { text = readFileSync(p, 'utf8') } catch { continue }
      for (const m of text.matchAll(/--dsw-[a-z0-9-]+(?=\s*:)/g)) declared.add(m[0])
      seen.add(p)
    }
  }
  for (const r of roots) walk(r, 0)
  if (!seen.has(themeJs)) {
    failures.push(`the theme file was not reached by the declaration scan (${themeJs}) — the install layout changed; the scan needs a review, do not trust its verdict`)
  }
  notes.push(`declaration scan: ${declared.size} distinct --dsw-* names across ${seen.size} shell files`)
}

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa` into comparable lowercase form. */
function rgba(value) {
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^#([0-9a-f]{3,8})$/i)
  if (m === null) return null
  let h = m[1].toLowerCase()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length === 4) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 && h.length !== 8) return null
  const n = (i) => parseInt(h.slice(i, i + 2), 16)
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 255 }
}
/**
 * Compare a recorded value with a resolved token value.
 *
 * Exact equality is required: both sides are literals by the time they arrive here
 * (a token that resolves to a `color-mix()` is skipped upstream rather than
 * compared), so any difference is real drift. An earlier ±1 tolerance — meant for
 * mixed values — silently accepted a one-step-off hex, which a negative test caught.
 */
const sameColor = (a, b) => {
  const [x, y] = [rgba(a), rgba(b)]
  if (x === null || y === null) return false
  return x.r === y.r && x.g === y.g && x.b === y.b && x.a === y.a
}

// --- load the docs -----------------------------------------------------------

const designPath = join(root, 'DESIGN.md')
const sidecarPath = join(root, '.impeccable', 'design.json')
if (!existsSync(designPath)) {
  console.log('verify-design-docs SKIP: DESIGN.md not present in this checkout')
  process.exit(0)
}
const design = readFileSync(designPath, 'utf8')
// Strip a UTF-8 BOM if one is present. A BOM is invisible in an editor and makes
// JSON.parse throw on the first character, so a doc that merely acquired one (a
// Windows editor or shell redirect is enough) must not read as "the check broke".
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)
const sidecarText = existsSync(sidecarPath) ? stripBom(readFileSync(sidecarPath, 'utf8')) : null

// --- check 1: every token name the docs rely on still exists -----------------

const DOC_FILES = [
  ['DESIGN.md', design],
  ...(sidecarText === null ? [] : [['.impeccable/design.json', sidecarText]]),
]
for (const [label, text] of DOC_FILES) {
  // Two things in prose look like token references but are not:
  //
  //  1. A token FAMILY (`--dsw-elevation-*`) — a wildcard, not a name. Any match
  //     immediately followed by '*' is dropped.
  //  2. A deliberately recorded ABSENCE — the docs owe their readers the fact that
  //     a token the shell never shipped is being referenced (deleting the mention
  //     would delete the information). Such a mention is marked:
  //         <!-- dsw-missing: --dsw-some-token -->   (Markdown)
  //         "dsw-missing: --dsw-some-token"          (JSON, which has no comments)
  //     Everything after the marker is prose, so only the marker-and-name prefix is
  //     matched: the exemption is stated in the document itself, not hidden here.
  const excused = new Set([...text.matchAll(/dsw-missing:\s*(--dsw-[a-z0-9-]+)/g)].map((m) => m[1]))
  const names = new Set()
  for (const m of text.matchAll(/--dsw-[a-z0-9-]+/g)) {
    if (text[m.index + m[0].length] === '*') continue
    if (excused.has(m[0])) continue
    names.add(m[0])
  }
  const missing = [...names].filter((n) => !declared.has(n))
  if (missing.length > 0) {
    failures.push(`${label}: names tokens the DSH shell does not declare: ${missing.join(', ')}`)
  } else {
    const note = excused.size > 0 ? ` (${excused.size} documented-absent token(s) exempted by marker)` : ''
    notes.push(`${label}: ${names.size} referenced tokens all still declared${note}`)
  }
}

// --- check 1b: every host token the STYLESHEET references must exist ----------
// The docs check above only sees names written in DESIGN.md, which is why two
// separate "references a token the shell never declared" defects shipped without
// notice (--dsw-alias-separator-primary, --dsw-alias-state-business-primary-alpha).
// DESIGN.md happened to name neither, so the audit was structurally blind to the
// class. This closes it from the other end: scan the CSS itself.
//
// A `var(--dsw-x)` with a fallback is a deliberate soft dependency and is left
// alone; a bare `var(--dsw-x)` on a name the shell does not declare can never
// paint, so it is a defect by construction.
{
  const localAliases = new Set()
  for (const file of ['src/client/board.module.css', 'src/client/settings-card.module.css']) {
    const p = join(root, file)
    if (!existsSync(p)) continue
    const css = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) localAliases.add(m[1])
    const seenRef = new Set()
    for (const m of css.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)\s*(,)?/g)) {
      const name = m[1]
      const hasFallback = m[2] === ','
      if (hasFallback || declared.has(name) || seenRef.has(name)) continue
      seenRef.add(name)
      // Locate one declaration line for a usable message.
      const at = css.indexOf(name)
      const line = css.slice(0, at).split('\n').length
      failures.push(
        `${file}:${line}: var(${name}) has no fallback and the DSH shell never declares it — every declaration using this custom property is invalid at computed-value time and paints nothing`,
      )
    }
    // The board's own alias namespace is declared on `[data-dsh-taskboard-view]`,
    // so it exists ONLY inside that scope. A stylesheet that never mentions the
    // attribute cannot see those aliases, and referencing one there resolves to
    // nothing — the failure mode is invisible in review (the declaration simply
    // does not paint) and it is easy to introduce by copying a token name between
    // files. Host tokens are global; aliases are not.
    if (!/data-dsh-taskboard-view/.test(css)) {
      for (const m of css.matchAll(/var\(\s*(--dsh-tb-[a-z0-9-]+)/g)) {
        const at = css.indexOf(m[1])
        const line = css.slice(0, at).split('\n').length
        failures.push(
          `${file}:${line}: var(${m[1]}) is a BOARD alias, and this stylesheet is not inside the [data-dsh-taskboard-view] scope where it is declared — it resolves to nothing here. Use the host token the alias maps to instead.`,
        )
      }
    }
    notes.push(`${file}: ${localAliases.size} local custom properties, ${[...css.matchAll(/var\(\s*--dsw-/g)].length} host-token references audited`)
  }
}

// --- check 2: the values the docs record are the values the tokens resolve to --

const sidecar = sidecarText === null ? null : JSON.parse(sidecarText)
if (sidecar !== null) {
  const meta = sidecar.extensions?.colorMeta ?? {}
  const entries = Object.entries(meta)
  const unmapped = entries.filter(([, e]) => typeof e.token !== 'string').map(([k]) => k)
  // Regenerating the sidecar (a `document` run) rewrites it from scratch and does
  // not know about the `token` field. Without this guard the color half of the
  // check would quietly compare nothing and still report success — a checker that
  // passes because it ran on empty input is worse than no checker.
  if (entries.length > 0 && unmapped.length > entries.length / 2) {
    failures.push(
      `.impeccable/design.json: ${unmapped.length}/${entries.length} colorMeta entries have no "token" field, so no color value could be verified — the sidecar looks regenerated (a document re-run drops the field). Re-add each entry's source token and re-run.`,
    )
  }
  let checked = 0
  let notRemarked = 0
  for (const [key, entry] of entries) {
    // The key is a display slug (canvas, text-primary); the source token is
    // declared in the entry itself so nothing has to be guessed here.
    const token = entry.token
    if (typeof token !== 'string') continue
    let compared = false
    for (const [field, table, scheme] of [
      ['canonical', lightTable, 'light'],
      ['darkValue', darkTable, 'dark'],
    ]) {
      const recorded = entry[field]
      if (typeof recorded !== 'string') continue
      const resolved = resolveToken(token, table)
      if (resolved === undefined) continue // check 1 already reported a missing name
      // A token that resolves to a `color-mix()`/alpha expression is intentionally
      // not comparable to a plain hex; report it instead of failing on it.
      if (rgba(resolved) === null) { notes.push(`colorMeta.${key}.${field}: ${token} resolves to "${resolved}" (not a plain color) — not compared`); continue }
      if (rgba(recorded) === null) { notes.push(`colorMeta.${key}.${field}: recorded "${recorded}" is not a plain hex — not compared`); continue }
      checked++
      compared = true
      if (!sameColor(recorded, resolved)) {
        failures.push(`colorMeta.${key}.${field} (${scheme}): the sidecar records ${recorded}, but ${token} resolves to ${resolved} today`)
      }
    }
    if (!compared) notRemarked++
  }
  notes.push(`colorMeta: ${checked} recorded values compared against live token resolution (${notRemarked} mapped entries had nothing comparable)`)
}

// --- report ------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`verify-design-docs FAILED (${failures.length})`)
  for (const f of failures) console.error('  - ' + f)
  for (const n of notes) console.error('  context: ' + n)
  console.error('  Either the shell moved (re-run /impeccable document), or the docs cite a token')
  console.error('  the shell never declared (fix DESIGN.md / the sidecar). Neither is auto-repaired here.')
  process.exit(1)
}
for (const n of notes) console.log('note: ' + n)
console.log(`verify-design-docs OK: DESIGN.md still describes the tokens it claims (theme read from ${dsh})`)
