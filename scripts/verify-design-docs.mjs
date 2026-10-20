/**
 * Design-doc check: DESIGN.md and its sidecar record DSH token values. This is
 * what notices when the shell's tokens move out from under them.
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
import { resolve, join, dirname, relative, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { probeOf } from './probe-args.mjs'

const root = resolve(process.argv[2] ?? '.')
/* 自测开关先过一遍：拼错要红，不能静默变成一次正常跑（见 `probe-args.mjs`）。 */
const activeProbe = probeOf(['--probe-binding', '--probe-crosssheet', '--probe-dupes', '--probe-dataattrs'])
const failures = []
const notes = []

/**
 * Every stylesheet the client half owns, discovered rather than listed.
 *
 * A named list of sheets goes stale the moment a surface gets its own
 * stylesheet: the new sheet is then checked by nothing at all, and it is exactly
 * the new sheet whose class names nobody has reviewed against the design system.
 * Walking the tree means the next one is covered the day it is created, which is
 * the only version of "keep this list current" that survives contact with a
 * deadline.
 *
 * `*.module.css` is the build's own convention (one hashed class scope per
 * sheet), so the walk keys on it rather than on a filename.
 */
const CLIENT_STYLESHEETS = (() => {
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
})()

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

// ── the probe: the reader must be shown to bite ─────────────────────────────
//
// Planted in memory, against the pure reader, so nothing in the working tree is
// touched (hard rule 16). Each case says what the reader must conclude, and the
// lawful twins are here because a checker that reports everything is as useless
// as one that reports nothing — the pair is what pins the judgement.
if (activeProbe === '--probe-binding') {
  const FILE = '/repo/src/client/board/Thing.tsx'
  // Resolved the SAME way the reader resolves an import, not spelled out: on
  // Windows `resolve('/repo/...')` gains a drive prefix, so a hand-written key
  // never matches and the probe passes while judging nothing.
  const BOARD = resolve(dirname(FILE), '../board.module.css')
  const DESIGN = resolve(dirname(FILE), '../design/components.module.css')
  const classesOf = new Map([[BOARD, new Set(['input', 'columnTab'])], [DESIGN, new Set(['input', 'chip'])]])
  const defined = new Set(['input', 'columnTab', 'chip'])

  /** What the reader concludes for one planted module. */
  const verdicts = (text) => classReferences(text, FILE)
    .map(ref => `${ref.alias}.${ref.name}=${judgeReference(ref, classesOf, defined)}`)
    .sort()
    .join(' ')

  const planted = [
    // The failure this check exists for: declared, but in the OTHER sheet — the
    // alias compiles to a hash nothing renders, and the control falls back to UA
    // styling with nothing reporting it.
    ['a class from the other sheet is foreign',
      'import css from "../board.module.css"\nconst x = css.chip', 'css.chip=foreign'],
    // The same class through the sheet that declares it is lawful. The pair is
    // the point: a checker that flags both is as useless as one that flags none.
    ['the same class through its own sheet is lawful',
      'import design from "../design/components.module.css"\nconst x = design.chip', 'design.chip=ok'],
    ['a class no sheet declares is unknown',
      'import css from "../board.module.css"\nconst x = css.nope', 'css.nope=unknown'],
    // An import PATH ends in `x.module.css`; read as a usage it invents a class
    // named `module` and reports it as undeclared.
    ['an import path is not a usage',
      'import design from "../design/components.module.css"\nconst x = design.chip', 'design.chip=ok'],
    // A module with no stylesheet import at all has no sheet to judge against;
    // the `css` fallback keeps a re-exported sheet readable.
    ['the css fallback reads a re-exported sheet',
      'const x = css.chip', 'css.chip=ok'],
    ['both aliases in one module are read separately',
      'import css from "../board.module.css"\nimport design from "../design/components.module.css"\nconst a = css.columnTab\nconst b = design.chip',
      'css.columnTab=ok design.chip=ok'],
  ]
  const wrong = []
  for (const [what, text, expected] of planted) {
    const got = verdicts(text)
    if (got !== expected) wrong.push(`${what}: expected "${expected}", got "${got}"`)
  }
  if (wrong.length > 0) {
    for (const line of wrong) console.error(`probe: ${line}`)
    console.error('verify-design-docs probe FAILED: the class-reference reader does not bite')
    process.exit(1)
  }
  console.log(`verify-design-docs self-test OK: ${planted.length} planted module(s) read as expected (a class from the other sheet and an undeclared one are reported; the same class through its own sheet, an import path, and a re-exported sheet are not)`)
  process.exit(0)
}

// ── the cross-sheet probe: the reader must be shown to bite ───────────────────
//
// Planted against the pure reader, so nothing in the working tree is touched
// (hard rule 16). The lawful twins are here for the same reason as above: the
// whole difficulty of this check is that a SHARED name is legitimate, and a
// checker that reports shared names would be worse than none — it would force
// authors to rename classes that are working correctly.
if (activeProbe === '--probe-dataattrs') {
  const A = 'src/client/board/Thing.tsx'
  const B = 'src/client/board.module.css'
  const cases = [
    // The failure: set on every render, read by nothing.
    ['an attribute read by nothing is reported',
      [[A, '<div data-ghost={x}>']], ['data-ghost']],
    // Read by a SELECTOR — the normal case.
    ['an attribute a sheet selects on is not reported',
      [[A, '<div data-open={x}>'], [B, '.row[data-open] { color: red }']], []],
    // Read by a query in the same file — the occurrence is not a write.
    ['an attribute queried in the same file is not reported',
      [[A, '<div data-mark="">\nconst el = root.querySelector("[data-mark]")']], []],
    // Read by a TEST — the reason the walk covers tests too.
    ['an attribute only a test reads is not reported',
      [[A, '<div data-mark="">'], ['tests/x.spec.ts', 'expect(root.querySelector("[data-mark]")).toBeTruthy()']], []],
    // Our own subtree marks are exempt by convention.
    ['the plugin subtree marks are exempt',
      [[A, '<div data-dsh-taskboard-view="">']], []],
    // CONSERVATIVE: a prose mention counts as read, so this one is missed rather
    // than reported. That is the direction the check errs in, on purpose.
    ['a prose mention clears it, and that is deliberate',
      [[A, '<div data-ghost={x}>\n// the data-ghost state']], []],
  ]
  const wrong = []
  for (const [what, files, expected] of cases) {
    const got = orphanDataAttrs(files).map(o => o.name)
    if (got.join(',') !== expected.join(',')) wrong.push(`${what}: expected [${expected}], got [${got}]`)
  }
  if (wrong.length > 0) {
    for (const line of wrong) console.error(`probe: ${line}`)
    console.error('verify-design-docs probe FAILED: the data-hook reader does not bite')
    process.exit(1)
  }
  console.log(`verify-design-docs data-hook probe OK: ${cases.length} planted file set(s) read as expected (an attribute with no reader is reported; one read by a selector, a query, a test or a prose mention is not, and the plugin subtree marks are exempt)`)
  process.exit(0)
}

