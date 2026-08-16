/**
 * Schedule presets: the built-in default list plus user customization,
 * persisted separately from the task ledger (localStorage
 * `dsh.taskBoard.presets.v1`). Framework-free and unit-testable.
 */

/** One schedule preset: a named cron expression for the quick-pick dropdown. */
export interface SchedulePreset {
  /** Stable preset id (uuid for custom entries). */
  id: string
  /** Human label shown in the preset dropdown and manager. */
  label: string
  /** 5-field cron expression. */
  cron: string
}

/** Storage key for the user's preset overrides. */
export const DEFAULT_PRESET_STORAGE_KEY = 'dsh.taskBoard.presets.v1'

/** The built-in preset list (never persisted; always resettable to). */
export const DEFAULT_PRESETS: readonly SchedulePreset[] = [
  // 常用频率 / frequency
  { id: 'every-5min', label: '每 5 分钟', cron: '*/5 * * * *' },
  { id: 'every-10min', label: '每 10 分钟', cron: '*/10 * * * *' },
  { id: 'every-15min', label: '每 15 分钟', cron: '*/15 * * * *' },
  { id: 'every-30min', label: '每 30 分钟', cron: '*/30 * * * *' },
  { id: 'hourly', label: '每小时', cron: '0 * * * *' },
  { id: 'every-2hours', label: '每 2 小时', cron: '0 */2 * * *' },
  // 每天 / daily
  { id: 'daily-00', label: '每天 00:00', cron: '0 0 * * *' },
  { id: 'daily-08', label: '每天 08:00', cron: '0 8 * * *' },
  { id: 'daily-09', label: '每天 09:00', cron: '0 9 * * *' },
  { id: 'daily-12', label: '每天 12:00', cron: '0 12 * * *' },
  { id: 'daily-14', label: '每天 14:00', cron: '0 14 * * *' },
  { id: 'daily-18', label: '每天 18:00', cron: '0 18 * * *' },
  { id: 'daily-20', label: '每天 20:00', cron: '0 20 * * *' },
  { id: 'daily-22', label: '每天 22:00', cron: '0 22 * * *' },
  // 每周 / weekly
  { id: 'weekly-mon9', label: '每周一 09:00', cron: '0 9 * * 1' },
  { id: 'weekly-workdays9', label: '工作日 09:00', cron: '0 9 * * 1-5' },
  { id: 'weekly-sun0', label: '每周日 00:00', cron: '0 0 * * 0' },
  // 每月 / monthly
  { id: 'monthly-1', label: '每月 1 号 09:00', cron: '0 9 1 * *' },
  { id: 'monthly-15', label: '每月 15 号 09:00', cron: '0 9 15 * *' },
]

/** Persistence seam for preset overrides. */
export interface PresetStore {
  /** Read the persisted overrides ([] when nothing is stored). */
  load(): SchedulePreset[]
  /** Persist the whole override list (replaces the stored document). */
  save(presets: readonly SchedulePreset[]): void
  /** Drop the persisted overrides. */
  clear(): void
}

/** Structural row check: an override must carry id/label/cron strings. */
function isPresetShape(value: unknown): value is SchedulePreset {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && row.id !== ''
    && typeof row.label === 'string'
    && typeof row.cron === 'string' && row.cron !== ''
}

/** Parse + validate the persisted override document; invalid rows are dropped. */
export function parsePresets(raw: string | null): SchedulePreset[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.error('[dsh-task-board] persisted schedule presets are not valid JSON; starting with defaults', error)
    return []
  }
  if (!Array.isArray(parsed)) {
    console.error('[dsh-task-board] persisted schedule presets are not an array; starting with defaults')
    return []
  }
  return parsed.filter(isPresetShape)
}

/** Merge the built-ins with user overrides: custom ids replace the built-in of the same id. */
export function mergePresets(defaults: readonly SchedulePreset[], custom: readonly SchedulePreset[]): SchedulePreset[] {
  const overridden = new Set(custom.map(preset => preset.id))
  return [
    ...defaults.filter(preset => !overridden.has(preset.id)),
    ...custom,
  ]
}

/** Append a preset (returns the new list). */
export function addPreset(presets: readonly SchedulePreset[], preset: SchedulePreset): SchedulePreset[] {
  return [...presets, preset]
}

/** Replace one preset by id (returns the same list when the id is absent). */
export function updatePreset(presets: readonly SchedulePreset[], preset: SchedulePreset): SchedulePreset[] {
  return presets.map(candidate => candidate.id === preset.id ? preset : candidate)
}

/** Remove one preset by id (returns the same list when the id is absent). */
export function removePreset(presets: readonly SchedulePreset[], id: string): SchedulePreset[] {
  return presets.filter(preset => preset.id !== id)
}

/** localStorage-backed preset store (the browser backend). */
export class LocalStoragePresetStore implements PresetStore {
  /**
   * @param key - storage key for the override document.
   * @param storage - storage backend (defaults to the global localStorage; tests inject fakes).
   */
  constructor(
    private readonly key: string = DEFAULT_PRESET_STORAGE_KEY,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = globalThis.localStorage,
  ) {}

  load(): SchedulePreset[] {
    if (this.storage === undefined) return []
    try {
      return parsePresets(this.storage.getItem(this.key))
    } catch (error) {
      console.error('[dsh-task-board] preset overrides read failed; starting with defaults', error)
      return []
    }
  }

  save(presets: readonly SchedulePreset[]): void {
    if (this.storage === undefined) return
    try {
      this.storage.setItem(this.key, JSON.stringify(presets))
    } catch (error) {
      console.error('[dsh-task-board] preset overrides write failed (persistence skipped)', error)
    }
  }

  clear(): void {
    if (this.storage === undefined) return
    try {
      this.storage.removeItem(this.key)
    } catch (error) {
      console.error('[dsh-task-board] preset overrides clear failed', error)
    }
  }
}

/** In-memory backend (tests). */
export class InMemoryPresetStore implements PresetStore {
  private overrides: SchedulePreset[] = []

  load(): SchedulePreset[] {
    return [...this.overrides]
  }

  save(presets: readonly SchedulePreset[]): void {
    this.overrides = [...presets]
  }

  clear(): void {
    this.overrides = []
  }
}
