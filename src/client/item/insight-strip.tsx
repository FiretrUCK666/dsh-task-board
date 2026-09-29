/**
 * The overview: FIVE tiles, on ONE line, always.
 *
 * THIS IS THE PAGE'S VISUAL CENTRE, and it is the only thing on this surface
 * allowed to hold the reader's first glance. Everything else is stepped down
 * from it — the header is one 16px title in the corner, the rail and the filter
 * bar are third-ink rows of pills, the fact line is 12px, the ref is 11px — so
 * that the eye lands on the numbers first and the words second. A page where
 * everything is the same size has no centre, and a centre is what turns a list
 * of rows into a workbench: the reader learns how the work stands before they
 * read a single title.
 *
 * WHY FIVE, AND WHY FOUR OF THEM ARE THE GROUPS. The four group tiles read
 * `itemGroupCountsOf`, which is ALWAYS four tiers and does not read the
 * finished switch: a breakdown whose denominator answered to a control the
 * reader could not see was a summary that changed on its own. The fifth tile is
 * the overdue count, which is a CROSS-CUT rather than a bucket — a row can be
 * overdue and in any of the other four — so it overlaps them by design, and an
 * earlier note here claimed the five add up to the list total. That is false the
 * moment two of them overlap, and it is the kind of false that survives review
 * because it sounds like arithmetic. THEY ARE NOT A PARTITION and nothing here
 * may pretend otherwise.
 *
 * WHICH IS WHY THE DENOMINATOR IS THE UNFINISHED COUNT AND NOT THE LIST. A bar
 * measures what the reader still OWES, so its denominator is what they still owe
 * — `itemInsightOf`'s `total`, the live rows. Measured against the whole
 * document, a 30% bar would be largely made of finished rows nobody has any
 * further action on, and the bar would be flattering the backlog. The line under
 * the strip SAYS the denominator out loud, because a bar whose denominator is
 * invisible is a bar with no unit — and that silence is a defect this page has
 * already committed once, when the first version of this strip was four lines of
 * bare numbers in the detail pane saying nothing about what they counted.
 *
 * WHY ONE LINE, ON A 390px SCREEN, WITHOUT SHRINKING ANYTHING. Five tiles at
 * 342px of usable width is 68px each, and the longest label (「已完成」) is about
 * 33px at 11px — so it fits, as long as the tracks are FIXED rather than
 * content-sized. Wrapping is the failure to avoid, not because five rows of one
 * tile is ugly but because a wrapped row reads as 「three and two」: two sets, two
 * questions, and the reader has to decide which set they care about before they
 * have read either. The yield when a track is too tight is a shorter track and a
 * clipped LABEL — never a smaller font, never a hidden tile, never a second line.
 *
 * FOUR METERS AND ONE PLAIN NUMBER, and the fifth is the finished group. The
 * meters answer one question — how much of the work still open does this account
 * for — and a finished row is not part of the work still open, so it has no share
 * of the denominator the caption names. It therefore carries no track at all,
 * which is why the caption can promise a single 「out of what」 and be believed.
 * The tiles are a grid row, so the four metered ones set the height and the fifth
 * simply has the space where its bar would have been.
 */
import { itemInsightOf, type ItemQuery, type ItemStatusView } from '../../core/item-view.ts'
import type { ItemRecord } from '../../core/item.ts'
import { t, type TaskBoardKey } from '../locales.ts'
import { isFacetOn, withFacetToken, type ItemFacetId } from './facets.ts'
import css from './item.module.css'

const GROUP_LABEL: Readonly<Record<ItemStatusView, TaskBoardKey>> = {
  inProgress: 'item.group.inProgress',
  open: 'item.group.open',
  blocked: 'item.group.blocked',
  done: 'item.group.done',
}

/** The token each group tile writes. Derived status included: it is filterable. */
const GROUP_TOKEN: Readonly<Record<ItemStatusView, string>> = {
  inProgress: 'status:inProgress',
  open: 'status:open',
  blocked: 'status:blocked',
  done: 'status:done',
}

/** The four groups, in reading order, then the cross-cut. */
const TILE_ORDER: readonly ItemStatusView[] = ['inProgress', 'open', 'blocked', 'done']

export interface ItemInsightStripProps {
  readonly items: readonly ItemRecord[]
  /** The four group counts, always four tiers, never read from the switch. */
  readonly counts: Readonly<Record<ItemStatusView, number>>
  readonly now: number
  /** The parsed search box, so a tile lights up for a filter typed by hand. */
  readonly query: ItemQuery
  /** Write a filter. The same editor the facet chips use. */
  readonly onSearch: (next: string) => void
  /** Turn the finished group on, so a filter for it has anything to match. */
  readonly onShowDone: (on: boolean) => void
  readonly showDone: boolean
}

