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
 * recognise takes the whole panel down over a row height. So each field is
 * checked against the set it belongs to and anything unrecognised falls back to
 * the default, which is a wrong-but-working preference rather than a blank
 * panel.
 */
import { DEFAULT_ITEM_SORT, ITEM_SORTS, ITEM_STATUS_ORDER, type ItemPageId, type ItemSort, type ItemStatusView } from '../../core/item-view.ts'
import { ITEM_PAGES } from '../../core/item-view.ts'
import type { ItemDensity } from './model.ts'

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
  /** Row height. */
  readonly density: ItemDensity
  /** Whether the finished group is open. Off by default: it is history. */
  readonly showDone: boolean
  /** Which groups the reader had folded away. */
  readonly collapsed: readonly ItemStatusView[]
  /** The unformatted search text, for the session. Never persisted. */
  readonly search: string
}

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
  density: 'compact',
  /**
   * ON, and this is the one default that was wrong by measurement rather than by
   * taste.
   *
   * With it off, the 已完成 GROUP does not exist on the page at all — a reader who
   * had finished things found three groups where the surface has four, and had no
   * way to tell whether the fourth was empty, filtered away, or forgotten. The
   * switch still exists and the tile still drives it; what changed is that the
   * page's SHAPE no longer changes under the reader. A control that hides a whole
   * section of a list by default is a control whose absence looks like a bug, and
   * 「我明明做过的事去哪了」 is the single most expensive thing a task list can say.
   */
  showDone: true,
  collapsed: [],
  search: '',
}

/** The first page is the inbox, because it is the one a thought arrives at. */
function isPage(value: unknown): value is ItemPageId {
  return typeof value === 'string' && (ITEM_PAGES as readonly string[]).includes(value)
}

function isSort(value: unknown): value is ItemSort {
  return typeof value === 'string' && (ITEM_SORTS as readonly string[]).includes(value)
}

function isDensity(value: unknown): value is ItemDensity {
  return value === 'compact' || value === 'comfy'
}

function isGroup(value: unknown): value is ItemStatusView {
  return typeof value === 'string' && (ITEM_STATUS_ORDER as readonly string[]).includes(value)
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
  const collapsed = Array.isArray(record.collapsed) ? record.collapsed.filter(isGroup) : []
  return {
    page: isPage(record.page) ? record.page : DEFAULT_VIEW_PREFS.page,
    sort: isSort(record.sort) ? record.sort : DEFAULT_VIEW_PREFS.sort,
    density: isDensity(record.density) ? record.density : DEFAULT_VIEW_PREFS.density,
    // A BOOLEAN FALLS BACK TO THE DEFAULT, and `=== true` was the bug. Coercing
    // "absent" to `false` only happens to agree with the default while the default
    // IS false — so the day a boolean's default became `true`, every record written
    // before it, and every damaged record, silently switched that preference OFF.
    // For `showDone` that meant a reader who had finished things found the group
    // gone with no way to tell whether it was empty or filtered. The question this
    // line asks is 「did the reader say so」, and a record that never said so must
    // get the DEFAULT, not the other boolean.
    showDone: typeof record.showDone === 'boolean' ? record.showDone : DEFAULT_VIEW_PREFS.showDone,
    collapsed: [...new Set(collapsed)],
    // Never restored: see the module header.
    search: '',
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
      density: prefs.density,
      showDone: prefs.showDone,
      collapsed: prefs.collapsed,
    }))
  } catch {
    // No storage, or no room for it. The panel works exactly the same; only
    // the memory of the choice is lost, and that is not worth a message.
  }
}

/**
 * Fold one group away or back, returning the new set.
 *
 * A pure helper so the caller never writes the set it was handed, which is how
 * a toggle ends up mutating the state two renders ago.
 * @param collapsed - the folded groups.
 * @param group - the group being toggled.
 * @returns the new set.
 */
export function toggleCollapsed(collapsed: readonly ItemStatusView[], group: ItemStatusView): ItemStatusView[] {
  return collapsed.includes(group) ? collapsed.filter(g => g !== group) : [...collapsed, group]
}
