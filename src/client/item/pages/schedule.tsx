/**
 * The agenda: a SEQUENCE, not a set of buckets.
 *
 * A grid would need a time of day to give a row a place on an axis, and this
 * model has none — inventing 「09:00」 for a bare date and then drawing it is a
 * lie the reader has to learn to ignore. So the day is the structure and the
 * rows are flat inside it, and the page answers one question: what is next, and
 * when.
 *
 * THE TWO CONTAINERS AT THE END, both NAMED rather than absent. A row whose
 * earliest start has not arrived is a GATE, not a due date, and a row with no
 * date at all is a TRAY, not a row; showing either inside today's sequence would
 * be claiming they are due today. A reader who cannot see where a row went
 * assumes it was lost, and an absence is exactly what they cannot see.
 *
 * AN EMPTY SECTION SAYS ITS NAME AND ITS ZERO, and nothing else. It used to add
 * 「这一天没有排事。」 underneath, which is the same fact in lighter ink — and a
 * week whose empty days are spelled out one sentence per bucket is a page of
 * sentences rather than a calendar. It also cost the page its centre: the eye
 * goes to the first section that HAS something in it, which is not necessarily
 * today, so an empty day dressed as a heading is a heading with nothing under it.
 */
import { scheduleBucketsOf, type ScheduleBucketId } from '../../../core/item-view.ts'
import { t, isEnglish } from '../../locales.ts'
import { formatItemDate } from '../model.ts'
import { BUCKET_LABEL, type ItemPageProps } from './page-props.ts'
import css from '../item.module.css'

export function SchedulePage(props: ItemPageProps) {
  const { items, query, prefs } = props
  const english = isEnglish()
  const buckets = scheduleBucketsOf(items, query, props.matchCtx, prefs.sort)

  return (
    <div className={css.itemAgenda}>
      {buckets.map(bucket => {
        // The two buckets that answer a DIFFERENT question get their own named
        // containers, and their own explanation of why they are not in the
        // sequence. Both explanations disappear when the bucket is empty: a hint
        // under a zero is a paragraph about nothing.
        if (bucket.id === 'gated') {
          if (bucket.items.length === 0) return null
          return (
            <section key={bucket.id} className={css.itemGatedFold}>
              <h2 className={css.itemGatedFoldHead}>
                {t(BUCKET_LABEL.gated ?? 'item.bucket.later')}
                <span className={css.itemGroupCount}>{bucket.items.length}</span>
              </h2>
              <p className={css.itemHint}>{t('item.gated.hint')}</p>
              <div className={css.itemGatedFoldList}>
                <ul className={css.itemList}>{props.renderRows(bucket.items)}</ul>
              </div>
            </section>
          )
        }
        if (bucket.id === 'undated') {
          return (
            <section key={bucket.id} className={css.itemNoDateTray}>
              <h2 className={css.itemNoDateTrayLabel}>
                {t(BUCKET_LABEL.undated ?? 'item.bucket.later')}
                <span className={css.itemGroupCount}>{bucket.items.length}</span>
              </h2>
              {bucket.items.length > 0 && <p className={css.itemHint}>{t('item.noDate.hint')}</p>}
              {bucket.items.length > 0 && (
                <div className={css.itemAgendaList}>
                  <ul className={css.itemList}>{props.renderRows(bucket.items)}</ul>
                </div>
              )}
            </section>
          )
        }
        return (
          <section key={bucket.id as ScheduleBucketId} className={css.itemAgendaDay}>
            <h2 className={css.itemGroupHead}>
              <span className={css.itemGroupToggle}>
                {t(BUCKET_LABEL[bucket.id] ?? 'item.bucket.later')}
                <span className={css.itemGroupCount}>{bucket.items.length}</span>
              </span>
              {bucket.day !== undefined && (
                <span className={css.itemAgendaDayLabel}>{formatItemDate(bucket.day, english)}</span>
              )}
            </h2>
            {bucket.items.length > 0 && (
              <div className={css.itemAgendaList}>
                <ul className={css.itemList}>{props.renderRows(bucket.items)}</ul>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