if (activeProbe === '--probe-dupes') {
  const A = 'src/client/board.module.css'
  const B = 'src/client/item/item.module.css'
  const cases = [
    // The failure: one form, two homes.
    ['the same body in two sheets is reported',
      [[A, '.x { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }'],
        [B, '.y { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }']], 1],
    // Order and whitespace are not the form.
    ['declaration order does not matter',
      [[A, '.x { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }'],
        [B, '.y { white-space: nowrap; text-overflow: ellipsis; overflow: hidden; min-width: 0; flex: 1 }']], 1],
    // The lawful twin: the same body in ONE sheet is a shorthand, not a copy.
    ['the same body twice in one sheet is not reported',
      [[A, '.x { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }\n.y { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }']], 0],
    // Below the threshold, common one-liners would drown the check.
    ['a short body is below the threshold',
      [[A, '.x { display: flex; align-items: center }'], [B, '.y { display: flex; align-items: center }']], 0],
    // A comment is not a declaration.
    ['a comment does not change the body',
      [[A, '.x { /* why */ flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }'],
        [B, '.y { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }']], 1],
    // At-rules are containers, not rules.
    ['an at-rule prelude is not a rule body',
      [[A, '@media (hover: none) { .x { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis } }'],
        [B, '.y { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis }']], 1],
  ]
  const wrong = []
  for (const [what, sheets, expected] of cases) {
    const got = duplicateBodies(sheets).length
    if (got !== expected) wrong.push(`${what}: expected ${expected}, got ${got}`)
  }
  if (wrong.length > 0) {
    for (const line of wrong) console.error(`probe: ${line}`)
    console.error('verify-design-docs probe FAILED: the duplicate-body reader does not bite')
    process.exit(1)
  }
  console.log(`verify-design-docs duplicate-body probe OK: ${cases.length} planted sheet pair(s) read as expected (a shared body across sheets is reported; order, comments and a same-sheet repeat are not, and a short body is below the threshold)`)
  process.exit(0)
}

if (activeProbe === '--probe-crosssheet') {
  const BOARD = 'src/client/board.module.css'
  const DESIGN = 'src/client/design/components.module.css'
  const MINE = new Set(['mask', 'modal', 'rowAction'])
  const FOREIGN = new Map([['modalBackdrop', DESIGN], ['chip', DESIGN], ['@dsh-tb-panel', DESIGN]])

  const cases = [
    // The class half. Both known instances looked exactly like this.
    ['a class only another sheet declares is reported',
      '.mask .modalBackdrop { padding: 8px }', 1],
    // The lawful twin: this sheet declares it, so the hash resolves here.
    ['a class this sheet declares is not reported',
      '.mask .modal { padding: 24px }', 0],
    // The container half — the one that made a whole at-rule block dead.
    ['a container only another sheet declares is reported',
      '@container dsh-tb-panel (max-width: 680px) { .mask { padding: 8px } }', 1],
    ['an unnamed container query is not reported',
      '@container (max-width: 680px) { .mask { padding: 8px } }', 0],
    ['a container this sheet declares is not reported',
      '@container mask (max-width: 680px) { .mask { padding: 8px } }', 0],
    // Element selectors and property values are not class names.
    ['an element selector is not a class name', 'p { margin: 0 }', 0],
    ['a value that looks like a name is not a selector',
      '.mask { container-name: dsh-tb-panel }', 0],
    ['both halves in one sheet are counted separately',
      '.mask .chip { padding: 0 } @container dsh-tb-panel (max-width: 1px) { .rowAction { color: red } }', 2],
  ]

  const wrong = []
  for (const [what, text, expected] of cases) {
    const got = crossSheetRefs(text, MINE, FOREIGN).length
    if (got !== expected) wrong.push(`${what}: expected ${expected}, got ${got}`)
  }
  /* **定义读法本身的自测**，与上面那组分开：上面测的是「引用判得对不对」，这里测的是
   * 「本表声明了什么」——两个不同的判断，而后者曾经把三处跨表失效读成「自己也有」。 */
  const declaresCases = [
    ['a plain class rule is a definition', '.chip { flex: none }', ['chip']],
    ['a state rule is the same definition', '.chip:hover { color: red }', ['chip']],
    ['an attribute修饰 is the same definition', '.chip[data-x] { flex: none }', ['chip']],
    ['a pseudo element is the same definition', '.chip::before { content: "" }', ['chip']],
    ['a compound using another sheet\'s class is NOT a definition',
      '.waitingNotice .chip { flex: none }', []],
    ['a child combinator naming another sheet\'s class is NOT a definition',
      '.thumbRail > .thumbPrimary { flex: 1 }', []],
    ['a sibling combinator is NOT a definition', '.a + .chip { x: y }', []],
    ['two classes compounded are NOT definitions', '.mask.chip { x: y }', []],
    ['a comma list defines each plain class', '.chip, .pill { x: y }', ['chip', 'pill']],
    ['an at-rule prelude is not a definition', '@container (max-width: 1px) { .chip { x: y } }', ['chip']],
  ]
  for (const [what, text, expected] of declaresCases) {
    const got = [...declaredClassesOf(text)].sort().join(',')
    if (got !== expected.join(',')) wrong.push(`declared: ${what}: expected [${expected}], got [${got}]`)
  }
  if (wrong.length > 0) {
    for (const line of wrong) console.error(`probe: ${line}`)
    console.error('verify-design-docs probe FAILED: the cross-sheet reader does not bite')
    process.exit(1)
  }
  console.log(`verify-design-docs cross-sheet probe OK: ${cases.length} planted sheet(s) read as expected (a class or container from another sheet is reported; a shared name, an unnamed query, an element selector and a value that looks like a name are not)`)
  process.exit(0)
}

