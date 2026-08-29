/**
 * Task detail: the full view of one task — content, prompt, execution
 * history — and the only place execution can be triggered. Also offers
 * delete (with confirmation), manual status moves, and a jump to the
 * execution's session transcript.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { MANUAL_STATUSES, hasOpenRun, latestExecutionOf, plainRunsOf, ruleReadiness, taskBindsOf, taskExecutable, type ExecutionRecord, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
import { hiddenSessionIdsOf, sessionWindowOf } from '../../core/session-list.ts'
import { sessionDisplay, sessionTimes } from '../../core/session-display.ts'
import { permissionLabel } from '../permission-label.ts'
import { t, type TaskBoardKey } from '../locales.ts'
import css from '../board.module.css'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { Chip, type ChipKind } from './Chip.tsx'
import { formatDateTime, formatDuration, formatTime } from './format-time.ts'
import { TaskForm } from './TaskForm.tsx'
import { draftFromTask, draftToUpdatePatch, type TaskDraft } from './task-draft.ts'
import { AutomationEditor, scheduleSummary } from './automation-ui.tsx'
import { sessionStateChip, waitingKeyOf } from './session-chip.ts'
import { indicatorTopOf, insertionGapOf } from './drop-position.ts'
import { useDragAutoScroll } from './drag-autoscroll.ts'
import { RefineSection } from './RefineSection.tsx'
import { ReviewDetail } from './ReviewDetail.tsx'
import { SessionDetail } from './SessionDetail.tsx'
import { NewSessionModal } from './NewSessionModal.tsx'
import { AddSessionModal } from './AddSessionModal.tsx'
import { SessionRow } from './SessionRow.tsx'
import { latestCommentView, sessionCommentsOf } from './comment-thread.ts'
import { editDraftKey, draftStore } from './drafts.ts'
import { Button, Disclosure, Icon, Section } from './ui.tsx'
import { STATUS_KEY, PAUSED_REASON_KEY } from './status.ts'
import { candidateExternalDrag, externalDragOf } from '../sidebar-drag.ts'

/** Status → shared-chip color (detail badge). */
const STATUS_CHIP: Record<TaskStatus, ChipKind> = {
  backlog: 'neutral',
  todo: 'neutral',
  running: 'warn',
  review: 'neutral',
  done: 'success',
}

/** The one comment summary of a session row (count + newest body + time),
 *  shared verbatim by run rows and linked rows: a body-less round leaves the
 *  slot to the row's own state chip + time — never a state word dressed up as
 *  content. */
function CommentSummary({ task, sessionId, cruiseOn }: {
  task: TaskRecord
  sessionId: string | undefined
  cruiseOn: boolean
}) {
  const comments = sessionId !== undefined ? sessionCommentsOf(task, sessionId, cruiseOn) : []
  const latest = sessionId !== undefined ? latestCommentView(task, sessionId, cruiseOn) : undefined
  if (latest === undefined) return null
  return (
    <span className={css.executionComments} title={latest.text}>
      <span className={css.executionCommentsCount}>{t('detail.comments', { n: String(comments.length) })}</span>
      {latest.text !== '' && (
        <span className={css.executionCommentsLatest}>{t('detail.latestComment', { text: latest.text })}</span>
      )}
      <span className={css.executionCommentsTime}>{latest.at !== undefined ? formatTime(latest.at) : ''}</span>
    </span>
  )
}

/** One session row of a task — THE single row grammar for every session
 *  (run rows open their review page + show comments/dynamics/error; linked
 *  rows show the workspace label + idle chip). The state chip comes from the
 *  ONE derivation (sessionStateChip) — only the settled-label pair differs
 *  between a run row (the execution result) and a linked row (the bound
 *  session's activity). */
