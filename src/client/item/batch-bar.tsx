/**
 * The batch bar: what the reader does to several rows at once.
 *
 * WHY IT IS A BAR AND NOT SIX BUTTONS ON EVERY ROW. A row that carries a
 * control it usually does not need is a row that pays for it on every screen
 * and every read, and six such controls is a toolbar drawn six times. One bar,
 * drawn only while something is held, puts the decision once — and the decision
 * is a decision ABOUT the holding, not about any one row.
 *
 * **EVERY ACTION HERE IS THE WRITE THE SINGLE-ROW MENU MAKES**, handed the same
 * patch through the same `core/item-transitions` function, so 「批量标为受阻」
 * and 「这一条标为受阻」 cannot drift apart and so the model, which does the same
 * thing one row at a time, is describing what actually happens. The product's own
 * line covers this: the interface is many rows, the model is one row and a
 * receipt, and they are the same act.
 *
 * **THE ASK IS NARROWER THAN THE BATCH, AND SAYS SO.** Only a row hanging off a
 * board card has a session to hand the question to, so a batch containing rows
 * without one does not silently skip them: the bar says which part can be asked.
 * A batch that quietly did less than it appeared to is worse than one that says
 * so.
 *
 * **NOTHING HERE IS A NEW WRITE.** Status, priority and the due date are fields
 * the row menu already edits; the bar is the same edit applied to a list of
 * identities. There is no batch-only field and no batch-only rule, which is what
 * keeps the action catalogue the only description of what can be done.
 */
import type { ItemPriority, ItemStatus } from '../../core/item.ts'
import { t } from '../locales.ts'
import { Button, Segmented } from '../board/ui.tsx'
import { Tickbox } from './tickbox.tsx'
import css from './item.module.css'

export interface ItemBatchBarProps {
  readonly count: number
  /** Whether every row the reader can see is held — what the select-all box draws. */
  readonly allPicked: boolean
  /** Hold every visible row, or release them all. `visible`, not 「everything」:
   *  the panel computes it, so a box that ticked past the filter is impossible. */
  readonly onPickAll: (on: boolean) => void
  /** Apply one patch to every held row. */
  readonly onMark: (status: ItemStatus) => void
  readonly onPriority: (priority: ItemPriority) => void
  readonly onDueToday: () => void
  /** How many of the held rows can be handed to a session, and a way to do it. */
  readonly askable: number
  readonly onAsk: () => void
  /** Put the held rows back where they were, one gesture. */
  readonly onRemove: () => void
  readonly onDone: () => void
}

export function ItemBatchBar(props: ItemBatchBarProps) {
  const n = String(props.count)
  return (
    <div className={css.itemBatch} role="group" aria-label={t('item.batch.count', { n })}>
      {/* The count leads, because it is the only number here and every action
          below it means 「these n」. The select-all box rides beside it: the same
          16px box the armed rows wear, ticking exactly the set the bar can act
          on. An EMPTY screen is 「all held」 vacuously and the panel does not
          render the bar at all in that case, so the box is only ever drawn where
          there is something it can reach. */}
      <div className={css.itemBatchLead}>
        <Tickbox
          checked={props.allPicked}
          label={t('item.batch.all')}
          onToggle={() => props.onPickAll(!props.allPicked)}
        />
        <p className={css.itemBatchCount}>{t('item.batch.count', { n })}</p>
      </div>
      <div className={css.itemBatchActions}>
        <Segmented
          ariaLabel={t('item.field.status')}
          value=""
          options={[
            { value: 'open', label: t('item.status.open') },
            { value: 'blocked', label: t('item.status.blocked') },
            { value: 'done', label: t('item.status.done') },
          ]}
          onChange={next => { if (next !== '') props.onMark(next as ItemStatus) }}
        />
        {/* THE SAME CONTROL THE STATUS QUESTIONS USE, because it is the same
            KIND of question: pick one tier out of four, act, and the bar keeps
            no selected value. A native dropdown was the bar's one control this
            stylesheet does not draw the shape of — and, worse, the same page
            answered 「这一个的档位」 with chips and 「这一批的档位」 with a
            platform menu. */}
        <Segmented
          ariaLabel={t('item.batch.priority')}
          value=""
          options={[
            { value: 'urgent', label: t('item.priority.urgent') },
            { value: 'high', label: t('item.priority.high') },
            { value: 'normal', label: t('item.priority.normal') },
            { value: 'low', label: t('item.priority.low') },
          ]}
          onChange={next => { if (next !== '') props.onPriority(next as ItemPriority) }}
        />
        <Button variant="ghost" size="sm" onClick={props.onDueToday}>{t('item.batch.due')}</Button>
        {/* Disabled rather than hidden when nothing in the holding can be asked:
            the control stays where the reader's eye already is, and the sentence
            under the bar is what says why it cannot be pressed. */}
        <Button variant="ghost" size="sm" disabled={props.askable === 0} onClick={props.onAsk}>
          {t('item.ask')}
        </Button>
        <Button variant="dangerGhost" size="sm" onClick={props.onRemove}>{t('item.menu.delete')}</Button>
        <Button variant="ghost" size="sm" onClick={props.onDone}>{t('item.batch.done')}</Button>
      </div>
      {props.askable < props.count && (
        <p className={css.itemBatchNote}>{t('item.batch.askOne', { n })}</p>
      )}
    </div>
  )
}
