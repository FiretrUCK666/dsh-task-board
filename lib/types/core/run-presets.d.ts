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
    workspaceId?: string;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    agentPreset?: string;
    permission?: string;
}
/** One named preset: a (partial) run configuration. */
export interface RunConfigPreset {
    /** Stable id (uuid for custom entries). */
    id: string;
    /** Human label shown in the select and manager. */
    name: string;
    config: RunConfigPresetConfig;
}
/** The persisted document: custom presets + which one is the default. */
export interface RunPresetsDocument {
    presets: RunConfigPreset[];
    defaultId?: string;
}
/** Storage key for the user's run-config preset overrides. */
export declare const RUN_PRESETS_STORAGE_KEY = "dsh.taskBoard.runPresets.v1";
/** The built-in preset id: an empty config = the deployment's own defaults. */
export declare const DEPLOY_DEFAULT_PRESET_ID = "deploy-default";
/** The built-in preset (empty config, never persisted, never deletable). */
export declare const DEPLOY_DEFAULT_PRESET: RunConfigPreset;
/** Persistence seam for run-config presets. */
export interface RunPresetStore {
    /** Read the persisted document (the built-in fallback when corrupt). */
    load(): RunPresetsDocument;
    /** Persist the whole document (replaces the stored one). */
    save(doc: RunPresetsDocument): void;
    /** Drop the persisted document. */
    clear(): void;
}
/** Normalize a raw row list: valid custom presets only, duplicates dropped. */
export declare function normalizeRunPresets(value: unknown): RunConfigPreset[];
/** Normalize a whole persisted document (corrupt → built-in only). */
export declare function normalizeRunPresetDocument(value: unknown): RunPresetsDocument;
/** The merged list a UI shows: 部署默认 first, then the custom presets. */
export declare function mergedRunPresets(doc: RunPresetsDocument): RunConfigPreset[];
/** Find a preset by id (built-in or custom); undefined when it does not exist. */
export declare function findRunPreset(doc: RunPresetsDocument, id: string): RunConfigPreset | undefined;
/** THE default resolution: a valid defaultId (that exists) wins; anything
 *  else — never set, dangling, deleted — falls back to 部署默认. */
export declare function defaultRunPresetOf(doc: RunPresetsDocument): RunConfigPreset;
/**
 * The localStorage-backed store. Reads/writes degrade exactly like the
 * schedule-preset store: a throwing or corrupt read yields the built-in
 * document, a throwing write is skipped (persistence loss, never a crash).
 */
export declare class LocalStorageRunPresetStore implements RunPresetStore {
    private readonly storage;
    private readonly key;
    constructor(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key?: string);
    load(): RunPresetsDocument;
    save(doc: RunPresetsDocument): void;
    clear(): void;
}
