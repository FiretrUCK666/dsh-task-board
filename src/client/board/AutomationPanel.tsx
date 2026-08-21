/**
 * AutomationPanel: the board header's "自动化" overview. One place to see AND
 * manage BOTH automatic-driving kinds of every automated task — the
 * task-level schedule (cron / 完成后接续) and the session-level rules.
 *
 * It is the SAME editor as the task detail's 自动化 disclosure: each task card
 * shows its identity + one live summary line, and expanding it renders the
 * shared AutomationEditor verbatim — so the board has every capability the
 * detail has (including 完成后接续), and no surface can drift into a reduced
 * second editor. Cards start collapsed: the overview stays a scan-able list,
 * and everything is editable in place (即改即生效, the same gates —
 * chainUnlimited — move with the editor).
 */
import { useEffect, useState } from 'react'
import { type BoardController } from '../../core/controller.ts'
import { automationTasksOf } from '../../core/automation.ts'
import { type TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Dialog } from './Dialog.tsx'
import { AutomationEditor, scheduleSummary } from './automation-ui.tsx'
import { Button, Icon } from './ui.tsx'
import { STATUS_KEY } from './status.ts'

/** One automated task in the overview: identity row + live summary + expand
 *  into the shared full editor (the exact component the detail renders). */
function AutomationTaskCard({ controller, task, onClose }: {
  controller: BoardController
  task: TaskRecord
  onClose: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const schedule = task.schedule
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
      {/* One expandable summary row — THE one summary grammar (scheduleSummary).
          The editor opens expanded (default collapsed keeps the overview tidy). */}
      <button
        type="button"
        className={css.autoTaskExpand}
        aria-expanded={expanded}
        title={summary}
        onClick={() => { setExpanded(value => !value) }}
      >
        <Icon name="chevronDown" className={`${css.autoTaskChevron}${expanded ? ` ${css.autoTaskChevronOpen}` : ''}`} />
        <span className={css.autoTaskSummary}>{summary}</span>
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

  // Tasks carrying ANY automation config (armed or disarmed schedule, or at
  // least one session rule) — everything manageable from the board.
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
