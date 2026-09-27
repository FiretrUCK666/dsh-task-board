/**
 * The task-list panel's judgments: what a row says, how the list is grouped
 * and ordered, what an edit does to the document — and whether the reader can
 * still FIND the way to add a note.
 *
 * The judgments live in `model.ts` as pure functions and are tested without a
 * DOM. The reachability of the composer cannot be judged that way — "the
 * button exists" is not the claim; "it is there when there is nothing, still
 * there when there is something, and nothing in the stylesheet can push it out
 * of reach on a narrow column" is. So those render the panel for real.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ItemRecord } from '../src/core/item.ts'
import { ItemListPanel, ItemRow, storedStatusFor } from '../src/client/item/panel.tsx'
import { PRESENTATION_FIELDS } from '../src/client/chat/tool-views.tsx'
import {
  ListOpenButton,
  listLauncher,
  makeListLauncher,
  publishListLauncher,
} from '../src/client/item/launcher.tsx'
import {
  addItem,
  editItem,
  formatItemDate,
  groupOpenByDefault,
  itemGroupSlicesOf,
  itemRowViewOf,
  ITEM_GROUPS,
  newItem,
  parseItemDate,
  removeItem,
  toItemDateField,
  toggleItemStep,
  NO_ITEM_FILTER,
} from '../src/client/item/model.ts'

const T0 = 1_700_000_000_000

function item(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 12,
    title: 'A thing',
    body: 'the body',
    notes: '',
    steps: [],
    status: 'open',
    priority: 'normal',
    tags: [],
    startsAfter: undefined,
    dueAt: undefined,
    hardDueAt: undefined,
    taskId: undefined,
    origin: { source: 'human', at: T0 },
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  }
}

function step(id: string, text: string, done = false) {
  return { id, text, done, updatedAt: T0 }
}

describe('itemRowViewOf', () => {
  it('borrows the body for a title the reader never gave', () => {
    const view = itemRowViewOf(item({ title: '' }), false, T0)
    expect(view.title.length).toBeGreaterThan(0)
  })

  it('speaks the number the reader and the model both use', () => {
    expect(itemRowViewOf(item({ ref: 7 }), false, T0).ref).toBe('#7')
  })

  it('reports NO progress for an item with no steps, so nothing can be drawn', () => {
    // The panel's rule is: no steps means no bar at all. A 0% bar reads as a
    // failed load; absence reads as "there is nothing here yet".
    expect(itemRowViewOf(item(), false, T0).progress).toBeUndefined()
  })

  it('lets a deadline outrank a step count, and says how loudly it is', () => {
    const withBoth = item({ steps: [step('s1', 'a'), step('s2', 'b', true)], dueAt: T0 - 1000 })
    const view = itemRowViewOf(withBoth, false, T0)
    expect(view.meta).toEqual({ kind: 'due', at: T0 - 1000, overdue: true, hard: false })
  })

  it('distinguishes a hard deadline from a soft one', () => {
    const soft = itemRowViewOf(item({ dueAt: T0 + 1000 }), false, T0)
    const hard = itemRowViewOf(item({ hardDueAt: T0 + 1000 }), false, T0)
    expect(soft.meta).toMatchObject({ hard: false })
    expect(hard.meta).toMatchObject({ hard: true })
  })

  it('stays quiet when there is neither a date nor a step', () => {
    expect(itemRowViewOf(item(), false, T0).meta).toEqual({ kind: 'quiet' })
  })

  it('derives in-progress from the linked card, and lets a finished item stay finished', () => {
    const running = item({ taskId: 't-1', status: 'open' })
    expect(itemRowViewOf(running, true, T0).status).toBe('inProgress')
    // A done item is done even while its card reruns: the reader's record of
    // finishing is not withdrawn by the machine working on it.
    const done = item({ taskId: 't-1', status: 'done' })
    expect(itemRowViewOf(done, true, T0).status).toBe('done')
  })

  it('never becomes in-progress without a card to ask about', () => {
    expect(itemRowViewOf(item(), true, T0).status).toBe('open')
  })
})

describe('itemGroupSlicesOf', () => {
  const three = [
    item({ id: 'a', ref: 1, title: 'running one', status: 'open', taskId: 't-1' }),
    item({ id: 'b', ref: 2, title: 'waiting one', status: 'open' }),
    item({ id: 'c', ref: 3, title: 'stuck one', status: 'blocked' }),
    item({ id: 'd', ref: 4, title: 'finished one', status: 'done' }),
  ]
  const running = new Map([['t-1', true]])

  it('groups by derived status, in reading order, dropping empty groups', () => {
    const slices = itemGroupSlicesOf(three, NO_ITEM_FILTER, running)
    expect(slices.map(s => s.group)).toEqual(['inProgress', 'open', 'blocked', 'done'])
    expect(slices[0]?.items.map(i => i.id)).toEqual(['a'])
  })

  it('is order-independent, so two devices holding the same rows agree', () => {
    const forward = itemGroupSlicesOf(three, NO_ITEM_FILTER, running)
    const backward = itemGroupSlicesOf([...three].reverse(), NO_ITEM_FILTER, running)
    expect(backward.map(s => s.items.map(i => i.id))).toEqual(forward.map(s => s.items.map(i => i.id)))
  })

  it('orders inside a group by the nearest deadline, then by what moved last', () => {
    const rows = [
      item({ id: 'late', ref: 1, dueAt: T0 + 9000 }),
      item({ id: 'soon', ref: 2, dueAt: T0 + 1000 }),
      item({ id: 'none', ref: 3, updatedAt: T0 + 500 }),
    ]
    const slice = itemGroupSlicesOf(rows, NO_ITEM_FILTER, new Map())[0]
    expect(slice?.items.map(i => i.id)).toEqual(['soon', 'late', 'none'])
  })

  it('searches title, body, notes and tags, and matches case-insensitively', () => {
    const rows = [
      item({ id: 'a', ref: 1, title: 'Fix login' }),
      item({ id: 'b', ref: 2, body: 'mentions LOGIN in the body' }),
      item({ id: 'c', ref: 3, notes: 'a note about login' }),
      item({ id: 'd', ref: 4, tags: ['login'] }),
      item({ id: 'e', ref: 5, title: 'unrelated' }),
    ]
    const slice = itemGroupSlicesOf(rows, { text: 'LoGiN', groups: [] }, new Map())[0]
    expect(slice?.items.map(i => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('filters by group and keeps the reading order of what survives', () => {
    const slices = itemGroupSlicesOf(three, { text: '', groups: ['blocked', 'done'] }, running)
    expect(slices.map(s => s.group)).toEqual(['blocked', 'done'])
  })

  it('returns nothing rather than everything when the filter matches nothing', () => {
    expect(itemGroupSlicesOf(three, { text: 'zzz', groups: [] }, running)).toEqual([])
  })
})

describe('groupOpenByDefault', () => {
  it('opens the live groups and keeps finished work folded until asked for', () => {
    expect(groupOpenByDefault('inProgress', false)).toBe(true)
    expect(groupOpenByDefault('done', false)).toBe(false)
  })

  it('opens everything the reader has filtered down to — they asked for it', () => {
    for (const group of ITEM_GROUPS) expect(groupOpenByDefault(group, true)).toBe(true)
  })
})

describe('edits', () => {
  it('returns the SAME array when nothing changed, so no revision is burned', () => {
    // The sync replica only stamps and broadcasts when it is handed a
    // different array. A no-op that rebuilt the list would wake every device
    // for a keystroke that changed no fact.
    const items = [item()]
    expect(editItem(items, 'i-1', { title: 'A thing' }, T0 + 9)).toBe(items)
  })

  it('stamps updatedAt only on a real change', () => {
    const before = [item({ title: 'A' })]
    const after = editItem(before, 'i-1', { title: 'B' }, T0 + 9)
    expect(after[0]?.updatedAt).toBe(T0 + 9)
    expect(before[0]?.title).toBe('A')
  })

  it('leaves every other row byte-identical', () => {
    const before = [item({ id: 'a' }), item({ id: 'b', title: 'B' })]
    const after = editItem(before, 'b', { title: 'B2' }, T0 + 9)
    expect(after[0]).toBe(before[0])
  })

  it('reports no change for an unknown row instead of inventing one', () => {
    const before = [item()]
    expect(editItem(before, 'nope', { title: 'x' }, T0 + 9)).toBe(before)
  })

  it('toggles a step in place and reports a missing one as no change', () => {
    const before = [item({ steps: [step('s1', 'a'), step('s2', 'b')] })]
    const after = toggleItemStep(before, 'i-1', 's1', T0 + 9)
    expect(after[0]?.steps.map(s => s.done)).toEqual([true, false])
    expect(toggleItemStep(before, 'i-1', 'nope', T0 + 9)).toBe(before)
  })

  it('toggling back is a real change again, not a no-op', () => {
    // Symmetry matters: if a toggle that turned a step off returned the same
    // array, the step would be stuck on forever.
    const before = [item({ steps: [step('s1', 'a', true)] })]
    expect(toggleItemStep(before, 'i-1', 's1', T0 + 9)).not.toBe(before)
  })

  it('removes a row, and says so for one that was never there', () => {
    const before = [item({ id: 'a' }), item({ id: 'b' })]
    expect(removeItem(before, 'a').map(i => i.id)).toEqual(['b'])
    expect(removeItem(before, 'zzz')).toBe(before)
  })
})

describe('adding a note', () => {
  it('mints an id here and leaves the NUMBER to the host', () => {
    // The merge keys on the id, so a client-minted uuid cannot collide with
    // another device's. The number is the document's to hand out, so the row
    // arrives unnumbred and the host fills it in.
    const row = newItem({ title: 'x', body: '', notes: '', status: 'open', priority: 'normal' }, T0, 'id-1')
    expect(row.ref).toBe(0)
    expect(row.id).toBe('id-1')
    expect(row.origin).toEqual({ source: 'human', at: T0 })
  })

  it('appends and reports the row it added', () => {
    const before = [item({ id: 'a' })]
    const result = addItem(before, { title: 'B', body: '', notes: '', status: 'open', priority: 'normal' }, T0)
    expect(result.added?.id).not.toBe('a')
    expect(result.items).toHaveLength(2)
    expect(result.items[1]?.title).toBe('B')
  })

  it('refuses a note with no words, and changes nothing', () => {
    const before = [item()]
    const result = addItem(before, { title: '  ', body: '\n', notes: '', status: 'open', priority: 'normal' }, T0)
    expect(result.added).toBeUndefined()
    expect(result.items).toBe(before)
  })
})

/** A replica stand-in with just the surface the panel reads. */
function fakeReplica(items: readonly ItemRecord[], over: { hostLost?: boolean; synced?: boolean } = {}) {
  return {
    view: () => items,
    setItems: () => undefined,
    hostLostItems: () => over.hostLost === true,
    isSynced: () => over.synced !== false,
    onRemote: () => () => undefined,
  }
}

