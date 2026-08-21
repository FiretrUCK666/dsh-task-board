/**
 * AutomationPanel: the board header's unified "自动化" overview. One place to
 * see BOTH automatic-driving kinds — the task-level schedule rule (cron /
 * run-after-completion) and the session-level rules (send a preset instruction
 * to one of the task's sessions on a cron).
 *
 * It is deliberately an OVERVIEW: task-level automation gets a live summary +
 * enable switch + a jump into the task detail (where the full schedule editor
 * already lives) — and arming an unlimited chain from the switch raises the
 * SAME one-shot confirmation the detail editor shows (chainUnlimited, the one
 * guard). Session-level rules render through the SHARED SessionRulesSection —
 * exactly the same rows and the same add/edit form as the task detail's
 * automation disclosure — so the session-rule system has one UI and no
 * surface can carry a reduced second copy again.
 */
import { useEffect, useState } from 'react'
import { type BoardController } from '../../core/controller.ts'
import { chainUnlimited, type TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { Dialog } from './Dialog.tsx'
import { SessionRulesSection, scheduleSummary } from './automation-ui.tsx'
import { Button, Icon, Switch } from './ui.tsx'
import { STATUS_KEY } from './status.ts'

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

  // The overview's enable switch shares the detail's unlimited-chain guard:
  // arming an endless chain confirms once, before it is ever armed.
  const [confirmUnlimited, setConfirmUnlimited] = useState<TaskRecord | undefined>(undefined)

  /** Arm/disarm the task schedule from the overview (same semantics as the
   *  detail editor's toggle, minus the local-edit syncing). */
  const applyToggle = (task: TaskRecord, next: boolean): void => {
    if (next && chainUnlimited(task.schedule?.mode, task.schedule?.maxRuns)) {
      setConfirmUnlimited(task)
      return
    }
    controller.setSchedule(task.id, { enabled: next })
  }

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
                      onChange={next => { applyToggle(task, next) }}
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
      {confirmUnlimited !== undefined && (
        <ConfirmDialog
          title={t('detail.schedule.unlimitedTitle')}
          message={t('detail.schedule.unlimitedConfirm')}
          confirmLabel={t('detail.schedule.unlimitedOk')}
          danger
          onCancel={() => { setConfirmUnlimited(undefined) }}
          onConfirm={() => {
            const task = confirmUnlimited
            setConfirmUnlimited(undefined)
            controller.setSchedule(task.id, { enabled: true })
          }}
        />
      )}
    </Dialog>
  )
}
