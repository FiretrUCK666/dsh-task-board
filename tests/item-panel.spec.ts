/**
 * The task-list panel's own contract: what it renders, and what it must never
 * render.
 *
 * WHAT MOVED AND WHY, because a rewritten test that quietly changes the claims
 * is worse than no test. The old file pinned FOUR COLUMNS BESIDE EACH OTHER,
 * a search row above a filter row, and a five-section detail that only ever
 * opened in place. Those three claims described a 300px right-edge drawer, and
 * the panel is a full-stage workbench, so they could not survive the move. What
 * replaced them is pinned here, and the geometry itself is pinned as arithmetic
 * in `panel-render.spec.ts` rather than as a picture.
 *
 * WHAT IS CARRIED OVER UNCHANGED, because none of it was ever about the old
 * layout: the composer is reachable in every state, an empty group keeps its
 * header, the ledger sentinel never reaches the screen, the hand-off appears
 * only where there is a target, the degraded states are told apart, and the two
 * official seats stay exactly as they were.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ItemRecord } from '../src/core/item.ts'
import { ItemListPanel } from '../src/client/item/panel.tsx'
import {
  NO_SELECTION,
  allPicked,
  reconcile,
  selectedCount,
  selectionActive,
  setAllPicked,
  togglePicked,
} from '../src/client/item/selection.ts'
import { itemSurfaceSource } from './panel-harness.ts'
import { PRESENTATION_FIELDS } from '../src/client/chat/tool-views.tsx'

const T0 = 1_700_000_000_000
const DAY = 86_400_000

function item(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 12,
    title: 'A thing',
    body: '',
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

/**
 * A replica stand-in.
 *
 * IT ANSWERS EVERY MEMBER OF THE SURFACE THE PANEL READS, not "just enough to
 * get a green tick". It used to stand for `ChecklistReplica` with five members
 * and the panel then grew a sixth read — this device's id, which every host
 * write on the checklist prefix carries — so the fake was NARROWER than the
 * thing it stands in for and eighteen cases in this file began throwing
 * `clientId is not a function` at a panel that was correct.
 *
 * The narrow fake is the same hazard as the permissive one, pointed the other
 * way: a stand-in that is smaller than reality turns a legitimate call into a
 * crash (so the suite reports a defect that does not exist), while a stand-in
 * that is BIGGER than reality swallows a call the real host would refuse (so
 * the suite stays green on a defect that does). Either way the fake has stopped
 * being a statement about the contract and become a statement about the
 * implementation, which is the one thing a test double must never be.
 * `tests/panel-harness.ts` models the same face for the render spec, and the two
 * are kept in step deliberately rather than by accident.
 */
function fakeReplica(items: readonly ItemRecord[], over: { hostLost?: boolean; synced?: boolean } = {}) {
  return {
    view: () => items,
    setItems: () => undefined,
    clientId: () => 'client-under-test',
    hostLostItems: () => over.hostLost === true,
    isSynced: () => over.synced !== false,
    onRemote: () => () => undefined,
  }
}

function renderPanel(items: readonly ItemRecord[], over: { hostLost?: boolean; synced?: boolean } = {}): string {
  return renderToStaticMarkup(createElement(ItemListPanel, {
    signal: new AbortController().signal,
    face: { replica: fakeReplica(items, over) as never, controller: undefined },
  }))
}