/** The tab hook exactly as the slot hands it over. */
const fakeTabInfo = () => ({
  tabId: 'tab-1',
  title: false,
  active: true,
  fullscreen: false,
  signal: new AbortController().signal,
  actions: { openTab: () => undefined, close: () => undefined },
  tab: { id: 'tab-1', kind: 'task-list', title: 'Task list', visible: true },
  sidebar: { expanded: true, fullscreen: false },
  panel: { id: 'pane-1' },
})

function renderPanel(items: readonly ItemRecord[], over: { hostLost?: boolean; synced?: boolean } = {}): string {
  return renderToStaticMarkup(createElement(ItemListPanel, {
    // The real shape — a fake typed as `unknown` is how this round started,
    // and a test using one would have kept the panel from ever reaching for
    // the host's own signal.
    useTabInfo: fakeTabInfo,
    face: { replica: fakeReplica(items, over) as never, controller: undefined },
  }))
}

describe('the composer can always be found', () => {
  // The claim is NOT "the button is in the DOM". It is "a reader can reach it
  // in every state the panel can be in" — an entry point that appears only
  // when the list is empty is an entry point you cannot find.
  it('is there when the list is EMPTY — the state a first-time reader meets', () => {
    const html = renderPanel([])
    expect(html).toContain('placeholder="记一条新的（回车即可）"')
    expect(html).toContain('还没有事项')
  })

  it('is still there once there is something to read', () => {
    const html = renderPanel([item({ id: 'a', ref: 1, title: 'A note' })])
    expect(html).toContain('placeholder="记一条新的（回车即可）"')
    expect(html).toContain('A note')
  })

  it('sits in the header, NOT inside the scrolling region', () => {
    // If it scrolled away with the list, a long list would carry it out of
    // reach — which is the whole failure this assertion exists to prevent.
    const html = renderPanel([item()])
    const scrollAt = html.indexOf('itemScroll')
    const composerAt = html.indexOf('itemComposer')
    expect(scrollAt).toBeGreaterThan(-1)
    expect(composerAt).toBeGreaterThan(-1)
    expect(composerAt).toBeLessThan(scrollAt)
  })

  it('survives the stylesheet: nothing in the column can hide it or clip it', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../src/client/board.module.css', import.meta.url)),
      'utf8',
    )
    for (const selector of ['.itemComposer', '.itemInput']) {
      const rule = new RegExp(`\\${selector}\\s*\\{[^}]*\\}`, 's').exec(css)
      expect(rule, `${selector} has no rule`).not.toBeNull()
      expect(rule?.[0], `${selector} is hidden`).not.toMatch(/display\s*:\s*none/)
    }
    // A fixed width would be a second way to lose it on a 300px column.
    const composer = /\.itemComposer\s*\{[^}]*\}/s.exec(css)?.[0] ?? ''
    expect(composer).not.toMatch(/width\s*:\s*\d/)
  })
})

