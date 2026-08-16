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
import { COLUMNS, resolveCardDrop, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { insertionAnchorOf } from './drop-position.ts'
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
  // Same-column reorder: the id of the card being dragged and the insertion
  // anchor (undefined = column tail). The anchor is mirrored in a ref —
  // dragover fires at high frequency, and the drop must read the exact
  // value the last dragover computed, never a stale render closure.
  const [dragId, setDragId] = useState<string | undefined>(undefined)
  const [dropBefore, setDropBefore] = useState<string | undefined>(undefined)
  const dropBeforeRef = useRef<string | undefined>(undefined)
  // The .cards container per column (for half-split rect measurements).
  const cardsRefs = useRef<Partial<Record<TaskStatus, HTMLDivElement | null>>>({})
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
    setDropBefore(undefined)
    dropBeforeRef.current = undefined
    setDragOver(undefined)
  }

  /** Id of the card element under the pointer, when the pointer is on one. */
  const cardIdAt = (event: React.DragEvent): string | undefined =>
    (event.target as HTMLElement).closest('[data-task-id]')?.getAttribute('data-task-id') ?? undefined

  /** The half-split insertion anchor of a drag at `dropY` inside a column. */
  const anchorAt = (status: TaskStatus, dropY: number): { beforeId: string | undefined } => {
    const container = cardsRefs.current[status]
    if (container == null || dragId === undefined) return { beforeId: undefined }
    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-task-id]'))
      .map(element => ({
        id: element.getAttribute('data-task-id') ?? '',
        rect: element.getBoundingClientRect(),
      }))
    return insertionAnchorOf(cards, dropY, dragId)
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

  /**
   * Column-level drop: same-column drops reorder (the half-split anchor the
   * last dragover computed); cross-column drops keep the classic
   * move/rerun/reject semantics.
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
      controller.moveTask(task.id, status, dropBeforeRef.current)
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
        {/* Auto-cruise: batch-run every todo task, at most `limit` at once. */}
        <div className={css.cruise}>
          <label className={css.cruiseToggle}>
            <input
              type="checkbox"
              checked={snapshot.cruise.enabled}
              onChange={event => { controller.setCruiseEnabled(event.target.checked) }}
            />
            <span>{t('board.cruise')}</span>
          </label>
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
              data-drop-tail={sameColumnDrag && dropBefore === undefined ? '' : undefined}
              onDragOver={event => {
                event.preventDefault()
                if (!sameColumnDrag) {
                  // Foreign or cross-column drag: plain column highlight.
                  if (dropBeforeRef.current !== undefined) {
                    dropBeforeRef.current = undefined
                    setDropBefore(undefined)
                  }
                  setDragOver(column.status)
                  return
                }
                // Same-column reorder: anchor on the half-split point only —
                // the card indicator is the whole feedback, no column border.
                setDragOver(undefined)
                const anchor = anchorAt(column.status, event.clientY)
                if (anchor.beforeId !== dropBeforeRef.current) {
                  dropBeforeRef.current = anchor.beforeId
                  setDropBefore(anchor.beforeId)
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
                    setDragId(id)
                    setDropBefore(undefined)
                    dropBeforeRef.current = undefined
                  }
                }}
                onDragEnd={clearDrag}
              >
                {tasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    workspaceTitleOf={workspaceTitleOf}
                    dropBefore={dropBefore === task.id}
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
