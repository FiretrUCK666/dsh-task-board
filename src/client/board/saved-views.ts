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
  id: string
  name: string
  filter: string
}

/** Device-local key (stable forever — views must survive upgrades). */
export const VIEWS_STORAGE_KEY = 'dsh.taskBoard.views.v1'

/** Cap: twenty named views (generous for personal use; shared boards cap
 *  higher through a different mechanism if sharing ever lands). */
export const MAX_SAVED_VIEWS = 20

/** Minimal storage face (localStorage satisfies it structurally; tests fake it). */
export interface ViewStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function deviceStorage(): ViewStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}

/** Whether a parsed row is a usable view (non-blank name and filter). */
function isView(row: unknown): row is SavedView {
  if (typeof row !== 'object' || row === null) return false
  const candidate = row as Record<string, unknown>
  return typeof candidate.id === 'string' && candidate.id !== ''
    && typeof candidate.name === 'string' && candidate.name.trim() !== ''
    && typeof candidate.filter === 'string' && candidate.filter.trim() !== ''
}

/** Load the saved views, newest first (malformed rows drop silently). */
export function loadViews(store: ViewStorage | undefined = deviceStorage()): SavedView[] {
  if (store === undefined) return []
  let parsed: unknown
  try {
    const raw = store.getItem(VIEWS_STORAGE_KEY)
    if (raw === null) return []
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter(isView).slice(0, MAX_SAVED_VIEWS)
}

function persist(store: ViewStorage, views: SavedView[]): void {
  try {
    store.setItem(VIEWS_STORAGE_KEY, JSON.stringify(views))
  } catch {
    // Private mode / quota: the views still work for the session.
  }
}

/** Save the current filter under a name (newest first). Blank names, blank
 *  filters and a full shelf leave the list untouched (the caller disables
 *  the button; this is the backstop, not the UX). Returns the new list. */
export function saveView(
  name: string,
  filter: string,
  store: ViewStorage | undefined = deviceStorage(),
  id: string = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
): SavedView[] {
  const views = loadViews(store)
  if (store === undefined) return views
  if (name.trim() === '' || filter.trim() === '') return views
  if (views.length >= MAX_SAVED_VIEWS) return views
  const next = [{ id, name: name.trim(), filter }, ...views]
  persist(store, next)
  return next
}

/** Delete one view by id (unknown ids are ignored). Returns the new list. */
export function deleteView(
  id: string,
  store: ViewStorage | undefined = deviceStorage(),
): SavedView[] {
  const views = loadViews(store)
  if (store === undefined) return views
  const next = views.filter(view => view.id !== id)
  if (next.length !== views.length) persist(store, next)
  return next
}
