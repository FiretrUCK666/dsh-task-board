#!/usr/bin/env node
/**
 * verify-standalone.mjs — static gate for a standalone dsh plugin folder.
 *
 * Usage: node scripts/verify-standalone.mjs <plugin-dir> <plugin-id> [package-name]
 *
 * The plugin id and the package name are distinct identities: the id names the
 * loader row, the browser asset path, the settings namespace, the routes, the
 * storage unit and the settings-card slot; the package name is what pnpm
 * installed and may be scoped. A scoped package name must never move the id.
 *
 * Checks (all exit-code 1 on failure):
 *   1. plugin directory === plugin id; package.json name === package name;
 *      cordis.patch.yml carries `- id: <plugin-id>` and `name: '<package-name>'`
 *   2. forbidden tokens are absent from every scanned source file (the token
 *      list below is a regression blacklist of legacy identifiers — the tool
 *      excludes only its own source file, whose list is its data)
 *   3. no emoji characters anywhere in source files
 *   3b. no leaked home path and no credential-shaped string anywhere, INCLUDING
 *      the published artifacts under lib/ (the builder's directory and secrets
 *      must never reach the repository or the npm tarball)
 *   4. runtime dependencies limited to the allowed set
 *   5. tsconfig files extend nothing outside the plugin dir and declare no paths
 *   6. built artifacts lib/index.js + lib/client.js exist
 *   7. the Config schema is exported as `Config` and marks a field volatile
 *      (without one the plugin manager's settings page disappears), and the
 *      plugin never calls the removed namespace-registration API
 *   8. src imports only official SDK / react / node builtins / relative
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

// The encoding audit's self-test, dispatched BEFORE any other check runs so it
// cannot be confused with a real result: a deliberately damaged copy must be
// reported, by file and line. A gate that cannot be shown to bite is not
// evidence of anything.
if (process.argv.includes('--probe-encoding')) {
  const damaged = [
    { path: 'probe/replaced.md', bytes: Buffer.from('# ok\nbroken \uFFFD here\n', 'utf8') },
    { path: 'probe/bom.md', bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# ok\n', 'utf8')]) },
    { path: 'probe/crlf.md', bytes: Buffer.from('# ok\r\nstill ok\n', 'utf8') },
    { path: 'probe/watcher.cmd', bytes: Buffer.from('@echo off\r\nrem Windows batch keeps CRLF\n', 'utf8') },
    { path: 'probe/clean.md', bytes: Buffer.from('# clean\n', 'utf8') },
  ]
  const found = damaged.flatMap(f => encodingFindings(f.path, f.bytes))
  const expected = ['probe/replaced.md:2', 'probe/bom.md:1', 'probe/crlf.md:1']
  const missing = expected.filter(want => !found.some(f => f.startsWith(want)))
  if (missing.length > 0) {
    console.error(`verify-standalone PROBE FAILED: the encoding audit did not report ${missing.join(', ')} — it does not bite, so it is not a check`)
    process.exit(1)
  }
  if (found.some(f => f.includes('watcher.cmd'))) {
    console.error('verify-standalone PROBE FAILED: CRLF in a .cmd was reported — .gitattributes exempts the Windows batch scripts')
    process.exit(1)
  }
  if (found.some(f => f.includes('clean.md'))) {
    console.error('verify-standalone PROBE FAILED: a clean file was reported')
    process.exit(1)
  }
  console.log(`verify-standalone probe OK: the encoding audit bites on all three damages, names the file and the line, and stays quiet on the exempt .cmd and on a clean file (${found.length} finding(s) from the probe)`)
  process.exit(0)
}

if (process.argv.includes('--probe-deps')) {
  // Self-test for the "present AND empty" rule, run against the same function
  // the real gate uses. All four states are checked, because a gate that only
  // knows how to complain is half a check: the exempt case and the correct case
  // have to be pinned too, or the check drifts into noise nobody reads.
  const cases = [
    { label: 'field absent', pkg: { name: 'x' }, expect: 'has no `dependencies` field at all' },
    { label: 'field not an object', pkg: { dependencies: ['a'] }, expect: 'is not an object' },
    { label: 'field not empty', pkg: { dependencies: { 'left-pad': '1.0.0' } }, expect: 'is not in the allowed set' },
    { label: 'present and empty', pkg: { dependencies: {} }, expect: null },
  ]
  for (const c of cases) {
    const found = dependencyFieldFindings(c.pkg).join('\n')
    if (c.expect === null) {
      if (found !== '') {
        console.error(`verify-standalone PROBE FAILED: "present and empty" was reported — ${found}`)
        process.exit(1)
      }
    } else if (!found.includes(c.expect)) {
      console.error(`verify-standalone PROBE FAILED: "${c.label}" did not report ${JSON.stringify(c.expect)} — it does not bite, so it is not a check`)
      process.exit(1)
    }
  }
  console.log(`verify-standalone deps probe OK: the dependency field is required present and empty, and all ${cases.length} states behave (3 rejected, 1 accepted)`)
  process.exit(0)
}

const [dirArg, pluginIdArg, packageNameArg] = process.argv.slice(2)
if (!dirArg) {
  console.error('usage: node verify-standalone.mjs <plugin-dir> [plugin-id] [package-name]')
  process.exit(2)
}
const root = resolve(dirArg)

/**
 * The identity values the checks below compare against. Both default to what
 * the plugin itself declares, so a rename (a fork taking its own npm scope,
 * say) needs no edit here — `package.json` is the single source of truth:
 *
 * - the plugin id is the folder name (the same rule the loader applies), and it
 *   is what the routes, the settings namespace and the patch row id must spell;
 * - the package name is `package.json`'s `name`, and it is what the patch row
 *   `name:` and the browser bundle's registration id must equal.
 *
 * Passing them explicitly is allowed for asserting an intended identity; every
 * check is a CROSS-FILE comparison either way, which is where the value is —
 * "package.json equals what the caller typed" would prove nothing.
 */
