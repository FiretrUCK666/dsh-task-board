/**
 * Shared automation UI — the ONE rule grammar for every automation surface.
 * The task detail's 自动化 section and the board header's 自动化 overview
 * render the same rows and the same add/edit form, so no surface can carry a
 * second, weaker copy of a feature again. Everything reads the single read
 * projection (automationRowsOf) and the shared readiness semantics
 * (sessionRuleReadiness — the same column judgment as the task schedule).
 *
 * Contains:
 * - CronField: the one cron input/preset grammar (the schedule editor and
 *   the session-rule form share it, so the expressions always speak alike);
 * - SessionRuleRows: one row per session rule (identity + instruction +
 *   trigger + send mode + readiness + enable/edit/delete);
 * - SessionRuleForm: the ONE add/edit form for a session rule (the "给某个
 *   会话进行自动化" surface — full capability, never a reduced clone);
 * - SessionRulesSection: rows + form toggled in place, the only surface
 *   needing composition (used by the detail and the overview verbatim).
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { type SchedulePreset } from '../../core/presets.ts'
import { LocalStoragePresetStore } from '../../core/presets.ts'
import {
  automationRowsOf, sessionRuleOf, sessionRuleReadiness, type AutomationRow,
} from '../../core/automation.ts'
import { isValidCron } from '../../core/schedule.ts'
import { ruleReadiness, type TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { cronHumanLabel } from './cron-label.ts'
import { mergedPresets, presetIsDefault, PresetManager } from './PresetManager.tsx'
import { STATUS_KEY } from './status.ts'
import { PromptInput } from './PromptInput.tsx'
import { Button, Icon, Section, SendModeToggle, Switch } from './ui.tsx'
import { Chip } from './Chip.tsx'

/**
 * The one cron grammar: text input + preset dropdown (+ optional preset
 * manager). The caller owns value/validation/commit time:
 * - onCommit fires on Enter/blur (the schedule editor persists that way);
 * - onPreset fires when a preset is picked (schedule editor = 即改即生效);
 *   without it the pick only sets the value (session form = save on 保存).
 */
export function CronField({ value, presets, onChange, onCommit, onPreset, onManagePresets, invalid, label }: {
  value: string
  presets: readonly SchedulePreset[]
  onChange: (value: string) => void
  /** Enter/blur commit (absent = the caller validates on save only). */
  onCommit?: (value: string) => void
  /** Immediate persist on preset pick (absent = the pick sets the value). */
  onPreset?: (value: string) => void
  onManagePresets?: () => void
  /** Error state: the input's invalid border. */
  invalid?: boolean
  label: string
}) {
  return (
    <span className={css.scheduleCronRow}>
      <input
        className={`${css.input} ${css.scheduleInput}${invalid === true ? ` ${css.scheduleInputInvalid}` : ''}`}
        value={value}
        placeholder="0 9 * * *"
        spellCheck={false}
        aria-label={label}
        onChange={event => { onChange(event.target.value) }}
        onBlur={() => { onCommit?.(value) }}
        onKeyDown={event => { if (event.key === 'Enter') onCommit?.(value) }}
      />
      <span className={css.selectWrap}>
        <select
          className={css.schedulePreset}
          value=""
          aria-label={t('detail.schedule.presets')}
          onChange={event => {
            if (event.target.value === '') return
            if (onPreset !== undefined) onPreset(event.target.value)
            else onChange(event.target.value)
          }}
        >
          <option value="">{t('detail.schedule.presets')}…</option>
          {presets.map(preset => (
            <option key={preset.id} value={preset.cron}>
              {preset.label}
              {!presetIsDefault(preset) ? ` (${t('detail.schedule.presets.custom')})` : ''}
            </option>
          ))}
        </select>
      </span>
      {onManagePresets !== undefined && (
        <Button onClick={onManagePresets}>
          {t('detail.schedule.managePresets')}
        </Button>
      )}
    </span>
  )
}

/** The target session's display title (falls back to the raw id). */
function ruleSessionTitle(controller: BoardController, task: TaskRecord, sessionId: string): string {
  const label = controller.sessionLabelsOf(task.id).find(item => item.sessionId === sessionId)
  return label?.title ?? sessionId
}

