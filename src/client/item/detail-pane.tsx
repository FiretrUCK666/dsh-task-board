/**
 * The detail: the same component, in two places.
 *
 * Level 1 of the two this panel has, and there is no level 3 — a third level
 * inside a column is where a reader loses their place entirely. The wide band
 * puts it in a side pane beside the list; the narrow band puts it in the row.
 * SAME component, SAME five sections, SAME spacing; only the box differs, and
 * neither placement writes its own width. The field grid answers to its own
 * container (`dsh-tb-item-detail`) rather than to the panel, because at 1080px
 * the side pane is 296px wide and at 2380px it is 816px — one answer taken from
 * the surface would be wrong in both.
 *
 * It is never a dialog. `boardBox()` resolves to the FIRST board box, so a
 * layer opened from this panel would anchor itself to the board — a different
 * surface — and a layer that floats over another surface is not this surface's
 * layer.
 */
import type { ItemRecord, ItemPriority, ItemStatus } from '../../core/item.ts'
import { ITEM_PRIORITIES, ITEM_STATUSES } from '../../core/item.ts'
import { isEnglish, t } from '../locales.ts'
import { Button } from '../board/ui.tsx'
import { Chip } from '../board/Chip.tsx'
import { formatItemDate, parseItemDate, toItemDateField, type ItemEdit } from './model.ts'
import css from './item.module.css'

const PRIORITY_LABEL: Readonly<Record<ItemPriority, 'item.priority.low' | 'item.priority.normal' | 'item.priority.high' | 'item.priority.urgent'>> = {
  low: 'item.priority.low',
  normal: 'item.priority.normal',
  high: 'item.priority.high',
  urgent: 'item.priority.urgent',
}
const STATUS_LABEL: Readonly<Record<ItemStatus, 'item.status.open' | 'item.status.blocked' | 'item.status.done'>> = {
  open: 'item.status.open',
  blocked: 'item.status.blocked',
  done: 'item.status.done',
}

const ORIGIN_LABEL: Readonly<Record<ItemRecord['origin']['source'], 'item.origin.human' | 'item.origin.ai' | 'item.origin.import'>> = {
  human: 'item.origin.human',
  ai: 'item.origin.ai',
  import: 'item.origin.import',
}

/** One labelled field. The label is the control's name, not decoration. */
function Field(props: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <label className={css.itemField}>
      <span className={css.itemFieldLabel}>{props.label}</span>
      {props.children}
    </label>
  )
}

export interface ItemDetailProps {
  /** The row on show, or `undefined` before anything is picked. */
  readonly item: ItemRecord | undefined
  /** The board cards a row may hang off, already titled. */
  readonly cards: readonly { readonly id: string; readonly title: string }[]
  /** The per-group counts, for the pane's "before you pick" state. */
  readonly counts: readonly { readonly label: string; readonly value: number }[]
  /** The most recently touched rows, for the same state. */
  readonly recent: readonly { readonly ref: string; readonly title: string }[]
  readonly onEdit: (edit: ItemEdit) => void
  readonly onToggleStep: (stepId: string) => void
  readonly onRemove: () => void
  /** True while the reader has confirmed the delete. */
  readonly confirmingRemove: boolean
  readonly onConfirmRemove: () => void
  readonly onCancelRemove: () => void
  readonly onPickRecent: (id: string) => void
}

/**
 * The detail, or the pane's designed "nothing picked yet" state.
 * @param props - the row, the board's cards and the hand-offs.
 * @returns the five sections, or the empty state.
 */
