/**
 * What the reader chose about how the list LOOKS, remembered on this device.
 *
 * WHY IT IS LOCAL AND NOT IN THE DOCUMENT. These are the reader's habits, not
 * facts about their work: a row height, a page they were last on, which groups
 * they had folded away. Two devices disagreeing about a row height is not a
 * data conflict, and putting it in the shared document would make every device
 * a writer of a field nobody reads for anything but display. The document stays
 * the truth about WORK; this stays the truth about VIEWING it.
 *
 * WHY THE SEARCH TEXT IS NOT HERE. A remembered search is a filter the reader
 * did not ask for this morning, applied before they have looked at anything —
 * and its usual effect is a list that appears empty for reasons nobody can see.
 * The search box is a moment, and a moment does not get persisted.
 *
 * EVERY READ IS VALIDATED. The stored value is JSON written by an older build
 * or by a hand, and a preference store that throws on a shape it does not
 * recognise takes the whole panel down over a preference. So each field is
 * checked against the set it belongs to and anything unrecognised falls back to
 * the default, which is a wrong-but-working preference rather than a blank
 * panel.
 *
 * AND A FIELD THAT NO LONGER EXISTS IS NOT MIGRATED, IT IS IGNORED. `density`
 * was one: a record written by an older build still carries the key, and
 * reading it must not throw, must not be resurrected by a default, and must not
 * have to be explicitly deleted before this module can parse its own output. The
 * reader below simply never names it, so a record from any build at all parses
 * to the same shape. That is the whole migration: a field is removed by not
 * reading it.
 */
import { DEFAULT_ITEM_SORT, ITEM_SORTS, type ItemPageId, type ItemSort } from '../../core/item-view.ts'
import { ITEM_PAGES } from '../../core/item-view.ts'

/**
 * The key. Same family as the plugin's other device-local keys, and a NEW name:
 * the existing ones are named in the project's data-key contract and must not be
 * renamed, so a new preference gets its own key rather than a new field in an
 * old one.
 */
export const VIEW_PREFS_KEY = 'dsh.taskBoard.itemView.v1'

/** Everything remembered about how the list is shown. */
export interface ItemViewPrefs {
  /** Which page was open. */
  readonly page: ItemPageId
  /** The one ordering, shared by every page. */
  readonly sort: ItemSort
  /**
   * `showDone` IS NOT HERE, and the reason is where its control lives: it is the
   * list page's own switch, drawn on that page next to what it filters (the
   * 「隐藏已完成」 chip), so it belongs to the page rather than to the memory of
   * which page was open. This record answers 「which view was on screen」; that
   * switch is part of drawing the view.
   */
  /** The unformatted search text, for the session. Never persisted. */
  readonly search: string
  /**
   * A TEMPORARY layer over this panel, for the length of one look at it.
   *
   * It is a field here rather than a prop on the panel because `ItemViewPrefs` is
   * ALREADY the one place that says 「which view is on screen」 — `page` is on it,
   * and the render bench has always chosen a page by writing exactly this record.
   * A prop that existed only to draw a screenshot would be a SECOND way to say
   * 「the palette is open」, and the two would drift the first time somebody added
   * the real control; the one that drifts is the one nobody looks at.
   *
   * WHY IT IS NEVER WRITTEN, which is the whole of its effect on product state.
   * `writeViewPrefs` does not emit this key, so a real device cannot leave one
   * behind — and a reader who quit with the palette open finds a clean panel next
   * time, because there was never anything to restore. The rule is **never
   * WRITTEN**, not never READ: the bench has to be able to write the key, and the
   * only thing that makes a leftover impossible is that nothing produces one.
   *
   * `search` is the same shape and the same reason, one field above: a value that
   * is part of the view and not part of the memory.
   */
  readonly overlay?: ItemOverlay
}

/**
 * EVERY STATE THE SURFACE CAN **BE ASKED** TO OPEN, in one list.
 *
 * WHY IT IS A CONSTANT AND NOT A STRING IN THE FIELD ABOVE. The value is read by
 * the panel when it mounts and by the render bench before it renders — and a bench
 * that keeps its own list of what can be opened is a second truth about the same
 * question, so a state added here and forgotten there is a state nobody can
 * photograph and nobody notices is missing. One declaration, imported by both.
 *
 * AND A CONSTANT IS ALSO A PROMISE, which is the half that bites. This list used
 * to name five states and the panel could open TWO of them: `palette` and
 * `create`. The key sheet is a `useState` inside the palette that opens it, the
 * archive is a section at the foot of the list page, and the batch bar is a
 * function of the holding rather than a state at all. A bench asked for
 * `DSH_PANEL_OPEN=keys` therefore photographed an ordinary panel and called it the
 * key sheet — a capture that cannot be evidence is worse than no capture, because
 * the next reader believes it.
 *
 * The three that are not here are not missing: each is a LAYER OF SOMETHING ELSE,
 * reached through it, and a state that can only be reached through another state
 * is not a state the surface can be put into. What belongs in this list is what a
 * reader — or a bench — can name directly and have the panel honour it.
 */