/**
 * 一张表**定义**了哪些类——判据是「这一段选择器就是那个类」，不是「全文出现过」。
 *
 * ── 为什么这一处是整个跨表检查的成败处 ──────────────────────────────────────
 *
 * 第一版用 `/\.(-?[_a-zA-Z][\w-]*)/g` 全文扫 `.xxx`。于是**任何一处提及**都让这个类
 * 被算成「本表已声明」——包括后代引用（`.waitingNotice .chip`）、属性值。后果是这条
 * 检查**看不见它存在的理由**：board 表写了 `.waitingNotice .chip`（`chip` 只定义在
 * `design/components.module.css`），宽松读法因此认为 board 声明了 `chip`，`foreign`
 * 里没有它，findings = 0——而那条规则在生产包里是死的（按表哈希，两个字符串永不相同）。
 *
 * 第二版改成「起首类名」，仍然不够：`.thumbRail > .thumbPrimary` 的起首是 `.thumbRail`，
 * 于是 board 被读成声明了 `thumbRail`——而它声明的是**一个用别表类名做的后代选择器**。
 *
 * 现行判据：这一段**从前到后**就是 `.name` 加可选的伪类/属性修饰
 * （`.name`、`.name:hover`、`.name[data-x]`、`.name::before`）。出现空格、`>`、`+`、
 * `~` 或第二个类，就说明这一段在**引用**什么，不是在**定义**什么。
 *
 * PURE，所以 probe 能直接种文本断言判据会咬（硬性规范 16）。
 * @param css - 已经剥掉注释的样式表文本。
 * @returns 这张表定义的类名集合。
 */
function declaredClassesOf(css) {
  const out = new Set()
  /* **按块递归，不是平铺扫。** 一条 `@container …{ .chip { … } }` 里的 `.chip` 是真定义；
   * 平铺正则会把 `@container …{ .chip` 整段当成一个前导，于是它 `startsWith('@')` 被跳过，
   * 里面的类一个也不算。这个仓库的窄档规则全在 at-rule 里（164 条），所以漏掉它们等于
   * 这条判据在最密集的那一段上失效。 */
  const walk = (text) => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) break
      let depth = 1
      let j = open + 1
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') depth--
        j++
      }
      const prelude = text.slice(i, open).trim()
      const body = text.slice(open + 1, j - 1)
      if (prelude.startsWith('@')) {
        walk(body)
      } else if (prelude !== '') {
        for (const part of prelude.split(',')) {
          const own = part.trim().match(/^\.(-?[_a-zA-Z][\w-]*)((?:[:[][^>+~\s]*)*)$/)
          if (own !== null) out.add(own[1])
        }
      }
      i = j
    }
  }
  walk(css)
  return out
}

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

