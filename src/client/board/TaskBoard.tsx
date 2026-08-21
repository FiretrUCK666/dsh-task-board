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
import { useEffect, useRef, useState } from 'react'
import { selectedTaskOf, type BoardController } from '../../core/controller.ts'
import { COLUMNS, landingStatusOf, plainRunsOf, resolveCardDrop, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
import { taskPendingCount, taskUnviewed, taskUnviewedCount } from '../../core/session-display.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { insertionGapOf, type InsertionGap } from './drop-position.ts'
import { duplicateWindowOf, type CruiseWindow } from '../../core/cruise.ts'
import { formatCruiseTime } from './format-time.ts'
import { NewTaskModal } from './NewTaskModal.tsx'
import { STATUS_KEY } from './status.ts'
import { TaskCard } from './TaskCard.tsx'
import { formatDateTime } from './TaskCard.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import { AutomationPanel } from './AutomationPanel.tsx'
import { TagManager } from './TagManager.tsx'
import { TimeField } from './TimeField.tsx'
import { Button, ColorSwatches, Icon, Switch } from './ui.tsx'
import { candidateExternalDrag, externalDragOf, type SidebarDrag } from '../sidebar-drag.ts'
import { TAG_PALETTE, taskMatchesTags, type Tag } from '../../core/tags.ts'

/** Case-insensitive keyword match over title/description AND tag names. */
function matchesFilter(task: TaskRecord, filter: string, tagNames: Record<string, string>): boolean {
  if (filter.trim() !== '') {
    const needle = filter.trim().toLowerCase()
    const byTitle = task.title.toLowerCase().includes(needle) || task.description.toLowerCase().includes(needle)
    const byTag = (task.tags ?? []).some(id => tagNames[id]?.toLowerCase().includes(needle))
    if (!byTitle && !byTag) return false
  }
  return true
}

/** Whether `b` lies on the calendar day AFTER `a` (a normalized cross-midnight
 *  window end: e.g. 22:00 开始、次日 02:00 结束 → display "次日 02:00"). */
function isNextDay(a: number, b: number): boolean {
  const from = new Date(a)
  const to = new Date(b)
  if (to.getTime() <= from.getTime()) return false
  return to.getFullYear() !== from.getFullYear()
    || to.getMonth() !== from.getMonth()
    || to.getDate() !== from.getDate()
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
  // 标签筛选：多选 AND（同时含全部选中标签），再点取消；空 = 不过滤。
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  // 标签管理弹层。
  const [showTags, setShowTags] = useState(false)
  // 自动化总览弹层（板顶统一管理任务级 schedule + 会话级规则）。
  const [showAutomation, setShowAutomation] = useState(false)
  const toggleTag = (id: string): void => {
    setSelectedTags(current => current.includes(id) ? current.filter(tagId => tagId !== id) : [...current, id])
  }
  // 整理模式（批量）：点击卡片切换选中（高亮），板头横栏对选中集批量打标签/换色。
  const [organizing, setOrganizing] = useState(false)
  const [selectedCards, setSelectedCards] = useState<string[]>([])
  const toggleCard = (id: string): void => {
    setSelectedCards(current => current.includes(id) ? current.filter(cardId => cardId !== id) : [...current, id])
  }
  const clearSelection = (): void => { setSelectedCards([]) }
  const exitOrganize = (): void => {
    setOrganizing(false)
    clearSelection()
  }
  /** 批量加/去标签：全部选中卡都有该标签则移除，否则加上（与单卡 toggle 一致）。 */
  const applyTagToSelected = (tagId: string): void => {
    const targets = snapshot.tasks.filter(task => selectedCards.includes(task.id))
    if (targets.length === 0) return
    const allHave = targets.every(task => (task.tags ?? []).includes(tagId))
    for (const task of targets) {
      const owned = new Set(task.tags ?? [])
      if (allHave) {
        owned.delete(tagId)
      } else {
        owned.add(tagId)
      }
      controller.setTaskTags(task.id, [...owned])
    }
  }
  /** 批量换色（undefined = 清除）。 */
  const applyColorToSelected = (color: string | undefined): void => {
    const targets = snapshot.tasks.filter(task => selectedCards.includes(task.id))
    for (const task of targets) controller.setTaskColor(task.id, color)
  }

  // 自动巡航设置弹层：点击胶囊的 ▾ 展开；点击弹层外任意处关闭。
  const [cruiseOpen, setCruiseOpen] = useState(false)
  const cruiseWrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!cruiseOpen) return
    const onDown = (event: MouseEvent): void => {
      if (cruiseWrapRef.current !== null && !cruiseWrapRef.current.contains(event.target as Node)) {
        setCruiseOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [cruiseOpen])
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
   * 02:00）合法：归一化在 setCruiseSchedule 里自动 +1 天处理，绝不拒绝。
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

  // 弹层里的巡航状态行：当前开启中（至何时）或 关闭（下一窗口何时）；开始/结束
  // 均可选（无开始=从当前起视为开；无结束=保持开）。
  const cruiseSchedule = snapshot.cruise.schedule
  const cruiseNow = Date.now()
  const coveringWindow = cruiseSchedule.find(window =>
    (window.startAt === undefined || window.startAt <= cruiseNow)
    && (window.endAt === undefined || window.endAt > cruiseNow))
  const nextWindow = cruiseSchedule
    .filter(window => (window.startAt ?? cruiseNow) > cruiseNow)
    .sort((a, b) => (a.startAt ?? a.endAt ?? 0) - (b.startAt ?? b.endAt ?? 0))[0]
  const cruiseStateLine = snapshot.cruise.enabled
    ? coveringWindow !== undefined && coveringWindow.endAt !== undefined
      ? t('board.cruiseStateOnUntil', { time: formatCruiseTime(coveringWindow.endAt) })
      : t('board.cruiseStateOn')
    : nextWindow !== undefined && nextWindow.startAt !== undefined
      ? t('board.cruiseStateNext', { time: formatCruiseTime(nextWindow.startAt) })
      : t('board.cruiseStateOff')
  const [dragOver, setDragOver] = useState<TaskStatus | undefined>(undefined)
  const [dragReject, setDragReject] = useState<TaskStatus | undefined>(undefined)
  // The column that accepted a drop, for the one-shot accent flash. Own
  // timer lifecycle: the window-level `drop` listener fires right after the
  // column handler and must not erase the flash before its animation plays.
  const [dropFlash, setDropFlash] = useState<TaskStatus | undefined>(undefined)
  // The id of the card being dragged and the insertion gap it would land at —
  // a gap now also recalls WHICH column it was computed for, so a cross-column
  // move previews (and drops at) an exact position, not just the tail. The
  // gap is mirrored in a ref (written synchronously on every dragover, read at
  // drop) so the drop always matches the preview, never a stale render closure.
  const [dragId, setDragId] = useState<string | undefined>(undefined)
  const [dropGap, setDropGap] = useState<{ status: TaskStatus; gap: InsertionGap } | undefined>(undefined)
  const dropGapRef = useRef<{ status: TaskStatus; gap: InsertionGap } | undefined>(undefined)
  // The .cards container per column (for half-split rect measurements).
  const cardsRefs = useRef<Partial<Record<TaskStatus, HTMLDivElement | null>>>({})
  // Guards the reject-flash timer against unmount (drop feedback only).
  const rejectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    if (rejectTimer.current !== undefined) clearTimeout(rejectTimer.current)
  }, [])
  // Guards the drop-confirm flash timer against unmount (drop feedback only).
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current)
  }, [])
  // The column currently accepting an external sidebar drag (session/workspace
  // dragged in from the sidebar): a distinct highlight from the board's own
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
  const tags = snapshot.tags
  // id → name map for keyword search over tag names.
  const tagNames = Object.fromEntries(tags.map(tag => [tag.id, tag.name]))
  const visible = snapshot.tasks.filter(task =>
    matchesFilter(task, filter, tagNames) && taskMatchesTags(task, selectedTags))
  // In organize mode clicking a card toggles its selection; otherwise it opens
  // the detail — one decision point for the whole board.
  const cardClick = (id: string): void => {
    if (organizing) toggleCard(id)
    else controller.openTask(id)
  }
  // Organize-bar color slot: the first selected card's color, else the head of
  // the preset palette (the swatch row applies instantly on click).
  const orgColorValue = (() => {
    for (const task of snapshot.tasks) {
      if (selectedCards.includes(task.id) && task.color !== undefined) return task.color
    }
    return TAG_PALETTE[0]
  })()
  const hasSelectedColor = selectedCards.some(id => snapshot.tasks.find(task => task.id === id)?.color !== undefined)
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
    // Clamp into the container: the column-top gap center may fall above the
    // padding box; the indicator must never be clipped thinner by the
    // scroll container.
    return { beforeId: gap.beforeId, top: Math.max(0, gap.top - containerTop) }
  }

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

  /** One-shot accent confirmation on the column that accepted a drop. The
      flash is transient feedback: its own timer (not clearDrag) removes the
      attribute, because the window-level drop listener runs right after the
      column handler and would erase the flash before the animation plays. */
  const flashColumn = (status: TaskStatus): void => {
    setDropFlash(status)
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => { setDropFlash(undefined) }, 600)
  }

  /**
   * Column-level drop: same-column drops reorder (the half-split anchor the
   * last dragover computed); cross-column drops keep the classic
   * move/rerun/reject semantics; an external sidebar drag (session/workspace)
   * creates a bound task in this column. Every drop ends with a full drag
   * reset, so no transient highlight can survive the gesture.
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
      gapRef !== undefined && gapRef.status === target ? gapRef.gap.beforeId : undefined
    const external = externalOf(event)
    const id = dragId ?? event.dataTransfer.getData('text/plain')
    clearDrag()
    if (external !== undefined) {
      event.stopPropagation()
      createFromSidebar(external, status)
      flashColumn(status)
      return
    }
    const task = snapshot.tasks.find(candidate => candidate.id === id)
    if (task === undefined) return
    if (dragId !== undefined && task.status === status) {
      controller.moveTask(task.id, status, gapOf(status))
      flashColumn(status)
      return
    }
    const decision = resolveCardDrop(task, status)
    if (decision.kind === 'move') {
      controller.moveTask(task.id, decision.status, gapOf(decision.status))
      flashColumn(decision.status)
    } else if (decision.kind === 'run') {
      // Dropping on 'running' means "run again" (same semantics as the
      // detail button; the shared run guard rejects a live run).
      void controller.rerunTask(task.id)
      flashColumn(status)
    } else if (decision.kind === 'reject') {
      setDragReject(status)
      if (rejectTimer.current !== undefined) clearTimeout(rejectTimer.current)
      rejectTimer.current = setTimeout(() => { setDragReject(undefined) }, 600)
    }
  }

  return (
    <div
      className={css.board}
      data-dsh-taskboard-board=""
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
        {/* 命令栏（第一行）：返回对话 + 板名 …… 状态 + 自动巡航 + 新建任务。
            唯一强调是「+ 新建任务」，其余安静 —— 用留白与层级分组，不堆边框。 */}
        <div className={css.boardRow}>
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
          <span className={css.boardSpacer} />
          {/* 安静的行内巡航状态：仅在确实有东西在跑/排队时出现，否则整条隐藏。 */}
          {snapshot.stats.running + snapshot.stats.queued > 0 && (
            <span className={css.boardStatus}>
              <span className={css.boardStatusDot} aria-hidden="true" />
              {t('board.statusRunning', { n: String(snapshot.stats.running) })}
              {' · '}
              {t('board.statusQueued', { n: String(snapshot.stats.queued) })}
            </span>
          )}
          {/* 自动巡航：一颗安静的胶囊（开关 + 设置 ▾），点击展开定时设置弹层。 */}
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
              <div className={css.cruisePopover} role="menu" aria-label={t('board.cruiseSettings')}>
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
                      max={20}
                      value={snapshot.cruise.limit}
                      title={t('board.cruiseLimit')}
                      aria-label={t('board.cruiseLimit')}
                      onChange={event => {
                        const value = Number(event.target.value)
                        if (Number.isInteger(value) && value >= 1) controller.setCruiseLimit(value)
                      }}
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
                          {/* 双行紧凑时间：开始/结束各占一行、各自完整可读，
                              不再用长格式白单行拼 → 结束被省略号截掉。完整时间在
                              每行的 title（tooltip）里始终可取。 */}
                          <span className={css.cruiseWindowTime}>
                            {window.startAt !== undefined && (
                              <span className={css.cruiseWindowTimeRow}>
                                <span className={css.cruiseWindowTimeLabel}>{t('board.cruiseWinStart')}</span>
                                <span className={css.cruiseWindowTimeValue} title={formatDateTime(window.startAt)}>
                                  {formatCruiseTime(window.startAt)}
                                </span>
                              </span>
                            )}
                            {window.endAt !== undefined ? (
                              <span className={css.cruiseWindowTimeRow}>
                                <span className={css.cruiseWindowTimeLabel}>{t('board.cruiseWinEnd')}</span>
                                {/* A normalized cross-midnight window shows the
                                    end on the start's NEXT day (22:00 → 次日 02:00). */}
                                <span className={css.cruiseWindowTimeValue} title={formatDateTime(window.endAt)}>
                                  {window.startAt !== undefined && isNextDay(window.startAt, window.endAt)
                                    ? `${t('board.cruiseNextDay')} ${formatCruiseTime(window.endAt)}`
                                    : formatCruiseTime(window.endAt)}
                                </span>
                              </span>
                            ) : (
                              <span className={css.cruiseWindowTimeRow}>
                                <span className={css.cruiseWindowTimeLabel}>{t('board.cruiseWinEnd')}</span>
                                <span className={css.cruiseWindowTimeValue}>{t('board.cruiseWindowNoEnd')}</span>
                              </span>
                            )}
                          </span>
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
                    <TimeField
                      label={t('board.cruiseWindowStart')}
                      value={windowStart}
                      allowEmpty={false}
                      onChange={next => { setWindowStart(next); setCruiseError(undefined) }}
                    />
                    <TimeField
                      label={t('board.cruiseWindowEnd')}
                      hint={t('board.cruiseWinEndHint')}
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
              </div>
            )}
          </div>
          <Button
            variant="primary"
            onClick={() => { setShowNew(true) }}
          >
            + {t('board.new')}
          </Button>
        </div>

        {/* 工具行（第二行）：筛选搜索，弹性宽度，安静胶囊。 */}
        <div className={css.boardRow}>
          <input
            className={css.search}
            type="search"
            placeholder={t('board.search')}
            value={filter}
            onChange={event => { setFilter(event.target.value) }}
            aria-label={t('board.search')}
          />
          <Button
            size="sm"
            variant={organizing ? 'primary' : 'ghost'}
            onClick={() => { organizing ? exitOrganize() : setOrganizing(true) }}
          >
            {t('board.organize')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title={t('board.automationTitle')}
            onClick={() => { setShowAutomation(true) }}
          >
            {t('board.automation')}
          </Button>
        </div>

        {/* 整理模式横栏：标签与配色、卡片颜色的批量操作全部在板头完成——
            先点卡片（选中高亮），再点标签/色板批量应用到选中集。 */}
        {organizing && (
          <div className={css.boardRow}>
            <span className={css.organizeBar}>
              <span className={css.organizeGroup}>
                <span className={css.organizeLabel}>{t('board.organizeTags')}</span>
                {tags.length === 0
                  ? <span className={css.organizeLabel}>{t('board.organizeNoTags')}</span>
                  : tags.map(tag => {
                    const targets = snapshot.tasks.filter(task => selectedCards.includes(task.id))
                    const on = targets.length > 0 && targets.every(task => (task.tags ?? []).includes(tag.id))
                    return (
                      <span
                        key={tag.id}
                        role="button"
                        tabIndex={0}
                        className={`${css.cardTag}${on ? ` ${css.cardTagOn}` : ''}`}
                        title={t('board.organizeTagTitle')}
                        onClick={() => { applyTagToSelected(tag.id) }}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            applyTagToSelected(tag.id)
                          }
                        }}
                      >
                        <span className={css.cardTagDot} style={{ background: tag.color }} aria-hidden="true" />
                        {tag.name}
                      </span>
                    )
                  })}
              </span>
              <span className={css.organizeGroup}>
                <span className={css.organizeLabel}>{t('board.organizeColor')}</span>
                <ColorSwatches
                  value={orgColorValue}
                  onChange={color => { applyColorToSelected(color) }}
                />
                {hasSelectedColor && (
                  <button type="button" className={css.rowHide} onClick={() => { applyColorToSelected(undefined) }}>
                    {t('tags.clearColor')}
                  </button>
                )}
              </span>
              <span className={css.organizeCount}>{t('board.organizeCount', { n: String(selectedCards.length) })}</span>
              <span className={css.organizeActions}>
                <Button size="sm" onClick={() => { setSelectedCards(visible.map(task => task.id)) }}>
                  {t('board.organizeSelectAll')}
                </Button>
                <Button size="sm" disabled={selectedCards.length === 0} onClick={clearSelection}>
                  {t('board.organizeClear')}
                </Button>
                <Button size="sm" variant="primary" onClick={exitOrganize}>
                  {t('board.organizeDone')}
                </Button>
              </span>
            </span>
          </div>
        )}

        {/* 标签筛选行（第三行，仅在已有标签或正在筛选时出现）：点击标签多选
            AND 筛选，再点取消；「管理」打开标签管理弹层；筛选激活时显示「清除」。 */}
        {(tags.length > 0 || selectedTags.length > 0) && (
          <div className={css.boardRow}>
            {tags.map(tag => {
              const on = selectedTags.includes(tag.id)
              return (
                <span
                  key={tag.id}
                  role="button"
                  tabIndex={0}
                  className={`${css.tagFilter}${on ? ` ${css.tagFilterOn}` : ''}`}
                  title={t('tags.filterTitle')}
                  onClick={() => { toggleTag(tag.id) }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggleTag(tag.id)
                    }
                  }}
                >
                  <span className={css.tagFilterDot} style={{ background: tag.color }} aria-hidden="true" />
                  {tag.name}
                </span>
              )
            })}
            <span className={css.tagFilterActions}>
              {selectedTags.length > 0 && (
                <button type="button" className={css.rowHide} onClick={() => { setSelectedTags([]) }}>
                  {t('tags.clear')}
                </button>
              )}
              <Button size="sm" onClick={() => { setShowTags(true) }}>
                {t('tags.manage')}
              </Button>
            </span>
          </div>
        )}

      </header>

      <div className={css.columns}>
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
              data-flash={dropFlash === column.status ? '' : undefined}
              data-dropaccept={dropAccept === column.status ? 'link' : undefined}
              onDragOver={event => {
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
                // feedback, no column border, for moves into any column.
                setDragOver(undefined)
                const gap = gapAt(column.status, event.clientY)
                const moved = dropGapRef.current === undefined
                  || dropGapRef.current.status !== column.status
                  || gap.beforeId !== dropGapRef.current.gap.beforeId
                  || gap.top !== dropGapRef.current.gap.top
                if (moved) {
                  dropGapRef.current = { status: column.status, gap }
                  setDropGap({ status: column.status, gap })
                }
              }}
              onDragLeave={() => {
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
                    className={css.dropIndicator}
                    style={{ top: dropGap.gap.top }}
                    aria-hidden="true"
                  />
                )}
                {tasks.map(task => {
                  // The task's pending sessions (approval / plan-review /
                  // question) across every execution + the refine session —
                  // read live so cards reflect the moment a session starts
                  // waiting (the controller notifies on session-list changes).
                  const latest = task.executions[task.executions.length - 1]
                  const pending = taskPendingCount(task, sessionId => controller.pendingInteractionOf(sessionId))
                  const waiting = latest?.sessionId !== undefined
                    ? controller.pendingInteractionOf(latest.sessionId)
                    : undefined
                  const pendingTitle = pending.items.length === 0
                    ? ''
                    : pending.items.map(item => {
                        if (item.executionId !== undefined) {
                          const index = plainRunsOf(task).findIndex(run => run.id === item.executionId) + 1
                          return t('card.pendingItem', {
                            n: String(index),
                            kind: t(`waiting.${item.waitingKind}` as 'waiting.approval'),
                          })
                        }
                        return t('card.pendingRefine', {
                          kind: t(`waiting.${item.waitingKind}` as 'waiting.approval'),
                        })
                      }).join('；')
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      tags={(task.tags ?? []).map(id => tags.find(tag => tag.id === id)).filter((tag): tag is Tag => tag !== undefined)}
                      workspaceTitleOf={workspaceTitleOf}
                      waiting={waiting}
                      pendingCount={pending.count}
                      pendingTitle={pendingTitle}
                      unviewed={taskUnviewed(task)}
                      unviewedCount={taskUnviewedCount(task)}
                      selected={organizing && selectedCards.includes(task.id)}
                      onClick={() => { cardClick(task.id) }}
                      onQuickRun={() => { void controller.rerunTask(task.id) }}
                      onTagClick={id => { toggleTag(id) }}
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
      {showTags && (
        <TagManager
          controller={controller}
          onClose={() => { setShowTags(false) }}
        />
      )}
      {showAutomation && (
        <AutomationPanel
          controller={controller}
          onClose={() => { setShowAutomation(false) }}
        />
      )}
    </div>
  )
}
