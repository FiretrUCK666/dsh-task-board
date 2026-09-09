/**
 * Saved filter views (client/board/saved-views.ts): personal device-local
 * named filters — malformed rows drop on read, blanks and a full shelf leave
 * the list untouched, deletes are idempotent.
 */
import { describe, expect, it } from 'vitest'
import {
  deleteView,
  loadViews,
  MAX_SAVED_VIEWS,
  saveView,
  VIEWS_STORAGE_KEY,
  type SavedView,
  type ViewStorage,
} from '../src/client/board/saved-views.ts'

function fakeStore(initial: Record<string, string> = {}): ViewStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = value },
  }
}

function view(id: string, name = `v-${id}`, filter = 'has:auto'): SavedView {
  return { id, name, filter }
}

describe('loadViews', () => {
  it('reads an empty shelf as empty', () => {
    expect(loadViews(fakeStore())).toEqual([])
    expect(loadViews(undefined)).toEqual([])
  })

  it('drops malformed rows, dedupes ids first-wins and caps the shelf', () => {
    const rows = [
      view('a'),
      { id: '', name: 'blank-id', filter: 'x' },
      { id: 'b', name: '  ', filter: 'x' },
      { id: 'c', name: 'n', filter: '' },
      { id: 'a', name: 'dupe-id', filter: 'y' },
      'junk',
    ]
    const store = fakeStore({ [VIEWS_STORAGE_KEY]: JSON.stringify(rows) })
    expect(loadViews(store)).toEqual([view('a')])
    // Read-repair: the cleaned list is written back (the shelf heals).
    expect(JSON.parse(store.data[VIEWS_STORAGE_KEY])).toEqual([view('a')])
  })

  it('survives unparseable payloads', () => {
    expect(loadViews(fakeStore({ [VIEWS_STORAGE_KEY]: '{oops' }))).toEqual([])
    expect(loadViews(fakeStore({ [VIEWS_STORAGE_KEY]: '"just a string"' }))).toEqual([])
  })
})

describe('saveView', () => {
  it('prepends newest-first and persists', () => {
    const store = fakeStore()
    const outcome = saveView('mine', 'has:auto', store, 'id-1')
    expect(outcome.saved).toBe(true)
    expect(outcome.views).toEqual([view('id-1', 'mine', 'has:auto')])
    expect(loadViews(store)).toEqual(outcome.views)
  })

  it('trims the filter and suffixes duplicate names (template law)', () => {
    const store = fakeStore()
    saveView('mine', '  has:auto  ', store, 'id-1')
    const outcome = saveView('mine', 'x', store, 'id-2')
    expect(outcome.saved).toBe(true)
    expect(outcome.views.map(item => item.name)).toEqual(['mine 2', 'mine'])
    expect(outcome.views[1].filter).toBe('has:auto')
  })

  it('reports unsaved on blanks, full shelf or missing storage', () => {
    const store = fakeStore()
    expect(saveView('', 'has:auto', store, 'x')).toEqual({ views: [], saved: false })
    expect(saveView('n', '  ', store, 'x')).toEqual({ views: [], saved: false })
    expect(saveView('n', 'has:auto', undefined, 'x')).toEqual({ views: [], saved: false })
    expect(loadViews(store)).toEqual([])
    const full = fakeStore({
      [VIEWS_STORAGE_KEY]: JSON.stringify(
        Array.from({ length: MAX_SAVED_VIEWS }, (_, index) => view(`v${index}`)),
      ),
    })
    const outcome = saveView('one-more', 'x', full, 'new')
    expect(outcome.saved).toBe(false)
    expect(outcome.views).toHaveLength(MAX_SAVED_VIEWS)
  })
})

describe('deleteView', () => {
  it('removes by id and ignores unknown ids', () => {
    const store = fakeStore()
    saveView('a', 'x', store, 'a')
    saveView('b', 'y', store, 'b')
    expect(deleteView('a', store).map(item => item.id)).toEqual(['b'])
    expect(deleteView('nope', store).map(item => item.id)).toEqual(['b'])
    expect(loadViews(store).map(item => item.id)).toEqual(['b'])
  })
})
