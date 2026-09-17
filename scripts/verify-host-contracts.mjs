/**
 * Host-contract check: every slot and service member this plugin depends on must
 * still be declared by the INSTALLED DSH, and every member the host REMOVED must
 * not be referenced by the plugin's source.
 *
 * Why this exists (the failure it prevents): a host upgrade removed
 * `settings.plugin.item`, renamed `uiSession.pendingInteractions` to
 * `sessionStatus`, and dropped `ISessions.open`/`current`. None of those broke the
 * build — the plugin compiled against the previous SDK, `slots.inject` silently
 * no-ops for an undeclared slot, and a removed service member only throws at the
 * moment a user clicks. The result was a board that did not appear and a settings
 * form that did not exist, with nothing failing anywhere the team looks.
 *
 * What this proves, and what it deliberately does not:
 *
 * - It proves the plugin's declared dependencies still have a counterpart in the
 *   running host, and that the plugin does not reach for members the host dropped.
 * - It is a PRESENCE check, not a behavior audit. Green means "nothing the plugin
 *   names has gone missing", never "the interface still behaves the same".
 * - It never edits code. A failure names the exact contract and what to do.
 *
 * When the DSH install cannot be located the check reports SKIP and exits 0: the
 * plugin is not wrong, this machine simply cannot resolve the host. Run it where
 * DSH lives (a dev machine), which is where the contract is readable at all.
 *
 * usage: node scripts/verify-host-contracts.mjs [plugin-dir]
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(process.argv[2] ?? '.')
const failures = []
const notes = []

// --- locate the DSH install ---------------------------------------------------
// Same derivation as verify-design-docs.mjs, and for the same reason: capturing a
// child process over a pipe fails outright under a restricted sandbox
// (spawnSync EINVAL), so spawning a package manager is only a best-effort
// fallback. The primary path walks up from the running Node, which lives inside
// the install prefix.

/**
 * The DSH INSTALL directory itself — the one holding `package.json` and the
 * nested `node_modules/@deepseek-ai` tree this check reads.
 *
 * The marker is resolved two levels below the candidate on purpose: probing
 * `<candidate>/node_modules/@deepseek-ai/dsh` alone also matches the npm PREFIX
 * (the install sits one level below it), and returning the prefix would make
 * every package look absent.
 */
function installAt(candidate) {
  const install = join(candidate, 'node_modules', '@deepseek-ai', 'dsh')
  return existsSync(join(install, 'package.json')) ? install : null
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
  let dir = dirname(process.execPath)
  for (let i = 0; i < 4; i++) {
    candidates.push(dir)
    dir = dirname(dir)
  }
  if (home) {
    candidates.push(join(home, 'AppData', 'Roaming', 'npm'), join(home, '.npm-global'), join(home, '.local', 'share', 'pnpm'))
  }
  candidates.push('/usr/local', '/usr', '/opt/homebrew')
  for (const tool of ['pnpm', 'npm']) {
    const g = globalRoot(tool)
    if (g !== null) candidates.push(g)
  }
  for (const c of candidates) {
    if (c === undefined) continue
    const install = installAt(c)
    if (install !== null) return install
  }
  return null
}

const dsh = dshRoot()
if (dsh === null) {
  console.log('verify-host-contracts SKIP: DSH install not found (set DSH_ROOT to enable); contracts are unverified here, not wrong')
  process.exit(0)
}

const packagesDir = join(dsh, 'node_modules', '@deepseek-ai')

// --- read the contract declared by AGENTS.md ---------------------------------
// The table is the plugin's OWN statement of what it depends on. Keeping it in the
// contract document (rather than in a list buried in this script) is what makes a
// reviewer see it, and what makes the script unable to quietly agree with itself.

