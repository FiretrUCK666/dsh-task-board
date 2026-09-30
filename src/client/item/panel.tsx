/**
 * The task list, as a workbench of three pages.
 *
 * WHAT THIS SURFACE IS FOR. The board answers "who is running". This answers
 * "what else is on me, which one is most urgent, and what am I doing today" — * and it is a set of PAGES rather than one long column because each page
 * answers a different question about the same rows. A page here is a
 * CLASSIFICATION, never a second rendering: a "list / board / calendar" switch
 * would duplicate the board sitting next to it, and two surfaces keeping the
 * same state is how both end up wrong.
 *
 * WHY THE SURFACE IS QUIET. The header carries exactly four things —title,
 * search, the page rail, the capture box —and everything else lives INSIDE the
 * page it acts on, beside the rows it acts on. Low density is not fewer
 * features; it is putting each feature next to the thing it changes.
 *
 * FOUR RULES THAT SHAPE EVERY MARKUP BELOW.
 *
 * 1. The page is a QUERY, never a second copy. A page filters and orders rows
 *    that live in one document; it stores nothing, so a row edited anywhere
 *    shows the same everywhere at the same moment.
 * 2. The page rail carries CONTAINER pages only. A derived view —a tag, the
 *    neglected rows, whatever a triage line opened —is a page you ARRIVE at,
 *    not a destination the rail grows. A rail that gains an entry every time
 *    the reader asks a question has turned a map into a log.
 * 3. "The host cannot be reached" and "you have nothing" look identical if you
 *    let them, so the degraded state says which one it is. Reporting an outage
 *    as an empty list is a lie about a system fact.
 * 4. Every judgment is made in `core/item-view.ts`, never here. This file
 *    draws, and its only decisions are which page is open and which row is
 *    selected.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ItemRecord } from '../../core/item.ts'
import {
  EMPTY_ITEM_QUERY,
  ITEM_PAGES,
  itemMatchContextOf,
  itemMatches,
  itemPageCountsOf,
  itemRefOf,
  itemRowViewOf,
  parseItemQuery,
  recentItemsOf,
  startOfDay,
  type ItemPageId,
  type ItemRowView,
} from '../../core/item-view.ts'
/* The write semantics are the model's, not this panel's: the same pure functions
   the agent's tool calls, so a field the model ruled derived cannot be written
   here either. `model.ts` keeps only what a browser can do and a document cannot
   — minting an id, and formatting a date. */
import { applyItemPatch, applyItemStep, captureItemRecord, isBlankCapture, planItemPromotion, removeItemRecord, restoreItemRecord, type ItemPatch } from '../../core/item-transitions.ts'
import { itemTitleOf } from '../../core/item.ts'
import { t } from '../locales.ts'
import { itemsAsk } from '../board-ask.ts'
import { itemsRestore } from '../items-archive.ts'
import { Button, Icon } from '../board/ui.tsx'
import { useSurfaceNarrow } from '../board/use-narrow.ts'
import { ItemComposer } from './composer.tsx'
import { ItemDetail } from './detail-pane.tsx'
import { ItemRowLine } from './row-line.tsx'
import {
  NO_SELECTION,
  allPicked,
  reconcile,
  selectionActive,
  selectedCount,
  setAllPicked,
  setArmed,
  togglePicked,
  type ItemSelection,
} from './selection.ts'
import { ItemBatchBar } from './batch-bar.tsx'
import { whyLabelOf } from './why-label.ts'
import { InboxPage } from './pages/inbox.tsx'
import { ListPage } from './pages/list.tsx'
import { SchedulePage } from './pages/schedule.tsx'
import { newItemId } from './model.ts'
import { useItemKeys } from './use-item-keys.ts'
import { ItemCommandPalette, type PaletteAction } from './command-palette.tsx'
import type { ItemKeyActions } from './keyboard.ts'
import { DEFAULT_VIEW_PREFS, readViewPrefs, writeViewPrefs, type ItemViewPrefs } from './view-prefs.ts'
import type { ItemListFace } from './register.tsx'
import css from './item.module.css'
import boardCss from '../board.module.css'

/** The three page names, as closed keys so no name is ever built by template. */
const PAGE_LABEL: Readonly<Record<ItemPageId, 'item.page.inbox' | 'item.page.list' | 'item.page.schedule'>> = {
  inbox: 'item.page.inbox',
  list: 'item.page.list',
  schedule: 'item.page.schedule',
}
/** The accessible full name; the short one above is what a narrow rail can hold. */
const PAGE_ARIA: Readonly<Record<ItemPageId, 'item.page.inbox.aria' | 'item.page.list.aria' | 'item.page.schedule.aria'>> = {
  inbox: 'item.page.inbox.aria',
  list: 'item.page.list.aria',
  schedule: 'item.page.schedule.aria',
}
/* Every closed table moved to `labels.ts`, which is now the one place they live:
   priority, status, group, bucket, triage and the orderings. It is deliberately
   NOT kept here as a second copy: a closed `Record` over `ItemSort` that no
   component renders is seven words nothing can click, and the day the model adds
   an eighth tier there would be two tables — one of them wrong, and the compiler
   perfectly happy about both. A table belongs to whoever renders it, and there
   is now exactly one such place. */

export interface ItemListPanelProps {
  readonly face: ItemListFace
  readonly signal: AbortSignal
}

/** Whether a board card is running, keyed by card id. */
function runningMapOf(face: ItemListFace): Map<string, boolean> {
  const map = new Map<string, boolean>()
  const controller = face.controller
  if (controller === undefined) return map
  for (const task of controller.getSnapshot().tasks) {
    map.set(task.id, controller.liveStateOf(task.id) === 'running')
  }
  return map
}