// The snapshot rule below applies to PRODUCT.md too (it is a hand-written doc for
// the same readers), but the token checks above are about tokens and colors, which
// PRODUCT.md does not carry — so it is scanned by the snapshot pass only rather
// than joining DOC_FILES and reporting "0 referenced tokens" noise.
const snapshotFiles = (() => {
  const productPath = join(root, 'PRODUCT.md')
  return existsSync(productPath) ? [['PRODUCT.md', readFileSync(productPath, 'utf8')]] : []
})()

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
  /** Alias name → one site that uses it, for a message that can be acted on. */
  const aliasRefs = new Map()
  for (const p of CLIENT_STYLESHEETS) {
    const file = relative(root, p).split(sep).join('/')
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
    // THE ALIAS LAYER IS INHERITED BY ELEMENTS, NOT BY STYLESHEETS.
    //
    // "A sheet that never mentions [data-dsh-taskboard-view] cannot see the
    // board's aliases" is FALSE, and believing it reports every alias in such a
    // sheet. It holds only while one stylesheet both declares the layer and uses
    // it. A sheet defines
    // RULES; those rules apply to whatever elements carry their classes, and
    // the elements are what carry the scope attribute. `item.module.css` never
    // names `data-dsh-taskboard-view` and does not need to: its root element
    // carries it, the layer is declared above it, and custom properties
    // inherit down the tree. Making that sheet repeat the attribute to satisfy
    // the checker would be changing correct code to suit a reader that had lost
    // its context (hard rule 14).
    //
    // What IS answerable statically, and is the failure worth catching, is the
    // other direction: an alias nobody declares. That is collected here and
    // judged after the loop, because the answer spans every sheet — a name
    // declared in one and used in another is the normal case, not a defect.
    //
    // A reference that CARRIES A FALLBACK is exempt, by the same rule the
    // host-token check above already states: it is a deliberate soft dependency
    // that degrades instead of dying. That exemption is also what lets a
    // property the CLIENT writes at runtime be referenced from CSS at all —
    // `--dsh-tb-kb` is set by `keyboard-inset.ts` when the soft keyboard
    // moves, which no stylesheet could declare, and every use of it ships a
    // `0px` fallback for exactly that reason.
    for (const m of css.matchAll(/var\(\s*(--dsh-tb-[a-z0-9-]+)\s*(,)?/g)) {
      const name = m[1]
      if (m[2] === ',' || aliasRefs.has(name)) continue
      const at = css.indexOf(name)
      aliasRefs.set(name, `${file}:${css.slice(0, at).split('\n').length}`)
    }
  }
  // An alias with no declaration paints nothing, in every sheet that names it,
  // and the declaration is the one thing a rename breaks silently — so this is
  // checked as a set rather than per sheet, which is the only place the answer
  // exists.
  for (const [name, at] of aliasRefs) {
    if (localAliases.has(name)) continue
    failures.push(
      `${at}: var(${name}) is used but no stylesheet declares it — the declaration is invalid at computed-value time and every rule naming it paints nothing`,
    )
  }
  if (aliasRefs.size > 0 && localAliases.size === 0) {
    failures.push(
      `the client half references ${aliasRefs.size} --dsh-tb-* aliases and NO stylesheet declares the layer any more — the whole alias namespace is dead. Check the [data-dsh-taskboard-view] block.`,
    )
  }
  notes.push(`${CLIENT_STYLESHEETS.length} stylesheet(s) audited: ${localAliases.size} custom properties declared, ${aliasRefs.size} alias references resolved against them`)
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

// --- check 5: no CSS class drifts away from the components ---------------------
// Both directions of this drift are silent, and neither is visible in review or to
// the detector (which cannot read CSS Modules):
//   - referenced but undefined: `css.foo` resolves to `undefined`, the element gets
//     the string "undefined" as a class and renders with NO styling. This is the
//     same failure mode as the board-alias-in-the-wrong-scope bug, and finding one
//     live instance is what motivated the check.
//   - defined but unreferenced: a rule nobody dares delete, which accumulates until
//     the stylesheet stops being readable. One live instance (`.interactionAmend`,
//     left behind when the plan card dropped its amendment field).
// The scan is exact rather than heuristic because this codebase reaches classes only
// through `css.<name>` — verified against the whole surface: 460 defined, 460
// referenced, zero on both sides.

/**
 * Every `alias.name` class reference in one module, with the sheet the alias
 * resolves to.
 *
 * PURE, and that is the point: the probe at the bottom of this file plants text
 * and asserts the reader bites, so the gate can be shown to work without touching
 * a real file (hard rule 16 — a shared workspace has two writers, and "edit it and
 * edit it back" proves the edit took effect, not that the gate would have caught
 * it).
 *
 * USAGES ONLY. Import statements are blanked out first, keeping every newline and
 * every column: an import PATH ends in `x.module.css`, which this scan otherwise
 * reads as an `x.module` usage and reports as a class no sheet declares. A module
 * importing a SECOND sheet is exactly when that starts happening.
 */
function classReferences(text, file) {
  const sheets = new Map()
  for (const m of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.module\.css)['"]/g)) {
    sheets.set(m[1], resolve(dirname(file), m[2]))
  }
  // Every LOCAL NAME bound to a stylesheet, whatever it is called, plus `css` as a
  // fallback so a module reaching its sheet through a re-export is still read.
  const bound = new Set(sheets.keys())
  bound.add('css')
  const body = text.replace(/^\s*import\s[\s\S]*?from\s*['"][^'"]*['"]\s*;?/gm, m => m.replace(/[^\n]/g, ' '))
  const out = []
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\.([a-zA-Z][\w-]*)/g)) {
    if (!bound.has(m[1])) continue
    out.push({ alias: m[1], name: m[2], sheet: sheets.get(m[1]), line: body.slice(0, m.index).split('\n').length })
  }
  return out
}

/**
 * The judgement, as a pure function of the reference and the sheets' class sets:
 * does this reference resolve to a class ITS OWN sheet declares?
 *
 *   'ok'      — yes, or the alias has no resolvable sheet (the `css` fallback) and
 *               the class exists somewhere.
 *   'foreign' — the class is declared, but in a DIFFERENT sheet. This is the
 *               silent one: the name resolves to a hash nothing renders, so the
 *               element falls back to UA styling with no error anywhere.
 *   'unknown' — no sheet declares it at all.
 *
 * Separated from the walk for the same reason `classReferences` is: the probe
 * plants inputs and asserts the verdicts, so the judgement is tested rather than
 * restated.
 */
function judgeReference(ref, classesOf, defined) {
  const own = ref.sheet !== undefined ? classesOf.get(ref.sheet) : undefined
  if (own === undefined) return defined.has(ref.name) ? 'ok' : 'unknown'
  if (own.has(ref.name)) return 'ok'
  return defined.has(ref.name) ? 'foreign' : 'unknown'
}