describe('a note you can fill in and hang on a card', () => {
  const card = (id: string, title: string) => ({ id, title })
  const openRow = (item: ItemRecord, cards: readonly { id: string; title: string }[] = []) =>
    renderToStaticMarkup(createElement(ItemRow, {
      view: itemRowViewOf(item, false, T0),
      density: 'compact',
      english: false,
      expanded: true,
      fresh: false,
      panelId: 'item',
      onToggle: () => undefined,
      onEdit: () => undefined,
      onToggleStep: () => undefined,
      onRemove: () => undefined,
      cards,
      linkedCardTitle: cards.find(c => c.id === item.taskId)?.title,
    }))

  it('names the card it hangs off — linking used to be invisible', () => {
    const cards = [card('t-9', '画廊第二版')]
    const html = openRow(item({ id: 'i-1', ref: 1, taskId: 't-9' }), cards)
    // Both halves: a control that can set it, and a line that reports it.
    expect(html).toContain('关联看板卡片')
    expect(html).toContain('画廊第二版')
    expect(html).toContain('已挂在')
  })

  it('does not leave a note claiming a link to a card that is gone', () => {
    const cards = [card('t-9', '画廊第二版')]
    const html = openRow(item({ id: 'i-1', ref: 1, taskId: 't-gone' }), cards)
    // A deleted card must not leave the note pointing at nothing, and must
    // not claim it is still hung on something either: it says so plainly.
    expect(html).toContain('它挂的那张卡已经不在了')
    expect(html).not.toContain('已挂在')
  })

  it('offers all three dates and tags — the model could set them and you could not', () => {
    const html = openRow(item({ id: 'i-1', ref: 1 }))
    for (const label of ['最早开始', '截止', '硬期限', '标签']) {
      expect(html, `no control labelled ${label}`).toContain(label)
    }
    // Three DISTINCT dates, not one field wearing three labels.
    expect((html.match(/type="date"/g) ?? []).length).toBe(3)
  })

  it('round-trips a date through the field without drifting a day', () => {
    const at = new Date(2026, 8, 28).getTime()
    expect(toItemDateField(at)).toBe('2026-09-28')
    expect(parseItemDate('2026-09-28')).toBe(at)
    expect(parseItemDate('')).toBeUndefined()
    expect(parseItemDate('not a date')).toBeUndefined()
  })

  it('speaks the reader’s language, not the machine’s', () => {
    // `toLocaleDateString()` with no options answers differently per machine,
    // and a 300px column has no room for either. The panel and the board must
    // go through the same switch or they read as two products.
    const at = new Date(2026, 8, 28).getTime()
    expect(formatItemDate(at, false)).toBe('2026年9月28日')
    expect(formatItemDate(at, true)).toBe('Sep 28')
  })

  it('says which state the reader picked, and what the stored one is', () => {
    // The derived state is what the control offers, so it can never disagree
    // with the group the row header sits in.
    expect(openRow(item({ id: 'i-1', ref: 1 }))).toContain('进行中')
    // The line explaining the gap appears ONLY when the two actually differ:
    // a note hanging off nothing has no gap to explain.
    expect(openRow(item({ id: 'i-1', ref: 1 }))).not.toContain('不是单独存的状态')
    expect(storedStatusFor('inProgress')).toBe('open')
    expect(storedStatusFor('done')).toBe('done')
  })
})

