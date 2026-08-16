/**
 * Board view: the multi-column kanban that replaces the middle column while
 * active. Cards open the task detail (never execute directly); the header
 * offers filter, new-task, and a back-to-chat escape.
 */
import { useEffect, useRef, useState } from 'react'
import { selectedTaskOf, type BoardController } from '../../core/controller.ts'
import { COLUMNS, resolveCardDrop, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { NewTaskModal } from './NewTaskModal.tsx'
import { STATUS_KEY } from './status.ts'
import { TaskCard } from './TaskCard.tsx'
import { TaskDetail } from './TaskDetail.tsx'

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
  // Same-column reorder: the id of the card being dragged and the card its
  // drop would insert before (undefined = column tail). Cross-column drags
  // keep the existing column-drop semantics (move / rerun / reject).
  const [dragId, setDragId] = useState<string | undefined>(undefined)
  const [dropBeforeId, setDropBeforeId] = useState<string | undefined>(undefined)
  // Guards the reject-flash timer against unmount (drop feedback only).
  const rejectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    if (rejectTimer.current !== undefined) clearTimeout(rejectTimer.current)
  }, [])
  const selected = selectedTaskOf(snapshot)
  const visible = snapshot.tasks.filter(task => matchesFilter(task, filter))
  const draggedTask = dragId !== undefined
    ? snapshot.tasks.find(candidate => candidate.id === dragId)
    : undefined

  /** Reset the drag-and-drop tracking after a drop or drag end. */
  const clearDrag = (): void => {
    setDragId(undefined)
    setDropBeforeId(undefined)
    setDragOver(undefined)
  }

  /** Id of the card element under the pointer, when the pointer is on one. */
  const cardIdAt = (event: React.DragEvent): string | undefined =>
    (event.target as HTMLElement).closest('[data-task-id]')?.getAttribute('data-task-id') ?? undefined

  // Resolve a workspace id to its display title through the run catalog
  // (live workspace list; falls back to the raw id when the workspace no
  // longer exists or no catalog is wired).
  const workspaceTitleOf = (workspaceId: string): string => {
    const row = controller.runCatalog()
      ?.listWorkspaces()
      .find(candidate => candidate.id === workspaceId)
    return row?.title ?? workspaceId
  }

  /**
   * Column-level drop: cross-column drops keep the classic move/rerun/reject
   * semantics; a same-column drop lands on the column background (below the
   * last card) and means "insert at the tail", honoring the last hovered
   * card as the insertion anchor when the drop happens right after one.
   */
  const handleDrop = (status: TaskStatus) => (event: React.DragEvent): void => {
    event.preventDefault()
    const id = dragId ?? event.dataTransfer.getData('text/plain')
    const task = snapshot.tasks.find(candidate => candidate.id === id)
    if (task === undefined) {
      clearDrag()
      return
    }
    if (dragId !== undefined && task.status === status) {
      controller.moveTask(task.id, status, dropBeforeId)
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
    <div className={css.board} data-dsh-taskboard-board="">
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
        <button
          type="button"
          className={css.primaryButton}
          onClick={() => { setShowNew(true) }}
        >
          + {t('board.new')}
        </button>
        <button
          type="button"
          className={`${css.ghostButton} ${css.boardClose}`}
          onClick={() => { controller.closeBoard() }}
        >
          {t('board.close')}
        </button>
      </header>

      <div className={css.columns}>
        {COLUMNS.map(column => {
          const tasks = visible.filter(task => task.status === column.status)
          return (
            <section
              key={column.status}
              className={css.column}
              data-status={column.status}
              data-dragover={dragOver === column.status ? '' : undefined}
              data-dragreject={dragReject === column.status ? '' : undefined}
              onDragOver={event => {
                // Same-column drags anchor on cards (handled inside .cards);
                // the column background means "insert at the tail". Cross
                // column and foreign drags keep the plain column highlight.
                if (dragId !== undefined && draggedTask?.status === column.status) {
                  event.preventDefault()
                  setDragOver(column.status)
                  setDropBeforeId(undefined)
                  return
                }
                event.preventDefault()
                setDragOver(column.status)
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
                  drag source (dragstart/dragend) and turns same-column card
                  hovers into insertion anchors. Card drops are consumed here;
                  anything else falls through to the column (cross-column
                  move/rerun/reject). */}
              <div
                className={css.cards}
                onDragStart={event => {
                  const id = cardIdAt(event)
                  if (id !== undefined) {
                    setDragId(id)
                    setDropBeforeId(undefined)
                  }
                }}
                onDragEnd={clearDrag}
                onDragOver={event => {
                  if (dragId === undefined) return
                  const dragged = draggedTask
                  if (dragged === undefined || dragged.status !== column.status) return
                  const id = cardIdAt(event)
                  if (id === undefined || id === dragId) return
                  event.preventDefault()
                  event.stopPropagation()
                  setDragOver(column.status)
                  setDropBeforeId(id)
                }}
                onDrop={event => {
                  if (dragId === undefined) return
                  const dragged = draggedTask
                  if (dragged === undefined || dragged.status !== column.status) return
                  // Same-column drop: consumed here (insert before the
                  // hovered card; dropping on the dragged card itself is a
                  // no-op, dropping between cards keeps the last anchor).
                  event.preventDefault()
                  event.stopPropagation()
                  const id = cardIdAt(event)
                  if (id !== undefined && id !== dragId) {
                    controller.moveTask(dragId, dragged.status, id)
                  }
                  clearDrag()
                }}
              >
                {tasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    workspaceTitleOf={workspaceTitleOf}
                    dropBefore={dropBeforeId === task.id}
                    onClick={() => { controller.openTask(task.id) }}
                  />
                ))}
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