{
  const clientDir = join(root, 'src', 'client')
  const tsxFiles = []
  const walk = (d) => {
    if (!existsSync(d)) return
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(entry.name)) tsxFiles.push(p)
    }
  }
  walk(clientDir)

  const stripCssComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
  const defined = new Set()
  /** Each sheet's OWN classes, so a reference can be judged against the sheet it
   *  actually resolves to rather than against the union of all of them. */
  const classesOf = new Map()
  let classesDefined = 0
  for (const p of CLIENT_STYLESHEETS) {
    const css = stripCssComments(readFileSync(p, 'utf8'))
    const own = new Set()
    for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) { own.add(m[1]); defined.add(m[1]); classesDefined++ }
    classesOf.set(p, own)
  }

  const referenced = new Map()
  /** The same references, keyed by (sheet, name) — a definition is dead only when
   *  the sheet that DECLARES it has no reader for it. Keying by bare name let a
   *  dead rule hide behind a same-named class in another sheet. */
  const referencedBySheet = new Map()
  const markReferenced = (ref) => {
    if (ref.sheet !== undefined) {
      if (!referencedBySheet.has(ref.sheet)) referencedBySheet.set(ref.sheet, new Set())
      referencedBySheet.get(ref.sheet).add(ref.name)
      return
    }
    // Unattributable (the `css` fallback): credit every sheet that declares it.
    for (const [sheet, own] of classesOf) {
      if (!own.has(ref.name)) continue
      if (!referencedBySheet.has(sheet)) referencedBySheet.set(sheet, new Set())
      referencedBySheet.get(sheet).add(ref.name)
    }
  }
  for (const f of tsxFiles) {
    const text = readFileSync(f, 'utf8')
    for (const ref of classReferences(text, f)) {
      const at = `${relative(root, f).split(sep).join('/')}:${ref.line}`
      markReferenced(ref)
      const verdict = judgeReference(ref, classesOf, defined)
      if (verdict !== 'ok') {
        failures.push(verdict === 'foreign'
          ? `${at}: ${ref.alias}.${ref.name} is declared in ANOTHER stylesheet, not in the one ${ref.alias} imports. A class name is hashed from its filename, so this resolves to undefined and the element renders with NO styling at all — no build error, no warning, and it looks like a taste problem rather than a bug. Import the sheet that declares it and apply its class there.`
          : `${at}: ${ref.alias}.${ref.name} is not defined in any stylesheet — it resolves to undefined, so the element renders with no styling at all.`)
        // Counted as referenced anyway, so the audit does not report the same bug
        // a second time from the opposite direction ("defined but nothing
        // references it") and bury the actionable line.
        if (!referenced.has(ref.name)) referenced.set(ref.name, `${at}:${ref.alias}`)
        continue
      }
      if (!referenced.has(ref.name)) referenced.set(ref.name, `${at}:${ref.alias}`)
    }
  }

  for (const [name, at] of referenced) {
    if (!defined.has(name)) {
      // Only reachable for an alias with no resolvable import; a resolved one
      // was already judged against its own sheet above.
      const cut = at.lastIndexOf(':')
      failures.push(`${at.slice(0, cut)}: ${at.slice(cut + 1)}.${name} is not defined in any stylesheet — it resolves to undefined, so the element renders with no styling at all.`)
    }
  }
  // A SHEET READS ITS OWN CLASSES TOO, and the scan above cannot see it: it counts
  // `css.<name>` from TypeScript. A class reached by another rule in the same sheet
  // — a descendant, a state rule, an `:is()` list — is read, and calling it dead is
  // a false positive that teaches the reader to ignore this check.
  for (const sheet of classesOf.keys()) {
    const css = stripCssComments(readFileSync(sheet, 'utf8'))
    if (!referencedBySheet.has(sheet)) referencedBySheet.set(sheet, new Set())
    const read = referencedBySheet.get(sheet)
    // Every selector PRELUDE (what sits before a `{`), with the plain definition
    // definition form subtracted: `.<name> {` alone is the definition, anything
    // else that names it is a reader.
    for (const m of css.matchAll(/(^|[};])([^{}]*)\{/g)) {
      const prelude = m[2].trim()
      if (prelude === '') continue
      for (const name of new Set([...prelude.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(x => x[1]))) {
        if (prelude === `.${name}`) continue
        read.add(name)
      }
    }
  }

  let deadRules = 0
  for (const [sheet, own] of classesOf) {
    const read = referencedBySheet.get(sheet) ?? new Set()
    for (const name of own) {
      if (read.has(name)) continue
      deadRules++
      failures.push(`${relative(root, sheet).split(sep).join('/')}: .${name} is declared here and read by nothing that imports THIS sheet — a rule nobody dares delete. Remove it, or give it back its user.`)
    }
  }
  notes.push(`class drift: ${defined.size} classes defined, ${referenced.size} referenced by bare name, ${deadRules} sheet-local rule(s) with no reader`)
}

// --- check 5b: a declared custom property must have a consumer ----------------
// The mirror of the class-drift check, for the same reason and with the same
// two silent directions:
//   - DECLARED BUT NEVER READ is a token that answers nothing. It was measured:
//     `--dsh-tb-glass`, `--dsh-tb-lead-x`, `--item-pill-pad` and
//     `--item-pill-hair` were each declared with a paragraph explaining what
//     they were for and read by no rule at all — and `--dsh-tb-lead-x` was cited
//     in DESIGN.md as the worked example of a derivation nothing used.
//   - READ BUT NEVER DECLARED is the same failure the `--dsw-*` scan catches one
//     level up: the property is invalid at computed-value time and the rule
//     silently drops that declaration.
// The scan reads the whole client half (sheets AND TypeScript, because
// `keyboard-inset.ts` writes `--dsh-tb-kb` and `prose-field.tsx` writes
// `--item-prose-h` from inline styles), and it accepts the `var(--x, fallback)`
// form, which is how `--dsh-tb-corner` is read.
{
  const clientDir = join(root, 'src', 'client')
  const codeFiles = []
  const walkCode = (d) => {
    if (!existsSync(d)) return
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) walkCode(p)
      else if (/\.(?:ts|tsx)$/.test(entry.name)) codeFiles.push(p)
    }
  }
  walkCode(clientDir)

  const stripCss = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
  const declaredProps = new Map()
  for (const p of CLIENT_STYLESHEETS) {
    const css = stripCss(readFileSync(p, 'utf8'))
    for (const m of css.matchAll(/(?:^|[;{\s])(--[a-z][\w-]*)\s*:/g)) {
      if (!declaredProps.has(m[1])) declaredProps.set(m[1], relative(root, p).split(sep).join('/'))
    }
  }

  // Every mention of a property name anywhere in the client half, minus the
  // declarations themselves — a `var(--x)` read, a `var(--x, fallback)` read, a
  // name written from a script, or a bare name in a `style` object all count.
  const mentioned = new Set()
  for (const p of CLIENT_STYLESHEETS) {
    const css = stripCss(readFileSync(p, 'utf8'))
    for (const m of css.matchAll(/var\(\s*(--[a-z][\w-]*)/g)) mentioned.add(m[1])
  }
  for (const p of codeFiles) {
    const text = readFileSync(p, 'utf8')
    for (const m of text.matchAll(/--[a-z][\w-]*/g)) mentioned.add(m[0])
  }

  for (const [name, where] of declaredProps) {
    if (!mentioned.has(name)) {
      failures.push(`${where}: ${name} is declared but nothing reads it — a token with no consumer answers nothing. Delete it, or give it its reader.`)
    }
  }
  notes.push(`token consumers: ${declaredProps.size} custom propert(ies) declared across ${CLIENT_STYLESHEETS.length} sheet(s), ${[...declaredProps.keys()].filter(n => !mentioned.has(n)).length} with no reader`)
}

/**
 * Which names in ONE sheet's selectors can only resolve to ANOTHER sheet?
 *
 * PURE, and separated from the walk for the same reason `classReferences` is: the
 * probe at the bottom of this file plants text against this function, so the
 * judgement is shown to bite without touching the working tree (hard rule 16).
 *
 * `mine` is what this sheet declares; `foreign` maps a name to the sheet that
 * declares it, already excluding anything this sheet also declares — a SHARED
 * name resolves correctly in both sheets and must not be reported. Returns the
 * findings, not a boolean, so the caller can name the line and the owner.
 */
function crossSheetRefs(css, mine, foreign) {
  const out = []
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    const owner = foreign.get(m[1])
    if (owner === undefined) continue
    out.push({ kind: 'class', name: m[1], owner, at: m.index })
  }
  for (const m of css.matchAll(/@container\s+([\w-]+)/g)) {
    const owner = foreign.get(`@${m[1]}`)
    if (owner === undefined) continue
    out.push({ kind: 'container', name: m[1], owner, at: m.index })
  }
  return out
}

