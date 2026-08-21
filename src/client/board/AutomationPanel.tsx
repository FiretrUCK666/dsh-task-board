/**
 * AutomationPanel: the board header's unified "自动化" overview. One place to
 * see BOTH automatic-driving kinds — the task-level schedule rule (cron /
 * run-after-completion) and the session-level rules (send a preset instruction
 * to one of the task's sessions on a cron).
 *
 * It is deliberately an OVERVIEW: task-level automation gets a live summary +
 * enable switch + a jump into the task detail (where the full schedule editor
 * already lives); session-level rules render through the SHARED
 * SessionRulesSection — exactly the same rows and the same add/edit form as
 * the task detail's automation disclosure — so the session-rule system has one
 * UI and no surface can carry a reduced second copy again.
 */
import { useEffect, useState } from 'react'
import { type BoardController } from '../../core/controller.ts'
import { ruleReadiness, type TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Dialog } from './Dialog.tsx'
import { SessionRulesSection } from './automation-ui.tsx'
import { cronHumanLabel } from './cron-label.ts'
import { Button, Icon, Switch } from './ui.tsx'
import { STATUS_KEY } from './status.ts'

/** Compact one-line summary of a task's schedule rule (shared grammar with the
 *  task-detail editor, minus the editing affordances). */
function scheduleSummary(task: TaskRecord): string {
  const schedule = task.schedule
  if (schedule === undefined || !schedule.enabled) return t('auto.schedule.off')
  const readiness = ruleReadiness(task)
  if (readiness.kind === 'paused') return `${t('auto.schedule.paused')} (${t(STATUS_KEY[readiness.status])})`
  if (schedule.mode === 'chain') {
    const budget = schedule.maxRuns
    return `${t('detail.schedule.mode.chain')} · ${t('detail.schedule.runsSoFar')} ${schedule.runCount}${budget !== undefined ? `/${budget}` : ''}`
  }
  const next = schedule.nextRunAt
  const nextLabel = next === undefined
    ? t('detail.schedule.notScheduled')
    : next <= Date.now()
      ? t('detail.schedule.dueSoon')
      : new Date(next).toLocaleString()
  return `${t('detail.schedule.mode.cron')} · ${cronHumanLabel(schedule.cron)} · ${nextLabel}`
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

  // Tasks carrying live automation: a task-level schedule that is armed, or at
  // least one session rule. A task with no rules and a disarmed schedule is not
  // shown (there is nothing to manage in the overview).
  const automated = snapshot.tasks.filter(task =>
    (task.schedule?.enabled === true) || (task.rules !== undefined && task.rules.length > 0))

  return (
    <Dialog title={t('auto.title')} label={t('auto.title')} onClose={onClose} className={css.autoModal}>
      {automated.length === 0 ? (
        <p className={css.autoEmpty}>{t('auto.empty')}</p>
      ) : (
        <div className={css.autoList}>
          {automated.map(task => {
            const schedule = task.schedule
            return (
              <section key={task.id} className={css.autoTask}>
                {/* Card identity: title + status + jump into the detail. */}
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

                {/* Task-level automation: one summary row + enable switch + jump
                    to the detail's full schedule editor. */}
                {schedule !== undefined && schedule.enabled && (
                  <div className={css.autoScheduleRow}>
                    <span className={css.autoMeta} title={schedule.cron}>
                      <Icon name="play" className={css.autoMetaIcon} />
                      {scheduleSummary(task)}
                    </span>
                    <Switch
                      checked={schedule.enabled}
                      onChange={next => { controller.setSchedule(task.id, { enabled: next }) }}
                      label={t('auto.schedule.enable')}
                    />
                  </div>
                )}

                {/* Session-level rules: THE shared module (rows + add/edit
                    form) — one grammar with the task detail, never a second
                    copy. */}
                <SessionRulesSection controller={controller} task={task} />
              </section>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}
