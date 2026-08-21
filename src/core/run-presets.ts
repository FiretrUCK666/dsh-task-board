/**
 * Run-config presets: named run configurations (the workspace / provider /
 * model / effort / agent-preset / permission set of a task card) that the
 * task form picks from. User-customizable — add / edit / delete your own,
 * and mark ANY preset (including the built-in one) as the DEFAULT applied
 * when creating a new task. Framework-free and unit-testable.
 *
 * The fallback chain is the whole point: the built-in 部署默认 preset is an
 * EMPTY config (every field follows the deployment's native defaults) and is
 * never deletable. A missing or dangling defaultId — never created any
 * preset, deleted the preset that was the default, corrupt storage — always
 * resolves to 部署默认 (the previous behavior), so there is no broken state
 * and no migration: the old default IS the deployment default.
 */

/** The run-config fields a preset may pin (the task card's own keys). */
export interface RunConfigPresetConfig {
  workspaceId?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  agentPreset?: string
  permission?: string
}

/** One named preset: a (partial) run configuration. */
export interface RunConfigPreset {
  /** Stable id (uuid for custom entries). */
  id: string
  /** Human label shown in the select and manager. */
  name: string
  config: RunConfigPresetConfig
}

/** The persisted document: custom presets + which one is the default. */
export interface RunPresetsDocument {
  presets: RunConfigPreset[]
  defaultId?: string
}

/** Storage key for the user's run-config preset overrides. */
export const RUN_PRESETS_STORAGE_KEY = 'dsh.taskBoard.runPresets.v1'

/** The built-in preset id: an empty config = the deployment's own defaults. */
export const DEPLOY_DEFAULT_PRESET_ID = 'deploy-default'

/** The built-in preset (empty config, never persisted, never deletable). */
export const DEPLOY_DEFAULT_PRESET: RunConfigPreset = {
  id: DEPLOY_DEFAULT_PRESET_ID,
  name: '部署默认',
  config: {},
}

/** The six run-config keys a preset may carry (unknown keys are stripped). */
const CONFIG_KEYS = ['workspaceId', 'provider', 'model', 'reasoningEffort', 'agentPreset', 'permission'] as const

/** Persistence seam for run-config presets. */
export interface RunPresetStore {
  /** Read the persisted document (the built-in fallback when corrupt). */
  load(): RunPresetsDocument
  /** Persist the whole document (replaces the stored one). */
  save(doc: RunPresetsDocument): void
  /** Drop the persisted document. */
  clear(): void
}

/** Structural row check: non-empty id/name strings + a clean config object. */
function isPresetShape(value: unknown): value is RunConfigPreset {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || row.id === '') return false
  if (typeof row.name !== 'string' || row.name === '') return false
  if (row.id === DEPLOY_DEFAULT_PRESET_ID) return false
  return typeof row.config === 'object' && row.config !== null
}

/** Keep only the known config keys with string values. */
function cleanConfig(value: unknown): RunConfigPresetConfig {
  if (typeof value !== 'object' || value === null) return {}
  const source = value as Record<string, unknown>
  const cleaned: RunConfigPresetConfig = {}
  for (const key of CONFIG_KEYS) {
    const entry = source[key]
    if (typeof entry === 'string') cleaned[key] = entry
  }
  return cleaned
}

/** Normalize a raw row list: valid custom presets only, duplicates dropped. */
export function normalizeRunPresets(value: unknown): RunConfigPreset[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const rows: RunConfigPreset[] = []
  for (const entry of value) {
    if (!isPresetShape(entry)) continue
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    rows.push({ id: entry.id, name: entry.name, config: cleanConfig(entry.config) })
  }
  return rows
}

/** Normalize a whole persisted document (corrupt → built-in only). */
export function normalizeRunPresetDocument(value: unknown): RunPresetsDocument {
  if (typeof value !== 'object' || value === null) return { presets: [] }
  const row = value as Record<string, unknown>
  const presets = normalizeRunPresets(row.presets)
  const defaultId = typeof row.defaultId === 'string' && row.defaultId !== '' ? row.defaultId : undefined
  return { presets, ...defaultId !== undefined ? { defaultId } : {} }
}

/** The merged list a UI shows: 部署默认 first, then the custom presets. */
export function mergedRunPresets(doc: RunPresetsDocument): RunConfigPreset[] {
  return [DEPLOY_DEFAULT_PRESET, ...doc.presets]
}

/** Find a preset by id (built-in or custom); undefined when it does not exist. */
export function findRunPreset(doc: RunPresetsDocument, id: string): RunConfigPreset | undefined {
  return mergedRunPresets(doc).find(preset => preset.id === id)
}

/** THE default resolution: a valid defaultId (that exists) wins; anything
 *  else — never set, dangling, deleted — falls back to 部署默认. */
export function defaultRunPresetOf(doc: RunPresetsDocument): RunConfigPreset {
  const chosen = doc.defaultId !== undefined ? findRunPreset(doc, doc.defaultId) : undefined
  return chosen ?? DEPLOY_DEFAULT_PRESET
}

/**
 * The localStorage-backed store. Reads/writes degrade exactly like the
 * schedule-preset store: a throwing or corrupt read yields the built-in
 * document, a throwing write is skipped (persistence loss, never a crash).
 */
export class LocalStorageRunPresetStore implements RunPresetStore {
  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage,
    private readonly key: string = RUN_PRESETS_STORAGE_KEY,
  ) {}

  load(): RunPresetsDocument {
    try {
      const raw = this.storage.getItem(this.key)
      if (raw === null) return { presets: [] }
      return normalizeRunPresetDocument(JSON.parse(raw))
    } catch {
      return { presets: [] }
    }
  }

  save(doc: RunPresetsDocument): void {
    try {
      this.storage.setItem(this.key, JSON.stringify(doc))
    } catch {
      // Persistence skipped (quota/sandbox) — the in-memory document still works.
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(this.key)
    } catch {
      // Nothing to do.
    }
  }
}