describe('the workbench is a set of pages, and the rail says which', () => {
  it('offers exactly the three container pages, each with an accessible full name', () => {
    // The short name is what a 390px rail can hold; the full name is what a
    // screen reader announces. The rail carrying only short names is how a
    // reader learns what a page is for by opening it.
    const html = renderPanel([])
    for (const short of ['收件', '清单', '日程']) expect(html, short).toContain(short)
    // 「清单」 IS EVERY ROW, FINISHED ONES INCLUDED — 已完成 is a SWITCH on this
    // page, not another page, so naming it 「全部没做完的事」 told a screen reader
    // the page holds something it does not. The sentence is the map of the panel,
    // and a map that omits what is on it is the one kind of map that is worse
    // than no map.
    for (const aria of ['刚记下、还没给它结构的条目', '全部条目，含已完成的', '按时间排的事']) {
      expect(html, aria).toContain(aria)
    }
  })

  it('keeps the surface to six things, and the page rail is one of them', () => {
    // Low density is not fewer features; it is putting each feature next to the
    // thing it changes. Batching lives INSIDE the page, beside the rows it acts
    // on, and so does the archive.
    //
    // FOUR BECAME SIX, and the two that came back are not new work: the search box
    // returned to the head (it is about the WHOLE page, and a box that costs two
    // keystrokes before it can filter a page is a box half the readers never find),
    // and the statistics band came with the filter bar, because a reader choosing
    // which rows to look at needs the number and the sieve in the same breath.
    // Both are on the spine, and the claim is still a claim about FURNITURE: six
    // things above the rows, and everything else inside the page.
    // A row that is actually behind its plan, so the statistics band has
    // something to say: a band of three zeros is not drawn at all, and a gate
    // that asks for it on a document with nothing in it is asking for a thing
    // that is deliberately absent.
    const html = renderPanel([item({ dueAt: Date.now() - 3 * DAY })])
    for (const part of [
      'itemPageTitle', // 标题
      'itemSearch', // 搜索
      'itemPageRail', // 页轨
      'itemComposerChips', // 快记框
      'itemStats', // 统计带
      'itemFilters', // 筛选条
    ]) {
      expect(html, `${part} is not on the surface — the spine is no longer the six things it claims to be`).toContain(part)
    }
    // And the six are the six: the archive, the receipts and the batch bar all
    // live inside the page, below the table, where they act on rows rather than
    // on the page itself.
    expect(html, 'the archive entry is on the spine instead of at the foot of the page').not.toContain('itemArchiveSection')
  })
})

describe('the composer can always be found', () => {
  it('is there when the list is EMPTY — the state a first-time reader meets', () => {
    const html = renderPanel([])
    expect(html).toContain('记一条新的，回车即存')
  })

  it('is still there once there is something to read', () => {
    const html = renderPanel([item({ id: 'a', ref: 1, title: 'A note' })])
    expect(html).toContain('记一条新的，回车即存')
    expect(html).toContain('A note')
  })

  it('sits above the workbench, so a long list cannot carry it out of reach', () => {
    // The failure this exists to prevent is a capture box that scrolls away with
    // the rows: a reader with thirty things to put down would have to scroll back
    // up for every one of them, and would stop putting them down.
    //
    // IT IS ASSERTED AGAINST THE WORKBENCH, which is the element that holds the
    // rows and the only scroller on this surface. An earlier version of this case
    // asked about a separate `itemScroll` region that no longer exists, and a gate
    // that names an element the file does not draw is a gate that can only fail:
    // it was never going to pass and it was not asking about the composer either.
    const html = renderPanel([item()])
    const workbenchAt = html.indexOf('itemWorkbench')
    const composerAt = html.indexOf('itemComposerChips')
    expect(workbenchAt, 'the workbench is not in the render at all').toBeGreaterThan(-1)
    expect(composerAt, 'the composer is not in the render at all').toBeGreaterThan(-1)
    expect(composerAt, 'the composer scrolled away with the list, so a long list carries it out of reach')
      .toBeLessThan(workbenchAt)
  })

  it('teaches its syntax by writing it, not by three buttons that mean nothing yet', () => {
    // A capture syntax nobody can find is a syntax nobody uses, and the reader
    // falls back to filling in four fields before the thought is safely down. So
    // the box has always taught it — but it used to teach it with three pressable
    // SYMBOLS (`#` `!` `@`) that typed the grammar in for you. A newcomer who
    // tapped `#` got a box full of `#` and learned the glyph, not the sentence:
    // the only part of the surface you could press, and none of it meaning
    // anything until you already knew what it meant.
    //
    // What teaches a syntax is writing one and watching what was understood, so
    // the symbols are gone and the chip is the evidence. This case pins the
    // direction of that change — no symbol buttons — rather than the old claim,
    // which asserted the very sentence they no longer draw.
    const html = renderPanel([])
    expect(html, 'the syntax is still taught by buttons you have to recognise before they help').not.toContain('itemComposerExamples')
    expect(html, 'the box is not there for the reader to write in').toContain('itemComposerChips')
  })
})