/** One tile: a number, a label under it on the same left edge, and a hairline. */
function Tile(props: {
  readonly label: string
  readonly value: number
  /** This tile's share of what the reader still owes, 0..1. Drives the 2px meter. */
  readonly share: number
  /**
   * Which ink the FIGURE wears.
   *
   * `plain` is the absence of a tone, and it is written out rather than left to a
   * default so that 「nothing is late」 is a decision at the call site: the only
   * caller that can report an overdue count is also the only one that knows
   * whether there is one, and a default would quietly put a red zero back on the
   * page for every reader whose list happens to be in good order.
   */
  readonly tone?: 'plain' | 'over'
  readonly pressed: boolean
  readonly onClick: () => void
  /**
   * Whether this tile's number is a share of WHAT IS OWED at all.
   *
   * The finished group is the one tile that is not, and it is worth being explicit
   * about why: the four meters answer a single question — how much of the work
   * still open does this account for — and a row the reader has already finished
   * is not part of that work. Its count over the owed total is a fraction of
   * nothing. A strip where the rule is applied uniformly to all five prints a
   * number the caption under it contradicts in the same breath, and the caption is
   * the only thing making the other four checkable.
   */
  readonly metered?: boolean
}) {
  return (
    <button
      type="button"
      className={css.itemTile}
      aria-pressed={props.pressed}
      onClick={props.onClick}
    >
      <span className={css.itemTileValue} data-tone={props.tone ?? 'plain'}>{props.value}</span>
      <span className={css.itemTileLabel}>{props.label}</span>
      {/* A share of zero draws an EMPTY track, never a hairline at 0%: a meter
          that looks filled by a hair is a meter claiming more than it has. And a
          tile with no share of the owed draws no track at all — the row is a grid,
          so the four metered tiles set the height and this one simply has the
          space where its bar would have been. */}
      {props.metered !== false && (
        <span className={css.itemTileBar} aria-hidden="true">
          <span className={css.itemTileBarFill} style={{ inlineSize: `${Math.round(Math.min(1, Math.max(0, props.share)) * 100)}%` }} />
        </span>
      )}
    </button>
  )
}

export function ItemInsightStrip(props: ItemInsightStripProps) {
  const insight = itemInsightOf(props.items, props.now)
  const overdueCount = insight.tiles.find(tile => tile.id === 'overdue')?.count ?? 0
  // The denominator is the UNFINISHED count, read from the same derivation the
  // overdue number comes from — so the bar and the figure above it can never be
  // out of step. `insight.total` is stated in the caption below the strip rather
  // than left implicit, because an unstated denominator is an unlabelled bar.
  const owed = insight.total
  const share = (count: number): number => (owed === 0 ? 0 : count / owed)

  /** The strip is the page's first filter too: a number a reader cannot act on
   *  is a scoreboard, and a scoreboard on a personal list rewards opening the
   *  app rather than finishing anything. Every tile writes into the same search
   *  box the facet chips write into, and reads its pressed state out of the same
   *  parse — so a tile and its chip are one control in two places, and a filter
   *  typed by hand lights the tile up with no second bookkeeping. */
  const toggle = (facet: ItemFacetId, key: string, token: string, alsoShowDone = false): void => {
    const next = !isFacetOn(props.query, facet, key)
    props.onSearch(withFacetToken(props.query.text, token, next))
    if (alsoShowDone) props.onShowDone(next)
  }

  return (
    <section className={css.itemOverview} aria-label={t('item.insight.title')}>
      <div className={css.itemOverviewTiles} role="group">
        {TILE_ORDER.map(status => (
          <Tile
            key={status}
            label={t(GROUP_LABEL[status])}
            value={props.counts[status]}
            share={share(props.counts[status])}
            pressed={isFacetOn(props.query, 'status', status)}
            onClick={() => toggle('status', status, GROUP_TOKEN[status], status === 'done')}
            metered={status !== 'done'}
          />
        ))}
        <Tile
          label={t('item.due.overdueShort')}
          value={overdueCount}
          share={share(overdueCount)}
          // THE TONE IS A FACT ABOUT THE READER'S WORK, NOT ABOUT THE FIELD.
          // It used to be `tone="over"` unconditionally, which is the one thing
          // the colour cannot mean: with nothing overdue the strip still drew a
          // red `0`, so an empty list — the first thing a reader with a fresh
          // install sees — opened on a red number. A broken promise is red; the
          // absence of one is not, and a count of zero is the good news.
          tone={overdueCount > 0 ? 'over' : 'plain'}
          pressed={isFacetOn(props.query, 'date', 'overdue')}
          onClick={() => toggle('date', 'overdue', 'has:overdue')}
        />
      </div>
      {/* THE DENOMINATOR, SAID OUT LOUD. Every bar above is a share of the rows
          the reader has not finished, and a bar whose denominator is invisible
          is a bar with no unit — it measures something, just not anything the
          reader can check. The number is a decomposition of the list total the
          header already shows, so stating it introduces no count of its own. */}
      <p className={css.itemOverviewBase}>{t('item.insight.base', { n: String(owed) })}</p>
    </section>
  )
}
