/**
 * Tag system (v1): a board-level label catalog plus per-task card color.
 *
 * A tag is a named, colored label — Linear/Notion-style FREE classification,
 * deliberately distinct from status/priority (those stay their own columns/
 * automation lanes). The catalog stores name + color centrally, so renaming
 * or recoloring one tag updates every card that carries it: cards only hold
 * tag IDs, never duplicated text or hex. This is the "long-term zero
 * maintenance" shape the research recommended (Height fieldLabel / Linear
 * editable labels) — no drift, no scattered copies.
 *
 * The effect colors are DATA (applied through inline style, persisted as
 * user-picked values) — never CSS literals; the preset palette below is a
 * curated set of 10 hues chosen to read clearly on both light and dark.
 * Pure and framework-free so the whole catalog logic unit-tests in isolation.
 */
import type { TaskRecord } from './tasks.ts';
/** One label in the board catalog. */
export interface Tag {
    id: string;
    /** Display name (zh-first copy handled by the UI, not stored here). */
    name: string;
    /** Effect color (a hex string the user picked; applied as data). */
    color: string;
}
/** The board's label catalog (immutable arrays — changes return new copies). */
export type TagCatalog = readonly Tag[];
/** LocalStorage key for the board's tag catalog. */
export declare const TAG_STORAGE_KEY = "dsh.taskBoard.tags.v1";
/** Curated preset palette (10 hues, clear on light and dark). Data, not CSS. */
export declare const TAG_PALETTE: readonly string[];
/** Brand an unknown value as a valid tag row (persisted-state guard). */
export declare function isTag(value: unknown): value is Tag;
/** Parse + validate a persisted catalog (invalid rows dropped). */
export declare function normalizeCatalog(raw: unknown): Tag[];
/** Look a tag up by id (undefined when unknown). */
export declare function tagById(catalog: TagCatalog, id: string): Tag | undefined;
/** Append a new tag (immutable) to the catalog. */
export declare function createTag(catalog: TagCatalog, tag: Tag): TagCatalog;
/** Rename a tag; returns the same catalog reference when the id is unknown. */
export declare function renameTag(catalog: TagCatalog, id: string, name: string): TagCatalog;
/** Re-color a tag; returns the same catalog reference when the id is unknown. */
export declare function recolorTag(catalog: TagCatalog, id: string, color: string): TagCatalog;
/** Remove a tag from the catalog (the caller strips it from every task too). */
export declare function removeTag(catalog: TagCatalog, id: string): TagCatalog;
/** Attach a task's tag-id set (immutable); invalid/unknown ids are kept as-is
 *  for the UI to resolve, unknown ones simply never render. */
export declare function withTaskTags(task: TaskRecord, tags: string[]): TaskRecord;
/** Set (or clear, with undefined) a task's card accent color. */
export declare function withTaskColor(task: TaskRecord, color: string | undefined): TaskRecord;
/** Whether a task matches a multi-tag AND filter: every selected tag id is
 *  present on the task. An empty selection matches everything. */
export declare function taskMatchesTags(task: TaskRecord, selected: ReadonlyArray<string>): boolean;