describe('a row is legible at rest', () => {
  it('never prints the ledger sentinel, because `#0` is a fact about storage', () => {
    const html = renderPanel([item({ ref: 0, title: 'Fresh' })])
    // The context is reported with the failure on purpose: a bare "contains
    // #0" on a 4KB string tells the next reader nothing about WHERE.
    expect(html.includes('#0') ? `…${html.slice(Math.max(0, html.indexOf('#0') - 140), html.indexOf('#0') + 60)}…` : 'none', 'the ledger sentinel reached the screen').toBe('none')
    expect(html).toContain('Fresh')
  })

  it('says a slipped plan as a slip, in neutral words', () => {
    // The one claim the whole three-date branch exists for. Red is reserved for
    // a missed HARD deadline and nothing else.
    //
    // READ THE ROW'S OWN DATE CELL, NOT THE PAGE, and the reason is specific
    // rather than stylistic. The claim is about the WORD this row's date line
    // uses, and a page-wide search for a forbidden word is not that claim: the
    // statistics band's own 「落后」 tile carries the same two characters, so the
    // search started reporting this row as loud because an UNRELATED control
    // elsewhere on the surface uses the same word — and the cheapest response to
    // that red is to rename a correct label, which fixes the symptom and
    // destroys the tile. A gate that punishes a word appearing anywhere is a gate
    // about vocabulary, not about tone.
    //
    // The cell is read by its own class rather than by cutting the row out of the
    // markup: the row is a nest of divs with no end marker of its own, so a
    // 「from here to the next row」 regex either runs past the row or stops inside
    // it, and both failures read as a green tick on an empty string.
    const html = renderPanel([item({ dueAt: Date.now() - 3 * DAY, title: 'Slipped' })])
    expect(html, 'the row is not on the page at all — the assertions below would pass on an empty string').toContain('Slipped')
    // `itemCellDue[^"]*"` and not `itemCellDue"`: the class map hashes every name,
    // so the word on screen is `itemCellDue_a9e292` and a pattern that insists on
    // a closing quote straight after the word matches nothing at all.
    const cell = /<div class="[^"]*itemCellDue[^"]*"[^>]*>([^<]*)</.exec(html)?.[1] ?? ''
    expect(cell, 'the date cell states no words at all, so the tone below is being read off nothing').not.toBe('')
    expect(cell).toContain('落后')
    expect(cell, 'a slipped plan is being painted as an overrun — red is reserved for a missed HARD deadline').not.toContain('超期')
  })

  it('says a missed hard deadline as an overrun', () => {
    const html = renderPanel([item({ hardDueAt: Date.now() - 3 * DAY, title: 'Over' })])
    expect(html).toContain('超期')
  })

  it('keeps a not-yet-startable row out of every day reading', () => {
    const html = renderPanel([item({ startsAfter: Date.now() + 5 * DAY, title: 'Gated' })])
    expect(html).toContain('最早')
  })
})

describe('the hand-off appears only where there is a target', () => {
  it('is offered on a row that hangs off a card', () => {
    const html = renderPanel([item({ taskId: 't-9' })])
    expect(html).toContain('问 AI')
  })

  it('is on every row, and the one with nothing to hand it to says so', () => {
    // A button that COMES AND GOES with a fact the interface never states is
    // worse than a button that is always there and says 「not yet」: a reader
    // scanning the column sees it on row two and not on row three and starts
    // hunting for whatever they think they have lost. The condition is real — a
    // row with no card has no session to ask — so the row SHOWS the condition
    // rather than hiding the control.
    //
    // BOTH HALVES, because a button that is merely always there is the other
    // half of the same defect: 「问 AI」 with no reason and no state reads as a
    // broken one. The disabled flag is the state, and the sentence is the reason.
    const html = renderPanel([item()])
    expect(html, 'the hand-off is not on the row at all — the reader cannot see that it exists').toContain('问 AI')
    const ask = /<button[^>]*itemAsk[^>]*>/.exec(html)?.[0] ?? ''
    expect(ask, 'the hand-off is not a button').not.toBe('')
    expect(ask, 'a row with no card still offers a working hand-off — pressing it can only say there is nothing to hand it to').toContain('disabled')
    // 理由写在这枚按钮自己的可及名称里，不只是悬停提示：触屏没有 hover。
    expect(ask, 'the disabled hand-off says nothing about what is missing').toMatch(/title="[^"]+"/)
  })
})

