#!/usr/bin/env node
/**
 * verify-standalone.mjs — static gate for a standalone dsh plugin folder.
 *
 * Usage: node scripts/verify-standalone.mjs <plugin-dir> <expected-name>
 *
 * Checks (all exit-code 1 on failure):
 *   1. package.json name === expected name; cordis.patch.yml row id/name === expected name
 *   2. forbidden tokens are absent from every scanned text file (the token
 *      list below is a regression blacklist of legacy identifiers — the tool
 *      excludes only its own source file, whose list is its data)
 *   3. no emoji characters anywhere in text files
 *   4. runtime dependencies limited to the allowed set
 *   5. tsconfig files extend nothing outside the plugin dir and declare no paths
 *   6. built artifacts lib/index.js + lib/client.js exist
 *   7. settings namespace + route path spelled with the expected name
 *   8. src imports only official SDK / react / node builtins / schemastery / relative
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const [dirArg, expectedName] = process.argv.slice(2)
if (!dirArg || !expectedName) {
  console.error('usage: node verify-standalone.mjs <plugin-dir> <expected-name>')
  process.exit(2)
}
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

const SKIP_DIRS = new Set(['node_modules', 'lib', '.git', '.vite', 'coverage', 'dist'])
const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.yml', '.yaml', '.md', '.css', '.gitignore', '.txt'])

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

// --- 1. identity ------------------------------------------------------------

const pkgPath = join(root, 'package.json')
if (!existsSync(pkgPath)) failures.push('package.json missing')
else {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (pkg.name !== expectedName) failures.push(`package.json name is "${pkg.name}", expected "${expectedName}"`)
  if (pkg.name !== root.split(sep).pop()) failures.push(`package.json name "${pkg.name}" does not match folder name "${root.split(sep).pop()}"`)
}

const patchPath = join(root, 'cordis.patch.yml')
if (!existsSync(patchPath)) failures.push('cordis.patch.yml missing')
else {
  const patch = readFileSync(patchPath, 'utf8')
  if (!patch.includes(`- id: ${expectedName}`)) failures.push(`cordis.patch.yml lacks row id "${expectedName}"`)
  if (!patch.includes(`name: '${expectedName}'`)) failures.push(`cordis.patch.yml lacks row name '${expectedName}'`)
}

// --- 2. forbidden tokens ----------------------------------------------------

const VERIFY_SELF = join(root, 'scripts', 'verify-standalone.mjs')

for (const file of textFiles) {
  if (file === VERIFY_SELF) continue // the tool's own forbidden-token list is its data
  const rel = relative(root, file)
  if (rel.startsWith('docs' + sep)) continue
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
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  const match = EMOJI_RE.exec(text)
  if (match) {
    const line = text.slice(0, match.index).split('\n').length
    failures.push(`${rel}:${line}: emoji character ${JSON.stringify(match[0])}`)
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

// --- 7. namespace + route spelling ------------------------------------------

const srcFiles = allFiles.filter((f) => f.includes(sep + 'src' + sep))
const srcText = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
if (!srcText.includes(`settingsNamespace('${expectedName}')`)) failures.push(`src never registers settingsNamespace('${expectedName}')`)
if (!srcText.includes(`/api/${expectedName}/settings`)) failures.push(`src never spells the /api/${expectedName}/settings route`)

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
  console.error(`verify-standalone FAILED for ${expectedName} (${failures.length})`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
for (const n of notes) console.log('note: ' + n)
console.log(`verify-standalone OK for ${expectedName}: ${allFiles.length} files scanned`)
