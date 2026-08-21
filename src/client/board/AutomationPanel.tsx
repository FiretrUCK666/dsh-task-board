/**
 * AutomationPanel: the board header's unified "自动化" overview. One place to
 * manage BOTH automatic-driving kinds — the task-level schedule rule (cron /
 * run-after-completion) and the session-level rules (send a preset instruction
 * to one of the task's sessions on a cron). It is deliberately an OVERVIEW +
 * session-rule editor: task-level automation gets a live summary + enable
 * switch + a jump into the task detail (where the full schedule editor
 * already lives), never a second copy of that editor.
 *
 * The session-rule editing (add / toggle / delete) lives HERE — the only UI
 * surface for it — because there is no other place for it in the app.
 */
import { useEffect, useState } from 'react'
import { type BoardController } from '../../core/controller.ts'
import { ruleReadiness, type TaskRecord } from '../../core/tasks.ts'
import { automationRowsOf, type AutomationRow } from '../../core/automation.ts'
import { describeCron, isValidCron } from '../../core/schedule.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Dialog } from './Dialog.tsx'
import { Button, Icon, Section, SendModeToggle, Switch } from './ui.tsx'
import { PromptInput } from './PromptInput.tsx'
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
  return `${t('detail.schedule.mode.cron')} · ${cronLabel(schedule.cron)} · ${nextLabel}`
}

