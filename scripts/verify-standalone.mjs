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
 *   7. settings namespace + route path spelled with the plugin id
 *   8. src imports only official SDK / react / node builtins / schemastery / relative
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

const [dirArg, pluginId, packageNameArg] = process.argv.slice(2)
if (!dirArg || !pluginId) {
  console.error('usage: node verify-standalone.mjs <plugin-dir> <plugin-id> [package-name]')
  process.exit(2)
}
/** The installed package name; equals the plugin id for an unscoped package. */
const packageName = packageNameArg ?? pluginId
const root = resolve(dirArg)
const failures = []
const notes = []

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

// --- 1. identity ------------------------------------------------------------

const pkgPath = join(root, 'package.json')
if (!existsSync(pkgPath)) failures.push('package.json missing')
else {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (pkg.name !== packageName) failures.push(`package.json name is "${pkg.name}", expected "${packageName}"`)
  const folder = root.split(sep).pop()
  if (folder !== pluginId) failures.push(`plugin directory is "${folder}", expected the plugin id "${pluginId}"`)
}

const patchPath = join(root, 'cordis.patch.yml')
if (!existsSync(patchPath)) failures.push('cordis.patch.yml missing')
else {
  const patch = readFileSync(patchPath, 'utf8')
  if (!patch.includes(`- id: ${pluginId}`)) failures.push(`cordis.patch.yml lacks row id "${pluginId}"`)
  if (!patch.includes(`name: '${packageName}'`)) failures.push(`cordis.patch.yml lacks row name '${packageName}'`)
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

// --- 3. emoji ---------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2764}\u{1F1E6}-\u{1F1FF}]/u
for (const file of textFiles) {
  if (file === VERIFY_SELF) continue
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

for (const file of textFiles) {
  if (file === VERIFY_SELF) continue // the patterns themselves live here
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

// --- 4. runtime dependencies ------------------------------------------------

const ALLOWED_DEPS = new Set(['schemastery'])
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (!ALLOWED_DEPS.has(name)) failures.push(`runtime dependency "${name}" is not in the allowed set`)
  }
  const devDeps = pkg.devDependencies ?? {}
  for (const name of Object.keys(devDeps)) {
    if (name.startsWith('@linxin666')) failures.push(`devDependency "${name}" forbidden`)
  }
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

// --- 7. namespace + route spelling ------------------------------------------

const srcFiles = allFiles.filter((f) => f.includes(sep + 'src' + sep))
const srcText = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
// The settings seam is a service method on the injected settings service
// (`ctx.settings.installSection` / `ctx.settings.register`), so the gate reads
// two facts: the plugin spells its own namespace, and it goes through that
// seam rather than inventing a private settings channel.
if (!srcText.includes(`'${pluginId}'`)) failures.push(`src never spells the settings namespace '${pluginId}'`)
if (!/\.installSection\(|\.settings\.register\(/.test(srcText)) failures.push('src never registers through the official settings seam (ctx.settings.installSection / register)')
if (!srcText.includes(`/api/${pluginId}/settings`)) failures.push(`src never spells the /api/${pluginId}/settings route`)

// --- 8. import hygiene ------------------------------------------------------

const IMPORT_RE = /^import(?:\s+type)?\s+.*?\s+from\s+['"]([^'"]+)['"]/gm
const ALLOWED_PREFIXES = ['@deepseek-ai/', 'react', 'react-dom', 'node:', 'schemastery', '.', '..']
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