/** THE one schedule-summary text (off / paused(reason) / chain runs / cron
 *  human label + next instant), read by the detail's disclosure header, the
 *  automation overview's row and the card's tooltip — one grammar, three
 *  surfaces, never three branch sets. `pausedFailed` opts into the detail's
 *  "failed pause" reason word (a review pause after a failed run). */
export function scheduleSummary(task: TaskRecord, pausedFailed = false): string {
  const schedule = task.schedule
  if (schedule === undefined || !schedule.enabled) return t('detail.schedule.off')
  const readiness = ruleReadiness(task)
  if (readiness.kind === 'paused') {
    return pausedFailed
      ? `${t('detail.schedule.paused')} · ${t('detail.schedule.pausedFailedShort')}`
      : `${t('detail.schedule.paused')} (${t(STATUS_KEY[readiness.status])})`
  }
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
  return `${t('detail.schedule.mode.cron')} · ${cronHumanLabel(schedule.cron ?? '')} · ${nextLabel}`
}

/** One session-rule row (readiness / enable / edit / delete). */
function SessionRuleRow({ task, controller, row, onEdit }: {
  task: TaskRecord
  controller: BoardController
  row: Extract<AutomationRow, { kind: 'session-rule' }>
  onEdit: () => void
}) {
  const readiness = sessionRuleReadiness(task, sessionRuleOf(row))
  const title = ruleSessionTitle(controller, task, row.sessionId)
  return (
    <li className={css.autoRuleRow}>
      <span className={css.autoRuleTop}>
        <span className={css.autoRuleSession}>
          <Icon name="link" className={css.autoMetaIcon} />
          <span className={css.autoRuleSessionTitle} title={title}>{title}</span>
        </span>
        <span className={css.autoRuleSend}>
          {t(row.send === 'queue' ? 'review.sendQueue' : 'review.sendSteer')}
        </span>
        {readiness.kind === 'paused' && (
          <Chip kind="warn" fill={false}>
            {t('auto.schedule.paused')} ({t(STATUS_KEY[readiness.status])})
          </Chip>
        )}
        {readiness.kind === 'disabled' && (
          <Chip kind="muted" fill={false}>
            {t('auto.rule.off')}
          </Chip>
        )}
      </span>
      <span className={css.autoRuleInstruction} title={row.instruction}>
        {row.instruction}
      </span>
      <span className={css.autoRuleMeta} title={row.cron}>
        {t('auto.cron')} {cronHumanLabel(row.cron)}
        {row.nextAt > Date.now() && ` · ${t('auto.rule.next', { time: new Date(row.nextAt).toLocaleString() })}`}
      </span>
      <span className={css.autoRuleActions}>
        <Switch
          checked={row.enabled}
          onChange={next => { controller.toggleSessionRule(task.id, row.ruleId, next) }}
          label={t('auto.rule.enable')}
        />
        <Button size="sm" title={t('auto.rule.editTitle')} onClick={onEdit}>
          {t('auto.rule.edit')}
        </Button>
        <button
          type="button"
          className={css.rowHide}
          title={t('auto.rule.deleteTitle')}
          onClick={() => { controller.deleteSessionRule(task.id, row.ruleId) }}
        >
          {t('auto.rule.delete')}
        </button>
      </span>
    </li>
  )
}

/** The ONE session-rule form (add + edit). Editing locks the target session
 *  (the rule's identity is its session; a changed target is a new rule —
 *  delete + add — and the form never hides that fact). */
