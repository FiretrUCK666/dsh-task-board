/**
 * The agenda: a SEQUENCE, not a set of buckets.
 *
 * A grid would need a time of day to give a row a place on an axis, and this
 * model has none — inventing 「09:00」 for a bare date and then drawing it is a
 * lie the reader has to learn to ignore. So the day is the structure and the
 * rows are flat inside it, and the page answers one question: what is next, and
 * when.
 *
 * ── 一页只有一种节头，而它是**两个页面共用**的那一枚 ──────────────────────────
 *
 * 节头是 `GroupHead`（记号 + 词 + 条数 + 那个日期），与清单页的日分段是**同一个
 * 元件**：同一个形状、同一个记号槽、同一条对齐律。两个内联版本在这里付过的账写在
 * `group-head.tsx` 的文件头里。
 *
 * ── 零行的节不占一节 ────────────────────────────────────────────────────────
 *
 * 「截止已过 0」曾经是一枚独立药丸加一条说明，而它下面一行都没有——**一个没有内容的
 * 节，读者读到的是一句关于空的话**。所以零行的节一律降级成安静行里的一个名字加一个 0
 * （`QuietLine`）：零仍然被说到（「今天 0」是一句真话），但它不再占一节的地方。
 * 到了那一天，行自己会排进按天的节里。
 *
 * ── 一句解释按需出现，不常驻 ────────────────────────────────────────────────
 *
 * 三句话（还没开始为什么在这里、没定日期为什么排不进任何一天、安静行说的是什么）
 * 平时都不在屏上：它们各自挂在**它要解释的那个东西**上，由一枚 `InfoMark` 按钮叫出来
 * （悬停是偷看，按下/聚焦是真开——触屏没有悬停，见 `group-head.tsx`）。
 * 常驻的版本在屏幕上是一面文字墙，而这三句话都是读者**问出来之后**才有用的话。
 *
 * ── 小字不上画布 ────────────────────────────────────────────────────────────
 *
 * 面板坐在画布上（没有外壳卡，见 `DESIGN.md`），而画布是一家之言的**照片**。行是卡、
 * 卡不透明，所以行上的小字有底；节头与说明没有——**需要读的字要么有面，要么退到
 * 第二层墨并抬到 12px**：节头是药丸（有面），说明是 12px/第二层墨、限宽成一句读得下去
 * 的话。
 */
import { isAgendaItem, itemMatches } from '../../../core/item-view.ts'
import { scheduleBucketsOf, type ScheduleBucketId } from '../../../core/item-view.ts'
import type { ItemSort } from '../../../core/item-sort.ts'
import { t, isEnglish } from '../../locales.ts'
import { STATUS_KEY } from '../../board/status.ts'
import { formatItemDate } from '../model.ts'
import { BUCKET_LABEL } from '../labels.ts'
import { MARK_OF_BUCKET, InfoMark } from '../marks.tsx'
import { GroupHead, useNote } from '../group-head.tsx'
import type { ItemPageProps } from './page-props.ts'
import { nothingToShowOf } from './nothing-to-show.ts'
import { ItemTable } from '../item-table.tsx'
import css from '../item.module.css'

type Bucket = ReturnType<typeof scheduleBucketsOf>[number]

/**
 * 一节的骨架：**头、它那句说明、它的行**，按这个顺序。
 *
 * 顺序是承重的：说明必须紧跟在头后面（悬停偷看的那条规则按这个顺序读），也必须排在行
 * **之前**——一句话夹在头和它的行之间读得通，挂在行的后面就是在说别的节。
 */
function Block(props: {
  readonly head: React.ReactNode
  readonly noteId: string
  readonly open: boolean
  readonly note: string | undefined
  readonly children: React.ReactNode
}): React.ReactNode {
  return (
    <section className={css.itemAgendaBlock} data-note={props.open ? '' : undefined}>
      {props.head}
      {props.note !== undefined && <p className={css.itemNote} id={props.noteId}>{props.note}</p>}
      {props.children}
    </section>
  )
}

