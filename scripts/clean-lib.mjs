/**
 * clean-lib.mjs — empty the build output before a build writes into it.
 *
 * WHY THIS EXISTS. `lib/` is a build output directory that is also TRACKED (the
 * install path does not build, so a missing `lib/` means a broken install), and
 * the bundler writes CONTENT-HASHED chunk names into it. A chunk whose content
 * changes therefore gets a NEW file and the old one is never removed: the
 * directory grows one dead file per change, `git status` fills with deletions
 * nobody asked for, and — because `package.json`'s `files` ships every
 * JavaScript file under `lib` — every orphan goes out to npm inside the
 * tarball, where it is loaded by nothing and read by no one.
 *
 * It is not a hypothetical: two orphans had already accumulated here, one of
 * them shipped in a published version.
 *
 * (Note for the next reader: a glob written inside one of these block comments
 * closes it. `lib/` followed by a star and a slash is a comment terminator, and
 * the file then fails to parse on line one of the comment.)
 *
 * WHY IT IS SAFE. Every file under `lib/` is produced by `pnpm build` and by
 * nothing else — the repository tracks the output, not hand-written files. So
 * removing the directory's contents before the build cannot lose source, and it
 * is the only way to make the tracked tree agree with the built one. Anything
 * that is NOT build output does not belong under `lib/`, and this makes that
 * true by construction instead of by a rule somebody has to remember.
 *
 * usage: node scripts/clean-lib.mjs [--dir lib] [--dry-run]
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const args = process.argv.slice(2)
const readFlag = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback
}
const dir = resolve(readFlag('dir', 'lib'))
const dryRun = args.includes('--dry-run')

if (!existsSync(dir)) process.exit(0)

/** Only ever remove inside the directory, and only files and directories. */
function* entries(path) {
  for (const name of readdirSync(path)) yield join(path, name)
}

let removed = 0
for (const entry of entries(dir)) {
  const name = relative(dir, entry)
  if (dryRun) {
    console.log(`would remove ${name}${statSync(entry).isDirectory() ? '/' : ''}`)
  } else {
    rmSync(entry, { recursive: true, force: true })
  }
  removed += 1
}
console.log(`clean-lib: ${dryRun ? 'would remove' : 'removed'} ${removed} entr${removed === 1 ? 'y' : 'ies'} from ${dir}`)
