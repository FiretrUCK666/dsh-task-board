/**
 * Host-contract check: every slot, injected service and service member this
 * plugin depends on must still be declared by the INSTALLED DSH, and every
 * member the host REMOVED must not be referenced by the plugin's source.
 *
 * Why this exists (the failure it prevents): a host upgrade can remove a slot, a
 * service member or a whole service without breaking anything this repository
 * runs. `slots.inject` silently no-ops for an undeclared slot, a removed member
 * throws only at the moment a user clicks it, and a missing service leaves the
 * plugin's fiber waiting forever — so a half can compile, typecheck and gate
 * green while contributing nothing at runtime. The board did exactly that: the
 * host half called a member the installed service no longer carried, `apply`
 * threw before registering a single route or prompt section, and this check
 * stayed green because its contract table named no host service at all.
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
 *        node scripts/verify-host-contracts.mjs [plugin-dir] --probe-removed
 *        node scripts/verify-host-contracts.mjs [plugin-dir] --probe-services
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(process.argv[2] ?? '.')
const args = new Set(process.argv.slice(2).filter(arg => arg.startsWith('--')))
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

/**
 * Cached file text: the member, slot and service checks read the same install
 * files, and a package body is large enough that reading it once per check would
 * be the only slow thing here. An unreadable file is an empty string — every
 * caller treats "no text" as "nothing found", and a path that exists is already
 * checked separately.
 */
const textCache = new Map()
function textOf(file) {
  let text = textCache.get(file)
  if (text === undefined) {
    try { text = readFileSync(file, 'utf8') } catch { text = '' }
    textCache.set(file, text)
  }
  return text
}

// --- read the contract declared by AGENTS.md ---------------------------------
// The table is the plugin's OWN statement of what it depends on. Keeping it in the
// contract document (rather than in a list buried in this script) is what makes a
// reviewer see it, and what makes the script unable to quietly agree with itself.
// Three row shapes are read, one per sub-section: a slot, a member read by name,
// and an injected service with the member it is read through.

