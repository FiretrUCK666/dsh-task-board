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
import { ITEM_PAGES, type ItemPageId } from '../src/core/item-view.ts'
import { zh } from '../src/client/locales.ts'
import { ItemListPanel } from '../src/client/item/panel.tsx'
import { formatItemDate } from '../src/client/item/model.ts'
import { ItemRowMenu, type RowMenuAction } from '../src/client/item/row-menu.tsx'
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
function fakeReplica(items: readonly ItemRecord[], over: { hostLost?: boolean; synced?: boolean; deleted?: readonly ItemRecord[] } = {}) {
  return {
    view: () => items,
    /** The rows behind a tombstone — the archive the rail's 「已删除」 counts.
     *  Empty is the honest default, not a stub that hides a missing read: a
     *  harness where nothing was deleted should draw 「已删除 0」. */
    archive: () => over.deleted ?? [],
    setItems: () => undefined,
    clientId: () => 'client-under-test',
    hostLostItems: () => over.hostLost === true,
    isSynced: () => over.synced !== false,
    onRemote: () => () => undefined,
  }
}

interface PanelBenchOptions {
  readonly hostLost?: boolean
  readonly synced?: boolean
  /** WHICH ROW IS OPEN AT MOUNT. `renderToStaticMarkup` presses nothing, so the
   *  expanded row is the one state a static render cannot reach by itself — and the
   *  date axis lives inside it. */
  readonly openRow?: string
  /** The clock the fixtures are dated against, so a date read here is about the
   *  same day the fixture was written for. */
  readonly now?: number
}

function renderPanel(items: readonly ItemRecord[], over: PanelBenchOptions = {}): string {
  return renderToStaticMarkup(createElement(ItemListPanel, {
    signal: new AbortController().signal,
    face: { replica: fakeReplica(items, over) as never, controller: undefined },
    ...(over.now === undefined ? {} : { now: over.now }),
    ...(over.openRow === undefined ? {} : { openRow: over.openRow }),
  }))
}

describe('the rail is the map, and the bar above the rows says three things', () => {
  /**
   * The row that OPENS each page, read from the dictionary the panel reads.
   *
   * Not the page's own name, and that difference is the point: the page is called
   * 清单 while the row that opens it is called 全部, because a row is named for
   * what it SHOWS rather than for the screen it happens to land on. A copy typed
   * here would go stale the first time either word changes, and the failure would
   * read as 「the rail lost a door」 when the rail is fine.
   */
  const PAGE_DOOR: Readonly<Record<ItemPageId, string>> = {
    list: zh['item.rail.all'] as string,
    schedule: zh['item.page.schedule'] as string,
  }

  it('every way into the document is a row in the rail, and every page has one', () => {
    // THE PROMISE IS 「NOTHING IS REACHABLE ONLY BY KEYBOARD」, and it is stronger
    // than the word list it used to check.
    //
    // 收件 was a page whose only door was the rail row 「刚记下的」, so removing the
    // row removed the page too — right, because the predicate behind it
    // (`isInboxItem`) is still read by the query grammar and the triage strip, and a
    // page nothing can reach is dead UI.
    //
    // 日程 is the OPPOSITE defect and this is the assertion that would have caught
    // it: it has always been a page, and its only route was the command palette. A
    // whole page reachable only from ⌘K is 「a control reachable only from a
    // keyboard does not exist for a thumb」 one level up.
    //
    // So the check is the PAGE SET against the rail, not a list of words: every
    // page has a row, and the two places that are not pages have one too. Marrying
    // the two tables is what makes a page added without a door a red test.
    const html = renderPanel([])
    for (const page of ITEM_PAGES) {
      expect(html, `the page 「${page}」 has no row in the rail, so only the palette can open it`).toContain(PAGE_DOOR[page])
    }
    for (const where of ['全部', '已删除', '按日子看', '按重要程度', '按状态']) {
      expect(html, `${where} is no longer somewhere the reader can go`).toContain(where)
    }
    // And 收件 is gone from BOTH halves — no row, and no page to reach.
    expect(html, '收件 is still drawn somewhere').not.toContain('刚记下的')
    expect(ITEM_PAGES as readonly string[], 'the inbox is still a page, and nothing can open it').not.toContain('inbox')
  })

  it('the bar above the rows says three things, and the page title is not one of them', () => {
    // 这条断言的形状没变，**清单换了几样**：顶栏从「标题 + 页轨 + 统计带 + 筛选条
    // + 常驻快记框」变成「计数 · 搜索 · 筛选 · 命令 · 排序 · ＋新建一条」。
    //
    // 低密度不是功能变少，是**每样东西挨着它改变的那一样**。收件与全部进了左栏，
    // 统计卡进了左栏的数里，筛选条进了左栏加一枚按钮，快记文法进了新建面板的第一行。
    // 留下来的这三样说的是三句不同的话：「我在找什么」「我按什么排」「我怎么加一条」。
    const html = renderPanel([item({ dueAt: Date.now() - 3 * DAY })])
    for (const part of [
      'itemTopCount', // 计数：紧挨着搜索框
      'itemSearch', // 搜索
      'itemTopBarChip', // 筛选与排序
      'itemNewButton', // ＋新建一条
      'itemRail', // 左栏
    ]) {
      expect(html, `${part} is not on the surface — the strip no longer holds what it claims to hold`).toContain(part)
    }
    // 页标题与页轨都不在了：一个面板的头如果还要回答「我在第几页」，说明那本
    // 还是一本分页的书；而它现在是一张有导航的表。
    expect(html, 'a page title survived on a surface with a rail').not.toContain('itemPageTitle')
    expect(html, 'the page rail survived beside the rail that replaced it').not.toContain('itemPageRail')
    // 常驻快记框也走了：回车即存的框没法让人犹豫，而快记文法现在在新建面板里。
    expect(html, 'the always-on capture box came back').not.toContain('itemComposerChips')
  })
})