const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8')
const slots = []
const members = []
const absent = []
{
  const section = agents.indexOf('## 宿主契约表')
  if (section === -1) {
    console.error('verify-host-contracts FAIL: AGENTS.md has no "## 宿主契约表" section')
    process.exit(1)
  }
  for (const line of agents.slice(section).split('\n')) {
    // `| \`slot\` | usage |` — the first cell is the slot name. A slot name may be
    // dotless (`main`, `root`), so the pattern must not demand a dot.
    const slot = /^\|\s*`([a-z][a-z0-9]*(?:\.[a-zA-Z0-9]+)*)`\s*\|\s*[^|]+\|\s*$/.exec(line)
    if (slot !== null && !slot[1].startsWith('@')) { slots.push(slot[1]); continue }
    // `| \`@pkg\` | \`member\` |` and the absent rows share this shape.
    const member = /^\|\s*`(@[a-z0-9/-]+)`\s*\|\s*`([^`]+)`\s*\|/.exec(line)
    if (member === null) continue
    const row = { pkg: member[1], member: member[2] }
    if (line.includes('(removed)')) absent.push(row)
    else members.push(row)
  }
}

if (slots.length === 0 && members.length === 0 && absent.length === 0) {
  console.error('verify-host-contracts FAIL: the AGENTS.md contract table parsed to zero rows (its shape changed)')
  process.exit(1)
}

// --- read what the installed host actually declares --------------------------
// Slot names are declared in TWO forms, and both are real:
//   - the typed contract files (`slot-contract.d.ts` / `slots.d.ts`), keys inside
//     the SlotMap augmentation;
//   - runtime declaration tables in a plugin's `lib/client.js` (an owner registers
//     with a `children` table).
// A slot is usable only when a RUNTIME owner declares it, so both are collected
// and the runtime set is reported separately for diagnosis. Minified bundles may
// write a dot as "\u002e", hence the two-pattern scan.

const declared = new Set()
const declaredAtRuntime = new Set()
let scanned = 0
for (const entry of existsSync(packagesDir) ? readdirSync(packagesDir, { withFileTypes: true }) : []) {
  if (!entry.isDirectory()) continue
  const pkgDir = join(packagesDir, entry.name)
  const walk = (dir, out = []) => {
    let children
    try { children = readdirSync(dir, { withFileTypes: true }) } catch { return out }
    for (const child of children) {
      const full = join(dir, child.name)
      if (child.isDirectory()) walk(full, out)
      else if (child.name.endsWith('.d.ts')) out.push(full)
    }
    return out
  }
  const typeFiles = walk(join(pkgDir, 'lib', 'types'))
  for (const file of typeFiles) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/^\s*'([a-z][a-z0-9.]*\.[a-zA-Z0-9.]+)'\s*:\s*\{/gm)) declared.add(m[1])
  }
  const runtime = join(pkgDir, 'lib', 'client.js')
  if (existsSync(runtime)) scanned += 1
  if (existsSync(runtime)) {
    const text = readFileSync(runtime, 'utf8')
    // A declaration reads `"<key>": {` followed by `kind: "..."` — possibly after
    // newlines/indentation, since the emitted table is pretty-printed, so the gap
    // must allow arbitrary whitespace.
    for (const m of text.matchAll(/"([a-z][a-z0-9.]*(?:\.[a-zA-Z0-9]+)*)"\s*:\s*\{\s*kind\s*:/g)) {
      declaredAtRuntime.add(m[1])
    }
    // Minified bundles may escape the dot as `\u002e` inside the string literal.
    for (const m of text.matchAll(/"([a-z][a-z0-9.\\.]*?)\\u002e([a-zA-Z0-9\\\\.]+)"\s*:\s*\{\s*kind\s*:/g)) {
      declaredAtRuntime.add(`${m[1]}.${m[2]}`.replace(/\\u002e/g, '.'))
    }
  }
}
for (const name of declaredAtRuntime) declared.add(name)

// --- the checks --------------------------------------------------------------

for (const slot of slots) {
  if (declared.has(slot)) continue
  failures.push(`slot "${slot}" is not declared by the installed DSH (${scanned} client bundles scanned)`)
}

/** Every file under one package's `lib` whose text can carry a member name. */
function packageTextFiles(pkgDir) {
  const walk = (dir, out = []) => {
    let children
    try { children = readdirSync(dir, { withFileTypes: true }) } catch { return out }
    for (const child of children) {
      const full = join(dir, child.name)
      if (child.isDirectory()) walk(full, out)
      else if (child.name.endsWith('.d.ts') || child.name.endsWith('.js')) out.push(full)
    }
    return out
  }
  return walk(join(pkgDir, 'lib'))
}

for (const { pkg, member } of members) {
  // The table names packages by their IMPORT specifier (`@deepseek-ai/x`), while
  // `packagesDir` is already the scope directory — so the scope prefix is dropped
  // before joining, never passed through (that would look for
  // `@deepseek-ai/@deepseek-ai/x`).
  const pkgDir = join(packagesDir, pkg.replace(/^@[a-z0-9-]+\//, ''))
  if (!existsSync(pkgDir)) {
    failures.push(`package "${pkg}" is not installed under ${packagesDir}`)
    continue
  }
  const found = packageTextFiles(pkgDir).some(file => readFileSync(file, 'utf8').includes(member))
  if (!found) {
    failures.push(`member "${member}" of ${pkg} is not present in the installed DSH`)
  }
}

// The removal half: the plugin's source must not reference members the host
// dropped. This is what would have caught the upgrade before a user did.
const sourceFiles = []
{
  const walk = (dir, out = []) => {
    let children
    try { children = readdirSync(dir, { withFileTypes: true }) } catch { return out }
    for (const child of children) {
      const full = join(dir, child.name)
      if (child.isDirectory()) walk(full, out)
      else if (/\.(ts|tsx)$/.test(child.name)) out.push(full)
    }
    return out
  }
  walk(join(root, 'src'), sourceFiles)
}
for (const { pkg, member } of absent) {
  const pattern = new RegExp(`\\.${member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
  const hits = sourceFiles.filter(file => pattern.test(readFileSync(file, 'utf8')))
  if (hits.length === 0) continue
  failures.push(
    `source still reads "${member}" (removed from ${pkg}) in: ${hits.map(f => f.slice(root.length + 1)).join(', ')}`,
  )
}

// --- report ------------------------------------------------------------------

notes.push(`host: ${dsh}`)
notes.push(`slots declared by host: ${declared.size}; contracts declared by plugin: ${slots.length} slots, ${members.length} members, ${absent.length} removed-member rules`)

if (failures.length > 0) {
  console.error('verify-host-contracts FAIL')
  for (const note of notes) console.error(`  ${note}`)
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('Fix the plugin to the installed host contract (see AGENTS.md 宿主契约表), or update the table if the contract genuinely moved.')
  process.exit(1)
}

console.log(`verify-host-contracts OK: ${notes.join('; ')}`)