/**
 * THE OPENABLE STATES, and the list is what the strip above it has to earn.
 *
 * `palette` and `create` are surfaces of their own. `sort` is not: it is a
 * **panel inside the strip** — it takes the same space the bar already owns and
 * it pushes nothing around, so a reader who opens it and closes it is exactly
 * where they were. Putting it in this union is what lets the bench and the
 * keyboard reach it by the same name the UI does, instead of the UI growing a
 * second, private way of saying 「打开排序」.
 */
export const ITEM_OVERLAYS = ['palette', 'create', 'sort'] as const

/** One of the openable states. */
export type ItemOverlay = typeof ITEM_OVERLAYS[number]

/**
 * The state a first-time reader meets.
 *
 * The first page is the LIST, not the inbox, and the reason is the inbox's own
 * definition: it holds the rows nobody has filed yet, so a reader whose notes
 * already carry a priority or a date opens it and finds nothing — and a first
 * screen that says "nothing here" on a panel full of work reads as a broken
 * panel. The inbox is one tap away and worth exactly that; what a thought
 * arrives AT is the capture box, which is on screen in every state.
 */
export const DEFAULT_VIEW_PREFS: ItemViewPrefs = {
  page: 'list',
  // Read from the model rather than written here: the default ordering is a
  // derivation the document owns, and a second copy of the word "due" in a
  // preference file is a default that starts lying the day the derivation moves.
  sort: DEFAULT_ITEM_SORT,
  search: '',
  // Never written, so this is `undefined` on every real read. It is named here
  // rather than left off the object so the shape is one value rather than
  // 「present on some reads and absent on others」, which is the difference
  // between a field and a rumour.
  overlay: undefined,
}

/** The first page is the inbox, because it is the one a thought arrives at. */
function isPage(value: unknown): value is ItemPageId {
  return typeof value === 'string' && (ITEM_PAGES as readonly string[]).includes(value)
}

function isSort(value: unknown): value is ItemSort {
  return typeof value === 'string' && (ITEM_SORTS as readonly string[]).includes(value)
}

/**
 * Read the remembered view, repairing anything unrecognised.
 *
 * Never throws. A browser in private mode with storage disabled is a supported
 * way to run this panel, and a preference is never worth an exception.
 * @returns the stored view, or the defaults.
 */
export function readViewPrefs(): ItemViewPrefs {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(VIEW_PREFS_KEY)
  } catch {
    return DEFAULT_VIEW_PREFS
  }
  if (raw === null || raw === '') return DEFAULT_VIEW_PREFS
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_VIEW_PREFS
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_VIEW_PREFS
  const record = parsed as Record<string, unknown>
  return {
    page: isPage(record.page) ? record.page : DEFAULT_VIEW_PREFS.page,
    sort: isSort(record.sort) ? record.sort : DEFAULT_VIEW_PREFS.sort,
    // `record.showDone`, `record.density` AND `record.collapsed` ARE DELIBERATELY
    // NEVER NAMED HERE, and that is the whole upgrade path for all three: a field
    // is removed by not reading it, so a record written by any build at all parses
    // to this shape. Naming them — even to default them — is what turns a retired
    // setting back into a live one, because a default with a reader is a setting
    // whose control somebody will eventually be asked to rebuild.
    // Never restored: see the module header.
    search: '',
    // READ, AND ONLY A NAME IN THE TABLE ABOVE. The key is never written by this
    // module, so a real device cannot have produced one; this branch exists for
    // the render bench, which writes the same record `page` is written through.
    // Anything else in the slot is dropped, because a field that accepts anything
    // it is handed is a field the compiler checks nothing about — the same reason
    // `isPage` and `isSort` check against the model's own vocabulary rather than
    // against a string shape.
    overlay: ITEM_OVERLAYS.includes(record.overlay as ItemOverlay) ? record.overlay as ItemOverlay : undefined,
  }
}

/**
 * Remember the view. The search text is dropped on the way in.
 * @param prefs - the current view.
 */
export function writeViewPrefs(prefs: ItemViewPrefs): void {
  try {
    window.localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify({
      page: prefs.page,
      sort: prefs.sort,
      // `search` and `overlay` are ABSENT from this object on purpose. Both are
      // part of the view and not part of the memory, and a key that appears here
      // once appears forever: the day somebody adds it to the serialised shape
      // because it seemed harmless, a reader who quit with the palette open comes
      // back to a panel that will not go away, and the preference store is the
      // last place anyone looks when a panel opens itself.
    }))
  } catch {
    // No storage, or no room for it. The panel works exactly the same; only
    // the memory of the choice is lost, and that is not worth a message.
  }
}
