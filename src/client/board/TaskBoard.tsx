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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { selectedTaskOf, type BoardController } from '../../core/controller.ts'
import { MAX_CRUISE_LIMIT } from '../../core/controller.ts'
import { WIP_LIMIT_MAX } from '../../core/board-doc.ts'
import { isHeartbeatStale } from '../../core/scheduler.ts'
import { COLUMNS, landingStatusOf, pendingCommentCount, plainRunsOf, resolveCardDrop, taskExecutable, type TaskStatus } from '../../core/tasks.ts'
import { taskPendingCount, taskUnviewed, taskUnviewedCount, taskViewedBaseline } from '../../core/session-display.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { useFlipRegion } from './use-flip.ts'
import { useSurfaceNarrow } from './use-narrow.ts'
import { activeColumnIndexAt, scrollLeftForColumn } from './column-tabs.ts'
import { Dialog } from './Dialog.tsx'
import { indicatorTopOf, insertionGapOf, type InsertionGap } from './drop-position.ts'
import { useDragAutoScroll } from './drag-autoscroll.ts'
import { cruiseStatusLineOf, cruiseWindowGrammarOf, DAY_MS, duplicateWindowOf, normalizeWindow, windowRangeIssueOf, type CruiseWindow, type CruiseWindowRangeIssue } from '../../core/cruise.ts'
import { formatCruiseTime, cruiseWindowLabelOf, formatDateTime, formatTime } from './format-time.ts'
import { dayBucketOf } from '../../core/board-events.ts'
import { NewTaskModal } from './NewTaskModal.tsx'
import { COLUMN_HINT_KEY, STATUS_KEY, STATUS_SHORT_KEY, wipCountsOf, wipSentenceKeyOf } from './status.ts'
import { TaskCard } from './TaskCard.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import { AutomationPanel } from './AutomationPanel.tsx'
import { TimeField } from './TimeField.tsx'
import { Button, ColorSwatches, Icon, Switch } from './ui.tsx'
import { waitingKeyOf } from './session-chip.ts'
import { candidateExternalDrag, externalDragOf, type SidebarDrag } from '../sidebar-drag.ts'
import { taskBindsOf } from '../../core/tasks.ts'

import { applyCompletion, boardShortcutOf, completeBoardQuery, isShortcutTyping, matchCheatRow, matchTask, type CheatRow } from './task-search.ts'
import { hasLiveAutomation } from '../../core/automation.ts'
import { foldNotesByTask, noteKeyOf, notificationsExOf, type NotificationItem } from './notifications.ts'
import { runnableIds } from './batch-run.ts'
import { cardNextActionOf, cardViewModelOf } from './card-view.ts'

/** The activity feed's chip: success greens, failure reds, everything else quiet. */
function activityChipOf(item: ActivityItem): { kind: 'neutral' | 'success' | 'error' | 'muted'; label: string } {
  if (item.kind === 'settled') {
    if (item.result === 'succeeded') return { kind: 'success', label: t('board.activitySucceeded') }
    if (item.result === 'failed') return { kind: 'error', label: t('board.activityFailed') }
    if (item.result === 'cancelled') return { kind: 'muted', label: t('board.activityCancelled') }
    return { kind: 'neutral', label: t('board.activitySettled') }
  }
  if (item.kind === 'comment') return { kind: 'neutral', label: t('board.activityComment') }
  if (item.kind === 'refined') return { kind: 'neutral', label: t('board.activityRefined') }
  if (item.kind === 'started') return { kind: 'neutral', label: t('board.activityStarted') }
  if (item.kind === 'queued') return { kind: 'neutral', label: t('board.activityQueued') }
  if (item.kind === 'running') return { kind: 'neutral', label: t('board.activityRunning') }
  if (item.kind === 'direct') return { kind: 'neutral', label: t('board.activityDirect') }
  if (item.kind === 'external') return { kind: 'neutral', label: t('board.activityExternal') }
  return { kind: 'neutral', label: t('board.activityCreated') }
}
import { activityGroupKeyOf, activityOf, clusterOf, freezeFeed, groupActivityByObjectDay, remainderKeyOf, splitGroupItems, CLUSTER_KINDS, type ActivityGroup, type ActivityItem } from './activity.ts'
import { deleteView, loadViews, MAX_SAVED_VIEWS, saveView, type SavedView } from './saved-views.ts'
import { Chip } from './Chip.tsx'

/**
 * Human day label for an activity group header: 今天 / 昨天, else the
 * MM-DD slice of the YYYY-MM-DD bucket (year omitted — the feed is a
 * glance, and the full instant lives in each row's preview). Pure.
 */
function dayLabelOf(day: string, today: string): string {
  if (day === today) return t('board.dayToday')
  const yesterday = dayBucketOf(Date.now() - 86_400_000)
  if (day === yesterday) return t('board.dayYesterday')
  return day.slice(5)
}

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

/** One soft-ceiling number field (THE typing discipline for WIP inputs, used
 *  twice): valid integers commit on edit; clearing happens on blur/Enter
 *  only, so selecting-all to retype never flickers the persisted ceiling
 *  through an empty middle state. */
function WipLimitField({ label, title, text, committed, onText, onCommit }: {
  label: string
  title: string
  text: string
  committed: number | undefined
  onText: (text: string) => void
  onCommit: (value: number | undefined) => void
}): ReactNode {
  return (
    <label className={css.cruisePopoverLimit}>
      <span className={css.cruisePopoverLabel}>{label}</span>
      <input
        className={css.cruiseLimit}
        type="number"
        min={1}
        max={WIP_LIMIT_MAX}
        value={text}
        title={title}
        aria-label={label}
        placeholder=""
        onChange={event => {
          onText(event.target.value)
          const raw = event.target.value.trim()
          if (raw === '') return
          const value = Number(raw)
          if (Number.isInteger(value) && value >= 1) {
            onCommit(value)
          }
        }}
        onBlur={() => {
          if (text.trim() === '') {
            onCommit(undefined)
          }
          onText(committed === undefined ? '' : String(committed))
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            (event.currentTarget as HTMLInputElement).blur()
          }
        }}
      />
    </label>
  )
}

/** Device-local key for the single-key shortcuts master switch (never
 *  renamed: input preference is per-device — syncing it would pollute another
 *  device's desktop habits. Absent/other values read enabled). */
const SHORTCUTS_STORAGE_KEY = 'dsh.taskBoard.shortcuts.v1'

