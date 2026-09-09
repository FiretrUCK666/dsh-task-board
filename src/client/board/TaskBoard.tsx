/**
 * Board view: the multi-column kanban that replaces the middle column while
 * active. Cards open the task detail (never execute directly); the header
 * offers filter, new-task, the auto-cruise toggle, and a back-to-chat escape.
 *
 * Drag & drop: same-column drags reorder cards, cross-column drags keep the
 * classic move/rerun/reject semantics. Reorder uses a half-split anchor —
 * the pointer's Y against each card's midpoint decides whether the drop
 * lands before or after it — computed on the column container (event
 * delegation), so both directions work symmetrically for any column size.
 * The insertion point is mirrored in a ref (written synchronously on every
 * dragover, read at drop) so the drop always matches the preview; only the
 * indicator rendering goes through state.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { selectedTaskOf, type BoardController } from '../../core/controller.ts'
import { MAX_CRUISE_LIMIT } from '../../core/controller.ts'
import { COLUMNS, landingStatusOf, pendingCommentCount, plainRunsOf, resolveCardDrop, taskExecutable, type TaskStatus } from '../../core/tasks.ts'
import { taskPendingCount, taskUnviewed, taskUnviewedCount } from '../../core/session-display.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { useFlipRegion } from './use-flip.ts'
import { useSurfaceNarrow } from './use-narrow.ts'
import { activeColumnIndexAt, scrollLeftForColumn } from './column-tabs.ts'
import { Dialog } from './Dialog.tsx'
import { indicatorTopOf, insertionGapOf, type InsertionGap } from './drop-position.ts'
import { useDragAutoScroll } from './drag-autoscroll.ts'
import { cruiseStatusLineOf, cruiseWindowGrammarOf, DAY_MS, duplicateWindowOf, normalizeWindow, windowRangeIssueOf, type CruiseWindow, type CruiseWindowRangeIssue } from '../../core/cruise.ts'
import { formatCruiseTime, cruiseWindowLabelOf, formatDateTime } from './format-time.ts'
import { NewTaskModal } from './NewTaskModal.tsx'
import { STATUS_KEY, STATUS_SHORT_KEY } from './status.ts'
import { TaskCard } from './TaskCard.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import { AutomationPanel } from './AutomationPanel.tsx'
import { TimeField } from './TimeField.tsx'
import { Button, ColorSwatches, Icon, Switch } from './ui.tsx'
import { waitingKeyOf } from './session-chip.ts'
import { candidateExternalDrag, externalDragOf, type SidebarDrag } from '../sidebar-drag.ts'
import { taskBindsOf } from '../../core/tasks.ts'

import { matchTask } from './task-search.ts'
import { notificationsOf } from './notifications.ts'
import { runnableIds } from './batch-run.ts'
import { buildCommands } from './commands.ts'
import { CommandPalette } from './CommandPalette.tsx'
import { Chip } from './Chip.tsx'

/**
 * The cruise settings in its two forms, one content: the anchored popover
 * beside the header pill on a wide board; the SAME children as a full Dialog
 * on a narrow board (surface bucket, same 680px as the CSS container). An
 * absolutely positioned popover cannot size itself against the board box
 * from inside the header row — on a phone it collapsed to a sliver (the
 * 「面板只剩一条」 report); the Dialog grammar (board-box relative,
 * scrollable body, pinned actions) is the honest form once the board is
 * narrow.
 */
function CruiseSettingsHost({ narrow, label, onClose, children }: {
  narrow: boolean
  label: string
  onClose: () => void
  children: ReactNode
}) {
  if (!narrow) {
    return <div className={css.cruisePopover} role="menu" aria-label={label}>{children}</div>
  }
  return (
    <Dialog title={label} label={label} onClose={onClose} portal className={css.autoModal}>
      <div className={css.modalScroll}>{children}</div>
    </Dialog>
  )
}

/** ONE inline message per window-range issue — explanatory, never jargon:
 *  the actual values and the one-night boundary are named, so a 3-days-early
 *  end says "3 天" and why it cannot be 次日. */
function cruiseRangeError(issue: CruiseWindowRangeIssue, window: CruiseWindow): string {
  if (issue === 'both-empty') return t('board.cruiseWindowErrorStart')
  if (issue === 'same-instant') return t('board.cruiseWindowErrorSame')
  if (issue === 'end-too-early') {
    const startAt = window.startAt ?? 0
    const endAt = window.endAt ?? 0
    const days = Math.max(1, Math.ceil((startAt - endAt) / DAY_MS))
    return t('board.cruiseWindowErrorRange', {
      end: formatCruiseTime(endAt, startAt),
      start: formatCruiseTime(startAt, startAt),
      days: String(days),
    })
  }
  if (issue === 'start-past') return t('board.cruiseWindowErrorStartPast')
  return t('board.cruiseWindowErrorEndPast')
}

/** The window row tooltip: the exact instants behind its one-line label. */
function cruiseWindowTitleOf(window: CruiseWindow): string {
  const grammar = cruiseWindowGrammarOf(window)
  if (grammar.kind === 'range') return `${formatDateTime(grammar.startAt)} → ${formatDateTime(grammar.endAt)}`
  if (grammar.kind === 'from-start') return formatDateTime(grammar.startAt)
  return formatDateTime(grammar.endAt)
}

