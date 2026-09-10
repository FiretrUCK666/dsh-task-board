/**
 * Schedule presets: the built-in default list plus user customization,
 * persisted separately from the task ledger (localStorage
 * `dsh.taskBoard.presets.v1`). Framework-free and unit-testable.
 */
/** One schedule preset: a named cron expression for the quick-pick dropdown. */
export interface SchedulePreset {
    /** Stable preset id (uuid for custom entries). */
    id: string;
    /** Human label shown in the preset dropdown and manager. */
    label: string;
    /** 5-field cron expression. */
    cron: string;
}
/** Storage key for the user's preset overrides. */
export declare const DEFAULT_PRESET_STORAGE_KEY = "dsh.taskBoard.presets.v1";
/** The built-in preset list (never persisted; always resettable to). */
export declare const DEFAULT_PRESETS: readonly SchedulePreset[];
/** Persistence seam for preset overrides. */
export interface PresetStore {
    /** Read the persisted overrides ([] when nothing is stored). */
    load(): SchedulePreset[];
    /** Persist the whole override list (replaces the stored document). */
    save(presets: readonly SchedulePreset[]): void;
    /** Drop the persisted overrides. */
    clear(): void;
}
/** Parse + validate the persisted override document; invalid rows are dropped. */
export declare function parsePresets(raw: string | null): SchedulePreset[];
/** Merge the built-ins with user overrides: custom ids replace the built-in of the same id. */
export declare function mergePresets(defaults: readonly SchedulePreset[], custom: readonly SchedulePreset[]): SchedulePreset[];
/** localStorage-backed preset store (the browser backend). */
export declare class LocalStoragePresetStore implements PresetStore {
    private readonly key;
    private readonly storage;
    /**
     * @param key - storage key for the override document.
     * @param storage - storage backend (defaults to the global localStorage; tests inject fakes).
     */
    constructor(key?: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined);
    load(): SchedulePreset[];
    save(presets: readonly SchedulePreset[]): void;
    clear(): void;
}
/** In-memory backend (tests). */
export declare class InMemoryPresetStore implements PresetStore {
    private overrides;
    load(): SchedulePreset[];
    save(presets: readonly SchedulePreset[]): void;
    clear(): void;
}