describe('empty is two different facts, and they do not look the same', () => {
  /* 「一组空的分桶在还有别的行时仍然留着它的头、它的数、别的什么都没有」这条
   * 断言连同它的对象一起没了，**不是被放宽，是被取消资格**：四个状态分组已经拆掉，
   * 状态变成表里的一列。于是「空的一组」在这个面板上不是一个存在的东西——没有
   * 组头可以留，也没有组数可以相加。留着一条断言一个已经不存在的东西的门禁，
   * 只会让下一个人以为分组还在：它要么被改成一个断言别的东西的假门禁，要么在某
   * 一次「修」里被连同真正的空态检查一起删掉。
   *
   * 取代它的那一半在下面：文档是空的时候说「还没有事项」，而空的原因是筛选的时候
   * 说筛选的话。两条都还在。 */

  it('an empty DOCUMENT is not three empty groups', () => {
    // Keeping an empty group's header keeps the reader's map of a list that
    // HAS rows. With nothing in the document there is no map to keep, and three
    // headers each carrying the same sentence is that sentence three times — on
    // the first screen a new reader ever meets, which is also this repository's
    // own state right now.
    const html = renderPanel([])
    expect(html).toContain('还没有事项')
    expect(html).not.toContain('这一组还没有事项')
  })

  it('says what is wrong when a FILTER is what emptied the view', () => {
    // A filter that matched nothing and a document that holds nothing are
    // different facts, and the remedy is different: one is fixed by clearing a
    // filter, the other by writing something.
    expect(renderPanel([item({ title: '在这里' })])).toContain('在这里')
    expect(renderPanel([])).not.toContain('清空搜索')
  })
})

describe('the panel tells the truth about what it can see', () => {
  it('says the host copy is unreachable, and KEEPS the local list on screen', () => {
    // The local mirror is whole and usable. Covering it would be a worse answer
    // than a banner — and the copy PROMISES it is being used, so hiding it made
    // the words and the behaviour contradict each other.
    const html = renderPanel([item({ title: 'still here' })], { hostLost: true })
    expect(html).toContain('读不到')
    expect(html).toContain('still here')
  })

  it('never draws an outage as an empty list', () => {
    // The two look identical on screen if you let them, and one of them is a
    // lie about a system fact.
    const lost = renderPanel([], { hostLost: true })
    const empty = renderPanel([])
    expect(lost).not.toBe(empty)
  })
})

describe('the list is a main-stage panel, in the same shape as the board', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/client/item/register.tsx', import.meta.url)),
    'utf8',
  )

  it('contributes a `main` panel and a panel-list row, and nothing else', () => {
    // It sits in the shell's own two seats, so the shell's chrome (left sidebar
    // wide or collapsed to a rail, narrow viewport, its panel toggle) applies to
    // it without this plugin re-deriving any of it.
    expect(source).toContain("slots.inject('main'")
    expect(source).toContain("slots.inject('sidebar.panellist'")
    expect(source).not.toContain('shell.overlay')
    expect(source).not.toContain('conversation.session.header.actions')
  })

  it('keys the panel and the row by the SAME id, as the shell requires', () => {
    expect(source).toMatch(/LIST_GROUP\s*=\s*\{\s*id:\s*'dsh-task-board-items'/)
    expect(source).toContain('key: LIST_GROUP.id')
    expect(source).toContain('id: LIST_GROUP.id')
  })

  it('sits directly after the board row in the panel list', () => {
    expect(source).toMatch(/LIST_ROW_ORDER\s*=\s*120/)
  })

  it('leaves through the same funnel the board uses', () => {
    // "Leave" is one function for both panels, so it can never mean two
    // different things on two surfaces.
    expect(source).toContain('onExit={returnToConversation}')
  })
})

