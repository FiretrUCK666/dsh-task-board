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
 *   needing composition (used by the detail and the overview verbatim);
 * - AutomationEditor: THE one task-automation editor — task-level schedule
 *   (cron / after-completion chain) + the session-rules section, rendered by
 *   the detail's disclosure AND the board overview's task card verbatim.
 */
import { useEffect, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { type SchedulePreset } from '../../core/presets.ts'
import {
  automationRowsOf, sessionRuleOf, sessionRuleReadiness, type AutomationRow,
} from '../../core/automation.ts'
import { isValidCron, nextRunAtMs } from '../../core/schedule.ts'
import {
  chainUnlimited, latestExecutionOf, ruleReadiness, type ScheduleMode, type TaskRecord,
} from '../../core/tasks.ts'
import { t, type TaskBoardKey } from '../locales.ts'
import css from '../board.module.css'
import { cronHumanLabel } from './cron-label.ts'
import { mergedPresets, presetIsDefault, PresetManager } from './PresetManager.tsx'
import { STATUS_KEY, PAUSED_REASON_KEY } from './status.ts'
import { PromptInput } from './PromptInput.tsx'
import { Button, Icon, Section, Segmented, SendModeToggle, Switch } from './ui.tsx'
import { Chip } from './Chip.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'

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
        className={`${css.input} ${css.scheduleInput}${invalid === true ? ` ${css.inputInvalid}` : ''}`}
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
        <Button className={css.scheduleManageButton} onClick={onManagePresets}>
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
  if (readiness.kind === 'blocked') {
    // Empty prompt: the rule cannot drive anything — a reason, not a pause.
    return `${t('detail.schedule.paused')} · ${t('detail.schedule.blocked')}`
  }
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
        {/* 排队/插话 labels the SEND MODE, never a queueing state — the row
            carries a real readiness glyph below; the tooltip says it plainly. */}
        <span
          className={css.autoRuleSend}
          title={t(row.send === 'queue' ? 'review.sendQueueTitle' : 'review.sendSteerTitle')}
        >
          {t(row.send === 'queue' ? 'review.sendQueue' : 'review.sendSteer')}
        </span>
        {/* An armed on-complete rule has NOTHING queued yet: it waits for the
            NEXT completion (驱动一次/留言一次). The chip names the REAL state
            so the row never reads as "已经在跑" — 只有暂停/关闭/阻断才有旧 chips。 */}
        {readiness.kind === 'active' && row.trigger === 'on-complete' && (
          <Chip kind="muted" fill={false} title={t('auto.rule.awaitingTitle')}>
            {t('auto.rule.awaiting')}
          </Chip>
        )}
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
        {readiness.kind === 'blocked' && (
          <Chip kind="muted" fill={false}>
            {t('detail.schedule.blocked')}
          </Chip>
        )}
      </span>
      <span className={css.autoRuleInstruction} title={row.usePrompt === true ? t('auto.content.usePrompt') : row.instruction}>
        {row.usePrompt === true ? t('auto.content.usePrompt') : row.instruction}
      </span>
      <span className={css.autoRuleMeta} title={row.trigger === 'cron' ? row.cron : undefined}>
        {row.trigger === 'cron' ? (
          <>
            {t('auto.cron')} {cronHumanLabel(row.cron)}
            {row.nextAt !== undefined && row.nextAt > Date.now()
              && ` · ${t('auto.rule.next', { time: new Date(row.nextAt).toLocaleString() })}`}
          </>
        ) : (
          t('auto.rule.onComplete')
        )}
      </span>
      <span className={css.autoRuleActions}>
        <Switch
          checked={row.enabled}
          onChange={next => { controller.toggleSessionRule(task.id, row.ruleId, next) }}
          label={t('auto.rule.enable')}
        />
        {/* Grammar: the row switch leads; the two text actions group on the
            right (编辑 beside 删除 — never stranded in the middle). */}
        <span className={css.autoRuleButtons}>
          <Button size="sm" title={t('auto.rule.editTitle')} onClick={onEdit}>
            {t('auto.rule.edit')}
          </Button>
          {/* A destructive row action uses the row-level danger grammar (ghost
              outline + danger tone) — same geometry as the edit beside it,
              never the quiet hide-text style. */}
          <Button
            size="sm"
            variant="dangerGhost"
            title={t('auto.rule.deleteTitle')}
            onClick={() => { controller.deleteSessionRule(task.id, row.ruleId) }}
          >
            {t('auto.rule.delete')}
          </Button>
        </span>
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
  // The SAME trigger choice as the task-level driving mode (按时间表 /
  // 任务完成后) — one segmented grammar; cron rules carry an expression,
  // on-complete rules carry none (the settle is the appointment).
  const [trigger, setTrigger] = useState<'cron' | 'on-complete'>(existing?.trigger ?? 'cron')
  const [cron, setCron] = useState(existing?.trigger === 'on-complete' ? '0 9 * * *' : existing?.cron ?? '0 9 * * *')
  // Content mode: the rule's own custom instruction, or the task's CURRENT
  // execution prompt (绘画 = 定时/每次完成把执行 Prompt 注入单个会话).
  const [usePrompt, setUsePrompt] = useState(existing?.usePrompt === true)
  const [steer, setSteer] = useState(existing?.send === 'steer')
  // The ONE failing field at a time (first failure wins): the message renders
  // inline next to that field and only that field wears the red border — a
  // combined "instruction AND cron" error names nothing.
  const [error, setError] = useState<'session' | 'instruction' | 'cron' | 'save' | undefined>(undefined)
  const [presetStore] = useState(() => controller.presetStore())
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
    // ONE message per failing field (first failure wins): a combined "fill in
    // the instruction AND a valid cron" error is unreadable — picking a cron
    // preset and hitting 保存 must name the ACTUAL missing piece.
    if (sessionId === '') {
      setError('session')
      return
    }
    if (!usePrompt && trimmedInstruction === '') {
      setError('instruction')
      return
    }
    if (trigger === 'cron' && !isValidCron(trimmedCron)) {
      setError('cron')
      return
    }
    const send: 'queue' | 'steer' = steer ? 'steer' : 'queue'
    const input: {
      sessionId: string
      instruction: string
      trigger: 'cron' | 'on-complete'
      usePrompt?: boolean
      cron: string
      send: 'queue' | 'steer'
    } = {
      sessionId, instruction: usePrompt ? '' : trimmedInstruction, trigger,
      ...usePrompt ? { usePrompt: true } : {},
      cron: trigger === 'cron' ? trimmedCron : '', send,
    }
    if (existing !== undefined) {
      const ok = controller.updateSessionRule(task.id, existing.id, input)
      if (!ok) {
        setError('save')
        return
      }
    } else if (controller.createSessionRule(task.id, input) === undefined) {
      setError('save')
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
                className={`${css.input} ${css.autoSelect}${error === 'session' ? ` ${css.inputInvalid}` : ''}`}
                value={sessionId}
                disabled={existing !== undefined}
                aria-label={t('auto.form.session')}
                aria-invalid={error === 'session' ? true : undefined}
                onChange={event => { setSessionId(event.target.value); setError(undefined) }}
              >
                {options.map(label => (
                  <option key={label.sessionId} value={label.sessionId}>
                    {label.title}
                  </option>
                ))}
              </select>
            </span>
            {error === 'session' && <span className={css.formError}>{t('auto.form.invalidSession')}</span>}
          </label>
          <label className={css.autoField}>
            <span className={css.autoFieldLabel}>{t('auto.form.trigger')}</span>
            <Segmented
              ariaLabel={t('auto.form.trigger')}
              options={[
                { value: 'cron', label: t('auto.trigger.cron') },
                { value: 'on-complete', label: t('auto.trigger.onComplete') },
              ]}
              value={trigger}
              onChange={next => { setTrigger(next as 'cron' | 'on-complete'); setError(undefined) }}
            />
          </label>
          <label className={css.autoField}>
            <span className={css.autoFieldLabel}>{t('auto.form.content')}</span>
            <Segmented
              ariaLabel={t('auto.form.content')}
              options={[
                { value: 'custom', label: t('auto.content.custom') },
                { value: 'usePrompt', label: t('auto.content.usePrompt') },
              ]}
              value={usePrompt ? 'usePrompt' : 'custom'}
              onChange={next => { setUsePrompt(next === 'usePrompt'); setError(undefined) }}
            />
          </label>
          {!usePrompt ? (
            <label className={css.autoField}>
              <span className={css.autoFieldLabel}>{t('auto.form.instruction')}</span>
              <PromptInput
                value={instruction}
                onChange={next => { setInstruction(next); setError(undefined) }}
                placeholder={t('auto.form.instructionPlaceholder')}
                rows={3}
                controller={controller}
                sessionId={sessionId === '' ? undefined : sessionId}
                invalid={error === 'instruction'}
              />
              {error === 'instruction' && <span className={css.formError}>{t('auto.form.invalidInstruction')}</span>}
            </label>
          ) : (
            <p className={css.detailHint}>{t('auto.form.usePromptHint')}</p>
          )}
          {trigger === 'cron' && (
            <label className={css.autoField}>
              <span className={css.autoFieldLabel}>{t('auto.form.cron')}</span>
              <CronField
                value={cron}
                presets={presets}
                invalid={error === 'cron'}
                onChange={next => { setCron(next); setError(undefined) }}
                onManagePresets={() => { setShowPresets(true) }}
                label={t('auto.form.cron')}
              />
              {error === 'cron' && <span className={css.formError}>{t('auto.form.invalidCron')}</span>}
            </label>
          )}
          {/* 排队/插话是每一条规则的发送方式（两种触发共用）：排队 = 按序等
              轮次（自动化车道 FIFO），插话 = 跳过排队立即注入——都是预算内的
              一个轮次，绝不瞬时齐发；提示行按触发方式给专属文案。 */}
          <div className={css.autoField}>
            <span className={css.autoFieldLabel}>{t('auto.form.send')}</span>
            <SendModeToggle steer={steer} onChange={setSteer} />
          </div>
          {error === 'save' && <p className={css.formError}>{t('auto.form.saveFailed')}</p>}
          <p className={css.detailHint}>
            {t(trigger === 'cron' ? 'auto.form.hint' : 'auto.form.hintLoop')}
          </p>
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

/**
 * THE one task-automation editor — the task-level schedule (cron /
 * after-completion chain: switch + driving mode + fields + live meta +
 * skip/stop, 即改即生效) and then the session rules (SessionRulesSection,
 * the same shared module).
 *
 * The task detail's 自动化 disclosure and the board's 自动化 overview task
 * cards render THIS verbatim — the board therefore has the SAME full
 * capability as the detail (including 完成后接续), and no surface can ever
 * drift into a reduced second editor. The two side-effect confirms (arming /
 * stopping an unlimited chain) live here so both surfaces share the same
 * gate (chainUnlimited).
 */
export function AutomationEditor({ controller, task }: { controller: BoardController; task: TaskRecord }) {
  const schedule = task.schedule
  // `||` (not `??`) falls back to the default even for an empty stored
  // expression, so switching modes can never leave the editor with a blank
  // cron value.
  const [cron, setCron] = useState(schedule?.cron || '0 9 * * *')
  const [enabled, setEnabled] = useState(schedule?.enabled ?? false)
  const [mode, setMode] = useState<ScheduleMode>(schedule?.mode ?? 'cron')
  const [maxRuns, setMaxRuns] = useState(schedule?.maxRuns?.toString() ?? '')
  const [nextRunAt, setNextRunAt] = useState<number | undefined>(schedule?.nextRunAt)
  const [lastTriggeredAt, setLastTriggeredAt] = useState<number | undefined>(schedule?.lastTriggeredAt)
  // The ONE failing field: the cron input or the max-runs input each carry
  // their own inline error; a max-runs error must never light the cron border.
  const [error, setError] = useState<'cron' | 'runs' | 'promptEmpty' | undefined>(undefined)
  const [showPresets, setShowPresets] = useState(false)
  const [presetStore] = useState(() => controller.presetStore())
  // The merged preset list (built-ins + custom); rebuilt when the manager closes.
  const [presets, setPresets] = useState(() => mergedPresets(presetStore))
  const [confirm, setConfirm] = useState<'unlimited-enable' | 'stop-chain' | undefined>(undefined)

  // Keep the editor in sync when the task record changes underneath (the
  // schedule rolls forward as runs trigger).
  useEffect(() => {
    setCron(schedule?.cron || '0 9 * * *')
    setEnabled(schedule?.enabled ?? false)
    setMode(schedule?.mode ?? 'cron')
    setMaxRuns(schedule?.maxRuns?.toString() ?? '')
    setNextRunAt(schedule?.nextRunAt)
    setLastTriggeredAt(schedule?.lastTriggeredAt)
    setError(undefined)
  }, [task.id, schedule?.enabled, schedule?.mode, schedule?.cron, schedule?.nextRunAt, schedule?.lastTriggeredAt, schedule?.maxRuns, schedule?.runCount])

  /** Validate + persist the current cron text (Enter or blur). */
  const saveCron = (value: string): void => {
    const trimmed = value.trim()
    setCron(trimmed)
    if (trimmed === '' || !isValidCron(trimmed)) {
      setError('cron')
      return
    }
    setError(undefined)
    controller.setSchedule(task.id, { cron: trimmed })
  }

  /** Persist the run budget (blank = unlimited). */
  const saveMaxRuns = (value: string): void => {
    const trimmed = value.trim()
    setMaxRuns(trimmed)
    if (trimmed === '') {
      controller.setSchedule(task.id, { maxRuns: undefined })
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed < 1) {
      setError('runs')
      return
    }
    setError(undefined)
    controller.setSchedule(task.id, { maxRuns: parsed })
  }

  /** Arm/disarm the schedule. Arming a chain without a run budget (unlimited)
   *  risks an endless loop of real agent sessions — confirm once first. */
  const applyEnabled = (next: boolean): void => {
    if (next && mode === 'cron' && cron.trim() !== schedule?.cron) controller.setSchedule(task.id, { cron: cron.trim() })
    if (!controller.setSchedule(task.id, { enabled: next, mode })) {
      // The one rejected arm: 完成后接续 with an empty execution prompt —
      // name the reason inline, never a silent dead switch.
      if (next && mode === 'chain') setError('promptEmpty')
      return
    }
    setEnabled(next)
  }

  /** Arm/disarm the schedule (arming first persists the edited cron). */
  const toggleEnabled = (next: boolean): void => {
    const trimmed = cron.trim()
    if (next && mode === 'cron' && (trimmed === '' || !isValidCron(trimmed))) {
      setError('cron')
      return
    }
    setError(undefined)
    // The ONE unlimited-chain guard (shared with the overview's switch): an
    // endless loop of real agent sessions confirms once, never silently.
    if (next && chainUnlimited(mode, maxRuns.trim() === '' ? undefined : Number(maxRuns))) {
      setConfirm('unlimited-enable')
      return
    }
    applyEnabled(next)
  }

  /** Switch the driving mode (cron ↔ chain). Switching back to cron first
   *  persists the editor's current expression, so the stored rule is never
   *  left with an empty cron (which cron mode would reject). */
  const switchMode = (next: ScheduleMode): void => {
    if (next === mode) return
    if (next === 'cron' && (cron.trim() === '' || !isValidCron(cron))) {
      setError('cron')
      return
    }
    setError(undefined)
    setMode(next)
    if (next === 'cron' && cron.trim() !== schedule?.cron) {
      controller.setSchedule(task.id, { cron: cron.trim() })
    }
    if (controller.setSchedule(task.id, { mode: next })) {
      // Re-arm under the new mode so an enabled switch takes effect at once.
      controller.setSchedule(task.id, { enabled, mode: next })
    }
  }

  /** Stop an active chain: only the automation stops (enabled:false — the
   *  card's column is untouched). Unlimited chains confirm once (endless
   *  loop of real agent sessions is a big side effect). */
  const stopChain = (): void => {
    if (chainUnlimited(mode, maxRuns.trim() === '' ? undefined : Number(maxRuns))) {
      setConfirm('stop-chain')
      return
    }
    if (controller.setSchedule(task.id, { enabled: false, mode })) setEnabled(false)
  }
  const applyStopChain = (): void => {
    if (controller.setSchedule(task.id, { enabled: false, mode })) setEnabled(false)
  }

  /** Skip the next cron firing: roll nextRunAt forward to the following
   *  match while keeping the rule armed — a "defer once", never a catch-up. */
  const skipNext = (): void => {
    if (mode !== 'cron' || nextRunAt === undefined) return
    const next = nextRunAtMs(cron, nextRunAt)
    if (next === undefined) return
    setNextRunAt(next)
    controller.applyScheduleNextRun(task.id, next, lastTriggeredAt)
  }

  const applyPreset = (preset: string): void => {
    if (preset === '') return
    setCron(preset)
    setError(undefined)
    controller.setSchedule(task.id, { cron: preset })
  }

  const closePresets = (): void => {
    setShowPresets(false)
    setPresets(mergedPresets(presetStore))
  }

  const readiness = ruleReadiness(task)
  const chainRuns = schedule?.runCount ?? 0
  const chainBudget = schedule?.maxRuns
  const nextLabel = !enabled || mode !== 'cron' || nextRunAt === undefined
    ? t('detail.schedule.notScheduled')
    : nextRunAt <= Date.now()
      ? t('detail.schedule.dueSoon')
      : new Date(nextRunAt).toLocaleString()
  const lastLabel = lastTriggeredAt === undefined ? '—' : new Date(lastTriggeredAt).toLocaleString()
  // Cron skip is offered only when a future due instant actually exists.
  const canSkip = enabled && mode === 'cron' && readiness.kind === 'active'
    && nextRunAt !== undefined && nextRunAt > Date.now()
  // A paused rule names its blocking status; a review pause caused by a
  // failed run adds the "because it failed" reason word; a BLOCKED rule (an
  // empty execution prompt) names the emptiness — one reason-line grammar.
  const stoppedReason = readiness.kind === 'paused'
    ? {
        extraFailed: readiness.status === 'review'
          && latestExecutionOf(task)?.result === 'failed',
        key: PAUSED_REASON_KEY[readiness.status],
      }
    : readiness.kind === 'blocked'
      ? { extraFailed: false, key: 'detail.schedule.blocked' as TaskBoardKey }
      : undefined

  return (
    <>
      {/* Task-level automation and session rules are the TWO halves of the
          same editor; each gets its own paired section header so the two
          systems never blur into one unlabeled block. */}
      <Section title={t('auto.taskSchedule')} className={css.autoRules}>
      <Switch
        checked={enabled}
        onChange={toggleEnabled}
        label={t('detail.schedule.enable')}
      />

      {/* Driving mode: fixed times (cron) or run-after-completion (chain) —
          the ONE segmented grammar shared with the session-rule trigger. */}
      <Segmented
        ariaLabel={t('detail.schedule')}
        options={[
          { value: 'cron', label: t('detail.schedule.mode.cron'), title: t('detail.schedule.mode.cronHint') },
          { value: 'chain', label: t('detail.schedule.mode.chain'), title: t('detail.schedule.mode.chainHint') },
        ]}
        value={mode}
        onChange={next => { switchMode(next as ScheduleMode) }}
      />

      {mode === 'cron' ? (
        /* ONE grid for every schedule row (cron + run budget): the label
           column is shared, so the cron input and the max-runs input align
           on the same left edge. */
        <div className={css.scheduleGrid}>
          <span className={css.scheduleLabel}>{t('detail.schedule.cron')}</span>
          {/* The ONE cron grammar (input + presets + manager) shared with the
              session-rule form — expressions always speak alike. */}
          <CronField
            value={cron}
            presets={presets}
            invalid={error === 'cron'}
            onChange={next => { setCron(next); setError(undefined) }}
            onCommit={saveCron}
            onPreset={applyPreset}
            onManagePresets={() => { setShowPresets(true) }}
            label={t('detail.schedule.cron')}
          />
          <span className={css.scheduleLabel}>{t('detail.schedule.maxRuns')}</span>
          <span className={css.scheduleMaxRow}>
            <input
              className={`${css.input} ${css.scheduleMaxInput}${error === 'runs' ? ` ${css.inputInvalid}` : ''}`}
              value={maxRuns}
              type="number"
              min={1}
              placeholder="∞"
              spellCheck={false}
              aria-label={t('detail.schedule.maxRuns')}
              aria-invalid={error === 'runs' ? true : undefined}
              onChange={event => { setMaxRuns(event.target.value); setError(undefined) }}
              onBlur={() => { saveMaxRuns(maxRuns) }}
              onKeyDown={event => { if (event.key === 'Enter') saveMaxRuns(maxRuns) }}
            />
            <span className={css.scheduleMeta}>
              {t('detail.schedule.runsSoFar')} {schedule?.runCount ?? 0}
              {schedule?.maxRuns !== undefined && ` / ${schedule.maxRuns}`}
            </span>
          </span>
        </div>
      ) : (
        <>
          <p className={css.scheduleMeta}>{t('detail.schedule.chainNote')}</p>
          <div className={css.scheduleActionRow}>
            <span className={css.scheduleMeta}>
              {t('detail.schedule.runsSoFar')} {chainRuns}
              {chainBudget !== undefined ? ` / ${chainBudget}` : ` · ${t('detail.schedule.unlimited')}`}
            </span>
            {enabled && (
              <Button size="sm" variant="ghost" onClick={stopChain}>
                {t('detail.schedule.stopChain')}
              </Button>
            )}
          </div>
          {stoppedReason !== undefined && (
            <p className={css.scheduleMeta}>
              {stoppedReason.extraFailed && <>{t('detail.schedule.pausedFailed')} </>}
              {t(stoppedReason.key)}
            </p>
          )}
          <div className={css.scheduleGrid}>
            <span className={css.scheduleLabel}>{t('detail.schedule.maxRuns')}</span>
            <span className={css.scheduleMaxRow}>
              <input
                className={`${css.input} ${css.scheduleMaxInput}${error === 'runs' ? ` ${css.inputInvalid}` : ''}`}
                value={maxRuns}
                type="number"
                min={1}
                placeholder="∞"
                spellCheck={false}
                aria-label={t('detail.schedule.maxRuns')}
                aria-invalid={error === 'runs' ? true : undefined}
                onChange={event => { setMaxRuns(event.target.value); setError(undefined) }}
                onBlur={() => { saveMaxRuns(maxRuns) }}
                onKeyDown={event => { if (event.key === 'Enter') saveMaxRuns(maxRuns) }}
              />
              <span className={css.scheduleMeta}>
                {t('detail.schedule.runsSoFar')} {schedule?.runCount ?? 0}
                {schedule?.maxRuns !== undefined && ` / ${schedule.maxRuns}`}
              </span>
            </span>
          </div>
        </>
      )}
      {error !== undefined && <p className={css.formError}>
        {t(error === 'cron' ? 'detail.schedule.invalid' : error === 'runs' ? 'detail.schedule.invalidRuns' : 'detail.promptEmpty')}
      </p>}
      {mode === 'cron' && (
        <>
          <div className={css.scheduleActionRow}>
            <span className={css.scheduleMeta}>
              {cronHumanLabel(cron)}
              {' · '}
              {readiness.kind === 'active'
                ? `${t('detail.schedule.nextRun')} ${nextLabel}`
                : t('detail.schedule.paused')}
              {' · '}{t('detail.schedule.lastTriggered')} {lastLabel}
            </span>
            {canSkip && (
              <Button size="sm" variant="ghost" onClick={skipNext}>
                {t('detail.schedule.skip')}
              </Button>
            )}
          </div>
          {stoppedReason !== undefined && (
            <p className={css.scheduleMeta}>
              {stoppedReason.extraFailed && <>{t('detail.schedule.pausedFailed')} </>}
              {t(stoppedReason.key)}
            </p>
          )}
        </>
      )}

      {/* Session-level rules: the shared module of the automation overview —
          one grammar on both surfaces, always complete. */}
      </Section>
      <SessionRulesSection controller={controller} task={task} />

      {showPresets && (
        <PresetManager
          store={presetStore}
          onClose={closePresets}
        />
      )}

      {/* Side-effect confirms for automation: enabling an unlimited chain and
          stopping one both confirm once — an endless loop of real agent
          sessions is a big side effect. */}
      {confirm === 'unlimited-enable' && (
        <ConfirmDialog
          title={t('detail.schedule.unlimitedTitle')}
          message={t('detail.schedule.unlimitedConfirm')}
          confirmLabel={t('detail.schedule.unlimitedOk')}
          danger
          onCancel={() => { setConfirm(undefined) }}
          onConfirm={() => { setConfirm(undefined); applyEnabled(true) }}
        />
      )}
      {confirm === 'stop-chain' && (
        <ConfirmDialog
          title={t('detail.schedule.stopChainTitle')}
          message={t('detail.schedule.stopChainConfirm')}
          confirmLabel={t('detail.schedule.stopChain')}
          danger
          onCancel={() => { setConfirm(undefined) }}
          onConfirm={() => { setConfirm(undefined); applyStopChain() }}
        />
      )}
    </>
  )
}
