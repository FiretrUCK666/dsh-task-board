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
    for (const aria of ['刚记下、还没给它结构的条目', '全部没做完的事', '按时间排的事']) {
      expect(html, aria).toContain(aria)
    }
  })

  it('keeps the surface to four things: title, search, the rail and the capture box', () => {
    // Low density is not fewer features; it is putting each feature next to the
    // thing it changes. Grouping, filtering, ordering and batching live INSIDE
    // the page, beside the rows they act on.
    const html = renderPanel([item()])
    expect(html).toContain('itemSearch')
    expect(html).toContain('itemPageRail')
    expect(html).toContain('itemComposer')
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

  it('sits in the header, NOT inside the scrolling region', () => {
    // If it scrolled away with the list, a long list would carry it out of
    // reach — which is the whole failure this assertion exists to prevent.
    const html = renderPanel([item()])
    const scrollAt = html.indexOf('itemWorkbench')
    const composerAt = html.indexOf('itemComposer')
    expect(scrollAt).toBeGreaterThan(-1)
    expect(composerAt).toBeGreaterThan(-1)
    expect(composerAt).toBeLessThan(scrollAt)
  })

  it('teaches its own syntax on the box, not behind a menu', () => {
    // A capture syntax nobody can find is a syntax nobody uses, and the reader
    // falls back to filling in four fields before the thought is safely down.
    expect(renderPanel([])).toContain('#标签')
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
    // READ THE ROW, NOT THE PAGE, and the reason is specific rather than
    // stylistic. The claim is about the WORD this row's own date line uses, and
    // a page-wide search for a forbidden word is not that claim: the overview
    // strip's own tile is labelled with the same two characters, so the search
    // started reporting this row as loud because an UNRELATED control elsewhere
    // on the surface uses the same word — and the cheapest response to that red
    // is to rename a correct label, which fixes the symptom and destroys the
    // tile. A gate that punishes a word appearing anywhere is a gate about
    // vocabulary, not about tone.
    const row = /<li[^>]*>[\s\S]*?Slipped[\s\S]*?<\/li>/.exec(renderPanel([item({ dueAt: Date.now() - 3 * DAY, title: 'Slipped' })]))?.[0] ?? ''
    expect(row, 'the row is not on the page at all — both assertions below would pass on an empty string').not.toBe('')
    expect(row).toContain('落后')
    expect(row, 'a slipped plan is being painted as an overrun — red is reserved for a missed HARD deadline').not.toContain('超期')
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

  it('is absent on a row with no card, rather than explaining itself on press', () => {
    // A button whose only possible outcome is to say "there is nothing to hand
    // it to" is lying about what it does.
    expect(renderPanel([item()])).not.toContain('问 AI')
  })
})

describe('empty is two different facts, and they do not look the same', () => {
  it('an empty GROUP inside a list that has rows keeps its header, its count and nothing else', () => {
    // A group that disappears the moment it empties reads as a broken filter
    // rather than an empty queue, and the reader loses the map of the list.
    // So the HEADER stays — and the count beside it stays, and says zero.
    //
    // THE SENTENCE UNDER IT IS GONE, and this half of the case used to pin the
    // opposite. 「这一组还没有事项」 was printed once per empty group, so a
    // document with two empty buckets said the same thing twice, in the middle
    // of a list that had rows in it — the reader is told a bucket is empty
    // before they have any reason to ask, and the page reads as though part of
    // it failed. The count is the statement: a group head that says 0 IS the
    // sentence, and it is in the one place the reader looks for the map.
    const html = renderPanel([item({ id: 'a', ref: 1, status: 'open' })])
    // Every bucket is on screen, named, with its number.
    for (const label of ['进行中', '待办', '受阻']) {
      expect(html, `the ${label} bucket is missing from a list that still has rows`).toContain(label)
    }
    const heads = [...html.matchAll(/itemGroupToggle[^>]*>([\s\S]*?)<\/button>/g)]
      .map(match => (match[1] ?? '').replace(/<[^>]*>/g, ''))
    expect(heads.length, 'no group header was rendered at all').toBeGreaterThan(0)
    // A bucket with nothing in it reports a zero rather than nothing.
    expect(heads.some(text => /进行中\D*0/.test(text)), `no empty bucket reports 0: ${JSON.stringify(heads)}`).toBe(true)
    // The three heads together account for every row the document holds, so
    // the numbers on screen and the number in the header are the same fact told
    // two ways — a header that says 「共 7 条」 beside three buckets adding up to
    // 5 is a page disagreeing with itself.
    const shown = heads.map(text => Number(/(\d+)\s*$/.exec(text)?.[1] ?? Number.NaN))
    expect(shown.every(Number.isInteger), `a bucket reports no number: ${JSON.stringify(heads)}`).toBe(true)
    expect(shown.reduce((sum, n) => sum + n, 0), 'the three bucket counts do not add up to the document').toBe(1)
    // And the sentence that repeated itself is not there any more.
    expect(html.includes('这一组还没有事项') ? `…${html.slice(Math.max(0, html.indexOf('这一组还没有事项') - 120), html.indexOf('这一组还没有事项') + 40)}…` : 'none',
      'the per-group emptiness sentence is back').toBe('none')
  })

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
