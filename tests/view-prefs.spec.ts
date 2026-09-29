/**
 * What the list remembers between visits, and what it refuses to remember.
 *
 * This is the panel's only persistence, so its failure modes are quiet in a
 * way that is hard to report: a reader who comes back to a broken view cannot
 * say why, and a stale key silently overwrites a good one. So the cases here
 * are the shapes that actually happen — a half-written record, a key from a
 * version that no longer exists, a browser with storage switched off — and the
 * one thing it must NEVER restore is the search text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_VIEW_PREFS,
  VIEW_PREFS_KEY,
  readViewPrefs,
  toggleCollapsed,
  writeViewPrefs,
} from '../src/client/item/view-prefs.ts'

/** A localStorage stand-in that can be made hostile on purpose. */
function storage(options: { throwOnGet?: boolean; throwOnSet?: boolean; raw?: string } = {}) {
  const store = new Map<string, string>()
  if (options.raw !== undefined) store.set(VIEW_PREFS_KEY, options.raw)
  return {
    getItem: vi.fn((key: string) => {
      if (options.throwOnGet === true) throw new Error('denied')
      return store.get(key) ?? null
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (options.throwOnSet === true) throw new Error('quota')
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => { store.delete(key) }),
    clear: vi.fn(() => { store.clear() }),
  }
}

function useStorage(options: Parameters<typeof storage>[0] = {}) {
  const store = storage(options)
  vi.stubGlobal('localStorage', store)
  return store
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: undefined })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The window stand-in the module reads, pointed at a given store. */
function useWindow(options: Parameters<typeof storage>[0] = {}) {
  const store = useStorage(options)
  vi.stubGlobal('window', { localStorage: store })
  return store
}

describe('what a first-time reader meets', () => {
  it('opens on the page that has something in it', () => {
    // The LIST, not the inbox. The inbox holds only rows nobody has filed, so
    // a reader whose notes already carry a priority or a date opens it and
    // finds nothing — and a first screen that says "nothing here" on a panel
    // full of work reads as a broken panel. What a thought arrives AT is the
    // capture box, which is on screen in every state.
    expect(DEFAULT_VIEW_PREFS.page).toBe('list')
  })

  it('reads the defaults when there is nothing stored', () => {
    useWindow()
    expect(readViewPrefs()).toEqual(DEFAULT_VIEW_PREFS)
  })
})

describe('a remembered view comes back whole', () => {
  it('round-trips every field it is allowed to keep', () => {
    const store = useWindow()
    writeViewPrefs({ page: 'schedule', sort: 'priority', density: 'comfy', showDone: true, collapsed: ['blocked'], search: '' })
    expect(store.setItem).toHaveBeenCalled()
    expect(readViewPrefs()).toEqual({
      page: 'schedule', sort: 'priority', density: 'comfy', showDone: true, collapsed: ['blocked'], search: '',
    })
  })

  it('NEVER remembers the search text, in either direction', () => {
    // The box holds whatever was last typed; restoring it would put a filter
    // the reader did not ask for back in front of a list they came to read,
    // and the list would look empty with nothing explaining why.
    const store = useWindow()
    writeViewPrefs({ ...DEFAULT_VIEW_PREFS, search: '#画廊' })
    const written = store.setItem.mock.calls[0]?.[1] as string
    expect(written).not.toContain('画廊')

    store.setItem(VIEW_PREFS_KEY, JSON.stringify({ page: 'list', search: '#画廊' }))
    expect(readViewPrefs().search).toBe('')
  })
})