function SessionActionRow({ row, task, controller, cruiseOn, workspaceTitleOf, onReviewExecution, onOpenSessionPanel, draggable, onDragStart, onDragEnd }: {
  row: import('../../core/session-list.ts').TaskSessionRow
  task: TaskRecord
  controller: BoardController
  cruiseOn: boolean
  /** Resolve the task's workspace id to its display title (row grammar). */
  workspaceTitleOf: (workspaceId: string) => string
  /** A run row opens its review page (review the conversation and comment). */
  onReviewExecution: (execution: ExecutionRecord) => void
  /** Every row opens the session panel/thread for its native session. */
  onOpenSessionPanel: (sessionId: string) => void
  /** The manual 会话 reorder wiring (drag + settle), passed through to the
   *  shared row — one row skeleton, the reorder stays a detail concern. */
  draggable?: boolean
  onDragStart?: (event: React.DragEvent) => void
  onDragEnd?: () => void
}) {
  const isRun = row.executionId !== undefined
  const sessionId = row.sessionId
  if (isRun) {
    const execution = task.executions.find(candidate => candidate.id === row.executionId)
    if (execution === undefined) return null
    const session = sessionDisplay(task, execution, row.display.waitingKind, controller.nativeRunningOf(sessionId))
    const times = sessionTimes(task, execution)
    const isActive = session.state === 'running' || session.state === 'waiting'
    // The ONE workspace chip grammar with the linked rows: a run row names
    // its workspace (the task's configured workspace) the same way a linked
    // row names its own — no row family reads differently.
    const runWorkspace = task.workspaceId !== undefined ? workspaceTitleOf(task.workspaceId) : ''
    return (
      <SessionRow
        state={session.state}
        /* THE chip derivation — ONE vocabulary with the linked rows: a
           settled session reads 已完成 (the run's outcome facts — duration,
           comments, the review page — carry the execution semantics). */
        chip={sessionStateChip(session.state, session.waitingKind, 'detail.linkedDone', 'detail.result.cancelled')}
        leading={
          <span className={css.sessionRowLeading} title={row.title}>
            {/* The SAME leading grammar as a linked row: a kind icon (play =
                this task's own run, link = an externally bound session), the
                session title, then the optional workspace label — one row
                skeleton for every session of a task. */}
            <Icon name="play" className={css.sessionRowIcon} />
            <span className={css.sessionRowName}>{row.title}</span>
            {runWorkspace !== '' && runWorkspace !== row.title && (
              <span className={css.sessionRowWorkspace}>{runWorkspace}</span>
            )}
          </span>
        }
        meta={
          <>
            {t('detail.executionStarted')} {formatDateTime(times.startedAt)}
            {' · '}
            {t('detail.executionEnded')} {times.endedAt !== undefined ? formatDateTime(times.endedAt) : '—'}
            {times.duration !== undefined && (
              <> · {t('detail.duration', { d: formatDuration(times.duration) })}</>
            )}
          </>
        }
        footer={
          <>
            <CommentSummary task={task} sessionId={sessionId} cruiseOn={cruiseOn} />
            {isActive && (
              <span className={css.executionDynamics}>
                <span className={css.executionDynamicsLabel}>
                  {session.waitingKind !== undefined
                    ? t('detail.handleHint', { kind: t(waitingKeyOf(session.waitingKind)) })
                    : t('detail.sessionActive')}
                </span>
              </span>
            )}
            {execution.error !== undefined && execution.error !== '' && (
              <span className={css.executionError}>{execution.error}</span>
            )}
          </>
        }
        unviewed={row.unviewed}
        unviewedTitle={t('detail.unviewedTitle')}
        handle={session.state === 'waiting' && sessionId !== undefined ? t('detail.handle') : undefined}
        sessionId={sessionId}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onRename={async title => {
          const result = await controller.renameTaskSession(task.id, sessionId, title)
          if (!result.ok) throw new Error(result.error)
        }}
        renameTitle={t('detail.renameSessionTitle')}
        onActivate={() => { onReviewExecution(execution) }}
        onOpenSession={() => { if (sessionId !== undefined) controller.openSession(sessionId) }}
        onHide={() => { controller.hideTaskSession(task.id, sessionId) }}
        hideTitle={t('detail.hideRow')}
      />
    )
  }
  // ONE chip grammar with the run rows: every linked row carries a state chip
  // (waiting / running / completed / idle) — a row never reads as "no state"
  // next to a run row that always has one.
  const chip = sessionStateChip(row.display.state, row.display.waitingKind, 'detail.linkedDone', 'detail.linkedIdle', 'detail.idleHint')
  // The SAME grammar as a run row: the session's activity window (its rounds
  // on this task — board runs and externally-observed turns alike) plus its
  // comment thread (count + newest body; the state chip is the row's own).
  const window = sessionWindowOf(task, sessionId)
  return (
    <SessionRow
      chip={chip}
      leading={
        <span className={css.sessionRowLeading}>
          <Icon name="link" className={css.sessionRowIcon} />
          <span className={css.sessionRowName} title={row.title}>{row.title}</span>
          {row.workspaceLabel !== undefined && row.workspaceLabel !== row.title && (
            <span className={css.sessionRowWorkspace}>{row.workspaceLabel}</span>
          )}
        </span>
      }
      meta={
        window.startedAt !== undefined ? (
          <>
            {t('detail.executionStarted')} {formatDateTime(window.startedAt)}
            {' · '}
            {t('detail.executionEnded')} {window.endedAt !== undefined ? formatDateTime(window.endedAt) : '—'}
            {window.duration !== undefined && (
              <> · {t('detail.duration', { d: formatDuration(window.duration) })}</>
            )}
          </>
        ) : (
          <>
            {t('detail.sessionUpdated')} {formatDateTime(row.updatedAt)}
          </>
        )
      }
      footer={
        <CommentSummary task={task} sessionId={sessionId} cruiseOn={cruiseOn} />
      }
      sessionId={sessionId}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onRename={async title => {
        const result = await controller.renameTaskSession(task.id, sessionId, title)
        if (!result.ok) throw new Error(result.error)
      }}
      renameTitle={t('detail.renameSessionTitle')}
      onActivate={() => { onOpenSessionPanel(sessionId) }}
      onOpenSession={() => { controller.openSession(sessionId) }}
      onHide={() => { controller.hideTaskSession(task.id, sessionId) }}
      hideTitle={t('detail.hideRow')}
    />
  )
}

