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
 * green while contributing nothing at runtime. The shape that failure takes: the
 * host half calls a member the installed service no longer carries, `apply`
 * throws before registering a single route or prompt section, and this check
 * stays green because its contract table names no host service at all.
 *
 * What this proves, and what it deliberately does not:
 *
 * - It proves the plugin's declared dependencies still have a counterpart in the
 *   running host, and that the plugin does not reach for members the host dropped.
 * - It proves the pending-question carrier probe still names the methods that
 *   carrier declares (its own section below), because that read is structural and
 *   a rename there fails silently.
 * - It proves the plugin's structural mirror of the ATTACHMENT STORE is still a
 *   mirror: the reference fields and the store members our host route declares
 *   are compared, field by field and signature by signature, against the
 *   installed declarations — the one boundary that has already cost readers
 *   their pictures (see that section).
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
 *        node scripts/verify-host-contracts.mjs [plugin-dir] --probe-attachment-face
 */
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { probeOf } from './probe-args.mjs'

const root = resolve(process.argv[2] ?? '.')
/* 自测开关先过一遍：拼错要红，不能静默变成一次正常跑（见 `probe-args.mjs`）。 */
probeOf(['--probe-removed', '--probe-services', '--probe-attachment-face'])
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

/** The installation's own package name, read live from its manifest. */
const ownPackage = (() => {
  try {
    return JSON.parse(readFileSync(join(dsh, 'package.json'), 'utf8')).name ?? ''
  } catch {
    return ''
  }
})()

/**
 * Where one named package's files live.
 *
 * Two roots, because the installation is not a dependency of itself: the
 * launcher's own code sits in the install root (`<dsh>/lib`) while every other
 * package sits under the install's `node_modules/@deepseek-ai`. Without the
 * first root a contract row about a launcher-provided service reports "no
 * installed package provides it" — the plugin would be told its true
 * dependency does not exist, and the row could only ever be written as prose.
 * @param pkg - the import specifier (`@scope/name`).
 * @returns the package's own directory.
 */
