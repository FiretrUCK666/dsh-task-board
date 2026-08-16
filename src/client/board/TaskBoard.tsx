/**
 * Board view: the multi-column kanban that replaces the middle column while
 * active. Cards open the task detail (never execute directly); the header
 * offers filter, new-task, and a back-to-chat escape.
 */
import { useEffect, useRef, useState } from 'react'
import { selectedTaskOf, type BoardController } from '../../core/controller.ts'
import { COLUMNS, resolveCardDrop, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
import { t, type TaskBoardKey } from '../locales.ts'
import css from '../board.module.css'
import { NewTaskModal } from './NewTaskModal.tsx'
import { TaskCard } from './TaskCard.tsx'
import { TaskDetail } from './TaskDetail.tsx'

/** Column status → locale key. */
const STATUS_KEY: Record<TaskStatus, TaskBoardKey> = {
  backlog: 'board.status.backlog',
  todo: 'board.status.todo',
  running: 'board.status.running',
  done: 'board.status.done',
  failed: 'board.status.failed',
}

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
  // Guards the reject-flash timer against unmount (drop feedback only).
  const rejectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    if (rejectTimer.current !== undefined) clearTimeout(rejectTimer.current)
  }, [])
  const selected = selectedTaskOf(snapshot)
  const visible = snapshot.tasks.filter(task => matchesFilter(task, filter))

  // Resolve a workspace id to its display title through the run catalog
  // (live workspace list; falls back to the raw id when the workspace no
  // longer exists or no catalog is wired).
  const workspaceTitleOf = (workspaceId: string): string => {
    const row = controller.runCatalog()
      ?.listWorkspaces()
      .find(candidate => candidate.id === workspaceId)
    return row?.title ?? workspaceId
  }

  /** Accept a card drop: move, rerun on 'running', or flash the column on rejection. */
  const handleDrop = (status: TaskStatus) => (event: React.DragEvent): void => {
    event.preventDefault()
    setDragOver(undefined)
    const id = event.dataTransfer.getData('text/plain')
    const task = snapshot.tasks.find(candidate => candidate.id === id)
    if (task === undefined) return
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
              <div className={css.cards}>
                {tasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    workspaceTitleOf={workspaceTitleOf}
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