/** Cards a row may hang off, already titled. Never assembled here. */
function cardsOf(face: ItemListFace): { id: string; title: string }[] {
  return (face.controller?.getSnapshot().tasks ?? [])
    .map(task => ({ id: task.id, title: task.title.trim() === '' ? task.description.trim().slice(0, 40) : task.title.trim() }))
    .filter(card => card.title !== '')
}

/**
 * The page body.
 * @param props - the slot's injected face and the plugin's own lifetime.
 * @returns the workbench, or the loading state while the replica settles.
 */
export function ItemListPanel(props: ItemListPanelProps) {
  const { face } = props
  const replica = face.replica
  const lifetime = props.signal

  const [items, setItems] = useState<readonly ItemRecord[]>(() => replica?.view() ?? [])
  const [prefs, setPrefs] = useState<ItemViewPrefs>(readViewPrefs)
  const [now, setNow] = useState(() => Date.now())
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [openRow, setOpenRow] = useState<string | undefined>(undefined)
  const [menuRow, setMenuRow] = useState<string | undefined>(undefined)
  /** The one-shot undo. `undefined` = nothing was just removed. */
  const [undo, setUndo] = useState<{ readonly ids: readonly string[]; readonly at: number } | undefined>(undefined)
  /**
   * How many rows the undo is putting back RIGHT NOW, or `undefined` when it is
   * not running.
   *
   * It is its own state and not a field on `undo` because the two have different
   * lifetimes: the receipt outlives the work (it still has to offer the button
   * and the thirty-day window after the rows are back), while this is true only
   * between the press and the last restore. Collapsing them would make the
   * receipt flicker through a third state it has no word for, and an undo whose
   * own affordance is the one that flickers is an undo nobody trusts.
   */
  const [restoring, setRestoring] = useState<number | undefined>(undefined)
  const [asking, setAsking] = useState<string | undefined>(undefined)
  /**
   * A receipt, and WHERE it belongs.
   *
   * `id` is the row it is about, and `undefined` means the receipt is about the
   * page — an undo, a refused promotion. That single optional field is what lets
   * one mechanism answer two different questions, because the question 「whose
   * receipt is this」 is answered by the receipt rather than by which of two
   * states happened to be set.
   */
  const [receipt, setReceipt] = useState<{ readonly id: string | undefined; readonly words: string } | undefined>(undefined)
  /**
   * The reader's holding, for the batch. It is its own state and NOT a field on
   * `selected`, because `selected` is one row being READ in the detail rail and
   * this is many rows being ACTED ON — a batch that moved the detail selection
   * would end the row the reader was looking at, and a detail that moved the
   * batch would hide rows that are still held.
   */
  const [selection, setSelection] = useState<ItemSelection>(NO_SELECTION)
  /**
   * WHERE THE KEYBOARD CURSOR IS, which is its own state and not the detail
   * selection.
   *
   * They are two different things that happen to both be 「a row」. The cursor is
   * where `J`/`K`/`E`/`1`–`4`/`D` act, and it moves down a list that has nothing
   * to do with what the detail rail is showing; on the narrow band there is no
   * rail at all and the cursor still moves. Folding one into the other would
   * mean every cursor move also rewrites what the reader is reading, which is
   * why they are two names here and why the key map is handed this one.
   */
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  /**
   * The palette's open state STARTS from the view record rather than from `false`.
   *
   * It is a `useState` INITIALISER, so it is read once and everything after that
   * is the reader's own presses: a record cannot re-open the palette mid-session,
   * and the capture is of a panel that genuinely opened rather than of one held
   * open by a prop. `view-prefs.ts` has why the key is never written; this is the
   * other end of it.
   */
  const [paletteOpen, setPaletteOpen] = useState(() => prefs.overlay === 'palette')
  /** Bumped by the `A` key; the composer moves its caret when it changes. */
  const [captureFocus, setCaptureFocus] = useState(0)
  const seeded = useRef(false)

  // The detail lives beside the list only when there is room for both. The
  // measurement is of THIS surface, never the viewport, so it is right when the
  // shell sidebar opens, splits or collapses.
  const [narrow, surfaceRef] = useSurfaceNarrow('[data-dsh-taskboard-view]', 1080)

  // Deadlines age in front of the reader, and only while the panel is on
  // screen: a clock ticking for a surface nobody is looking at spends the
  // reader's battery on a picture they cannot see.
  useEffect(() => {
    const tick = (): void => setNow(Date.now())
    const timer = window.setInterval(tick, 60_000)
    const stop = (): void => window.clearInterval(timer)
    lifetime.addEventListener('abort', stop, { once: true })
    return () => { stop(); lifetime.removeEventListener('abort', stop) }
  }, [lifetime])

  // The replica is the only source of the list; a rebuild shows up here.
  useEffect(() => {
    if (replica === undefined) { setItems([]); return }
    const read = (): void => {
      setItems(replica.view())
      seeded.current = true
    }
    read()
    return replica.onRemote(read)
  }, [replica])

  const apply = useCallback((next: readonly ItemRecord[]) => {
    if (next === items) return
    setItems(next)
    replica?.setItems(next)
  }, [items, replica])

  /**
   * Change the view, and REMEMBER it only when it is the kind of choice that
   * outlives the session.
   *
   * The search text is the one field that is deliberately never persisted, so
   * writing on every keystroke would put a string into storage on each letter
   * only for `writeViewPrefs` to drop it —a write per character for a value
   * nobody keeps. The state still updates either way; only the write is
   * conditional.
   */
  const choose = useCallback((next: Partial<ItemViewPrefs>) => {
    setPrefs(current => {
      const merged = { ...current, ...next }
      const outlives = Object.keys(next).some(key => key !== 'search')
      if (outlives) writeViewPrefs(merged)
      return merged
    })
  }, [])

  const running = useMemo(() => runningMapOf(face), [face.controller, items])
  const cards = useMemo(() => cardsOf(face), [face.controller, items])
  const query = useMemo(() => (prefs.search.trim() === '' ? EMPTY_ITEM_QUERY : parseItemQuery(prefs.search)), [prefs.search])
  const matchCtx = useMemo(() => ({ ...itemMatchContextOf(now), running }), [now, running])
  const lostHost = replica?.hostLostItems() === true
  const filtering = prefs.search.trim() !== ''

  const askOne = useCallback((item: ItemRecord) => {    // Read once: the closure outlives this line, and a property re-proven
    // inside an async callback is a narrowing that stops holding when the
    // reader renames the row mid-flight.
    const taskId = item.taskId
    if (taskId === undefined) return
    setAsking(item.id)
    void (async () => {
      try {
        // The row's IDENTITY, not its number. A row the document has not numbered
        // yet carries `ref === 0`, and the host resolving a request by number
        // would answer with the first unnumbered row in the document — handing a
        // different note to the model while this reader watches their own row go
        // into the box. The number travels too, because it is what the receipt
        // shows, but the id is what addresses.
        const body = await itemsAsk({ taskId, id: item.id, ref: item.ref })
        // The receipt carries the ROW, so it is drawn under the button that earned
        // it rather than at the top of a card the reader has already scrolled past.
        setReceipt({ id: item.id, words: body.ok
          ? t('item.ask.said', { sessionId: body.sessionId })
          // A SENTENCE, not the host's vocabulary. `board-ask.ts` answers with a
          // code on purpose — the host decides the fact, the panel owns the words,
          // and the words have to be translated — and the panel was then printing
          // the code into a Chinese sentence, so the most common failure a reader
          // meets (the host being briefly unreachable) read 「没能交给模型：
          // noLiveAgent」. A thrown network error was worse: an English
          // `AbortError: The operation was aborted.` after the 8s timeout.
          : t('item.ask.refused', { why: whyLabelOf(body.why).words }) })
      } catch (error) {
        setReceipt({ id: item.id, words: t('item.ask.refused', { why: whyLabelOf(error instanceof Error ? error.message : String(error)).words }) })
      } finally {
        setAsking(undefined)
      }
    })()
  }, [])

  /**
   * Turn one row into a board card —THE ONLY ACTION HERE THAT WRITES TWO
   * DOCUMENTS, so it says so in its receipt rather than reporting a single
   * 「凡已生效」: that sentence is TRUE of both documents and useless for
   * telling them apart, and a reader who cannot tell which side failed has no
   * way to know whether to look at the row or at the card.
   *
   * The decision is NOT made here. `planItemPromotion` is the model's, shared
   * with the agent's tool call, and it is what decides whether this is even a
   * promotion: a row already hanging off a card is reported as the state it is
   * rather than performed a second time (a second card would leave the note
   * pointing at whichever one was written last), and a row with no title at all
   * is refused with a sentence instead of minting a card with no name.
   *
   * THE ORDER IS THE WHOLE SUBTLETY, and it is not arbitrary: the card is created
   * BEFORE the link, because a half-finished promotion that leaves a card
   * without its link is indistinguishable from a note nobody promoted, while the
   * other order leaves the note pointing at a card that does not exist —a state
   * the interface would have to render as a defect.
   */
  /**
   * Delete is one press and one undo, and the undo is the ONLY thing standing
   * between the reader and a tombstone —so the receipt says both: that it can be
   * taken back now, and that afterwards there are thirty days and an archive.
   * A receipt that only said 「deleted」 would be true and useless.
   *
   * IT RESTORES BY THE ROW'S OWN ID, never by its number. A row the reader wrote
   * a minute ago has `ref === 0` —the document has not numbered it yet —so a
   * restore addressed by number finds no tombstone, the route answers 200, the
   * document does not change, and the one promise this receipt makes would be the
   * one thing that silently does not happen. The short number is what a person
   * says out loud; it is not an address.
   */
  const removeOne = useCallback((item: ItemRecord) => {
    setMenuRow(undefined)
    setUndo({ ids: [item.id], at: Date.now() })
    if (selected === item.id) setSelected(undefined)
    apply(removeItemRecord(items, item.id))
  }, [apply, items, selected])

  /** Take it back. One call per row, because the archive is addressed one at a
   *  time —and every outcome is reported, so a batch that only half came back
   *  says so rather than reporting a single 「one」.
   *
   *  AND THE ROW GOES BACK THE MOMENT THE HOST CONFIRMS IT, rather than waiting
   *  for a broadcast to bring it. Undo is the one gesture here that a reader
   *  presses AFTER the thing they want has already left the screen, so waiting
   *  for a message is waiting while they watch — and if that message is late,
   *  coalesced or lost, they pressed 撤销 and saw nothing happen, having just
   *  destroyed something and been relying on this. A control whose only visible
   *  effect is a sentence about a change you cannot see is a dead control. */
  const runUndo = useCallback(() => {
    const pending = undo
    setUndo(undefined)
    if (pending === undefined) return
    const clientId = replica?.clientId()
    if (clientId === undefined) { setReceipt({ id: undefined, words: t('item.undo.refused', { n: String(pending.ids.length) }) }); return }
    setRestoring(pending.ids.length)
    void (async () => {
      let back = 0
      let next = items
      for (const id of pending.ids) {
        const reply = await itemsRestore({ id }, clientId)
        if (reply.ok && reply.restored !== undefined) {
          back += 1
          next = restoreItemRecord(next, reply.restored)
        }
      }
      if (back > 0) apply(next)
      setRestoring(undefined)
      setReceipt({ id: undefined, words: back === pending.ids.length
        ? t('item.undo.done', { n: String(back) })
        : t('item.undo.partial', { back: String(back), total: String(pending.ids.length) }) })
    })()
  }, [apply, items, replica])

  const promoteOne = useCallback((item: ItemRecord) => {
    setMenuRow(undefined)
    const controller = face.controller
    if (controller === undefined) { setReceipt({ id: item.id, words: t('item.promote.noBoard') }); return }
    const plan = planItemPromotion(item)
    if (plan.kind === 'refused') {
      setReceipt({ id: item.id, words: plan.why === 'alreadyLinked'
        ? t('item.promote.already', { title: cards.find(card => card.id === plan.taskId)?.title ?? plan.taskId })
        : t('item.promote.noTitle') })
      return
    }
    const at = Date.now()
    const task = controller.createTask({ ...plan.task, status: 'todo' })
    if (task === undefined) { setReceipt({ id: item.id, words: t('item.promote.refused') }); return }
    apply(applyItemPatch(items, item.id, { taskId: task.id }, at))
    setReceipt({ id: item.id, words: t('item.promote.said', { title: task.title.trim() === '' ? plan.task.title : task.title.trim() }) })
  }, [apply, cards, face.controller, items])

  /**
   * Apply one patch to every held row, through the SAME writer the row menu uses.
   *
   * It reports how many rows actually CHANGED rather than how many it touched,
   * because `applyItemPatch` returns the very same array for a row that was
   * already in that state — and a bar that said 「改了 7 条」 after a reader
   * pressed 「标为待办」 on seven rows that already were 待办 would be the batch
   * version of a button that legally does nothing.
   */
  const applyToHeld = useCallback((patch: ItemPatch) => {
    const at = Date.now()
    let moved = 0
    let next = items
    for (const id of selection.ids) {
      const after = applyItemPatch(next, id, patch, at)
      if (after !== next) { moved += 1; next = after }
    }
    if (moved > 0) apply(next)
    // A batch is about MANY rows, so it has no row of its own: `undefined` puts
    // the receipt at the top of the card, which is also where the batch bar is.
    setReceipt({ id: undefined, words: moved > 0
      ? t('item.batch.said', { n: String(moved) })
      : t('item.batch.saidNone', { n: String(selection.ids.size) }) })
  }, [apply, items, selection.ids])

  /** Delete every held row as ONE act, so one undo puts the whole batch back. */
  const removeHeld = useCallback(() => {
    const ids = [...selection.ids]
    if (ids.length === 0) return
    setUndo({ ids, at: Date.now() })
    let next = items
    for (const id of ids) next = removeItemRecord(next, id)
    apply(next)
  }, [apply, items, selection.ids])

  /** Hand the held rows that HAVE a card to their sessions, and say if some did not. */
  const askHeld = useCallback(() => {
    let askable = 0
    for (const item of items) {
      if (!selection.ids.has(item.id) || item.taskId === undefined) continue
      askable += 1
      askOne(item)
    }
    // NO RECEIPT WHEN EVERY ASK LANDED. Each row that went through prints its own
    // receipt under its own button, so a batch receipt on top of them would say
    // the same thing twice — and the top one is the one that costs the reader
    // nothing, because it is the furthest from the rows it is about.
    if (askable === 0) setReceipt({ id: undefined, words: t('item.batch.askOne', { n: String(selection.ids.size) }) })
  }, [items, selection.ids])

  if (replica === undefined) {
    return (
      <div className={css.itemPanelStage} data-dsh-taskboard-view="">
        <div className={css.itemRoot}>
          <p className={css.itemState} role="status">{t('item.loading')}</p>
        </div>
      </div>
    )
  }

  /**
   * THE ROWS THE READER CAN POINT AT — one list, asked once, and every consumer
   * of it reads the same value.
   *
   * The question is 「which rows pass the filter」, and the answer deliberately
   * does NOT depend on which page is drawn or on what the detail rail is holding.
   * A value that answered 「the rows the detail rail is about」 instead looks
   * reasonable and is wrong in a way nothing on screen reveals: on the wide band
   * the rail is always there, so 「a row is selected」 is the NORMAL state, and a
   * list derived from it collapses to the single row being read. Every batch
   * affordance is built on it — the select-all box ticks that one row and reports
   * 「all held」, and the bar counts it as one while forty rows sit on screen.
   * So the set is named once, here, and nothing downstream re-asks.
   */
  const visibleIds = useMemo(
    () => items.filter(item => itemMatches(item, query, matchCtx)).map(item => item.id),
    [items, query, matchCtx],
  )

  /**
   * A holding may only name rows the reader can point at.
   *
   * Narrow the filter and the rows it hides leave the holding; delete a held row
   * and it leaves too, because writing to a tombstone is a write to nothing. Both
   * would otherwise leave the bar saying 「已选 4 条」 over a list showing one, and
   * a bar that writes to rows the reader cannot see is the worst thing a batch
   * surface can do — so the rule that makes the holding honest lives in one
   * place, against the one set of pointable rows, instead of at every place the
   * document can change.
   */
  useEffect(() => {
    setSelection(current => reconcile(current, visibleIds))
  }, [visibleIds])

  /* THREE NUMBERS AND ONE DECOMPOSITION, and no fourth anywhere.
     The rail's three and the header's total are read from the map of the
     document, which does not read the clock and does not read the filter —a
     count that moved when the reader typed would be a count about the search
     wearing the name of a count about their work. The group breakdown is the
     map's own decomposition and is ALWAYS four tiers, so the numbers the reader
     can add up are exactly the ones the document holds. It used to be sliced
     out of `itemSlicesOf`, which meant the breakdown silently lost the finished
     group whenever the finished switch was off —a summary whose denominator
     answered to a control nobody could see. */
  const pageCounts = itemPageCountsOf(items)

  const picked = selected === undefined ? undefined : items.find(item => item.id === selected)

  /**
   * THE DETAIL RAIL APPEARS WHEN A ROW IS CHOSEN, and not before.
   *
   * It used to be a permanent 595px — 37% of a wide stage — showing 「还没选中任何
   * 一条」, a second hint and five recently-touched rows, and being empty the rest
   * of the time. **A column that holds 37% of the width and says nothing for 80%
   * of the time is rented land.** The reader has not asked for a second place to
   * look, and their rows are in the other column.
   *
   * This is the spine's own rule applied sideways. The header keeps only what the
   * reader needs in the moment; a detail rail for a row nobody is reading is the
   * horizontal version of a control for a filter nobody set.
   *
   * AND THE LIST DOES NOT GROW WHEN IT GOES, which looks like a bug in a
   * screenshot and is not: `--item-list-col` is a capped measure, so 960px is the
   * most this content should ever be, and widening the list into the space would
   * only pull the title further from the date beside it. A centred 960px column is
   * the right shape for a list with nothing beside it.
   *
   * On the NARROW band there was never a rail — the detail opens in the row — so
   * this changes nothing there, which is why it needs no second answer for the
   * phone.
   */
  const showDetailPane = !narrow && picked !== undefined
  /** The projection, built once per row, read by the row line and the detail alike. */
  const viewOf = (item: ItemRecord | undefined): ItemRowView | undefined =>
    item === undefined ? undefined : itemRowViewOf(item, { now, running })

  const detail = (item: ItemRecord | undefined) => (
    <ItemDetail
      view={viewOf(item)}
      cards={cards}
      recent={recentItemsOf(items, 5)
        // `itemRefOf` rather than a template: a row the document has not
        // numbered yet has no name to show, and building `#${item.ref}` here
        // would put the ledger's own "nobody has numbered me" sentinel back on
        // screen —the exact thing the row line refuses to do.
        //
        // The `id` travels WITH the row and is what the click hands back: the
        // short number is a name to read, never an address, and picking a row by
        // its label is how a list ends up selecting the wrong one the day two
        // rows share a number shape.
        //
        // The ORDER and the COUNT are `recentItemsOf`'s, not this component's: a
        // component that sorts its own list is a component holding a second
        // opinion about what 「recently」 means, and the reader has no way to
        // discover that the two disagree.
        .map(row => ({ ref: itemRefOf(row).text ?? '—', title: itemTitleOf(row), id: row.id }))}
      onPickRecent={id => setSelected(id)}
      onEdit={(patch: ItemPatch) => { if (item !== undefined) apply(applyItemPatch(items, item.id, patch, Date.now())) }}
      onToggleStep={stepId => {
        if (item === undefined) return
        // The shared writer SETS a step rather than toggling it, so the new
        // state is stated here. Inverting a boolean the caller never read is how
        // a click on a stale row flips the wrong step.
        const step = item.steps.find(one => one.id === stepId)
        if (step === undefined) return
        apply(applyItemStep(items, item.id, stepId, !step.done, Date.now()))
      }}
      onRemove={() => { if (item !== undefined) removeOne(item) }}
    />
  )

  /* ROWS, AS A FACTORY, and the picking state is a PARAMETER — because the
     pickbox must not follow the rows to pages that have no batch surface.

     The batch BAR is only handed to the list page, and the panel's comment here
     claimed the omission of multi-select on the other two pages was "enforced by
     not handing them the slot". It was not: `picking` was read from the shared
     holding inside this factory, so the factory handed every page a picking
     state. Arm on 清单, switch to 日程, and the agenda's rows carried pickboxes
     that ticked rows into a holding with **no bar on the page and no way to
     disarm**. PRODUCT.md says the inbox and the agenda have no multi-select at
     all, and per AGENTS.md PRODUCT wins: **the code is what changes.**

     So the state arrives as an argument and each page says what it accepts.
     The list page passes the real one; the other two pass `false`, which is the
     same thing the list page passed before anyone could select anything. */
  const rows = (list: readonly ItemRecord[], picking: boolean) => list.map(item => (
    <ItemRowLine
      key={item.id}
      view={itemRowViewOf(item, { now, running })}
      expanded={openRow === item.id}
      selected={selected === item.id}
      picking={picking}
      picked={selection.ids.has(item.id)}
      onPick={() => setSelection(current => togglePicked(current, item.id))}
      inPlace={narrow}
      panelId="item"
      menuOpen={menuRow === item.id}
      asking={asking === item.id}
      onToggle={() => setOpenRow(openRow === item.id ? undefined : item.id)}
      onSelect={() => { setSelected(item.id); setCursor(item.id) }}
      onAsk={() => askOne(item)}
      receipt={receipt?.id === item.id ? receipt.words : undefined}
      onMenuToggle={() => setMenuRow(menuRow === item.id ? undefined : item.id)}
      onMenuClose={() => setMenuRow(undefined)}
      onMark={status => { apply(applyItemPatch(items, item.id, { status }, Date.now())); setMenuRow(undefined) }}
      onPromote={() => promoteOne(item)}
      onRemove={() => removeOne(item)}
      detail={narrow ? detail(item) : undefined}
    />
  ))

  /* The page body: three files, one contract. Each page owns its own content and
     nothing else may reach in here — which is what keeps this an assembly layer
     rather than a 900-line file with three sections of it pretending to be
     separate. The archive deliberately lives INSIDE the list page: it is a
     list-page entry, and it is the one thing here with three states instead of
     two, so all three of them belong to the page that owns it. */

  /**
   * THE KEYBOARD FLOW'S HANDLERS, and every one of them is a writer that already
   * exists. `E` is not a second rename, `1`–`4` are not a second priority
   * picker, `⌘⌫` is not a second delete: they call the same
   * `core/item-transitions` function the menu calls, so a field the model ruled
   * derived cannot be written from the keyboard either, and a reader who
   * switches between mouse and hands cannot reach two different documents.
   *
   * The cursor walks THE FILTERED DOCUMENT, because that is the list the reader
   * is looking at — and a cursor that walks a different list from the one on
   * screen is a cursor that lands on a row they cannot see, which is the same
   * failure the batch holding has.
   */
  const keyActions = useMemo<ItemKeyActions>(() => ({
    quickCapture: () => setCaptureFocus(count => count + 1),
    moveNext: () => setCursor(current => stepCursor(current, 1)),
    movePrev: () => setCursor(current => stepCursor(current, -1)),
    pick: () => { if (cursor !== undefined) setSelection(current => togglePicked(current, cursor)) },
    rename: () => { if (cursor !== undefined) setSelected(cursor) },
    open: () => { if (cursor !== undefined) setSelected(cursor) },
    close: () => {
      if (paletteOpen) { setPaletteOpen(false); return }
      if (menuRow !== undefined) { setMenuRow(undefined); return }
      if (openRow !== undefined) { setOpenRow(undefined); return }
      if (selected !== undefined) setSelected(undefined)
    },
    priority: arg => { if (cursor !== undefined && arg !== undefined) apply(applyItemPatch(items, cursor, { priority: arg }, Date.now())) },
    dueToday: () => { if (cursor !== undefined) apply(applyItemPatch(items, cursor, { dueAt: startOfDay(now) }, Date.now())) },
    remove: () => {
      const target = cursor === undefined ? undefined : items.find(item => item.id === cursor)
      if (target !== undefined) removeOne(target)
    },
    undo: () => { if (undo !== undefined) runUndo() },
    palette: () => setPaletteOpen(true),
  // EVERY VALUE A HANDLER READS IS IN THIS LIST, and that sentence is here
  // because leaving one out is not a lint warning — it is a key that silently
  // does the wrong thing. `close` reads `paletteOpen`, `menuRow`, `openRow` and
  // `selected`; with those missing from the dependency list the handlers kept
  // closing over the values from the render that BUILT them, so `Esc` asked
  // 「is the palette open?」 about a `false` from before the palette opened and
  // closed something else instead. The keyboard flow is the only thing here that
  // runs outside a React event handler, so nothing re-renders it behind the
  // reader's back and nothing complained.
  }), [apply, cursor, items, menuRow, now, openRow, paletteOpen, removeOne, runUndo, selected, undo])

  /** The next cursor position, which CLAMPS rather than wraps. */
  function stepCursor(current: string | undefined, by: number): string | undefined {
    if (visibleIds.length === 0) return undefined
    const at = current === undefined ? -1 : visibleIds.indexOf(current)
    const next = at < 0 ? (by > 0 ? 0 : visibleIds.length - 1) : Math.min(visibleIds.length - 1, Math.max(0, at + by))
    return visibleIds[next]
  }

  useItemKeys({
    state: { focusedId: cursor, somethingOpen: paletteOpen || menuRow !== undefined || openRow !== undefined },
    actions: keyActions,
    surfaceRef,
  })

  const pageProps = {
    items,
    now,
    running,
    query,
    matchCtx,
    prefs,
    choose,
    narrow,
    filtering,
    picking: selection.armed,
    renderRows: rows,
  }
  /**
   * The batch bar, handed ONLY to the list page.
   *
   * The inbox and the agenda are never given one, which is how 「only the list
   * page batches」 is enforced — by not handing them the slot, rather than by
   * each of them deciding to ignore one it was given.
   *
   * AND THE SLOT WAS NOT THE ONLY CHANNEL. `renderRows` used to read the shared
   * holding itself, so the pickbox followed the rows onto the other two pages
   * while the bar did not: arm on the list, switch to the agenda, and there were
   * checkboxes ticking into a holding with no bar and no way to disarm. So the
   * picking state now arrives as an ARGUMENT — `picking` on the page props — and
   * the two pages that have no batch surface pass `false`. **Not handing the slot
   * enforces the bar; passing the state enforces the pickbox. Both, or neither.**
   */
  /** The rows the reader can see, which is what select-all may reach. */
  /**
   * How many rows the CURRENT FILTER leaves, counted the way the list counts.
   *
   * The header's 「显示 X 条，共 M 条」 is a sentence about the filter, so it is
   * answered with the filter's own predicate over the whole document — and it is
   * the same predicate and the same document as the pointable set above, so the
   * sentence and the select-all box can never give two answers to 「筛选留下了几条」
   * on one screen. It is counted here rather than read off `visibleIds` so the
   * two are visibly the same computation and not two that happen to agree.
   */
  const matchedCount = visibleIds.length
  const batch = selectionActive(selection) ? (
    <ItemBatchBar
      count={selectedCount(selection)}
      onMark={status => applyToHeld({ status })}
      onPriority={priority => applyToHeld({ priority })}
      onDueToday={() => {
        // 「设截止」 means TODAY, stated as a day: a bare timestamp in a field
        // nobody opened is a number they cannot check, and the one gesture the
        // name promises is the one they can undo by reading it back.
        //
        // The DAY BOUNDARY IS `startOfDay`, the model's, shared with the capture
        // box and with the three date readings. Writing it out here would be a
        // fourth answer to 「where is midnight」 — and this one is the worst kind,
        // because a `new Date(now); setHours(0,0,0,0)` reads as the obvious thing
        // to write and differs from the shared one the moment a device is not on
        // the same offset, which is the moment two devices disagree about a date.
        applyToHeld({ dueAt: startOfDay(now) })
      }}
      askable={[...selection.ids].filter(id => items.some(item => item.id === id && item.taskId !== undefined)).length}
      onAsk={askHeld}
      onRemove={removeHeld}
      onDone={() => setSelection(current => setArmed(current, false))}
    />
  ) : undefined
  /* THE PALETTE'S ANSWERS, and the page names are here rather than in the
     palette: a page is a PRODUCT CONSTANT the model owns, and a palette that
     listed its own would be a second page rail written in a different place.
     Jump-to-page lives here because typing a page name is the one thing a reader
     does with a palette that is not a filter, and typing beats hunting. */
  const paletteActions = useMemo<PaletteAction[]>(() => [
    ...ITEM_PAGES.map(page => ({
      id: `page-${page}`,
      label: t(PAGE_LABEL[page]),
      run: () => choose({ page }),
    })),
    /* THE BATCH DOOR CAME HERE WITH THE REST. The filter bar used to carry a
       「多选」 button, and taking the bar out to stop the duplication would have
       left a keyboard-only path into the whole batch surface — the same defect as
       a palette only the keyboard can open, one level worse, because a batch is a
       way of doing forty things rather than one. `X` on a row still picks; these
       are the two things a reader asks for that are not about a single row. */
    ...(visibleIds.length > 0
      ? selection.armed
        ? [{ id: 'batch-all', label: t('item.batch.all'), run: () => setSelection(current => setAllPicked(current, visibleIds, true)) }]
        : [{ id: 'batch-arm', label: t('item.batch.arm'), run: () => setSelection(current => setArmed(current, true)) }]
      : []),
    { id: 'filter-clear', label: t('item.filter.clear'), run: () => choose({ search: '' }) },
    { id: 'undo', label: t('item.undo.do'), run: () => { if (undo !== undefined) runUndo() } },
  ], [undo, runUndo, visibleIds, selection.armed])

  const body = prefs.page === 'inbox'
    ? <InboxPage {...pageProps} />
    : prefs.page === 'list'
      ? <ListPage
        {...pageProps}
        clientId={replica?.clientId()}
        batch={batch}
        armed={selection.armed}
        onArm={on => setSelection(current => setArmed(current, on))}
        allPicked={allPicked(selection, visibleIds)}
        onPickAll={on => setSelection(current => setAllPicked(current, visibleIds, on))}
        selectable={visibleIds.length > 0}
      />
      : <SchedulePage {...pageProps} />

  return (
    <div className={css.itemPanelStage} data-dsh-taskboard-view="">
      <div className={css.itemRoot}>
        <ItemCommandPalette
          open={paletteOpen}
          text={prefs.search}
          onText={next => choose({ search: next })}
          query={query}
          tags={items.map(item => item.tags)}
          sort={prefs.sort}
          onSort={next => choose({ sort: next })}
          onPriority={cursor === undefined ? undefined : priority => apply(applyItemPatch(items, cursor, { priority }, Date.now()))}
          rows={items}
          actions={paletteActions}
          onPickRow={id => { setSelected(id); setCursor(id) }}
          onClose={() => setPaletteOpen(false)}
        />
        <div className={css.itemWorkbench} ref={surfaceRef}>
          {/* THE LIST COLUMN: the header, the status lines and the list card are
              ONE column, because the header acts on the list. Measured on a 1440
              board: the header ran x=0..1440 while the card ran x=24..744, so the
              search box — which filters the ROWS — sat at x≈1010..1360, on top of
              the DETAIL pane. The header's own rule already says it: 「每个功能都要
              挨着它改变的东西」. A control 700px from the thing it changes is a
              control the reader has to reason about rather than use. */}
          <div className={css.itemListColumn}>
<header className={css.itemHeader}>
          <div className={css.itemHeaderRow}>
            <h1 className={css.itemHeadTitle}>{t('itemTab.title')}</h1>
            <p className={css.itemCount}>
              {filtering
                /* THE MATCH SET, not the detail selection. `shown` is 「which
                   rows the detail rail is about」, so using its length here printed
                   「显示 42 / 共 42 条」 over a list of three rows the filter left,
                   and 「显示 1 / 共 42 条」 the moment a row was picked. The
                   sentence claims to be about the FILTER, so it has to be counted
                   the way the filter counts — one predicate, the same one the list
                   is drawing from, not a second count of something nearby. */
                ? t('item.countFiltered', { shown: String(matchedCount), total: String(items.length) })
                : t('item.count', { n: String(items.length) })}
            </p>
            {/* THE ONE MOUSE DOOR INTO THE PALETTE, and it sits on the title row
                because that row is about the whole surface rather than about the
                list. Before this, `⌘K` was the ONLY way to open it: a filter a
                mouse cannot reach is a filter the phone does not have, and hard
                rule 11 counts that as a REMOVED control rather than a moved one.

                THE GLYPH IS TEXT, not an icon, and the reason is that the shared
                icon set has no search glyph — and a panel that invents its own
                glyph for one button has drawn a second visual language to say
                something it already has a word for. `⌘K` is what the key is.

                IT IS NOT A LABEL BUTTON. A visible 「搜索」 at this size competes
                with the page title it sits beside, and the reader who wants to
                find something is the one already looking at the list. The name
                reaches assistive technology; the glyph reaches everyone else.

                IT IS A DIRECT CHILD OF THE HEADER, and it was inside the title
                row, which put it in the `title` cell and left the `actions` cell
                empty. **CSS cannot fix that**: `order` only moves a container's
                own direct children, and the button was a grandchild — so the cell
                the stylesheet reserved for it was simply never filled, and no
                amount of stylesheet work could have moved it there. Structure, not
                style, and the structure is what this line is.

                The other repair — declaring an `actions` cell INSIDE the title row
                — would have put the button to the LEFT of the page rail, which
                splits the first line in two. A spine reads as one line of identity
                and then the navigation; a search trigger wedged between them is
                neither. */}
          </div>
          <button
            type="button"
            className={css.itemCommandTrigger}
            aria-label={t('item.palette.open')}
            title={t('item.palette.open')}
            onClick={() => setPaletteOpen(true)}
          >
            <span aria-hidden="true">⌘K</span>
          </button>

          {/* NO SEARCH BOX IN THE SPINE. The box is in the command palette, which
              `⌘K` and `/` open, and the palette holds the same single string
              through the same callbacks — so the filter is one fact with one
              writer, it is simply written in a box that does not cost 190px of
              the first screen. What the spine keeps INSTEAD is the answer: the
              state bar names what is filtered, and the count beside the title
              says what is left. */}
          <div className={css.itemPageRail} role="tablist" aria-label={t('item.page.rail')}>
            {ITEM_PAGES.map(page => (
              <button
                key={page}
                type="button"
                role="tab"
                aria-selected={prefs.page === page}
                // The count is INSIDE the accessible name, not beside it. An
                // `aria-label` replaces the element's own text, so a number
                // rendered next to the word would be announced to nobody —and
                // the number is the reason to pick this tab over the other two.
                aria-label={t(PAGE_ARIA[page], { n: String(pageCounts[page]) })}
                className={`${css.itemPageTab}${prefs.page === page ? ` ${css.itemPageTabActive}` : ''}`}
                onClick={() => choose({ page })}
              >
                {t(PAGE_LABEL[page])}
                <span className={css.itemPageTabCount}>{pageCounts[page]}</span>
              </button>
            ))}
          </div>

          <ItemComposer
            now={now}
            focusRequest={captureFocus}
            onSave={input => {
              // The refusal belongs to the EDITOR, not to the writer: a blank
              // capture is decided by the shared emptiness rule, and refusing it
              // here changes nothing AND keeps the words, so the reader can
              // finish the thought instead of losing it to a surprise.
              if (isBlankCapture(input)) return false
              const made = captureItemRecord(input, Date.now(), newItemId)
              apply([...items, made.item])
              return true
            }}
          />
        </header>

        {/* Reading in-flight, unreachable and syncing are THREE different
            facts, and NEITHER hides the list: the local mirror is whole and
            usable, so covering it would be a worse answer than a banner. A row
            written here is already on screen before the host has it, and saying
            so is the difference between "saved" and "saved everywhere". */}
        {lostHost
          ? <p className={css.itemState} role="status">{t('item.hostLost')}</p>
          : replica.isSynced() === false && <p className={css.itemState} role="status">{t('item.syncing')}</p>}
        {/* ONLY THE RECEIPTS WITH NO ROW OF THEIR OWN. A receipt that is about one
            row is drawn beside that row, under the control that earned it — a
            receipt about 「问 AI」 printed at the top of the card is a sentence
            about a button the reader is no longer looking at, and it is read after
            the eye has already moved on. */}
        {receipt !== undefined && receipt.id === undefined && (
          <p className={css.itemState} role="status">{receipt.words}</p>
        )}

                  {/* THE LIST CARD, and the scroll body inside it. Two boxes, because
              one box cannot be the page's frame and its scroller at the same
              time: as the scroller it had no frame, and as the frame it could
              not scroll. The card is the grid item that draws; the scroller is
              its second child.

              `.dshTbScroll` is the SHARED scroll mount —the one class the
              board's thin-bar rules are written against. The list's own sheet
              deliberately does not restate them, so a Chromium change moves one
              mechanism instead of two that drift. */}
          <div className={css.itemListCard}>
            <div className={`${css.itemScroll} ${boardCss.dshTbScroll}`}>
              {/* THE RECEIPT. It sits at the top of the list the row left, not in
                  a corner and not in a dialog: the reader's eye is already here,
                  and an undo that has to be found is an undo that is not used.
                  It states BOTH halves of the promise —the undo that is
                  available now, and the thirty-day window that remains after it
                  is spent —because a receipt that only said 「removed」 would be
                  true and useless. */}
              {undo !== undefined && (
                <div className={css.itemReceipt} role="status">
                  <span className={css.itemReceiptText}>
                    {restoring !== undefined
                      ? t('item.undo.working')
                      : t('item.undo.said', { n: String(undo.ids.length) })}
                  </span>
                  <span className={css.itemReceiptWindow}>{t('item.archive.window')}</span>
                  {restoring === undefined && (
                    <Button variant="ghost" size="sm" onClick={runUndo}>{t('item.undo.do')}</Button>
                  )}
                </div>
              )}
              {body}
            </div>
          </div>
          </div>
          {showDetailPane && (
            <div className={css.itemDetailPane}>
              {/* The pane is titled by the ROW ON SHOW, never by one of the five
                  section names inside it. A section name as a page title says
                  「here are the fields」 before the reader knows which row they
                  are looking at —and the whole point of the pane is that the
                  list beside it stays readable.

                  With nothing picked the head is NOT EMPTY, which is the whole
                  requirement: an empty box with a bottom border is a rule
                  floating in a column with nothing above or below it, and it
                  reads as a page that failed to finish loading. The sentence
                  below it is not repeated here for the same reason. */}
              {picked === undefined
                ? <h2 className={css.itemDetailHead}>{t('item.detail.emptyTitle')}</h2>
                : (
                  <h2 className={css.itemDetailHead}>
                    <span className={css.itemRef}>{itemRefOf(picked).text ?? '—'}</span>
                    {' '}
                    {itemTitleOf(picked)}
                    {/* THE WAY OUT, ON THE BAND THAT HAS NO OTHER ONE.
                        The narrow band opens the row in place and the row toggles
                        itself closed, so it never needed a control. The wide band
                        opens a SEPARATE pane, and it had none at all: `setSelected
                        (undefined)` existed at exactly one place in this file — the
                        delete path — so above 1080px a reader could open a row and
                        not leave it except by deleting the row they were reading.

                        A pane you cannot close is not a pane, it is a trap, and the
                        reader's way out has to be a control rather than a fact
                        about the layout. It is the LAST thing in a flex row, so it
                        takes the head's free space instead of pushing the title
                        anywhere. */}
                    <button
                      type="button"
                      className={`${css.iconButton} ${css.itemDetailClose}`}
                      aria-label={t('item.detail.close')}
                      title={t('item.detail.close')}
                      onClick={() => { setSelected(undefined) }}
                    >
                      <Icon name="close" />
                    </button>
                  </h2>
                )}
              <div className={css.itemDetailInner}>
                <div className={`${css.itemDetailBody} ${boardCss.dshTbScroll ?? ''}`}>
                  {detail(picked)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Re-exported so the panel's own contract test can name the defaults. */
export { DEFAULT_VIEW_PREFS }
