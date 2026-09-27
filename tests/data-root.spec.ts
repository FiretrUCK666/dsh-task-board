/**
 * Data-root path discovery and legacy-unit-file retirement.
 *
 * This is the only code in the plugin that touches the medium outside the
 * platform storage hub, so it is tested against a REAL filesystem with
 * `$DSH_HOME` pointed at a temp dir: the guards are only worth anything if
 * they are shown to hold when there really is a file, a missing file, a
 * foreign file and a taken destination. A stubbed fs proves nothing here.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  harnessHome,
  retireLegacyUnitFile,
  storagesRoot,
  unitDirectoryPath,
} from '../src/host/data-root.ts'

const UNIT = 'dsh_task_board'
const T0 = Date.UTC(2026, 8, 27, 12, 0, 0)

let home: string
let saved: string | undefined

/** Write a legacy whole-unit file, optionally with a doctored header. */
function writeLegacy(header: unknown, global: unknown = { revision: 7 }): string {
  const path = join(storagesRoot(), `${UNIT}.json`)
  writeFileSync(path, `${JSON.stringify({ unit: header, global, tables: {} }, null, 2)}\n`, 'utf8')
  return path
}

/** Put the migrated document where the retirement guard looks for it. */
function writeMigrated(): string {
  const path = join(unitDirectoryPath(UNIT), 'documents', 'board.json')
  mkdirSync(join(unitDirectoryPath(UNIT), 'documents'), { recursive: true })
  writeFileSync(path, '{"version":2,"record":{}}', 'utf8')
  return path
}

beforeEach(() => {
  saved = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'dsh-task-board-data-root-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  if (saved === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = saved
  rmSync(home, { recursive: true, force: true })
})

describe('harness home discovery', () => {
  it('uses DSH_HOME when it is set to something', () => {
    expect(harnessHome()).toBe(home)
    expect(storagesRoot()).toBe(join(home, 'storages'))
    expect(unitDirectoryPath(UNIT)).toBe(join(home, 'storages', UNIT))
  })

  it('treats a blank DSH_HOME as unset, exactly as the host does', () => {
    process.env.DSH_HOME = '   '
    expect(harnessHome()).not.toBe('   ')
    expect(harnessHome().endsWith(join('.dsh'))).toBe(true)
  })
})

describe('retireLegacyUnitFile', () => {
  const retire = async (now = T0) => retireLegacyUnitFile({
    unitName: UNIT,
    legacyVersion: 1,
    migratedPath: join(unitDirectoryPath(UNIT), 'documents', 'board.json'),
    now,
    log: () => undefined,
  })

  it('moves the old file aside once the data has landed, keeping every byte', async () => {
    mkdirSync(storagesRoot(), { recursive: true })
    const legacy = writeLegacy({ name: UNIT, version: 1 })
    const before = readFileSync(legacy, 'utf8')
    writeMigrated()
    const outcome = await retire()
    expect(outcome.status).toBe('retired')
    expect(existsSync(legacy)).toBe(false)
    // Moved, NOT deleted: the bytes are the migration's own backup, and the
    // new name does not end in `.json`, so neither the hub nor a later boot
    // ever reads it again.
    expect(outcome.retiredPath).toBeDefined()
    expect(readFileSync(outcome.retiredPath as string, 'utf8')).toBe(before)
  })

  it('refuses to move the file before the data has landed, and leaves it alone', async () => {
    mkdirSync(storagesRoot(), { recursive: true })
    const legacy = writeLegacy({ name: UNIT, version: 1 })
    const outcome = await retire()
    expect(outcome.status).toBe('target-missing')
    expect(existsSync(legacy)).toBe(true)
  })

  it('reports absent when there is no old file (every boot after the first)', async () => {
    mkdirSync(storagesRoot(), { recursive: true })
    writeMigrated()
    const outcome = await retire()
    expect(outcome.status).toBe('absent')
    expect(outcome.retiredPath).toBeUndefined()
  })

  it('leaves a file that is not this unit document untouched', async () => {
    mkdirSync(storagesRoot(), { recursive: true })
    writeMigrated()
    for (const header of [
      { name: 'someone_else', version: 1 },
      { name: UNIT, version: 99 },
      { version: 1 },
    ]) {
      const legacy = writeLegacy(header)
      const outcome = await retire()
      expect(outcome.status).toBe('foreign')
      expect(existsSync(legacy)).toBe(true)
    }
  })

  it('leaves an unparseable file untouched', async () => {
    mkdirSync(storagesRoot(), { recursive: true })
    writeMigrated()
    const legacy = join(storagesRoot(), `${UNIT}.json`)
    writeFileSync(legacy, 'not json at all', 'utf8')
    expect((await retire()).status).toBe('foreign')
    expect(readFileSync(legacy, 'utf8')).toBe('not json at all')
  })

  it('refuses to overwrite a retired copy from an earlier run', async () => {
    mkdirSync(storagesRoot(), { recursive: true })
    const legacy = writeLegacy({ name: UNIT, version: 1 })
    writeMigrated()
    const first = await retire()
    expect(first.status).toBe('retired')
    // The same clock twice (a same-second re-run): the destination is taken,
    // so the new legacy file stays rather than clobbering the old backup.
    writeFileSync(legacy, '{"unit":{"name":"dsh_task_board","version":1},"global":{},"tables":{}}', 'utf8')
    expect((await retire()).status).toBe('taken')
    expect(existsSync(legacy)).toBe(true)
    expect(existsSync(first.retiredPath as string)).toBe(true)
  })
})
