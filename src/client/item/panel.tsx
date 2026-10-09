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
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ItemRecord } from '../../core/item.ts'
import {
  EMPTY_ITEM_QUERY,
  ITEM_PAGES,
  dayTokenOf,
  itemMatchContextOf,
  itemMatches,
  itemRowViewOf,
  planItemNavigation,
  itemRailGroupsOf,
  railSiblingsOf,
  ITEM_SORTS,
  parseItemQuery,
  startOfDay,
  type ItemPageId,
  type ItemRailEntry,
  type ItemRowView,
} from '../../core/item-view.ts'
import type { TaskStatus } from '../../core/tasks.ts'
import { taskExecutable } from '../../core/tasks.ts'
import type { ItemStatus } from '../../core/item.ts'
import { SORT_GROUPS_BY_DAY, itemDayGroupsOf } from './day-groups.ts'
/* The write semantics are the model's, not this panel's: the same pure functions
   the agent's tool calls, so a field the model ruled derived cannot be written
   here either. `model.ts` keeps only what a browser can do and a document cannot
   — minting an id, and formatting a date. */
import { applyItemPatch, applyItemStep, captureItemRecord, isBlankCapture, planItemPromotion, removeItemRecord, restoreItemRecord, type ItemPatch, type ItemPromotionOverrides } from '../../core/item-transitions.ts'
import { itemTitleOf } from '../../core/item.ts'
import { t } from '../locales.ts'
import { itemsAsk } from '../board-ask.ts'
import { itemsRestore } from '../items-archive.ts'
import { Button } from '../board/ui.tsx'
import { useSurfaceNarrow } from '../board/use-narrow.ts'
import { ItemDetail } from './detail-pane.tsx'
import { ItemCreateDialog } from './item-create-dialog.tsx'
import { dayTokensIn, freeTextOf, isTokenIn, queryChipsOf, withFacetToken, withFreeText } from './facets.ts'
import { ItemRail } from './rail.tsx'
import { ItemQueryChips } from './query-chips.tsx'
import { SORT_LABEL } from './labels.ts'
import { localDayKey } from './model.ts'
import {
  NO_SELECTION,
  allPicked,
  pickThrough,
  reconcile,
  selectedCount,
  setAllPicked,
  setArmed,
  togglePicked,
  type ItemSelection,
} from './selection.ts'
import { ItemBatchBar } from './batch-bar.tsx'
import { whyLabelOf } from './why-label.ts'
import { ListPage } from './pages/list.tsx'
import { SchedulePage } from './pages/schedule.tsx'
import { newItemId } from './model.ts'
import { useItemKeys } from './use-item-keys.ts'
import { ItemCommandPalette, type PaletteAction, type PaletteCommands } from './command-palette.tsx'
import type { ItemKeyActions } from './keyboard.ts'
import { DEFAULT_VIEW_PREFS, readViewPrefs, writeViewPrefs, type ItemOverlay, type ItemViewPrefs } from './view-prefs.ts'
import type { ItemListFace } from './register.tsx'
import css from './item.module.css'

/** The page names, as closed keys so no name is ever built by template. */
const PAGE_LABEL: Readonly<Record<ItemPageId, 'item.page.list' | 'item.page.schedule'>> = {
  list: 'item.page.list',
  schedule: 'item.page.schedule',
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
  /**
   * WHICH ROW IS OPEN IN PLACE AT MOUNT, for the capture bench only.
   *
   * The expansion is the largest thing on this panel and the only state a static
   * render cannot reach by itself — `renderToStaticMarkup` presses nothing. So the
   * bench names a row here, and the product code has no idea a capture exists.
   */
  readonly openRow?: string
  /**
   * THE CLOCK TO START FROM, for the capture bench only.
   *
   * Every date on this panel is judged against one instant, and the bench cannot
   * supply that instant any other way: the panel owns its clock, so rows dated
   * relative to the bench's `NOW` were being read against the real `Date.now()`.
   * The two numbers are each individually plausible, which is why nothing caught it
   * — a fixture built to be nine days late simply photographed as fifteen days late.
   *
   * A SEED, not an override: the panel ages from here either way, so a seeded
   * capture still ticks, and a real panel starts at the real clock.
   */
  readonly now?: number
}

/**
 * **看板的栏，按卡片 id 索引。** 它原来只回答「那张卡在不在跑」（`boolean`），而清单
 * 的状态现在读整栏：一条挂卡的行走在哪一栏，是看板的事实，清单只读。名字跟着事实改。
 *
 * 读的是快照里的 `status`（卡片自己那一栏），不再是 `liveStateOf` 的活性判决——那是
 * 另一件事（它在不在工作），而「在哪一栏」就是 `status`。
 */
function cardsMapOf(face: ItemListFace): Map<string, TaskStatus> {
  const map = new Map<string, TaskStatus>()
  const controller = face.controller
  if (controller === undefined) return map
  for (const task of controller.getSnapshot().tasks) map.set(task.id, task.status)
  return map
}

/**
 * 哪些卡现在**跑得起来**（`taskExecutable`：执行 Prompt 非空），按卡片 id。
 *
 * 它存在的理由是「一个按下去什么都不会发生的控件」：清单给挂卡的行一枚「执行」，而一张
 * Prompt 为空的卡会被看板的执行门禁单点拦下来——拦得对，但**按下去的人是在清单上按的**，
 * 所以他必须在这一侧就看见理由（`detail.promptEmpty`），而不是按完一片安静。判据本身来自
 * core（`taskExecutable`），这一层只负责把它带上屏。
 */