const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8')
const slots = []
const members = []
const services = []
const absent = []
{
  const section = agents.indexOf('## 宿主契约表')
  if (section === -1) {
    console.error('verify-host-contracts FAIL: AGENTS.md has no "## 宿主契约表" section')
    process.exit(1)
  }
  for (const line of agents.slice(section).split('\n')) {
    // `| host | \`service\` | \`member\` | \`@pkg\` |` — the injected-service rows.
    const service = /^\|\s*(host|client)\s*\|\s*`([a-zA-Z][a-zA-Z0-9.]*)`\s*\|\s*`([^`]+)`\s*\|\s*`(@[a-z0-9/-]+)`\s*\|\s*$/.exec(line)
    if (service !== null) {
      services.push({ half: service[1], name: service[2], member: service[3], pkg: service[4] })
      continue
    }
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
// The service rows are the only coverage this check has of the HOST half's
// dependencies; parsing none of them means that coverage silently vanished, which
// is exactly the state that let a dead host half gate green.
if (services.length === 0) {
  console.error('verify-host-contracts FAIL: the AGENTS.md contract table declares no injected services (its shape changed)')
  process.exit(1)
}

// --- read what the installed host actually declares --------------------------
// A slot is declared in exactly two shapes, and only these two are read:
//   - a TYPED contract entry: `'name': { kind: ...; scope: ... }` inside the
//     SlotMap augmentation of a package's `.d.ts` files;
//   - a RUNTIME declaration: the same object shape as a key of a `children`
//     table in a plugin's `lib/client.js` (the table the owner registers).
// Both require `kind` AND `scope`. `kind` alone is not enough: other vocabularies
// (method descriptors, event names, protocol steps) use it too, and counting
// those inflates the declared set with names no slot owner ever declared.

/** The body of the object literal whose `{` sits at `open`; skips comments and strings. */
function objectBody(text, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (quote !== null) {
      if (c === '\\') { i += 1; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i)
      i = nl === -1 ? text.length : nl
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i)
      i = end === -1 ? text.length : end + 1
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return undefined
}

/** Whether an object body is a slot declaration (the two fields such an entry carries). */
const isSlotEntry = (body) => /\bkind\s*:/.test(body) && /\bscope\s*:/.test(body)

const typedSlots = new Set()
const runtimeSlots = new Set()
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
    const text = textOf(file)
    for (const m of text.matchAll(/^\s*'([a-z][a-z0-9]*(?:\.[a-zA-Z0-9]+)*)'\s*:\s*\{/gm)) {
      const body = objectBody(text, m.index + m[0].length - 1)
      if (body === undefined || !isSlotEntry(body)) continue
      typedSlots.add(m[1])
    }
  }
  const runtime = join(pkgDir, 'lib', 'client.js')
  if (!existsSync(runtime)) continue
  scanned += 1
  const text = textOf(runtime)
  for (const m of text.matchAll(/children\s*:\s*\{/g)) {
    const table = objectBody(text, m.index + m[0].length - 1)
    if (table === undefined) continue
    // A segment after the dot may carry case (`conversation.chat.turnTail`), and a
    // minified bundle may escape the dot as `\u002e` inside the key literal —
    // hence two key patterns, both bounded to this children table.
    const keys = [
      ...[...table.matchAll(/"([a-z][a-z0-9.]*(?:\.[a-zA-Z0-9]+)*)"\s*:\s*\{/g)].map(match => ({ name: match[1], at: match })),
      ...[...table.matchAll(/"([a-z][a-z0-9.\\.]*?)\\u002e([a-zA-Z0-9\\\\.]+)"\s*:\s*\{/g)]
        .map(match => ({ name: `${match[1]}.${match[2]}`.replace(/\\u002e/g, '.'), at: match })),
    ]
    for (const { name, at } of keys) {
      const body = objectBody(table, at.index + at[0].length - 1)
      if (body === undefined || !isSlotEntry(body)) continue
      runtimeSlots.add(name)
    }
  }
}
const declared = new Set([...typedSlots, ...runtimeSlots])

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
  const found = packageTextFiles(pkgDir).some(file => textOf(file).includes(member))
  if (!found) {
    failures.push(`member "${member}" of ${pkg} is not present in the installed DSH`)
  }
}

// --- the injected services, and the member each is read through ---------------
// Two independent facts per row, because either one alone leaves the same hole:
// the service NAME must have a provider declaration in the installed host (a
// name nobody provides is a fiber that waits forever), and the MEMBER must still
// be carried by the package the table names (a member that moved away throws at
// the call site, and only there).

/** Service name -> the packages declaring it as a cordis provider. */
function providerIndex() {
  const index = new Map()
  for (const entry of existsSync(packagesDir) ? readdirSync(packagesDir, { withFileTypes: true }) : []) {
    if (!entry.isDirectory()) continue
    const pkg = `@deepseek-ai/${entry.name}`
    for (const file of packageTextFiles(join(packagesDir, entry.name))) {
      const text = textOf(file)
      // `super(ctx, "name")` (a Service subclass) and `provide("name")` are the
      // two shapes cordis registers a service name with.
      for (const m of text.matchAll(/(?:super\([^)]{0,80},\s*|provide\(\s*)"([A-Za-z][A-Za-z0-9.]*)"/g)) {
        if (!index.has(m[1])) index.set(m[1], new Set())
        index.get(m[1]).add(pkg)
      }
    }
  }
  return index
}

/**
 * Every finding for one set of service rows (empty = the contract holds).
 * Split out so `--probe-services` can run the SAME code path on rows that cannot
 * exist and require it to be red.
 */
function serviceFailures(rows) {
  const providers = providerIndex()
  const found = []
  for (const { half, name, member, pkg } of rows) {
    const pkgDir = join(packagesDir, pkg.replace(/^@[a-z0-9-]+\//, ''))
    if (!existsSync(pkgDir)) {
      found.push(`${half} half: the package the table names for service "${name}" is not installed (${pkg})`)
      continue
    }
    const declaring = providers.get(name)
    if (declaring === undefined) {
      found.push(`${half} half: service "${name}" is injected, but no installed package provides it — the fiber waits forever and nothing this half contributes appears`)
    } else if (!declaring.has(pkg)) {
      found.push(`${half} half: service "${name}" is provided by ${[...declaring].sort().join(', ')}, not by ${pkg} as the contract table states`)
    }
    if (!packageTextFiles(pkgDir).some(file => textOf(file).includes(member))) {
      found.push(`${half} half: member "${member}" is not present on service "${name}" in the installed ${pkg}`)
    }
  }
  return found
}

failures.push(...serviceFailures(services))

// The removal half: the plugin's source must not read members the host dropped.
// With no removed-member rows left this loop is inert, so it can no longer be
// observed by looking at a normal run — `--probe-removed` (below) is how it is
// proven alive.
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

// --- each self-test, for the checks a normal run cannot observe ---------------
// A check that cannot fail proves nothing. `--probe-removed` feeds the same code
// path a member that is guaranteed to be read by the source, and REQUIRES the
// result to be red: a green run here would mean the scan is blind, not that the
// source is clean.
if (args.has('--probe-removed')) {
  const probe = [{ pkg: '(self-test)', member: 'slots' }]
  const hits = []
  for (const { member } of probe) {
    const pattern = new RegExp(`\\.${member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    for (const file of sourceFiles) if (pattern.test(readFileSync(file, 'utf8'))) hits.push(file.slice(root.length + 1))
  }
  if (hits.length === 0) {
    console.error('verify-host-contracts FAIL: the removed-member scan found nothing for a member the source definitely reads — the check is blind')
    process.exit(1)
  }
  console.log(`verify-host-contracts removed-member self-test OK: the scan reacts (${hits.length} file(s) matched the probe)`)
  process.exit(0)
}

