/**
 * What a page body is given, and why it is a contract rather than a convenience.
 *
 * THE PANEL IS AN ASSEMBLY LAYER. It owns the state every page shares — the
 * document, the clock, the view preferences, the selection — and it owns the
 * frame around them: the header, the receipt, the workbench, the detail rail.
 * What each page owns is its own body, and the only thing that crosses the line
 * is this bundle.
 *
 * So the bundle is written down. The alternative — passing fifteen positional
 * arguments, or letting a page reach back into the panel's state through a
 * closure — is how a 900-line file happens: the moment a page can read the
 * panel's internals, the page can also WRITE them, and then extracting it stops
 * being a refactor and becomes a migration. Everything a page may touch is in
 * this type, and everything else is off limits by construction.
 *
 * TWO OF THESE ARE FUNCTIONS RATHER THAN VALUES, and that is the load-bearing
 * part. `renderRows` and `renderDetail` are handed in rather than imported,
 * because the row and the detail are shared by all three pages and are the two
 * things a page must NOT grow its own copy of: a second row component is how the
 * three pages end up disagreeing about what a row says, which is the exact
 * failure the whole `core/item-view.ts` layer exists to prevent.
 */
import type { ReactNode } from 'react'
import type { ItemRecord } from '../../../core/item.ts'
import type { ItemSort } from '../../../core/item-sort.ts'
import type { ItemQuery, ItemMatchContext } from '../../../core/item-view.ts'
import type { TaskStatus } from '../../../core/tasks.ts'
import type { ItemViewPrefs } from '../view-prefs.ts'
import type { ItemRowLineProps } from '../row-line.tsx'

/* The word tables are NOT here. `group`, `priority`, `status`, `bucket` and
   `triage` are five vocabularies the model owns, and a file that passes state
   around is not the place that should also be the one naming them: they used to
   be, and the copies that drifted out of it were the ones with no owner. They
   live in `../labels.ts`, one closed table each, and this module is only the
   bundle a page body is handed. */

/** What every page body receives. */
export interface ItemPageProps {
  /** Every row in the document. Pages filter; none of them owns it. */
  readonly items: readonly ItemRecord[]
  /** The reading clock, passed down so two rows cannot disagree about a day. */
  readonly now: number
  /** 看板的栏，按卡片 id 索引——挂卡的行在哪一栏由它回答。 */
  readonly cards: ReadonlyMap<string, TaskStatus>
  /** The parsed search box. The ONLY filter on this surface. */
  readonly query: ItemQuery
  /**
   * The matching context — clock, staleness threshold and the board's live
   * state — as ONE value, built once by the panel and handed down.
   *
   * It is passed rather than rebuilt because a page that assembles its own would
   * be a second place where a threshold is decided, and the threshold is the
   * difference between a row being reported as neglected and not. Two
   * thresholds on one page is a page that answers 「what needs you」 two ways on
   * the same morning.
   */
  readonly matchCtx: ItemMatchContext & { readonly cards: ReadonlyMap<string, TaskStatus> }
  /** The view preferences, and the one way to change them. */
  readonly prefs: ItemViewPrefs
  readonly choose: (next: Partial<ItemViewPrefs>) => void
  /** The one row renderer, shared by all three pages — and it hands over PROPS
   *  rather than elements, because the table draws its own rows: the head and the
   *  body must agree on seven tracks, and a page that wrapped rows in its own
   *  `<ul>` would be a second table without a head. */
  readonly renderRows: (list: readonly ItemRecord[], picking: boolean, armed: boolean) => readonly ItemRowLineProps[]
  /**
   * Whether this PAGE has a batch surface, and therefore whether every one of its
   * rows carries a pickbox.
   *
   * A PAGE FACT AND NOT A MODE, and the name is older than the meaning. It used to
   * carry 「the reader is holding several rows」, which made the control's existence
   * depend on a step the reader had to discover first: the pickbox column was 44px
   * of nothing across the whole list, and the only way in was `X`. PRODUCT puts
   * multi-select on the list page alone, so the question is 「which page am I on」 —
   * one answer per page rather than one per moment.
   *
   * THE NAME STAYS `picking`, because that is the word the pages and the shared
   * contract already speak — `renderRows(list, picking)`, read literally by the
   * source gate in `card-contract.spec.ts` — and 「can this row be picked」 is what
   * the flag has always meant. Renaming it would have moved one word through four
   * files and a stylesheet owner to fix a word that was not wrong.
   */
  readonly picking: boolean
  /** The ordering the reader chose, so the table knows whether a day heading is a
   *  true statement about the rows under it. `now` is already here, so the two
   *  arrive together. */
  /** Whether the archive drawer is open, and how it reports being left.
   *
   *  A VALUE, not a signal, and it is owned by the panel. It was a counter bumped
   *  by the rail — which meant the rail could open the drawer only on the one page
   *  that drew it, and that nothing except the drawer's own button could close it:
   *  pressing any other rail row left it standing. A place is a place, so 「am I in
   *  it」 is one boolean the whole panel can read, set and clear. */
  readonly archiveOpen: boolean
  /** Called when the reader leaves the archive by its own control. */
  readonly onCloseArchive: () => void
  /** Called when the host says a purge erased (or had already erased) a row, so
   *  the replica can settle the tombstone locally instead of waiting for a
   *  broadcast. The revision is the host's own; the replica's never-backwards
   *  guard decides what to do with it. */
  readonly onPurged?: (id: string, revision: number) => void
  /**
   * Called when the host says a RESTORE brought a row back, so the live list can
   * hold it in this tick instead of waiting for the next poll.
   *
   * The mirror image of {@link onPurged}, and it exists for the same measurement
   * taken from the other side: a restore is a host operation the panel asked for
   * directly, so this device's own commit frame never comes back through the
   * replica — the row would reappear in the list up to thirty seconds later,
   * which a reader reports as the button not working.
   */
  readonly onRestored?: (row: ItemRecord) => void
  readonly sort: ItemSort
  /**
   * The batch bar, or nothing.
   *
   * A NODE, not the selection state, for the same reason `renderRows` is a
   * function and not a row: the panel owns the holding and the writes (they are
   * the same writes the row menu makes, and a second implementation of
   * 「标为受阻」 is a second answer to a question the model also answers), while
   * the page owns only the slot. Two of the three pages are not allowed the slot
   * at all — the inbox has no batch — and they get that by never being handed
   * one, which is cheaper and more honest than a page deciding to ignore it.
   */
  readonly batch?: ReactNode
  /** Whether the batch is armed, and the page hands that mode onward with the
   *  page constant: a page that can batch passes both, a page that cannot passes
   *  `picking: false` and the mode never reaches its rows. */
  readonly armed?: boolean
  readonly onArm?: (on: boolean) => void
  readonly allPicked?: boolean
  readonly onPickAll?: (on: boolean) => void
  /** Whether there is anything on screen that could be selected. */
  readonly selectable?: boolean
  /** Whether the reader is looking at the list without a filter. */
  readonly filtering: boolean
}
