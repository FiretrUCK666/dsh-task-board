/**
 * Command palette (Ctrl/Cmd+K): filter input + arrow/enter list over the six
 * board commands. One grammar with the notification dialog (same Dialog,
 * same row styles — a palette is a list with a filter on top, not a new
 * visual language). Closes on run; Escape travels the shared stack (the
 * Dialog owns it — never double-handled here).
 */
import { useMemo, useState } from 'react'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Dialog } from './Dialog.tsx'
import { filterCommands, type PaletteCommand } from './commands.ts'

export function CommandPalette({ commands, onClose, onRun }: {
  commands: readonly PaletteCommand[]
  onClose: () => void
  /** Runs the command AND closes the palette (the caller closes first when the command opens another surface). */
  onRun: (command: PaletteCommand) => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const rows = useMemo(() => filterCommands(commands, query), [commands, query])
  const current = rows[Math.min(index, Math.max(0, rows.length - 1))]
  return (
    <Dialog title={t('board.palette')} label={t('board.palette')} onClose={onClose} portal>
      <div className={css.modalScroll}>
        <input
          className={css.input}
          type="search"
          aria-label={t('board.paletteFilter')}
          placeholder={t('board.paletteFilter')}
          value={query}
          onChange={event => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex(i => (rows.length === 0 ? 0 : (i + 1) % rows.length))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex(i => (rows.length === 0 ? 0 : (i - 1 + rows.length) % rows.length))
            } else if (event.key === 'Enter' && current !== undefined) {
              event.preventDefault()
              onRun(current)
            }
          }}
          autoFocus
        />
        {rows.length === 0 ? (
          <p className={css.detailText}>{t('board.paletteEmpty')}</p>
        ) : (
          <ul className={css.notifyList}>
            {rows.map((command, i) => (
              <li key={command.id}>
                <button
                  type="button"
                  className={css.notifyRow}
                  data-active={i === Math.min(index, Math.max(0, rows.length - 1)) ? '' : undefined}
                  onClick={() => { onRun(command) }}
                  onMouseEnter={() => { setIndex(i) }}
                >
                  <span className={css.notifyTask}>{command.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