/** The automation module (task-level orchestration): one collapsed line = the
 *  live state; the expanded body is the SHARED AutomationEditor — the same
 *  full editor the board's 自动化 overview task cards render, so the
 *  task-level schedule (按时间表 / 完成后接续) and the session rules have
 *  exactly ONE UI and the board CAN edit everything the detail can. */
function AutomationSection({ controller, task }: { controller: BoardController; task: TaskRecord }) {
  const schedule = task.schedule
  const readiness = ruleReadiness(task)
  // A paused rule names its blocking status; a review pause caused by a
  // failed run adds the "because it failed" reason word; a BLOCKED rule (an
  // empty execution prompt) names the emptiness — one reason-line grammar
  // (the one summary grammar is scheduleSummary; the detail only adds this
  // word on top).
  const stoppedReason = readiness.kind === 'paused'
    ? {
        extraFailed: readiness.status === 'review'
          && latestExecutionOf(task)?.result === 'failed',
        key: PAUSED_REASON_KEY[readiness.status],
      }
    : readiness.kind === 'blocked'
      ? { extraFailed: false, key: 'detail.schedule.blocked' as TaskBoardKey }
      : undefined

  // Collapsed by default UNLESS the rule is already enabled: an armed
  // automation opens expanded, so its live state is immediately visible —
  // "按过启用后，下次打开必自动展开" (the user asked for exactly this).
  const [open, setOpen] = useState(() => schedule?.enabled === true)
  useEffect(() => {
    if (schedule?.enabled === true) setOpen(true)
  }, [task.id, schedule?.enabled])
  // THE one summary grammar (shared with the overview and the card tooltip).
  const summary = scheduleSummary(task, stoppedReason?.extraFailed === true)

  return (
    <Disclosure
      title={t('detail.schedule')}
      summary={summary}
      open={open}
      onToggle={() => { setOpen(!open) }}
    >
      <AutomationEditor controller={controller} task={task} />
    </Disclosure>
  )
}

