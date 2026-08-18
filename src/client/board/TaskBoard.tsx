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
import { NewTaskModal } from './NewTaskModal.tsx'
import { STATUS_KEY } from './status.ts'
import { TaskCard } from './TaskCard.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import { Button, Icon, Switch } from './ui.tsx'
import { candidateExternalDrag, externalDragOf, type SidebarDrag } from '../sidebar-drag.ts'

/** Case-insensitive title/description match. */
function matchesFilter(task: TaskRecord, filter: string): boolean {
  if (filter.trim() === '') return true
  const needle = filter.trim().toLowerCase()
  return task.title.toLowerCase().includes(needle) || task.description.toLowerCase().includes(needle)
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
  const [dragOver, setDragOver] = useState<TaskStatus | undefined>(undefined)
  const [dragReject, setDragReject] = useState<TaskStatus | undefined>(undefined)
  // The column that accepted a drop, for the one-shot accent flash. Own
  // timer lifecycle: the window-level `drop` listener fires right after the
  // column handler and must not erase the flash before its animation plays.
  const [dropFlash, setDropFlash] = useState<TaskStatus | undefined>(undefined)
  // Same-column reorder: the id of the card being dragged and the insertion
  // gap (beforeId = undefined means the column tail; top = the indicator's
  // Y inside the cards container). The gap is mirrored in a ref — dragover
  // fires at high frequency, and the drop must read the exact value the
  // last dragover computed, never a stale render closure.
  const [dragId, setDragId] = useState<string | undefined>(undefined)
  const [dropGap, setDropGap] = useState<InsertionGap | undefined>(undefined)
  const dropGapRef = useRef<InsertionGap | undefined>(undefined)
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
  const visible = snapshot.tasks.filter(task => matchesFilter(task, filter))
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
      controller.moveTask(task.id, status, dropGapRef.current?.beforeId)
      flashColumn(status)
      return
    }
    const decision = resolveCardDrop(task, status)
    if (decision.kind === 'move') {
      controller.moveTask(task.id, decision.status)
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
        {/* Left: title block with a quiet total-count subtitle — the toolbar's
            anchor; the right cluster is one uniform 28px pill rhythm. */}
        <div className={css.boardTitleBlock}>
          <h2 className={css.boardTitle}>{t('board.title')}</h2>
          <span className={css.boardSubtitle}>{t('board.total', { n: String(snapshot.tasks.length) })}</span>
        </div>
        <div className={css.toolbar}>
          <input
            className={css.search}
            type="search"
            placeholder={t('board.search')}
            value={filter}
            onChange={event => { setFilter(event.target.value) }}
            aria-label={t('board.search')}
          />
          <Button
            variant="primary"
            onClick={() => { setShowNew(true) }}
          >
            + {t('board.new')}
          </Button>
          {/* Auto-cruise: batch-run every todo task, at most `limit` at once.
              Board-level scope, stated in the switch's tooltip so it never
              blurs with the per-task automation rules. A transparent inline
              control — no boxed background (see .cruise). */}
          <div className={css.cruise}>
            <Switch
              checked={snapshot.cruise.enabled}
              onChange={next => { controller.setCruiseEnabled(next) }}
              label={t('board.cruise')}
              title={t('board.cruiseTitle')}
            />
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
          </div>
          {/* Back to chat: a quiet pill icon; the board itself is the working
              surface so the exit stays compact and out of the way. */}
          <button
            type="button"
            className={css.boardClose}
            aria-label={t('board.close')}
            title={t('board.close')}
            onClick={() => { controller.closeBoard() }}
          >
            <Icon name="arrowLeft" />
          </button>
        </div>
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
                // keep the classic reorder/move feedback below. The latch is
                // cleared only by a drop / drag end — never here — so
                // crossing the column's children cannot flicker the ring.
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
                if (!sameColumnDrag) {
                  // Foreign or cross-column drag: plain column highlight.
                  if (dropGapRef.current !== undefined) {
                    dropGapRef.current = undefined
                    setDropGap(undefined)
                  }
                  setDragOver(column.status)
                  return
                }
                // Same-column reorder: the nearest gap decides — the
                // indicator bar is the whole feedback, no column border.
                setDragOver(undefined)
                const gap = gapAt(column.status, event.clientY)
                const moved = gap.beforeId !== dropGapRef.current?.beforeId
                  || gap.top !== dropGapRef.current?.top
                if (moved) {
                  dropGapRef.current = gap
                  setDropGap(gap)
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
                {dropGap !== undefined && sameColumnDrag && (
                  <span
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
                      workspaceTitleOf={workspaceTitleOf}
                      waiting={waiting}
                      pendingCount={pending.count}
                      pendingTitle={pendingTitle}
                      unviewed={taskUnviewed(task)}
                      unviewedCount={taskUnviewedCount(task)}
                      onClick={() => { controller.openTask(task.id) }}
                      onQuickRun={() => { void controller.rerunTask(task.id) }}
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
        />
      )}
      {showNew && (
        <NewTaskModal
          controller={controller}
          onClose={() => { setShowNew(false) }}
        />
      )}
    </div>
  )
}
