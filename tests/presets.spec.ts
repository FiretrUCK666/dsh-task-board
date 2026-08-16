/**
 * Schedule preset tests: the built-in defaults, override merge, and the
 * localStorage-backed store's persistence and corruption tolerance.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRESETS, InMemoryPresetStore, LocalStoragePresetStore,
  addPreset, mergePresets, parsePresets, removePreset, updatePreset,
  type SchedulePreset,
} from '../src/core/presets.ts'

const CUSTOM: SchedulePreset = { id: 'my-preset', label: '我的预设', cron: '0 13 * * 3' }

function fakeStorage(): { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void } {
  const data = new Map<string, string>()
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value) },
    removeItem: key => { data.delete(key) },
  }
}

describe('DEFAULT_PRESETS', () => {
  it('contains 19 valid, unique presets', () => {
    expect(DEFAULT_PRESETS).toHaveLength(19)
    const ids = new Set(DEFAULT_PRESETS.map(preset => preset.id))
    expect(ids.size).toBe(DEFAULT_PRESETS.length)
    for (const preset of DEFAULT_PRESETS) {
      expect(preset.label).not.toBe('')
      expect(preset.cron.split(/\s+/)).toHaveLength(5)
    }
  })
})

describe('mergePresets / add / update / remove', () => {
  it('appends custom presets after the defaults', () => {
    const merged = mergePresets(DEFAULT_PRESETS, [CUSTOM])
    expect(merged).toHaveLength(DEFAULT_PRESETS.length + 1)
    expect(merged[merged.length - 1]).toEqual(CUSTOM)
  })

  it('custom presets replace a built-in with the same id', () => {
    const replacement = { id: 'hourly', label: '每小时（自定义）', cron: '0 13 * * *' }
    const merged = mergePresets(DEFAULT_PRESETS, [replacement])
    expect(merged).toHaveLength(DEFAULT_PRESETS.length)
    expect(merged.find(preset => preset.id === 'hourly')).toEqual(replacement)
  })

  it('add / update / remove mutate the list functionally', () => {
    const added = addPreset([], CUSTOM)
    expect(added).toEqual([CUSTOM])
    const edited = updatePreset(added, { ...CUSTOM, label: '改名' })
    expect(edited[0].label).toBe('改名')
    expect(removePreset(edited, CUSTOM.id)).toEqual([])
    expect(removePreset([], 'missing')).toEqual([])
  })
})

describe('parsePresets', () => {
  it('returns [] for null, invalid JSON, and non-array documents', () => {
    expect(parsePresets(null)).toEqual([])
    expect(parsePresets('not json')).toEqual([])
    expect(parsePresets('{}')).toEqual([])
  })

  it('drops invalid rows and keeps valid ones', () => {
    const raw = JSON.stringify([
      CUSTOM,
      { id: '', label: 'x', cron: '0 9 * * *' },
      null,
      'nope',
    ])
    expect(parsePresets(raw)).toEqual([CUSTOM])
  })
})

describe('LocalStoragePresetStore', () => {
  it('round-trips overrides through storage', () => {
    const store = new LocalStoragePresetStore('test-key', fakeStorage())
    expect(store.load()).toEqual([])
    store.save([CUSTOM])
    expect(store.load()).toEqual([CUSTOM])
    store.clear()
    expect(store.load()).toEqual([])
  })

  it('tolerates throwing storage reads/writes', () => {
    const throwing = {
      getItem: (): string | null => { throw new Error('quota') },
      setItem: (): void => { throw new Error('quota') },
      removeItem: (): void => { throw new Error('quota') },
    }
    const store = new LocalStoragePresetStore('test-key', throwing)
    expect(store.load()).toEqual([])
    expect(() => store.save([CUSTOM])).not.toThrow()
  })
})

describe('InMemoryPresetStore', () => {
  it('loads copies of the saved list', () => {
    const store = new InMemoryPresetStore()
    store.save([CUSTOM])
    expect(store.load()).toEqual([CUSTOM])
    store.clear()
    expect(store.load()).toEqual([])
  })
})
