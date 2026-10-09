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
import { isAgendaItem, itemMatches } from '../../../core/item-view.ts'
import { scheduleBucketsOf, type ScheduleBucketId } from '../../../core/item-view.ts'
import type { ItemSort } from '../../../core/item-sort.ts'
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
    blocks.push(<AgendaSection key={bucket.id} bucket={bucket} english={english} renderRows={props.renderRows} now={props.now} sort={props.sort} />)
  }
  flush()

  /* **这份日程没有列出全部行，所以它说清楚差在哪。**
   *
   * 「3 条里只看见 2 条」是读者报上来的原话。两个排除都是有理由的（已完成是历史；
   * 刚记下、还没被读第二遍的一条属于收件，不属于任何一天），可**理由不在屏幕上**，
   * 于是屏幕上剩下的只有「少了一条」——而少了一条和丢了一条，在读者眼里是同一件事。
   * `isAgendaItem` 是那条判据，这里按它自己的两个子句数数，不另写一套条件。 */
  const live = items.filter(item => itemMatches(item, query, props.matchCtx))
  const leftOut = live.filter(item => !isAgendaItem(item))
  const done = leftOut.filter(item => item.status === 'done').length
  const inbox = leftOut.length - done

  return (
    <div className={css.itemAgenda}>
      {blocks}
      {leftOut.length > 0 && (
        <p className={css.itemAgendaLeftOut}>
          {t('item.agenda.leftOut', { done: String(done), inbox: String(inbox) })}
        </p>
      )}
    </div>
  )
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
      {/* **一行摘要与下面的节之间要有一条界。** 读者在截图里点名过这一处：那行
          「今天 0 · 明天 0 · 本周稍后 0」与它下面第一个真的节之间只有空气，于是它
          读起来像下一个节的题头而不是上一段的收尾。一条发丝线就够——它说的是
          「上面那段到此为止」，而这正是空日摘要唯一需要说的话。
          画成 SVG 而不是 `border-block-end`：`preserveAspectRatio="none"` 让它铺满
          这一列而不必去猜宽度。
          **两端原来还各有一根 4px 的端刻，读者点名要删。** 那句「和本表其它分隔线
          同一支笔画」本来就不成立——全仓只有这一处画过端刻——而它落在这条**横贯整列**
          的线上时，两根竖线读起来是「这条线画到了边上」，不是「一段到此为止」。 */}
      <svg className={css.itemEmptyGroupsRule} viewBox="0 0 240 5" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 2.5h240" />
      </svg>
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
function AgendaSection({ bucket, english, renderRows, now, sort }: {
  readonly bucket: Bucket
  readonly english: boolean
  readonly renderRows: ItemPageProps['renderRows']
  /** The panel's clock and the reader's ordering, handed down so the tables this
   *  section draws can tell whether a day heading would be a true statement. */
  readonly now: number
  readonly sort: ItemSort
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
          <ItemTable rows={renderRows(bucket.items, false, false)} empty='' now={now} sort={sort} dayHeads={false} />
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
            <ItemTable rows={renderRows(bucket.items, false, false)} empty='' now={now} sort={sort} dayHeads={false} />
          </div>
        )}
      </section>
    )
  }

  /* 一节一行：**节名 + 条数 +（日节的）日期读法，站在同一条线上**。曾经是两行——
   * 一个 `<h2>` 说名字，一个 `<p>` 说日子，各自带一条线——读者读到的是两个题头
   * 摞在一起，而它们说的是同一天。一行说完，行下没有线（节与节之间靠空气）。
   *
   * 左侧那枚 9px 日历记号与清单页日分段药丸里的图标**同一条路径**：同一个「日」
   * 的画法，学一次就都认得。 */
  return (
    <section className={css.itemAgendaDay}>
      <h2 className={css.itemAgendaDayHead}>
        <svg viewBox="0 0 13 13" width="9" height="9" aria-hidden="true"><rect x="1.5" y="2.6" width="10" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.1"></rect><path d="M1.5 5.6h10M4.2 1.2v2.6M8.8 1.2v2.6" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"></path></svg>
        {t(BUCKET_LABEL[bucket.id as ScheduleBucketId])}
        <span className={css.itemSectionCount}>{bucket.items.length}</span>
        {bucket.day !== undefined && (
          <span className={css.itemAgendaDayDate}>· {formatItemDate(bucket.day, english)}</span>
        )}
      </h2>
      {bucket.items.length > 0 && (
        <div className={css.itemAgendaList}>
          <ItemTable rows={renderRows(bucket.items, false, false)} empty='' now={now} sort={sort} dayHeads={false} />
        </div>
      )}
    </section>
  )
}