function packageDirOf(pkg) {
  return pkg === ownPackage ? dsh : join(packagesDir, pkg.replace(/^@[a-z0-9-]+\//, ''))
}

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
    // The member cell holds EVERY member the half reads through that service, one
    // backticked name each: reading only the first would leave the rest of the cell
    // unchecked, and a cell whose names cannot be read at all is a row this check
    // is blind to — so an unreadable cell is reported, never skipped.
    const service = /^\|\s*(host|client)\s*\|\s*`([a-zA-Z][a-zA-Z0-9.]*)`\s*\|\s*([^|]+?)\s*\|\s*`(@[a-z0-9/-]+)`\s*\|\s*$/.exec(line)
    if (service !== null) {
      const named = [...service[3].matchAll(/`([^`]+)`/g)].map(match => match[1])
      if (named.length === 0) {
        console.error(`verify-host-contracts FAIL: the service row for \`${service[2]}\` names no readable member: ${line.trim()}`)
        process.exit(1)
      }
      for (const member of named) services.push({ half: service[1], name: service[2], member, pkg: service[4] })
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
  // the install's own package sits in another root — `packageDirOf` owns that
  // mapping so no caller joins a specifier onto a directory by hand.
  const pkgDir = packageDirOf(pkg)
  if (!existsSync(join(pkgDir, 'package.json'))) {
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
  const attribute = (pkg, files) => {
    for (const file of files) {
      const text = textOf(file)
      // `super(ctx, "name")` (a Service subclass) and `provide("name")` are the
      // two shapes cordis registers a service name with.
      for (const m of text.matchAll(/(?:super\([^)]{0,80},\s*|provide\(\s*)"([A-Za-z][A-Za-z0-9.]*)"/g)) {
        if (!index.has(m[1])) index.set(m[1], new Set())
        index.get(m[1]).add(pkg)
      }
    }
  }
  for (const entry of existsSync(packagesDir) ? readdirSync(packagesDir, { withFileTypes: true }) : []) {
    if (!entry.isDirectory()) continue
    attribute(`@deepseek-ai/${entry.name}`, packageTextFiles(join(packagesDir, entry.name)))
  }
  attribute(ownPackage, packageTextFiles(dsh))
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
    const pkgDir = packageDirOf(pkg)
    if (!existsSync(join(pkgDir, 'package.json'))) {
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

// --- the pending-question carrier's action names ------------------------------
// The board answers a pending question IN PLACE through the object the official
// uiSession session-status snapshot carries, and it reads that object
// STRUCTURALLY — by method name, across a package boundary no compiler checks.
// The read therefore has no build-time link to the host, and its failure mode is
// silence: a renamed method leaves `canAnswerOf` false on every real host (each
// card falls back to the read-only shell and nothing says why), and turns the
// dismissal into a TypeError at the moment a reader presses it.
//
// So the two names are read from BOTH sides and compared: the methods the probe
// requires (`MirrorCarrierActions`) against the methods the INSTALLED carrier
// declares in its own type declaration. Both sides are read as source, so the
// check works without importing either package.

/** The 1-based line of one character offset. */
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

/**
 * The body of a `class X {` / `interface X {` declaration and the line it starts
 * on. Brace-matched, skipping comments and strings — the same reader the slot scan
 * uses, which is why a declaration can be read out of a file this script cannot
 * import (the browser bundle and its `.d.ts`).
 * @param text - the file's text.
 * @param keyword - `class` or `interface`.
 * @param name - the declared name.
 * @returns the body and its line, or undefined when the declaration is absent.
 */
function declarationBody(text, keyword, name) {
  const pattern = new RegExp(`\\b${keyword}\\s+${name}\\b[^{;]*\\{`)
  const match = pattern.exec(text)
  if (match === null) return undefined
  const open = match.index + match[0].length - 1
  const body = objectBody(text, open)
  return body === undefined ? undefined : { body, line: lineOf(text, open) }
}

/**
 * The method names declared at the top level of a class or interface body, each
 * with its line and whether the declaration was optional (`name?()`). Comment
 * lines are skipped: a name mentioned in prose is not a declaration.
 */
function declaredMethods(body, bodyLine) {
  const methods = []
  for (const [offset, line] of body.split('\n').entries()) {
    if (/^\s*[*/]/.test(line)) continue
    const match = /^\s+(?:static\s+)?([A-Za-z_$][\w$]*)(\?)?\s*\(/.exec(line)
    if (match === null || match[1] === 'constructor') continue
    methods.push({ name: match[1], line: bodyLine + offset, optional: match[2] === '?' })
  }
  return methods
}

const CARRIER_PACKAGE = '@deepseek-ai/dsh-client-ui-user-questions'

/**
 * The method surface the installed pending-question carrier declares, read from
 * the package's own type declaration: the carrier is the type the host publishes
 * for the `question` domain in the Session pending-interaction map, so the NAME
 * is read rather than assumed.
 * @param pkgDir - the installed package directory.
 * @returns the carrier name, where it is declared, and its methods; undefined
 * when this package declares no such carrier (reported by the caller).
 */
function officialCarrier(pkgDir) {
  for (const file of packageTextFiles(pkgDir).filter(candidate => candidate.endsWith('.d.ts'))) {
    const text = textOf(file)
    const map = declarationBody(text, 'interface', 'SessionPendingInteractionMap')
    const name = map === undefined ? undefined : /^\s*question\s*:\s*([A-Za-z_$][\w$]*)/m.exec(map.body)?.[1]
    if (name === undefined) continue
    const carrier = declarationBody(text, 'class', name)
    if (carrier === undefined) continue
    return { name, file, line: carrier.line, methods: declaredMethods(carrier.body, carrier.line) }
  }
  return undefined
}

/** A path as a finding should print it: DSH packages by name, ours from the root. */
function shownPath(file) {
  if (file.startsWith(packagesDir)) return file.slice(packagesDir.length + 1)
  if (file.startsWith(root)) return file.slice(root.length + 1)
  return file
}

{
  const carrierPkgDir = packageDirOf(CARRIER_PACKAGE)
  const probeFile = join(root, 'src', 'client', 'board', 'pending-mirror.ts')
  const probeText = existsSync(probeFile) ? readFileSync(probeFile, 'utf8') : ''
  const probe = declarationBody(probeText, 'interface', 'MirrorCarrierActions')
  // Optional members are read but not required: the probe degrades when the host
  // does not carry them, so demanding them would red-flag a working host.
  const required = probe === undefined ? [] : declaredMethods(probe.body, probe.line).filter(method => !method.optional)
  if (required.length === 0) {
    failures.push(`the carrier probe declares no required method (${shownPath(probeFile)}) — this check can no longer compare anything`)
  } else if (!existsSync(join(carrierPkgDir, 'package.json'))) {
    // The plugin never imports this package (it reads the snapshot structurally),
    // so a host that ships no question UI is degraded, not broken: unverified, and
    // said out loud rather than passed over.
    notes.push(`pending-question carrier: NOT VERIFIED (${CARRIER_PACKAGE} is not installed here)`)
  } else {
    const carrier = officialCarrier(carrierPkgDir)
    if (carrier === undefined) {
      failures.push(
        `the installed ${CARRIER_PACKAGE} declares no pending-interaction carrier this check can read `
        + `(no SessionPendingInteractionMap entry for "question" with its class in the same type file) — `
        + `re-read the carrier contract and update ${shownPath(probeFile)} and this check`,
      )
    } else {
      for (const method of required) {
        if (carrier.methods.some(declared => declared.name === method.name)) continue
        failures.push(
          `the official carrier "${carrier.name}" (${shownPath(carrier.file)}:${carrier.line}) declares no `
          + `"${method.name}" — it declares ${carrier.methods.map(declared => declared.name).join(', ')}; `
          + `${shownPath(probeFile)}:${method.line} settles the request through "${method.name}", so in-place `
          + 'answering would degrade to the read-only card and the dismissal would throw on the reader\'s click',
        )
      }
      notes.push(
        `pending-question carrier ${carrier.name} (${shownPath(carrier.file)}:${carrier.line}) declares `
        + `${carrier.methods.map(declared => declared.name).join(', ')}; the probe requires `
        + required.map(method => method.name).join(', '),
      )
    }
  }
}

// --- the attachment store face ------------------------------------------------
// The plugin reads the harness's attachment store BY NAME and STRUCTURALLY (see
// src/host/attachment-route.ts): it never imports the implementing package, so
// nothing at build time notices when the official reference grows a field, loses
// one, or when a member changes shape. That silence has already been paid for: a
// reader's own picture travelled to the store without the intrinsic size the
// store verifies a read-back against, and came back as "corrupt".
//
// So both sides are read as SOURCE and compared, with no import and no type
// checker:
//
//   our side   — `FileRefLike` / `ImageRefLike` / the store face in
//                src/host/attachment-route.ts;
//   their side — the reference vocabulary and the abstract store from the
//                installed `@deepseek-ai/dsh-attachment` (`lib/types/**`), and
//                the concrete provider's own overrides from
//                `@deepseek-ai/dsh-attachment-local`.
//
// THE TWO COMPARISONS ARE NOT THE SAME SHAPE, on purpose. A reference is ONE
// VALUE the plugin hands around, so the field sets must agree EXACTLY: a field
// the harness adds and our mirror does not name is a field we would drop on the
// way to the store, and a field our mirror invents is one we would read out of
// nothing. The store's MEMBERS are a surface we call only part of, so our face
// must be a subset — a method that vanished is a finding, a method we simply do
// not call is not.

const ATTACHMENT_PACKAGE = '@deepseek-ai/dsh-attachment'
const ATTACHMENT_PROVIDER_PACKAGE = '@deepseek-ai/dsh-attachment-local'
const ATTACHMENT_FACE_FILE = join(root, 'src', 'host', 'attachment-route.ts')

/** The name of our structural store face, and of the official classes it mirrors. */
const OUR_STORE_FACE = 'AttachmentStoreLike'
const OFFICIAL_ABSTRACT_STORE = 'AttachmentStore'
const OFFICIAL_CONCRETE_STORE = 'LocalAttachmentStore'

/**
 * Our structural reference interfaces, each paired with the official declaration
 * it mirrors. This pairing is the one thing the check cannot derive: the names
 * live in two packages that never import each other.
 */
const REF_PAIRS = [
  { ours: 'FileRefLike', official: 'FileAttachmentRef' },
  { ours: 'ImageRefLike', official: 'ImageAttachmentRef' },
]

/** Comment characters blanked to spaces, newlines kept (line numbers stay valid). */
function blankComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, match => ' '.repeat(match.length))
}

/** The source line of one offset inside a declaration body. */
function lineInBody(body, offset, declarationLine) {
  return declarationLine + body.slice(0, offset).split('\n').length - 1
}

/**
 * The top-level members of a declaration body, in source order: object fields
 * (`name?: T`) and methods (`name(a, b?): T`), each with the line it starts on.
 * Members are separated by `;` or a line break at nesting depth zero, so a
 * multi-line object type stays ONE member.
 * @param body - the declaration's body text (between its braces).
 * @param declarationLine - the line the opening brace sits on.
 * @returns the members, or an empty array when the body holds none.
 */
function memberListOf(body, declarationLine) {
  const cleaned = blankComments(body)
  const segments = []
  let depth = 0
  let start = 0
  for (let i = 0; i < cleaned.length; i++) {
    const character = cleaned[i]
    if ('{([<'.includes(character)) depth += 1
    else if ('})]>'.includes(character)) depth = Math.max(0, depth - 1)
    else if (depth === 0 && (character === ';' || character === '\n')) {
      segments.push([start, i])
      start = i + 1
    }
  }
  segments.push([start, cleaned.length])

  const members = []
  for (const [from, to] of segments) {
    const text = cleaned.slice(from, to)
    const member = text.trim()
    if (member === '') continue
    const offset = from + (text.length - text.trimStart().length)
    const line = lineInBody(body, offset, declarationLine)
    const method = /^(?:(?:static|abstract|public|private|protected|readonly|declare|async)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^<>]*>)?\s*\(([\s\S]*)\)\s*:\s*([\s\S]*)$/.exec(member)
    if (method !== null) {
      if (method[1] === 'constructor') continue
      members.push({
        name: method[1], kind: 'method', line,
        params: parametersOf(method[2]),
        returnType: method[3].trim().replace(/\s+/g, ' '),
      })
      continue
    }
    // A field may carry the same modifiers (`abstract readonly imageLimits: T`).
    const field = /^(?:(?:static|abstract|public|private|protected|readonly|declare)\s+)*([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*([\s\S]*)$/.exec(member)
    if (field === null) continue
    members.push({ name: field[1], kind: 'field', optional: field[2] === '?', type: field[3].trim().replace(/\s+/g, ' '), line })
  }
  return members
}

/** One method's parameter list: parameter names, optionality and type text. */
function parametersOf(text) {
  const parameters = []
  let depth = 0
  let start = 0
  const parts = []
  for (let i = 0; i < text.length; i++) {
    const character = text[i]
    if ('{([<'.includes(character)) depth += 1
    else if ('})]>'.includes(character)) depth = Math.max(0, depth - 1)
    else if (depth === 0 && character === ',') {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  for (const part of parts) {
    const parameter = part.trim()
    if (parameter === '') continue
    const dot = parameter.indexOf(':')
    const head = dot === -1 ? parameter : parameter.slice(0, dot)
    parameters.push({ optional: head.includes('?'), type: (dot === -1 ? '' : parameter.slice(dot + 1)).trim().replace(/\s+/g, ' ') })
  }
  return parameters
}

/**
 * Every type alias one set of declaration files declares, for resolving a named
 * type to the category of value it really is (`AttachmentId` is a branded
 * `string`; `ImageMediaType` is a union of string literals).
 */
function aliasIndex(files) {
  const aliases = new Map()
  for (const file of files) {
    const text = textOf(file)
    for (const match of text.matchAll(/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*)/gm)) {
      if (!aliases.has(match[1])) aliases.set(match[1], match[2].trim())
    }
  }
  return aliases
}

/**
 * The wire category of one type expression: what a value of that type IS, not
 * how the type is spelled. Named types resolve through the package's own aliases
 * and through a single-argument wrapper (whose category is its argument's), so a
 * brand and a literal union both read as the string they are on the wire.
 * @param typeText - the type as written.
 * @param aliases - the declaring package's type aliases.
 * @returns a stable category string.
 */
function categoryOf(typeText, aliases, depth = 0) {
  const text = typeText.trim().replace(/^readonly\s+/, '')
  if (text === '') return 'unknown'
  if (depth > 8) return `opaque:${text}`
  if (text === 'string') return 'string'
  if (text === 'number') return 'number'
  if (text === 'boolean') return 'boolean'
  if (/^'(?:[^'\\]|\\.)*'$/.test(text) || /^"(?:[^"\\]|\\.)*"$/.test(text)) return 'string'
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return 'number'
  if (text.startsWith('{')) return 'object'
  if (/\[\]$/.test(text)) return 'array'
  if (text.includes('=>')) return 'function'
  const union = splitTopLevel(text, '|')
  if (union.length > 1) {
    const categories = new Set(union.map(part => categoryOf(part, aliases, depth + 1)))
    return categories.size === 1 ? [...categories][0] : `union(${[...categories].sort().join('|')})`
  }
  const named = /^([A-Za-z_$][\w$]*)\s*(?:<([\s\S]*)>)?$/.exec(text)
  if (named === null) return `opaque:${text}`
  const [, name, argument] = named
  if (aliases.has(name)) return categoryOf(aliases.get(name), aliases, depth + 1)
  if (argument !== undefined) return categoryOf(argument, aliases, depth + 1)
  return `opaque:${name}`
}

/** Split a type expression on one separator at nesting depth zero. */
function splitTopLevel(text, separator) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const character = text[i]
    if ('{([<'.includes(character)) depth += 1
    else if ('})]>'.includes(character)) depth = Math.max(0, depth - 1)
    else if (depth === 0 && character === separator) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map(part => part.trim()).filter(part => part !== '')
}

/** Whether a declaration's body really holds the members the comparison needs. */
function isUsable(members) {
  return members.length > 0
}

/**
 * The names one declaration inherits from (`extends` / `implements`), read from
 * its header. A mirror that extends another mirror carries those fields too, and
 * comparing only the body would report every inherited field as missing.
 */
function extendedNamesOf(text, keyword, name) {
  const match = new RegExp(`\\b${keyword}\\s+${name}\\b([^{;]*)\\{`).exec(text)
  if (match === null) return []
  const clause = /\b(?:extends|implements)\s+([^{]*)$/.exec(match[1])
  if (clause === null) return []
  return clause[1]
    .split(',')
    .map(part => part.trim().replace(/<[\s\S]*$/, '').trim())
    .filter(part => /^[A-Za-z_$][\w$]*$/.test(part))
}

/**
 * One named declaration, read out of a set of files by source: where it is, and
 * its members (its own, plus everything it inherits from a declaration in the
 * same set). A declaration the reader cannot find is NOT an empty result the
 * caller may pass over — it means this check can no longer see the contract.
 * @param files - the files to search, in order.
 * @param keyword - `interface` or `class`.
 * @param name - the declared name.
 * @param seen - the names already visited (inheritance cycles, self-reference).
 * @param depth - how far down the inheritance chain this read already is.
 */
function readDeclaration(files, keyword, name, seen = new Set(), depth = 0) {
  if (depth > 4 || seen.has(name)) return undefined
  seen.add(name)
  for (const file of files) {
    const text = textOf(file)
    const declaration = declarationBody(text, keyword, name)
    if (declaration === undefined) continue
    const inherited = []
    for (const parent of extendedNamesOf(text, keyword, name)) {
      const declarationOfParent = readDeclaration(files, keyword, parent, seen, depth + 1)
      if (declarationOfParent !== undefined) inherited.push(...declarationOfParent.members)
    }
    return { file, line: declaration.line, members: [...inherited, ...memberListOf(declaration.body, declaration.line)] }
  }
  return undefined
}

/**
 * The official attachment face as installed: the reference vocabulary and the
 * store the plugin actually calls.
 *
 * The provider class is read with the base package's files BEHIND it, so the
 * one mechanism that resolves a declaration's inherited members also carries the
 * `extends AttachmentStore` across the package boundary — a method the provider
 * does not override is found where it is really declared, and the line a finding
 * prints is the line a reader would open.
 * @param baseDir - the `@deepseek-ai/dsh-attachment` directory, or null.
 * @param providerDir - the `@deepseek-ai/dsh-attachment-local` directory, or null.
 */
function readAttachmentFace(baseDir, providerDir) {
  const baseFiles = baseDir === null ? [] : packageTextFiles(baseDir).filter(file => file.endsWith('.d.ts'))
  const providerFiles = providerDir === null ? [] : packageTextFiles(providerDir).filter(file => file.endsWith('.d.ts'))
  const refs = new Map()
  for (const pair of REF_PAIRS) refs.set(pair.ours, readDeclaration(baseFiles, 'interface', pair.official))
  return {
    refs,
    store: readDeclaration([...providerFiles, ...baseFiles], 'class', OFFICIAL_CONCRETE_STORE)
      ?? readDeclaration(baseFiles, 'class', OFFICIAL_ABSTRACT_STORE),
    aliases: aliasIndex([...baseFiles, ...providerFiles]),
  }
}

/** Which of a set of names one type text mentions. */
function namesIn(text, names) {
  return new Set(names.filter(name => new RegExp(`\\b${name}\\b`).test(text)))
}

/** One finding for a reference whose field sets disagree. */
function refFieldFindings(ours, official, side, aliases) {
  const findings = []
  const ourByName = new Map(ours.members.map(member => [member.name, member]))
  const officialByName = new Map(official.members.map(member => [member.name, member]))
  for (const member of ours.members) {
    const counterpart = officialByName.get(member.name)
    const where = `${shownPath(ATTACHMENT_FACE_FILE)}:${member.line}`
    const there = `${shownPath(official.file)}:${counterpart === undefined ? official.line : counterpart.line}`
    if (counterpart === undefined) {
      findings.push(
        `our ${side} mirror declares "${member.name}" (${where}), which the installed `
        + `${side} declaration does not have (${there}; it declares ${[...officialByName.keys()].join(', ')}) — `
        + 'the plugin would read a field the harness never writes',
      )
      continue
    }
    if ((member.optional === true) !== (counterpart.optional === true)) {
      findings.push(
        `"${member.name}" of ${side} is ${member.optional === true ? 'optional' : 'required'} in ${where} but `
        + `${counterpart.optional === true ? 'optional' : 'required'} in the installed declaration (${there})`,
      )
    }
    const ourCategory = categoryOf(member.type, aliases)
    const officialCategory = categoryOf(counterpart.type, aliases)
    if (ourCategory !== officialCategory) {
      findings.push(
        `"${member.name}" of ${side} holds a ${ourCategory} in ${where} but a ${officialCategory} in the installed `
        + `declaration (${there}: ${counterpart.type}) — a reference field whose value changed shape cannot be `
        + 'forwarded unchanged',
      )
    }
  }
  for (const member of official.members) {
    if (ourByName.has(member.name)) continue
    findings.push(
      `the installed ${side} declaration declares "${member.name}" (${shownPath(official.file)}:${member.line}) and our `
      + `mirror (${shownPath(ours.file)}:${ours.line}) does not — a field the plugin does not name is a field it drops `
      + 'on the way to the store, and the store refuses what it cannot verify',
    )
  }
  return findings
}

/** One finding for a store member our face calls and the installed store lacks. */
function storeMemberFindings(ourMember, official, aliases) {
  const where = `${shownPath(ATTACHMENT_FACE_FILE)}:${ourMember.line}`
  const counterpart = official.members.find(member => member.name === ourMember.name)
  if (counterpart === undefined) {
    return [
      `our ${OUR_STORE_FACE} declares "${ourMember.name}" (${where}), which the installed store does not — it declares `
      + `${official.members.filter(member => member.kind === 'method').map(member => member.name).join(', ')}`,
    ]
  }
  if (counterpart.kind !== ourMember.kind) {
    return [`"${ourMember.name}" is a ${ourMember.kind} in ${where} but a ${counterpart.kind} in the installed store`]
  }
  if (ourMember.kind !== 'method') return []
  const findings = []
  const there = `${shownPath(official.file)}:${counterpart.line}`
  if (ourMember.params.length !== counterpart.params.length) {
    findings.push(
      `"${ourMember.name}" takes ${ourMember.params.length} parameter(s) in ${where} and `
      + `${counterpart.params.length} in the installed declaration (${there})`,
    )
  } else {
    for (const [index, parameter] of ourMember.params.entries()) {
      if ((parameter.optional === true) === (counterpart.params[index].optional === true)) continue
      findings.push(
        `parameter ${index + 1} of "${ourMember.name}" is ${parameter.optional === true ? 'optional' : 'required'} in `
        + `${where} and ${counterpart.params[index].optional === true ? 'optional' : 'required'} in the installed `
        + `declaration (${there})`,
      )
    }
  }
  // A method's reference-typed positions must speak about the SAME reference we
  // mirror: a rename on either side would otherwise compare a face with itself.
  const ourNames = namesIn(`${ourMember.params.map(parameter => parameter.type).join(' ')} ${ourMember.returnType}`, REF_PAIRS.map(pair => pair.ours))
  const officialNames = namesIn(`${counterpart.params.map(parameter => parameter.type).join(' ')} ${counterpart.returnType}`, REF_PAIRS.map(pair => pair.official))
  const mapped = new Set(REF_PAIRS.filter(pair => officialNames.has(pair.official)).map(pair => pair.ours))
  if ([...ourNames].sort().join(',') !== [...mapped].sort().join(',')) {
    findings.push(
      `"${ourMember.name}" speaks about ${[...ourNames].join(', ') || 'no mirrored reference'} in ${where} but about `
      + `${[...officialNames].join(', ') || 'no reference'} in the installed declaration (${there}) — the mirror and the `
      + 'method have drifted apart',
    )
  }
  return findings
}

/**
 * Everything wrong with the plugin's attachment face against one installed one
 * (empty = the mirror still holds). Split out so the self-test below can run the
 * SAME code path on declarations that cannot be correct and require it to be red.
 * @param ourRefs - our reference interfaces by mirror name.
 * @param ourStore - our store face.
 * @param official - the face `readAttachmentFace` read.
 * @returns the findings, and what was read (for the OK line).
 */
function attachmentFaceFailures(ourRefs, ourStore, official) {
  const findings = []
  const read = []
  for (const pair of REF_PAIRS) {
    const ours = ourRefs.get(pair.ours)
    const theirs = official.refs.get(pair.ours)
    if (ours === undefined || !isUsable(ours.members)) {
      findings.push(
        `the plugin's ${pair.ours} declaration could not be read out of ${shownPath(ATTACHMENT_FACE_FILE)} — this check `
        + 'can no longer compare anything (a renamed mirror belongs in this script)',
      )
      continue
    }
    if (theirs === undefined || !isUsable(theirs.members)) {
      findings.push(
        `the installed ${ATTACHMENT_PACKAGE} declares no readable ${pair.official} — this check can no longer see the `
        + 'reference contract (re-read it and update this script)',
      )
      continue
    }
    read.push(`${pair.ours}=${ours.members.length} fields vs ${pair.official}=${theirs.members.length}`)
    findings.push(...refFieldFindings(ours, theirs, pair.official, official.aliases))
  }

  if (ourStore === undefined || !isUsable(ourStore.members)) {
    findings.push(
      `the plugin's ${OUR_STORE_FACE} could not be read out of ${shownPath(ATTACHMENT_FACE_FILE)} — this check can no `
      + 'longer compare anything (a renamed interface belongs in this script)',
    )
    return { findings, read }
  }
  if (official.store === undefined || !isUsable(official.store.members)) {
    findings.push(
      `the installed ${ATTACHMENT_PACKAGE} declares no readable store class — this check can no longer see the store `
      + 'contract (re-read it and update this script)',
    )
    return { findings, read }
  }
  for (const member of ourStore.members) findings.push(...storeMemberFindings(member, official.store, official.aliases))
  read.push(
    `store="${(official.store.file.startsWith(packagesDir) ? official.store.file.slice(packagesDir.length + 1) : official.store.file)}" `
    + `with ${String(official.store.members.filter(member => member.kind === 'method').length)} methods; our face declares `
    + `${String(ourStore.members.filter(member => member.kind === 'method').length)} methods `
    + `(${ourStore.members.filter(member => member.kind === 'method').map(member => member.name).join(', ')}) `
    + `and ${String(ourStore.members.filter(member => member.kind === 'field').length)} property `
    + `(${ourStore.members.filter(member => member.kind === 'field').map(member => member.name).join(', ')})`,
  )
  return { findings, read }
}

/** Our own face, read from the plugin's source (never imported). */
function readOurAttachmentFace() {
  const files = existsSync(ATTACHMENT_FACE_FILE) ? [ATTACHMENT_FACE_FILE] : []
  const refs = new Map()
  for (const pair of REF_PAIRS) refs.set(pair.ours, readDeclaration(files, 'interface', pair.ours))
  return { refs, store: readDeclaration(files, 'interface', OUR_STORE_FACE) }
}

{
  const baseDir = packageDirOf(ATTACHMENT_PACKAGE)
  const providerDir = packageDirOf(ATTACHMENT_PROVIDER_PACKAGE)
  const baseInstalled = existsSync(join(baseDir, 'package.json'))
  const providerInstalled = existsSync(join(providerDir, 'package.json'))
  if (!baseInstalled) {
    // A host without the vocabulary package is degraded, not broken: this plugin
    // would fail to attach anything there, and saying so is not the same as
    // calling the plugin wrong.
    notes.push(`attachment store face: NOT VERIFIED (${ATTACHMENT_PACKAGE} is not installed here)`)
  } else {
    if (!providerInstalled) notes.push(`attachment store face: the installed ${ATTACHMENT_PROVIDER_PACKAGE} is absent; only the abstract store was read`)
    const ours = readOurAttachmentFace()
    const outcome = attachmentFaceFailures(ours.refs, ours.store, readAttachmentFace(baseDir, providerInstalled ? providerDir : null))
    failures.push(...outcome.findings)
    if (outcome.findings.length === 0) notes.push(`attachment store face OK: ${outcome.read.join('; ')}`)
  }
}

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

// `--probe-attachment-face` mutates the INSTALLED declarations in every way the
// mirror section exists to notice, writes each mutation OUTSIDE this repository
// (a temp directory laid out like a package), and requires a finding for each.
// The comparison is the same code path a normal run uses; only the input is a
// file that cannot be right. A green run here would mean the section compares
// nothing.
if (args.has('--probe-attachment-face')) {
  const baseDir = packageDirOf(ATTACHMENT_PACKAGE)
  const providerDir = packageDirOf(ATTACHMENT_PROVIDER_PACKAGE)
  if (!existsSync(join(baseDir, 'package.json'))) {
    console.error(`verify-host-contracts FAIL: the attachment-face self-test cannot run — ${ATTACHMENT_PACKAGE} is not installed here, so there is nothing to mutate`)
    process.exit(1)
  }
  const refFiles = packageTextFiles(baseDir).filter(file => file.endsWith('.d.ts'))
  const refSource = (() => {
    const file = refFiles.find(candidate => declarationBody(textOf(candidate), 'interface', REF_PAIRS[1].official) !== undefined)
    return file === undefined ? undefined : { file, text: textOf(file) }
  })()
  // The store class the plugin's face is compared against when the scratch
  // package has no provider of its own: the contract every provider extends.
  const storeSource = (() => {
    const file = refFiles.find(candidate => declarationBody(textOf(candidate), 'class', OFFICIAL_ABSTRACT_STORE) !== undefined)
    return file === undefined ? undefined : { file, text: textOf(file) }
  })()
  if (refSource === undefined || storeSource === undefined) {
    console.error('verify-host-contracts FAIL: the attachment-face self-test cannot run — the installed declarations it mutates were not found (re-read them and update this script)')
    process.exit(1)
  }

  /** Rewrite one declaration body inside a file's text (self-test only). */
  const withBody = (text, keyword, name, edit) => {
    const match = new RegExp(`\\b${keyword}\\s+${name}\\b[^{;]*\\{`).exec(text)
    if (match === null) return undefined
    const open = match.index + match[0].length - 1
    const body = objectBody(text, open)
    if (body === undefined) return undefined
    const edited = edit(body)
    return edited === body ? undefined : text.slice(0, open + 1) + edited + text.slice(open + 1 + body.length)
  }

  // Each probe mutates ONE side of the face and leaves the other as installed,
  // so the finding it must produce cannot come from a scratch file that is wrong
  // in some other way as well.
  const probes = [
    {
      what: 'a reference field the mirror does not name',
      target: 'ref', declaration: REF_PAIRS[1].official, keyword: 'interface',
      edit: body => body.replace(/(\n\s*)height: number;/, '$1'),
      expect: 'height',
    },
    {
      what: 'a reference field the mirror would have to drop',
      target: 'ref', declaration: REF_PAIRS[0].official, keyword: 'interface',
      edit: body => `${body}\n    inventedField?: string;`,
      expect: 'inventedField',
    },
    {
      what: 'a reference field whose value changed shape',
      target: 'ref', declaration: REF_PAIRS[0].official, keyword: 'interface',
      edit: body => body.replace(/\bbytes: number;/, 'bytes: string;'),
      expect: 'bytes',
    },
    {
      what: 'a store method the plugin calls that moved away',
      target: 'store', declaration: OFFICIAL_ABSTRACT_STORE, keyword: 'class',
      edit: body => body.replace(/\breadFileStream\b/, 'readFileStreamRelocated'),
      expect: 'readFileStream',
    },
  ]

  const scratch = mkdtempSync(join(tmpdir(), 'dsh-tb-face-'))
  const misses = []
  try {
    for (const [index, probe] of probes.entries()) {
      const source = probe.target === 'ref' ? refSource : storeSource
      const edited = withBody(source.text, probe.keyword, probe.declaration, probe.edit)
      if (edited === undefined) {
        misses.push(`${probe.what}: the mutation could not be applied to the installed declaration (${shownPath(source.file)})`)
        continue
      }
      // One scratch package per mutation, laid out like the real one, so the
      // reading path under test is the same one a normal run uses.
      const packageRoot = join(scratch, `probe-${String(index)}`)
      mkdirSync(join(packageRoot, 'lib', 'types'), { recursive: true })
      writeFileSync(
        join(packageRoot, 'lib', 'types', 'probe.d.ts'),
        `${probe.target === 'ref' ? edited : refSource.text}\n${probe.target === 'store' ? edited : storeSource.text}`,
        'utf8',
      )
      const ours = readOurAttachmentFace()
      const outcome = attachmentFaceFailures(ours.refs, ours.store, readAttachmentFace(packageRoot, null))
      const seen = outcome.findings.some(finding => finding.includes(probe.expect))
      if (!seen) {
        misses.push(`${probe.what}: expected a finding naming "${probe.expect}", got ${outcome.findings.length === 0 ? 'none' : outcome.findings.map(finding => `"${finding}"`).join(' | ')}`)
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  if (misses.length > 0) {
    console.error('verify-host-contracts FAIL: the attachment-face comparison missed a declaration that cannot be right — the check is blind')
    for (const miss of misses) console.error(`  - ${miss}`)
    process.exit(1)
  }
  console.log(`verify-host-contracts attachment-face self-test OK: ${probes.length} mutated declarations outside the repository, each one named by a finding`)
  process.exit(0)
}

// --- report ------------------------------------------------------------------

notes.push(`host: ${dsh}`)
notes.push(`slots declared by host: ${declared.size} (${typedSlots.size} typed contract entries, ${runtimeSlots.size} runtime children tables)`)
notes.push(`contracts declared by plugin: ${slots.length} slots, ${members.length} members, ${services.length} service rows, ${absent.length} removed-member rules`)

if (failures.length > 0) {
  console.error('verify-host-contracts FAIL')
  for (const note of notes) console.error(`  ${note}`)
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('Fix the plugin to the installed host contract (see AGENTS.md 宿主契约表), or update the table if the contract genuinely moved.')
  process.exit(1)
}

console.log(`verify-host-contracts OK: ${notes.join('; ')}`)