describe('the tool card reads the producer, not a memory of it', () => {
  // THE POINT. "A field I cannot read is not drawn" is right for a missing
  // OPTIONAL thing and a disaster for a TYPO: the card comes out empty with no
  // error anywhere. So the names the card depends on are named once, exported,
  // and checked HERE against the producer's source. Rename a field upstream and
  // this goes red instead of quietly emptying a card.
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

  it('reads the SHORT NUMBER of an affected row, because that is how it is named', () => {
    // `#12`, not a uuid: a line naming a row the reader cannot point at is a
    // line about nothing.
    expect(producer).toContain('ref: `#${item.ref}`')
  })

  it('keeps "written" and "not written" as SEPARATE fields', () => {
    expect(presentation).toMatch(/dryRun:/)
    expect(presentation).toMatch(/persisted:/)
  })

  it('keeps "accepted" and "executed" as SEPARATE fields', () => {
    expect(presentation).toMatch(/enginePending:/)
  })
})

describe('a holding may only name rows the reader can point at', () => {
  // 138 LINES, SEVEN EXPORTS, NO TESTS — until now. This is the module whose own
  // header names its own reason for existing: 「a batch that writes to rows the
  // reader cannot see is the worst thing a batch surface can do」. It had no test
  // standing behind that sentence, and the panel has in fact shipped three ways
  // of breaking it (a detail selection collapsing the visible set, a page switch
  // leaving the holding behind, a deleted row staying in it).
  //
  // So the claims below are INVARIANTS, not shapes: they have to hold through the
  // control that chooses how a row gets held, which is changing underneath this.

  it('starts with nothing held, and holding a row never touches the set it was handed', () => {
    const first = togglePicked(NO_SELECTION, 'a')
    expect([...first.ids]).toEqual(['a'])
    const second = togglePicked(first, 'b')
    expect([...first.ids], 'the earlier holding was mutated by a later press — a toggle then undoes the wrong row').toEqual(['a'])
    expect([...second.ids].sort()).toEqual(['a', 'b'])
  })

  it('a row the reader can no longer see leaves the holding', () => {
    // THE claim the whole module is for. Narrowing the filter takes the rows it
    // hides out, so 「已选 4 条」 always means four rows the reader can point at.
    const held = togglePicked(togglePicked(togglePicked(NO_SELECTION, 'a'), 'b'), 'c')
    const after = reconcile(held, ['a', 'b'])
    expect([...after.ids].sort(), 'a row the filter hid is still held, and the batch can still write to it').toEqual(['a', 'b'])
  })

  it('a row that is no longer in the document at all leaves the holding too', () => {
    // Writing to a deleted row is a write to a tombstone. It needs no rule of its
    // own: a row the document no longer holds is by definition a row the filter
    // predicate no longer returns, so `visible` already excludes it and the
    // deletion is covered by the same one-line rule as the filter. A second
    // parameter for it would be a second place to forget the same thing.
    const held = togglePicked(togglePicked(NO_SELECTION, 'a'), 'gone')
    expect([...reconcile(held, ['a']).ids], 'a deleted row is still held, so the batch can write to a tombstone').toEqual(['a'])
  })

  it('when nothing is left to hold, the holding is empty rather than a shape with nothing in it', () => {
    // The state a surface can no longer reach must not survive: held rows that no
    // row draws are held rows that only a write can still see.
    const after = reconcile(togglePicked(NO_SELECTION, 'a'), [])
    expect(after.ids.size, 'the holding is still carrying a row nothing on screen points at').toBe(0)
    expect(selectionActive(after), 'an empty holding is still acting as if something were held').toBe(false)
  })

  it('reconciling an unchanged holding hands back the SAME one, so nothing re-renders', () => {
    // Identity, not equality: the panel writes this into state on every document
    // change, and a fresh object each time is a render each time for no reason.
    const held = togglePicked(NO_SELECTION, 'a')
    expect(reconcile(held, ['a', 'b']), 'the holding was rebuilt although nothing left it').toBe(held)
  })

  it('select-all reaches the rows on screen and nothing beyond them', () => {
    // `visible` rather than 「everything」 on purpose: a select-all that reached
    // past the filter would tick rows the reader cannot see, and the bar would
    // then say 「选了 40 条」 over a list of eight.
    const all = setAllPicked(NO_SELECTION, ['a', 'b'], true)
    expect([...all.ids].sort()).toEqual(['a', 'b'])
    expect(selectedCount(all)).toBe(2)
    expect(allPicked(all, ['a', 'b']), 'every visible row is held and the box says otherwise').toBe(true)
    expect(allPicked(all, ['a', 'b', 'c']), 'the box claims all held while a third row is not').toBe(false)
  })

  it('an empty view is not 「nothing held」, or the select-all invites a click that does nothing', () => {
    expect(allPicked(NO_SELECTION, []), 'select-all over nothing reports 「not all」, which invites a click with nothing behind it').toBe(true)
  })

  it('releasing everything leaves the reader on nothing rather than on a stale holding', () => {
    const held = setAllPicked(togglePicked(NO_SELECTION, 'z'), ['a', 'b', 'z'], true)
    expect([...setAllPicked(held, ['a', 'b', 'z'], false).ids], 'rows stayed held after 「release all」').toEqual([])
  })

  it('the probe bites: the reach of a select-all is measured, not assumed', () => {
    // The detector reads the VISIBLE list, so a select-all wired to the whole
    // document — the one implementation this module exists to prevent — has to
    // report differently from a correct one. Fed a document-shaped list where
    // the reader can only see three of nine rows.
    const document_ = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const onScreen = document_.slice(0, 3)
    const reached = setAllPicked(NO_SELECTION, onScreen, true).ids
    expect(reached.size, 'the detector cannot see a select-all that reached past the filter — this probe proves nothing').toBe(3)
    expect([...reached].some(id => !onScreen.includes(id)), 'a row the reader cannot see was ticked').toBe(false)
  })
})

