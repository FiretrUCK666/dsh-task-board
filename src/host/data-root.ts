/**
 * The one place in this plugin that touches the medium outside the platform
 * storage hub.
 *
 * Everything the board persists goes through `ctx.storage` (see
 * board-service.ts): the hub owns the root directory, the unit naming rules,
 * the atomic publish and the per-record layout, and this plugin has no business
 * choosing any of that. What the hub CANNOT express is retiring the one file it
 * no longer owns — the pre-layout whole-unit document, written before the unit
 * moved to a per-record tree. That file is only reachable by path, and the hub
 * exposes no path-shaped read.
 *
 * So this module owns exactly one job: move that file aside, once, under three
 * guards, and never touch it otherwise. Moving (not deleting) is deliberate: the
 * bytes stay on disk as the migration's own backup, and the renamed name no
 * longer ends in `.json`, so neither the hub nor a later boot reads it again.
 *
 * Every path here is DISCOVERED, never hard-coded: the harness home comes from
 * `$DSH_HOME` or `os.homedir()` at call time, and the unit name is a parameter.
 * A deployment that relocates its home, or another machine entirely, resolves
 * the same three lines without an edit.
 */
import { readFile, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The harness home directory, resolved the way the host resolves it: an
 * explicit `$DSH_HOME` wins, a blank one counts as unset, and the fallback is
 * `.dsh` under the current user's home.
 * @returns the absolute harness home path.
 */
export function harnessHome(): string {
  const configured = process.env.DSH_HOME?.trim()
  return configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh')
}

/**
 * The directory the storage hub roots every unit in.
 * @returns the absolute storage root path.
 */
export function storagesRoot(): string {
  return join(harnessHome(), 'storages')
}

/** Why a legacy file was or was not retired — the UI and the log both read this. */
export type RetireStatus =
  /** The file was ours and has been moved aside. */
  | 'retired'
  /** No legacy file exists; nothing to do (the common case after the first boot). */
  | 'absent'
  /** A file sits at the legacy path but is not a unit document of ours; left untouched. */
  | 'foreign'
  /** The migrated document is not on disk yet, so retiring would strand the data. */
  | 'target-missing'
  /** A retired copy from an earlier run already occupies the destination. */
  | 'taken'

/** The outcome of one retirement attempt. */
export interface RetireOutcome {
  /** What happened, in the words the log and the board status line use. */
  readonly status: RetireStatus
  /** The legacy path that was considered, whether or not it existed. */
  readonly legacyPath: string
  /** The path the file now lives at; present only when `status` is `retired`. */
  readonly retiredPath?: string
}

/**
 * The directory a per-record unit occupies under the storage root.
 *
 * This mirrors the backend's own layout rule; it is spelled out here only so
 * the retirement guard can name the exact file a migrated document lands in.
 * A unit that is still a single whole-unit FILE has no directory yet.
 * @param unitName - the unit whose directory to locate.
 * @returns the absolute unit directory path.
 */
export function unitDirectoryPath(unitName: string): string {
  return join(storagesRoot(), unitName)
}

/** A local-time `YYYYMMDD-HHmmss` suffix — readable, and unique per run. */
function retireStamp(now: number): string {
  const d = new Date(now)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** Whether a path exists, without throwing on any of the ways it can fail. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Options for retiring one pre-layout unit file. */
export interface RetireOptions {
  /** The unit whose legacy whole-unit file to retire. */
  readonly unitName: string
  /** The unit version the legacy file is expected to carry. */
  readonly legacyVersion: number
  /** Absolute path of the migrated document that proves the data landed. */
  readonly migratedPath: string
  /** Clock for the destination suffix. */
  readonly now: number
  /** Diagnostic sink. */
  readonly log: (message: string, error?: unknown) => void
}

/**
 * Move a pre-layout whole-unit file aside, once.
 *
 * The three guards exist so this can never destroy data: the data must already
 * exist at its new home, the file must really be the unit document we wrote
 * (a stray file of the same name is left alone), and the destination must be
 * free. Every failure returns a status and changes nothing on disk.
 * @param options - which file, which version, where the data landed.
 * @returns what happened, with the paths involved.
 */
export async function retireLegacyUnitFile(options: RetireOptions): Promise<RetireOutcome> {
  const legacyPath = join(storagesRoot(), `${options.unitName}.json`)
  const out = (status: RetireStatus, retiredPath?: string): RetireOutcome =>
    retiredPath === undefined ? { status, legacyPath } : { status, legacyPath, retiredPath }

  if (!await exists(options.migratedPath)) {
    options.log(`[dsh-task-board] legacy unit file left in place: the migrated document is not at ${options.migratedPath}`)
    return out('target-missing')
  }
  if (!await exists(legacyPath)) return out('absent')

  // Identity check: only OUR unit document is ever moved. A file that does not
  // parse, or that names another unit or another version, is somebody else's.
  let header: { unit?: { name?: unknown; version?: unknown } }
  try {
    header = JSON.parse(await readFile(legacyPath, 'utf8')) as typeof header
  } catch (error) {
    options.log(`[dsh-task-board] legacy unit file is unreadable; left in place: ${legacyPath}`, error)
    return out('foreign')
  }
  if (header.unit?.name !== options.unitName || header.unit?.version !== options.legacyVersion) {
    options.log(`[dsh-task-board] legacy unit file is not this unit's document; left in place: ${legacyPath}`)
    return out('foreign')
  }

  const retiredPath = `${legacyPath}.migrated-${retireStamp(options.now)}`
  if (await exists(retiredPath)) return out('taken')
  try {
    await rename(legacyPath, retiredPath)
  } catch (error) {
    // A locked or permission-denied file stays exactly where it is; the data
    // is already safe at its new home either way.
    options.log(`[dsh-task-board] legacy unit file could not be moved aside; left in place: ${legacyPath}`, error)
    return out('target-missing')
  }
  return out('retired', retiredPath)
}