const manifestPath = join(root, 'package.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
const folderName = root.split(sep).pop()
const pluginId = pluginIdArg ?? folderName
const packageName = packageNameArg ?? (typeof manifest.name === 'string' ? manifest.name : pluginId)
const failures = []
const notes = []

/**
 * The ceiling on `AGENTS.md`, and why it is a MECHANICAL check.
 *
 * The file is injected into every session of this project, so it is not a
 * document that can rot quietly in a folder — it is the instruction set an agent
 * reads before touching anything. A ceiling on it is therefore a real promise
 * about the working context, and a promise nothing measures is not a promise; it
 * is a number in a sentence. Every other hard limit in this project has a gate
 * that bites on its own (class drift, locale pairs, the encoding audit), and this
 * one was the exception, which is the same shape of failure the encoding audit
 * exists for: a condition that changes nothing, so no test ever goes red.
 *
 * The check is deliberately the ONLY thing here that measures a size. A contract
 * that is a ceiling has to have a number, and a number has to be enforced in one
 * place or it is a number somebody remembers.
 */
const AGENTS_CEILING_BYTES = 55_000

/**
 * Regression blacklist: legacy identifiers that must never reappear in this
 * project (package scopes, old plugin names, old route prefixes, old bundle
 * names). Part of the protection tooling, not project content.
 */
const FORBIDDEN = [
  '@linxin666',
  '@dsh-local',
  'ui-dsh-aionui-panel',
  'ui-task-board',
  'dsh-client-ui-aionui-panel',
  'dsh-client-ui-task-board',
  'dsh-aionui-panel',
  '/aionui-panel',
  'web-ui-all',
  'web-ui-settings',
  'web-ui-compat',
]

/** Runtime dependencies this plugin may declare. Empty BY RULE: the host half
 *  imports only types, the browser half imports only React (provided by the
 *  shell) and its own files, and there is no config schema left to validate. An
 *  empty allow-list states that directly — anything that appears here has to be
 *  argued for. */
const ALLOWED_DEPS = new Set()

// --- walk helpers -----------------------------------------------------------

/**
 * Directories that hold no project content. `lib/` is deliberately NOT skipped:
 * it ships in the repository and the npm tarball, so the leak audits below must
 * read it. The source-hygiene rules (emoji, legacy tokens) still skip it — its
 * bytes come from src plus inlined third-party code, and its own gate is the
 * rebuild-consistency check in CI.
 */
const SKIP_DIRS = new Set(['node_modules', '.git', '.vite', 'coverage', 'dist'])
const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.yml', '.yaml', '.md', '.css', '.gitignore', '.txt', '.map'])

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const allFiles = walk(root)
const textFiles = allFiles.filter((f) => {
  const name = f.split(sep).pop() ?? ''
  const dot = name.lastIndexOf('.')
  const ext = dot < 0 ? name : name.slice(dot)
  return TEXT_EXTS.has(ext)
})

/** Whether one file is a published build artifact (generated, not authored). */
function isArtifact(file) {
  return relative(root, file).split(sep)[0] === 'lib'
}

// --- 1. identity (cross-file) -----------------------------------------------

const pkgPath = join(root, 'package.json')
if (!existsSync(pkgPath)) failures.push('package.json missing')
else {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  // The loader keys the browser bundle by the package name, so a declared name
  // that is not what the caller expects is worth reporting: it usually means
  // the rename was applied in one place and not the others.
  if (pkg.name !== packageName) failures.push(`package.json name is "${pkg.name}", but the bundle registration and patch row must use "${packageName}"`)
  if (folderName !== pluginId) failures.push(`plugin directory is "${folderName}", but the plugin id (routes, settings namespace, patch row id) is "${pluginId}"`)
}

const patchPath = join(root, 'cordis.patch.yml')
if (!existsSync(patchPath)) failures.push('cordis.patch.yml missing')
else {
  const patch = readFileSync(patchPath, 'utf8')
  if (!patch.includes(`- id: ${pluginId}`)) failures.push(`cordis.patch.yml lacks row id "${pluginId}" (the plugin id)`)
  if (!patch.includes(`name: '${packageName}'`)) failures.push(`cordis.patch.yml lacks row name '${packageName}' (the package name)`)
}

// --- 1b. the contract's own ceiling ----------------------------------------

const agentsPath = join(root, 'AGENTS.md')
if (existsSync(agentsPath)) {
  const size = statSync(agentsPath).size
  if (size > AGENTS_CEILING_BYTES) {
    failures.push(
      `AGENTS.md is ${size} bytes, over its ${AGENTS_CEILING_BYTES}-byte ceiling by ${size - AGENTS_CEILING_BYTES}. `
      + 'It is injected into every session of this project, so its length is part of the working context, not a formatting preference. '
      + 'Cut something before adding something: a section that restates a rule another file already owns is the usual surplus.',
    )
  }
  notes.push(`AGENTS.md ${size} bytes of a ${AGENTS_CEILING_BYTES}-byte ceiling`)
}

// --- 2. forbidden tokens ----------------------------------------------------

const VERIFY_SELF = join(root, 'scripts', 'verify-standalone.mjs')

for (const file of textFiles) {
  if (file === VERIFY_SELF) continue // the tool's own forbidden-token list is its data
  if (isArtifact(file)) continue // generated bytes; its own gate is the rebuild-consistency check
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  for (const token of FORBIDDEN) {
    if (text.includes(token)) failures.push(`${rel}: forbidden token "${token}"`)
  }
  // old repo path spellings
  for (const spelling of ['Plugins\\dsh-web-ui', 'Plugins/dsh-web-ui', 'packages/dsh-web-ui', 'dsh-web-ui/packages']) {
    if (text.includes(spelling)) failures.push(`${rel}: old repo path "${spelling}"`)
  }
}

/**
 * The gitignored set, asked of Git once and shared by the source-audit rules
 * that ask what this repository SHIPS (the emoji rule and the leak audit; a
 * later rule of the same family reads it too instead of parsing ignores again):
 * a gitignored file is never committed, never packed and never pushed, so
 * nothing in it can escape this machine — machine-local scratch of any name is
 * covered, and a file that stops being ignored is audited again with no edit
 * here. (Skip-list names are how `.impeccable/critique/` snapshots came to be
 * scanned at all: they are ignored locally, hold absolute paths by nature, and
 * cannot ship.)
 *
 * When Git cannot answer, the set is null and every file is audited exactly as
 * before — an environment that cannot resolve ignores must not lose coverage.
 */
function ignoredFiles(files) {
  if (files.length === 0) return null
  try {
    const input = files.map((f) => relative(root, f).split(sep).join('/')).join('\n')
    const out = spawnSync('git', ['check-ignore', '--stdin'], { cwd: root, input, encoding: 'utf8' })
    if (out.status !== 0 && out.status !== 1) return null
    return new Set(
      String(out.stdout ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map((line) => join(root, line)),
    )
  } catch {
    return null
  }
}
const IGNORED = ignoredFiles(textFiles)

// --- 3. emoji ---------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2764}\u{1F1E6}-\u{1F1FF}]/u
for (const file of textFiles) {
  if (file === VERIFY_SELF) continue
  // Same reasoning as the leak audit: the emoji rule is about what this
  // repository SHIPS, and a gitignored file ships nowhere. An unresolvable
  // ignore set (IGNORED === null) falls back to scanning everything, so
  // coverage is never lost by this skip.
  if (IGNORED !== null && IGNORED.has(file)) continue
  if (isArtifact(file)) continue // inlined third-party code is not authored here
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  const match = EMOJI_RE.exec(text)
  if (match) {
    const line = text.slice(0, match.index).split('\n').length
    failures.push(`${rel}:${line}: emoji character ${JSON.stringify(match[0])}`)
  }
}

// --- 3b. leak audit (every file, artifacts included) ------------------------

/**
 * Home-directory shapes, applied to PUBLISHED ARTIFACTS only. Generated bytes
 * have no business carrying any machine's home directory, so the broad shapes
 * are safe there. Authoring sources are checked against this machine's real
 * home instead (below): fixtures legitimately contain POSIX- or Windows-shaped
 * sample paths, and a broad rule would flag them as leaks.
 */
const ARTIFACT_HOME_PATH_RES = [
  /[A-Za-z]:\\+Users\\/i,
  /[A-Za-z]:\/+Users\//i,
  /\/Users\/[^/\s"']+\//,
  /\/home\/[^/\s"']+\//,
]

/** Credential shapes that must never reach the repository or the npm tarball. */
const CREDENTIAL_RES = [
  /github_pat_[A-Za-z0-9_]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /as_sk_[A-Za-z0-9]{16,}/,
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /npm_[A-Za-z0-9]{36}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

/**
 * This machine's home directory in the spellings a build could bake in. Built
 * from the live environment, not hardcoded: the gate must keep working on any
 * contributor's machine.
 */
const REAL_HOME = homedir()
const REAL_HOME_SPELLINGS = [...new Set([
  REAL_HOME,
  REAL_HOME.split(sep).join('/'),
  REAL_HOME.split(sep).join('\\'),
  REAL_HOME.split(sep).join('\\\\'),
])].filter((spelling) => spelling.length > 3)

// --- 3d. GBK-misread artifacts, undeclared CSS tokens, and the switch list --

/**
 * Characters that are LEGAL Unicode but only ever appear when a UTF-8 byte
 * sequence is decoded as GBK. They are listed one by one on purpose: a RANGE
 * would be wrong, because U+9000-U+9FFF is full of ordinary Chinese
 * (面 键 队 错 首 集 退 量 — all of them live there), and a range would either
 * miss the artifacts or bury the reader in false alarms. U+FFFD is checked
 * above; this is for damage that happened EARLIER — a file written by a
 * mis-decoding editor, where every character is valid and only the sentence is
 * nonsense. Nothing else in this gate can see it, which is why it needs one.
 */
const GBK_MISREADS = new Map([
  ['鈥', 'E2 80 9x — an em/en dash read as GBK'],
  ['銆', 'E3 80 82 — the ideographic full stop read as GBK'],
  ['锟', 'EF BF BD — a replacement character read as GBK'],
  ['馃', 'F0 9F xx — an emoji lead byte read as GBK'],
  ['鎰', 'E3 80 81 — the ideographic comma read as GBK'],
  ['麟', 'EF BF BD variant, the same corruption one decode later'],
])

/** Comments are where a token may be NAMED without being used; the scans below
 *  all read code, never prose about the code. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/**
 * A `var(--dsh-tb-x)` that nothing declares is a silent, invisible failure.
 * CSS does not complain: the declaration using it is invalid at computed-value
 * time, so the property simply computes to nothing — a panel loses its width,
 * every test stays green, and the bug is only visible as a thin strip. Same
 * family as the encoding checks: the code is valid and the behaviour is wrong.
 *
 * `declaredElsewhere` is the SET OF ALIASES DECLARED BY THE OTHER STYLESHEETS,
 * and it has to be passed in. The aliases live on one layer, above every panel
 * surface, and custom properties inherit DOWN THE DOM — a stylesheet defines
 * rules, and those rules apply to elements carrying its classes, which sit
 * under that layer. So "declared in the same file" was a question with the
 * wrong subject: it made a second stylesheet look like it referenced 28
 * undeclared tokens when every one of them is declared once, above both, and
 * perfectly reachable. The honest question is "declared anywhere in the client
 * half", and the answer spans files, so the answer is computed across files.
 */
function undeclaredTokenFindings(path, text, declaredElsewhere = new Set()) {
  const code = stripComments(text)
  const used = new Map()
  // ONLY A BARE var() IS A DEFECT. `var(--x, fallback)` is the correct way to
  // reference a token that may legitimately be absent, and flagging those would
  // be two false alarms on the first run — a gate that cries wolf gets switched
  // off, which is worse than not having it. So the name is a finding only when
  // the call closes right after it.
  for (const m of code.matchAll(/var\(\s*(--dsh-tb-[A-Za-z0-9_-]+)\s*([,)])/g)) {
    if (m[2] !== ')') continue
    if (!used.has(m[1])) used.set(m[1], code.slice(0, m.index).split('\n').length)
  }
  const declared = new Set([...code.matchAll(/(--dsh-tb-[A-Za-z0-9_-]+)\s*:/g)].map(m => m[1]))
  return [...used].filter(([name]) => !declared.has(name) && !declaredElsewhere.has(name))
    .map(([name, line]) => `${path}:${line}: \`var(${name})\` is used with no fallback and no stylesheet declares it — CSS drops the whole declaration at computed-value time, so the element silently loses that property`)
}

/**
 * `cordis.patch.yml` rows are the switches on the plugin's page; each names a
 * package entry that must exist in `exports`, or the loader cannot find the
 * module — and that mistake only surfaces as a failure to start. The build
 * entry list says the same thing again, so the two are compared here instead
 * of trusted.
 */
function patchRowFindings(root, pkg) {
  const out = []
  const patchPath = join(root, 'cordis.patch.yml')
  if (!existsSync(patchPath)) return ['cordis.patch.yml is missing — the loader reads it to register the plugin, and without it nothing installs']
  const rows = [...readFileSync(patchPath, 'utf8').matchAll(/^\s*-\s*id:\s*(\S+)\s*\n\s*name:\s*'([^']+)'/gm)]
  if (rows.length === 0) out.push('cordis.patch.yml declares no rows — every plugin-page switch needs one')
  const pkgName = pkg.name ?? ''
  const exportKeys = new Set(Object.keys(pkg.exports ?? {}).map(k => (k === '.' ? pkgName : `${pkgName}${k.slice(1)}`)))
  const tsdownPath = join(root, 'tsdown.config.ts')
  const entryBlock = existsSync(tsdownPath) ? /clientBundle\([^,]+,\s*\[([\s\S]*?)\]/.exec(readFileSync(tsdownPath, 'utf8')) : null
  const entries = entryBlock === null ? [] : [...entryBlock[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  if (entryBlock === null) out.push('tsdown.config.ts: could not read the clientBundle entry list — the switch list and the build list are compared, so both have to be readable')
  for (const [, id, name] of rows) {
    if (!exportKeys.has(name)) {
      out.push(`cordis.patch.yml: row "${id}" names \`${name}\`, which package.json \`exports\` does not provide — the loader would not find the module, and that only shows up as a failure to start`)
    }
    const sub = name === pkgName ? 'src/index.ts' : `src/${name.slice(pkgName.length + 1)}.ts`
    if (entryBlock !== null && !entries.includes(sub)) {
      out.push(`cordis.patch.yml: row "${id}" is a switch, but tsdown.config.ts has no entry \`${sub}\` — a switch that is not a module of its own cannot be turned off at all, and the two lists are written by hand`)
    }
  }
  for (const entry of entries) {
    if (entry === 'src/index.ts' || entry === 'src/invariant.ts') continue
    const sub = entry.replace(/^src\//, '').replace(/\.ts$/, '')
    if (!rows.some(([, , name]) => name === `${pkgName}/${sub}`)) {
      out.push(`tsdown.config.ts: entry \`${entry}\` is a module of its own but no cordis.patch.yml row names it — it will have no switch on the plugin page`)
    }
  }
  return out
}

if (existsSync(pkgPath)) {
  failures.push(...patchRowFindings(root, JSON.parse(readFileSync(pkgPath, 'utf8'))))
}

/**
 * The alias layer is declared once, above every surface, so "is this token
 * declared" is a question about the whole client half and not about one file.
 * Computed over every stylesheet before any of them is judged, which is what
 * makes the answer the same no matter which sheet a name is read in.
 */
const STYLESHEETS = textFiles.filter(file =>
  /\.(css|scss|less)$/.test(file)
  && file !== VERIFY_SELF
  && (IGNORED === null || !IGNORED.has(file))
  && !isArtifact(file))
const ALIASES_DECLARED_ANYWHERE = new Set(STYLESHEETS.flatMap(file =>
  [...stripComments(readFileSync(file, 'utf8')).matchAll(/(--dsh-tb-[A-Za-z0-9_-]+)\s*:/g)].map(m => m[1])))

for (const file of textFiles) {
  if (file === VERIFY_SELF) continue
  if (IGNORED !== null && IGNORED.has(file)) continue
  if (isArtifact(file)) continue
  const rel = relative(root, file).split(sep).join('/')
  const raw = readFileSync(file, 'utf8')
  raw.split('\n').forEach((line, i) => {
    for (const [ch, why] of GBK_MISREADS) {
      if (line.includes(ch)) failures.push(`${rel}:${i + 1}: contains ${JSON.stringify(ch)} (U+${ch.codePointAt(0).toString(16).toUpperCase()}) — ${why}; it is a valid character, so nothing else in this gate can see it`)
    }
  })
  if (/\.(css|scss|less)$/.test(file)) {
    for (const finding of undeclaredTokenFindings(rel, raw, ALIASES_DECLARED_ANYWHERE)) failures.push(finding)
  }
}
notes.push(`declaration audit: every bare --dsh-tb-* var() read in a stylesheet is declared somewhere in the client half (${ALIASES_DECLARED_ANYWHERE.size} aliases across ${STYLESHEETS.length} stylesheet(s)); every cordis.patch.yml row names a real export and a matching build entry`)

for (const file of textFiles) {
  if (file === VERIFY_SELF) continue // the patterns themselves live here
  if (IGNORED !== null && IGNORED.has(file)) continue // cannot escape this machine
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  if (isArtifact(file)) {
    for (const re of ARTIFACT_HOME_PATH_RES) {
      const match = re.exec(text)
      if (match) failures.push(`${rel}: artifact leaks a home path ${JSON.stringify(match[0])}`)
    }
  }
  for (const spelling of REAL_HOME_SPELLINGS) {
    if (text.includes(spelling)) failures.push(`${rel}: leaks this machine's home directory`)
  }
  for (const re of CREDENTIAL_RES) {
    const match = re.exec(text)
    if (match) failures.push(`${rel}: credential-shaped string ${JSON.stringify(`${match[0].slice(0, 20)}...`)}`)
  }
}

// --- 3c. encoding damage (the silent family) ---------------------------------

/**
 * Three checks that share one property, and that property is the reason they
 * need a gate: **none of them changes what the code does.** A replacement
 * character where a CJK glyph was meant, a UTF-8 BOM in front of the first
 * line, a CRLF in a file the repo declares as LF — every one of those leaves
 * the logic identical, so no functional test goes red and no editor shows
 * anything unusual. They are found only by opening the file, on a platform
 * where these three are everyday accidents (Windows, an editor that guesses
 * the encoding, a shell redirect). A check that depends on someone remembering
 * is a check that eventually does not run, so it lives here beside the emoji
 * and leak audits — the same family, the same "what this repository ships".
 *
 * Pure: it takes bytes and a path, and returns sentences. The self-test drives
 * it with a deliberately damaged copy, because a check that has only ever seen
 * clean input cannot be told apart from one that cannot fail.
 */
export function encodingFindings(path, bytes) {
  const out = []
  const name = path.split(/[\\/]/).pop() ?? path
  // `.gitattributes` declares the repo LF, with the Windows batch scripts as
  // the one CRLF exception — so those two are exempt here for the same reason
  // they are exempt there.
  const crlfExempt = name.endsWith('.bat') || name.endsWith('.cmd')
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    out.push(`${path}:1: starts with a UTF-8 BOM — it is invisible in an editor and makes the first line unreadable to frontmatter and JSON parsers`)
  }
  const text = bytes.toString('utf8')
  const at = text.indexOf('\uFFFD')
  if (at !== -1) {
    out.push(`${path}:${text.slice(0, at).split('\n').length}: contains U+FFFD (the replacement character) — some character in this file was already destroyed before it was written, and the damage is now permanent in the source`)
  }
  if (!crlfExempt) {
    const crlf = text.indexOf('\r\n')
    if (crlf !== -1) {
      out.push(`${path}:${text.slice(0, crlf).split('\n').length}: has a CRLF line ending — .gitattributes declares this repository LF, and a stray CRLF ends up verbatim inside lib/client.js.map's embedded sources`)
    }
  }
  return out
}

// Same skip reasoning as the audits above: this is about what the repository
// ships. Committed artifacts under lib/ are generated — a CRLF there is caught
// by the rebuild comparison, and its source is one of the files below.
for (const file of textFiles) {
  if (file === VERIFY_SELF) continue
  if (IGNORED !== null && IGNORED.has(file)) continue
  if (isArtifact(file)) continue
  failures.push(...encodingFindings(relative(root, file).split(sep).join('/'), readFileSync(file)))
}
notes.push(`encoding audit: ${textFiles.length} text file(s) checked for U+FFFD, a UTF-8 BOM and CRLF`)

// --- 4. runtime dependencies ------------------------------------------------

// The plugin ships with NO runtime dependency: the host half imports only types,
// the browser half imports only React (provided by the shell) and its own files,
// and there is no config schema left to validate. An empty allow-list is the
// rule stated directly — anything that appears here has to be argued for.
/**
 * The whole "present AND empty" rule, as a pure function of the parsed
 * manifest. The self-test drives this one rather than a copy of it: a probe that
 * tests its own re-implementation proves nothing about the code that runs.
 *
 * The allow-list is a PARAMETER, not a module constant, so the probe can call
 * this before anything else in the file has been initialised — a self-test that
 * only works when run second is a self-test people stop running.
 */
export function dependencyFieldFindings(pkg, allowed = new Set()) {
  const out = []
  if (pkg.dependencies === undefined) {
    out.push('package.json has no `dependencies` field at all — hard rule 7 states that the runtime dependency surface is EMPTY, and the empty object is what carries that statement; a rewrite that drops the key leaves the rule standing and the carrier gone, and nothing else here would notice. Restore `"dependencies": {}`')
  } else if (typeof pkg.dependencies !== 'object' || pkg.dependencies === null || Array.isArray(pkg.dependencies)) {
    out.push(`package.json \`dependencies\` is not an object (found ${JSON.stringify(pkg.dependencies)}) — it must be present and empty; see the note above on why "absent" is not good enough`)
  }
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (!allowed.has(name)) out.push(`runtime dependency "${name}" is not in the allowed set`)
  }
  return out
}

if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  // A RULE THAT SAYS "EMPTY" HAS TO BE WRITTEN AS "PRESENT AND EMPTY".
  //
  // In JSON, "there is no such key" and "that key is an empty object" are two
  // different things — and the missing one reads like "there was never any
  // dependency to declare", which is exactly why deleting it is the dangerous
  // direction: hard rule 7 says the runtime dependency surface is EMPTY, the
  // empty object is what CARRIES that sentence, and a package-manager rewrite
  // that drops the key leaves the rule standing with the carrier gone. Nothing
  // else in this gate would notice, and the plugin would still install and run.
  failures.push(...dependencyFieldFindings(pkg, ALLOWED_DEPS))
  const devDeps = pkg.devDependencies ?? {}
  for (const name of Object.keys(devDeps)) {
    if (name.startsWith('@linxin666')) failures.push(`devDependency "${name}" forbidden`)
  }
  notes.push(`runtime dependencies: the field is present with ${Object.keys(pkg.dependencies ?? {}).length} entr(ies); allowed set is empty by rule`)
}

// --- 5. tsconfig hygiene ----------------------------------------------------

for (const file of allFiles) {
  const name = file.split(sep).pop()
  if (!/^tsconfig.*\.json$/.test(name)) continue
  const rel = relative(root, file)
  let cfg
  try { cfg = JSON.parse(readFileSync(file, 'utf8')) } catch { failures.push(`${rel}: unparseable`); continue }
  for (const ext of typeof cfg.extends === 'string' ? [cfg.extends] : []) {
    if (ext.startsWith('.') || ext.startsWith('/')) {
      const resolved = resolve(file, '..', ext)
      if (!resolved.startsWith(root + sep)) failures.push(`${rel}: extends outside plugin dir ("${ext}")`)
    } else failures.push(`${rel}: extends a package path ("${ext}")`)
  }
  if (cfg.compilerOptions?.paths) failures.push(`${rel}: compilerOptions.paths is forbidden`)
}

// --- 6. built artifacts -----------------------------------------------------

for (const artifact of ['lib/index.js', 'lib/client.js']) {
  if (!existsSync(join(root, artifact))) failures.push(`${artifact} missing — run build first`)
}

// The browser bundle must register under the PACKAGE NAME. The host's client
// module system locates a row's manifest, keys the served bundle and the
// __ModuleLoader__ registration by the package name it found, and rejects a
// bundle that registers anything else with "loaded without registering <name>".
// An unscoped package name equals its plugin id, so this only breaks once a
// scope separates them — the check exists because that is exactly what happened.
const clientBundlePath = join(root, 'lib', 'client.js')
if (existsSync(clientBundlePath)) {
  const bundle = readFileSync(clientBundlePath, 'utf8')
  const registered = /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/.exec(bundle)
  if (registered === null) failures.push('lib/client.js never registers through __ModuleLoader__.load')
  else if (registered[1] !== packageName) {
    failures.push(`lib/client.js registers id "${registered[1]}", but the loader keys the bundle by the package name "${packageName}" — rebuild after aligning the client bundle id in tsdown.config.ts`)
  }
}

// `lib/` is committed and only ever regenerated by a build, so a declaration
// file whose source module is gone keeps shipping forever — tsc never deletes
// output it no longer produces. Eighteen such files had accumulated from
// deleted modules before this check existed. The mapping is one-to-one, so any
// mismatch is garbage.
{
  const typesRoot = join(root, 'lib', 'types')
  const srcRoot = join(root, 'src')
  if (existsSync(typesRoot) && existsSync(srcRoot)) {
    const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = join(dir, entry.name)
      return entry.isDirectory() ? walk(full) : [full]
    })
    const expected = new Set(
      walk(srcRoot)
        .filter(file => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
        .map(file => relative(srcRoot, file).replace(/\.tsx?$/, '.d.ts').split(sep).join('/')),
    )
    for (const file of walk(typesRoot)) {
      if (!file.endsWith('.d.ts')) continue
      const rel = relative(typesRoot, file).split(sep).join('/')
      if (!expected.has(rel)) {
        failures.push(`lib/types/${rel} declares a module src/ no longer has — delete it (tsc never removes stale output)`)
      }
    }
  }
}

// --- 7. settings seam + route spelling ---------------------------------------

const srcFiles = allFiles.filter((f) => f.includes(sep + 'src' + sep))
const srcText = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
// The plugin carries no settings schema of its own, and that is load-bearing in
// the other direction: its enable switch IS the profile row's `disabled`, which
// the plugin manager writes and the loader acts on. A `Config` schema would put
// a settings form back next to that switch for something that has no
// per-plugin option. So the absence is read here, together with the removal of
// the namespace-registration API that predates all of this.
if (/^export const Config\s*[:=]/m.test(srcText)) {
  failures.push('src exports a Config schema again — the plugin has no per-plugin setting; its switch is the profile row the plugin manager writes')
}
if (/\.installSection\s*\(/.test(srcText)) {
  failures.push('src still calls the removed ctx.settings.installSection — plugin config is the profile entry now')
}
// ── THE SYSTEM-PROMPT SECTION MUST BE A CONSTANT ───────────────────────────
//
// This used to ban the service outright: "src reaches for the system-prompt
// service again — this plugin does not announce itself to agents". That sentence
// described a world which has ended — talking to the agent IS the product now —
// and it became a false red on code that is correct on purpose.
//
// DELETING it would have been easy and wrong: the position it guards would sit
// empty, and the next person could hand-roll a capability list back into the
// prompt. So the intent is restated in the shape it has today, and the new rule
// is MECHANICAL where the old one was not about the text at all:
//
//   the section is FIXED TEXT. A single byte that changes per turn invalidates
//   the prompt cache for every conversation carrying it. And a capability list
//   in the prompt is a second copy of the catalog, which the catalog exists to
//   prevent — a stale list is worse than no list, because the model trusts it.
//   Everything live is reachable through `taskboard_capabilities` instead.
//
// So: no interpolation in the section's text. `${` or `{{` there means the
// section is being assembled per turn, which is the thing this rule is for.
const SECTION_TEXT_NAME = 'PROMPT_SECTION_TEXT'
/** The declared value of the section text, bracket-matched out of its file. */
function sectionTextRegion(text) {
  const at = text.indexOf(SECTION_TEXT_NAME)
  if (at === -1) return null
  const valueStart = text.slice(at + SECTION_TEXT_NAME.length).search(/[['"`]/)
  if (valueStart === -1) return null
  const from = at + SECTION_TEXT_NAME.length + valueStart
  const open = text[from]
  const close = open === '[' ? ']' : open === '{' ? '}' : null
  if (close === null) return text.slice(from, text.indexOf('\n', from) === -1 ? text.length : text.indexOf('\n', from))
  let depth = 0
  for (let i = from; i < text.length; i++) {
    if (text[i] === open) depth++
    else if (text[i] === close) {
      depth--
      if (depth === 0) return text.slice(from, i + 1)
    }
  }
  return null
}

const sectionHolders = srcFiles.filter(file => {
  try { return readFileSync(file, 'utf8').includes(SECTION_TEXT_NAME) } catch { return false }
})
if (sectionHolders.length === 0) {
  failures.push(`cannot find where the system-prompt section text is declared — nothing under src/ mentions \`${SECTION_TEXT_NAME}\`, so "is that section still a constant?" cannot be answered. A finding, not a skip`)
}
for (const file of sectionHolders) {
  const text = readFileSync(file, 'utf8')
  const region = sectionTextRegion(text)
  if (region === null) {
    failures.push(`${relative(root, file).split(sep).join('/')}: found \`${SECTION_TEXT_NAME}\` but could not delimit its value — the section text must be a literal, so report this rather than skipping the check`)
    continue
  }
  const interpolated = /\$\{|\{\{/.exec(region)
  if (interpolated !== null) {
    failures.push(`${relative(root, file).split(sep).join('/')}: the system-prompt section is INTERPOLATED (${JSON.stringify(interpolated[0])}) — that section must be fixed text. It is assembled on every turn, so a single changing byte invalidates the prompt cache for every conversation that carries it; and a capability list belongs in \`taskboard_capabilities\` (looked up on demand), never in the prompt, because a second copy of the catalog goes stale and the model trusts it`)
  }
}

// --- 8. import hygiene ------------------------------------------------------

const IMPORT_RE = /^import(?:\s+type)?\s+.*?\s+from\s+['"]([^'"]+)['"]/gm
const ALLOWED_PREFIXES = ['@deepseek-ai/', 'react', 'react-dom', 'node:', '.', '..']
for (const file of srcFiles) {
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(IMPORT_RE)) {
    const spec = match[1]
    if (spec.includes('@linxin666')) failures.push(`${rel}: forbidden import "${spec}"`)
    if (ALLOWED_PREFIXES.some((p) => spec.startsWith(p))) continue
    failures.push(`${rel}: unexpected import "${spec}"`)
  }
}

// --- report -----------------------------------------------------------------

if (failures.length > 0) {
  console.error(`verify-standalone FAILED for ${packageName} (${failures.length})`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
for (const n of notes) console.log('note: ' + n)
console.log(`verify-standalone OK for ${packageName} (plugin id ${pluginId}): ${allFiles.length} files scanned`)
