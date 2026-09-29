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
import { formatItemDate, parseItemDate, toItemDateField } from './model.ts'
import type { ItemPatch } from '../../core/item-transitions.ts'
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
function Field(props: { readonly label: string; readonly children: React.ReactNode; readonly wide?: boolean }) {
  return (
    <label className={css.itemField} data-wide={props.wide === true ? '' : undefined}>
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
  /** The most recently touched rows, for the same state. `id` travels WITH the
   *  row: the short number is a name to read, never an address, and picking a
   *  row by its label is how a list ends up selecting the wrong one. */
  readonly recent: readonly { readonly id: string; readonly ref: string; readonly title: string }[]
  /**
   * One field write. The patch's shape is the shared writer's, so a field the
   * model ruled derived or forbidden cannot be written from here even by
   * accident: the type is derived from the same verdict table the writer uses.
   */
  readonly onEdit: (edit: ItemPatch) => void
  readonly onToggleStep: (stepId: string) => void
  readonly onRemove: () => void
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
        {/* NOT the head's sentence again. The head already says 「还没选中任何一条」
            — it has to, because an empty box with a bottom border and nothing
            above it reads as a page that failed to load — and saying it twice in
            one column is one fact told twice, which is the same reason the count
            `0` does not get a second sentence under it. What the body adds is
            the one thing the head cannot say: what to DO about it. */}
        <p className={css.itemHint}>{t('item.detail.emptyHint')}</p>
        <h4 className={css.itemEmptyRecentHead}>{t('item.detail.emptyCounts')}</h4>
        {/* EVERY BUCKET, NAMED, ALWAYS FOUR — including the finished one, and
            whatever the finished switch is doing. These are four words and four
            numbers with nothing around them: the old version framed each one in
            its own filled cell, and four framed cells in a column that has no
            other job is a second, smaller dashboard competing with the overview
            strip for the same answer. Plain rows say the same thing and cost
            nothing. The set does not move with the switch — a tally that answered
            to a control the reader cannot see is a tally that changes on its
            own. */}
        <dl className={css.itemEmptyTally}>
          {props.counts.map(count => (
            <div key={count.label} className={css.itemEmptyTallyRow}>
              <dt className={css.itemEmptyTallyLabel}>{count.label}</dt>
              <dd className={css.itemEmptyTallyValue}>{count.value}</dd>
            </div>
          ))}
        </dl>
        <h3 className={css.itemEmptyRecentHead}>{t('item.detail.emptyRecent')}</h3>
        <div className={css.itemEmptyRecent}>
          {props.recent.length === 0
            ? <p className={css.itemHint}>{t('item.detail.emptyNone')}</p>
            : (
              <ul className={css.itemList}>
                {props.recent.map(row => (
                  <li key={row.id} className={css.itemRecentRow}>
                    <button type="button" className={css.itemRecentRowMain} onClick={() => props.onPickRecent(row.id)}>
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
          {/* Wide, and the reason is the row it terminates. Five fields in a
              two-column grid is rows of 2 / 2 / 1, and the odd one left a
              382 × 53px hole at the end of the section a reader scans FOR
              DATES. The hard deadline is the one date that turns a row red, so
              giving it the full width says so with the geometry instead of with
              a sentence — and it fills the row rather than stretching anything
              else. Named with `data-wide` rather than `:last-child`, because
              「the last child of the grid」 is a position and this is a field. */}
          <Field label={t('item.field.hardDueAt')} wide>
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
          {/* ONE PRESS, NO QUESTION. The delete used to replace itself with a
              second danger button plus a 「cancel」 whose label was borrowed from
              the clear-filter string — so the way OUT of a delete read as the way
              out of a search, and a reversible action was made to feel
              irreversible by a dialog-shaped pause. What replaced it is one press
              and a receipt carrying one undo, which is also the only shape that
              can be honest: the receipt has to state the thirty-day window and
              where the row is found afterwards, because once the undo is spent
              that archive is the whole of what is left. */}
          <Button variant="dangerGhost" onClick={props.onRemove}>{t('item.menu.delete')}</Button>
        </div>
        {english === false && item.hardDueAt !== undefined && item.hardDueAt < Date.now() && (
          <p className={css.itemHint}>{formatItemDate(item.hardDueAt, english)}</p>
        )}
      </section>
    </>
  )
}