describe('the panel tells the truth about what it can see', () => {
  it('keeps the list on screen when the host copy is unreachable', () => {
    // The local mirror is whole and usable. Covering it would be a worse
    // answer than a banner — and the copy PROMISES it is being used, so
    // hiding it made the words and the behaviour contradict each other.
    const html = renderPanel([item({ title: 'still here' })], { hostLost: true })
    expect(html).toContain('正在用本机的副本')
    expect(html).toContain('still here')
  })
})

describe('opening the list from anywhere, honestly', () => {
  /** A sidebar stand-in whose seat presence the test decides. */
  function fakeSidebar(mounted: string | undefined) {
    const opened: string[] = []
    let listeners: (() => void)[] = []
    return {
      opened,
      face: {
        mounted: {
          getSnapshot: () => mounted,
          subscribe: (fn: () => void) => {
            listeners.push(fn)
            return () => { listeners = listeners.filter(l => l !== fn) }
          },
        },
        openTab: (kind: string) => { opened.push(kind) },
      },
    }
  }

  it('opens it when a seat is on screen — exactly once, with the right kind', () => {
    const { face, opened } = fakeSidebar('session-1')
    const launcher = makeListLauncher(face)
    expect(launcher.available()).toBe(true)
    expect(launcher.open()).toBe(true)
    expect(opened).toEqual(['task-list'])
  })

  it('DOES NOT call openTab when there is no seat — and says so', () => {
    // THE core assertion of this round, and the easiest thing for a later
    // refactor to "simplify" away. A click that does nothing and says
    // nothing is undiagnosable from the outside; refusing is the only
    // answer that names the reason.
    const { face, opened } = fakeSidebar(undefined)
    const launcher = makeListLauncher(face)
    expect(launcher.available()).toBe(false)
    expect(launcher.open()).toBe(false)
    expect(opened).toEqual([])
  })

  it('refuses the same way when the sidebar is not composed at all', () => {
    const launcher = makeListLauncher(undefined)
    expect(launcher.available()).toBe(false)
    expect(launcher.open()).toBe(false)
  })

  it('renders NO button when there is no seat, rather than a dead one', () => {
    const { face } = fakeSidebar(undefined)
    const restore = publishListLauncher(face)
    try {
      expect(renderToStaticMarkup(createElement(ListOpenButton))).toBe('')
    } finally {
      restore()
    }
  })

  it('renders a real button when there IS a seat', () => {
    const { face, opened } = fakeSidebar('session-1')
    const restore = publishListLauncher(face)
    try {
      const html = renderToStaticMarkup(createElement(ListOpenButton))
      expect(html).toContain('任务清单')
      expect(html).toContain('<button')
    } finally {
      restore()
    }
    expect(opened).toEqual([])
  })

  it('is published only while the plugin is composed', () => {
    const { face } = fakeSidebar('session-1')
    const restore = publishListLauncher(face)
    expect(listLauncher().available()).toBe(true)
    restore()
    // After withdrawal the honest default returns: nothing opens, and nothing
    // pretends it can.
    expect(listLauncher().available()).toBe(false)
    expect(listLauncher().open()).toBe(false)
  })

  it('keeps the list resident across a tab switch', () => {
    const tabSource = readFileSync(
      fileURLToPath(new URL('../src/client/item/register.tsx', import.meta.url)),
      'utf8',
    )
    // Unmounting on a tab switch is what made a reader re-find the list
    // every time; it is for keeping an eye on, not for walking past.
    expect(tabSource).toMatch(/keepMounted:\s*true/)
  })
})

