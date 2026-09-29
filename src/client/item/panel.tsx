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
  ITEM_STATUS_ORDER,
  itemGroupCountsOf,
  itemMatchContextOf,
  itemMatches,
  itemPageCountsOf,
  itemRefOf,
  itemRowViewOf,
  parseItemQuery,
  type ItemPageId,
  type ItemStatusView,
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
import { Button } from '../board/ui.tsx'
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
import { InboxPage } from './pages/inbox.tsx'
import { ListPage } from './pages/list.tsx'
import { SchedulePage } from './pages/schedule.tsx'
import { newItemId } from './model.ts'
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
/**
 * The name of each group, read off the GROUP vocabulary.
 *
 * A row's group is what the reader sees it filed under; the value the row menu
 * writes is a different vocabulary (`item.status.*`) because it is a different
 * act. They read as the same word, and they are —but a header that silently
 * renders nothing because it reached for the wrong one is a header with no
 * name at all, which is exactly what happened once.
 */
const STATUS_LABEL: Readonly<Record<ItemStatusView, 'item.group.inProgress' | 'item.group.open' | 'item.group.blocked' | 'item.group.done'>> = {
  inProgress: 'item.group.inProgress',
  open: 'item.group.open',
  blocked: 'item.group.blocked',
  done: 'item.group.done',
}
/* The seven orderings' table moved to `filter-bar.tsx` with the control that
   reads it. It is deliberately NOT kept here as a second copy: a closed
   `Record` over `ItemSort` that no component renders is seven words nothing can
   click, and the day the model adds an eighth tier there would be two tables —
   one of them wrong, and the compiler perfectly happy about both. The agenda's
   `BUCKET_LABEL` and the list page's `TRIAGE_LABEL` moved the same way, to
   `pages/schedule.tsx` and `pages/list.tsx`: a table belongs to the page that
   renders it, not to the shell that used to render every page at once. */

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
  const [asked, setAsked] = useState<string | undefined>(undefined)
  /**
   * The reader's holding, for the batch. It is its own state and NOT a field on
   * `selected`, because `selected` is one row being READ in the detail rail and
   * this is many rows being ACTED ON — a batch that moved the detail selection
   * would end the row the reader was looking at, and a detail that moved the
   * batch would hide rows that are still held.
   */
  const [selection, setSelection] = useState<ItemSelection>(NO_SELECTION)
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
        const body = await itemsAsk({ taskId, ref: item.ref })
        setAsked(body.ok
          ? t('item.ask.said', { sessionId: body.sessionId })
          : t('item.ask.refused', { why: body.why }))
      } catch (error) {
        setAsked(t('item.ask.refused', { why: error instanceof Error ? error.message : String(error) }))
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
    if (clientId === undefined) { setAsked(t('item.undo.refused', { n: String(pending.ids.length) })); return }
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
      setAsked(back === pending.ids.length
        ? t('item.undo.done', { n: String(back) })
        : t('item.undo.partial', { back: String(back), total: String(pending.ids.length) }))
    })()
  }, [apply, items, replica])

  const promoteOne = useCallback((item: ItemRecord) => {
    setMenuRow(undefined)
    const controller = face.controller
    if (controller === undefined) { setAsked(t('item.promote.noBoard')); return }
    const plan = planItemPromotion(item)
    if (plan.kind === 'refused') {
      setAsked(plan.why === 'alreadyLinked'
        ? t('item.promote.already', { title: cards.find(card => card.id === plan.taskId)?.title ?? plan.taskId })
        : t('item.promote.noTitle'))
      return
    }
    const at = Date.now()
    const task = controller.createTask({ ...plan.task, status: 'todo' })
    if (task === undefined) { setAsked(t('item.promote.refused')); return }
    apply(applyItemPatch(items, item.id, { taskId: task.id }, at))
    setAsked(t('item.promote.said', { title: task.title.trim() === '' ? plan.task.title : task.title.trim() }))
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
    setAsked(moved > 0
      ? t('item.batch.said', { n: String(moved) })
      : t('item.batch.saidNone', { n: String(selection.ids.size) }))
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
    let asked = 0
    for (const item of items) {
      if (!selection.ids.has(item.id) || item.taskId === undefined) continue
      asked += 1
      askOne(item)
    }
    if (asked === 0) setAsked(t('item.batch.askOne', { n: String(selection.ids.size) }))
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

  const showDetailPane = !narrow
  const shown = selected !== undefined ? items.filter(item => item.id === selected) : items

  /**
   * A holding may only name rows the reader can point at.
   *
   * Narrow the filter and the rows it hides leave the holding; delete a held row
   * and it leaves too, because writing to a tombstone is a write to nothing. Both
   * would otherwise leave the bar saying 「已选 4 条」 over a list showing one, and
   * a bar that writes to rows the reader cannot see is the worst thing a batch
   * surface can do — so the rule that makes the holding honest lives in one
   * place instead of at every place the document can change.
   */
  useEffect(() => {
    const visible = shown.map(item => item.id)
    setSelection(current => reconcile(current, visible))
  }, [query.text, prefs.page, items, shown.length])

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
  const groupCounts = itemGroupCountsOf(items, running)

  const picked = selected === undefined ? undefined : items.find(item => item.id === selected)

  const detail = (item: ItemRecord | undefined) => (
    <ItemDetail
      item={item}
      cards={cards}
      counts={ITEM_STATUS_ORDER.map(status => ({ label: t(STATUS_LABEL[status]), value: groupCounts[status] }))}
      recent={[...items]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5)
        // `itemRefOf` rather than a template: a row the document has not
        // numbered yet has no name to show, and building `#${item.ref}` here
        // would put the ledger's own "nobody has numbered me" sentinel back on
        // screen —the exact thing the row line refuses to do.
        //
        // The `id` travels WITH the row and is what the click hands back: the
        // short number is a name to read, never an address, and picking a row by
        // its label is how a list ends up selecting the wrong one the day two
        // rows share a number shape.
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

  const rows = (list: readonly ItemRecord[]) => list.map(item => (
    <ItemRowLine
      key={item.id}
      view={itemRowViewOf(item, { now, running })}
      density={prefs.density}
      expanded={openRow === item.id}
      selected={selected === item.id}
      picking={selection.armed}
      picked={selection.ids.has(item.id)}
      onPick={() => setSelection(current => togglePicked(current, item.id))}
      inPlace={narrow}
      panelId="item"
      menuOpen={menuRow === item.id}
      asking={asking === item.id}
      onToggle={() => setOpenRow(openRow === item.id ? undefined : item.id)}
      onSelect={() => setSelected(item.id)}
      onAsk={() => askOne(item)}
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
    renderRows: rows,
  }
  /**
   * The batch bar, handed ONLY to the list page.
   *
   * The inbox and the agenda are never given one, which is how 「only the list
   * page batches」 is enforced — by not handing them the slot, rather than by
   * each of them deciding to ignore one it was given.
   */
  /** The rows the reader can see, which is what select-all may reach. */
  const visibleIds = shown.filter(item => itemMatches(item, query, matchCtx)).map(item => item.id)
  const batch = selectionActive(selection) ? (
    <ItemBatchBar
      count={selectedCount(selection)}
      onMark={status => applyToHeld({ status })}
      onPriority={priority => applyToHeld({ priority })}
      onDueToday={() => {
        // 「设截止」 means TODAY, stated as a day: a bare timestamp in a field
        // nobody opened is a number they cannot check, and the one gesture the
        // name promises is the one they can undo by reading it back.
        const midnight = new Date(now)
        midnight.setHours(0, 0, 0, 0)
        applyToHeld({ dueAt: midnight.getTime() })
      }}
      askable={[...selection.ids].filter(id => items.some(item => item.id === id && item.taskId !== undefined)).length}
      onAsk={askHeld}
      onRemove={removeHeld}
      onDone={() => setSelection(current => setArmed(current, false))}
    />
  ) : undefined
  const body = prefs.page === 'inbox'
    ? <InboxPage {...pageProps} />
    : prefs.page === 'list'
      ? <ListPage
        {...pageProps}
        counts={groupCounts}
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
        <header className={css.itemHeader}>
          <div className={css.itemHeaderRow}>
            <h1 className={css.itemHeadTitle}>{t('itemTab.title')}</h1>
            <p className={css.itemCount}>
              {filtering
                ? t('item.countFiltered', { shown: String(shown.length), total: String(items.length) })
                : t('item.count', { n: String(items.length) })}
            </p>
          </div>

          <div className={css.itemSearchRow}>
            <input
              className={css.itemSearch}
              value={prefs.search}
              placeholder={t('item.search')}
              aria-label={t('item.search')}
              onChange={event => choose({ search: event.target.value })}
            />
          </div>

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

          {/* ONE control, on the trailing edge, on all three pages and in both
              bands. It used to be hidden on a phone on the grounds that the
              second control "costs a whole line and says nothing the reader
              needs while they are scanning" —which is the move rule 11 bans
              outright, and it was wrong on its own terms too: row height is a
              SETTING the reader chose, and a phone reader could not change their
              own setting. It is a text action pressed when the roomy tier is the
              current one, never a filled button —switching row height is a
              preference, not an announcement. */}
          <div className={css.itemHeadActions}>
            <Button
              variant="ghost"
              size="sm"
              pressed={prefs.density === 'comfy'}
              onClick={() => choose({ density: prefs.density === 'comfy' ? 'compact' : 'comfy' })}
            >
              {/* The visible word is the TIER, not the control's own name, so
                  the control needs a name of its own —otherwise a screen reader
                  announces 「紧凑」 and the reader has no way to know it is a
                  setting about row height. It rides in as hidden text rather
                  than as an `aria-label`, because the shared `Button` takes its
                  props one by one and does not spread the rest, and reaching past
                  it would mean editing a component the whole board shares. The
                  name is the same in both bands; only the control's shape differs
                  by band, and the name must not drift with it. */}
              <span className={css.itemNameOnly}>{t('item.density')}</span>
              {t(prefs.density === 'comfy' ? 'item.density.comfy' : 'item.density.compact')}
            </Button>
          </div>

          <ItemComposer
            now={now}
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
        {asked !== undefined && <p className={css.itemState} role="status" data-ask-receipt="">{asked}</p>}

        <div className={css.itemWorkbench} ref={surfaceRef}>
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