/**
 * Which rule BODIES appear in more than one sheet?
 *
 * PURE, and separated from the walk for the same reason the others are: the probe at
 * the bottom plants sheets and asserts the judgement, so the gate is shown to bite
 * without touching the working tree (hard rule 16).
 *
 * The body is normalised — comments stripped, declarations trimmed, whitespace
 * collapsed, order ignored — so a pair written in a different order still counts.
 * Two sheets declaring the same SHAPE under different names is 「共用文法只有一处家」
 * being broken, and the copy that goes stale is the one nobody looks at.
 *
 * @param sheets - [relative path, css text] pairs.
 * @param minDeclarations - how many declarations a body needs before it counts
 *   as a SHARED FORM rather than a coincidence. Three is the line: a two-line
 *   body is a fragment of a bigger shape (the ring width, the hover tint, the
 *   line box), and a body that small is legitimately re-spelled per sheet.
 *   @returns one finding per body shared by two or more sheets.
 */
function duplicateBodies(sheets, minDeclarations = 3) {
  const byBody = new Map()
  for (const [rel, text] of sheets) {
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '')
    /* A BRACE-MATCHING WALK, not a regex. A regex whose body cannot contain a brace
       skips every rule inside an at-rule — and in this codebase that is most of
       them, so the check would have reported almost nothing while looking healthy.
       The probe's at-rule case is what caught it. */
    let depth = 0
    let preludeStart = 0
    for (let i = 0; i < css.length; i++) {
      const ch = css[i]
      if (ch === '{') {
        const selector = css.slice(preludeStart, i).trim().replace(/\s+/g, ' ')
        let d = 1
        let j = i + 1
        for (; j < css.length && d > 0; j++) {
          if (css[j] === '{') d++
          else if (css[j] === '}') d--
        }
        // An at-rule prelude is a CONTAINER, not a rule. DESCEND into it rather than
        // skipping the block — the inner rules are the whole point, and `i = j - 1`
        // below would step past every one of them. Stepping to `i + 1` keeps the walk
        // inside; the depth tracking handles the rest.
        if (selector.startsWith('@')) {
          preludeStart = i + 1
          continue
        }
        if (selector !== '') {
          const body = css.slice(i + 1, j - 1)
          const norm = body.split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean).sort().join(';')
          if (norm !== '' && norm.split(';').length >= minDeclarations) {
            if (!byBody.has(norm)) byBody.set(norm, [])
            byBody.get(norm).push({ sheet: rel, selector })
          }
        }
        i = j - 1
        preludeStart = j
        continue
      }
      if (ch === '}') { depth--; preludeStart = i + 1 }
      else if (ch === ';' && depth === 0) preludeStart = i + 1
    }
  }
  const out = []
  for (const [body, sites] of byBody) {
    const sheetsInvolved = [...new Set(sites.map(s => s.sheet))]
    /* **同一张表里的两份同体也算重复。** 这一句原先只判「跨表」，理由是「同一张表的两条
     * 规则可以靠顺序叠加」。那个理由在**逐字相同**的情况下不成立：两份一模一样，后一份
     * 覆盖前一份，等于谁都没有说话——而它永远不会有任何报错。
     *
     * 这条盲区是真的踩上过：`.titleText` 在同一张表里被写了两遍（整段注释一起复制），
     * 而那一刻 `shared forms: 0` 是真话——它只证明了「没有跨表拷贝」。判据要问的是
     * 「这条形态有几个家」，不是「它跨了几张表」。 */
    const selectors = sites.map(s => s.selector)
    const sameSelectorTwice = new Set(selectors).size < selectors.length
    if (sheetsInvolved.length < 2 && !sameSelectorTwice) continue
    out.push({ body, sites, sheets: sheetsInvolved })
  }
  return out
}

/**
 * Which `data-*` hooks are written and read by nothing?
 *
 * PURE, and separated from the walk for the same reason the others are: the probe
 * plants files and asserts the judgement (hard rule 16).
 *
 * CONSERVATIVE BY DESIGN. A name counts as read if it appears anywhere other than as
 * a write — even inside a sentence — so an orphan that someone happens to mention in
 * a comment is missed, and a live hook is never reported. The other direction is how
 * a gate earns a reputation for crying wolf.
 *
 * @param files - [relative path, text] pairs, from `src/` and `tests/`.
 * @returns the names that only ever appear as writes.
 */
