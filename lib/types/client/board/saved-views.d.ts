/**
 * Saved filter views: named filter strings (qualifiers included) kept as
 * PERSONAL, device-local presets — the drafts-matrix precedent, not synced
 * state. Rationale: a view is one device's lens (phone vs. desk differ), and
 * syncing lenses would pollute other devices' boards; sharing comes later
 * through an explicit Share step, never by default. Zero migration, zero
 * merge grammar: the key is stable, malformed rows drop on read.
 */
/** One saved view: a name over a raw filter string. */
export interface SavedView {
    id: string;
    name: string;
    filter: string;
}
/** Device-local key (stable forever — views must survive upgrades). */
export declare const VIEWS_STORAGE_KEY = "dsh.taskBoard.views.v1";
/** Cap: twenty named views (generous for personal use; shared boards cap
 *  higher through a different mechanism if sharing ever lands). */
export declare const MAX_SAVED_VIEWS = 20;
/** Minimal storage face (localStorage satisfies it structurally; tests fake it). */
export interface ViewStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
/** Load the saved views, newest first: malformed rows drop, duplicate ids
 *  keep first-wins (template-library law), the shelf caps at the max. A load
 *  that repairs anything writes the cleaned list back (read-repair: a dirty
 *  shelf heals itself instead of rotting on disk). */
export declare function loadViews(store?: ViewStorage | undefined): SavedView[];
/** Save the current filter under a name (newest first). Blank names, blank
 *  filters and a full shelf leave the list untouched and report unsaved (the
 *  caller disables the button AND keeps the typed name — the store backstops
 *  it anyway). Duplicate names take a numeric suffix (template-library law:
 *  two rows never share a display name). Returns the outcome with the list. */
export declare function saveView(name: string, filter: string, store?: ViewStorage | undefined, id?: string): {
    views: SavedView[];
    saved: boolean;
};
/** Delete one view by id (unknown ids are ignored). Returns the new list. */
export declare function deleteView(id: string, store?: ViewStorage | undefined): SavedView[];
