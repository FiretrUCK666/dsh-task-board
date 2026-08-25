/**
 * AutomationPanel: the board header's "自动化" overview. ONE place to see AND
 * manage BOTH automatic-driving kinds of every ACTIVE automated task — the
 * task-level schedule (cron / 完成后接续) and the session-level rules.
 *
 * Membership = live automation only (`automationTasksOf`: an enabled schedule
 * or at least one session rule — a disarmed rule is not listed as if it were
 * running). EVERY card is one expand row: identity header + a single live
 * summary line (the ONE summary grammar — a task-level schedule renders
 * scheduleSummary, a rules-only task renders its rule count) that expands
 * into the SHARED AutomationEditor verbatim. The enable switch lives ONLY in
 * the editor (one switch, one place, no duplicated affordances), and the
 * board has every capability the detail has (including 完成后接续).
 */
import { useEffect, useState } from 'react'
import { type BoardController } from '../../core/controller.ts'
import { automationTasksOf } from '../../core/automation.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Dialog } from './Dialog.tsx'
import { AutomationEditor, scheduleSummary } from './automation-ui.tsx'
import { Button, Icon } from './ui.tsx'
import { STATUS_KEY } from './status.ts'

/** One automated task in the overview: identity + ONE expand row (live
 *  summary) + the shared full editor when expanded. */
function AutomationTaskCard({ controller, task, onClose }: {
  controller: BoardController
  task: TaskRecord
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const schedule = task.schedule
  // The expand row renders the live task-level summary (the same string the
  // detail's 自动化 disclosure header reads); a rules-only task (no schedule)
  // shows its rule count — never a fake 未启用 for a system that isn't there.
  const summary = schedule !== undefined
    ? scheduleSummary(task)
    : t('auto.ruleCount', { n: String(task.rules?.length ?? 0) })

  return (
    <section className={css.autoTask}>
      <header className={css.autoTaskHead}>
        <span className={css.autoTaskTitle} title={task.title}>{task.title}</span>
        <span className={css.autoTaskStatus}>{t(STATUS_KEY[task.status])}</span>
        <Button
          size="sm"
          title={t('auto.openDetail')}
          onClick={() => { controller.openTask(task.id); onClose() }}
        >
          {t('auto.openDetail')}
        </Button>
      </header>

      {/* ONE expand row: chevron + live summary (the detail's disclosure
          header grammar) — the editor's enable switch stays in the body, so
          the card never carries a second copy of the same control. */}
      <button
        type="button"
        className={css.autoTaskExpand}
        aria-expanded={expanded}
        title={t('auto.editAutomation')}
        onClick={() => { setExpanded(value => !value) }}
      >
        <Icon name="chevronDown" className={`${css.autoTaskChevron}${expanded ? ` ${css.autoTaskChevronOpen}` : ''}`} />
        <span className={css.autoTaskSummary} title={summary}>{summary}</span>
      </button>
      {expanded && <AutomationEditor controller={controller} task={task} />}
    </section>
  )
}

/** The unified automation overview panel (see module doc). */
export function AutomationPanel({ controller, onClose }: {
  controller: BoardController
  onClose: () => void
}) {
  const [snapshot, setSnapshot] = useState(controller.getSnapshot())
  useEffect(
    () => controller.subscribe(() => setSnapshot(controller.getSnapshot())),
    [controller],
  )

  // Tasks with LIVE automation (enabled schedule or session rules).
  const automated = automationTasksOf(snapshot.tasks)

  return (
    <Dialog title={t('auto.title')} label={t('auto.title')} onClose={onClose} className={css.autoModal}>
      {/* The ONE scroll region of the dialog: the task cards (each expanding
          into the full automation editor) scroll together; the header stays
          pinned — tall editors never clip their own bottom (save buttons
          stay reachable). See .modal / .modalScroll. */}
      <div className={css.modalScroll}>
        {automated.length === 0 ? (
          <p className={css.autoEmpty}>{t('auto.empty')}</p>
        ) : (
          <div className={css.autoList}>
            {automated.map(task => (
              <AutomationTaskCard key={task.id} controller={controller} task={task} onClose={onClose} />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}
