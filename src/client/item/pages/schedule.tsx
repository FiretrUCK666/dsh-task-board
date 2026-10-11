/**
 * The agenda: a SEQUENCE, not a set of buckets.
 *
 * A grid would need a time of day to give a row a place on an axis, and this
 * model has none — inventing 「09:00」 for a bare date and then drawing it is a
 * lie the reader has to learn to ignore. So the day is the structure and the
 * rows are flat inside it, and the page answers one question: what is next, and
 * when.
 *
 * ── 节一级的说法只有一种形状 ──────────────────────────────────────────────────
 *
 * 这一页上有五种「一节」：一天、一扇还没开的门、一个没日期的盘子、以及被压成一行的
 * 连续空日。上一版给它们画了**三种**样子（15/600 无底线、13/600 带发丝线、11px 的
 * 回执胶囊），而那张纸上的读者读到的不是「几种节」，是「同一页上几个不一样的东西」。
 * 所以现在是一枚药丸（`.itemAgendaHead`）加它下面一行说明（`.itemAgendaNote`）——
 * 与清单页日分段那枚药丸同一个形状词汇（同一个 `--item-fill`、同一个药丸圆角），
 * 只是这一页的药丸说的是**节**，那一页说的是**分段**。
 *
 * ── 小字不上画布 ──────────────────────────────────────────────────────────────
 *
 * 面板坐在画布上（没有外壳卡，见 `DESIGN.md`），而画布是一家之言的**照片**。行是卡、
 * 卡不透明，所以行上的小字有底；节头与说明没有——上一版的节名、两句说明、空日摘要与
 * 页尾全是 11px 的第三层墨，直接压在照片上。**需要读的字要么有面，要么退到第二层墨并
 * 抬到 12px**：这一页现在两条都做到了（药丸有面，说明 12px/第二层墨、并且限宽成一句
 * 可以读的话）。
 *
 * ── 连续的空白日期共用一行 ────────────────────────────────────────────────────
 *
 * Measured on the shipped fixture at 412px: 「今天 0」「明天 0」「本周稍后 0」「以后 0」each
 * took a full block — a heading, a centred date and a hairline apiece — and **four of them
 * ate about 400px of a 1100px screen while holding no rows at all.** 空白的一天是地图上的
 * 一格空白，而空白也占地方。压成一行，每一个名字与它自己的 0 仍然在那一行里、仍然按顺序
 * 读得出来——**压起来不等于藏起来**。
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

/**
 * 一节的那一行头：**名字 + 条数 +（有日期的时候）那个日期**。
 *
 * 三样东西合成一个形状，因为它们说的是同一件事——「这一节是这些」。它是一枚 `<h2>`：
 * 一块内容有一个名字，而屏幕阅读器要靠它跳节；形状是药丸，因为它按不动（按不动的东西
 * 不该长得像按钮）。
 * @param props - 这一节的名字、条数，以及它是不是一天（是的话带上那一天）。
 * @returns 那一行头。
 */
function AgendaHead(props: { readonly word: string; readonly count: number; readonly when?: string }): React.ReactNode {
  return (
    <h2 className={css.itemAgendaHead}>
      {/* 记号只有**一天**才画：它说的是「这一节是一天」。门与盘子不是一天，画上它就等于
          把「还没到」画成了一个日期——而那正是这一页不许做的事。 */}
      {props.when !== undefined && (
        <svg viewBox="0 0 13 13" width="9" height="9" aria-hidden="true"><rect x="1.5" y="2.6" width="10" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.1"></rect><path d="M1.5 5.6h10M4.2 1.2v2.6M8.8 1.2v2.6" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"></path></svg>
      )}
      {props.word}
      <i className={css.itemAgendaCount}>{props.count}</i>
      {props.when !== undefined && <span className={css.itemAgendaWhen}>· {props.when}</span>}
    </h2>
  )
}

export function SchedulePage(props: ItemPageProps) {
  const { items, query, prefs } = props
  const english = isEnglish()
  const buckets = scheduleBucketsOf(items, query, props.matchCtx, prefs.sort, prefs.sortDesc)

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
 * A run of days with nothing in them, as ONE statement.
 *
 * 它是**一枚药丸里的一句话**：名字与它自己的 0 交替出现，用 `·` 分开。上一版这行还带一条
 * 5px 的 SVG 界（「上面那段到此为止」），而那条线在照片上以 0.5 的透明度画出来等于没有
 * ——**一条看不见的线不是在说话，是在占地方**。药丸自己的形状已经把它和下面第一节分开了。
 * @param props - the empty days, in reading order.
 * @returns 那一枚药丸。
 */
function EmptyDays({ days }: { readonly days: readonly Bucket[] }): React.ReactNode {
  return (
    /* 它是 `div` 而不是 `<p>`：**本表开头那条 UA 重置**（`:where(.itemRoot) p { margin: 0 }`）
       的 specificity 是 (0,1,1)，赢过任何一条类名规则——于是 `<p>` 上的 margin 在真页面上
       一律算 0（量过：声明在、computed 是 0），而这一枚药丸**只能用 margin** 让出左沿
       （用 padding 会把它的底也一起推出去）。一组芯片本来也不是一段话，`role="group"`
       才是它本来的身份。 */
    <div className={css.itemEmptyGroups} role="group">
      {days.map((day, at) => (
        <span key={day.id} className={css.itemEmptyGroup}>
          {at > 0 && <span className={css.itemEmptyGroupSep} aria-hidden="true">·</span>}
          {t(BUCKET_LABEL[day.id as ScheduleBucketId])}
          <i className={css.itemAgendaCount}>{day.items.length}</i>
        </span>
      ))}
    </div>
  )
}

/**
 * One section that HAS something in it.
 *
 * The two that answer a different question get their own named containers and their own
 * explanation of why they are not in the sequence. Both explanations disappear when the
 * bucket is empty: a hint under a zero is a paragraph about nothing.
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
  const word = t(BUCKET_LABEL[bucket.id as ScheduleBucketId])

  if (bucket.id === 'gated') {
    if (bucket.items.length === 0) return null
    return (
      <section className={css.itemGatedFold}>
        <AgendaHead word={word} count={bucket.items.length} />
        <p className={css.itemAgendaNote}>{t('item.gated.hint')}</p>
        <div className={css.itemGatedFoldList}>
          <ItemTable rows={renderRows(bucket.items, false, false)} empty='' now={now} sort={sort} dayHeads={false} />
        </div>
      </section>
    )
  }

  if (bucket.id === 'undated') {
    return (
      <section className={css.itemNoDateTray}>
        <AgendaHead word={word} count={bucket.items.length} />
        {bucket.items.length > 0 && <p className={css.itemAgendaNote}>{t('item.noDate.hint')}</p>}
        {bucket.items.length > 0 && (
          <div className={css.itemAgendaList}>
            <ItemTable rows={renderRows(bucket.items, false, false)} empty='' now={now} sort={sort} dayHeads={false} />
          </div>
        )}
      </section>
    )
  }

  return (
    <section className={css.itemAgendaDay}>
      <AgendaHead
        word={word}
        count={bucket.items.length}
        when={bucket.day === undefined ? undefined : formatItemDate(bucket.day, english)}
      />
      {bucket.items.length > 0 && (
        <div className={css.itemAgendaList}>
          <ItemTable rows={renderRows(bucket.items, false, false)} empty='' now={now} sort={sort} dayHeads={false} />
        </div>
      )}
    </section>
  )
}
