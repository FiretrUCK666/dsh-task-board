/**
 * Tag manager: the board's label catalog editor — create (name + palette or
 * custom color), rename, re-color, delete (with a warning that it is removed
 * from every card). The catalog is the single source of the labels, so every
 * change here updates all cards at once (rewrite the label, not each card).
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { TAG_PALETTE } from '../../core/tags.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Dialog } from './Dialog.tsx'
import { Button, ColorSwatches } from './ui.tsx'

/** The label-catalog dialog. */
export function TagManager({ controller, onClose }: { controller: BoardController; onClose: () => void }) {
  const tags = controller.listTags()
  const usage = new Map<string, number>()
  for (const task of controller.getSnapshot().tasks) {
    for (const id of task.tags ?? []) usage.set(id, (usage.get(id) ?? 0) + 1)
  }
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(TAG_PALETTE[0])
  const [editing, setEditing] = useState<Record<string, string | undefined>>({})
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>(undefined)

  const create = (): void => {
    const name = newName.trim()
    if (name === '') return
    controller.createTag(name, newColor)
    setNewName('')
  }

  return (
    <Dialog label={t('tags.title')} onClose={onClose} title={t('tags.title')}>
      {/* Create a new tag: name + color. */}
      <div className={css.tagNew}>
        <input
          className={css.input}
          value={newName}
          placeholder={t('tags.newName')}
          aria-label={t('tags.newName')}
          onChange={event => { setNewName(event.target.value) }}
          onKeyDown={event => { if (event.key === 'Enter') create() }}
        />
        <ColorSwatches value={newColor} onChange={setNewColor} />
        <Button size="sm" variant="primary" disabled={newName.trim() === ''} onClick={create}>
          {t('tags.add')}
        </Button>
      </div>

      {tags.length === 0 ? (
        <p className={css.detailHint}>{t('tags.empty')}</p>
      ) : (
        <ul className={css.tagList}>
          {tags.map(tag => {
            const editColor = editing[tag.id] ?? tag.color
            return (
              <li key={tag.id} className={css.tagRow}>
                <span className={css.tagRowHead}>
                  <span className={css.tagRowDot} style={{ background: tag.color }} aria-hidden="true" />
                  <input
                    className={`${css.input} ${css.tagNameInput}`}
                    value={editing[tag.id] ?? tag.name}
                    aria-label={t('tags.rename')}
                    onChange={event => { setEditing(current => ({ ...current, [tag.id]: event.target.value })) }}
                    onBlur={() => {
                      const name = editing[tag.id]?.trim()
                      setEditing(current => { const next = { ...current }; delete next[tag.id]; return next })
                      if (name !== undefined && name !== '' && name !== tag.name) controller.renameTag(tag.id, name)
                    }}
                  />
                  <span className={css.tagUsage}>{t('tags.usage', { n: String(usage.get(tag.id) ?? 0) })}</span>
                  {confirmDelete === tag.id ? (
                    <span className={css.tagConfirmDelete}>
                      <Button size="sm" variant="danger" onClick={() => { controller.deleteTag(tag.id); setConfirmDelete(undefined) }}>
                        {t('tags.deleteConfirm')}
                      </Button>
                      <Button size="sm" onClick={() => { setConfirmDelete(undefined) }}>{t('tags.cancel')}</Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={css.rowHide}
                      title={t('tags.deleteTitle')}
                      onClick={() => { setConfirmDelete(tag.id) }}
                    >
                      {t('tags.delete')}
                    </button>
                  )}
                </span>
                <ColorSwatches
                  value={editColor}
                  onChange={color => {
                    setEditing(current => ({ ...current, [tag.id]: color }))
                    controller.recolorTag(tag.id, color)
                  }}
                />
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}