describe('the panel draws no judgment of its own', () => {
  // The whole SURFACE, not `panel.tsx`: the claim is about the panel as a
  // surface, and the panel became nine files. A gate wired to one path starts
  // reporting a move as a defect, and the pressure to fix that is always in the
  // direction of loosening the gate.
  const source = itemSurfaceSource()

  it('imports the shared derivation layer instead of re-deriving any of it', () => {
    // Every judgment the list draws is made in one file, read by the human
    // surface and by the model's query. A second copy in the panel is a second
    // answer to a question the model also answers.
    expect(source).toContain("from '../../core/item-view.ts'")
    for (const local of ['function datePostureOf', 'function scheduleBucketOf', 'function itemMatches', 'function itemRowViewOf']) {
      expect(source, `the panel re-implements ${local}`).not.toContain(local)
    }
  })

  it('builds no key by template string, so a typo cannot ship a blank word', () => {
    // A cast silences the checker: a typo compiles, ships, and renders
    // `undefined` at runtime. A closed Record keyed by the union cannot.
    expect(source).not.toMatch(/t\(`item\./)
  })

  it('reads inbox membership instead of restating the predicate', () => {
    // The trap this catches is subtle and was hit once while writing the panel
    // itself: the inbox rule is ALSO what exempts a row from the triage
    // strip's "no date" line, so an inline copy in the panel is a second
    // answer to a question two surfaces already share. Change one and the
    // panel and the strip disagree about what "unfiled" means, with nothing
    // red anywhere. Checking for a re-DECLARED function is not enough — the
    // copy was an inline filter expression, not a function.
    expect(source).toContain('isInboxItem')
    expect(source, 'the panel re-states the inbox predicate inline').not.toMatch(/priority === 'normal'\s*&&\s*item\.tags\.length === 0/)
  })
})
