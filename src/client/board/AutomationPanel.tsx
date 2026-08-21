/**
 * AutomationPanel: the board header's "自动化" overview. ONE place to see AND
 * manage BOTH automatic-driving kinds of every ACTIVE automated task — the
 * task-level schedule (cron / 完成后接续) and the session-level rules.
 *
 * Membership = live automation only (`automationTasksOf`: an enabled schedule
 * or at least one session rule — a disarmed rule is not listed as if it were
 * running). Every card shows its identity + one live summary row (the ONE
 * summary grammar, scheduleSummary — including 接续 · 已运行 N/上限) with the
 * quick enable switch (the same chainUnlimited gate as the editor), and
 * expanding renders the SHARED AutomationEditor verbatim — the board has
 * every capability the detail has (including 完成后接续), and no surface can
 * drift into a reduced second editor.
 */
import { useEffect, useState } from 'react'
import { type BoardController } from '../../core/controller.ts'
import { automationTasksOf } from '../../core/automation.ts'
import { chainUnlimited, type TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { Dialog } from './Dialog.tsx'
import { AutomationEditor, scheduleSummary } from './automation-ui.tsx'
import { Button, Icon, Switch } from './ui.tsx'
import { STATUS_KEY } from './status.ts'

/** One automated task in the overview: identity + live summary row (with the
 *  quick switch) + expand into the shared full editor. */
function AutomationTaskCard({ controller, task, onClose }: {
  controller: BoardController
  task: TaskRecord
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  // The overview's quick switch shares the editor's unlimited-chain gate:
  // arming an endless chain confirms once, never silently.
  const [confirmUnlimited, setConfirmUnlimited] = useState(false)
  const schedule = task.schedule

  const quickToggle = (next: boolean): void => {
    if (next && chainUnlimited(schedule?.mode, schedule?.maxRuns)) {
      setConfirmUnlimited(true)
      return
    }
    controller.setSchedule(task.id, { enabled: next })
  }

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

      {/* Task-level automation: one live summary row + enable switch — the
          same summary grammar as the detail's disclosure header (接续 · 已运行
          N/上限 included), so the board reads exactly what the detail reads. */}
      {schedule !== undefined && (
        <div className={css.autoScheduleRow}>
          <span className={css.autoMeta} title={schedule.cron}>
            <Icon name="play" className={css.autoMetaIcon} />
            {scheduleSummary(task)}
          </span>
          <Switch
            checked={schedule.enabled}
            onChange={quickToggle}
            label={t('auto.schedule.enable')}
          />
        </div>
      )}

      {/* Expand affordance: the shared full editor (same component as the
          task detail's automation disclosure). */}
      <button
        type="button"
        className={css.autoTaskExpand}
        aria-expanded={expanded}
        title={t('auto.editAutomation')}
        onClick={() => { setExpanded(value => !value) }}
      >
        <Icon name="chevronDown" className={`${css.autoTaskChevron}${expanded ? ` ${css.autoTaskChevronOpen}` : ''}`} />
        <span className={css.autoTaskSummary}>{t('auto.editAutomation')}</span>
      </button>
      {expanded && <AutomationEditor controller={controller} task={task} />}

      {confirmUnlimited && (
        <ConfirmDialog
          title={t('detail.schedule.unlimitedTitle')}
          message={t('detail.schedule.unlimitedConfirm')}
          confirmLabel={t('detail.schedule.unlimitedOk')}
          danger
          onCancel={() => { setConfirmUnlimited(false) }}
          onConfirm={() => {
            setConfirmUnlimited(false)
            controller.setSchedule(task.id, { enabled: true })
          }}
        />
      )}
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
      {automated.length === 0 ? (
        <p className={css.autoEmpty}>{t('auto.empty')}</p>
      ) : (
        <div className={css.autoList}>
          {automated.map(task => (
            <AutomationTaskCard key={task.id} controller={controller} task={task} onClose={onClose} />
          ))}
        </div>
      )}
    </Dialog>
  )
}