/** Board component; subscribes to the controller snapshot. */
export function TaskBoard({ controller }: { controller: BoardController }) {
  const [snapshot, setSnapshot] = useState(controller.getSnapshot())
  useEffect(
    () => controller.subscribe(() => setSnapshot(controller.getSnapshot())),
    [controller],
  )
  const [filter, setFilter] = useState('')
  const [showNew, setShowNew] = useState(false)
  // 自动化总览弹层（板顶统一管理任务级 schedule + 会话级规则）。
  const [showAutomation, setShowAutomation] = useState(false)
  // 通知中心弹层：等你处理的会话聚合（只读，点行进详情）。
  const [showNotify, setShowNotify] = useState(false)
  // 命令面板：Ctrl/Cmd+K 唤起的动作列表（新建/巡航/整理/自动化/通知/返回），
  // 每一项都复用既有入口——面板本身不新增任何行为。
  const [showPalette, setShowPalette] = useState(false)
  useEffect(() => {
    // Never hijack typing: an open input owns its keystrokes (Ctrl+K in a
    // text field stays the field's).
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey !== true && event.metaKey !== true) || event.key.toLowerCase() !== 'k') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true) return
      if (!controller.getSnapshot().boardOpen) return
      event.preventDefault()
      setShowPalette(open => !open)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [controller])
  // Live aggregation over the snapshot (the controller notifies on every
  // session-list change, so a newly-waiting session lights the bell at once).
  const notes = notificationsOf(
    snapshot.tasks,
    sessionId => controller.pendingInteractionOf(sessionId),
    sessionId => controller.sessionTitle(sessionId) ?? sessionId,
  )
  // 多选（Ctrl/Cmd+点击即选，整理模式整选；板头横栏批量换色/删除/全选清选）。
  const [organizing, setOrganizing] = useState(false)
  // The engine-seat note the header chip opens (touch has no hover, so the
  // explanation must be a real, reachable surface — not a `title`).
  const [engineNote, setEngineNote] = useState<'stale' | 'viewer' | undefined>(undefined)
  // The stale note resolves itself: once a seat re-read reports a current
  // protocol (or sync drops), the dialog closes WITH its banner — no stale
  // explanation lingering over a healthy state.
  useEffect(() => {
    if (engineNote === 'stale' && !(snapshot.engine.synced && snapshot.engine.hostProto < 2)) {
      setEngineNote(undefined)
    }
  }, [engineNote, snapshot.engine.synced, snapshot.engine.hostProto])
  const [selectedCards, setSelectedCards] = useState<string[]>([])
  const toggleCard = (id: string): void => {
    setSelectedCards(current => current.includes(id) ? current.filter(cardId => cardId !== id) : [...current, id])
  }
  const clearSelection = (): void => { setSelectedCards([]) }
  const exitOrganize = (): void => {
    setOrganizing(false)
    clearSelection()
  }
  /** 批量换色（undefined = 移除颜色，经单一色表文法的「移除颜色」点触发）。 */
  const applyColorToSelected = (color: string | undefined): void => {
    const targets = snapshot.tasks.filter(task => selectedCards.includes(task.id))
    for (const task of targets) controller.setTaskColor(task.id, color)
  }
  /** 批量删除（确认后）；删除会同步取消板上的选中集。 */
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false)
  const deleteSelected = (): void => {
    for (const id of selectedCards) controller.deleteTask(id)
    clearSelection()
  }

  // The board root: the FLIP region + the narrow-bucket surface (the CSS
  // container query measures this same box — one truth, never viewport vs
  // surface). Declared FIRST: the cruise popover/Dialog switch below reads
  // `narrow`, so the hook must precede it.
  const [narrow, narrowRef] = useSurfaceNarrow('[data-dsh-taskboard-view]', 680)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const boardRefs = useCallback((node: HTMLDivElement | null): void => {
    boardRef.current = node
    narrowRef.current = node
  }, [narrowRef])
  // 自动巡航设置：宽板 = 胶囊下的锚定弹层（点层外关闭）；窄板 = 同一内容的
  // 完整 Dialog（弹层几何在小板上不可靠——这是「面板只剩一条」的根治）。
  // THE single-truth rule: this switch reads THE BOARD SURFACE (the same
  // surface the CSS container query measures), never the viewport — a
  // mid-size window with the shell sidebar open has a viewport that says
  // "wide" while the board is already stacked, and a viewport default would
  // disagree with the geometry the user is looking at.
  const [cruiseOpen, setCruiseOpen] = useState(false)
  // Cruise-limit input: a directly controlled number field cannot be cleared
  // to retype (any invalid edit snaps back), so the input keeps its own text;
  // a valid integer commits on edit (the controller clamps), an invalid or
  // empty text stays for typing and blur restores the committed value.
  const [limitText, setLimitText] = useState(String(snapshot.cruise.limit))
  useEffect(() => { setLimitText(String(snapshot.cruise.limit)) }, [snapshot.cruise.limit])
  const cruiseWrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    // Only the anchored popover closes on outside press; the Dialog owns its
    // backdrop/close-button dismiss (and portals OUTSIDE this wrap — a blanket
    // listener would close the moment the user taps anything).
    if (!cruiseOpen || narrow) return
    const onDown = (event: MouseEvent): void => {
      if (cruiseWrapRef.current !== null && !cruiseWrapRef.current.contains(event.target as Node)) {
        setCruiseOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [cruiseOpen, narrow])
  // 定时窗口表单（epoch ms；TimeField 打字式输入 + 日历按钮）。打开弹层时把
  // 「开始」预填为下一个整点；「结束」留空 = 一直保持，且必须晚于「开始」；
  // 校验失败就地提示，不做静默 no-op。打开弹层不预填任何时间——只留占位提示，
  // 用户输入多少就是多少（三态：只填开始/只填结束/都填）。
  const [windowStart, setWindowStart] = useState<number | undefined>(undefined)
  const [windowEnd, setWindowEnd] = useState<number | undefined>(undefined)
  const [cruiseError, setCruiseError] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!cruiseOpen) return
    setCruiseError(undefined)
  }, [cruiseOpen])

  /**
   * 添加一条巡航定时窗口：开始与结束均可选（至少一个；留空结束=到点开、之后
   * 保持开；留空开始=立即视为开、到点关）。结束早于开始 = 跨午夜（如 22:00 →
   * 02:00）合法：归一化自动 +1 天处理，绝不拒绝；每个非法形态（双空/同时刻/
   * 早于开始超过一天/开始已过/结束已过）都有专属提示，绝不带病写入。
   */
  const addCruiseWindow = (): void => {
    if (windowStart === undefined && windowEnd === undefined) {
      setCruiseError(t('board.cruiseWindowErrorStart'))
      return
    }
    const candidate: CruiseWindow = {
      ...windowStart !== undefined ? { startAt: windowStart } : {},
      ...windowEnd !== undefined ? { endAt: windowEnd } : {},
    }
    const normalized = normalizeWindow(candidate)
    const issue = windowRangeIssueOf(normalized, cruiseNow)
    if (issue !== undefined) {
      setCruiseError(cruiseRangeError(issue, candidate))
      return
    }
    // The single write point validates: an exact duplicate adds nothing but
    // noise — reject with an inline error instead of a silent no-op.
    if (duplicateWindowOf(cruiseSchedule, candidate) !== undefined) {
      setCruiseError(t('board.cruiseWindowErrorDuplicate'))
      return
    }
    controller.setCruiseSchedule([...cruiseSchedule, candidate])
    setWindowStart(undefined)
    setWindowEnd(undefined)
    setCruiseError(undefined)
  }

  // 弹层里的巡航状态行：永远一句话解释「为什么开关是当前值」（手动/窗口/计划
  // 三种来源，cruiseStatusLineOf 唯一推导）。
  const cruiseSchedule = snapshot.cruise.schedule
  const cruiseNow = Date.now()
  const cruiseStateLine = (() => {
    const line = cruiseStatusLineOf(snapshot.cruise, cruiseNow)
    if (line.kind === 'window-on') {
      return line.endAt !== undefined
        ? t('board.cruiseStatusWindow', { time: formatCruiseTime(line.endAt, cruiseNow) })
        : t('board.cruiseStatusWindowHold')
    }
    if (line.kind === 'manual-on') return t('board.cruiseStatusManualOn')
    if (line.kind === 'manual-off') {
      return line.endAt !== undefined
        ? t('board.cruiseStatusManualOff', { time: formatCruiseTime(line.endAt, cruiseNow) })
        : t('board.cruiseStatusManualOffHold')
    }
    if (line.kind === 'scheduled-off') {
      return t('board.cruiseStatusScheduled', { time: formatCruiseTime(line.startAt, cruiseNow) })
    }
    return t('board.cruiseStatusOff')
  })()
  const [dragOver, setDragOver] = useState<TaskStatus | undefined>(undefined)
  const [dragReject, setDragReject] = useState<TaskStatus | undefined>(undefined)
  // The id of the card being dragged and the insertion gap it would land at —
  // a gap now also recalls WHICH column it was computed for, so a cross-column
  // move previews (and drops at) an exact position, not just the tail. The
  // gap is mirrored in a ref (written synchronously on every dragover, read at
  // drop) so the drop always matches the preview, never a stale render closure.
  const [dragId, setDragId] = useState<string | undefined>(undefined)
  const [dropGap, setDropGap] = useState<{ status: TaskStatus; beforeId: string | undefined; top: number } | undefined>(undefined)
  // Mirrored in a ref, written synchronously on EVERY dragover (also without a
  // re-render: the indicator's top follows the pointer through the DOM), read
  // at drop so the drop always matches the preview, never a stale closure.
  const dropGapRef = useRef<{ status: TaskStatus; beforeId: string | undefined; top: number } | undefined>(undefined)
  // The .cards container per column (for half-split rect measurements).
  const cardsRefs = useRef<Partial<Record<TaskStatus, HTMLDivElement | null>>>({})
  // The drop-indicator element per column: its top is written directly during
  // dragover (no per-frame React state), while React re-renders only when the
  // STRUCTURE of the gap (status + beforeId) changes — no flicker, no storm.
  const indicatorRefs = useRef<Partial<Record<TaskStatus, HTMLSpanElement | null>>>({})
  // Guards the reject-flash timer against unmount (drop feedback only).
  const rejectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    if (rejectTimer.current !== undefined) clearTimeout(rejectTimer.current)
  }, [])
  // Structure-driven FLIP, fully suppressed while a card drag is
  // active (the post-drop settle is the moment it plays).
  useFlipRegion(boardRef, dragId !== undefined)
  // Compact column navigator: the tabs mirror the horizontal track's scroll
  // position and jump a column into view on tap (hidden on desktop by the
  // base CSS — this state simply rides along).
  const columnsRef = useRef<HTMLDivElement | null>(null)
  const [activeColumn, setActiveColumn] = useState<TaskStatus>(COLUMNS[0].status)
  /** The track's column left-edges (identity order = COLUMNS order). */
  const columnLefts = (root: HTMLElement): number[] =>
    Array.from(root.querySelectorAll<HTMLElement>('section[data-status]')).map(section => section.offsetLeft)
  const columnIndex = (status: TaskStatus): number =>
    COLUMNS.findIndex(column => column.status === status)
  const syncActiveColumn = useCallback((): void => {
    const root = columnsRef.current
    if (root === null) return
    const sections = Array.from(root.querySelectorAll<HTMLElement>('section[data-status]'))
    if (sections.length === 0) return
    const at = activeColumnIndexAt(root.scrollLeft, sections.map(section => section.offsetLeft))
    const status = sections[at]?.dataset.status as TaskStatus | undefined
    if (status !== undefined) setActiveColumn(status)
  }, [])
  const jumpToColumn = (status: TaskStatus): void => {
    const root = columnsRef.current
    if (root === null) return
    root.scrollLeft = scrollLeftForColumn(columnIndex(status), columnLefts(root), root.clientWidth, root.scrollWidth)
  }
  // Column-identity anchoring: whenever the board box changes width (the
  // shell sidebar opening/closing, a rotation, a split-screen drag), the track
  // is re-aimed at the SAME COLUMN's left edge. Pixels are never the truth,
  // so the board can no longer "shift a little to the right" once per toggle —
  // the cumulative drift class is closed by one observer (with its disposer).
  useEffect(() => {
    const root = columnsRef.current
    if (root === null) return
    let lastWidth = root.clientWidth
    const observer = new ResizeObserver(() => {
      if (root.clientWidth === lastWidth) return
      lastWidth = root.clientWidth
      root.scrollLeft = scrollLeftForColumn(
        columnIndex(activeColumn), columnLefts(root), root.clientWidth, root.scrollWidth,
      )
    })
    observer.observe(root)
    return () => { observer.disconnect() }
  }, [activeColumn])
  // The column currently accepting an external sidebar drag (session/workspace  // dragged in from the sidebar): a distinct highlight from the board's own
  // card-reorder affordances. The latch refs below make the highlight stable:
  // dragover cannot read the drag payload (protected data store), so the
  // external identity is latched once from the advertised types on entry and
  // cleared only by a drop / drag end — never per-column, so crossing child
  // elements can never flicker or leave a stale ring.
  const [dropAccept, setDropAccept] = useState<TaskStatus | undefined>(undefined)
  // Latched: a sidebar drag (session/workspace) is over the board right now.
  const externalRef = useRef(false)
  // Latched synchronously at dragstart on a board card, so the board's own
  // card drags (also stamped `text/plain`) never latch as external — the ref
  // write happens before any dragenter, unlike the state `dragId`.
  const dragSourceRef = useRef(false)

  /**
   * Full reset of every transient drag state — after a drop, a drag end,
   * a window-level drop/dragend, or any cancel. The one reset to rule them
   * all: no path may clear only part of the drag UI and leave a stale
   * highlight behind.
   */
  const clearDrag = (): void => {
    externalRef.current = false
    dragSourceRef.current = false
    setDropAccept(undefined)
    setDragId(undefined)
    setDropGap(undefined)
    dropGapRef.current = undefined
    setDragOver(undefined)
    autoScrollRef.current = null
  }

  // Window-level safety net: a drag that ends outside the board — released
  // over the sidebar, outside the window, or cancelled with Escape — never
  // reaches the board's drop handlers, and its `dragend` fires on the native
  // source element instead. Both window events reset the whole drag UI so no
  // highlight can ever survive the gesture. (The component's own handlers
  // also reset; the resets are idempotent.)
  useEffect(() => {
    window.addEventListener('drop', clearDrag)
    window.addEventListener('dragend', clearDrag)
    return () => {
      window.removeEventListener('drop', clearDrag)
      window.removeEventListener('dragend', clearDrag)
    }
    // clearDrag reads only stable setters/refs; a mount-time instance is
    // fully functional, so registering it once is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Board-relative dialog centering was previously a viewport-offset hack
  // (--dsh-tb-board-offset shifted dialogs by half the sidebar width, which
  // broke under any ancestor transform/filter and drifted on resize). Dialogs
  // are now absolutely positioned inside the board's own box and centered by
  // flex — no measurement, no offset variable, no layout drift (see
  // .modalBackdrop/.modal/.detail/.review).
  /** Classify a drag as a sidebar drag (own MIME, else native text/plain). */
  const externalOf = (event: React.DragEvent): SidebarDrag | undefined => externalDragOf(
    event.dataTransfer,
    id => snapshot.tasks.some(task => task.id === id),
    id => controller.externalKindOf(id),
  )
  const selected = selectedTaskOf(snapshot)
  // Board-wide search: title/description/prompt/comments plus linked-session
  // titles (the same derivation the rows render — a session renamed natively
  // stays findable under its live name).
  const visible = snapshot.tasks.filter(task =>
    matchTask(task, filter, controller.linkedOf(task).map(row => row.title)))
  // Clicking a card: a modifier click (Ctrl/Cmd) toggles multi-selection any
  // time; in organize mode every click toggles; otherwise it opens the detail.
  const cardClick = (id: string, event?: React.MouseEvent): void => {
    if (organizing || event?.ctrlKey === true || event?.metaKey === true) toggleCard(id)
    else controller.openTask(id)
  }
  // Organize-bar color slot: the first selected card's color, else none —
  // the ring never appears on a guessed default (a colorless selection has
  // no ring; 「移除颜色」 dot lights instead).
  const orgColorValue = (() => {
    for (const task of snapshot.tasks) {
      if (selectedCards.includes(task.id) && task.color !== undefined) return task.color
    }
    return undefined
  })()
  const draggedTask = dragId !== undefined
    ? snapshot.tasks.find(candidate => candidate.id === dragId)
    : undefined

  /** Id of the card element under the pointer, when the pointer is on one. */
  const cardIdAt = (event: React.DragEvent): string | undefined =>
    (event.target as HTMLElement).closest('[data-task-id]')?.getAttribute('data-task-id') ?? undefined

  /** The nearest insertion gap of a drag at `dropY`, relative to the cards container. */
  const gapAt = (status: TaskStatus, dropY: number): InsertionGap => {
    const container = cardsRefs.current[status]
    if (container == null || dragId === undefined) return { beforeId: undefined, top: 0 }
    const containerTop = container.getBoundingClientRect().top
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-task-id]'))
      .map(element => ({
        id: element.getAttribute('data-task-id') ?? '',
        rect: element.getBoundingClientRect(),
      }))
    const gap = insertionGapOf(cards, dropY, dragId, 8)
    // Content coordinates (viewport → scrolled content), clamped so the bar
    // always sits exactly at the gap it promises — even mid-scroll.
    return {
      beforeId: gap.beforeId,
      top: indicatorTopOf(gap.top, containerTop, container.scrollTop, container.scrollHeight),
    }
  }

  /** Apply a insertion gap to the UI: THE one gap-write path (dragover and the
   *  auto-scroll frame share it — the indicator stays truthful mid-scroll).
   *  React state only churns when the STRUCTURE of the gap changes
   *  (status + beforeId); the indicator's top is written straight into the
   *  DOM on every call, so a pointer move or a scroll can never trigger a
   *  re-render — no flicker, no storm. */
  const applyGap = useCallback((status: TaskStatus, dropY: number): void => {
    const gap = gapAt(status, dropY)
    dropGapRef.current = { status, beforeId: gap.beforeId, top: gap.top }
    const indicator = indicatorRefs.current[status]
    if (indicator !== null && indicator !== undefined) {
      indicator.style.top = `${gap.top}px`
    }
    setDropGap(current =>
      current !== undefined && current.status === status && current.beforeId === gap.beforeId
        ? current
        : { status, beforeId: gap.beforeId, top: gap.top })
  }, [gapAt])

  // Drag edge auto-scroll: the column under the pointer scrolls itself while
  // the drag nears its top/bottom edge (the same grammar for the detail's
  // session list). getRoot is stable (a ref read); the frame callback
  // re-applies the gap with the last pointer position.
  const autoScrollRef = useRef<{ status: TaskStatus; cards: HTMLElement } | null>(null)
  const autoScrollRoot = useCallback(() => autoScrollRef.current?.cards ?? null, [])
  useDragAutoScroll(
    autoScrollRoot,
    dragId !== undefined || dropAccept !== undefined,
    useCallback((pointerY: number) => {
      const target = autoScrollRef.current
      if (target !== null) applyGap(target.status, pointerY)
    }, [applyGap]),
  )

  // Resolve a workspace id to its display title through the run catalog
  // (live workspace list; falls back to the raw id when the workspace no
  // longer exists or no catalog is wired).
  const workspaceTitleOf = (workspaceId: string): string => {
    const row = controller.runCatalog()
      ?.listWorkspaces()
      .find(candidate => candidate.id === workspaceId)
    return row?.title ?? workspaceId
  }

  /** Create a bound task from an external sidebar drag (session or workspace). */
  const createFromSidebar = (drag: SidebarDrag, dropStatus: TaskStatus): void => {
    const bind = drag.kind === 'session'
      ? { kind: 'session' as const, sessionId: drag.id }
      : { kind: 'workspace' as const, workspaceId: drag.id }
    // The landing column is the column the item was dropped into — all five
    // columns are respected (a drop on 进行中 / 待审核 / 已完成 stays there).
    controller.createBoundTask(bind, {
      title: controller.boundSourceTitleOf(bind),
      description: '',
      prompt: '',
      status: landingStatusOf(dropStatus),
    })
  }

  /**
   * Column-level drop: same-column drops reorder (the half-split anchor the
   * last dragover computed); cross-column drops keep the classic
   * move/rerun/reject semantics; an external sidebar drag (session/workspace)
   * creates a bound task in this column. Every drop ends with a full drag
   * reset, so no transient highlight can survive the gesture. The moved card
   * settles into place via the board's FLIP animation — the drop feedback is
   * the card itself, never a column-edge flash.
   */
  const handleDrop = (status: TaskStatus) => (event: React.DragEvent): void => {
    event.preventDefault()
    // Capture the insertion decision BEFORE any reset: clearDrag wipes the
    // dropGap ref, so reading it after would always be undefined and every
    // drop would silently fall to the column tail. Order contract: read drop
    // state first, clear transient UI after. The gap recalls its column, so
    // a cross-column move previewed at a position drops exactly there.
    const gapRef = dropGapRef.current
    const gapOf = (target: TaskStatus): string | undefined =>
      gapRef !== undefined && gapRef.status === target ? gapRef.beforeId : undefined
    const external = externalOf(event)
    const id = dragId ?? event.dataTransfer.getData('text/plain')
    clearDrag()
    if (external !== undefined) {
      event.stopPropagation()
      createFromSidebar(external, status)
      return
    }
    const task = snapshot.tasks.find(candidate => candidate.id === id)
    if (task === undefined) return
    if (dragId !== undefined && task.status === status) {
      controller.moveTask(task.id, status, gapOf(status))
      return
    }
    const decision = resolveCardDrop(task, status)
    if (decision.kind === 'move') {
      controller.moveTask(task.id, decision.status, gapOf(decision.status))
    } else if (decision.kind === 'run') {
      // Dropping on 'running' means "run again" (same semantics as the
      // detail button; the shared run guard rejects a live run).
      void controller.rerunTask(task.id)
    } else if (decision.kind === 'reject') {
      setDragReject(status)
      if (rejectTimer.current !== undefined) clearTimeout(rejectTimer.current)
      rejectTimer.current = setTimeout(() => { setDragReject(undefined) }, 600)
    }
  }

  // The viewer hint only matters while something is actually waiting on the
  // engine (queued comments or launches) — an idle board never nags.
  const engineWaitVisible = snapshot.stats.queued > 0
    || snapshot.tasks.some(task => pendingCommentCount(task) > 0)

  return (
    <div
      ref={boardRefs}
      className={css.board}
      data-dsh-taskboard-board=""
      data-dragging={dragId !== undefined ? '' : undefined}
      onDragEnter={event => {
        // Latch an external sidebar drag once, on entry: dragover cannot
        // read the payload (protected data store), but the advertised types
        // plus the absence of a board card drag are enough to know this is a
        // session/workspace drag. Card drags set `dragSourceRef` at dragstart
        // (synchronously, before any dragenter) and never latch.
        if (!dragSourceRef.current && candidateExternalDrag(Array.from(event.dataTransfer.types))) {
          externalRef.current = true
        }
      }}
      onDragOver={event => { if (externalRef.current) event.preventDefault() }}
      onDrop={event => {
        const external = externalOf(event)
        clearDrag()
        if (external !== undefined) {
          event.preventDefault()
          // A drop on the board's empty area (no column) lands in 待办.
          createFromSidebar(external, 'todo')
        }
      }}
    >
      <header className={css.boardHeader}>
        {/* 板头两行，语义分区（紧凑档行结构确定，不靠内容驱动折行）：
            导航行 = 返回 + 板名 + 状态组（左，紧跟板名）+ 空位 + 自动巡航 +
            新建任务（右端主行动）；工具行 = 筛选（左，与返回/板名同一条 x）+
            空位 + 模式组（整理/自动化，右）。紧凑档各自再确定性地换行：
            导航第二行 = 状态（有内容才出现），工具第二行 = 模式组右对齐，
            筛选永远独占一条整幅白长条。标签一律保留。 */}
        <div className={`${css.boardRow} ${css.boardRowNav}`}>
          <button
            type="button"
            className={css.boardBack}
            aria-label={t('board.close')}
            title={t('board.close')}
            onClick={() => { controller.closeBoard() }}
          >
            <Icon name="arrowLeft" />
          </button>
          <h2 className={css.boardTitle}>{t('board.title')}</h2>
          {/* 右簇前的弹性留白：标题紧贴左，状态/巡航/新建同贴右。`margin-left:auto`
              是被禁的"靠右"写法——它只右对齐换行首项，一换行即散架。 */}
          <span className={css.boardSpacer} />
          {/* 状态槽：运行/排队 + 引擎指示，坐在自动巡航的左边（用户原话），
              与巡航同属右簇。零段省略（「排队 0」是噪音，与上下文计量同一文法）。
              紧凑档它独占导航第二行左段，巡航守右，永远不挤主行动。 */}
          {(() => {
            const stateParts = [
              ...snapshot.stats.running > 0 ? [t('board.statusRunning', { n: String(snapshot.stats.running) })] : [],
              ...snapshot.stats.queued > 0 ? [t('board.statusQueued', { n: String(snapshot.stats.queued) })] : [],
            ]
            // 引擎席位的诚实指示（只在同步模式且真的"不在本机/服务端过旧"时
            // 出现）：排队的工作在等谁、为什么不动——用户看得见，就不用猜、
            // 不用刷。它是真按钮：说明必须能点开（触屏没有 hover，写着
            // 「点此了解」却点不动是假 affordance，比不写更糟）。
            const engineStale = snapshot.engine.synced && snapshot.engine.hostProto < 2
            const engineViewer = snapshot.engine.synced && !engineStale && !snapshot.engine.held && engineWaitVisible
            if (stateParts.length === 0 && !engineStale && !engineViewer) return null
            return (
              <span className={css.boardState}>
                {stateParts.length > 0 && (
                  <span className={css.boardStatus}>
                    <span className={css.boardStatusDot} aria-hidden="true" />
                    <span className={css.boardStatusText}>{stateParts.join(' · ')}</span>
                  </span>
                )}
                {engineStale && (
                  <button
                    type="button"
                    className={css.boardStatusButton}
                    data-warn="true"
                    onClick={() => { setEngineNote('stale') }}
                  >
                    <span className={css.boardStatusDot} aria-hidden="true" />
                    <span className={css.boardStatusText}>{t('board.engineStale')}</span>
                  </button>
                )}
                {engineViewer && (
                  <button
                    type="button"
                    className={css.boardStatusButton}
                    onClick={() => { setEngineNote('viewer') }}
                  >
                    <span className={css.boardStatusDot} aria-hidden="true" />
                    <span className={css.boardStatusText}>{t('board.engineViewer')}</span>
                  </button>
                )}
              </span>
            )
          })()}
          {/* 自动巡航：右簇成员（状态 | 巡航 | 新建，动作永远在最右）。一颗安静的
              胶囊（开关 + 设置 ▾），点击展开定时设置弹层；巡航是常态开关、新建
              是一次性动作。 */}
          <div className={css.cruiseWrap} ref={cruiseWrapRef}>
            <div className={css.cruisePill}>
              <Switch
                checked={snapshot.cruise.enabled}
                onChange={next => { controller.setCruiseEnabled(next) }}
                label={t('board.cruise')}
                title={t('board.cruiseTitle')}
              />
              <button
                type="button"
                className={css.cruiseMore}
                aria-label={t('board.cruiseSettings')}
                title={t('board.cruiseSettings')}
                aria-expanded={cruiseOpen}
                onClick={() => { setCruiseOpen(!cruiseOpen) }}
              >
                <Icon name="chevronDown" />
              </button>
            </div>
            {cruiseOpen && (
              <CruiseSettingsHost
                narrow={narrow}
                label={t('board.cruiseSettings')}
                onClose={() => { setCruiseOpen(false) }}
              >
                <div className={css.cruisePopoverHead}>
                  <Switch
                    checked={snapshot.cruise.enabled}
                    onChange={next => { controller.setCruiseEnabled(next) }}
                    label={t('board.cruise')}
                    title={t('board.cruiseTitle')}
                  />
                  <span className={css.cruisePopoverLimit}>
                    <span className={css.cruisePopoverLabel}>{t('board.cruiseLimitShort')}</span>
                    <input
                      className={css.cruiseLimit}
                      type="number"
                      min={1}
                      max={MAX_CRUISE_LIMIT}
                      value={limitText}
                      title={t('board.cruiseLimit')}
                      aria-label={t('board.cruiseLimit')}
                      onChange={event => {
                        setLimitText(event.target.value)
                        const value = Number(event.target.value)
                        if (event.target.value.trim() !== '' && Number.isInteger(value) && value >= 1) {
                          controller.setCruiseLimit(value)
                        }
                      }}
                      onBlur={() => { setLimitText(String(snapshot.cruise.limit)) }}
                    />
                  </span>
                </div>
                {/* 定时窗口：设定靠后的开启时刻与可选结束时刻（不设=一直保持）；
                    多个窗口独立——当前窗口结束时关闭，更靠后的窗口到点再次自动开启。 */}
                <div className={css.cruiseSchedule}>
                  <div className={css.cruiseScheduleHead}>
                    <span className={css.cruiseScheduleTitle}>{t('board.cruiseSchedule')}</span>
                    <span className={css.cruiseStateLine}>{cruiseStateLine}</span>
                  </div>
                  {cruiseSchedule.length === 0 ? (
                    <p className={css.detailHint}>{t('board.cruiseScheduleEmpty')}</p>
                  ) : (
                    <ul className={css.cruiseWindowList}>
                      {cruiseSchedule.map((window, index) => (
                        <li
                          key={`${window.startAt}-${index}`}
                          className={css.cruiseWindowRow}
                          style={{ animationDelay: `${index * 20}ms` }}
                        >
                          {/* ONE grammar line per window (range / from-start /
                              on-now-until-end; a cross-midnight range already
                              reads 次日 inside the label). The exact instants
                              live in the tooltip; the list itself auto-sorts. */}
                          <span className={css.cruiseWindowTime} title={cruiseWindowTitleOf(window)}>{cruiseWindowLabelOf(window, cruiseNow)}</span>
                          <button
                            type="button"
                            className={css.rowHide}
                            title={t('board.cruiseWindowRemove')}
                            onClick={() => {
                              controller.setCruiseSchedule(cruiseSchedule.filter((_, i) => i !== index))
                            }}
                          >
                            {t('board.cruiseWindowRemove')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className={css.cruiseWindowAdd}>
                    {/* Both endpoints are optional (至少一个 start 或 end): a
                        cleared start commits undefined — an "only-end" window
                        (立即开、到点关) is reached the same way the only-start
                        one is, no stale value can survive a clear. The
                        add-guard below rejects neither-set. */}
                    <TimeField
                      label={t('board.cruiseWindowStart')}
                      placeholder={t('board.cruiseWindowStartPlaceholder')}
                      value={windowStart}
                      onChange={next => { setWindowStart(next); setCruiseError(undefined) }}
                    />
                    <TimeField
                      label={t('board.cruiseWindowEnd')}
                      placeholder={t('board.cruiseWindowEndPlaceholder')}
                      value={windowEnd}
                      onChange={next => { setWindowEnd(next); setCruiseError(undefined) }}
                    />
                    {cruiseError !== undefined && <p className={css.formError}>{cruiseError}</p>}
                    <p className={css.detailHint}>{t('board.cruiseSemanticsHint')}</p>
                    <Button size="sm" onClick={addCruiseWindow}>
                      {t('board.cruiseWindowAdd')}
                    </Button>
                  </div>
                </div>
              </CruiseSettingsHost>
            )}
          </div>
          {/* 新建任务：板上唯一的主行动（primary），永远坐在导航行的最右端——
              它从筛选行搬来，那一行因此只剩「筛选任务」一条整幅白长条（用户
              原话），不再是一条行里塞一个孤零零的按钮。 */}
          <Button
            variant="primary"
            className={css.boardNewTask}
            onClick={() => { setShowNew(true) }}
          >
            + {t('board.new')}
          </Button>
        </div>

        {/* 工具行：筛选左（与返回/板名同一条 x）+ 模式组右（整理/自动化）。
            紧凑档筛选独占整行、模式组独占一行且右对齐——换行，不压扁。 */}
        <div className={`${css.boardRow} ${css.boardRowTools}`}>
          <input
            className={css.search}
            type="search"
            placeholder={t('board.search')}
            value={filter}
            onChange={event => { setFilter(event.target.value) }}
            aria-label={t('board.search')}
          />
          {/* 模式按钮（整理/自动化/通知）是一个语义组：宽档贴右成簇，紧凑档整组
              换到自己的一行右对齐——它们永远同进同退，不会被挤散。 */}
          <span className={css.boardModes}>
            {/* 整理 is a MODE toggle, not a primary action: a pressed ghost —
                never the brand fill, so the bar reads quiet until there is a
                real selection to manage. */}
            <Button
              variant="ghost"
              pressed={organizing}
              onClick={() => { organizing ? exitOrganize() : setOrganizing(true) }}
            >
              {t('board.organize')}
            </Button>
            <Button
              variant="ghost"
              title={t('board.automationTitle')}
              onClick={() => { setShowAutomation(true) }}
            >
              {t('board.automation')}
            </Button>
            {/* 通知：等你处理的会话聚合（只读列表 — 点行进任务详情，
                会话操作归详情页）。有等待事项才亮数，无则安静。 */}
            <button
              type="button"
              className={`${css.iconButton} ${css.notifyBell}`}
              aria-label={t('board.notify')}
              title={t('board.notify')}
              onClick={() => { setShowNotify(true) }}
            >
              <Icon name="bell" />
              {notes.length > 0 && (
                <span className={css.notifyBadge} aria-hidden="true">
                  {notes.length > 99 ? '99+' : String(notes.length)}
                </span>
              )}
            </button>
          </span>
        </div>

        {/* 多选横栏（整理模式或已有选中时出现）：先点卡片（Ctrl/Cmd+点击或整理
            模式下直接点）选中高亮，再在板头横栏批量换色 / 删除 / 全选清选。 */}
        {(organizing || selectedCards.length > 0) && (
          <div className={css.boardRow}>
            <span className={css.organizeBar}>
              {/* Color group: swatches (palette / custom / 移除颜色) — one
                  grammar with the card hover bar; applying is instant. */}
              <span className={css.organizeGroup}>
                <span className={css.organizeLabel}>{t('board.organizeColor')}</span>
                <ColorSwatches
                  value={orgColorValue}
                  onChange={applyColorToSelected}
                />
              </span>
              <span className={css.organizeCount}>{t('board.organizeCount', { n: String(selectedCards.length) })}</span>
              {/* Selection group: select-all / clear / done + the danger
                  delete right next to 完成 (one right-cluster, hairline
                  between — the destructive action reads as part of the same
                  group instead of drifting across the bar). */}
              <span className={css.organizeActions}>
                {/* Batch run FIRST (the bar's apex action — firing is why the
                    selection exists; 完成 merely exits the mode, so it reads
                    secondary). Only prompt-ready cards fire; the rest stay
                    put visibly (the launch point owns lanes and budget). */}
                {selectedCards.length > 0 && (
                  <Button
                    size="sm"
                    variant="primary"
                    title={t('board.organizeRunTitle')}
                    disabled={runnableIds(snapshot.tasks, selectedCards).length === 0}
                    onClick={() => {
                      for (const id of runnableIds(snapshot.tasks, selectedCards)) {
                        void controller.runTask(id, 'manual')
                      }
                    }}
                  >
                    {t('board.organizeRun')}
                  </Button>
                )}
                <Button size="sm" onClick={() => { setSelectedCards(visible.map(task => task.id)) }}>
                  {t('board.organizeSelectAll')}
                </Button>
                <Button size="sm" disabled={selectedCards.length === 0} onClick={clearSelection}>
                  {t('board.organizeClear')}
                </Button>
                <Button size="sm" onClick={exitOrganize}>
                  {t('board.organizeDone')}
                </Button>
                {/* Danger group: delete the selected cards — only once there
                    IS a selection (an empty organize mode never flashes a
                    destructive button next to the color row), separated from
                    完成 by the hairline. */}
                {selectedCards.length > 0 && (
                  <span className={css.organizeDanger}>
                    <Button size="sm" variant="danger" disabled={selectedCards.length === 0} onClick={() => { setConfirmDeleteSelected(true) }}>
                      {t('board.organizeDelete')}
                    </Button>
                  </span>
                )}
              </span>
            </span>
          </div>
        )}
        {confirmDeleteSelected && (
          <ConfirmDialog
            title={t('board.deleteSelectedTitle', { n: String(selectedCards.length) })}
            message={t('board.deleteSelectedConfirm')}
            confirmLabel={t('board.deleteSelectedOk')}
            danger
            onConfirm={() => { setConfirmDeleteSelected(false); deleteSelected() }}
            onCancel={() => { setConfirmDeleteSelected(false) }}
          />
        )}
        {/* 引擎席位的说明必须可点（触屏没有 hover，写着「点此了解」却点不动是
            假 affordance，比不写更糟）。正文走 .modalScroll——弹窗家族唯一
            的正文区文法（内衬/滚动归它），裸贴面板边是上一轮的排版事故。
            过旧时给出可自查的证据：当前连接服务端的协议读数（实时随快照更新）
            + 多实例提示（「我明明重启了」多半是地址连着另一个未重启的进程）
            + 「重新检查」（立刻续租一次，重启确认后当场清除）。 */}
        {engineNote !== undefined && (
          <Dialog
            label={t(engineNote === 'stale' ? 'board.engineStale' : 'board.engineViewer')}
            title={t(engineNote === 'stale' ? 'board.engineStale' : 'board.engineViewer')}
            onClose={() => { setEngineNote(undefined) }}
            portal
          >
            <div className={css.modalScroll}>
              <p className={css.detailText}>
                {t(engineNote === 'stale' ? 'board.engineStaleHint' : 'board.engineViewerHint')}
              </p>
              {engineNote === 'stale' && (
                <>
                  <p className={css.detailHint}>
                    {t('board.engineNoteProto', { n: String(snapshot.engine.hostProto), min: '2' })}
                  </p>
                  {/* The evidence that ends the argument: a real clock reading
                      from the process answering THIS device. "我明明重启了"
                      has two answers (this really is the old process, or the
                      address lands on a second instance) and only one of them
                      is a guess without a time to look at. */}
                  <p className={css.detailHint}>
                    {snapshot.engine.bootedAt === undefined
                      ? t('board.engineNoteBootUnknown')
                      : t('board.engineNoteBoot', { time: formatDateTime(snapshot.engine.bootedAt) })}
                  </p>
                  <p className={css.detailHint}>{t('board.engineNoteStaleMulti')}</p>
                </>
              )}
            </div>
            <footer className={css.modalFooter}>
              {controller.canRecheckSeat() && (
                <Button onClick={() => { void controller.recheckSeat() }}>
                  {t('board.engineNoteRecheck')}
                </Button>
              )}
              <Button variant="primary" onClick={() => { setEngineNote(undefined) }}>
                {t('board.engineNoteOk')}
              </Button>
            </footer>
          </Dialog>
        )}

      </header>

      {/* 紧凑列导航（仅 compact 档显示）：点按直达状态列，滚动位置回写高亮。
          文法即列头——状态点 + 名称 + 计数，tab 就是它跳转的列。 */}
      <div className={css.columnTabs} role="tablist" aria-label={t('board.title')}>
        {COLUMNS.map(column => {
          const count = visible.filter(task => task.status === column.status).length
          return (
            <button
              key={column.status}
              type="button"
              role="tab"
              className={css.columnTab}
              aria-selected={activeColumn === column.status}
              aria-label={t(STATUS_KEY[column.status])}
              data-active={activeColumn === column.status ? 'true' : undefined}
              onClick={() => { jumpToColumn(column.status) }}
            >
              <span className={css.statusDot} data-status={column.status} aria-hidden="true" />
              <span className={css.columnTabLabel}>{t(STATUS_SHORT_KEY[column.status])}</span>
              <span className={css.columnTabCount}>{String(count)}</span>
            </button>
          )
        })}
      </div>

      <div
        className={css.columns}
        ref={columnsRef}
        data-dsh-tb-columns=""
        onScroll={syncActiveColumn}
      >
        {COLUMNS.map(column => {
          // Cards render in their column sort order (reorder drags rewrite
          // the order keys; the ledger array order is stable).
          const tasks = visible
            .filter(task => task.status === column.status)
            .sort((a, b) => a.order - b.order)
          const sameColumnDrag = dragId !== undefined && draggedTask?.status === column.status
          return (
            <section
              key={column.status}
              className={css.column}
              data-status={column.status}
              data-dragover={dragOver === column.status ? '' : undefined}
              data-dragreject={dragReject === column.status ? '' : undefined}
              data-dropaccept={dropAccept === column.status ? 'link' : undefined}
              onDragOver={event => {
                // The drag edge auto-scroll targets the column under the
                // pointer; the loop re-checks the pointer against the root
                // rect every frame, so a stale target is harmless.
                const cardsEl = cardsRefs.current[column.status]
                if (cardsEl !== null && cardsEl !== undefined) {
                  autoScrollRef.current = { status: column.status, cards: cardsEl }
                }
                // A latched external sidebar drag (session/workspace) marks
                // this column as the drop target; the board's own card drags
                // keep the reorder/move feedback below. The latch is cleared
                // only by a drop / drag end — never here — so crossing the
                // column's children cannot flicker the ring.
                if (externalRef.current) {
                  event.preventDefault()
                  if (dropGapRef.current !== undefined) {
                    dropGapRef.current = undefined
                    setDropGap(undefined)
                  }
                  setDragOver(undefined)
                  setDropAccept(column.status)
                  return
                }
                event.preventDefault()
                // A board-card drag: a column accepts a POSITIONED drop
                // whenever the drop resolves to a move — same-column always
                // reorders, and a cross-column move (待规划/待办/待审核/已完成)
                // may insert at an exact gap as well. Rerun zones (a drop on
                // 进行中 = run again) and reject zones keep the plain column
                // highlight; only a move target shows the insertion bar.
                const decision = dragId !== undefined && draggedTask !== undefined
                  ? resolveCardDrop(draggedTask, column.status)
                  : undefined
                const insertable = sameColumnDrag || decision?.kind === 'move'
                if (!insertable) {
                  if (dropGapRef.current !== undefined) {
                    dropGapRef.current = undefined
                    setDropGap(undefined)
                  }
                  setDragOver(column.status)
                  return
                }
                // The nearest gap decides — the indicator bar is the whole
                // feedback, no column border, for moves into any column
                // (applyGap is THE one gap-write path, shared with the
                // auto-scroll frame).
                setDragOver(undefined)
                applyGap(column.status, event.clientY)
              }}
              onDragLeave={event => {
                // A leave to a child of this column is not a leave of the
                // column: crossing cards/elements must never flicker the
                // highlight. relatedTarget null (left the window/drag end) is
                // a real leave.
                const related = event.relatedTarget as Node | null
                if (related !== null && (event.currentTarget as HTMLElement).contains(related)) return
                setDragOver(current => current === column.status ? undefined : current)
              }}
              onDrop={handleDrop(column.status)}
            >
              <header className={css.columnHeader}>
                <span className={css.statusDot} data-status={column.status} aria-hidden="true" />
                <h3 className={css.columnTitle}>{t(STATUS_KEY[column.status])}</h3>
                <span className={css.columnCount}>{tasks.length}</span>
              </header>
              {/* Drag events bubble from the cards: the container tracks the
                  drag source (dragstart/dragend); reorder anchors are
                  computed from pointer coordinates, not from hovered
                  elements, so gaps and card internals never break the math. */}
              <div
                className={css.cards}
                ref={element => { cardsRefs.current[column.status] = element }}
                onDragStart={event => {
                  const id = cardIdAt(event)
                  if (id !== undefined) {
                    // Synchronous source latch: any dragenter that follows
                    // belongs to this card drag and must never latch as
                    // external (the state `dragId` updates asynchronously,
                    // so the ref is the reliable signal).
                    dragSourceRef.current = true
                    setDragId(id)
                    setDropGap(undefined)
                    dropGapRef.current = undefined
                  }
                }}
                onDragEnd={clearDrag}
              >
                {dropGap !== undefined && dropGap.status === column.status && (
                  <span
                    ref={element => { indicatorRefs.current[column.status] = element }}
                    className={css.dropIndicator}
                    style={{ top: dropGap.top }}
                    aria-hidden="true"
                  />
                )}
                {tasks.map(task => {
                  // The task's pending sessions (approval / plan-review /
                  // question) across every execution + the refine session —
                  // read live so cards reflect the moment a session starts
                  // waiting (the controller notifies on session-list changes).
                  const pending = taskPendingCount(task, sessionId => controller.pendingInteractionOf(sessionId))
                  // ANY session of the card can be the one blocked on a human
                  // now (per-session lanes), so the chip reads the card's
                  // pending set — not the newest record's session, which is
                  // routinely a different conversation.
                  const waiting = pending.items[0]?.waitingKind
                  const pendingTitle = pending.items.length === 0
                    ? ''
                    : pending.items.map(item => {
                        if (item.executionId !== undefined) {
                          const index = plainRunsOf(task).findIndex(run => run.id === item.executionId) + 1
                          return t('card.pendingItem', {
                            n: String(index),
                            kind: t(waitingKeyOf(item.waitingKind)),
                          })
                        }
                        return t('card.pendingRefine', {
                          kind: t(waitingKeyOf(item.waitingKind)),
                        })
                      }).join('；')
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      live={controller.liveStateOf(task.id)}
                      boundTitleOf={candidate => {
                        const binds = taskBindsOf(candidate)
                        return binds.length > 0 ? controller.boundSourceTitleOf(binds[0]) : ''
                      }}
                      workspaceTitleOf={workspaceTitleOf}
                      waiting={waiting}
                      pendingCount={pending.count}
                      pendingTitle={pendingTitle}
                      unviewed={taskUnviewed(task)}
                      unviewedCount={taskUnviewedCount(task)}
                      selected={selectedCards.includes(task.id)}
                      onClick={event => { cardClick(task.id, event) }}
                      onQuickRun={taskExecutable(task) ? () => { void controller.rerunTask(task.id) } : undefined}
                      onColorPick={color => { controller.setTaskColor(task.id, color) }}
                    />
                  )
                })}
                {tasks.length === 0 && <div className={css.columnEmpty}>{t('board.empty')}</div>}
              </div>
            </section>
          )
        })}
      </div>

      {selected !== undefined && (
        <TaskDetail
          controller={controller}
          task={selected}
          workspaceTitleOf={workspaceTitleOf}
          dragSourceRef={dragSourceRef}
        />
      )}
      {showNew && (
        <NewTaskModal
          controller={controller}
          onClose={() => { setShowNew(false) }}
        />
      )}
      {showAutomation && (
        <AutomationPanel
          controller={controller}
          onClose={() => { setShowAutomation(false) }}
        />
      )}
      {showPalette && (
        <CommandPalette
          commands={buildCommands(t, {
            cruiseEnabled: snapshot.cruise.enabled,
            openNew: () => { setShowNew(true) },
            toggleCruise: () => { controller.setCruiseEnabled(!snapshot.cruise.enabled) },
            openOrganize: () => { setOrganizing(true) },
            openAutomation: () => { setShowAutomation(true) },
            openNotify: () => { setShowNotify(true) },
            closeBoard: () => { controller.closeBoard() },
          })}
          onClose={() => { setShowPalette(false) }}
          onRun={command => {
            setShowPalette(false)
            command.run()
          }}
        />
      )}
      {showNotify && (
        <Dialog title={t('board.notify')} label={t('board.notify')} onClose={() => { setShowNotify(false) }} portal>
          <div className={css.modalScroll}>
            {notes.length === 0 ? (
              <p className={css.detailText}>{t('board.notifyEmpty')}</p>
            ) : (
              <ul className={css.notifyList}>
                {notes.map(note => (
                  <li key={`${note.taskId}|${note.sessionId}`}>
                    <button
                      type="button"
                      className={css.notifyRow}
                      onClick={() => { setShowNotify(false); controller.openTask(note.taskId) }}
                    >
                      <span className={css.notifyTask} title={note.taskTitle}>
                        {note.taskTitle.trim() === '' ? t('card.untitled') : note.taskTitle}
                      </span>
                      <Chip kind="warn" fill={false}>{t(waitingKeyOf(note.waitingKind))}</Chip>
                      <span className={css.notifySession} title={note.sessionId}>{note.sessionTitle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog>
      )}
    </div>
  )
}