function orphanDataAttrs(files) {
  const WRITE = /(?:^|[\s{,'"`])(data-[a-z0-9-]+)\s*[=/>'"`]/g
  /** How many times each name is WRITTEN, per file. */
  const writesIn = new Map()
  /** How many times each name appears at all, per file — write or read. */
  const allIn = new Map()
  for (const [rel, text] of files) {
    for (const m of text.matchAll(WRITE)) {
      if (!writesIn.has(m[1])) writesIn.set(m[1], new Map())
      const per = writesIn.get(m[1])
      per.set(rel, (per.get(rel) ?? 0) + 1)
    }
    for (const m of text.matchAll(/data-[a-z0-9-]+/g)) {
      if (!allIn.has(m[0])) allIn.set(m[0], new Map())
      const per = allIn.get(m[0])
      per.set(rel, (per.get(rel) ?? 0) + 1)
    }
  }
  const out = []
  for (const [name, writes] of writesIn) {
    /* The plugin's own subtree marks. They are read by JavaScript and by tests rather
       than by selectors, and the prefix is the plugin id — which is why the first
       version's `data-dsh-tb-` exemption matched none of them. */
    if (name.startsWith('data-dsh-taskboard-')) continue
    /* READ means: the name occurs more times than it is written. Counting beats
       looking at the next character, because a space after the name is both a bare
       JSX attribute and a word in a sentence. */
    let read = false
    for (const [rel, total] of allIn.get(name) ?? []) {
      if (total > (writes.get(rel) ?? 0)) { read = true; break }
    }
    if (!read) out.push({ name, sheets: [...writes.keys()] })
  }
  return out
}

// --- check 5c: a sheet's SELECTOR may only name its own classes ----------------
// The class-drift check above answers "does this name exist somewhere". This one
// answers the question that actually bit twice: **does it exist in THIS sheet.**
//
// Class names AND `container-name` values are hashed per sheet, so a selector in
// sheet A naming a class that only sheet B declares matches NOTHING in the
// production bundle. Both known instances were invisible to every gate:
//   - four compact-band rules lost their enclosing at-rule and became top-level,
//     so the dialog mask and the colour swatches took their touch values at every
//     width and on every pointer — measured: mask padding 8px where the base rule
//     says 24px, swatch 24px where the base says 16px;
//   - `@container dsh-tb` in the design system's sheet compiled to
//     `QeuTqq_dsh-tb` while the container is declared in the board's sheet as
//     `Sr3ygG_dsh-tb`, so the whole query never matched — and the four escaped
//     rules above were propping it up, which is why removing them first made the
//     compact band vanish entirely.
//
// The rule is stated so a SHARED name is not a false positive: a name declared in
// both sheets resolves correctly in both, and is fine. Only a name that this sheet
// does NOT declare, and some other sheet does, can only ever mean the other one.
{
  const stripCss = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
  const classesOf = new Map()
  const containersOf = new Map()
  for (const p of CLIENT_STYLESHEETS) {
    const rel = relative(root, p).split(sep).join('/')
    const css = stripCss(readFileSync(p, 'utf8'))
    classesOf.set(rel, declaredClassesOf(css))
    containersOf.set(rel, new Set([...css.matchAll(/container-name\s*:\s*([\w-]+)/g)].map((m) => m[1])))
  }

  const sheets = [...classesOf.keys()]
  let crossFindings = 0
  for (const rel of sheets) {
    const css = stripCss(readFileSync(join(root, rel), 'utf8'))
    const mine = classesOf.get(rel)
    const foreign = new Map()
    for (const other of sheets) {
      if (other === rel) continue
      for (const name of classesOf.get(other)) if (!mine.has(name)) foreign.set(name, other)
    }
    // Container names go in the same map under an `@` prefix: one lookup, one
    // "which sheet owns this name" answer, two kinds of name.
    const myContainers = containersOf.get(rel)
    for (const other of sheets) {
      if (other === rel) continue
      for (const name of containersOf.get(other)) if (!myContainers.has(name)) foreign.set(`@${name}`, other)
    }

    for (const ref of crossSheetRefs(css, mine, foreign)) {
      const line = css.slice(0, ref.at).split('\n').length
      failures.push(ref.kind === 'class'
        ? `${rel}:${line}: the selector names .${ref.name}, which only ${ref.owner} declares — class names are hashed per sheet, so this matches nothing in the production bundle. Give it a class this sheet declares, or move the rule to ${ref.owner}.`
        : `${rel}:${line}: the query names container \`${ref.name}\`, which is declared in ${ref.owner} — container names are hashed per sheet too, so this query never matches. Use an unnamed query, or declare the container here.`)
      crossFindings++
    }
  }
  notes.push(`cross-sheet selectors: ${sheets.length} sheet(s) checked, ${crossFindings} reference(s) that could only resolve to another sheet`)
}

/**
 * Rule bodies that legitimately live in more than one sheet.
 *
 * Each needs a reason, and the reason has to be structural rather than a preference:
 * a body whose SELECTORS must differ per sheet cannot be hoisted, and CSS Modules
 * makes that true of anything naming a class. The shared part of such a form is its
 * TOKENS, and those live in the token layer.
 */
const PER_SHEET_FORMS = [
  {
    match: 'display: inline-flex;justify-content: center',
    why: '行内弹性居中这一条文法：药丸、芯片、选项在三个表里各写一遍。**选择器不能跨表**（类名按表哈希），而这一条本身只有三行声明、没有令牌可依——它是一句「把这个盒子摆正」的话，谁用谁写。共享的部分是**它摆正后读的那几个令牌**（间距、字号、颜色），那些各有其家。',
  },
  {
    match: 'color: var(--dsh-tb-text-2);font-size: 12px;margin: 0',
    why: '一段说明文字（空态提示、展页里的「为什么这样」）：同一档字号与颜色在两个表里各写一遍。选择器不能跨表，而这三行都是**令牌**（第二档墨 + 12px），令牌才是共享的那一份。',
  },
  {
    match: 'display: flex;flex-direction: column;min-inline-size: 0',
    why: '竖排的一列（展页的色板文字、清单的议程、展开体侧栏）：一行弹性列 + 不许被内容撑宽，三个表各写一遍。选择器不能跨表；**那一列能不能缩**是这句文法的全部内容，而它没有令牌可读（宽度是布局决定的，不是值）。',
  },
  {
    match: '--dsh-tb-hit-ring-block',
    why: 'DEBT: the invisible touch ring. Its declarations are identical in both sheets on purpose — the selectors cannot be, because a class name is hashed per sheet, so one rule cannot reach the board\'s controls and the design system\'s at once. What is shared is the SPEC, and that is the token (--dsh-tb-hit-ring-*), which is declared once.',
  },
]

// --- check 5d: a shared form lives in ONE sheet -------------------------------
{
  const sheets = CLIENT_STYLESHEETS.map(p => [relative(root, p).split(sep).join('/'), readFileSync(p, 'utf8')])
  const all = duplicateBodies(sheets)
  const excused = all.filter(d => PER_SHEET_FORMS.some(e => d.body.includes(e.match)))
  const dupes = all.filter(d => !excused.includes(d))
  for (const dupe of dupes) {
    const where = dupe.sites.map(s => `${s.sheet} ${s.selector}`).join('  ==  ')
    failures.push(`${dupe.sheets.join(' + ')}: the same ${dupe.body.split(';').length}-declaration rule body is declared in more than one sheet — ${where}. Two copies of one form drift the first time someone changes one of them, and the screen says nothing. Keep one, and let the other compose it.`)
  }
  notes.push(`shared forms: ${sheets.length} sheet(s) checked, ${dupes.length} rule body(ies) declared in more than one, ${excused.length} excused with a reason`)
}

// --- check 5e: a data hook must have a reader ---------------------------------
{
  const read2 = (dir) => {
    const base = join(root, dir)
    if (!existsSync(base)) return []
    const found = []
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (/\.(?:tsx?|module\.css)$/.test(entry.name)) found.push([relative(root, p).split(sep).join('/'), readFileSync(p, 'utf8')])
      }
    }
    walk(base)
    return found
  }
  // WRITES come from src/ only: a spec may read a hook, it does not declare one.
  const files = [...read2('src'), ...read2('tests')]
  const orphans = orphanDataAttrs(files).filter(o => o.sheets.every(f => f.startsWith('src/')))
  for (const orphan of orphans) {
    failures.push(`${orphan.sheets.join(', ')}: ${orphan.name} is written on every render and read by nothing — not by a selector, not by a query, not by a test. It is inert, which is exactly why it misleads: the next reader preserves it out of caution. Delete it, or give it a reader.`)
  }
  notes.push(`data hooks: ${files.length} file(s) scanned, ${orphans.length} attribute(s) written with no reader`)
}

// --- check 6: no snapshot values in the docs ---------------------------------
// The project's own rule for AGENTS.md is 「写意图不写快照」, and these two docs
// inherit it. A count of lines, files, tests or keys is TRUE for exactly one
// commit and silently wrong forever after: this file's prose claimed "6779 行"
// while the stylesheet had already grown past 6900, and PRODUCT.md advertised
// "78 个测试" long after the suite had been restructured. A number that asserts a
// measurement goes stale; a principle does not. Thresholds and pixel values are
// not snapshots — only counts of things that grow.
{
  const SNAPSHOT_RES = [
    { re: /\d{2,}\s*行/g, what: 'a line count' },
    // "78 个测试" / "1200 个键" / "32 个文件" — the measure sits between the number
    // and 个, so the noun cannot be adjacent to the digits.
    { re: /\d{2,}\s*个[^\s，。；、）)]{0,4}(?:测试|用例|键|文件)/g, what: 'a count of files/tests/keys' },
    { re: /\d+(?:\.\d+)?\s*(?:KB|MB)\b/g, what: 'a file size' },
  ]
  for (const [label, text] of [...DOC_FILES, ...snapshotFiles]) {
    for (const { re, what } of SNAPSHOT_RES) {
      for (const m of text.matchAll(re)) {
        const line = text.slice(0, m.index).split('\n').length
        const around = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\n/g, ' ')
        failures.push(`${label}:${line}: records ${what} (${JSON.stringify(m[0])}) — a snapshot that goes stale. State the principle or the invariant instead (AGENTS.md 「写意图不写快照」). Context: …${around}…`)
      }
    }
  }
  notes.push(`snapshot scan: ${DOC_FILES.length + snapshotFiles.length} documents checked for line/size/count assertions`)
}

