/**
 * Add-existing-session picker: the touch/keyboard equivalent of dragging a
 * native session from the sidebar onto the task's session drop zone. Lists
 * every host session the task is not already bound to (the board's own
 * catalog — the same rows the '@' menu falls back to), tap one to bind it as
 * an added source (persisted, additive, instantly reconciled — exactly the
 * drag's effect). Nested inside the detail dialog, so it portals to the board
 * box and its body is the single `.modalScroll` scroller (the panel geometry
 * contract).
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Dialog } from './Dialog.tsx'
import { Icon } from './ui.tsx'

export function AddSessionModal({ controller, task, onClose }: {
  controller: BoardController
  task: TaskRecord
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  // Every session already RELATED to the task (binds, execution rounds, the
  // refine session, live linked members) never shows as a candidate — binding a
  // second time is a no-op the list should not offer. One derivation (the
  // controller's related set), not a hand-rolled subset that missed the refine
  // session and offered to re-bind it.
  const bound = controller.relatedSessionIdSet(task)
  const needle = query.trim().toLowerCase()
  const rows = controller.referenceSessionCatalog()
    .filter(row => !bound.has(row.sessionId))
    // An ARCHIVED session is not offered: the card's rows skip archived
    // conversations, so binding one would add a source that can never show on
    // the card — a silent no-op dressed as an action. The archive set is
    // recoverable (设置 → 已归档会话), and the session appears here by itself
    // once it is back. Same gate as the session-rule picker: what the card can
    // show is what can be chosen.
    .filter(row => controller.sessionAvailability(row.sessionId) !== 'archived')
    .filter(row => needle === '' || row.label.toLowerCase().includes(needle) || row.sessionId.toLowerCase().includes(needle))
    .slice(0, 50)

  const pick = (sessionId: string): void => {
    controller.addTaskSource(task.id, { kind: 'session', sessionId })
    onClose()
  }

  return (
    <Dialog title={t('detail.addSessionTitle')} label={t('detail.addSessionTitle')} onClose={onClose} portal>
      <div className={css.modalScroll}>
        <input
          className={css.input}
          type="text"
          value={query}
          placeholder={t('detail.addSessionSearch')}
          aria-label={t('detail.addSessionSearch')}
          onChange={event => { setQuery(event.target.value) }}
        />
        {rows.length === 0 ? (
          <p className={css.detailText}>{t('detail.addSessionEmpty')}</p>
        ) : (
          <ul className={css.addSessionList}>
            {rows.map(row => (
              <li key={row.sessionId}>
                <button
                  type="button"
                  className={css.addSessionRow}
                  onClick={() => { pick(row.sessionId) }}
                >
                  <Icon name="link" className={css.sessionRowIcon} />
                  <span className={css.addSessionLabel} title={row.sessionId}>{row.label}</span>
                  <Icon name="arrowRight" className={css.addSessionChevron} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