function SessionRuleForm({ task, controller, ruleId, onClose }: {
  task: TaskRecord
  controller: BoardController
  /** undefined = add mode; a rule id = edit mode. */
  ruleId: string | undefined
  onClose: () => void
}) {
  const labels = controller.sessionLabelsOf(task.id)
  const existing = ruleId !== undefined
    ? (task.rules ?? []).find(rule => rule.id === ruleId)
    : undefined
  const [sessionId, setSessionId] = useState(existing?.sessionId ?? labels[0]?.sessionId ?? '')
  const [instruction, setInstruction] = useState(existing?.instruction ?? '')
  const [cron, setCron] = useState(existing?.cron ?? '0 9 * * *')
  const [steer, setSteer] = useState(existing?.send === 'steer')
  const [error, setError] = useState<string | undefined>(undefined)
  const [presetStore] = useState(() => new LocalStoragePresetStore())
  const [presets, setPresets] = useState(() => mergedPresets(presetStore))
  const [showPresets, setShowPresets] = useState(false)
  // In edit mode the target session may have gone from the native list — the
  // select still offers it, so the rule never becomes un-editable.
  const options = existing !== undefined && !labels.some(label => label.sessionId === existing.sessionId)
    ? [{ sessionId: existing.sessionId, title: existing.sessionId }, ...labels]
    : labels

  const submit = (): void => {
    const trimmedInstruction = instruction.trim()
    const trimmedCron = cron.trim()
    if (trimmedInstruction === '' || !isValidCron(trimmedCron) || sessionId === '') {
      setError(t('auto.form.invalid'))
      return
    }
    const send = steer ? 'steer' : 'queue'
    if (existing !== undefined) {
      const ok = controller.updateSessionRule(task.id, existing.id, {
        sessionId, instruction: trimmedInstruction, cron: trimmedCron, send,
      })
      if (!ok) {
        setError(t('auto.form.invalid'))
        return
      }
    } else if (controller.createSessionRule(task.id, {
      sessionId, instruction: trimmedInstruction, cron: trimmedCron, send,
    }) === undefined) {
      setError(t('auto.form.invalid'))
      return
    }
    onClose()
  }

  return (
    <div className={css.autoForm}>
      {labels.length === 0 && existing === undefined ? (
        <p className={css.detailHint}>{t('auto.form.noSession')}</p>
      ) : (
        <>
          <label className={css.autoField}>
            <span className={css.autoFieldLabel}>{t('auto.form.session')}</span>
            <span className={css.selectWrap}>
              <select
                className={`${css.input} ${css.autoSelect}`}
                value={sessionId}
                disabled={existing !== undefined}
                aria-label={t('auto.form.session')}
                onChange={event => { setSessionId(event.target.value); setError(undefined) }}
              >
                {options.map(label => (
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
            <CronField
              value={cron}
              presets={presets}
              onChange={next => { setCron(next); setError(undefined) }}
              onManagePresets={() => { setShowPresets(true) }}
              label={t('auto.form.cron')}
            />
          </label>
          <div className={css.autoField}>
            <span className={css.autoFieldLabel}>{t('auto.form.send')}</span>
            <SendModeToggle steer={steer} onChange={setSteer} />
          </div>
          {error !== undefined && <p className={css.formError}>{error}</p>}
          <p className={css.detailHint}>{t('auto.form.hint')}</p>
          <span className={css.autoFormActions}>
            <Button size="sm" variant="primary" onClick={submit}>
              {t('auto.form.save')}
            </Button>
            <Button size="sm" onClick={onClose}>
              {t('detail.cancel')}
            </Button>
          </span>
        </>
      )}
      {showPresets && (
        <PresetManager
          store={presetStore}
          onClose={() => { setShowPresets(false); setPresets(mergedPresets(presetStore)) }}
        />
      )}
    </div>
  )
}

/**
 * The session-rules module: one row per rule + the add/edit form in place —
 * an empty task shows only the 新增 affordance. Panel and detail render this
 * verbatim; editing a rule (the form with the full capability) can never
 * diverge between surfaces again.
 */
export function SessionRulesSection({ controller, task }: {
  controller: BoardController
  task: TaskRecord
}) {
  // undefined = form closed; 'new' = add; a rule id = edit.
  const [formKey, setFormKey] = useState<string | undefined>(undefined)
  const rows = automationRowsOf(task)
    .filter((row): row is Extract<AutomationRow, { kind: 'session-rule' }> => row.kind === 'session-rule')
  const editable = controller.sessionLabelsOf(task.id).length > 0
  return (
    <Section title={t('auto.rules')} className={css.autoRules}>
      {rows.length > 0 && (
        <ul className={css.autoRuleList}>
          {rows.map(row => (
            <SessionRuleRow
              key={row.ruleId}
              task={task}
              controller={controller}
              row={row}
              onEdit={() => { setFormKey(row.ruleId) }}
            />
          ))}
        </ul>
      )}
      {formKey !== undefined ? (
        <SessionRuleForm
          task={task}
          controller={controller}
          ruleId={formKey === 'new' ? undefined : formKey}
          onClose={() => { setFormKey(undefined) }}
        />
      ) : (
        <span className={css.autoAddAction}>
          <Button size="sm" disabled={!editable} onClick={() => { setFormKey('new') }}>
            {t('auto.form.new')}
          </Button>
        </span>
      )}
    </Section>
  )
}