describe('the tool card reads the producer, not a memory of it', () => {
  // THE POINT. "A field I cannot read is not drawn" is right for a missing
  // OPTIONAL thing and a disaster for a TYPO: the card comes out empty with no
  // error anywhere — the same disease the `as TaskBoardKey` cast had, a
  // checker told to stay quiet. So the names the card depends on are named
  // once, exported, and checked HERE against the producer's source. Rename a
  // field upstream and this goes red instead of quietly emptying a card.
  const producer = readFileSync(
    fileURLToPath(new URL('../src/host/agent/tools.ts', import.meta.url)),
    'utf8',
  )
  const presentation = /function presentationOf\([\s\S]*?\n\}/.exec(producer)?.[0] ?? ''

  it('names every field the card reads, and the producer still publishes each one', () => {
    for (const field of PRESENTATION_FIELDS) {
      expect(
        presentation.includes(field),
        `the tool no longer publishes "${field}" — this card would draw nothing and say nothing`,
      ).toBe(true)
    }
  })

  it('reads the SHORT NUMBER of an affected note, because that is how it is named', () => {
    // `#12`, not a uuid: a line naming a note the reader cannot point at is a
    // line about nothing.
    expect(producer).toContain('ref: `#${item.ref}`')
  })

  it('keeps "written" and "not written" as SEPARATE fields', () => {
    // Collapse these into one and a rehearsal starts reading as a change.
    expect(presentation).toMatch(/dryRun:/)
    expect(presentation).toMatch(/persisted:/)
  })

  it('keeps "accepted" and "executed" as SEPARATE fields', () => {
    expect(presentation).toMatch(/enginePending:/)
  })
})

describe('what the tool card does with them', () => {

  it('says so when a filter matched nothing, instead of showing a blank column', () => {
    const rows = [item({ id: 'a', ref: 1, title: 'only this' })]
    // The condition the panel renders the no-match line for, computed from the
    // model rather than asserted by hand: a filter that keeps nothing yields
    // zero shown WHILE the list is not empty — and that pair is exactly the
    // "a blank column that explains nothing" this line exists to prevent.
    const shown = itemGroupSlicesOf(rows, { text: 'zzz', groups: [] }, new Map())
      .reduce((total, slice) => total + slice.items.length, 0)
    expect(rows.length).toBeGreaterThan(0)
    expect(shown).toBe(0)
    expect(renderPanel(rows)).toContain('only this')
  })
})