function runnableMapOf(face: ItemListFace): Map<string, boolean> {
  const map = new Map<string, boolean>()
  const controller = face.controller
  if (controller === undefined) return map
  for (const task of controller.getSnapshot().tasks) map.set(task.id, taskExecutable(task))
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
  /* THE PANEL'S OWN CLOCK, and it is seeded rather than read.
   *
   * Every date on this surface is judged against one `now`: 「超期 15 天」, 「今天」,
   * 「这行是昨天写的」. If the reading bench cannot set it, then the bench's rows and
   * the bench's readings are about **different days** — the fixture says nine days
   * late, the clock says fifteen, and the screenshot is a true photograph of a
   * panel whose own date column contradicts its own fixture. That is exactly what
   * happened: `NOW` was pinned in the harness while the panel read `Date.now()`,
   * so every date in every capture was wrong by however far the two had drifted,
   * and nothing complained because both numbers are individually plausible.
   *
   * It is a seed, not an override: the tick that refreshes it runs either way, so a
   * seeded panel still ages, and a real one starts at the real clock.
   */
  const [now, setNow] = useState(() => (typeof props.now === 'number' ? props.now : Date.now()))
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [openRow, setOpenRow] = useState<string | undefined>(props.openRow)
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
   * THE ROW A RANGE STARTS FROM, and it is a ref because nothing renders it.
   *
   * A ref rather than state for the ordinary reason a caret position is a ref: it
   * is bookkeeping about what the reader did, and putting it in state would
   * re-render the whole list on every tick of a checkbox. It is NOT forgotten when
   * the holding is cleared, because 「从刚才那一条一直选到这里」 is a question
   * about the last press and not about how much is held right now.
   */
  const pickAnchor = useRef<string | undefined>(undefined)
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
   * THE INLINE-RENAME REQUEST, and why it is a {id, nonce} rather than a flag.
   *
   * `E` 真正要做的事是**进入这一行的标题编辑**——与行菜单里那一枚「改标题」是同一
   * 个手势，走到同一个编辑器。一个租约：读者每按一次 `E` 都要得到一次编辑进场，
   * 于是 nonce 只会涨；某一行把请求接走之后不再重放（行自己用它见过的 nonce 记
   * 账），面板也从不主动清它——清空的竞态与重置的竞态都不存在。
   */
  const [rename, setRename] = useState<{ readonly id: string; readonly nonce: number }>({ id: '', nonce: 0 })
  /**
   * The palette's open state STARTS from the view record rather than from `false`.
   *
   * It is a `useState` INITIALISER, so it is read once and everything after that
   * is the reader's own presses: a record cannot re-open the palette mid-session,
   * and the capture is of a panel that genuinely opened rather than of one held
   * open by a prop. `view-prefs.ts` has why the key is never written; this is the
   * other end of it.
   */
  /**
   * THE THREE THINGS THAT ARE OPEN OR SHUT, and each one starts from the view
   * record so a render can begin with one of them already open.
   *
   * `prefs.overlay` is read ONCE, as an initialiser: a record is a snapshot of a
   * panel that genuinely opened, and nothing after that is a reader's presses.
   * One reader for all of them rather than one `useState` per layer — a state per
   * layer is a state per layer that the bench has to be taught about.
   */
  const [overlay, setOverlay] = useState<ItemOverlay | undefined>(prefs.overlay)
  /** Toggle, and the toggle is what a disclosure wants: pressing the chip that is
   *  already open closes it. Reading the state is therefore the whole contract,
   *  so it is read from `overlay` at every call site rather than from a
   *  function that both reads and writes. */
  const openLayer = (next: ItemOverlay | undefined): void => setOverlay(current => (current === next ? undefined : next))
  const paletteOpen = overlay === 'palette'
  const sortOpen = overlay === 'sort'
  const topPanels = useId()
  /**
   * What the command box can be asked to do, and where the focus goes back to.
   *
   * Two refs, two directions, and no state: the box PUBLISHES its four commands
   * here (they are derived from its own text, so they are not this panel's to
   * compute), and this panel OWNS the trigger that opened it — so when the box
   * reports that it closed, the focus goes back to the control the reader
   * actually pressed. A modal surface that takes the caret and never gives it
   * back leaves the panel with no focus at all, and the next key answers to
   * nothing.
   */
  const paletteCommands = useRef<PaletteCommands | undefined>(undefined)
  /* THE ELEMENT THE FOCUS GOES BACK TO when the palette closes — and it is the SEARCH
   BOX.
   *
   * 它原来是一枚单独的「命令」按钮，就站在搜索框旁边：邻居 32px 而它 28px、形状也不
   * 一样、夹在两枚药丸中间——于是它自己变成了「这是什么」。而它存在的唯一理由是
   * 「一个只能键盘打开的控件等于没有」。**搜索框已经回答了那一条**（点它开面板、
   * 打字收窄它，本就是同一件事的两个阶段），所以入口就是搜索框，不再有第二枚控件。 */
  const paletteTrigger = useRef<HTMLInputElement | null>(null)
  /**
   * THE THREE THINGS THAT ARE OPEN OR SHUT, and each one starts from the view
   * record so a render can begin with one of them already open.
   *
   * `prefs.overlay` is read ONCE, as an initialiser: a record is a snapshot of a
   * panel that genuinely opened, and nothing after that is a reader's presses.
   */
  const [showDone, setShowDone] = useState(true)
  /* WHERE THE READER IS STANDS ON THE QUERY, and there is no second copy of it.
   *
   * It used to be a `useState` written on every press, for a reason that was
   * real: two of the rail's entries are SETS — 「刚记的」 and 「已删除」 — and a set
   * writes no token, so a highlight derived from the query alone would leave those
   * two unable to look selected. But the cure was worse than the disease. A
   * remembered highlight can claim a filter that is not on: pressing the same row
   * twice turned it OFF and left the row marked 「you are here」, and deleting the
   * text in the box by hand left it marked too — the reader sees 「超期了」
   * highlighted, with its number, over an unfiltered list.
   *
   * The two SETS are `collection`/`place` kinds, and they are the page's own state
   * (`prefs.page`), so they are derived from THAT. Derived from what is true, in
   * both halves, rather than remembered from what was pressed. */
  /* The rows behind a tombstone, read in the SAME place and the same tick as the
   *  live document — one subscription, one `read()`, two derived facts.
   *
   *  It used to be a `useMemo(… [replica, items])` reading `replica.archive()` on
   *  its own, and that dependency named the wrong source twice over: the tombstones
   *  live in the replica's DOCUMENT, so a restore that changed the tombstones but
   *  not the live array left the rail's 「已删除」 at its old number — the reader saw a
   *  count that had stopped being true, and the only thing that eventually moved it
   *  was the next unrelated re-render. A number derived from a document is only
   *  honest if it is read when that document is read. */
  const [deletedItems, setDeletedItems] = useState<readonly ItemRecord[]>(
    () => (replica === undefined ? [] : replica.archive()),
  )
  const railMonth = useMemo(() => localDayKey(now).slice(0, 7), [now])
  /**
   * Bumped by the row menu's 「编辑步骤」; the add field takes the caret when it
   * changes. A counter for the reason `captureFocus` is one — the same press has
   * to work twice, and a boolean that is already `true` cannot tell the second
   * press from the first.
   */
  const [stepsFocus, setStepsFocus] = useState(0)
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

  // The replica is the only source of the list; a rebuild shows up here. The
  // archive's own rows are read in the same place, from the same document: one
  // subscription, one read, so the rail's count and the list can never be one
  // revision apart.
  useEffect(() => {
    if (replica === undefined) { setItems([]); setDeletedItems([]); return }
    const read = (): void => {
      setItems(replica.view())
      setDeletedItems(replica.archive())
      seeded.current = true
    }
    read()
    return replica.onRemote(read)
  }, [replica])


  /**
   * The rows as the SCREEN has them, for the one handler that writes after it has
   * awaited something.
   *
   * Every other writer here reads and writes inside a single event, so the array
   * in its closure is the array on screen. Undo cannot: it makes one host round
   * trip per row and only then writes, and by that time the reader may have typed
   * into another row. A write built on the array from before the await reverts that
   * typing, and worse than locally — the reverted row differs from the replica, so
   * `setItems` claims it, and a claimed row wins the host merge unconditionally,
   * which pushes the stale value to every other device.
   *
   * TWO WRITERS KEEP IT CURRENT, and both are needed. `apply` updates it in the
   * same tick as the state write, because a reply can resume before React has
   * committed that write; the effect covers a change to `items` that did not come
   * through `apply`.
   */
  const itemsNow = useRef<readonly ItemRecord[]>(items)
  useEffect(() => { itemsNow.current = items }, [items])

  const apply = useCallback((next: readonly ItemRecord[]) => {
    if (next === items) return
    itemsNow.current = next
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

  const cardColumns = useMemo(() => cardsMapOf(face), [face.controller, items])
  const cardRunnable = useMemo(() => runnableMapOf(face), [face.controller, items])
  const cards = useMemo(() => cardsOf(face), [face.controller, items])
  const query = useMemo(() => (prefs.search.trim() === '' ? EMPTY_ITEM_QUERY : parseItemQuery(prefs.search)), [prefs.search])
  const matchCtx = useMemo(() => ({ ...itemMatchContextOf(now), cards: cardColumns }), [now, cardColumns])
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
      /* COLLECT FIRST, REBASE ONCE. Each row needs its own host round trip, so the
       * array this writes back must be read AFTER the last reply rather than
       * captured before the first one: the reader can edit another row while this
       * awaits, and a write built on the pre-await array would silently revert that
       * edit — locally, and then on the host too, because the row that changed
       * would be claimed by this client and a claimed row wins the merge
       * unconditionally. So the restored rows are collected, and the array they
       * merge into is the one on screen at the end. */
      const restored: ItemRecord[] = []
      for (const id of pending.ids) {
        const reply = await itemsRestore({ id }, clientId)
        if (reply.ok && reply.restored !== undefined) restored.push(reply.restored)
      }
      if (restored.length > 0) {
        let next = itemsNow.current
        for (const row of restored) next = restoreItemRecord(next, row)
        apply(next)
      }
      const back = restored.length
      setRestoring(undefined)
      setReceipt({ id: undefined, words: back === pending.ids.length
        ? t('item.undo.done', { n: String(back) })
        : t('item.undo.partial', { back: String(back), total: String(pending.ids.length) }) })
    })()
  }, [apply, replica, itemsNow])

  /** 把一条升级成看板卡片：写两份文档（先卡、后链接），顺序见 `planItemPromotion`。
   *
   * `over` 是「就地建卡」带进去的决定：选择器里那枚「新建卡片」给出名字，并明说
   * 「再开一张」——已经被链着的那条跳过 alreadyLinked 判定，是它的调用自己声明
   * 的，不是判定松了。回执编号记在这一条自己的行上，因为读者此刻就在看着它。 */
  const promoteOne = useCallback((item: ItemRecord, over?: ItemPromotionOverrides) => {
    setMenuRow(undefined)
    const controller = face.controller
    if (controller === undefined) { setReceipt({ id: item.id, words: t('item.promote.noBoard') }); return }
    const plan = planItemPromotion(item, over)
    if (plan.kind === 'refused') {
      setReceipt({ id: item.id, words: plan.why === 'alreadyLinked'
        ? t('item.promote.already', { title: cards.find(card => card.id === plan.taskId)?.title ?? plan.taskId })
        : t('item.promote.noTitle') })
      return
    }
    const at = Date.now()
    const task = controller.createTask({ ...plan.task, status: 'todo' })
    if (task === undefined) { setReceipt({ id: item.id, words: t('item.promote.refused') }); return }
    /* BASE IS `itemsNow.current`, NOT THE CLOSURE'S `items`. The caller may have
     * JUST captured the row this hangs (the new-sheet path calls capture first
     * and then asks for its card), so the closure's array is one write behind —
     * and a patch computed off the stale array erases the row the same tick
     * created it. The mirror is updated in the same keystroke as `apply`, so it
     * is the one base that is never behind. */
    apply(applyItemPatch(itemsNow.current, item.id, { taskId: task.id }, at))
    setReceipt({ id: item.id, words: t('item.promote.said', { title: task.title.trim() === '' ? plan.task.title : task.title.trim() }) })
  }, [apply, cards, face.controller])

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
          {/* 「还没有行」那一档，不是「有一行提示」。副本还没落定的时候这个面板
              本来就没有东西可画，一句居中的话是这个状态唯一正确的形状；一条贴着
              左沿的 11px 提示会像一行被漏掉的正文。 */}
          <p className={css.itemListEmpty} role="status">{t('item.loading')}</p>
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
  const viewOf = (item: ItemRecord): ItemRowView => itemRowViewOf(item, { now, cards: cardColumns })

  /* THE DETAIL IS BUILT FOR ONE ROW, and that row is the one it was asked about.
   * The prop is required rather than optional, so a caller cannot reach a
   * 「nothing picked yet」 branch that no reader can get to. */
  const detail = (item: ItemRecord) => (
    <ItemDetail
      view={viewOf(item)}
      cards={cards}
/* 这一条自己的五个动作，**传进去而不是查出来**。它们原来散在三处（⋯ 菜单、展
       * 开区最后一节、行上），读者要先知道某个动作住在哪才能按它；而查出来还意味着这
       * 个组件知道外面有什么全局状态——两件都不是好事。
       *
       * 「新建一张卡」在原地完成：选择器把名字递进来，提升照它的计划走。名字由
       * 读者在选择器里起，不替他决定；「再开一张」由这一枚按钮自己明说，所以已经
       * 挂着卡的那条也能换到一张新卡去。原来它把读者送去命令面板——那是一块
       * 搜索与筛选的面，连一张卡都造不出来，而按它的这个人恰恰最需要一张。 */
      now={now}
      onAsk={() => { if (item !== undefined) askOne(item) }}
      asking={item !== undefined && asking === item.id}
      /* 跑不跑得起来：同一份判据，同一个来源（见 `runnableMapOf`）。 */
      runnable={item.taskId === undefined ? undefined : cardRunnable.get(item.taskId) === true}
      onPromote={() => { if (item !== undefined) promoteOne(item) }}
      onStart={() => {
        const cardId = item?.taskId
        if (cardId !== undefined) void face.controller?.runTask(cardId, 'manual')
      }}
      onNewCard={name => { if (item !== undefined) promoteOne(item, { cardTitle: name, another: true }) }}
      onEdit={(patch: ItemPatch) => { if (item !== undefined) apply(applyItemPatch(items, item.id, patch, Date.now())) }}
      /* 挂着卡的那一行改的是**那张卡在哪一栏**，与 ⋯ 菜单里那三项同一个写入口
         （`task.move`）。没有看板可写时传 `undefined`，状态那一格于是只说事实、不给
         按钮——一个按下去什么都不会发生的控件比一个不在的控件糟。 */
      onMoveCard={face.controller === undefined
        ? undefined
        : (status: TaskStatus) => {
          const cardId = item.taskId
          if (cardId !== undefined) face.controller?.moveTask(cardId, status)
        }}
      /* THE CHECKLIST IS WRITTEN AS A WHOLE LIST, ONCE, THROUGH THE SAME PATCH
         every other field takes. The pane computed the new order with the shared
         pure functions and hands the answer over; this is the only place a step
         reaches the document, so a step added by thumb and a step added by the
         model are the same write. */
      onEditSteps={steps => { if (item !== undefined) apply(applyItemPatch(items, item.id, { steps }, Date.now())) }}
      stepsFocus={stepsFocus}
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

  /* ROWS, AS A FACTORY, and whether the page can batch is a PARAMETER — because
     the pickbox must not follow the rows to pages that have no batch surface.

     The batch BAR is only handed to the list page, and the panel's comment here
     claimed the omission of multi-select on the other two pages was "enforced by
     not handing them the slot". It was not: `picking` was read from the shared
     holding inside this factory, so the factory handed every page a picking
     state. Arm on 清单, switch to 日程, and the agenda's rows carried pickboxes
     that ticked rows into a holding with **no bar on the page and no way to
     disarm**. PRODUCT.md says the inbox and the agenda have no multi-select at
     all, and per AGENTS.md PRODUCT wins: **the code is what changes.**

     So the flag arrives as an argument and each page says what it accepts. The
     list page passes the real one; the other two pass `false`, which is the same
     thing the list page passed before anyone could select anything.

     THE MODE RIDES WITH IT (`armed`), because the tickbox is armed mode's own
     face and the agenda has no mode: a page that can batch passes the batch's
     armed state, a page that cannot passes `false`, and the two arguments travel
     together so no page can end up with a box and no bar, or a bar and no box. */
  /* AND IT HANDS OVER PROPS, NOT ELEMENTS. The table draws its own rows — the
     head and the body must agree on seven tracks, and a page that wrapped these
     in its own `<ul>` would be a second table without a head. */
  const rows = (list: readonly ItemRecord[], picking: boolean, armed: boolean) => list.map(item => ({
    view: itemRowViewOf(item, { now, cards: cardColumns }),
    expanded: openRow === item.id,
    selected: selected === item.id,
    cursor: cursor === item.id,
    picking,
    armed,
    picked: selection.ids.has(item.id),
    /* E 走的是这一个租约：只有游标那一行接得到，接到的 nonce 就是请它进场的
     * 申请编号。 */
    renameNonce: rename.id === item.id && rename.nonce > 0 ? rename.nonce : undefined,
     /* SHIFT IS A RANGE OVER WHAT IS ON SCREEN, and the anchor is remembered here
        rather than derived: the anchor is 「the last row this reader held with a
        plain press」, which is a fact about what they did, not a fact any row
        knows. A row cannot work it out, and a module that could would be holding
        a second opinion about where the reader started.

        THE ORDER ANSWERS TO WHAT THE TABLE DRAWS, not to `visibleIds` (document
        order): the exact cut is stated on the onPick below. */
    onPick: (extend: boolean) => {
      if (extend && pickAnchor.current !== undefined) {
        /* THE ORDER IS WHAT THE TABLE DRAWS. The page hands its own list, already
           sorted — and the list page then CUTS that list into days (今天/昨天/
           前天/更早) before drawing, so the run the reader crossed on screen is
           the day-cut order, not the document's. A range measured over the
           document's order picks rows the reader never passed between two presses;
           this is the same cut the table makes, from the same list, with the same
           clock, so it cannot disagree with what is drawn. */
        const order = (SORT_GROUPS_BY_DAY[prefs.sort]
          ? itemDayGroupsOf(list, now, prefs.sort).flatMap(group => group.rows)
          : list).map(one => one.id)
        setSelection(current => pickThrough(current, order, pickAnchor.current as string, item.id))
        return
      }
      pickAnchor.current = item.id
      setSelection(current => togglePicked(current, item.id))
    },
    /* THE DETAIL OPENS IN PLACE ON EVERY BAND. It used to open in a right-hand
     * pane on the wide one and in the row on the narrow one, so there were two
     * places to look for the same fields — and when the pane went, the wide band
     * was left with nowhere at all. One place, on every band: the row the reader
     * pressed, which is where their eyes already are. */
    inPlace: true,
    /* THE PANEL'S CLOCK GOES WITH THE ROW, so the date the row PRINTS is judged
       by the same now that decided whether it is late. Two clocks on one row is a
       row that says 「还早」 and shows last year's date. */
    now,
    panelId: 'item',
    /* THE ROW EDITS ITS OWN TITLE, THROUGH THE SAME WRITER. A hand-off rather
       than an import of the transition functions, so the row never learns how
       the document is written — and the patch it sends is the same patch the
       detail card sends, so 「改标题」 in two places is one edit. */
    onPatch: (patch: { readonly title: string }) => apply(applyItemPatch(items, item.id, patch, Date.now())),
    menuOpen: menuRow === item.id,
    asking: asking === item.id,
    /* A SECOND PRESS ON THE SAME ROW IS 「收起来」，and it takes EVERYTHING with
     * it: the sheet, the detail selection, and the keyboard cursor ring. If the
     * ring stayed behind, the collapsed row would still wear a bold rim — a
     * leftover with no gesture left to answer for. 收起来 = 恢复到没碰过的样子。
     */
    onToggle: () => {
      if (openRow === item.id) {
        setOpenRow(undefined)
        if (selected === item.id) setSelected(undefined)
        setCursor(current => (current === item.id ? undefined : current))
        return
      }
      setOpenRow(item.id)
    },
    onSelect: () => { setSelected(item.id); setCursor(item.id) },
    onAsk: () => askOne(item),
    receipt: receipt?.id === item.id ? receipt.words : undefined,
    onMenuToggle: () => setMenuRow(current => (current === item.id ? undefined : item.id)),
    onMenuClose: () => setMenuRow(undefined),
    onMark: (status: ItemStatus) => { apply(applyItemPatch(items, item.id, { status }, Date.now())); setMenuRow(undefined) },
    /* 挂卡的行改的是**那张卡在哪一栏**（看板自己的动作），不是这一行的字段：这一行
       在哪一栏本来就由那张卡回答，写自己的字段会是一个看不见的动作。没有看板可写时
       传 `undefined`，菜单里那几项就不出现。 */
    onMoveCard: face.controller === undefined
      ? undefined
      : (status: TaskStatus) => {
        const cardId = item.taskId
        if (cardId === undefined) return
        setMenuRow(undefined)
        face.controller?.moveTask(cardId, status)
      },
    /* 「编辑步骤」是三件事合一件：关掉菜单、把这一行选上、把它展开，然后把
         光标交给步骤那一栏。三件事必须一起发生——只选不展开的话，读者看见的是
         一行被选中，而步骤编辑器仍然不在屏幕上。 */
    onSteps: () => {
      setMenuRow(undefined)
      setSelected(item.id)
      setCursor(item.id)
      setOpenRow(item.id)
      setStepsFocus(count => count + 1)
    },
    onPromote: () => promoteOne(item),
    /* 开工 = 跑这一条挂着的卡。**同一个 `runTask`**——目录里的 `task.run` 绑的是它，
     * 模型的 	ask.run 执行的也是它。所以这一枚按钮不需要新动词，也不需要在
     * 豁免表里占一行；而一个界面按钮与目录指向不同方法，正是同一台机器上出现两个
     * 「开工」定义的来处。
     *
     * 没有卡就是没有卡：按钮在菜单里**列出但禁用**，并把缺的那件事写在右边。 */
    onStart: () => {
      const cardId = item.taskId
      if (cardId === undefined) return
      void face.controller?.runTask(cardId, 'manual')
    },
    running: item.taskId !== undefined && cardColumns.get(item.taskId) === 'running',
    /* 跑不跑得起来由 core 的判据回答（见 `runnableMapOf`）；没有卡时 `undefined`——那时这
       一枚按钮问的就不是「这张卡能不能跑」，而是「还没有卡」，理由由「不挂」那一格去说。 */
    runnable: item.taskId === undefined ? undefined : cardRunnable.get(item.taskId) === true,
    onRemove: () => removeOne(item),
    /* The detail is built only for the expanded row: opening is the condition, not
       the band, so both bands read the same place without building 100 details. */
    detail: openRow === item.id ? detail(item) : undefined,
  }))

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
    quickCapture: () => openLayer('create'),
    moveNext: () => setCursor(current => stepCursor(current, 1)),
    movePrev: () => setCursor(current => stepCursor(current, -1)),
    pick: () => { if (cursor !== undefined) setSelection(current => togglePicked(current, cursor)) },
    rename: () => { if (cursor !== undefined) setRename(current => ({ id: cursor, nonce: (current.id === cursor ? current.nonce : 0) + 1 })) },
    open: () => { if (cursor !== undefined) setSelected(cursor) },
    close: () => {
      // ESC 一次只收一层，从最上层开始：带上的浮层（命令面板/新建/排序）先走，
      // 然后才是行菜单、多选模式、展开的行与选中——不然在新建弹层里按 Esc，会
      // 先把背后展开的那一行收掉，读者眼前的弹层还开着，背后的工作却没了。
      // 多选模式排在行菜单之后：勾选框换掉了整列的引导位，它是行之上的一层。
      if (overlay !== undefined) { openLayer(undefined); return }
      if (menuRow !== undefined) { setMenuRow(undefined); return }
      if (selection.armed) { setSelection(current => setArmed(current, false)); return }
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
    palette: () => openLayer('palette'),
    /* THE THREE THAT BELONG TO THE BOX, not to the rows. Each one is a question
       the panel cannot answer on its own — the candidate cursor is derived from
       the palette's own text and the palette's own options — so the palette
       publishes three commands and this file keeps them. One direction: the box
       fills the ref, the map calls it, and neither reads the other's state. */
    palettePrev: () => paletteCommands.current?.step(-1),
    paletteNext: () => paletteCommands.current?.step(1),
    palettePick: () => paletteCommands.current?.pick(),
  // EVERY VALUE A HANDLER READS IS IN THIS LIST, and that sentence is here
  // because leaving one out is not a lint warning — it is a key that silently
  // does the wrong thing. `close` reads `overlay`, `menuRow`, `selection.armed`,
  // `openRow` and `selected`; with those missing from the dependency list the
  // handlers kept closing over the values from the render that BUILT them, so
  // `Esc` asked 「is the palette open?」 about a `false` from before the palette
  // opened and closed something else instead. The keyboard flow is the only
  // thing here that runs outside a React event handler, so nothing re-renders
  // it behind the reader's back and nothing complained.
  }), [apply, cursor, items, menuRow, now, openRow, overlay, removeOne, rename.nonce, runUndo, selection.armed, selected, undo])

  /**
   * A PRESS ON THE CARD'S OWN BLANK IS 「我不要这一条了」, and it empties the
   * surface the way the reader assumes it does: the row collapses, the detail
   * selection leaves, and the cursor ring (the bold rim a collapsed row used to
   * keep wearing) goes with them.
   *
   * SCOPED TO THE LIST CARD, because the gesture means 「nothing here」 where the
   * rows live. Clicks on the row itself, its menu and top panels are handled by
   * their own controls; clicks on the other columns (rail, top bar) and on the
   * overlays are those controls' business, not a dismissal. The listener runs on
   * BUBBLE, after every row handler, so a press a row consumed never looks blank.
   */
  const dismissRef = useRef({ selected, openRow, cursor, overlay })
  dismissRef.current = { selected, openRow, cursor, overlay }
  useEffect(() => {
    const onBlank = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      // 带上的浮层里只有排序面板没有自己的遮罩（面板/新建的遮罩自己收
      // 自己）。按在排序面板与开它的顶栏之外，就收它；按在任何一个有自己的遮罩
      // 的浮层里，归那个浮层管，这里不插手——所以豁免名单里有它们。
      if (dismissRef.current.overlay !== undefined
        && target.closest('[class*="TopPanel"i], [class*="TopBar"i], [class*="Palette"i], [class*="CreateDialog"i]') === null) {
        openLayer(undefined)
      }
      const card = target.closest('[data-dsh-tb-scroll]')
      if (card === null) return
      // 行、菜单、浮层与顶栏的弹出面板都是「有主」的地方：它们自己收自己。
      if (target.closest('[data-status], [role="menu"], [class*="TopPanel"i], [class*="Palette"i], [class*="CreateDialog"i]') !== null) return
      const now = dismissRef.current
      if (now.openRow !== undefined) setOpenRow(undefined)
      if (now.selected !== undefined) setSelected(undefined)
      if (now.cursor !== undefined) setCursor(undefined)
    }
    document.addEventListener('click', onBlank)
    return () => { document.removeEventListener('click', onBlank) }
  }, [])

  /** The next cursor position, which CLAMPS rather than wraps. */
  function stepCursor(current: string | undefined, by: number): string | undefined {
    if (visibleIds.length === 0) return undefined
    const at = current === undefined ? -1 : visibleIds.indexOf(current)
    const next = at < 0 ? (by > 0 ? 0 : visibleIds.length - 1) : Math.min(visibleIds.length - 1, Math.max(0, at + by))
    return visibleIds[next]
  }

  useItemKeys({
    state: {
      focusedId: cursor,
      somethingOpen: paletteOpen || menuRow !== undefined || openRow !== undefined || overlay === 'create' || overlay === 'sort',
      // Its OWN field rather than a reading of `somethingOpen`: the arrows mean
      // one thing on the rows and another inside the box, and a menu being open
      // is a third fact that must not hand the box's keys to a row cursor.
      paletteOpen,
    },
    actions: keyActions,
    surfaceRef,
  })


  /**
   * OPEN THE ARCHIVE FROM THE RAIL.
   *
   * 它是**搬出来的**：抽屉的行、它的恢复与它的彻底删除仍然住在列表页，但它「开没开」
   * 这件事属于整块面板。理由是量出来的两处失败：
   *
   * 一、左栏在三个页面上都渲染，而抽屉只长在清单页里。站在「日程」上按「已删除」，
   *     原来是清掉筛选、点亮那一行、**抽屉不出现**——计数器留在 >0，等读者之后切回
   *     清单时才补上那一下。按下却当场看不到结果，与按了什么都不做，对读者是同一件事。
   *
   * 二、开与关只有抽屉自己那枚按钮能改，所以**按左栏别的任何一行都不关它**：读者按
   *     「全部」，抽屉还开着，屏幕上还是那份删除记录。一个地方被离开时就该消失。
   *
   * 状态在面板上，这三件事就都成立了：谁都能关它（每一条左栏的路都关），谁都能开它
   * （那一行先落到能画出它的页上），而「读者是不是站在那儿」也不必再靠一次按键去记。
   */
  const [archiveOpen, setArchiveOpen] = useState(false)
  const onOpenArchive = useCallback(() => { setArchiveOpen(true) }, [])
  const closeArchive = useCallback(() => { setArchiveOpen(false) }, [])
  const pageProps = {
    items,
    now,
    cards: cardColumns,
    query,
    matchCtx,
    prefs,
    choose,
    narrow,
    filtering,
    /* 「这一页能不能多选」是**页面**的常量，不是读者的模式。收件装的是还没分流的
       东西、日程按天读，PRODUCT 说这两页根本没有多选面；清单页有，于是它的每一
       行都带一个空框。于是这一行不再读 holding——读它会让「读者正在多选吗」这件
       事决定一个页面事实，而读者改一次筛选就能改掉它。 */
    picking: prefs.page === 'list',
    /* The ordering goes down AS ITSELF, not as a 「may I group by day」 boolean the
       table would have to trust: a table told 「yes」 by a caller who guessed is a
       table printing 「今天」 above rows from six different days. */
    archiveOpen,
    onCloseArchive: closeArchive,
    onPurged: (id: string, revision: number) => replica?.pruneDeleted(id, revision),
    /* THE ONE WRITE THE ARCHIVE OWES THE LIVE LIST, and it is the same write the
     * undo already makes: put the row the host just brought back into the live
     * document, in this tick, through `apply`.
     *
     * WHY IT IS NEEDED AT ALL. A restore is a HOST operation addressed straight at
     * the route — it does not travel through this replica — and the host's commit
     * frame for it is dropped by our own client on purpose (`own commits arrive via
     * the response`). So without this call the row the reader just rescued is
     * missing from the list they are looking at until the next poll, which is up to
     * thirty seconds. The reader's words for that: 「点了没反应」. */
    onRestored: (row: ItemRecord) => apply(restoreItemRecord(itemsNow.current, row)),
    sort: prefs.sort,
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
  /* THE VALUE ALL HELD ROWS SHARE, when they share one. The Segmented used to be
   * a permanently blank control: press 「紧急」, the rows changed, and the four
   * options stayed unlit — the only feedback was a receipt sentence. The mark the
   * reader expects is the held rows' own common state, read off the document the
   * same way the rows read it; mixed holdings keep it blank, which is the honest
   * answer to 「这一批是什么档位」 when they are not all one tier. */
  const heldItems = items.filter(item => selection.ids.has(item.id))
  const commonStatus = heldItems.length === 0 || !heldItems.every(one => one.status === heldItems[0]!.status)
    ? undefined
    : heldItems[0]!.status
  const commonPriority = heldItems.length === 0 || !heldItems.every(one => one.priority === heldItems[0]!.priority)
    ? undefined
    : heldItems[0]!.priority
  /* 这一批里有几条挂着卡——**一个谓词，两个问题**（能不能问 AI / 它的状态是不是那张卡
     说了算），而它们今天恰好是同一批行。所以算一次、给两个名字，不写两遍。 */
  const heldCarded = heldItems.filter(one => one.taskId !== undefined).length
  /* THE BAR IS THE MODE'S OWN FACE, and the mode is what draws it — not the
   * holding. Arming shows the bar with 「已选 0 条」 and every action but the
   * select-all disabled: a reader who pressed 多选 to see what it does must see
   * THAT IT IS ON, and a bar that waited for the first row would be a mode with
   * no face. The bar writes only what it can reach, and with nothing held there
   * is nothing to reach — which is exactly what the disabled controls say. */
  const batch = selection.armed ? (
    <ItemBatchBar
      count={selectedCount(selection)}
      commonStatus={commonStatus}
      commonPriority={commonPriority}
      /* The select-all box counts the screen the rows are drawn on, which is
         `visibleIds` in the order the reader sees — the same set the tickboxes
         cover, so 「全选」 can never hold a row the reader cannot point at. */
      allPicked={allPicked(selection, visibleIds)}
      onPickAll={on => setSelection(current => setAllPicked(current, visibleIds, on))}
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
      askable={heldCarded}
      carded={heldCarded}
      onAsk={askHeld}
      onRemove={removeHeld}
    />
  ) : undefined
  /**
   * GO SOMEWHERE — the one door into 「which page is this on」.
   *
   * Three surfaces need it (the palette's page entries, the rail, and 「跳到
   * #12」), and each of them used to answer for itself: the palette called
   * `choose({page})` directly, which is why 「#12 在哪一页」 had no answer
   * outside a React component and the catalog had to excuse `item.navigate` as
   * unbuilt. Now the panel asks `planItemNavigation` where to land and only
   * moves, so the page set and the membership rules are read in one place.
   */
  const goTo = useCallback((page?: ItemPageId, ref?: number) => {
    const plan = planItemNavigation({ items, ...page === undefined ? {} : { page }, ...ref === undefined ? {} : { of: ref } })
    if (plan.kind === 'refused') {
      setReceipt({ id: undefined, words: plan.why === 'noSuchItem'
        ? t('item.pageJump.missing', { ref: String(ref ?? '') })
        : t('item.pageJump.nothing') })
      return
    }
    // 跳页就是去那个地方：归档开着时，任何跳页都把它关上——palette 的「清单/
    // 日程」与「跳到 #N」不能在归档开着时按下毫无可见变化。
    setArchiveOpen(false)
    if (plan.page !== prefs.page) choose({ page: plan.page })
    if (plan.ref !== undefined) {
      const found = items.find(item => item.ref === plan.ref)
      if (found !== undefined) { setSelected(found.id); setCursor(found.id) }
    }
  }, [choose, items, prefs.page])

  /* 「跳到 #N」 — the answers a palette gives when the reader typed a NUMBER.
     Typed beats hunted: the palette already has a cursor, and a reader who
     knows the number should never have to scroll to find it. The list is capped
     so the palette stays a list. */
  const jumpRows = useCallback((): PaletteAction[] => items
    .slice(0, 8)
    .map(item => ({
      id: `row-${item.id}`,
      label: `#${item.ref} ${itemTitleOf(item) || t('item.detail.emptyTitle')}`,
      run: () => { goTo(undefined, item.ref) },
    })), [items, goTo])

  /* THE PALETTE'S ANSWERS, and the page names are here rather than in the
     palette: a page is a PRODUCT CONSTANT the model owns, and a palette that
     listed its own would be a second page rail written in a different place.
     Jump-to-page lives here because typing a page name is the one thing a reader
     does with a palette that is not a filter, and typing beats hunting. */
  const paletteActions = useMemo<PaletteAction[]>(() => [
    ...ITEM_PAGES.map(page => ({
      id: `page-${page}`,
      label: t(PAGE_LABEL[page]),
      run: () => goTo(page),
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
    ...jumpRows(),
  ], [undo, runUndo, visibleIds, selection.armed, goTo])

  /* TWO READINGS OF ONE DOCUMENT, and `ITEM_PAGES` is the closed set of them: 清单
   * counts what exists, 日程 reads it day by day. A third branch here would need a
   * third entry in that table, which is what makes 「a page with no count and no
   * door」 a build failure rather than a blank screen. */
  const body = prefs.page === 'list'
    ? <ListPage
      {...pageProps}
      clientId={replica?.clientId()}
      showDone={showDone}
      onShowDone={setShowDone}
      batch={batch}
      armed={selection.armed}
      onArm={on => setSelection(current => setArmed(current, on))}
      allPicked={allPicked(selection, visibleIds)}
      onPickAll={on => setSelection(current => setAllPicked(current, visibleIds, on))}
      selectable={visibleIds.length > 0}
    />
    : <SchedulePage {...pageProps} />

  /**
 * THE THREE NUMBERS, each counted where it is filtered.
 *
 * `triageLinesOf` is the model's own reading and it counts over the WHOLE
 * document rather than over what the filter left — a number that moved when
 * the reader typed would be a number about the search wearing the name of a
 * number about their work. Pressing one writes the very token that produced
 * it, through the same writer every other filter uses, so 「落后 3」 leaves
 * exactly three rows on screen.
 *
 * THREE OF THEM, NAMED HERE, because three is the product's answer to
 * 「我今天该动哪几件」 and a band of four is a band with one question too many.
 * The line the reader is NOT shown is 停滞: it is the only one whose answer
 * changes with the clock rather than with the document, so it belongs to the
 * row that says it and not to the page that counts everything else.
 */
/* 「要处理」那一条带子连同它的推导一起搬走了。
 *
 * 它答的是「我今天该动哪几件」，而这个答案现在**长在左栏的数上**——超期、落后、
 * 停滞、没日期各占一行，数字与跳进去看到的行数是同一次 filter 的两个结果。
 *
 * 一条带子与一个栏位同时回答同一句提问，读者就得先判断「哪一个才是真的」——而
 * 他判断的依据是数字看起来对不对，那正是最不该拿来当依据的东西。**所以是把带子
 * 删掉，不是把它留着当摘要。**
 *
 * 下面那段推导（四个 flag 各配一个只当名词的标签）原本是给三张统计卡用的，卡也
 * 一起没有了，所以推导与标签表都跟着走——一个不再被读的值就是死代码，而死代码
 * 在下一次改动里是最容易被误当成「还在用」的那一种。 */

  /**
   * HOW MANY ROWS ONE FILTER TOKEN WOULD LEAVE, asked of the same parse the
  /**
   * HOW MANY ROWS ONE FILTER TOKEN WOULD LEAVE, asked of the same parse the
   * table reads. A tile whose number and whose jump disagree is the defect this
   * pair exists to make impossible — and the only way it cannot happen is both
   * sides asking the same question of the same string.
   *
   * Measured against an EMPTY query on purpose: it answers 「what would this
   * button give me if I pressed it」, and pressing it merges it with whatever is
   * already on. Counting against the live query instead makes the same button
   * report a different number before and after it is pressed, which is a number
   * that describes nothing.
   */
/** WHAT THE RAIL SHOWS, AND WHERE IT STANDS.
   *
   * The groups and every number on them come from ONE derivation over the same
   * document the list reads, so a count and the jump behind it are one predicate.
   * The archive rows live in tombstones rather than in the list, so they are read
   * where they are — which is also why `已删除` can never be counted twice.
   *
   * DECLARED DOWN HERE, not up with the other hooks, because it reads three
   * things three of which are declared later: `matchCtx` (the clock), `choose`
   * (the view record) and `goTo` (the jump). A derivation that has to be hoisted
   * above its own inputs to compile is a derivation whose inputs were chosen
   * wrong. */
  const railGroups = useMemo(
    () => itemRailGroupsOf(items, matchCtx, deletedItems),
    [items, matchCtx, deletedItems],
  )
  /** The days a row lands on, as `YYYY-MM-DD`. The calendar's dot answers 「this
   *  day has something on it」 and nothing more, so it needs the SET, not a count. */
  const railDays = useMemo(() => {
    const days = new Set<string>()
    for (const item of items) {
      for (const at of [item.startsAfter, item.dueAt, item.hardDueAt]) {
        if (at !== undefined) days.add(localDayKey(at))
      }
    }
    return [...days]
  }, [items])


  const enterRail = useCallback((entry: ItemRailEntry) => {
    /* EVERY ROW DECLARES A COMPLETE DESTINATION, AND ONE PRESS LANDS IN IT.
     *
     * That is the rule this function exists to keep, and it is not how the rail
     * worked: each row changed PART of the state. 「已删除」 moved the page and
     * opened the drawer; 「全部」 cleared the filter and moved nothing; the rows that
     * narrow only wrote a token. So a reader stood in the inbox, pressed 「全部」,
     * and the screen did not change — the filter was already empty and 「全部」 had
     * never claimed the page. Press 「已删除」 first and it worked, because THAT row
     * was the one moving the page. **The press that looked broken was the one that
     * changed the least, on the row that should be the most definite on the rail.**
     *
     * A destination is `{ page, pick, archive }`, always all three, so no row can
     * leave one of them behind from wherever the reader was standing:
     *   · 「全部」     the document, unnarrowed
     *   · 「日程」     the same document read day by day
     *   · 「已删除」   the rows that are no longer in it
     *   · a predicate  the document, narrowed by exactly this one row
     *   · a day        the same, on one day
     *
     * EVERY PREDICATE LANDS ON THE LIST PAGE, and the reason is the number printed
     * beside it. Those numbers count the WHOLE document — that is the promise
     * `item-rail.ts` makes and `item-query.ts` states as 「a count and its jump are
     * one predicate」. A predicate that narrowed only the page the reader happened
     * to be standing on would show fewer rows than the number it had just been
     * pressed for: the count and the list would be two facts, which is the exact
     * defect the shared-predicate rule exists to forbid. */
    // 站在归档里再按「已删除」= 回去：这一按只关门。其余任何左栏的路都照旧
    // 先离开归档（下面那行）。
    if (archiveOpen && entry.kind === 'place' && entry.key === 'deleted') { setArchiveOpen(false); return }
    setArchiveOpen(false)
    if (entry.kind === 'collection' || entry.kind === 'place') {
      if (entry.key === 'deleted') {
        /* 「已删除」是**另一个地方**：它是墓碑，而墓碑不在活着的行里。所以清空筛选
         * （一个还留着谓词的抽屉看不懂自己要显示什么）并开抽屉。 */
        goTo('list'); choose({ search: '' }); onOpenArchive(); return
      }
      if (entry.key === 'schedule') { goTo('schedule'); choose({ search: '' }); return }
      /* 「全部」 OWNS THE PAGE, and that is the whole fix. 「全部」 means the whole
       * document, and the whole document is the list page. */
      goTo('list'); choose({ search: '' }); return
    }
    /* A PREDICATE, and the query string is the ONLY place it is written: the box
     * and the rail can never be the stale one, because there is only one of them.
     *
     * AND IT REPLACES ITS OWN GROUP. The rail's rows come in groups whose members
     * are ALTERNATIVES — a row has exactly one priority and one status, and the
     * date predicates are verdicts about one row's dates. Adding a second token
     * from one group is therefore never a narrower question: 优先级 and 状态 are
     * matched with `includes`, so `p1 p2` is urgent UNION high — pressing a second
     * priority made MORE rows appear, against the number printed beside it — and
     * the `has:` flags are ANDed over a single posture, so 「超期了」 then 「没日子
     * 的」 was constant-false and the list went empty for every document.
     *
     * So a press means 「只看这一个」: turning one on drops its siblings, and
     * pressing the one that is already on takes it off. The group's tokens come
     * from the rail's own entries, so a group and its members cannot drift apart.
     *
     * AND IT LANDS ON THE LIST PAGE, for the reason given above: the number beside
     * this row counts the whole document, so the list it opens has to be the whole
     * document narrowed — not the page the reader was standing on narrowed twice. */
    goTo('list')
    choose({ search: withFacetToken(prefs.search, entry.token, !isTokenIn(prefs.search, entry.token), railSiblingsOf(entry, railGroups)) })
  }, [archiveOpen, choose, goTo, onOpenArchive, prefs.search, railGroups])

  /* ONE DAY AT A TIME, and the calendar's cell is a single-slot filter rather than
   * a word in the box. Two things were wrong with writing `on:YYYY-MM-DD` as a
   * token: the grammar had no `on:` arm at all, so pressing any day emptied the
   * list (the token fell through to a literal substring search no row can match),
   * and every further press appended another one — a day filter that accumulates
   * is a filter that narrows to nothing while looking like it is doing something.
   * Every day token is a sibling of every other, so the newest press replaces.
   *
   * **THE SIBLINGS ARE THE TOKENS IN THE BOX, not the days that happen to hold
   * rows.** They used to be `railDays` — every day some row lands on — and that is
   * a different set from the one the rule is about: press a day with nothing on it
   * (perfectly legal: the calendar lets a reader ask 「what is on the 8th」 and the
   * answer is 「nothing」), then press the 9th, and the 8th's token is still there
   * because no row carries it. Two `on:` tokens in one box is a filter where the
   * one the reader last pressed silently wins and the stale one is invisible in
   * everything except the text of the query. */
  const pickRailDay = useCallback((day: string) => {
    const token = dayTokenOf(day)
    choose({ search: withFacetToken(prefs.search, token, !isTokenIn(prefs.search, token), dayTokensIn(prefs.search)) })
  }, [choose, prefs.search])
  /* THE MONTH THE CALENDAR SHOWS IS A PLACE THE READER WENT, and it starts where
   * today is. It used to be derived from the clock on every render
   * (`localDayKey(now).slice(0,7)`), which is the same fact as 「you can never look
   * at another month」: the arrows had nothing to write to. */
  const [seenMonth, setSeenMonth] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (seenMonth === undefined) setSeenMonth(railMonth)
  }, [railMonth, seenMonth])
  const shownMonth = seenMonth ?? railMonth
  const shiftMonth = useCallback((by: -1 | 1) => {
    setSeenMonth(current => {
      const [year, month] = (current ?? railMonth).split('-').map(Number)
      if (year === undefined || month === undefined) return railMonth
      // Through a Date rather than by hand, so December → January carries the year.
      const next = new Date(year, month - 1 + by, 1)
      return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
    })
  }, [railMonth])
  /* 「今天」 DOES TWO THINGS AND THEY ARE ONE THING: put the calendar back on the
   * month that holds today, and take the day filter off. A reader who presses it
   * while looking at another month AND another day means 「where I am」, and both
   * halves are that. */
  const backToToday = useCallback(() => {
    setSeenMonth(railMonth)
    choose({ search: withFacetToken(prefs.search, dayTokenOf(localDayKey(now)), false, dayTokensIn(prefs.search)) })
  }, [choose, now, prefs.search, railMonth])

  /* FOLDED ON A NARROW SURFACE, UNFOLDED ON A WIDE ONE — until the reader says
   * otherwise, and then their choice stands for the session. `narrow` is the
   * surface's own measurement, and the fold is what replaced the old
   * `display: none` (rule 11 allows 折叠; hiding a control at a width does not). */
  const [calendarChoice, setCalendarChoice] = useState<boolean | undefined>(undefined)
  const calendarOpen = calendarChoice ?? !narrow
  const toggleCalendar = useCallback(() => { setCalendarChoice(current => !(current ?? !narrow)) }, [narrow])

  /* WHERE THE READER IS, READ OFF THE QUERY. This was `useState`, written on every
   * press before the toggle was even computed — so pressing the same row twice
   * turned the filter OFF and left the row marked 「you are here」, and deleting the
   * text by hand left it marked too. A highlight that is remembered can claim a
   * filter that is not on; one derived from the query cannot. */
  const activeRailId = useMemo(() => {
    const query = parseItemQuery(prefs.search)
    for (const group of railGroups) {
      for (const entry of group.entries) {
        if (entry.kind === 'collection' || entry.kind === 'place') continue
        if (isTokenIn(prefs.search, entry.token)) return entry.id
      }
    }
    if (query.day !== null) return `day:${query.day}`
    /* THE TWO SETS ARE THE PAGE. 「刚记的」 is a page and 「已删除」 opens a place,
       so the row is current exactly when the reader is standing there — read from
       `prefs.page` and the archive's own state rather than from a press, which is
       what makes it impossible for a SET row to look current while the reader is
       somewhere else. */
    if (archiveOpen) return 'deleted'
    if (prefs.page === 'schedule') return 'schedule'
    /* 「全部」 IS CURRENT WHEN NOTHING ELSE IS. It is the floor of the rail — the
       document with no narrowing — so it is lit exactly when the reader is on the
       list page with no predicate and no day. Reading it off the state instead of
       remembering the press is what makes a highlighted row mean something. */
    return (prefs.page === 'list' && query.words.length === 0 && query.tags.length === 0
        && query.priority.length === 0 && query.status.length === 0 && query.flags.size === 0 && query.day === null)
      ? 'all'
      : undefined
  }, [archiveOpen, railGroups, prefs.page, prefs.search])
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
          onClose={() => openLayer(undefined)}
          /* THE FOCUS GOES BACK WHERE IT CAME FROM. The box declared itself modal,
             and a modal surface that takes the caret and never gives it back
             leaves the panel with no focus at all — the next key answers to
             nothing and the reader has to click their way out of their own
             surface. The box cannot do this itself: it does not own the button
             the reader pressed. */
          onClosed={() => paletteTrigger.current?.focus()}
          onCommands={commands => { paletteCommands.current = commands }}
        />
        {/* THE NEW-ROW DIALOG, beside the box rather than inside it: it is a
            different layer that can be open with the box shut.

            「新建卡片」的选择器在收下名字之后不再立刻动文档：卡与这条行话一起落，
            所以它把名字交给「记下一条」，用**同一次提升**（同一句计划、同一次
            写、同一份回执）把两者接上——按名字先造一张没内容的卡、再把带着
            话的行挂上去，中间那一次取消就会留下一张名存实亡的空卡。 */}
        <ItemCreateDialog
          now={now}
          open={overlay === 'create'}
          onClose={() => openLayer(undefined)}
          cards={cards.map(card => ({ id: card.id, title: card.title }))}
          onCreate={(input, newCard) => {
            if (isBlankCapture(input)) return false
            const made = captureItemRecord(input, Date.now(), newItemId)
            apply([...items, made.item])
            /* The promotion runs AFTER its own apply, on the SAME tick: its
               patch base is the mirror, so the row this hangs was just
               written into it and hangs on the card it named. */
            if (newCard !== undefined && newCard !== '') promoteOne(made.item, { cardTitle: newCard })
            return true
          }}
        />

  {/* THE SHELL CARD IS GONE, and the ROWS are the cards now: the panel sits
      * directly on the canvas and each row paints its own card — the board's own
      * law (画布可透、内层卡不透明), one vocabulary for the list, the agenda and
      * the rows on them. The shell's face (surface, radius, shadow, edge air)
      * moved to where it is read: surface to the rows, air to the workbench's own
      * padding. The head this card once carried left to the bar long before the
      * face went; the count lives beside the search that changes it. */}
  <div className={css.itemWorkbench} ref={surfaceRef}>
    <div className={css.itemListColumn}>
{/* ── 两条带子，同一个高度，位置一个像素都不动。 ─────────────────────────────
            *
            * 活清单那一页的带子只说三件事：「我在找什么」「我按什么排」「我怎么加
            * 一条」——搜索 · 排序 · ＋新建一条。关于**这份文档**的一切问题都在左栏，
            * 关于**这一条**的一切都在那一行里，所以两样都不属于一条只讲视图的带子。
            *
            * **而归档页原来把整条带子卸载掉**（`{!archiveOpen && …}`），于是页面顶上
            * 的内容**往上跳 56px**——读者的原话是「上面的东西弹了下来」。「搜索 / 排序 /
            * 新建这一页不成立」这条理由仍然成立，所以换的不是「有没有带子」，而是
            * **带子里放什么**：归档页放它自己的题头（名字 + 条数 + 回去的路）。两条带子
            * 共用 `--item-control-h` 与 `--item-inset-x`，所以同高不是两次巧合。 */}
        {archiveOpen
          ? (
              <div className={css.itemArchiveTopBar}>
                <h2 className={css.itemArchiveHead}>
                  <button type="button" className={css.itemArchiveToggle} onClick={closeArchive}>
                    {t('item.archive.title')}
                    <span className={css.itemArchiveCount}>{deletedItems.length}</span>
                  </button>
                </h2>
                <button type="button" className={css.itemTopBarChip} onClick={closeArchive}>
                  {t('item.archive.back')}
                </button>
              </div>
            )
          : (
            <>
              <div className={css.itemTopBar}>
                <p className={css.itemTopCount}>
                  {filtering
                    /* THE MATCH SET, not the detail selection. The sentence claims to
                       * be about the FILTER, so it is counted the way the filter counts
                       * — one predicate, the same one the list draws from. */
                    ? t('item.countFiltered', { shown: String(matchedCount), total: String(items.length) })
                    : t('item.count', { n: String(items.length) })}
                </p>
            {/* THE SEARCH BOX IS ALSO THE COMMAND PALETTE'S DOOR.
              *
              * 它不再旁边另立一枚「命令」按钮。那一枚是为 ⌘K 找的鼠标入口，可它和
              * 邻居不一样高（28 对 32）、不一样宽、夹在两个药丸中间——于是它自己成了
              * 「这是什么」。
              *
              * 而 ⌘K 的答案本来就是这一页上唯一能被看见的那部分：**搜索框**。点它开
              * 面板、打字收窄它，两件事本来就是同一件事的两个阶段。所以入口就是它，
              * 形状与邻居一致，也不再多一枚控件。 */}
            {/* THE FIELD HOLDS THE READER'S OWN WORDS. Nothing else.
              *
              * It used to hold the whole query — so pressing a rail row put
              * `status:inprogress status:open` inside the box the reader types in,
              * and that is a control showing them its own implementation. A filter
              * is not a word; it is a decision, and a decision belongs in a chip
              * that can be pointed at and taken off, not in the middle of their
              * sentence. The chips are directly below this bar, so the state of the
              * filter is never less visible for having moved out of the field.
              *
              * `withFreeText` is what makes the edit correct: it replaces the WORDS
              * and leaves every qualifier standing, in the position the reader's
              * first word stood. Writing this as `withFacetToken(base, value, true)`
              * is the trap — that treats the whole field as ONE token, so each
              * keystroke appends the field to the field and `abc` becomes
              * `a ab a abc`. */}
            <input
              ref={paletteTrigger}
              className={css.itemSearch}
              type="search"
              value={freeTextOf(prefs.search)}
              placeholder={t('item.search.label')}
              aria-label={t('item.search.label')}
              aria-expanded={overlay === 'palette'}
              aria-controls={`${topPanels}-palette`}
              onClick={() => openLayer(overlay === 'palette' ? undefined : 'palette')}
              onChange={event => choose({ search: withFreeText(prefs.search, event.target.value) })}
            />
            <div className={css.itemTopBarTools}>
              {/* 多选有一个**读者不用先知道抽屉里有它**的入口。它原来只住在 ⋯ 菜单
                  与命令面板的词表里：一个有四十行活要一起改的读者，得先按开某一行
                  的菜单，才看见这个模式存在——「批量做一件事」这个问题的第一句是
                  「多选」，它就该站在带上。清单页是批量干活的页，芯片只在那页出现。
                  再按一次收回，与栏里的「多选做完了」是同一扇门。 */}
              {prefs.page === 'list' && (
                <>
                  <button
                    type="button"
                    className={css.itemTopBarChip}
                    aria-pressed={selection.armed}
                    disabled={visibleIds.length === 0}
                    onClick={() => setSelection(current => setArmed(current, !current.armed))}
                  >
                    {t('item.batch.arm')}
                  </button>
                  {/* 「隐藏已完成」说的是正在进行的动作：按下去 = 藏起来（pressed），
                      再按 = 拿回来。它的状态机一直是真的（切片读的就是它），缺的
                      只是这枚够得着的控制——芯片与「多选」同一族、同一个开关形状。 */}
                  <button
                    type="button"
                    className={css.itemTopBarChip}
                    aria-pressed={!showDone}
                    onClick={() => setShowDone(current => !current)}
                  >
                    {t('item.done.show')}
                  </button>
                </>
              )}
              <button
                type="button"
                className={css.itemTopBarChip}
                aria-expanded={sortOpen}
                aria-controls={`${topPanels}-sort`}
                onClick={() => openLayer(sortOpen ? undefined : 'sort')}
              >
                {/* 一问一答，**包成一件东西**：这一枚药丸里装的是「排序 · 顺序」这一
                    个短语，所以它居中的是**这一个短语**，而短语内部的两半按基线对齐。
                    两半直接当药丸的子项、药丸又用 `align-items: baseline` 时，基线那
                    一组会被按到药丸的**顶**上（flex 的基线组从交叉轴起点开始摆），于是
                    这一枚的字比旁边三枚高约 8px——读者的话是「排序顺序的按钮有问题」。
                    包一层之后：外面居中，里面共用一条基线，两个承诺各归各位。 */}
                <span className={css.itemTopBarPair}>
                  <span className={css.itemTopBarLabel}>{t('item.topbar.sort')}</span>
                  <span className={css.itemTopBarValue}>{t(SORT_LABEL[prefs.sort])}</span>
                </span>
              </button>
              <button
                type="button"
                className={css.itemNewButton}
                onClick={() => openLayer('create')}
              >
                {/* A DRAWN PLUS, not the `＋` character. A full-width glyph carries
                    * one em of side bearing on each side of a two-stroke mark, so the
                    * ink it draws sits visibly off the centre of a perfectly centred
                    * box — 「上下居中了，左右偏右一点」 is exactly that, and it is a
                    * property of the character rather than of the layout. */}
                <svg viewBox="0 0 11 11" width="11" height="11" aria-hidden="true">
                  <path d="M5.5 1v9M1 5.5h9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                {t('item.topbar.create')}
              </button>
            </div>
          </div>

          {/* THE CHIP ROW IS THE FILTER'S OWN FACE, and it is ALWAYS HERE — below
              the bar, above the rows, in the same column the list is in.
              *
              * It used to be rendered only inside the command palette and inside an
              * overlay nothing could open. So with the palette shut there was NO
              * chip row anywhere on the surface: a reader who pressed 「超期了」 got
              * `has:overdue` in the box and nothing on screen that named the filter,
              * said it was on, or offered to take it off. **A filter the reader can
              * neither see nor remove is a filter they will conclude is a bug** —
              * and the fix is not to explain it better, it is to draw it.
              *
              * Below rather than above, because the box is the door and the chips
              * are what the door has let in: reading order is what you typed, then
              * what that means. */}
          {queryChipsOf(prefs.search, items.map(item => item.tags)).length > 0 && (
            <div className={css.itemTopPanel} role="group" aria-label={t('item.filters.label')}>
              <ItemQueryChips
                text={prefs.search}
                tags={items.map(item => item.tags)}
                onSearch={next => choose({ search: next })}
                onClearQualifiers={() => choose({ search: freeTextOf(prefs.search) })}
              />
            </div>
          )}

          {/* 排序面板，两枚芯片里唯一需要展开面的一枚。它在壳里，不在浮层上：
              一条把自己正在筛的行压暗的筛选，读者要检查两遍才敢信。 */}
          {sortOpen && (
            <div id={`${topPanels}-sort`} className={css.itemTopPanel} role="group" aria-label={t('item.sort.label')}>
              {ITEM_SORTS.map(order => (
                <button
                  key={order}
                  type="button"
                  className={css.itemTopBarChip}
                  aria-pressed={prefs.sort === order}
                  onClick={() => { choose({ sort: order }); openLayer(undefined) }}
                >
                  {t(SORT_LABEL[order])}
                </button>
              ))}
            </div>
          )}
            </>
          )}
          {/* THE PANELS THE TWO CHIPS OPEN BELONG ABOVE THIS LINE, IN THE COLUMN,
              AND NOT INSIDE THE SCROLLER.
              *
              * `.itemFlow` is the list's scroller. A panel rendered inside it is
              * drawn as the first thing among the rows: it scrolls away with them,
              * it sits below the list's own top edge instead of below the bar, and
              * it inherits the scroller's width rather than the column's. The rule
              * is the same one the bar follows — a control over the list stands
              * outside the list — and it is why the panels' markup is a sibling of
              * `.itemFlow` and never a child of it. */}
      <div className={css.itemFlow} data-dsh-tb-scroll="">

              {/* Reading in-flight, unreachable and syncing are THREE different
                  facts, and NEITHER hides the list: the local mirror is whole and
                  usable, so covering it would be a worse answer than a banner. */}
              {lostHost
                ? <p className={css.itemHint} role="status">{t('item.hostLost')}</p>
                : replica.isSynced() === false && <p className={css.itemHint} role="status">{t('item.syncing')}</p>}
              {/* ONLY THE RECEIPTS WITH NO ROW OF THEIR OWN. A receipt that is about
                  one row is drawn beside that row, under the control that earned
                  it. */}
              {receipt !== undefined && receipt.id === undefined && (
                <p className={css.itemHint} role="status">{receipt.words}</p>
              )}

              {/* THE RECEIPT. It sits at the top of the list the row left, not in a
                  corner and not in a dialog: the reader's eye is already here, and
                  an undo that has to be found is an undo that is not used. It
                  states BOTH halves of the promise — the undo available now, and
                  the thirty-day window that remains after it is spent. */}
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
{/* THE RAIL IS THE NAVIGATION, and the detail rail is gone.
                *
                * A pane that only exists when a row is selected was 「rented
                * land」 by its own empty state — and the thing that replaced it
                * earns its column every single render, because it answers 「what
                * is waiting, and what is overdue」 before the reader has scrolled
                * anywhere. The row's own detail is still one press away: it opens
                * IN the row, which is where the reader is already looking.
                *
                * IT SITS ON THE LEFT, NOT THE RIGHT, because the numbers belong
                * to the LIST and the list is on the left. A rail of counts on the
                * far side of the panel makes the reader cross the screen to read
                * the answer to a question about what is in front of them. */}
            <ItemRail
              groups={railGroups}
              activeId={activeRailId}
              month={shownMonth}
              daysWithRows={railDays}
              today={localDayKey(now)}
              activeDay={query.day ?? undefined}
              calendarOpen={calendarOpen}
              onToggleCalendar={toggleCalendar}
              onShiftMonth={shiftMonth}
              onToday={backToToday}
              canReturnToToday={shownMonth !== railMonth || query.day !== null}
              onEnter={enterRail}
              onPickDay={pickRailDay}
            />
          </div>
      </div>
    </div>
  )
}

/** Re-exported so the panel's own contract test can name the defaults. */
export { DEFAULT_VIEW_PREFS }