// `--probe-services` feeds the service check one name no package provides and one
// member no package carries, and requires a finding for EACH. A green run means
// the check cannot see the failure it exists for.
if (args.has('--probe-services')) {
  const probe = [
    { half: 'host', name: 'dsh-task-board-no-such-service', member: 'describe', pkg: '@deepseek-ai/dsh-settings' },
    { half: 'client', name: 'settings', member: 'dshTaskBoardNoSuchMember', pkg: '@deepseek-ai/dsh-settings' },
  ]
  const findings = serviceFailures(probe)
  const seenName = findings.some(finding => finding.includes('dsh-task-board-no-such-service'))
  const seenMember = findings.some(finding => finding.includes('dshTaskBoardNoSuchMember'))
  if (!seenName || !seenMember) {
    console.error('verify-host-contracts FAIL: the service check missed a service name or a member that cannot exist — the check is blind')
    for (const finding of findings) console.error(`  - ${finding}`)
    process.exit(1)
  }
  console.log(`verify-host-contracts service self-test OK: the check reacts (${findings.length} findings for a service name and a member that cannot exist)`)
  process.exit(0)
}

// --- report ------------------------------------------------------------------

notes.push(`host: ${dsh}`)
notes.push(`slots declared by host: ${declared.size} (${typedSlots.size} typed contract entries, ${runtimeSlots.size} runtime children tables)`)
notes.push(`contracts declared by plugin: ${slots.length} slots, ${members.length} members, ${services.length} injected services, ${absent.length} removed-member rules`)

if (failures.length > 0) {
  console.error('verify-host-contracts FAIL')
  for (const note of notes) console.error(`  ${note}`)
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('Fix the plugin to the installed host contract (see AGENTS.md 宿主契约表), or update the table if the contract genuinely moved.')
  process.exit(1)
}

console.log(`verify-host-contracts OK: ${notes.join('; ')}`)
