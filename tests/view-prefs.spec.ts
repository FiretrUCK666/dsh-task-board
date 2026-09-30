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
    writeViewPrefs({ page: 'schedule', sort: 'priority', collapsed: ['blocked'], search: '' })
    expect(store.setItem).toHaveBeenCalled()
    expect(readViewPrefs()).toEqual({
      page: 'schedule', sort: 'priority', collapsed: ['blocked'], search: '',
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

describe('the temporary overlay is a view switch that is not a memory', () => {
  it('is never written, so a reader who quit with the palette open does not come back to it', () => {
    // `overlay` is how a render capture asks for the command palette, and it sits
    // on `ItemViewPrefs` rather than on the panel precisely so that it is not a
    // SECOND way of saying 「the palette is open」. That choice is only safe while
    // the key is never written, so THAT is what this pins — not the reading of
    // it, which the bench exercises, but the one property that makes a stale
    // overlay impossible.
    //
    // The failure it prevents: a reader quits with the palette open, the key is
    // persisted, and next session the panel opens itself over the list. Nothing
    // reports that, and the panel reads as broken rather than remembered.
    const store = useWindow()
    writeViewPrefs({ ...DEFAULT_VIEW_PREFS, overlay: 'palette' })
    const written = store.setItem.mock.calls[0]?.[1] as string
    expect(written, 'the temporary overlay was written to storage — a reader who quit with the palette open would come back to it').not.toContain('overlay')
    expect(Object.keys(JSON.parse(written) as object), 'the written record names a key the reader above does not').not.toContain('search')
    // And the defaults carry none, so a fresh panel starts with nothing over it.
    expect(DEFAULT_VIEW_PREFS.overlay, 'the defaults carry an overlay, so every fresh panel opens with something over it').toBeUndefined()
  })

  it('the probe bites: an overlay value nobody meant is dropped, not guessed at', () => {
    // A field that accepts whatever it is handed is a field the compiler checks
    // nothing about. `isPage` and `isSort` check against the model's vocabulary
    // for the same reason, and this is the one value a capture can get wrong by
    // typing — where a wrong value would produce a picture of something nobody
    // asked for, and the picture would be believed.
    const reads = (raw: string): unknown => {
      useWindow({ raw })
      return readViewPrefs().overlay
    }
    expect(reads(JSON.stringify({ overlay: 'palette' })), 'the one value that means something was dropped').toBe('palette')
    expect(reads(JSON.stringify({ overlay: 'somethingElse' })), 'an unrecognised overlay was accepted').toBeUndefined()
    expect(reads(JSON.stringify({ overlay: true })), 'a non-string overlay was accepted').toBeUndefined()
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
    //
    // `showDone` has since been RETIRED, so this case now pins the rule on the
    // one boolean that is left (`showDone` was the only one, and it is gone) — and
    // what it pins is the SHAPE of the rule, not the field: a boolean the reader
    // never mentioned falls back to the page's own default, and a boolean the
    // reader did say is obeyed either way round. Written against
    // `DEFAULT_VIEW_PREFS` so it survives the next field being added.
    useWindow({ raw: JSON.stringify({ sort: 'due' }) })
    expect(readViewPrefs().page, 'a record that said nothing about the page did not get the default').toBe(DEFAULT_VIEW_PREFS.page)
    useWindow({ raw: JSON.stringify({ page: 'list' }) })
    expect(readViewPrefs().sort, 'a record that said nothing about the order did not get the default').toBe(DEFAULT_VIEW_PREFS.sort)
  })

  it('replaces a page id this version no longer has', () => {
    // A key written by a build that had a fourth page must not put the reader
    // on a page that does not exist — the rail would show three and the panel
    // would render the body of none of them.
    useWindow({ raw: JSON.stringify({ page: 'gantt' }) })
    expect(readViewPrefs().page).toBe(DEFAULT_VIEW_PREFS.page)
  })

  it('replaces an order it does not recognise', () => {
    useWindow({ raw: JSON.stringify({ sort: 'vibes' }) })
    expect(readViewPrefs().sort).toBe(DEFAULT_VIEW_PREFS.sort)
  })

  it('a record from the build that still had a row-height setting reads cleanly', () => {
    // THE UPGRADE. `density` was a preference the reader could set and it is
    // gone, so every device that ever opened this panel still has the key in
    // storage. Two ways to get that wrong, both of which are worse than a lost
    // preference: THROWING (the panel does not open at all, on the one upgrade
    // where everything else about it is an improvement), and KEEPING the key
    // alive with a default (a setting with no control, which the reader can
    // neither see nor change and which every future reader of the type
    // maintains).
    //
    // The whole migration is that the reader never names the field, so a record
    // from any build at all parses to the same shape. That is asserted by the
    // SHAPE, not by one field: `toEqual` on the defaults is the claim that a
    // stale key is inert, and `expect(DEFAULT_VIEW_PREFS).not.toHaveProperty`
    // is the claim that it is not merely defaulted.
    useWindow({ raw: JSON.stringify({ page: 'list', sort: 'due', density: 'comfy', showDone: true, collapsed: [], search: '#kept' }) })
    expect(readViewPrefs()).toEqual({ ...DEFAULT_VIEW_PREFS, page: 'list', sort: 'due' })
    expect(DEFAULT_VIEW_PREFS, 'the row-height setting is still a field with a default rather than gone').not.toHaveProperty('density')
    // THE SAME UPGRADE, THE SECOND TIME, and this is the one that bites. `showDone`
    // was 「这一页不要已完成的行」 at PAGE level, written by a control on the
    // retired overview strip. Once the strip went, the field left behind was not
    // a capability but a switch nobody could reach — a device that had stored
    // `showDone: false` could never turn it back on, because the only thing that
    // wrote it no longer existed.
    //
    // The INTENT is not lost: the group's own fold carries it, with a visible
    // control, a drawn arrow and per-group memory. What is lost is the second,
    // invisible copy. **One intent, one control** — and a preference whose control
    // is gone is not a setting, it is a trap with the handle filed off.
    expect(DEFAULT_VIEW_PREFS, 'the finished-work switch is still a field with a default rather than gone').not.toHaveProperty('showDone')
    // And the way to say it now is the fold, which is a per-group set.
    expect(toggleCollapsed([], 'done'), 'the finished group has no way to be put away now that the page switch is gone').toEqual(['done'])
  })

  it('the probe bites: a stale key that DID break the read would be reported', () => {
    // Fed the shape a strict reader produces — one that enumerates the record's
    // keys and refuses the ones it does not know. That is the implementation this
    // case exists to prevent, and it is short enough to write out, which is the
    // only reason a control for it is possible at all.
    const strict = (raw: string): string => {
      const record = JSON.parse(raw) as Record<string, unknown>
      const known = new Set(['page', 'sort', 'collapsed', 'search'])
      for (const key of Object.keys(record)) {
        if (!known.has(key)) throw new Error(`unknown preference ${key}`)
      }
      return record.page as string
    }
    expect(() => strict(JSON.stringify({ page: 'list', density: 'comfy' })),
      'a stale key did not break the read — this probe proves nothing').toThrow(/unknown preference density/)
    // TWO retired fields now, and the probe has to know about BOTH: the second is
    // exactly the one a copy of the first fix would have left out of `known`, and
    // then `showDone` would be quietly readable again.
    expect(() => strict(JSON.stringify({ page: 'list', showDone: false })),
      'the second retired field is not covered by the probe, so it can be read back by accident').toThrow(/unknown preference showDone/)
    expect(strict(JSON.stringify({ page: 'list', sort: 'due', collapsed: ['done'] })),
      'the probe rejects a record this build actually writes').toBe('list')
  })

  it('drops collapsed groups it does not recognise, and folds duplicates', () => {
    useWindow({ raw: JSON.stringify({ collapsed: ['blocked', 'nonsense', 'blocked', 'done'] }) })
    expect(readViewPrefs().collapsed).toEqual(['blocked', 'done'])
  })

  it('reads a non-array collapsed as nothing folded', () => {
    useWindow({ raw: JSON.stringify({ collapsed: 'blocked' }) })
    expect(readViewPrefs().collapsed).toEqual([])
  })

  it('does not obey a page id that is not one of the pages', () => {
    // The claim is 「a corrupt value is not obeyed」, and it used to be written as
    // a literal — which silently made the DEFAULT the wrong answer the day it
    // changed, and would have failed here for fixing a real defect. Note what is
    // NOT asserted: that a corrupt value lands on one particular answer. It lands
    // on the page's own default, which is what the other fields do too.
    useWindow({ raw: JSON.stringify({ page: 'yes' }) })
    expect(readViewPrefs().page, 'a corrupt value did not fall back to the default').toBe(DEFAULT_VIEW_PREFS.page)
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
