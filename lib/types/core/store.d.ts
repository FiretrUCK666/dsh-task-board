import type { TaskRecord } from './tasks.ts';
/** Persistence seam for the task ledger. */
export interface TaskStore {
    /** Read the persisted ledger (empty when nothing is stored yet). */
    load(): TaskRecord[];
    /** Persist the whole ledger (replaces the stored document). */
    save(tasks: readonly TaskRecord[]): void;
    /** Drop the persisted ledger (leaves the in-memory state alone). */
    clear(): void;
}
/** Storage key for the task ledger document. */
export declare const DEFAULT_STORAGE_KEY = "dsh.taskBoard.v1";
/** A task record is structurally valid if it round-trips through the UI. */
export declare function isTaskRecord(value: unknown): value is TaskRecord;
/** Parse + validate a persisted ledger document; invalid rows are dropped. */
export declare function parseLedger(raw: string | null): TaskRecord[];
/** localStorage-backed store (the browser backend). */
export declare class LocalStorageTaskStore implements TaskStore {
    private readonly key;
    private readonly storage;
    /**
     * @param key - storage key for the ledger document.
     * @param storage - storage backend (defaults to the global localStorage; tests inject fakes).
     */
    constructor(key?: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined);
    load(): TaskRecord[];
    save(tasks: readonly TaskRecord[]): void;
    clear(): void;
}
/** In-memory backend (tests, and a fallback when storage is unavailable). */
export declare class InMemoryTaskStore implements TaskStore {
    private ledger;
    load(): TaskRecord[];
    save(tasks: readonly TaskRecord[]): void;
    clear(): void;
}
