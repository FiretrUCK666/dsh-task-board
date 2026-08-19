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
import type { TaskRecord } from './tasks.ts'

/** One label in the board catalog. */
export interface Tag {
  id: string
  /** Display name (zh-first copy handled by the UI, not stored here). */
  name: string
  /** Effect color (a hex string the user picked; applied as data). */
  color: string
}

/** The board's label catalog (immutable arrays — changes return new copies). */
export type TagCatalog = readonly Tag[]

/** LocalStorage key for the board's tag catalog. */
export const TAG_STORAGE_KEY = 'dsh.taskBoard.tags.v1'

/** Curated preset palette (10 hues, clear on light and dark). Data, not CSS. */
export const TAG_PALETTE: readonly string[] = [
  '#e5484d', '#f76b15', '#f5a524', '#f2cd35', '#30a46c',
  '#12a594', '#3e63dd', '#6e56cf', '#ab4aba', '#e93d82',
]

/** Brand an unknown value as a valid tag row (persisted-state guard). */
export function isTag(value: unknown): value is Tag {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && row.id !== ''
    && typeof row.name === 'string' && typeof row.color === 'string'
}

/** Parse + validate a persisted catalog (invalid rows dropped). */
export function normalizeCatalog(raw: unknown): Tag[] {
  if (!Array.isArray(raw)) return []
  const out: Tag[] = []
  const seen = new Set<string>()
  for (const row of raw) {
    if (!isTag(row) || seen.has(row.id)) continue
    seen.add(row.id)
    out.push({ id: row.id, name: row.name, color: row.color })
  }
  return out
}

/** Look a tag up by id (undefined when unknown). */
export function tagById(catalog: TagCatalog, id: string): Tag | undefined {
  return catalog.find(tag => tag.id === id)
}

/** Append a new tag (immutable) to the catalog. */
export function createTag(catalog: TagCatalog, tag: Tag): TagCatalog {
  return [...catalog, tag]
}

/** Rename a tag; returns the same catalog reference when the id is unknown. */
export function renameTag(catalog: TagCatalog, id: string, name: string): TagCatalog {
  return catalog.map(tag => tag.id === id ? { ...tag, name } : tag)
}

/** Re-color a tag; returns the same catalog reference when the id is unknown. */
export function recolorTag(catalog: TagCatalog, id: string, color: string): TagCatalog {
  return catalog.map(tag => tag.id === id ? { ...tag, color } : tag)
}

/** Remove a tag from the catalog (the caller strips it from every task too). */
export function removeTag(catalog: TagCatalog, id: string): TagCatalog {
  return catalog.filter(tag => tag.id !== id)
}

/** Attach a task's tag-id set (immutable); invalid/unknown ids are kept as-is
 *  for the UI to resolve, unknown ones simply never render. */
export function withTaskTags(task: TaskRecord, tags: string[]): TaskRecord {
  return { ...task, tags }
}

/** Set (or clear, with undefined) a task's card accent color. */
export function withTaskColor(task: TaskRecord, color: string | undefined): TaskRecord {
  return color === undefined
    ? { ...task, ...('color' in task ? { color: undefined } : {}) }
    : { ...task, color }
}

/** Whether a task matches a multi-tag AND filter: every selected tag id is
 *  present on the task. An empty selection matches everything. */
export function taskMatchesTags(task: TaskRecord, selected: ReadonlyArray<string>): boolean {
  if (selected.length === 0) return true
  const owned = new Set(task.tags ?? [])
  return selected.every(id => owned.has(id))
}