// --- check 4: a disclosure reports its state AND its subject -------------------
// `aria-expanded` without `aria-controls` tells a screen reader the control's
// state but not what it governs — and this project already had the right pattern
// in some places and was missing it in others (the interaction card's collapse
// button was the concrete case). Mechanical, so it costs nothing to keep honest:
// every element carrying `aria-expanded` must also carry `aria-controls`.
{
  const walkTsx = (dir) => {
    const out = []
    if (!existsSync(dir)) return out
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...walkTsx(p))
      else if (entry.name.endsWith('.tsx')) out.push(p)
    }
    return out
  }
  let checked = 0
  for (const file of walkTsx(join(root, 'src', 'client'))) {
    const text = readFileSync(file, 'utf8')
    // Split into JSX opening tags so an aria-expanded can be matched against the
    // attributes of ITS OWN element rather than a neighbouring one. Only DOM
    // elements are considered: a component invocation (`<Disclosure ...>`) is not
    // an element, and its props are not attributes — flagging those would make the
    // check wrong about the thing it is supposed to protect.
    for (const m of text.matchAll(/<[a-z][a-zA-Z0-9-]*[^>]*?>/gs)) {
      const tag = m[0]
      if (!/aria-expanded/.test(tag)) continue
      checked++
      if (/aria-controls/.test(tag)) continue
      const line = text.slice(0, m.index).split('\n').length
      failures.push(`${relative(root, file).split(sep).join('/')}:${line}: an element sets aria-expanded without aria-controls — it announces its state but not what it governs. Point it at the id of the region it expands.`)
    }
  }
  notes.push(`disclosure scan: ${checked} aria-expanded element(s) checked for a matching aria-controls`)
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