describe('capturing a row is one door, and it is the sheet it opens', () => {
  it('the door is on the strip in BOTH states — empty list and a list to read', () => {
    // 原来的断言钉的是**常驻快记框**在两种状态下都在，因为它会随行滚走。
    // 它现在不常驻了，而它要去的地方更硬：**快记文法成了新建面板的第一行**，
    // 所以面板永远有一枚「＋新建一条」，而回车即存的框再也拦不住一个还在想的人。
    //
    // 门在两种状态下都在，这条没变——变的是它通向哪里。
    expect(renderPanel([]), 'a first-time reader has no way to put a row down').toContain('itemNewButton')
    const withRows = renderPanel([item({ id: 'a', ref: 1, title: 'A note' })])
    expect(withRows).toContain('itemNewButton')
    expect(withRows).toContain('A note')
  })

it('the door is the LAST control on the strip, and the strip never scrolls away', () => {
    // A door that scrolls away with the rows is a door a reader with thirty things
    // to put down stops using.
    //
    // THE SCROLLER IS NOW `.itemFlow`, and this assertion used to stand in for it
    // with `.itemWorkbench` — which used to be the element that held the rows AND
    // scrolled. Splitting them (the bar moved beside the rail, so the column frames
    // the bar and only the flow below it scrolls) is what made the old proxy wrong:
    // it was measuring 「the thing that scrolls」 by a name that no longer names it.
    //
    // So the test names the scroller. The contract is unchanged and slightly
    // stronger for it: the door is not merely before the list, it is before the
    // element that actually takes the rows away with it.
    const html = renderPanel([item({ id: 'a', ref: 1, title: 'A note' })])
    const bar = html.indexOf('itemNewButton')
    const scroller = html.indexOf('itemFlow')
    expect(bar, 'the capture door is not in the render at all').toBeGreaterThan(-1)
    expect(scroller, 'the scrolling list is not in the render at all').toBeGreaterThan(-1)
    expect(bar, 'the capture door lives inside the scroller, so a long list takes it away').toBeLessThan(scroller)
  })

  it('teaches the capture syntax by writing it, not by symbols you have to recognise first', () => {
    // 一个没人找得到的快记文法就是没人用的快记文法，读者会退回去填四个字段。
    // 教一个文法的方式是**写一句、看着它被理解成什么**，所以 `#` `!` `@` 三枚
    // 可按的符号早就没了——一个刚上手的人点 `#`，得到一框 `#`，学到的是一个
    // 记号而不是一句话，而那是这一页上唯一能按、且要你先知道意思才会动的部分。
    const html = renderPanel([])
    expect(html, 'the syntax is taught by buttons you have to recognise before they help').not.toContain('itemComposerExamples')
    expect(html, 'the capture box came back as something always on screen').not.toContain('itemComposerChips')
    // 文法本身一个字都没改，它只是搬进了新建面板——所以它仍然得是**这一页写着
    // 它的那个东西**。这枚门就是那件事的入口。
    expect(html).toContain('itemNewButton')
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
// `itemRowTail[^"]*"` and not `itemRowTail"`: the class map hashes every name,
    // so the word on screen is `itemRowTail_a9e292` and a pattern that insists on
    // a closing quote straight after the word matches nothing at all.
    //
    // IT WAS A COLUMN, AND IT IS NOW PART OF THE SENTENCE. The reading was its own
    // cell so that a table could sort it; this is not a table, and a number in its
    // own box is a number the reader has to go and find. The words and the tone are
    // the same contract, only spoken from a different place.
    const cell = /<span class="[^"]*itemRowTail[^"]*"[^>]*>([^<]*)</.exec(html)?.[1] ?? ''
    expect(cell, 'the date reading states no words at all, so the tone below is being read off nothing').not.toBe('')
    expect(cell).toContain('落后')
    expect(cell, 'a slipped plan is being painted as an overrun — red is reserved for a missed HARD deadline').not.toContain('超期')
  })

  it('says a missed hard deadline as an overrun', () => {
    const html = renderPanel([item({ hardDueAt: Date.now() - 3 * DAY, title: 'Over' })])
    expect(html).toContain('超期')
  })

  it('keeps a not-yet-startable row out of every day reading', () => {
    // 该读法在**日期轴**上，而轴在展开区里 —— 而静态渲染不会展开任何一行，所以这个
    // 断言以前能看见它，是因为那时行上还印着第二个读法。行只印一个读法之后，读法
    // 住进了它该住的那一栏，断言也得跟着去那一栏。
    const gated = item({ startsAfter: T0 + 5 * DAY, title: 'Gated' })
    const html = renderPanel([gated], { openRow: gated.id, now: T0 })
    expect(html, 'the gate reading is not on screen even with the row open').toContain('最早')
  })
})
describe('the hand-off is one menu entry, and the row without a target says why', () => {
  const ask = (extra: Partial<RowMenuAction> = {}, others: readonly RowMenuAction[] = []): string =>
    renderToStaticMarkup(createElement(ItemRowMenu, {
      rowId: 'r-1',
      trigger: null,
      panel: null,
      onClose: () => undefined,
      actions: [{ key: 'ask', label: '问 AI', onPick: () => undefined, ...extra }, ...others] as readonly RowMenuAction[],
    }))

  it('is offered when the row hangs off a card', () => {
    expect(ask()).toContain('问 AI')
    expect(ask(), 'an available hand-off is drawn as a broken one').not.toContain('aria-disabled')
  })

  it('stays on a row with nothing to hand it to, and says what is missing', () => {
    // An entry that COMES AND GOES with a fact the interface never states is worse
    // than one that is always there and says 「not yet」: a reader scanning the menu
    // sees it on row two and not on row three and starts hunting for whatever they
    // think they have lost. The condition is real — a row with no card has no
    // session to ask — so the entry SHOWS the condition rather than hiding it.
    //
    // IT IS ASKED HERE, NOT OF THE PANEL'S MARKUP, because the menu is closed at
    // rest: `renderToStaticMarkup` never presses the `⋯`, so a panel-level
    // assertion about a menu entry is an assertion about nothing. The row's own
    // contract is that it HAS one door, and the entry's contract is this.
    //
    // BOTH HALVES, because an entry that is merely always there is the other half
    // of the same defect: 「问 AI」 with no reason and no state reads as a broken
    // one. `aria-disabled` is the state; the hint is the reason, and it is written
    // in the TEXT rather than only in a `title`, because touch has no hover.
    const html = ask({ disabled: true, hint: '这一条还没挂到任何一张卡上，挂上之后就能问它。' })
    expect(html).toContain('问 AI')
    expect(html, 'a row with no card still offers a working hand-off — pressing it can only say there is nothing to hand it to').toContain('aria-disabled="true"')
    expect(html, 'the disabled hand-off does not say what is missing').toContain('还没挂到')
  })

  it('pressing a disabled entry closes nothing and runs nothing', () => {
    let picked = 0
    const html = renderToStaticMarkup(createElement(ItemRowMenu, {
      rowId: 'r-1',
      trigger: null,
      panel: null,
      onClose: () => undefined,
      actions: [{ key: 'ask', label: '问 AI', onPick: () => { picked += 1 }, disabled: true }] as readonly RowMenuAction[],
    }))
    expect(html).toContain('itemRowMenuItem')
    expect(picked, 'a disabled entry ran its action').toBe(0)
  })

  it('the row carries ONE door, and it is the `⋯`', () => {
    // The row used to carry two controls for 「do something to this」 — a button
    // that asks, and a `⋯` that opens — at two different distances from each
    // other. The menu is one door and it lists what this row can be asked to do.
    const html = renderPanel([item({ taskId: 't-9' })])
    expect(html).toContain('itemRowDots')
    expect(html, 'a second affordance came back beside the menu').not.toContain('itemAsk')
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
   * 取代它的那一半在下面：文档是空的时候说那**一句**空话，而空的原因是筛选的时候
   * 说筛选的话。两条都还在。
   *
   * 这一条按**句首**断言而不是整句：那一句是文案，会被改写（它刚被改成设计稿的
   * 写法），而这条门禁要钉的是**「文档为空」与「筛选为空」是两句不同的话**这个区别。
   * 钉整句会让每一次改文案都变成一次改门禁，而改门禁的人多半会顺手把它放宽。 */

  it('an empty DOCUMENT is not three empty groups', () => {
    // Keeping an empty group's header keeps the reader's map of a list that
    // HAS rows. With nothing in the document there is no map to keep, and three
    // headers each carrying the same sentence is that sentence three times — on
    // the first screen a new reader ever meets, which is also this repository's
    // own state right now.
    const html = renderPanel([])
    expect(html).toContain('还没有')
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

it('a date prints its year only when the year is not this year', () => {
    // 「2026年10月19日」 beside a row whose verdict came from the panel's clock is
    // noise on every line, all of it repeating what the reader's own calendar
    // already says. So the year goes — and the rule is checked in BOTH
    // directions, because a formatter that simply never prints a year gets the
    // common case right and 「明年十月」 wrong, and a deadline is the one date
    // nobody may misread.
    const october19th = (year: number): number => new Date(year, 9, 19).getTime()
    const today = Date.now()
    const thisYear = new Date(today).getFullYear()
    expect(formatItemDate(october19th(thisYear), false, today)).toBe('10月19日')
    expect(formatItemDate(october19th(thisYear + 1), false, today)).toBe(`${thisYear + 1}年10月19日`)
    expect(formatItemDate(october19th(thisYear + 1), true, today)).toContain(String(thisYear + 1))
    expect(formatItemDate(october19th(thisYear), true, today)).not.toContain(String(thisYear))
  })

  it('the inbox predicate is declared once and READ, never re-stated', () => {
    // The trap this catches is subtle and was hit once while writing the panel
    // itself: the inbox rule is ALSO what exempts a row from the triage strip's "no
    // date" line, so an inline copy anywhere is a second answer to a question two
    // surfaces already share. Change one and the panel and the strip disagree about
    // what "unfiled" means, with nothing red anywhere. Checking for a re-DECLARED
    // function is not enough — the copy was an inline filter expression.
    //
    // 收件 THE PAGE IS GONE and the PREDICATE IS NOT: it still decides which rows the
    // triage strip's 「没日子的」 line skips and which rows `has:undated` exempts,
    // which is exactly where a predicate belongs. So the assertion moved from 「the
    // panel reads it」 to 「wherever it is used, it is READ」 — declared once, imported
    // by its readers, and never spelled a second time inline.
    expect(source, 'the panel re-states the inbox predicate inline').not.toMatch(/priority === 'normal'\s*&&\s*item\.tags\.length === 0/)
    const read = (path: string): string =>
      readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')
    expect(read('src/core/item-membership.ts'), 'the inbox predicate is not declared where it is supposed to live')
      .toContain('export function isInboxItem')
    for (const reader of ['src/core/item-triage.ts', 'src/core/item-query.ts']) {
      expect(read(reader), `${reader} does not read the inbox predicate, so it has its own answer to 「unfiled」`)
        .toContain('isInboxItem')
    }
  })
})