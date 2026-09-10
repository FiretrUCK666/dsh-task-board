/**
 * Smoke-runs the built client bundle the way the browser module loader does.
 *
 * The shell's loader serves /plugins/<package-name>/client.js, evaluates it,
 * and requires the bundle to call window.__ModuleLoader__.load({id, factory})
 * with the package name it located. A bundle that registers a different id, or
 * whose factory throws while executing, is rejected and the GUI shows
 * "Failed to load plugins".
 *
 * This harness reproduces that handshake in Node: it stubs the loader, resolves
 * the platform modules through `require` from the installed DSH tree (the same
 * specifiers the browser module table seeds), and executes the factory. It
 * catches exactly the class of bug a string check cannot — a mismatched id, a
 * factory that throws on boot, or a require the table cannot answer.
 *
 * Usage: node scripts/smoke-client.mjs <plugin-dir> [expected-bundle-id]
 *
 * The expected id defaults to `package.json`'s `name`, which is what the host's
 * client module system keys the bundle by — deriving it keeps a rename (a fork
 * taking its own scope, say) from needing an edit here.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [dirArg, expectedIdArg] = process.argv.slice(2)
if (!dirArg) {
  console.error('usage: node scripts/smoke-client.mjs <plugin-dir> [expected-bundle-id]')
  process.exit(2)
}

const root = resolve(dirArg)
const bundlePath = join(root, 'lib', 'client.js')
const source = readFileSync(bundlePath, 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const expectedId = expectedIdArg ?? manifest.name

let registration
globalThis.window = {
  __ModuleLoader__: {
    load(record) {
      registration = record
    },
  },
}

/** Resolve one platform module the way the shell's frozen table would. */
function platformRequire(specifier) {
  // react and friends resolve through the plugin's own dev dependencies; the
  // @deepseek-ai seed entries resolve from the plugin's install too.
  const require = createRequire(join(root, 'package.json'))
  return require(specifier)
}

// Evaluate the bundle. It is a CJS closure-factory artifact, so a Function
// wrapper is the faithful way to run it without a module system of its own.
try {
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'require', source)(globalThis.window, undefined, platformRequire)
} catch (error) {
  console.error(`FAIL  the bundle threw while evaluating: ${error.message}`)
  process.exit(1)
}

if (registration === undefined) {
  console.error('FAIL  the bundle never called window.__ModuleLoader__.load')
  process.exit(1)
}

const failures = []
if (registration.id !== expectedId) {
  failures.push(`registered id "${registration.id}" but the loader expects "${expectedId}"`)
}
if (typeof registration.factory !== 'function') {
  failures.push('registration carries no factory function')
} else {
  const module = { exports: {} }
  try {
    registration.factory(platformRequire, module, module.exports)
  } catch (error) {
    failures.push(`the factory threw on boot: ${error.message}`)
  }
}

if (failures.length > 0) {
  console.error(`smoke-client FAILED (${failures.length})`)
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}
console.log(`smoke-client OK: bundle registers "${registration.id}" and its factory boots`)
