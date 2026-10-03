/**
 * The three numbers this page answers, and each one is a door.
 *
 * WHY THREE AND NOT A ROW OF TILES. A tile is a label with a number in it; a
 * question is a label with a number and a way to ask. These three are the questions
 * a reader opens the list with — 「哪些欠着、哪些卡住了、今天该做哪几件」 — and
 * each one is answered by FILTERING, so each one is a control. A number the reader
 * can press is a number they can act on; a number they can only read is furniture.
 *
 * WHY THE NUMBERS ARE COUNTED WHERE THEY ARE FILTERED. Pressing 「落后 3」 must
 * leave exactly three rows on screen. Both sides are asked of the same predicate
 * over the same document in the same place, so they cannot come apart — the defect
 * this replaces was exactly that: a tile counting rows the reader could not
 * filter their way to, and no error anywhere.
 *
 * WHY A BAR UNDER EACH NUMBER. Proportion is a fact the number alone cannot say:
 * 「3 落后」 means nothing until you know it is 3 of 40. The bar is a READER and
 * not a colour — it wears neutral ink, because the number above it has already
 * said everything this tile has to say and a second emphasis would be a page with
 * two loudest things.
 */
import { t, type TaskBoardKey } from '../locales.ts'
import css from './item.module.css'

/** One tile: what it counts, and the query that asks for exactly those rows. */
export interface ItemStat {
  /** Stable, so React can keep the node and a test can name the tile. */
  readonly id: string
  /** A NOUN, with no number in it — the count is drawn beside it, 28px. */
  readonly label: TaskBoardKey
  /** How many rows this question has an answer to. */
  readonly n: number
  /** The whole document, as the denominator for the bar. */
  readonly total: number
  /** The filter token, written into the SAME query string every other filter uses. */
  readonly token: string
}

export interface ItemStatsProps {
  readonly stats: readonly ItemStat[]
  /** Write the token into the query — or take it off, when it is already on. */
  readonly onToggle: (token: string) => void
  /** Which tokens the current query already carries. */
  readonly on: ReadonlySet<string>
}

/**
 * The band — and it renders at ZERO.
 *
 * It used to filter `stat.n > 0` and return nothing when every count was 0, on the
 * reasoning that 「a row of three zeros has no row to point at」. Measured on a
 * real document that reasoning is wrong in a way the reader pays for: the band
 * vanishes, and **a page with nothing to do looks exactly like a page whose
 * triage strip stopped rendering** — which is not a distinction anyone can make
 * from the screen, and which is why 「感觉根本不知道这个任务清单是干嘛用的」 was
 * reported at all.
 *
 * **「被问到而答案是零」和「这个问题根本不存在」是两件事** — that is already why the
 * page rail prints `0` on an empty page rather than hiding the tab. The band is the
 * same question asked about the reader's own work, so it answers the same way.
 *
 * Zero here is also the GOOD news, and good news deserves the same pixels as bad:
 * three zeros at the top of the page are the panel saying 「没有一件卡在你手上」,
 * and hiding them spends the reader's most reliable signal to deliver silence.
 * @param props - the three questions, their counts and the toggle.
 * @returns the band.
 */
export function ItemStats(props: ItemStatsProps) {
  const stats = props.stats
  if (stats.length === 0) return null
  return (
    <div className={css.itemStats}>
      {stats.map(stat => {
        const live = props.on.has(stat.token)
        return (
          <button
            key={stat.id}
            type="button"
            className={css.itemStat}
            // The ratio is written up as a custom property, so the stylesheet knows
            // only 「how full」 and never has to know what it is full OF.
            style={{ '--item-stat-fill': `${stat.total === 0 ? 0 : Math.round((stat.n / stat.total) * 100)}%` } as React.CSSProperties}
            aria-pressed={live}
            aria-label={t(stat.label, { n: String(stat.n) })}
            onClick={() => props.onToggle(stat.token)}
          >
            <span className={css.itemStatLabel}>{t(stat.label)}</span>
            <span className={css.itemStatValue}>{stat.n}</span>
            <span className={css.itemStatBar} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
