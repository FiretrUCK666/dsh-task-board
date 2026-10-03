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
import type { ItemRecord, ItemPriority, ItemStatus, ItemStep } from '../../core/item.ts'
import { ITEM_PRIORITIES, ITEM_STATUSES } from '../../core/item.ts'
import type { ItemRowView } from '../../core/item-view.ts'
import { isEnglish, t } from '../locales.ts'
import { Button } from '../board/ui.tsx'
import { Chip } from '../board/Chip.tsx'
import { formatItemDate, parseItemDate, toItemDateField } from './model.ts'
import { PRIORITY_LABEL, STATUS_LABEL } from './labels.ts'
import { ItemSteps } from './step-editor.tsx'
import { addStep, moveStep, removeStep } from './steps.ts'
import type { ItemPatch } from '../../core/item-transitions.ts'
import css from './item.module.css'

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
  /**
   * The row on show AS ITS PROJECTION, or `undefined` before anything is picked.
   *
   * The projection and not the record, because the pane asks derived questions —
   * has this row's hard deadline passed — and a derived question answered from
   * the record is a SECOND derivation. It read `Date.now()` for the clock, which
   * is not the panel's clock: the panel owns a `now` that ticks while it is on
   * screen and is what every other date on this surface is drawn against, so the
   * one line in the pane that answered for itself could disagree with the row
   * above it, and it disagreed exactly at midnight — and could never disagree in
   * a test, because the bench's clock is fixed and a fresh `Date.now()` is not.
   *
   * The model already publishes the answer, on the same projection the row line
   * reads, so the pane and the row cannot answer differently. `item` is still
   * reachable as `view.item` for the fields the pane edits.
   */
  readonly view: ItemRowView | undefined
  /** The board cards a row may hang off, already titled. */
  readonly cards: readonly { readonly id: string; readonly title: string }[]
  /** The most recently touched rows, for the "before you pick" state. `id` travels WITH the
   *  row: the short number is a name to read, never an address, and picking a
   *  row by its label is how a list ends up selecting the wrong one. */
  readonly recent: readonly { readonly id: string; readonly ref: string; readonly title: string }[]
  /**
   * One field write. The patch's shape is the shared writer's, so a field the
   * model ruled derived or forbidden cannot be written from here even by
   * accident: the type is derived from the same verdict table the writer uses.
   */
  readonly onEdit: (edit: ItemPatch) => void
  /**
   * Write the WHOLE checklist back, through the panel's one writer.
   *
   * A list rather than four verbs, and the reason is that the step list is
   * REPLACED by design — the model reads it the same way. So 「加一步」 and
   * 「挪上去」 are two answers this pane computes with the shared pure functions
   * and hands over whole; the panel writes once. Four verbs here would be four
   * writes, and four writes are four chances for two devices to interleave into a
   * list neither of them meant.
   */
  readonly onEditSteps: (steps: ItemStep[]) => void
  /**
   * Bumped by the row menu's 「编辑步骤」, so the add field takes the caret.
   *
   * A COUNTER AND NOT A REF, for the reason the capture box's `focusRequest` is
   * one: the same press has to work twice, and a ref cannot tell the second press
   * from the first.
   */
  readonly stepsFocus?: number
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
  const { view } = props
  const item = view?.item
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
        {/* THE COUNTS ARE NOT HERE, and their absence is the design rather than a
            gap. The pane stands beside the list on the wide band, so the four
            figures this used to print here were on screen at the same moment as
            the four the overview strip prints at the top of that list — the same
            words, the same numbers, a hand's width apart. The design record settled
            it long ago: 「同一个数不许在两处各算一次」and 「四个数不在这里」.

            What the pane is for is the fields of ONE row. With nothing selected it
            has no fields, so its job is to be ready and to point at something: one
            sentence saying what to do, and the rows that were touched last, which
            are the shortest possible route back to work. A column answering a
            second question with a second copy of the first question's numbers is
            how a workbench turns into a dashboard. */}
        <h3 className={css.itemEmptyRecentHead}>{t('item.detail.emptyRecent')}</h3>
        <div className={css.itemEmptyRecent}>
          {props.recent.length === 0
            ? <p className={css.itemHint}>{t('item.detail.emptyNone')}</p>
            : (
              <ul className={css.itemRecentList}>
                {props.recent.map(row => (
                  <li key={row.id} className={css.itemRecentRow}>
                    <button type="button" className={css.itemRecentRowMain} onClick={() => props.onPickRecent(row.id)}>
                      <span className={css.itemRefChip}>{row.ref}</span>
                      <span className={css.itemRecentTitle}><span className={css.itemRecentTitleText}>{row.title}</span></span>
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
  /** Hand the whole list back to the one writer, as a fresh array it may keep. */
  const write = (next: readonly ItemStep[]): void => props.onEditSteps([...next])
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
        {/* 步骤是这一页唯一「能改顺序」的东西，所以编辑器就长在它本来被读到的
            地方：勾选框是原来的那一个，去掉与挪动是加在它旁边的三个控件，而
            「编辑步骤」那一项只是把读者送到这里并把光标放进输入框。

            四条手出边都是**整份清单**，不是四种算术：加减与排序住在 `steps.ts`
            的纯函数里，而这一层只负责把它们算好的答案交给面板，面板再走同一个
            共享写入口。清单的算法因此只有一个住处——一份在别处重写的「挪上去」
            就是一份会跟这里慢慢走偏的顺序。 */}
        <ItemSteps
          item={item}
          focusRequest={props.stepsFocus}
          onToggle={props.onToggleStep}
          onAdd={text => write(addStep(item.steps, item.id, text))}
          onRemove={stepId => write(removeStep(item.steps, stepId))}
          onMove={(stepId, by) => write(moveStep(item.steps, stepId, by))}
        />
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
        {item.hardDueAt !== undefined && view?.posture.kind === 'hardOverdue' && (
          <p className={css.itemHint}>{formatItemDate(item.hardDueAt, english)}</p>
        )}
      </section>
    </>
  )
}