export function ItemDetail(props: ItemDetailProps) {
  const { item } = props
  if (item === undefined) {
    return (
      <div className={css.itemDetailEmpty}>
        <h3 className={css.itemSectionTitle}>{t('item.detail.emptyTitle')}</h3>
        <p className={`${css.itemHint} ${css.itemEmptyHint}`}>{t('item.detail.emptyHint')}</p>
        <h4 className={css.itemEmptyRecentHead}>{t('item.detail.emptyCounts')}</h4>
        <div className={css.itemEmptyCounts}>
          {props.counts.map(count => (
            <div key={count.label} className={css.itemEmptyCount}>
              <span className={css.itemEmptyCountValue}>{count.value}</span>
              <span className={css.itemEmptyCountLabel}>{count.label}</span>
            </div>
          ))}
        </div>
        <h3 className={css.itemEmptyRecentHead}>{t('item.detail.emptyRecent')}</h3>
        <div className={css.itemEmptyRecent}>
          {props.recent.length === 0
            ? <p className={css.itemHint}>{t('item.detail.emptyNone')}</p>
            : (
              <ul className={css.itemList}>
                {props.recent.map(row => (
                  <li key={row.ref} className={css.itemRow}>
                    <button type="button" className={css.itemRowMain} onClick={() => props.onPickRecent(row.ref)}>
                      <span className={css.itemRef}>{row.ref}</span>
                      <span className={css.itemTitle}><span className={css.itemTitleText}>{row.title}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    )
  }

  const english = isEnglish()
  return (
    <>
      <section className={css.itemSection}>
        <h3 className={css.itemSectionTitle}>{t('item.section.content')}</h3>
        <Field label={t('item.field.title')}>
          <input
            className={css.itemInput}
            value={item.title}
            onChange={event => props.onEdit({ title: event.target.value })}
          />
        </Field>
        <Field label={t('item.field.body')}>
          <textarea
            className={css.itemInput}
            rows={4}
            value={item.body}
            onChange={event => props.onEdit({ body: event.target.value })}
          />
        </Field>
        {item.steps.length > 0 && (
          <ul className={css.itemStepList}>
            {item.steps.map(step => (
              <li key={step.id} className={css.itemStep}>
                <label>
                  <input
                    type="checkbox"
                    checked={step.done}
                    onChange={() => props.onToggleStep(step.id)}
                  />
                  <span data-done={step.done ? '' : undefined}>{step.text}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={css.itemSection}>
        <h3 className={css.itemSectionTitle}>{t('item.section.notes')}</h3>
        <Field label={t('item.field.notes')}>
          <textarea
            className={css.itemInput}
            rows={3}
            value={item.notes}
            onChange={event => props.onEdit({ notes: event.target.value })}
          />
        </Field>
      </section>

      <section className={css.itemSection}>
        <h3 className={css.itemSectionTitle}>{t('item.section.plan')}</h3>
        {/* A property GRID, not a stack of `flex: 1 1 120px` fields: the same
            three dates in a 296px pane and an 816px pane need different
            answers, and the grid reads its own box. */}
        <div className={css.itemFieldGrid}>
          <Field label={t('item.field.status')}>
            <select
              className={css.itemInput}
              value={item.status}
              onChange={event => props.onEdit({ status: event.target.value as ItemStatus })}
            >
              {ITEM_STATUSES.map(status => <option key={status} value={status}>{t(STATUS_LABEL[status])}</option>)}
            </select>
          </Field>
          <Field label={t('item.field.priority')}>
            <select
              className={css.itemInput}
              value={item.priority}
              onChange={event => props.onEdit({ priority: event.target.value as ItemPriority })}
            >
              {ITEM_PRIORITIES.map(priority => <option key={priority} value={priority}>{t(PRIORITY_LABEL[priority])}</option>)}
            </select>
          </Field>          <Field label={t('item.field.startsAfter')}>
            <input
              type="date"
              className={css.itemInput}
              value={toItemDateField(item.startsAfter)}
              onChange={event => props.onEdit({ startsAfter: parseItemDate(event.target.value) })}
            />
          </Field>
          <Field label={t('item.field.dueAt')}>
            <input
              type="date"
              className={css.itemInput}
              value={toItemDateField(item.dueAt)}
              onChange={event => props.onEdit({ dueAt: parseItemDate(event.target.value) })}
            />
          </Field>
          <Field label={t('item.field.hardDueAt')}>
            <input
              type="date"
              className={css.itemInput}
              value={toItemDateField(item.hardDueAt)}
              onChange={event => props.onEdit({ hardDueAt: parseItemDate(event.target.value) })}
            />
          </Field>
        </div>
        {/* Said only when the two readings can actually disagree. The control
            writes the STORED status while the group header shows the derived
            one, so a row hanging off a running card reads 「进行中」 in the
            list and 「待办」 here. Without a line saying why, that is a panel
            contradicting itself; with it, it is a documented distinction. */}
        {item.taskId !== undefined && item.status === 'open' && (
          <p className={css.itemHint}>{t('item.status.derived')}</p>
        )}
      </section>

      <section className={css.itemSection}>
        <h3 className={css.itemSectionTitle}>{t('item.section.link')}</h3>
        <Field label={t('item.field.tags')}>
          <input
            className={css.itemInput}
            value={item.tags.join('、')}
            placeholder={t('item.field.tagsHint')}
            onChange={event => props.onEdit({ tags: event.target.value.split(/[、,]/).map(tag => tag.trim()).filter(tag => tag !== '') })}
          />
        </Field>
        {item.tags.length > 0 && (
          <div className={css.itemTagRow}>
            {item.tags.map(tag => <span key={tag} className={css.itemTag}>{tag}</span>)}
          </div>
        )}
        <Field label={t('item.field.taskId')}>
          <select
            className={css.itemInput}
            value={item.taskId ?? ''}
            onChange={event => props.onEdit({ taskId: event.target.value === '' ? undefined : event.target.value })}
          >
            <option value="">{t('item.field.noCard')}</option>
            {props.cards.map(card => <option key={card.id} value={card.id}>{card.title}</option>)}
          </select>
        </Field>
        {item.taskId !== undefined && (
          <p className={css.itemHint}>
            {props.cards.some(card => card.id === item.taskId)
              ? t('item.field.linked', { title: props.cards.find(card => card.id === item.taskId)?.title ?? '' })
              : t('item.field.cardGone')}
          </p>
        )}
      </section>

      <section className={css.itemSection}>
        <h3 className={css.itemSectionTitle}>{t('item.section.danger')}</h3>
        <div className={css.itemOriginRow}>
          <Chip kind={item.origin.source === 'ai' ? 'warn' : 'muted'}>{t(ORIGIN_LABEL[item.origin.source])}</Chip>
        </div>
        <div className={css.itemDangerZone}>
          <p className={css.itemDangerHint}>{t('item.danger.hint')}</p>
          {/* Two steps in place, never a dialog: the action is reversible for
              thirty days, and a modal asking to confirm a reversible action is
              friction with no decision behind it. */}
          {props.confirmingRemove
            ? (
              <div className={css.itemDeleteConfirm}>
                <Button variant="dangerGhost" onClick={props.onConfirmRemove}>{t('item.menu.delete')}</Button>
                <Button variant="ghost" onClick={props.onCancelRemove}>{t('item.state.clearFilter')}</Button>
              </div>
            )
            : <Button variant="dangerGhost" onClick={props.onRemove}>{t('item.menu.delete')}</Button>}
        </div>
        {english === false && item.hardDueAt !== undefined && item.hardDueAt < Date.now() && (
          <p className={css.itemHint}>{formatItemDate(item.hardDueAt, english)}</p>
        )}
      </section>
    </>
  )
}