/** Human-readable cron description (falls back to the raw expression). */
function cronLabel(expr: string): string {
  const description = describeCron(expr)
  if (description === undefined) return expr
  switch (description.kind) {
    case 'everyMinute':
      return t('schedule.desc.everyMinute')
    case 'everyMinutes':
      return t('schedule.desc.everyMinutes', { n: String(description.minutes) })
    case 'everyHours':
      return t('schedule.desc.everyHours', { n: String(description.hours) })
    case 'dailyAt':
      return t('schedule.desc.dailyAt', { time: description.time })
    case 'weekdaysAt':
      return t('schedule.desc.weekdaysAt', { time: description.time })
    case 'weeklyAt':
      return t('schedule.desc.weeklyAt', { days: description.weekdays.join(', '), time: description.time })
    case 'monthlyAt':
      return t('schedule.desc.monthlyAt', { days: description.days.join(', '), time: description.time })
    case 'custom':
      return t('schedule.desc.custom')
  }
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
  // The task whose "新增会话规则" form is open (one at a time).
  const [formTaskId, setFormTaskId] = useState<string | undefined>(undefined)
  const [sessionId, setSessionId] = useState<string>('')
  const [instruction, setInstruction] = useState('')
  const [cron, setCron] = useState('0 9 * * *')
  const [steer, setSteer] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  // Tasks carrying live automation: a task-level schedule that is armed, or at
  // least one session rule. A task with no rules and a disarmed schedule is not
  // shown (there is nothing to manage in the overview).
  const automated = snapshot.tasks.filter(task =>
    (task.schedule?.enabled === true) || (task.rules !== undefined && task.rules.length > 0))

  const sessionTitleOf = (task: TaskRecord, ruleSessionId: string): string => {
    const label = controller.sessionLabelsOf(task.id).find(item => item.sessionId === ruleSessionId)
    return label?.title ?? ruleSessionId
  }

  const openForm = (task: TaskRecord): void => {
    const labels = controller.sessionLabelsOf(task.id)
    setSessionId(labels[0]?.sessionId ?? '')
    setInstruction('')
    setCron('0 9 * * *')
    setSteer(false)
    setError(undefined)
    setFormTaskId(task.id)
  }

  const addRule = (task: TaskRecord): void => {
    const trimmed = instruction.trim()
    if (trimmed === '' || !isValidCron(cron.trim())) {
      setError(t('auto.form.invalid'))
      return
    }
    // Empty session list is guarded at the UI (the form only opens with labels);
    // a defensive guard mirrors the controller's own no-op.
    if (sessionId === '') return
    controller.createSessionRule(task.id, {
      sessionId,
      instruction: trimmed,
      cron: cron.trim(),
      send: steer ? 'steer' : 'queue',
    })
    setFormTaskId(undefined)
  }

  return (
    <Dialog title={t('auto.title')} label={t('auto.title')} onClose={onClose} className={css.autoModal}>
      {automated.length === 0 ? (
        <p className={css.autoEmpty}>{t('auto.empty')}</p>
      ) : (
        <div className={css.autoList}>
          {automated.map(task => {
            const schedule = task.schedule
            const labels = controller.sessionLabelsOf(task.id)
            // The single read-side projection: every row (session rule +
            // task-level schedule) is one shape; components only format it.
            const rows = automationRowsOf(task)
            const rules = rows.filter((row): row is Extract<AutomationRow, { kind: 'session-rule' }> => row.kind === 'session-rule')
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

                {/* Session-level rules: each rule's own row (session + instruction
                    + cron + send mode + enable switch + delete), plus the per-task
                    add form. */}
                {rules.length > 0 && (
                  <Section title={t('auto.rules')} className={css.autoRules}>
                    <ul className={css.autoRuleList}>
                      {rules.map(rule => (
                        <li key={rule.ruleId} className={css.autoRuleRow}>
                          <span className={css.autoRuleTop}>
                            <span className={css.autoRuleSession} title={sessionTitleOf(task, rule.sessionId)}>
                              {sessionTitleOf(task, rule.sessionId)}
                            </span>
                            <span className={css.autoRuleSend}>
                              {t(rule.send === 'queue' ? 'review.sendQueue' : 'review.sendSteer')}
                            </span>
                          </span>
                          <span className={css.autoRuleInstruction} title={rule.instruction}>
                            {rule.instruction}
                          </span>
                          <span className={css.autoRuleMeta} title={rule.cron}>
                            {t('auto.cron')} {cronLabel(rule.cron)}
                          </span>
                          <span className={css.autoRuleActions}>
                            <Switch
                              checked={rule.enabled}
                              onChange={next => { controller.toggleSessionRule(task.id, rule.ruleId, next) }}
                              label={t('auto.rule.enable')}
                            />
                            <button
                              type="button"
                              className={css.rowHide}
                              title={t('auto.rule.deleteTitle')}
                              onClick={() => { controller.deleteSessionRule(task.id, rule.ruleId) }}
                            >
                              {t('auto.rule.delete')}
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {/* New-session-rule form (one at a time, per task). */}
                {formTaskId === task.id ? (
                  <div className={css.autoForm}>
                    {labels.length === 0 ? (
                      <p className={css.detailHint}>{t('auto.form.noSession')}</p>
                    ) : (
                      <>
                        <label className={css.autoField}>
                          <span className={css.autoFieldLabel}>{t('auto.form.session')}</span>
                          <span className={css.selectWrap}>
                            <select
                              className={`${css.input} ${css.autoSelect}`}
                              value={sessionId}
                              aria-label={t('auto.form.session')}
                              onChange={event => { setSessionId(event.target.value); setError(undefined) }}
                            >
                              {labels.map(label => (
                                <option key={label.sessionId} value={label.sessionId}>
                                  {label.title}
                                </option>
                              ))}
                            </select>
                          </span>
                        </label>
                        <label className={css.autoField}>
                          <span className={css.autoFieldLabel}>{t('auto.form.instruction')}</span>
                          <PromptInput
                            value={instruction}
                            onChange={next => { setInstruction(next); setError(undefined) }}
                            placeholder={t('auto.form.instructionPlaceholder')}
                            rows={3}
                            controller={controller}
                            mentions={labels.map(({ sessionId, title }) => ({ id: sessionId, title }))}
                          />
                        </label>
                        <label className={css.autoField}>
                          <span className={css.autoFieldLabel}>{t('auto.form.cron')}</span>
                          <input
                            className={css.input}
                            value={cron}
                            placeholder="0 9 * * *"
                            spellCheck={false}
                            aria-label={t('auto.form.cron')}
                            onChange={event => { setCron(event.target.value); setError(undefined) }}
                          />
                        </label>
                        <div className={css.autoField}>
                          <span className={css.autoFieldLabel}>{t('auto.form.send')}</span>
                          <SendModeToggle steer={steer} onChange={setSteer} />
                        </div>
                        {error !== undefined && <p className={css.formError}>{error}</p>}
                        <p className={css.detailHint}>{t('auto.form.hint')}</p>
                        <span className={css.autoFormActions}>
                          <Button size="sm" onClick={() => { addRule(task) }}>
                            {t('auto.form.add')}
                          </Button>
                          <Button size="sm" onClick={() => { setFormTaskId(undefined) }}>
                            {t('detail.cancel')}
                          </Button>
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  <span className={css.autoAddAction}>
                    <Button size="sm" disabled={labels.length === 0} onClick={() => { openForm(task) }}>
                      {t('auto.form.new')}
                    </Button>
                  </span>
                )}
              </section>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}
