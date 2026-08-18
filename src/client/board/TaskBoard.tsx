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
import { COLUMNS, plainRunsOf, resolveCardDrop, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
import { taskPendingCount, taskUnviewed, taskUnviewedCount } from '../../core/session-display.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { insertionGapOf, type InsertionGap } from './drop-position.ts'
import { NewTaskModal } from './NewTaskModal.tsx'
import { STATUS_KEY } from './status.ts'
import { TaskCard } from './TaskCard.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import { Button, Switch } from './ui.tsx'
import { readSidebarDrag, type SidebarDrag } from '../sidebar-drag.ts'

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
  // The column currently accepting an external sidebar drag (session/workspace
  // dragged in from the sidebar): a distinct highlight from the board's own
  // card-reorder affordances.
  const [dropAccept, setDropAccept] = useState<TaskStatus | undefined>(undefined)
  const clearAccept = (): void => setDropAccept(undefined)
  const selected = selectedTaskOf(snapshot)
  const visible = snapshot.tasks.filter(task => matchesFilter(task, filter))
  const draggedTask = dragId !== undefined
    ? snapshot.tasks.find(candidate => candidate.id === dragId)
    : undefined

  /** Reset the drag-and-drop tracking after a drop or drag end. */
  const clearDrag = (): void => {
    setDragId(undefined)
    setDropGap(undefined)
    dropGapRef.current = undefined
    setDragOver(undefined)
  }

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
    const landing: TaskStatus = dropStatus === 'backlog' ? 'backlog' : 'todo'
    controller.createBoundTask(bind, {
      title: controller.boundSourceTitleOf(bind),
      description: '',
      prompt: '',
      status: landing,
    })
  }

  /**
   * Column-level drop: same-column drops reorder (the half-split anchor the
   * last dragover computed); cross-column drops keep the classic
   * move/rerun/reject semantics; an external sidebar drag (session/workspace)
   * creates a bound task in this column.
   */
  const handleDrop = (status: TaskStatus) => (event: React.DragEvent): void => {
    event.preventDefault()
    const external = readSidebarDrag(event.dataTransfer)
    if (external !== undefined) {
      event.stopPropagation()
      clearAccept()
      createFromSidebar(external, status)
      return
    }
    const id = dragId ?? event.dataTransfer.getData('text/plain')
    const task = snapshot.tasks.find(candidate => candidate.id === id)
    if (task === undefined) {
      clearDrag()
      return
    }
    if (dragId !== undefined && task.status === status) {
      controller.moveTask(task.id, status, dropGapRef.current?.beforeId)
      clearDrag()
      return
    }
    const decision = resolveCardDrop(task, status)
    if (decision.kind === 'move') {
      controller.moveTask(task.id, decision.status)
    } else if (decision.kind === 'run') {
      // Dropping on 'running' means "run again" (same semantics as the
      // detail button; the shared run guard rejects a live run).
      void controller.rerunTask(task.id)
    } else if (decision.kind === 'reject') {
      setDragReject(status)
      if (rejectTimer.current !== undefined) clearTimeout(rejectTimer.current)
      rejectTimer.current = setTimeout(() => { setDragReject(undefined) }, 600)
    }
    clearDrag()
  }

  return (
    <div
      className={css.board}
      data-dsh-taskboard-board=""
      onDragOver={event => { if (readSidebarDrag(event.dataTransfer) !== undefined) event.preventDefault() }}
      onDragLeave={() => { clearAccept() }}
      onDrop={event => {
        const external = readSidebarDrag(event.dataTransfer)
        if (external !== undefined) {
          event.preventDefault()
          clearAccept()
          createFromSidebar(external, 'todo')
        }
      }}
    >
      <header className={css.boardHeader}>
        <h2 className={css.boardTitle}>{t('board.title')}</h2>
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
        {/* Auto-cruise: batch-run every todo task, at most `limit` at once. */}
        <div className={css.cruise}>
          <Switch
            checked={snapshot.cruise.enabled}
            onChange={next => { controller.setCruiseEnabled(next) }}
            label={t('board.cruise')}
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
        <Button className={css.boardClose} onClick={() => { controller.closeBoard() }}>
          {t('board.close')}
        </Button>
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
              data-dropaccept={dropAccept === column.status ? 'link' : undefined}
              onDragOver={event => {
                // An external sidebar drag (session/workspace) marks this
                // column as the drop target; the board's own card drags keep
                // the classic reorder/move feedback below.
                if (readSidebarDrag(event.dataTransfer) !== undefined) {
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
                setDropAccept(current => current === column.status ? undefined : current)
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
