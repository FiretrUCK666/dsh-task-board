/**
 * ONE way to open the task list, from any surface.
 *
 * THE PROBLEM THIS SOLVES. The list lives in the shell's right sidebar, and a
 * sidebar tab is remembered PER SESSION — so a new session starts with no tab
 * and the reader has to go looking again. The answer is a button that works
 * from wherever the reader already is: the conversation header, and the board's
 * own header (which has no conversation header above it, and was therefore
 * unreachable).
 *
 * WHY THERE IS ONE FUNCTION AND NOT TWO. Two call sites means two
 * implementations means two behaviours the day someone fixes one of them. So
 * both buttons call `openList()`, and `openList()` is the only code in this
 * plugin that knows the rule below.
 *
 * THE RULE: never call `openTab` unless a seat is on screen. The host
 * unmounts the whole sidebar seat while a global panel is in front (the board
 * is exactly that), and `openTab` against a seat that is not there either
 * throws or does nothing at all. `mounted` is the only honest question to ask,
 * and answering it wrong is the one failure a person cannot diagnose: the
 * button looks real, the click does nothing, and nothing anywhere says why.
 *
 * WHY A MODULE HOLDER. The board panel gets its props through the `main`
 * slot, whose face belongs to the board; the conversation header's button gets
 * its own. Threading one launcher through both would mean editing the shared
 * wiring, and the surface this must not disturb. So the launcher is published
 * once when the list is registered and withdrawn when it is disposed — a
 * singleton with a real lifetime, not a module-cache accident. The default is
 * the honest one: no launcher, nothing opens, no pretend.
 */
import { useSyncExternalStore } from 'react'
import { t } from '../locales.ts'
import css from '../board.module.css'

/** The page type this contribution opens — the wire name, shared with the tab type. */
const LIST_KIND = 'task-list'

/** The narrow face of the right sidebar's controller that opening needs. */
export interface ListOpenerFace {
  readonly mounted: { getSnapshot(): string | undefined; subscribe(fn: () => void): () => void }
  openTab(kind: string, options?: Record<string, unknown>): void
}

/** How a surface asks the question. */
export interface ListLauncher {
  /** True only while a sidebar seat is actually on screen. */
  available(): boolean
  /** Open the list. `false` means there was no seat — never a pretend success. */
  open(): boolean
  /** Follow the seat, so a button can appear and disappear with it. */
  subscribe(onChange: () => void): () => void
}

/** What a surface gets when nothing has published a launcher. */
const NO_SEAT: ListLauncher = {
  available: () => false,
  open: () => false,
  subscribe: () => () => undefined,
}

let published: ListLauncher = NO_SEAT

/**
 * Build the real launcher over one sidebar controller.
 *
 * Exported so a test can drive it without a shell, and so the rule lives in
 * exactly one place.
 * @param sidebar - the controller, or undefined when it is not composed.
 * @returns a launcher that refuses when there is no seat.
 */
export function makeListLauncher(sidebar: ListOpenerFace | undefined): ListLauncher {
  if (sidebar === undefined) return NO_SEAT
  return {
    available: () => sidebar.mounted.getSnapshot() !== undefined,
    open: () => {
      // The whole point, in one line: no seat, no call. A click that does
      // nothing and says nothing is worse than no button at all.
      if (sidebar.mounted.getSnapshot() === undefined) return false
      sidebar.openTab(LIST_KIND)
      return true
    },
    // The seat decides when a button may exist, so the seat is what a button
    // watches. Deriving it from a mount effect or a guess about which panel is
    // open is how a button ends up offering something that cannot happen.
    subscribe: (onChange: () => void) => sidebar.mounted.subscribe(onChange),
  }
}

/** Publish the launcher while this plugin is composed. */
export function publishListLauncher(sidebar: ListOpenerFace | undefined): () => void {
  published = makeListLauncher(sidebar)
  return () => { published = NO_SEAT }
}

/** The current launcher, without a subscription. */
export function listLauncher(): ListLauncher {
  return published
}

/**
 * The launcher, subscribed to the seat it depends on.
 *
 * Re-renders exactly when the seat appears or goes: that is the moment the
 * button has to appear and disappear. The snapshot is a number rather than the
 * session id on purpose — `useSyncExternalStore` compares it, and a session id
 * that changed without changing the seat would re-render for nothing.
 */
export function useListLauncher(): ListLauncher {
  const launcher = published
  const read = (): number => (launcher.available() ? 1 : 0)
  // The third argument is the server-render read, and it is REQUIRED rather
  // than optional: without it React throws the moment this component renders
  // outside a browser — which is exactly what a test does.
  useSyncExternalStore((onChange: () => void) => launcher.subscribe(onChange), read, read)
  return launcher
}

/**
 * The button both surfaces render.
 *
 * It renders NOTHING when there is no seat. That is the deliberate answer to
 * "grey it out and say why on hover": a button that cannot work, offering
 * itself anyway, is a small lie — and on a touch surface the explanation
 * would be unreachable by definition.
 * @param className - extra class for the surface placing it.
 * @returns the button, or nothing.
 */
export function ListOpenButton(props: { readonly className?: string } = {}) {
  const launcher = useListLauncher()
  if (!launcher.available()) return null
  return (
    <button
      type="button"
      className={props.className === undefined ? css.itemListOpenButton : `${css.itemListOpenButton} ${props.className}`}
      onClick={() => { launcher.open() }}
    >
      {t('itemTab.open')}
    </button>
  )
}