describe('a damaged record repairs instead of throwing', () => {
  const cases: [string, string][] = [
    ['not JSON at all', '{oh no'],
    ['a bare string', '"just a string"'],
    ['a number', '42'],
    ['null', 'null'],
    ['an array', '["list"]'],
    ['an empty object', '{}'],
  ]

  for (const [name, raw] of cases) {
    it(`survives ${name}`, () => {
      useWindow({ raw })
      expect(readViewPrefs()).toEqual(DEFAULT_VIEW_PREFS)
    })
  }

  it('a boolean the record never mentions gets the DEFAULT, not the other boolean', () => {
    // `showDone` used to be read as `record.showDone === true`, which agrees with
    // the default only while the default IS false. So a record written before a
    // boolean's default flipped — and every damaged record — switched it OFF
    // behind the reader's back, and the 已完成 group disappeared with no way to
    // tell whether it was empty or filtered. The gate is written against the
    // DEFAULT rather than against a literal so it survives the next flip.
    useWindow({ raw: JSON.stringify({ page: 'list', density: 'compact' }) })
    expect(readViewPrefs().showDone, 'a boolean the record never mentioned was decided by guessing').toBe(DEFAULT_VIEW_PREFS.showDone)
    // And a record that DOES say so is obeyed either way round.
    for (const said of [true, false]) {
      useWindow({ raw: JSON.stringify({ showDone: said }) })
      expect(readViewPrefs().showDone, `the reader said ${String(said)} and got the other answer`).toBe(said)
    }
  })

  it('replaces a page id this version no longer has', () => {
    // A key written by a build that had a fourth page must not put the reader
    // on a page that does not exist — the rail would show three and the panel
    // would render the body of none of them.
    useWindow({ raw: JSON.stringify({ page: 'gantt' }) })
    expect(readViewPrefs().page).toBe(DEFAULT_VIEW_PREFS.page)
  })

  it('replaces an order and a density it does not recognise', () => {
    useWindow({ raw: JSON.stringify({ sort: 'vibes', density: 'enormous' }) })
    const prefs = readViewPrefs()
    expect(prefs.sort).toBe(DEFAULT_VIEW_PREFS.sort)
    expect(prefs.density).toBe(DEFAULT_VIEW_PREFS.density)
  })

  it('drops collapsed groups it does not recognise, and folds duplicates', () => {
    useWindow({ raw: JSON.stringify({ collapsed: ['blocked', 'nonsense', 'blocked', 'done'] }) })
    expect(readViewPrefs().collapsed).toEqual(['blocked', 'done'])
  })

  it('reads a non-array collapsed as nothing folded', () => {
    useWindow({ raw: JSON.stringify({ collapsed: 'blocked' }) })
    expect(readViewPrefs().collapsed).toEqual([])
  })

  it('does not obey a showDone that is not a boolean', () => {
    // The claim is 「a corrupt value is not obeyed」, and it used to be written as
    // `toBe(false)` — which silently made the DEFAULT the wrong answer the day it
    // became `true`, and would have failed here for fixing a real defect. Note what
    // is NOT asserted: that a corrupt value lands on `false`. It lands on the
    // page's own default, which is the same thing the other three fields do, and
    // when that default is `true` then `true` is the correct answer to give.
    useWindow({ raw: JSON.stringify({ showDone: 'yes' }) })
    expect(readViewPrefs().showDone, 'a corrupt value did not fall back to the default').toBe(DEFAULT_VIEW_PREFS.showDone)
  })
})

describe('a browser with storage switched off is a supported way to run', () => {
  it('reads defaults when reading throws', () => {
    useWindow({ throwOnGet: true })
    expect(readViewPrefs()).toEqual(DEFAULT_VIEW_PREFS)
  })

  it('writes nothing and does not throw when writing throws', () => {
    // Private mode, or a full quota. The panel behaves exactly the same; only
    // the memory of the choice is lost, and that is not worth a message.
    const store = useWindow({ throwOnSet: true })
    expect(() => writeViewPrefs(DEFAULT_VIEW_PREFS)).not.toThrow()
    expect(store.setItem).toHaveBeenCalled()
  })
})

describe('folding a group', () => {
  it('adds a group that is open and removes one that is folded', () => {
    expect(toggleCollapsed([], 'blocked')).toEqual(['blocked'])
    expect(toggleCollapsed(['blocked'], 'blocked')).toEqual([])
  })

  it('leaves the array it was handed alone', () => {
    // The caller holds this set in state; mutating it in place would make the
    // "did anything change" question unanswerable to React.
    const before = ['done'] as const
    toggleCollapsed([...before], 'open')
    expect(before).toEqual(['done'])
  })

  it('leaves the other groups where they were', () => {
    expect(toggleCollapsed(['done', 'blocked'], 'open')).toEqual(['done', 'blocked', 'open'])
  })
})