/** Task detail overlay. */
export function TaskDetail({ controller, task, workspaceTitleOf, dragSourceRef }: {
  controller: BoardController
  task: TaskRecord
  /** Resolve a workspace id to its display title (raw id when unknown). */
  workspaceTitleOf: (workspaceId: string) => string
  /** The board's card-drag latch (set synchronously at card dragstart), so the
   *  session-area drop zone can tell a sidebar drag from the board's own card
   *  drags (both advertise `text/plain`). */
  dragSourceRef: { readonly current: boolean }
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Red-flag per-session removal (hidden-tray only): the session's rounds
  // and hide history are permanently removed after confirmation.
  const [confirmRemoveSession, setConfirmRemoveSession] = useState<string | undefined>(undefined)
  // Edit-mode draft; undefined = not editing. Kept separate from `current`
  // so live record updates (e.g. an execution settling) never clobber it.
  const [draft, setDraft] = useState<TaskDraft | undefined>(undefined)
  const [editError, setEditError] = useState<string | undefined>(undefined)
  // True while the current edit was restored from the persisted draft store:
  // the user switched away mid-edit and came back to their own text — a quiet
  // inline note says so instead of silently surprising them.
  const [draftRestored, setDraftRestored] = useState(false)
  // Whether the run-config disclosure is expanded (collapsed by default: the
  // detail stays quiet, one summary line "默认设置 / 已自定义 N 项" is enough).
  const [configOpen, setConfigOpen] = useState(false)
  // The execution row whose review page is open (undefined = none).
  const [reviewExecution, setReviewExecution] = useState<ExecutionRecord | undefined>(undefined)
  // The linked session whose detail panel is open (undefined = none).
  const [linkedSession, setLinkedSession] = useState<string | undefined>(undefined)
  // The 新建会话 dialog (undefined = closed).
  const [showNewSession, setShowNewSession] = useState(false)
  const [showAddSession, setShowAddSession] = useState(false)

  // The record IS the prop: the parent re-renders with every ledger change
  // (the selected snapshot is a fresh record), so a prop-to-state mirror
  // would only render a stale frame and then re-render for nothing.
  const current = task
  // The ONE session scoping every composer's official '@' reference menu on
  // this surface: the task's own first related session (deterministic).
  const referenceSession = controller.referenceSessionOf(current.id)

  // Unsaved-edit draft memory: switching to a task restores its stored draft
  // (auto-entering edit mode), so half-typed edits survive switching away and
  // coming back. Saved or explicitly discarded drafts are cleared, so only
  // truly unfinished text returns.
  useEffect(() => {
    setDraft(undefined)
    setEditError(undefined)
    setDraftRestored(false)
    const stored = draftStore.get(editDraftKey(task.id))
    if (stored !== undefined) {
      try {
        setDraft(JSON.parse(stored) as TaskDraft)
        setDraftRestored(true)
      } catch {
        draftStore.clear(editDraftKey(task.id))
      }
    }
  }, [task.id])

  // A card is busy while its latest run is still open AND the task is
  // running (hasOpenRun): a scheduled batch keeps the card 'running'
  // between runs, so `running` alone must not disable the button; a pending
  // comment round (task not running) must never disable it either.
  const busy = hasOpenRun(current)

  // Run-config summary for the collapsed disclosure (单来源:重算于每次渲染).
  const customizedCount = [
    current.workspaceId, current.agentPreset, current.provider, current.model,
    current.reasoningEffort, current.permission,
  ].filter(value => value !== undefined && value !== '').length
  const configSummary = customizedCount === 0
    ? t('detail.runConfigDefault')
    : t('detail.runConfigCustom', { n: String(customizedCount) })

  // The unified session list (run + linked, de-duplicated by session id):
  // the single source for the 会话 section — a session reached from an
  // execution page or a linked panel is one row here, one comment thread.
  const sessions = controller.sessionsOf(current)
  // The hidden sessions (unified set), for the per-session restore tray.
  const hiddenIds = hiddenSessionIdsOf(current)

  // Session-area bind drop zone: dragging a sidebar session/workspace onto
  // the open task's 会话 area binds (or rebinds) the task's live source —
  // complement of the board-level "drop onto a column = new bound card".
  // Latched on dragenter like the board root: dragover cannot read the
  // payload (protected store), and the board's own card drags (also
  // `text/plain`) are excluded via the shared dragSourceRef.
  const [bindDropActive, setBindDropActive] = useState(false)
  const bindDropLatch = useRef(false)
  // One-shot confirm flash after a successful bind drop.
  const [bindDropFlash, setBindDropFlash] = useState(false)
  const bindDropTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Window-level safety net (same contract as the board root): a drag ending
  // outside the zone — on the sidebar, outside the window, or cancelled —
  // must clear the latch so no ring can survive the gesture. Also resets the
  // manual session-reorder transient state (a dropped/cancelled reorder).
  useEffect(() => {
    const clear = (): void => {
      bindDropLatch.current = false
      setBindDropActive(false)
      clearSessionDrag()
    }
    window.addEventListener('drop', clear)
    window.addEventListener('dragend', clear)
    return () => {
      window.removeEventListener('drop', clear)
      window.removeEventListener('dragend', clear)
      if (bindDropTimer.current !== undefined) clearTimeout(bindDropTimer.current)
    }
    // The handlers read only stable refs/setters; a mount-time instance works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- 会话列表手动排序（拖拽） ----------------------------------------------
  // Drag a session row onto another position: the SAME insertion-gap grammar
  // as the board's card reorder (insertionGapOf / indicatorTopOf — one pure
  // drop-position module, never a second hand-rolled measurement). The gap is
  // mirrored in a ref (written synchronously on dragover, read at drop) so
  // the drop always matches the preview. The settled order persists through
  // controller.reorderTaskSession; sessions arriving later stay on top.
  const [sessionDragId, setSessionDragId] = useState<string | undefined>(undefined)
  const [sessionGap, setSessionGap] = useState<{ beforeId: string | undefined; top: number } | undefined>(undefined)
  const sessionGapRef = useRef<{ beforeId: string | undefined; top: number } | undefined>(undefined)
  const sessionListRef = useRef<HTMLUListElement | null>(null)
  const sessionIndicatorRef = useRef<HTMLSpanElement | null>(null)
  const clearSessionDrag = (): void => {
    setSessionDragId(undefined)
    setSessionGap(undefined)
    sessionGapRef.current = undefined
  }
  /** The exact insertion slot of a session-row drag at `dropY` (content coords). */
  const sessionGapAt = (dropY: number): { beforeId: string | undefined; top: number } => {
    const container = sessionListRef.current
    if (container === null || sessionDragId === undefined) return { beforeId: undefined, top: 0 }
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-session-id]'))
      .map(element => ({
        id: element.getAttribute('data-session-id') ?? '',
        rect: element.getBoundingClientRect(),
      }))
    const gap = insertionGapOf(cards, dropY, sessionDragId, 8)
    const containerTop = container.getBoundingClientRect().top
    return { beforeId: gap.beforeId, top: indicatorTopOf(gap.top, containerTop, container.scrollTop, container.scrollHeight) }
  }
  /** Apply a session insertion gap to the UI — THE one gap-write path
   *  (dragover and the auto-scroll frame share it). */
  const applySessionGap = useCallback((dropY: number): void => {
    const gap = sessionGapAt(dropY)
    sessionGapRef.current = gap
    const indicator = sessionIndicatorRef.current
    if (indicator !== null) indicator.style.top = `${gap.top}px`
    setSessionGap(current =>
      current !== undefined && current.beforeId === gap.beforeId ? current : gap)
  }, [sessionGapAt])

  // Drag edge auto-scroll: while a session row is dragged, the detail body
  // (the REAL scroll container of the modal) scrolls itself near its
  // top/bottom edge — one gesture to the far ends of a long session list.
  const detailBodyRef = useRef<HTMLDivElement | null>(null)
  const detailBodyRoot = useCallback(() => detailBodyRef.current, [])
  useDragAutoScroll(detailBodyRoot, sessionDragId !== undefined, applySessionGap)

  /** Latch an external sidebar drag once, on entry into the zone. */
  const onZoneDragEnter = (event: React.DragEvent): void => {
    if (!dragSourceRef.current && candidateExternalDrag(Array.from(event.dataTransfer.types))) {
      bindDropLatch.current = true
      setBindDropActive(true)
    }
  }

  /** Allow the drop only for a latched external drag. */
  const onZoneDragOver = (event: React.DragEvent): void => {
    if (bindDropLatch.current) event.preventDefault()
  }

  /** A sidebar session/workspace dropped on the zone ADDS the live source to
   *  this task (an already-bound source is an idempotent no-op — never a
   *  replace); board card drags resolve to undefined and are left untouched.
   *  Every drop ends by clearing the latch. */
  const onZoneDrop = (event: React.DragEvent): void => {
    bindDropLatch.current = false
    setBindDropActive(false)
    const external = externalDragOf(
      event.dataTransfer,
      id => controller.getSnapshot().tasks.some(task => task.id === id),
      id => controller.externalKindOf(id),
    )
    if (external === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const bind = external.kind === 'session'
      ? { kind: 'session' as const, sessionId: external.id }
      : { kind: 'workspace' as const, workspaceId: external.id }
    controller.addTaskSource(current.id, bind)
    setBindDropFlash(true)
    if (bindDropTimer.current !== undefined) clearTimeout(bindDropTimer.current)
    bindDropTimer.current = setTimeout(() => { setBindDropFlash(false) }, 600)
  }

  // Copy-prompt inline feedback (近处反馈，位于滚动区内): success flashes the
  // check, a real failure says so — never a silent swallow.
  const [promptCopied, setPromptCopied] = useState(false)
  const [promptCopyFailed, setPromptCopyFailed] = useState(false)
  const promptCopyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (promptCopyTimer.current !== undefined) clearTimeout(promptCopyTimer.current) }, [])

  const editing = draft !== undefined

  /** Enter edit mode with a draft of the current record. */
  const startEditing = (): void => {
    setDraft(draftFromTask(current))
    setEditError(undefined)
    setDraftRestored(false)
  }

  /** New-task copy of this task ("复制为模板"): fresh card, same content, run
   *  config AND automation rule, landing in 待规划; runs/links are not
   *  copied (controller.copyTask). */
  const duplicateTask = (): void => {
    const copy = controller.copyTask(current.id)
    if (copy !== undefined) controller.closeTask()
  }

  /** Copy the execution prompt to the clipboard (best-effort; no throw). */
  const copyPrompt = (): void => {
    if (current.prompt === '') return
    const flash = (state: 'ok' | 'failed'): void => {
      setPromptCopied(state === 'ok')
      setPromptCopyFailed(state === 'failed')
      if (promptCopyTimer.current !== undefined) clearTimeout(promptCopyTimer.current)
      promptCopyTimer.current = setTimeout(() => {
        setPromptCopied(false)
        setPromptCopyFailed(false)
      }, 1500)
    }
    void navigator.clipboard?.writeText(current.prompt).then(
      () => { flash('ok') },
      () => { flash('failed') },
    )
  }

  /** Persist the draft; title may be blank (the first real run supplements
   *  it) — updateTask only rejects an unknown task. */
  const saveEdit = (): void => {
    if (draft === undefined) return
    if (!controller.updateTask(current.id, draftToUpdatePatch(draft))) return
    setDraft(undefined)
    setEditError(undefined)
    setDraftRestored(false)
    draftStore.clear(editDraftKey(current.id))
  }

  /** Discard the draft and leave edit mode (explicit discard clears too). */
  const cancelEdit = (): void => {
    setDraft(undefined)
    setEditError(undefined)
    setDraftRestored(false)
    draftStore.clear(editDraftKey(current.id))
  }

  return (
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) controller.closeTask() }}>
      <div className={css.detail} role="dialog" aria-label={t('detail.title')}>
        <header className={css.detailHeader}>
          <h2 className={css.detailTitle}>{current.title}</h2>
          <Chip kind={STATUS_CHIP[current.status]}>{t(STATUS_KEY[current.status])}</Chip>
          {!editing && (
            <Button onClick={startEditing}>
              {t('detail.edit')}
            </Button>
          )}
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('detail.close')}
            onClick={() => { controller.closeTask() }}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className={css.detailBody} ref={detailBodyRef}>
          {editing && draft !== undefined ? (
            <>
              <TaskForm
                draft={draft}
                onChange={next => {
                  setDraft(next)
                  // Draft memory: every keystroke is written through so
                  // switching away keeps the half-typed edit.
                  draftStore.set(editDraftKey(current.id), JSON.stringify(next))
                }}
                controller={controller}
                sessionId={referenceSession}
              />
              {editError !== undefined && <p className={css.formError}>{editError}</p>}
              {draftRestored && <p className={css.detailHint}>{t('detail.editDraftRestored')}</p>}
            </>
          ) : (
            <>
              <Section title={t('detail.description')}>
                <div className={css.contentBlock}>{current.description !== '' ? current.description : '—'}</div>
              </Section>

              <Section title={t('detail.prompt')}>
                {/* An empty run prompt is nothing — the same em dash as the
                    description. It never shows the title as if it were a
                    prompt (the title only serves as the execution fallback).
                    The copy action floats INSIDE the block's top-right
                    corner (hover/focus revealed, check-mark feedback), so it
                    reads as part of the block instead of a loose row below. */}
                <div className={css.promptBlock}>
                  <pre className={css.promptBlockText}>{current.prompt !== '' ? current.prompt : '—'}</pre>
                  {current.prompt !== '' && (
                    <button
                      type="button"
                      className={css.promptCopy}
                      title={promptCopied ? t('detail.copied') : promptCopyFailed ? t('detail.copyFailed') : t('detail.copyPrompt')}
                      aria-label={t('detail.copyPrompt')}
                      onClick={copyPrompt}
                    >
                      <Icon name={promptCopied ? 'check' : 'copy'} />
                    </button>
                  )}
                </div>
              </Section>

              <Disclosure
                title={t('detail.runConfig')}
                summary={configSummary}
                open={configOpen}
                onToggle={() => { setConfigOpen(!configOpen) }}
              >
                {/* The five rows always render: an unset field means "use the
                    deployment default", shown as 默认 — a dragged-in or fresh
                    card reads complete instead of silently missing rows. */}
                <dl className={css.configGrid}>
                  <div className={css.configRow}>
                    <dt className={css.configLabel}>{t('new.workspace')}</dt>
                    <dd className={css.configValue}>
                      {current.workspaceId !== undefined
                        ? workspaceTitleOf(current.workspaceId)
                        : t('new.workspaceDefault')}
                    </dd>
                  </div>
                  <div className={css.configRow}>
                    <dt className={css.configLabel}>{t('new.agentPreset')}</dt>
                    <dd className={css.configValue}>
                      {current.agentPreset !== undefined ? current.agentPreset : t('new.agentPresetDefault')}
                    </dd>
                  </div>
                  <div className={css.configRow}>
                    <dt className={css.configLabel}>{t('new.model')}</dt>
                    <dd className={css.configValue}>
                      {current.provider !== undefined && current.model !== undefined
                        ? `${current.provider} / ${current.model}`
                        : t('new.modelDefault')}
                    </dd>
                  </div>
                  <div className={css.configRow}>
                    <dt className={css.configLabel}>{t('new.effort')}</dt>
                    <dd className={css.configValue}>
                      {current.reasoningEffort !== undefined ? current.reasoningEffort : t('new.effortDefault')}
                    </dd>
                  </div>
                  <div className={css.configRow}>
                    <dt className={css.configLabel}>{t('new.permission')}</dt>
                    <dd className={css.configValue}>
                      {current.permission !== undefined ? permissionLabel(current.permission) : t('new.permissionDefault')}
                    </dd>
                  </div>
                </dl>
              </Disclosure>
            </>
          )}

          <AutomationSection controller={controller} task={current} />

          {/* 会话：任务的全部真实会话（板内执行 + 链接外部）按 sessionId 去重后
              显示在一个列表里——同一会话绝不出现两次，从执行页或链接面板进入
              同一会话看到的是同一条评论线程。行文法统一（SessionRow）。
              本区同时是绑定落点：把侧栏的会话/工作区拖进来 = 绑定为新增来源
              （多源可叠加、同源幂等，绝不刷新替代；与「拖到列上 = 新建绑定卡」互补）。
              「新建会话」住在列表正上方的动作行（与列表首个内容同宽对齐，
              不悬在区块标题旁），空列表也常驻——空任务从此有明确入口。 */}
          <Section title={`${t('detail.sessions')} ${sessions.length}`}>
            <div
              className={css.sessionDropZone}
              data-bindactive={bindDropActive ? '' : undefined}
              data-flash={bindDropFlash ? '' : undefined}
              onDragEnter={onZoneDragEnter}
              onDragOver={onZoneDragOver}
              onDrop={onZoneDrop}
            >
              <div className={css.sessionToolbar}>
                <p className={css.detailHint}>{t('detail.executionHint')}</p>
                <span className={css.sessionToolbarActions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('detail.addSessionTitle')}
                    onClick={() => { setShowAddSession(true) }}
                  >
                    {t('detail.addSession')}
                  </Button>
                  <Button
                    size="sm"
                    title={t('detail.sessionNewTitle')}
                    onClick={() => { setShowNewSession(true) }}
                  >
                    + {t('detail.sessionNew')}
                  </Button>
                </span>
              </div>
              {sessions.length === 0 ? (
                <p className={css.detailText}>
                  {plainRunsOf(current).length > 0
                    ? t('detail.executionHiddenAll')
                    : taskBindsOf(current).length > 0
                      ? t('detail.noExecutionLinked')
                      : t('detail.noExecution')}
                </p>
              ) : (
                <ul
                  className={css.sessionList}
                  ref={sessionListRef}
                  data-reordering={sessionDragId !== undefined ? '' : undefined}
                  onDragOver={event => {
                    // A session-row reorder: compute the exact insertion slot
                    // from pointer coordinates (the same gap grammar as the
                    // board), mirror it in the ref (applySessionGap is the
                    // one gap-write path, shared with the auto-scroll frame).
                    if (sessionDragId === undefined) return
                    event.preventDefault()
                    applySessionGap(event.clientY)
                  }}
                  onDrop={event => {
                    if (sessionDragId === undefined) return
                    event.preventDefault()
                    // Read the decision BEFORE clearing (same contract as the
                    // board): the ref holds the slot the preview promised.
                    const gap = sessionGapRef.current
                    const dragged = sessionDragId
                    clearSessionDrag()
                    controller.reorderTaskSession(current.id, dragged, gap?.beforeId)
                  }}
                >
                  {sessionGap !== undefined && (
                    <span
                      ref={sessionIndicatorRef}
                      className={css.dropIndicator}
                      style={{ top: sessionGap.top }}
                      aria-hidden="true"
                    />
                  )}
                  {sessions.map(row => (
                    <SessionActionRow
                      key={row.sessionId}
                      row={row}
                      task={current}
                      controller={controller}
                      cruiseOn={controller.getSnapshot().cruise.enabled}
                      workspaceTitleOf={workspaceTitleOf}
                      onReviewExecution={execution => { setReviewExecution(execution) }}
                      onOpenSessionPanel={sessionId => { setLinkedSession(sessionId) }}
                      draggable
                      onDragStart={event => {
                        setSessionDragId(row.sessionId)
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', row.sessionId)
                      }}
                      onDragEnd={clearSessionDrag}
                    />
                  ))}
                </ul>
              )}
              {/* 隐藏托盘：逐条恢复（不逼用户一次全恢复），头部一条「恢复全部」。
                  行名取原生会话标题，会话已消失时回退到 sessionId。 */}
              {hiddenIds.size > 0 && (
                <div className={css.hiddenTray}>
                  <div className={css.hiddenTrayHead}>
                    <span className={css.hiddenTrayTitle}>
                      {t('detail.hiddenTrayTitle', { n: String(hiddenIds.size) })}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => { controller.unhideTaskSessions(current.id) }}>
                      {t('detail.restoreHidden')}
                    </Button>
                  </div>
                  <ul className={css.hiddenTrayList}>
                    {Array.from(hiddenIds).map(sessionId => (
                      <li key={sessionId} className={css.hiddenTrayRow}>
                        <span className={css.hiddenTrayName} title={sessionId}>
                          {controller.sessionTitle(sessionId) ?? sessionId}
                        </span>
                        {/* ONE right-clustered action group: restore (ghost) ‖
                            delete (row-level danger ghost — the filled danger
                            stays with the confirm dialog itself). The name
                            flexes, the pair never scatters. */}
                        <span className={css.hiddenTrayActions}>
                          <Button size="sm" variant="ghost" onClick={() => { controller.unhideTaskSession(current.id, sessionId) }}>
                            {t('detail.restoreOne')}
                          </Button>
                          <Button size="sm" variant="dangerGhost" onClick={() => { setConfirmRemoveSession(sessionId) }}>
                            {t('detail.delete')}
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Section>

          {current.status === 'backlog' && (
            <RefineSection controller={controller} task={current} />
          )}

          <Section title={t('board.status')}>
            <div className={css.moveRow}>
              {MANUAL_STATUSES.map(status => (
                <Button
                  key={status}
                  disabled={current.status === status || busy}
                  onClick={() => { controller.moveTask(current.id, status) }}
                >
                  {t(`status.move.${status}` as TaskBoardKey)}
                </Button>
              ))}
            </div>
          </Section>
        </div>

        <footer className={css.detailFooter}>
          {/* Primary group: the run action (save/cancel while editing). */}
          <span className={css.detailFooterGroup}>
            {editing ? (
              <>
                <Button variant="primary" onClick={saveEdit}>
                  {t('detail.save')}
                </Button>
                <Button onClick={cancelEdit}>
                  {t('detail.cancel')}
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                /* An empty execution prompt is a hard gate: NOTHING may run
                   (manual/quick/re-run/automation/cruise/comments). The button
                   reads the gate + the hint line names the reason. */
                disabled={busy || !taskExecutable(current)}
                title={taskExecutable(current) ? t('detail.rerunHint') : t('detail.promptEmpty')}
                onClick={() => {
                  // Running kicks off a real agent session; close the detail so
                  // the whole board stays visible while the task executes.
                  if (!taskExecutable(current)) return
                  controller.closeTask()
                  void controller.rerunTask(current.id)
                }}
              >
                {current.executions.length === 0 ? t('detail.run') : t('detail.rerun')}
              </Button>
            )}
            <Button title={t('detail.duplicateTitle')} onClick={duplicateTask}>
              {t('detail.duplicate')}
            </Button>
          </span>
          {/* Danger group: destructive actions sit apart (hairline separation),
              so the footer reads 主操作 → 复制 → ‖ 删除 → created. */}
          <span className={css.detailFooterDanger}>
            <Button variant="danger" onClick={() => { setConfirmDelete(true) }}>
              {t('detail.delete')}
            </Button>
          </span>
          <span className={css.detailMeta}>
            {t('board.created')} {formatTime(current.createdAt)}
          </span>
        </footer>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('delete.title')}
          message={t('delete.confirm', { name: current.title })}
          confirmLabel={t('delete.ok')}
          danger
          onCancel={() => { setConfirmDelete(false) }}
          onConfirm={() => {
            setConfirmDelete(false)
            controller.deleteTask(current.id)
            controller.closeTask()
          }}
        />
      )}
      {confirmRemoveSession !== undefined && (
        <ConfirmDialog
          title={t('detail.sessionRemoveTitle', { name: controller.sessionTitle(confirmRemoveSession) ?? confirmRemoveSession })}
          message={t('detail.sessionRemoveConfirm')}
          confirmLabel={t('detail.sessionRemoveOk')}
          danger
          onCancel={() => { setConfirmRemoveSession(undefined) }}
          onConfirm={() => {
            controller.removeTaskSession(current.id, confirmRemoveSession)
            setConfirmRemoveSession(undefined)
          }}
        />
      )}
      {reviewExecution !== undefined && (
        <ReviewDetail
          controller={controller}
          task={current}
          execution={reviewExecution}
          onClose={() => { setReviewExecution(undefined) }}
        />
      )}
      {linkedSession !== undefined && (
        <SessionDetail
          controller={controller}
          task={current}
          sessionId={linkedSession}
          onClose={() => { setLinkedSession(undefined) }}
        />
      )}
      {showNewSession && (
        <NewSessionModal
          controller={controller}
          task={current}
          onClose={() => { setShowNewSession(false) }}
          onCreated={() => {
            // The same confirm flash a sidebar bind drop plays: the new row
            // is visible at the top of the list, the section says so once.
            setBindDropFlash(true)
            if (bindDropTimer.current !== undefined) clearTimeout(bindDropTimer.current)
            bindDropTimer.current = setTimeout(() => { setBindDropFlash(false) }, 600)
          }}
        />
      )}
      {showAddSession && (
        <AddSessionModal
          controller={controller}
          task={current}
          onClose={() => { setShowAddSession(false) }}
        />
      )}
    </div>
  )
}