/**
 * One section that HAS something in it.
 *
 * 三类节（一天、一扇还没开的门、一个没日期的盘子）共用同一枚头，差别只有两样：
 * 记号（`MARK_OF_BUCKET`）与那句按需出现的说明。**没有行的节到不了这里**——它在安静行
 * 里当一个 0。
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
  const note = useNote(t('item.group.why'))
  const word = t(BUCKET_LABEL[bucket.id as ScheduleBucketId])
  /* 只有这两节有话说：它们不在按天的序列里，读者会问「为什么」。按天的节不需要解释
     ——它的名字就是那一天。 */
  const explain = bucket.id === 'gated' ? t('item.gated.hint') : bucket.id === 'undated' ? t('item.noDate.hint') : undefined

  return (
    <Block
      noteId={note.id}
      open={note.open}
      note={explain}
      head={(
        <GroupHead
          as="heading"
          size="section"
          mark={MARK_OF_BUCKET[bucket.id as ScheduleBucketId]}
          word={word}
          count={String(bucket.items.length)}
          {...(bucket.day === undefined ? {} : { when: formatItemDate(bucket.day, english) })}
          {...(explain === undefined ? {} : { note })}
        />
      )}
    >
      <div className={css.itemAgendaList}>
        <ItemTable rows={renderRows(bucket.items, false, false)} empty='' now={now} sort={sort} dayHeads={false} />
      </div>
    </Block>
  )
}

/**
 * 「没排进上面那些节的东西」是**一行**，不是一节加一段话。
 *
 * 它说的是两件事：哪几天是空的，以及有几条被留下（已完成的不再排日程；刚记下、还没被读
 * 第二遍的还没进任何一天）。两件事都在这一行里数出来，而**为什么**落在它自己的
 * `InfoMark` 里——一句话属于它要解释的那一行，而不是页尾的一段小字。
 */
function QuietLine({ entries, noteText, label }: {
  readonly entries: readonly { readonly word: string; readonly count: string }[]
  readonly noteText: string
  readonly label: string
}): React.ReactNode {
  const note = useNote(label)
  return (
    <div className={css.itemQuiet} data-note={note.open ? '' : undefined}>
      <div className={css.itemEmptyGroups} role="group" data-note-hover="">
        {entries.map((entry, at) => (
          <span key={entry.word} className={css.itemEmptyGroup}>
            {at > 0 && <span className={css.itemEmptyGroupSep} aria-hidden="true">·</span>}
            <span className={css.itemEmptyWord}>{entry.word}</span>
            <i className={css.itemGroupCount}>{entry.count}</i>
          </span>
        ))}
        <button
          type="button"
          className={css.itemGroupWhy}
          aria-expanded={note.open}
          aria-controls={note.id}
          aria-label={note.label}
          onClick={note.onToggle}
        >
          <InfoMark size={14} />
        </button>
      </div>
      <p className={css.itemNote} id={note.id}>{noteText}</p>
    </div>
  )
}

export function SchedulePage(props: ItemPageProps) {
  const { items, query, prefs } = props
  const english = isEnglish()
  const buckets = scheduleBucketsOf(items, query, props.matchCtx, prefs.sort, prefs.sortDesc)

  /* **这份日程没有列出全部行，所以它把自己差在哪说清。**
   *
   * 「3 条里只看见 2 条」是读者报上来的原话。两个排除都是有理由的（已完成是历史；
   * 刚记下、还没被读第二遍的一条属于收件，不属于任何一天），可**理由不在屏幕上**，
   * 于是屏幕上剩下的只有「少了一条」——而少了一条和丢了一条，在读者眼里是同一件事。
   * `isAgendaItem` 是那条判据，这里按它自己的两个子句数数，不另写一套条件。 */
  const live = items.filter(item => itemMatches(item, query, props.matchCtx))
  if (live.length === 0) {
    // **一条都没有时，画的是清单页那一个空态**：同一句话、同一个元件，问的是同一个
    // 函数。一个页面自己写一句「没有事项」，是同一份空文档的第二种说法。
    return <ItemTable rows={[]} empty={nothingToShowOf(items, query, props.now)} now={props.now} sort={props.sort} dayHeads={false} />
  }
  const leftOut = live.filter(item => !isAgendaItem(item))
  const done = leftOut.filter(item => item.status === 'done').length
  const inbox = leftOut.length - done

  const quiet: { word: string; count: string }[] = [
    ...buckets.filter(bucket => bucket.items.length === 0)
      .map(bucket => ({ word: t(BUCKET_LABEL[bucket.id as ScheduleBucketId]), count: String(bucket.items.length) })),
    ...(done === 0 ? [] : [{ word: t(STATUS_KEY.done), count: String(done) }]),
    ...(inbox === 0 ? [] : [{ word: t('item.agenda.inbox'), count: String(inbox) }]),
  ]

  return (
    <div className={css.itemAgenda}>
      {buckets.filter(bucket => bucket.items.length > 0).map(bucket => (
        <AgendaSection key={bucket.id} bucket={bucket} english={english} renderRows={props.renderRows} now={props.now} sort={props.sort} />
      ))}
      {quiet.length > 0 && <QuietLine entries={quiet} noteText={t('item.agenda.quietNote')} label={t('item.agenda.quietWhy')} />}
    </div>
  )
}
