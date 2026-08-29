/**
 * New-session dialog (the task detail's 会话 area "新建会话"): composes one
 * fresh native session with the shared run-config fields and binds it to the
 * task. Shares the run-config block (RunConfigFields) with the task form —
 * the same preset picker, the same field editor, zero drift — but nothing
 * else: a session has no title/description/prompt/landing column. The
 * initial value is the task's own run configuration (what the task runs
 * with is what the new session composes with; absent fields = deployment
 * defaults). Fully nested overlay: rendered inside the task detail, so it
 * MUST portal (see Dialog).
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import type { RunConfigPresetConfig } from '../../core/run-presets.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Dialog } from './Dialog.tsx'
import { RunConfigFields } from './RunConfigFields.tsx'
import { Button } from './ui.tsx'

/** The task's own run config as the dialog's starting value (absent = default). */
function taskConfigOf(task: TaskRecord): RunConfigPresetConfig {
  return {
    ...task.workspaceId !== undefined ? { workspaceId: task.workspaceId } : {},
    ...task.provider !== undefined ? { provider: task.provider } : {},
    ...task.model !== undefined ? { model: task.model } : {},
    ...task.reasoningEffort !== undefined ? { reasoningEffort: task.reasoningEffort } : {},
    ...task.agentPreset !== undefined ? { agentPreset: task.agentPreset } : {},
    ...task.permission !== undefined ? { permission: task.permission } : {},
  }
}

/** The "create a configured session for this task" dialog (see module doc). */
export function NewSessionModal({ controller, task, onClose, onCreated }: {
  controller: BoardController
  task: TaskRecord
  onClose: () => void
  /** The session joined the task (the section flashes its bind feedback). */
  onCreated: (sessionId: string) => void
}) {
  const [config, setConfig] = useState<RunConfigPresetConfig>(() => taskConfigOf(task))
  // Optional title: blank = leave the naming to the host (it names the
  // session automatically from the first real message — fallback + provider
  // cadence). A filled title goes through the OFFICIAL user rename, which
  // pins it against automatic regeneration — the two paths never fight.
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  // Inline feedback: a creation failure keeps the dialog open; a config or
  // rename failure after the session exists is surfaced as a partial
  // success (the session stays bound — the message names exactly what
  // happened).
  const [error, setError] = useState<string | undefined>(undefined)
  const [partial, setPartial] = useState<string | undefined>(undefined)

  const submit = (): void => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    setPartial(undefined)
    void controller.createTaskSession(task.id, { ...config, title }).then(result => {
      setBusy(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (result.titleError !== undefined) {
        // The session was created and bound; only its title did not stick.
        // Keep the dialog open on the partial note (a retry would create a
        // SECOND session — the honest close is the user's call).
        setPartial(t('detail.sessionNewTitleFailed', { error: result.titleError }))
        onCreated(result.sessionId)
        return
      }
      onCreated(result.sessionId)
      onClose()
    })
  }

  return (
    <Dialog label={t('detail.sessionNewTitle')} onClose={onClose} title={t('detail.sessionNewTitle')} portal>
      <form
        className={css.modalForm}
        onSubmit={event => { event.preventDefault(); submit() }}
      >
        {/* The ONE scroll region of the dialog: the fields scroll, the header
            and the 创建/取消 footer stay pinned (see .modal / .modalScroll). */}
        <div className={css.modalScroll}>
          <p className={css.detailHint}>{t('detail.sessionNewHint')}</p>
          {partial !== undefined && <p className={css.detailHint}>{partial}</p>}
          {error !== undefined && <p className={css.formError}>{error}</p>}
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('detail.sessionNewTitleLabel')}</span>
            <input
              className={css.input}
              value={title}
              placeholder={t('detail.sessionNewTitlePlaceholder')}
              onChange={event => { setTitle(event.target.value) }}
            />
            <span className={css.fieldHint}>{t('detail.sessionNewTitleHint')}</span>
          </label>
          <RunConfigFields value={config} onChange={setConfig} controller={controller} />
        </div>

        <footer className={css.modalFooter}>
          <Button onClick={onClose}>
            {t('new.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {t('detail.sessionNewSubmit')}
          </Button>
        </footer>
      </form>
    </Dialog>
  )
}