/** Read the persisted shortcuts preference (session default on any failure). */
function readShortcutsEnabled(): boolean {
  try {
    return localStorage.getItem(SHORTCUTS_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

/** Board component; subscribes to the controller snapshot. */
export function TaskBoard({ controller }: { controller: BoardController }) {
  const [snapshot, setSnapshot] = useState(controller.getSnapshot())
  useEffect(
    () => controller.subscribe(() => setSnapshot(controller.getSnapshot())),
    [controller],
  )
  const [filter, setFilter] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [showNew, setShowNew] = useState(false)
  // 自动化总览弹层（板顶统一管理任务级 schedule + 会话级规则）。
  const [showAutomation, setShowAutomation] = useState(false)
  // 快捷键速查表 + 单键快捷键（`/`聚焦筛选、`x`清空、`?`开关本表）：无修饰键，
  // 输入中与弹窗内一律让路（触屏零损失，桌面键位零冲突），随 effect 释放监听。
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [cheatQuery, setCheatQuery] = useState('')
  // 保存的视图（命名筛选快照，设备本地）：列表态常驻内存，读写直达存储。
  const [showViews, setShowViews] = useState(false)
  const [views, setViews] = useState<SavedView[]>(() => loadViews())
  const [newViewName, setNewViewName] = useState('')
  useEffect(() => {
    if (showShortcuts) setCheatQuery('')
  }, [showShortcuts])
  // 单键快捷键总开关（设备本地偏好：触屏设备本就无键盘，同步它只会污染他人
  // 的桌面习惯——默认开，关后速查表仍可点达，永无死路）。
  const [shortcutsEnabled, setShortcutsEnabled] = useState(readShortcutsEnabled)
  const setShortcutsEnabledPersisted = (next: boolean): void => {
    setShortcutsEnabled(next)
    try {
      localStorage.setItem(SHORTCUTS_STORAGE_KEY, next ? '1' : '0')
    } catch {
      // Private mode / quota: the toggle still works for the session.
    }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      // Outside the board surface the board perceives nothing: native pages
      // and other views never feel `/`, `x` or `?`. The check reads the DOM
      // marker directly — never through the portal helper's body fallback
      // (a fallback anchor would make the fence trivially true).
      if (target === null || target.closest === undefined
        || target.closest('[data-dsh-taskboard-view]') === null) return
      // THE one typing judgment (editables + IME composing, single predicate).
      const shortcut = boardShortcutOf(event, isShortcutTyping(target, event))
      if (shortcut === undefined) return
      // Dialogs keep their keys — except the cheatsheet toggle, which stays
      // reachable wherever focus sits inside the board (orthogonal to Esc).
      if (target.closest('[role="dialog"]') !== null && shortcut !== 'toggle-help') return
      // Master switch off: single keys stay silent (the cheatsheet button
      // remains, so there is never a dead end).
      if (!shortcutsEnabled) return
      if (shortcut === 'focus-search') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (shortcut === 'clear-filter') {
        if (filter !== '') setFilter('')
      } else if (shortcut === 'toggle-help') {
        setShowShortcuts(current => !current)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [filter, shortcutsEnabled])
  // 通知中心弹层：等你处理的会话聚合 + 未读待审（行内 triage，点主区进详情）。
  const [showNotify, setShowNotify] = useState(false)
  const [notifyFilter, setNotifyFilter] = useState<'all' | 'waiting' | 'review'>('all')
  // 通知折叠组展开（单开；键 = taskId，与折叠聚合键同——snooze 换头、切分组
  // 都不动键，关屉或切分组即清，与动态组同纪律）。
  const [expandedFoldKey, setExpandedFoldKey] = useState<string | undefined>(undefined)
  useEffect(() => { setExpandedFoldKey(undefined) }, [notifyFilter])
  // 稍后见（内存态）：key → snooze 时刻；新动静（note.at 推进）自然再浮起。
  const [snoozed, setSnoozed] = useState<Record<string, number>>({})
  const [failedSession, setFailedSession] = useState<string | undefined>(undefined)
  // 未见水位（内存态，不进同步）：上次开屉瞬间看到的最大时刻。开屉灭点留数 —
  // 点只为开屉后新到的行而亮（到达感），数仍是全部未处理（待办量）。跨端不
  // 同步是有意的：unseen 是本端"眼睛"，unread 是全局"账"。
  const [drawerOpenedAt, setDrawerOpenedAt] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (!showNotify) {
      setSnoozed({})
      setFailedSession(undefined)
      setDrawerOpenedAt(undefined)
      setExpandedFoldKey(undefined)
    }
  }, [showNotify])
  // 板级动态弹层：全板近况聚合（只读派生，点行展开预览再进详情/会话）。
  const [showActivity, setShowActivity] = useState(false)
  const [activityKind, setActivityKind] = useState<'all' | 'run' | 'comment' | 'other'>('all')
  const [activityQuery, setActivityQuery] = useState('')
  const [activityUnviewed, setActivityUnviewed] = useState(false)
  const [activityShown, setActivityShown] = useState(30)
  const [expandedActivityKey, setExpandedActivityKey] = useState<string | undefined>(undefined)
  // Folded object-day groups share the single-open discipline: one expanded
  // group at a time, cleared on the same filter/show resets as row expansion.
  // The newest group opens WITH the drawer (最新默认展 — "what just happened"
  // answers itself with zero clicks); collapsing it stays collapsed.
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | undefined>(undefined)
  const groupInitRef = useRef(false)
  useEffect(() => {
    if (showActivity) {
      setActivityShown(30)
      setExpandedActivityKey(undefined)
      setExpandedGroupKey(undefined)
    } else {
      setFailedSession(undefined)
    }
  }, [showActivity, activityKind, activityQuery, activityUnviewed])
  // Live aggregation over the snapshot (the controller notifies on every
  // session-list change, so a newly-waiting session lights the bell at once).
  // Linked ids ride along so a bound-but-never-run waiting session notifies
  // like the card breathes (same related set as the live state).
  // Memoized: derivation walks every round, so unrelated local state (typing
  // in a filter box, expanding one row) must not re-walk the ledger.
  const notes = useMemo(() => notificationsExOf(
    snapshot.tasks,
    sessionId => controller.pendingInteractionOf(sessionId),
    sessionId => controller.sessionTitle(sessionId) ?? sessionId,
    task => taskUnviewed(task),
    task => controller.linkedOf(task).map(row => row.sessionId),
  ), [snapshot.tasks, snapshot, controller])
  const visibleNotes = useMemo(() => notes.filter(note => {
    if (notifyFilter === 'waiting' && note.kind !== 'waiting') return false
    if (notifyFilter === 'review' && note.kind !== 'review') return false
    // Snoozed rows stay hidden until newer activity (note.at) outruns the
    // snooze stamp — "稍后即再浮起", no timers, no stored state.
    if ((snoozed[noteKeyOf(note)] ?? -1) >= note.at) return false
    return true
  }), [notes, notifyFilter, snoozed])
  // 折叠与未见（与上面同 memo 纪律）：铃数与屉表同读折叠后（collapsed 计 1），
  // 未见点只为水位之后的 at 而亮。开屉处理器两处铃共用（同一行为，两处 DOM）。
  // 铃读“全局账减去稍后见”（与分组过滤正交）：snooze 藏起的行不再计数，
  // 屉内分组只改变视图，不改变账。
  const foldedNotes = useMemo(() => foldNotesByTask(notes.filter(note =>
    (snoozed[noteKeyOf(note)] ?? -1) < note.at)), [notes, snoozed])
  const foldedVisible = useMemo(() => foldNotesByTask(visibleNotes), [visibleNotes])
  const unseenCount = useMemo(() => drawerOpenedAt === undefined
    ? 0
    : notes.filter(note => note.at > drawerOpenedAt).length,
  [notes, drawerOpenedAt])
  const openNotify = (): void => {
    const at = Date.now()
    const maxAt = notes.reduce((max, note) => Math.max(max, note.at), at)
    setDrawerOpenedAt(maxAt)
    setShowNotify(true)
  }
  const renderNotifyBell = (): ReactNode => {
    const total = foldedNotes.length
    return (
      <button
        type="button"
        className={`${css.iconButton} ${css.notifyBell}`}
        aria-label={total > 0 ? t('board.notifyCount', { n: total > 99 ? '99+' : String(total) }) : t('board.notify')}
        title={t('board.notify')}
        onClick={openNotify}
      >
        <Icon name="bell" />
        {unseenCount > 0 && <span className={css.notifyDot} aria-hidden="true" />}
        {total > 0 && (
          <span className={css.notifyBadge} aria-hidden="true">
            {total > 99 ? '99+' : String(total)}
          </span>
        )}
      </button>
    )
  }
  // Activity feed derivation (memoized for the same reason as notes): typing
  // in the search box or expanding one row must not re-walk the ledger.
  const activityFeed = useMemo(() => {
    if (!showActivity) return []
    // Kind thirds read THE cluster table (new row kinds land in one place).
    const kinds = activityKind === 'all' ? undefined
      : [...CLUSTER_KINDS[activityKind]] as const
    return activityOf(snapshot.tasks, {
      ...(kinds !== undefined ? { kinds: [...kinds] } : {}),
      ...(activityQuery.trim() !== '' ? { query: activityQuery } : {}),
      ...(activityUnviewed ? { onlyUnviewed: true as const } : {}),
    }, (task, at) => at > taskViewedBaseline(task))
  }, [showActivity, snapshot.tasks, activityKind, activityQuery, activityUnviewed])
  // Read-freeze: while the drawer stays open, new arrivals queue behind a
  // pill instead of shoving the rows being read (top-insertion never steals
  // scroll). The freeze is a LENGTH, not a snapshot: the live list keeps
  // growing underneath, the view shows the oldest `feedBase` of it. A
  // negative base means "unfrozen" (first frame, filter mid-typing): the
  // whole live list shows, so the freeze engaging a beat later through the
  // effect below changes nothing visible (no empty/pill/truncation flash).
  const [feedBase, setFeedBase] = useState(-1)
  useEffect(() => {
    if (showActivity) setFeedBase(activityFeed.length)
  }, [showActivity, activityKind, activityQuery, activityUnviewed])
  // Newest-group auto-expansion (once per open; user collapses stick).
  useEffect(() => {
    if (!showActivity || groupInitRef.current) return
    groupInitRef.current = true
    const first = activityFeed[0]
    if (first === undefined) return
    setExpandedGroupKey(activityGroupKeyOf(first.taskId, dayBucketOf(first.at), clusterOf(first.kind)))
  }, [showActivity, activityFeed])
  useEffect(() => {
    if (!showActivity) groupInitRef.current = false
  }, [showActivity])
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
  // THE live selection (single funnel): raw ids intersected with the cards
  // actually on the board. Selection survives filtering on purpose (a
  // cross-filter batch keeps its members — clearing the filter shows them
  // again); only cards deleted elsewhere (sync, another tab) drop out, so
  // counts, confirmations and runs never fire at ghosts. Every reader below
  // takes this list, never the raw state.
  const liveIds = useMemo(() => {
    const present = new Set(snapshot.tasks.map(task => task.id))
    return selectedCards.filter(id => present.has(id))
  }, [snapshot.tasks, selectedCards])
  // Prune dead ids from state (keeps the raw list from rotting; the derived
  // list above is what renders, so pruning never flickers the UI).
  useEffect(() => {
    if (liveIds.length !== selectedCards.length) setSelectedCards(liveIds)
  }, [liveIds, selectedCards.length])
  const exitOrganize = (): void => {
    setOrganizing(false)
    clearSelection()
  }
  /** 批量换色（undefined = 移除颜色，经单一色表文法的「移除颜色」点触发）。 */
  const applyColorToSelected = (color: string | undefined): void => {
    const targets = snapshot.tasks.filter(task => liveIds.includes(task.id))
    for (const task of targets) controller.setTaskColor(task.id, color)
  }
  /** 批量删除（确认后）；删除会同步取消板上的选中集。 */
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false)
  const deleteSelected = (): void => {
    for (const id of liveIds) controller.deleteTask(id)
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
  // Soft WIP ceilings: same typing discipline as the cruise limit — empty text
  // means unlimited (clears the ceiling); a valid integer commits on edit.
  const [wipGlobalText, setWipGlobalText] = useState(snapshot.cruise.wip?.global === undefined ? '' : String(snapshot.cruise.wip.global))
  const [wipRunningText, setWipRunningText] = useState(snapshot.cruise.wip?.running === undefined ? '' : String(snapshot.cruise.wip.running))
  useEffect(() => { setWipGlobalText(snapshot.cruise.wip?.global === undefined ? '' : String(snapshot.cruise.wip.global)) }, [snapshot.cruise.wip?.global])
  useEffect(() => { setWipRunningText(snapshot.cruise.wip?.running === undefined ? '' : String(snapshot.cruise.wip.running)) }, [snapshot.cruise.wip?.running])
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
  // One-shot deep link into a task's session panel (notification / activity
  // rows land on the session's comment thread, not just the task): the
  // session half is honored only while the native side still knows it
  // (sessionTitle undefined = gone/never-a-session, e.g. a review row's
  // task-id fallback) — then it degrades to a plain task open, never a panel
  // for a garbage id.
  const [detailSessionRequest, setDetailSessionRequest] = useState<{ taskId: string; sessionId: string } | undefined>(undefined)
  const openTaskAtSession = (taskId: string, sessionId: string | undefined): void => {
    // Unknown sessions degrade to a plain task open (never a panel for a
    // garbage id) — and to the task-wide clear, so the session-scoped clear
    // below only ever runs for a session the host actually knows.
    const known = sessionId !== undefined && controller.sessionTitle(sessionId) !== undefined
    setDetailSessionRequest(known && sessionId !== undefined ? { taskId, sessionId } : undefined)
    // Feed/drawer opens clear the viewed session's rounds (unknown sessions
    // fall back to the whole task); pure card clicks keep openTask. ONE funnel.
    controller.openTaskFromNotification(taskId, known ? sessionId : undefined)
  }
  // Resolve a workspace id to its display title through the run catalog
  // (live workspace list; falls back to the raw id when the workspace no
  // longer exists or no catalog is wired). Declared before the board filter:
  // the filter's `ws:` facet resolves through it during the same render.
  const workspaceTitleOf = (workspaceId: string): string => {
    const row = controller.runCatalog()
      ?.listWorkspaces()
      .find(candidate => candidate.id === workspaceId)
    return row?.title ?? workspaceId
  }
  // Board-wide search: title/description/prompt/comments plus linked-session
  // titles (the same derivation the rows render — a session renamed natively
  // stays findable under its live name), plus facet qualifiers (see
  // QUALIFIER_KEYS in task-search.ts — the one key set) resolved from the
  // same live faces the rows render. `has:auto` reads THE automation
  // membership (schedule enabled OR any enabled session rule), never a
  // second judgment.
  const visible = snapshot.tasks.filter(task =>
    matchTask(task, filter, controller.linkedOf(task).map(row => row.title), {
      ...(task.workspaceId !== undefined
        ? { workspaceTitle: workspaceTitleOf(task.workspaceId) }
        : {}),
      hasAutomation: hasLiveAutomation(task),
      isUnviewed: taskUnviewed(task),
    }))
  // WIP counts: THE one full-ledger computation — the status line, the
  // compact tabs and the column headers all read this value, so the three
  // surfaces can never disagree on denominators.
  const wipCounts = useMemo(
    () => wipCountsOf(snapshot.tasks.map(task => task.status)),
    [snapshot.tasks],
  )
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
      if (liveIds.includes(task.id) && task.color !== undefined) return task.color
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
            // Soft WIP awareness (advisory only): counts come from THE shared
            // full-ledger computation above (never the search-filtered
            // `visible`, so the sentence never mixes denominators). Over-limit
            // folds to ONE sentence (running wins over global) in the existing
            // status slot — never a new row, never a block on drags.
            const wipSentence = wipSentenceKeyOf(wipCounts, snapshot.cruise.wip)
            const stateParts = [
              ...snapshot.stats.running > 0 ? [t('board.statusRunning', { n: String(snapshot.stats.running) })] : [],
              ...snapshot.stats.queued > 0 ? [t('board.statusQueued', { n: String(snapshot.stats.queued) })] : [],
              ...wipSentence !== undefined ? [t(wipSentence.key, wipSentence.params)] : [],
              // Forbid-policy skip ledger: cumulative and read-only, shown only
              // while nonzero (the same quiet discipline as running/queued) —
              // "why didn't it run" stays answerable without a new row.
              ...snapshot.skips.overlap + snapshot.skips.missed > 0
                ? [t('board.statusSkipped', { n: String(snapshot.skips.overlap + snapshot.skips.missed) })]
                : [],
              // Heartbeat liveness (read-only): one plain sentence in the same
              // slot when no tick completed within Period + Grace. Suppressed
              // while quiet (nothing armed needs the heartbeat) and on viewer
              // replicas (their local stamp freezing is expected — the engine
              // drives automation). No breathing change, no new entry.
              ...(() => {
                const armedSchedule = snapshot.tasks.some(task => task.schedule?.enabled === true)
                const quiet = !snapshot.cruise.enabled && !armedSchedule
                const viewer = snapshot.engine.synced && !snapshot.engine.held
                const lastOkAt = snapshot.heartbeat.lastOkAt
                return !quiet && !viewer && lastOkAt !== undefined && isHeartbeatStale(lastOkAt, Date.now())
                  ? [t('board.heartbeatStale', { time: formatDateTime(lastOkAt) })]
                  : []
              })(),
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
                {/* 柔性在制品上限：与巡航同属板级共享状态，收敛在同一巡航设置
                    弹层——不新增顶层入口、不新增按钮。空=不限；超限只着色解释。 */}
                <div className={css.cruiseSchedule}>
                  <div className={css.cruiseScheduleHead}>
                    <span className={css.cruiseScheduleTitle}>{t('board.wipSection')}</span>
                  </div>
                  <p className={css.detailHint}>{t('board.wipHint')}</p>
                  <div className={css.cruiseWindowAdd}>
                    <WipLimitField
                      label={t('board.wipGlobal')}
                      title={t('board.wipTitle')}
                      text={wipGlobalText}
                      committed={snapshot.cruise.wip?.global}
                      onText={setWipGlobalText}
                      onCommit={value => { controller.setWipLimit('global', value) }}
                    />
                    <WipLimitField
                      label={t('board.wipRunning')}
                      title={t('board.wipTitle')}
                      text={wipRunningText}
                      committed={snapshot.cruise.wip?.running}
                      onText={setWipRunningText}
                      onCommit={value => { controller.setWipLimit('running', value) }}
                    />
                  </div>
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
                          key={`${window.startAt ?? 'open'}-${window.endAt ?? 'open'}`}
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
            ref={searchRef}
            className={css.search}
            type="search"
            placeholder={t('board.search')}
            value={filter}
            list="dsh-tb-qualifiers"
            onChange={event => { setFilter(event.target.value) }}
            aria-label={t('board.search')}
          />
          {/* Qualifier suggestions (native datalist: zero chrome, zero keys,
              mobile degrades to a plain input — the cheatsheet stays the
              learning surface, this only shortens typing). Candidates arrive
              as WHOLE queries (the datalist swaps the entire value — a bare
              token would eat earlier terms). */}
          <datalist id="dsh-tb-qualifiers">
            {completeBoardQuery(filter).map(candidate => (
              <option key={candidate} value={applyCompletion(filter, candidate)} />
            ))}
          </datalist>
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
            {/* 动态：全板近况聚合（只读 — 点行进任务详情，派生自台账，不同步）。
                拇指栏里有同一个入口（同一处理器）：窄屏下这里隐藏，归属见
                thumbBar 注释 — 一处行为，两处 DOM，每宽度只见一处。 */}
            <Button
              variant="ghost"
              className={css.modeDynamic}
              title={t('board.activityTitle')}
              onClick={() => { setFeedBase(-1); setShowActivity(true) }}
            >
              {t('board.activity')}
            </Button>
            {/* 通知：等你处理的会话聚合（只读列表 — 点行进任务详情，
                会话操作归详情页）。有等待事项才亮数（折叠计 1），开屉后新到
                才亮点，无则安静。 */}
            {renderNotifyBell()}
            {/* 快捷键：与动态/通知同一收纳（窄屏下沉拇指栏，同一处理器）——
                触屏没有 `?` 键，速查表必须可点可达。 */}
            <Button
              variant="ghost"
              className={css.modeShortcuts}
              title={`${t('board.shortcuts')} (?)`}
              onClick={() => { setShowShortcuts(true) }}
            >
              {t('board.shortcuts')}
            </Button>
            {/* 保存的视图：命名筛选快照（设备本地个人视角，不同步）——同一
                收纳纪律，窄屏下沉拇指栏。 */}
            <Button
              variant="ghost"
              className={css.modeViews}
              title={t('board.views')}
              onClick={() => { setShowViews(true) }}
            >
              {t('board.views')}
            </Button>
          </span>
        </div>

        {/* 多选横栏（整理模式或已有选中时出现）：先点卡片（Ctrl/Cmd+点击或整理
            模式下直接点）选中高亮，再在板头横栏批量换色 / 删除 / 全选清选。 */}
        {(organizing || liveIds.length > 0) && (
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
              <span className={css.organizeCount}>{t('board.organizeCount', { n: String(liveIds.length) })}</span>
              {/* Selection group: select-all / clear / done + the danger
                  delete right next to 完成 (one right-cluster, hairline
                  between — the destructive action reads as part of the same
                  group instead of drifting across the bar). */}
              <span className={css.organizeActions}>
                {/* Batch run FIRST (the bar's apex action — firing is why the
                    selection exists; 完成 merely exits the mode, so it reads
                    secondary). Only prompt-ready cards fire; the rest stay
                    put visibly (the launch point owns lanes and budget). */}
                {liveIds.length > 0 && (
                  <Button
                    size="sm"
                    variant="primary"
                    title={t('board.organizeRunTitle')}
                    disabled={runnableIds(snapshot.tasks, liveIds).length === 0}
                    onClick={() => {
                      for (const id of runnableIds(snapshot.tasks, liveIds)) {
                        void controller.runTask(id, 'manual')
                      }
                    }}
                  >
                    {t('board.organizeRun', {
                      m: String(runnableIds(snapshot.tasks, liveIds).length),
                      n: String(liveIds.length),
                    })}
                  </Button>
                )}
                <Button size="sm" onClick={() => { setSelectedCards(visible.map(task => task.id)) }}>
                  {t('board.organizeSelectAll')}
                </Button>
                <Button size="sm" disabled={liveIds.length === 0} onClick={clearSelection}>
                  {t('board.organizeClear')}
                </Button>
                <Button size="sm" onClick={exitOrganize}>
                  {t('board.organizeDone')}
                </Button>
                {/* Danger group: delete the selected cards — only once there
                    IS a selection (an empty organize mode never flashes a
                    destructive button next to the color row), separated from
                    完成 by the hairline. */}
                {liveIds.length > 0 && (
                  <span className={css.organizeDanger}>
                    <Button size="sm" variant="danger" disabled={liveIds.length === 0} onClick={() => { setConfirmDeleteSelected(true) }}>
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
            title={t('board.deleteSelectedTitle', { n: String(liveIds.length) })}
            message={t('board.deleteSelectedConfirm')}
            confirmLabel={t('board.deleteSelectedOk', { n: String(liveIds.length) })}
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
          文法即列头——状态点 + 名称 + 计数，tab 就是它跳转的列。超限染色与列头
          同源（全量口径），手机滑轨上同样可见。 */}
      <div className={css.columnTabs} role="tablist" aria-label={t('board.title')}>
        {COLUMNS.map(column => {
          const count = visible.filter(task => task.status === column.status).length
          // Over-limit tint shares the status line's counts AND its sentence
          // question (masked per column), so tab, header and status can never
          // disagree on what "over" means.
          const columnWip = column.status === 'running'
            ? { running: snapshot.cruise.wip?.running }
            : column.status === 'review'
              ? { global: snapshot.cruise.wip?.global }
              : undefined
          const tabOver = columnWip !== undefined
            && wipSentenceKeyOf(wipCounts, columnWip) !== undefined
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
              <span className={css.columnTabCount} {...tabOver ? { 'data-over': 'true' } : {}}>{String(count)}</span>
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
                <h3 className={css.columnTitle} title={t(COLUMN_HINT_KEY[column.status])}>{t(STATUS_KEY[column.status])}</h3>
                {(() => {
                  // Soft WIP tint reuses the existing count slot — same pill,
                  // zero extra width (compact-safe). The over question is the
                  // status line's, masked to this column (running reads the
                  // running ceiling, review the global one). An over-limit
                  // count is a real button into the cruise/WIP settings (the
                  // unified board-level entry) with an aria-label — touch and
                  // keyboard can reach the why, never hover-only title.
                  const columnWip = column.status === 'running'
                    ? { running: snapshot.cruise.wip?.running }
                    : column.status === 'review'
                      ? { global: snapshot.cruise.wip?.global }
                      : undefined
                  const overSentence = columnWip === undefined
                    ? undefined
                    : wipSentenceKeyOf(wipCounts, columnWip)
                  if (overSentence === undefined) {
                    return <span className={css.columnCount}>{tasks.length}</span>
                  }
                  const overLabel = t(overSentence.key, overSentence.params)
                  return (
                    <button
                      type="button"
                      className={css.columnCount}
                      data-over="true"
                      aria-label={overLabel}
                      title={overLabel}
                      onClick={() => { setCruiseOpen(true) }}
                    >
                      {tasks.length}
                    </button>
                  )
                })()}
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
                  // Session dots: related sessions (deduped, stable order) with
                  // live waiting > running > idle. Max 3 rendered, +N overflow.
                  const relatedIds = [...controller.relatedSessionIdSet(task)]
                  const dotStateOf = (sessionId: string): 'waiting' | 'running' | 'idle' => {
                    if (controller.pendingInteractionOf(sessionId) !== undefined) return 'waiting'
                    if (controller.nativeRunningOf(sessionId)) return 'running'
                    return 'idle'
                  }
                  const dots = relatedIds.slice(0, 3).map(sessionId => ({ sessionId, state: dotStateOf(sessionId) }))
                  const overflowDots = Math.max(0, relatedIds.length - dots.length)
                  // One quiet next-action sentence (same primary the chips show).
                  const view = cardViewModelOf(task, {
                    live: controller.liveStateOf(task.id),
                    pendingCount: pending.count,
                    ...(waiting !== undefined ? { waiting } : {}),
                    unviewedCount: taskUnviewedCount(task),
                  })
                  const nextFact = cardNextActionOf(view, task)
                  const nextAction = nextFact === undefined ? undefined : (() => {
                    switch (nextFact.kind) {
                      case 'waiting': return t('card.nextWaiting')
                      case 'running': return t('card.nextRunning')
                      case 'refining': return t('card.nextRefining')
                      case 'queued': return t('card.nextQueued', { n: String(nextFact.count ?? 0) })
                      case 'failed': return t('card.nextFailed')
                      case 'review': return t('card.nextReview')
                      case 'scheduled': return t('card.nextScheduled')
                      case 'chain': return t('card.nextChain')
                    }
                  })()
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
                      dots={dots}
                      overflowDots={overflowDots}
                      nextAction={nextAction}
                      dotTitleOf={sessionId => {
                        const title = controller.sessionTitle(sessionId) ?? sessionId
                        const state = dotStateOf(sessionId)
                        return state === 'waiting'
                          ? `${title} · ${t(waitingKeyOf(controller.pendingInteractionOf(sessionId)!))}`
                          : state === 'running' ? `${title} · ${t('detail.result.running')}` : title
                      }}
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
          requestSessionId={detailSessionRequest !== undefined && detailSessionRequest.taskId === selected.id
            ? detailSessionRequest.sessionId
            : undefined}
          onRequestSessionConsumed={() => { setDetailSessionRequest(undefined) }}
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
      {showNotify && (
        <Dialog title={t('board.notify')} label={t('board.notify')} onClose={() => { setShowNotify(false); setSnoozed({}) }} portal>
          <div className={css.modalScroll}>
            <div className={css.feedTools} role="group" aria-label={t('board.notify')}>
              <span className={css.feedFilterGroup}>
                {(['all', 'waiting', 'review'] as const).map(kind => (
                  <button
                    key={kind}
                    type="button"
                    className={css.feedFilter}
                    data-active={notifyFilter === kind ? '' : undefined}
                    aria-pressed={notifyFilter === kind}
                    onClick={() => { setNotifyFilter(kind) }}
                  >
                    {t(`board.notifyFilter.${kind}`)}
                  </button>
                ))}
              </span>
              {notes.length > 0 && (
                <button
                  type="button"
                  className={css.feedAction}
                  onClick={() => { controller.markAllViewed() }}
                  title={t('board.notifyMarkAllTitle')}
                >
                  {t('board.notifyMarkAll')}
                </button>
              )}
              {/* 组标已读只对 review 层有意义：waiting 行等的是人的动作，
                  标读清不掉它——按钮在纯 waiting 视图下隐藏，而不是摆一个
                  静默 no-op 让用户以为坏了。混合视图下只传 review 行（去重），
                  waiting 行的出路只留去会话/稍后见/进详情。 */}
              {visibleNotes.some(note => note.kind === 'review') && (
                <button
                  type="button"
                  className={css.feedAction}
                  onClick={() => {
                    controller.markTasksViewed([...new Set(
                      visibleNotes.filter(note => note.kind === 'review').map(note => note.taskId),
                    )])
                  }}
                  title={t('board.notifyMarkGroupTitle')}
                >
                  {t('board.notifyMarkGroup')}
                </button>
              )}
            </div>
            {visibleNotes.length === 0 ? (
              <p className={css.detailText}>{t(notes.length === 0 ? 'board.notifyEmpty' : 'board.notifyFilterEmpty')}</p>
            ) : (
              <ul className={css.notifyList}>
                {(() => {
                  // ONE row grammar: heads and members render through this —
                  // a folded group never restyles its members.
                  const renderNotifyRow = (note: NotificationItem): ReactNode => {
                    const key = noteKeyOf(note)
                    const taskTitle = note.taskTitle.trim() === '' ? t('card.untitled') : note.taskTitle
                    return (
                      <li key={key}>
                        <div className={css.notifyRow} data-kind={note.kind}>
                          <button
                            type="button"
                            className={css.notifyMain}
                            title={note.taskTitle}
                            aria-label={taskTitle}
                            onClick={() => { setShowNotify(false); openTaskAtSession(note.taskId, note.sessionId) }}
                          >
                            <span className={css.notifyTask}>{taskTitle}</span>
                            {note.kind === 'waiting' && note.waitingKind !== undefined ? (
                              <Chip kind="warn" fill={false}>{t(waitingKeyOf(note.waitingKind))}</Chip>
                            ) : (
                              <Chip kind={note.result === 'failed' ? 'error' : 'success'} fill={false}>
                                {t(note.result === 'failed' ? 'board.notifyReviewFailed' : 'board.notifyReview')}
                              </Chip>
                            )}
                            <span className={css.notifySession} title={note.sessionId}>{note.sessionTitle}</span>
                          </button>
                          <span className={css.notifyActions}>
                            {note.kind === 'waiting' ? (
                              <>
                                <button
                                  type="button"
                                  className={css.feedAction}
                                  onClick={() => {
                                    if (!controller.openSession(note.sessionId)) setFailedSession(note.sessionId)
                                  }}
                                >
                                  {t('board.notifyGoSession')}
                                </button>
                                <button
                                  type="button"
                                  className={css.feedAction}
                                  onClick={() => { setSnoozed(current => ({ ...current, [key]: note.at })) }}
                                  title={t('board.notifySnoozeTitle')}
                                >
                                  {t('board.notifySnooze')}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className={css.feedAction}
                                  onClick={() => { controller.moveTask(note.taskId, 'done') }}
                                >
                                  {t('board.notifyApprove')}
                                </button>
                                <button
                                  type="button"
                                  className={css.feedAction}
                                  onClick={() => { controller.markTaskViewed(note.taskId) }}
                                >
                                  {t('board.notifyMarkOne')}
                                </button>
                              </>
                            )}
                          </span>
                        </div>
                        {failedSession === note.sessionId && (
                          <p className={css.detailHint}>{t('detail.sessionUnavailable')}</p>
                        )}
                      </li>
                    )
                  }
                  return foldedVisible.map(entry => {
                    // Unfolded heads render exactly like before; folded groups
                    // keep head actions by MEMBER KINDS present (waiting rows
                    // offer go, review rows offer 标已读 — both when mixed),
                    // plus a chevron toggle (same disclosure law as the feed
                    // groups) — full per-session triage (snooze/approve) lives
                    // one tap away in members, so the N-1 buried sessions stay
                    // reachable while the collapsed row stays quiet.
                    if (entry.count === 1) return renderNotifyRow(entry.head)
                    const foldedOpen = expandedFoldKey === entry.head.taskId
                    const head = entry.head
                    const headTitle = head.taskTitle.trim() === '' ? t('card.untitled') : head.taskTitle
                    const headWaiting = entry.items.find(item => item.kind === 'waiting')
                    const headHasReview = entry.items.some(item => item.kind === 'review')
                    return (
                      <li key={entry.head.taskId}>
                        <div className={css.notifyRow} data-kind={head.kind}>
                          <button
                            type="button"
                            className={css.feedAction}
                            aria-expanded={foldedOpen}
                            aria-label={headTitle}
                            onClick={() => { setExpandedFoldKey(current => current === entry.head.taskId ? undefined : entry.head.taskId) }}
                          >
                            <Icon name="chevronDown" className={css.detailChevron} />
                          </button>
                          <button
                            type="button"
                            className={css.notifyMain}
                            title={head.taskTitle}
                            aria-label={headTitle}
                            onClick={() => { setShowNotify(false); openTaskAtSession(head.taskId, head.sessionId) }}
                          >
                            <span className={css.notifyTask}>{headTitle}</span>
                            <Chip kind="neutral" fill={false}>{`×${entry.count}`}</Chip>
                            <span className={css.notifySession} title={head.sessionId}>{head.sessionTitle}</span>
                          </button>
                          <span className={css.notifyActions}>
                            {headWaiting !== undefined && (
                              <button
                                type="button"
                                className={css.feedAction}
                                onClick={() => {
                                  if (!controller.openSession(headWaiting.sessionId)) setFailedSession(headWaiting.sessionId)
                                }}
                              >
                                {t('board.notifyGoSession')}
                              </button>
                            )}
                            {headHasReview && (
                              <button
                                type="button"
                                className={css.feedAction}
                                onClick={() => { controller.markTaskViewed(head.taskId) }}
                              >
                                {t('board.notifyMarkOne')}
                              </button>
                            )}
                          </span>
                        </div>
                        {foldedOpen && (
                          <ul className={css.notifyList}>
                            {(() => {
                              // Members share the dynamic groups' cap
                              // discipline: newest GROUP_ITEM_LIMIT rows plus
                              // one quiet remainder line (navigation stays on
                              // the head's actions).
                              const split = splitGroupItems(entry.items)
                              return (
                                <>
                                  {split.shown.map(renderNotifyRow)}
                                  {split.rest > 0 && (
                                    <li key={remainderKeyOf(entry.head.taskId)}>
                                      <p className={css.detailHint}>
                                        {t('board.activityGroupRest', { n: String(split.rest) })}
                                      </p>
                                    </li>
                                  )}
                                </>
                              )
                            })()}
                          </ul>
                        )}
                      </li>
                    )
                  })
                })()}
              </ul>
            )}
          </div>
        </Dialog>
      )}
      {showActivity && (
        <Dialog title={t('board.activity')} label={t('board.activity')} onClose={() => { setShowActivity(false) }} portal>
          <div className={css.modalScroll}>
            <div className={css.feedTools} role="group" aria-label={t('board.activity')}>
              <span className={css.feedFilterGroup}>
                {(['all', 'run', 'comment', 'other'] as const).map(kind => (
                  <button
                    key={kind}
                    type="button"
                    className={css.feedFilter}
                    data-active={activityKind === kind ? '' : undefined}
                    aria-pressed={activityKind === kind}
                    onClick={() => { setFeedBase(-1); setActivityKind(kind) }}
                  >
                    {t(`board.activityFilter.${kind}`)}
                  </button>
                ))}
              </span>
              <button
                type="button"
                className={css.feedFilter}
                data-active={activityUnviewed ? '' : undefined}
                aria-pressed={activityUnviewed}
                onClick={() => { setFeedBase(-1); setActivityUnviewed(current => !current) }}
              >
                {t('board.activityUnviewed')}
              </button>
              <input
                className={css.feedSearch}
                type="search"
                placeholder={t('board.activitySearch')}
                value={activityQuery}
                onChange={event => { setFeedBase(-1); setActivityQuery(event.target.value) }}
                aria-label={t('board.activitySearch')}
              />
            </div>
            {(() => {
              const live = activityFeed
              // Frozen window: the oldest `feedBase` rows stay put while new
              // arrivals queue behind the pill (never a mid-read shove).
              const { frozen: feed, fresh } = freezeFeed(live, feedBase)
              if (feed.length === 0) return <p className={css.detailText}>{t('board.activityEmpty')}</p>
              const shown = feed.slice(0, activityShown)
              // Day groups (data-driven buckets, no fixed windows): one header
              // per local calendar day, newest day first.
              const todayBucket = dayBucketOf(Date.now())
              const groups = new Map<string, typeof shown>()
              for (const item of shown) {
                const day = dayBucketOf(item.at)
                const list = groups.get(day)
                if (list !== undefined) list.push(item)
                else groups.set(day, [item])
              }
              // ONE row grammar: every feed row — standalone or folded group
              // member — renders through this, so a group can never restyle
              // its members into a second visual language.
              const renderActivityRow = (item: ActivityItem): ReactNode => {
                const chip = activityChipOf(item)
                const expanded = expandedActivityKey === item.key
                const title = item.taskTitle.trim() === '' ? t('card.untitled') : item.taskTitle
                return (
                  <li key={item.key}>
                    <div className={css.notifyRow} data-kind={item.kind}>
                      <button
                        type="button"
                        className={css.notifyMain}
                        title={item.taskTitle}
                        aria-label={title}
                        aria-expanded={expanded}
                        onClick={() => { setExpandedActivityKey(current => current === item.key ? undefined : item.key) }}
                      >
                        <span className={css.notifyTask}>{title}</span>
                        <Chip kind={chip.kind} fill={false}>{chip.label}</Chip>
                        <span className={css.notifySession} title={item.text ?? ''}>
                          {item.text !== undefined && item.text.trim() !== ''
                            ? item.text.slice(0, 24)
                            : formatTime(item.at)}
                        </span>
                      </button>
                      <span className={css.notifyActions}>
                        <button
                          type="button"
                          className={css.feedAction}
                          onClick={() => { setShowActivity(false); openTaskAtSession(item.taskId, item.sessionId) }}
                        >
                          {t('board.activityOpen')}
                        </button>
                        {item.sessionId !== undefined && (
                          <button
                            type="button"
                            className={css.feedAction}
                            onClick={() => {
                              if (!controller.openSession(item.sessionId!)) setFailedSession(item.sessionId)
                            }}
                          >
                            {t('board.notifyGoSession')}
                          </button>
                        )}
                      </span>
                    </div>
                    {expanded && (
                      <div className={css.feedPreview}>
                        <p className={css.detailText}>
                          {item.text !== undefined && item.text.trim() !== '' ? item.text : formatDateTime(item.at)}
                        </p>
                        <p className={css.detailHint}>
                          {t('board.activityPreviewHint', { time: formatDateTime(item.at) })}
                        </p>
                      </div>
                    )}
                    {failedSession === item.sessionId && item.sessionId !== undefined && (
                      <p className={css.detailHint}>{t('detail.sessionUnavailable')}</p>
                    )}
                  </li>
                )
              }
              // Object-day folding: a busy object-day collapses to one header
              // (title + count + chevron); single-item groups render exactly
              // like unfolded rows, so sparse feeds look byte-identical to
              // before. No unread signal here by contract — unread breathes on
              // the card only; the filter-level `onlyUnviewed` still applies.
              // Expanded groups show the newest GROUP_ITEM_LIMIT rows plus one
              // quiet remainder line (the header's 进详情 owns navigation).
              const renderObjectGroup = (group: ActivityGroup): ReactNode => {
                if (group.items.length <= 1) return group.items.length === 1 ? renderActivityRow(group.items[0]) : null
                const groupExpanded = expandedGroupKey === group.key
                const title = group.taskTitle.trim() === '' ? t('card.untitled') : group.taskTitle
                const split = groupExpanded ? splitGroupItems(group.items) : { shown: [], rest: 0 }
                return (
                  <li key={group.key}>
                    <div className={css.notifyRow} data-kind={group.items[0].kind}>
                      <button
                        type="button"
                        className={css.notifyMain}
                        title={group.taskTitle}
                        aria-label={title}
                        aria-expanded={groupExpanded}
                        onClick={() => { setExpandedGroupKey(current => current === group.key ? undefined : group.key) }}
                      >
                        <Icon name="chevronDown" className={css.detailChevron} />
                        <span className={css.notifyTask}>{title}</span>
                        <Chip kind="neutral" fill={false}>{`×${group.items.length}`}</Chip>
                        <span className={css.notifySession}>{formatTime(group.items[0].at)}</span>
                      </button>
                      <span className={css.notifyActions}>
                        <button
                          type="button"
                          className={css.feedAction}
                          onClick={() => { setShowActivity(false); openTaskAtSession(group.taskId, undefined) }}
                        >
                          {t('board.activityOpen')}
                        </button>
                      </span>
                    </div>
                    {groupExpanded && (
                      <ul className={css.notifyList}>
                        {split.shown.map(renderActivityRow)}
                        {split.rest > 0 && (
                          <li key={remainderKeyOf(group.key)}>
                            <p className={css.detailHint}>
                              {t('board.activityGroupRest', { n: String(split.rest) })}
                            </p>
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                )
              }
              return (
                <>
                  {/* Queued arrivals: one pill, never an insertion shove. Tapping
                      it jumps to the live head (re-freezes at the newest). */}
                  {fresh > 0 && (
                    <button
                      type="button"
                      className={css.feedAction}
                      onClick={() => { setFeedBase(live.length) }}
                    >
                      {t('board.activityNew', { n: String(fresh) })}
                    </button>
                  )}
                  {[...groups.entries()].map(([day, items]) => (
                    <section key={day} aria-label={dayLabelOf(day, todayBucket)}>
                      <h3 className={css.feedDay}>{dayLabelOf(day, todayBucket)}</h3>
                      <ul className={css.notifyList}>
                        {groupActivityByObjectDay(items, dayBucketOf).map(renderObjectGroup)}
                      </ul>
                    </section>
                  ))}
                  {feed.length > shown.length && (
                    <button
                      type="button"
                      className={css.feedAction}
                      onClick={() => { setActivityShown(current => current + 30) }}
                    >
                      {t('board.activityMore', { n: String(feed.length - shown.length) })}
                    </button>
                  )}
                </>
              )
            })()}
          </div>
        </Dialog>
      )}
      {/* Cheatsheet renders after every other overlay: same-layer stacking
          paints it on top, so `?` from inside the activity drawer (or any
          board dialog) actually surfaces instead of hiding underneath. */}
      {showShortcuts && (
        <Dialog title={t('board.shortcuts')} label={t('board.shortcuts')} onClose={() => { setShowShortcuts(false) }} portal>
          <div className={css.modalScroll}>
            <label className={css.cruisePopoverLimit}>
              <Switch
                checked={shortcutsEnabled}
                onChange={next => { setShortcutsEnabledPersisted(next) }}
                label={t('board.shortcutsToggle')}
                title={t('board.shortcutsToggle')}
              />
            </label>
            <input
              className={css.search}
              type="search"
              placeholder={t('board.shortcutFilter')}
              value={cheatQuery}
              data-autofocus
              onChange={event => { setCheatQuery(event.target.value) }}
              aria-label={t('board.shortcutFilter')}
            />
            {([
              { key: '/', text: t('board.shortcutSearch') },
              { key: 'x', text: t('board.shortcutClear') },
              { key: '?', text: t('board.shortcutHelp') },
            ] as CheatRow[]).filter(row => matchCheatRow(row, cheatQuery)).map(row => (
              <p key={row.key} className={css.detailText}>
                <Chip kind="neutral" fill={false}>{row.key}</Chip> {row.text}
              </p>
            ))}
            <p className={css.detailHint}>{t('board.shortcutQuali')}</p>
          </div>
        </Dialog>
      )}
      {showViews && (
        <Dialog title={t('board.views')} label={t('board.views')} onClose={() => { setShowViews(false) }} portal>
          <div className={css.modalScroll}>
            {/* Save the current filter under a name (empty name/filter or a
                full shelf keeps the button off — the store backstops it
                anyway). */}
            <div className={css.cruiseWindowAdd}>
              <input
                className={css.search}
                type="text"
                placeholder={t('board.viewName')}
                value={newViewName}
                data-autofocus
                onChange={event => { setNewViewName(event.target.value) }}
                aria-label={t('board.viewName')}
              />
              <Button
                size="sm"
                disabled={newViewName.trim() === '' || filter.trim() === '' || views.length >= MAX_SAVED_VIEWS}
                onClick={() => {
                  // The store reports the outcome: the typed name survives a
                  // failed save (full shelf behind a stale count) instead of
                  // being eaten silently.
                  const outcome = saveView(newViewName, filter)
                  setViews(outcome.views)
                  if (outcome.saved) setNewViewName('')
                }}
              >
                {t('board.viewSave')}
              </Button>
            </div>
            {views.length >= MAX_SAVED_VIEWS && (
              <p className={css.detailHint}>{t('board.viewsFull', { n: String(MAX_SAVED_VIEWS) })}</p>
            )}
            {views.length === 0 ? (
              <p className={css.detailText}>{t('board.viewsEmpty')}</p>
            ) : (
              <ul className={css.notifyList}>
                {views.map(view => (
                  <li key={view.id}>
                    <div className={css.notifyRow} data-kind="view">
                      <button
                        type="button"
                        className={css.notifyMain}
                        title={view.filter}
                        aria-label={view.name}
                        onClick={() => { setFilter(view.filter); setShowViews(false) }}
                      >
                        <span className={css.notifyTask}>{view.name}</span>
                        <span className={css.notifySession} title={view.filter}>{view.filter}</span>
                      </button>
                      <span className={css.notifyActions}>
                        <button
                          type="button"
                          className={css.feedAction}
                          onClick={() => { setViews(deleteView(view.id)) }}
                        >
                          {t('board.organizeDelete')}
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog>
      )}
      {/* Thumb bar (compact only — CSS gates visibility): the thumb-zone
          shortcuts. Every member reuses its header handler verbatim
          (setShowNew / notify / activity), so desktop and phone share one
          behavior and there is nothing new to maintain. */}
      <nav className={css.thumbBar} aria-label={t('board.thumbBar')}>
        <span className={css.thumbNew}>
          <Button variant="primary" onClick={() => { setShowNew(true) }}>
            {t('board.new')}
          </Button>
        </span>
        {renderNotifyBell()}
        <Button
          variant="ghost"
          title={`${t('board.shortcuts')} (?)`}
          onClick={() => { setShowShortcuts(true) }}
        >
          {t('board.shortcuts')}
        </Button>
        <Button
          variant="ghost"
          title={t('board.views')}
          onClick={() => { setShowViews(true) }}
        >
          {t('board.views')}
        </Button>
        <Button
          variant="ghost"
          title={t('board.activityTitle')}
          onClick={() => { setFeedBase(-1); setShowActivity(true) }}
        >
          {t('board.activity')}
        </Button>
      </nav>
    </div>
  )
}
