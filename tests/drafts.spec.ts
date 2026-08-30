/**
 * Draft persistence (drafts.ts): key construction, the localStorage backend
 * (round-trip, empty-string-is-clear, corrupt-document degradation, write
 * failure never throwing) and the in-memory reference backend.
 */
import { describe, expect, it } from 'vitest'
import {
  DRAFT_STORAGE_KEY,
  commentDraftKey,
  editDraftKey,
  newSessionDraftKey,
  ruleDraftKey,
  NEW_TASK_DRAFT_KEY,
  refineDraftKey,
  InMemoryDraftStore,
  LocalStorageDraftStore,
} from '../src/client/board/drafts.ts'

/** A tiny Storage triple backed by a plain map (with optional write failure). */
function fakeBackend(failWrites = false) {
  const map: Record<string, string> = {}
  const storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
    getItem: key => (key in map ? map[key] : null),
    setItem: (key, value) => {
      if (failWrites) throw new Error('quota exceeded')
      map[key] = value
    },
    removeItem: key => { delete map[key] },
  }
  return { storage, map }
}

describe('draft key construction', () => {
  it('keeps identifiers stable and namespaced per surface', () => {
    expect(commentDraftKey('t-1', 's-9')).toBe('comment:t-1:s-9')
    expect(editDraftKey('t-1')).toBe('edit:t-1')
    expect(refineDraftKey('t-1')).toBe('refine:t-1')
    expect(NEW_TASK_DRAFT_KEY).toBe('new')
    // The surfaces added late: the new-session dialog (title + config) and the
    // add-mode rule form. An existing rule NEVER has a draft slot in play —
    // its saved instruction is the truth (hence the literal 'new' key usage).
    expect(newSessionDraftKey('t-1')).toBe('newsession:t-1')
    expect(ruleDraftKey('t-1', 'new')).toBe('rule:t-1:new')
    expect(DRAFT_STORAGE_KEY).toBe('dsh.taskBoard.drafts.v1')
  })
})

describe('LocalStorageDraftStore', () => {
  it('round-trips a draft and clears it', () => {
    const { storage } = fakeBackend()
    const store = new LocalStorageDraftStore('drafts', storage)
    expect(store.get('comment:t-1:s-9')).toBeUndefined()
    store.set('comment:t-1:s-9', '一半的字')
    expect(store.get('comment:t-1:s-9')).toBe('一半的字')
    store.clear('comment:t-1:s-9')
    expect(store.get('comment:t-1:s-9')).toBeUndefined()
  })

  it('treats an empty-string write as a clear', () => {
    const { storage } = fakeBackend()
    const store = new LocalStorageDraftStore('drafts', storage)
    store.set('edit:t-1', '{"title":"x"}')
    store.set('edit:t-1', '')
    expect(store.get('edit:t-1')).toBeUndefined()
  })

  it('degrades on a corrupt document without throwing', () => {
    const { storage } = fakeBackend()
    storage.setItem('drafts', 'not json')
    const store = new LocalStorageDraftStore('drafts', storage)
    expect(store.get('edit:t-1')).toBeUndefined()
    expect(() => store.set('edit:t-1', 'x')).not.toThrow()
  })

  it('drops non-string values and recovers the string rows', () => {
    const { storage } = fakeBackend()
    storage.setItem('drafts', JSON.stringify({ keep: 'text', drop: 3, drop2: null }))
    const store = new LocalStorageDraftStore('drafts', storage)
    expect(store.get('keep')).toBe('text')
    expect(store.get('drop')).toBeUndefined()
  })

  it('never throws on a write failure (quota/private mode)', () => {
    const { storage } = fakeBackend(true)
    const store = new LocalStorageDraftStore('drafts', storage)
    expect(() => store.set('comment:t-1:s-9', 'x')).not.toThrow()
    expect(() => store.clear('comment:t-1:s-9')).not.toThrow()
  })
})

describe('InMemoryDraftStore', () => {
  it('matches the same semantics (set/get/clear, empty clears)', () => {
    const store = new InMemoryDraftStore()
    store.set('refine:t-2', '回答…')
    expect(store.get('refine:t-2')).toBe('回答…')
    store.set('refine:t-2', '')
    expect(store.get('refine:t-2')).toBeUndefined()
    store.set('a', '1')
    store.set('b', '2')
    store.clear('a')
    expect(store.get('a')).toBeUndefined()
    expect(store.get('b')).toBe('2')
  })
})
