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
 * **CONSECUTIVE EMPTY DAYS SHARE ONE LINE.** Measured on the shipped fixture at
 * 412px: 「今天 0」「明天 0」「本周稍后 0」「以后 0」 each took a full block — a
 * heading, a centred date and a hairline apiece — and **four of them ate about
 * 400px of a 1100px screen while holding no rows at all.**
 *
 * An empty day is a blank square on the map, and a blank square still takes up
 * room. PRODUCT has said this for a while（「空节整个不画」/「压成一行摘要」）and it
 * WAS implemented — for the list page's four status groups. The agenda's days go
 * through different code, so the same rule was held on one page and lost on
 * another. **One rule, two implementations, one of them forgotten.**
 *
 * Collapsing hides nothing: every day's name and its own zero are still on the
 * line, in order, and still readable.
 */
import { scheduleBucketsOf, type ScheduleBucketId } from '../../../core/item-view.ts'
import { t, isEnglish } from '../../locales.ts'
import { formatItemDate } from '../model.ts'
import { BUCKET_LABEL } from '../labels.ts'
import type { ItemPageProps } from './page-props.ts'
import { ItemTable } from '../item-table.tsx'
import css from '../item.module.css'

type Bucket = ReturnType<typeof scheduleBucketsOf>[number]

/** The two buckets that answer a different question, so they are not days. */
function isOwnQuestion(id: string): boolean {
  return id === 'gated' || id === 'undated'
}

/** An empty DAY. The other two have their own handling and their own names. */
function isEmptyDay(bucket: Bucket): boolean {
  return !isOwnQuestion(bucket.id) && bucket.items.length === 0
}

export function SchedulePage(props: ItemPageProps) {
  const { items, query, prefs } = props
  const english = isEnglish()
  const buckets = scheduleBucketsOf(items, query, props.matchCtx, prefs.sort)

  /** Runs of empty days, and the real sections, in the order they were read. */
  const blocks: React.ReactNode[] = []
  let empties: Bucket[] = []

  const flush = (): void => {
    if (empties.length === 0) return
    blocks.push(<EmptyDays key={`empty-${empties.map(b => b.id).join('-')}`} days={empties} />)
    empties = []
  }

  for (const bucket of buckets) {
    if (isEmptyDay(bucket)) { empties = [...empties, bucket]; continue }
    flush()
    blocks.push(<AgendaSection key={bucket.id} bucket={bucket} english={english} renderRows={props.renderRows} />)
  }
  flush()

  return <div className={css.itemAgenda}>{blocks}</div>
}

/**
 * A run of days with nothing in them, as ONE line.
 *
 * It reuses the list page's `.itemEmptyGroups` family rather than inventing a
 * second one: 「四个连续的 0 行组并成一行摘要」is one rule, and two rules that say
 * the same thing in two stylesheets is how the agenda lost it in the first place.
 */
function EmptyDays({ days }: { readonly days: readonly Bucket[] }): React.ReactNode {
  return (
    <p className={css.itemEmptyGroups} role="group">
      {days.map((day, at) => (
        <span key={day.id} style={{ display: 'contents' }}>
          {at > 0 && <span className={css.itemEmptyGroupSep} aria-hidden="true">·</span>}
          <span className={css.itemEmptyGroup}>
            {t(BUCKET_LABEL[day.id as ScheduleBucketId])}
            <span className={css.itemEmptyGroupCount}>{day.items.length}</span>
          </span>
        </span>
      ))}
    </p>
  )
}

/**
 * One section that HAS something in it.
 *
 * The two that answer a different question get their own named containers and
 * their own explanation of why they are not in the sequence. Both explanations
 * disappear when the bucket is empty: a hint under a zero is a paragraph about
 * nothing — and an empty bucket never reaches here anyway, since `EmptyDays` took
 * the days and `gated` returns null.
 */
function AgendaSection({ bucket, english, renderRows }: {
  readonly bucket: Bucket
  readonly english: boolean
  readonly renderRows: ItemPageProps['renderRows']
}): React.ReactNode {
  if (bucket.id === 'gated') {
    if (bucket.items.length === 0) return null
    return (
      <section className={css.itemGatedFold}>
        <h2 className={css.itemGatedFoldHead}>
          {t(BUCKET_LABEL.gated)}
          <span className={css.itemSectionCount}>{bucket.items.length}</span>
        </h2>
        <p className={css.itemHint}>{t('item.gated.hint')}</p>
        <div className={css.itemGatedFoldList}>
          <ItemTable rows={renderRows(bucket.items, false)} empty='' />
        </div>
      </section>
    )
  }

  if (bucket.id === 'undated') {
    return (
      <section className={css.itemNoDateTray}>
        <h2 className={css.itemNoDateTrayLabel}>
          {t(BUCKET_LABEL.undated)}
          <span className={css.itemSectionCount}>{bucket.items.length}</span>
        </h2>
        {bucket.items.length > 0 && <p className={css.itemHint}>{t('item.noDate.hint')}</p>}
        {bucket.items.length > 0 && (
          <div className={css.itemAgendaList}>
            <ItemTable rows={renderRows(bucket.items, false)} empty='' />
          </div>
        )}
      </section>
    )
  }

  /* 一节两行：名字与它的条数，然后是这一天的日期。
   *
   * 曾经是一个 `<h2>` 里套一个只装「名字 + 数字」的 `<span>`——那个盒子
   * 什么都不排版（`.itemGroupToggle` 在这一轮的样式表里已经不存在了），
   * 而它套着的目的是把两个词并排放进一个能排的盒子里。现在 `<h2>` 自己
   * 就是那一行，内层盒子去掉，剩下的那一行有了一个自己的名字。
   *
   * 日期是**另一行**，因为它是这一节读出来的那句话（`.itemAgendaDayLabel`
   * 自带那条分隔线与行距），把它塞进 `<h2>` 里会让一条线挂在两样东西
   * 中间，而它标的是「这一节的行从这里开始」。 */
  return (
    <section className={css.itemAgendaDay}>
      <h2 className={css.itemAgendaDayHead}>
        {t(BUCKET_LABEL[bucket.id as ScheduleBucketId])}
        <span className={css.itemSectionCount}>{bucket.items.length}</span>
      </h2>
      {bucket.day !== undefined && (
        <p className={css.itemAgendaDayLabel}>{formatItemDate(bucket.day, english)}</p>
      )}
      {bucket.items.length > 0 && (
        <div className={css.itemAgendaList}>
          <ItemTable rows={renderRows(bucket.items, false)} empty='' />
        </div>
      )}
    </section>
  )
}
