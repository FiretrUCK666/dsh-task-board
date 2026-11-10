/**
 * FLIP for card movement — structure-driven, never rect-driven.
 *
 * The original rect-diff approach treated ANY geometry change (a column
 * scroll, a hover lift, the dragging scale) as a move, so a busy board
 * repainted cards into their old positions — the "cards vanish / ghost
 * copies / endless flicker" symptoms. This version compares STRUCTURE only:
 * a card's column and its index inside it, read from the DOM order, never
 * from rects. A card animates only when its structure changed (a reorder or
 * a column move); a pure scroll or hover can never trigger it. The animation
 * runs on the Web Animations API (the browser owns the lifecycle — no
 * transitionend dependency, no inline-transform residue, auto-cancel on
 * unmount), and it is fully suppressed while the user is dragging: the
 * post-drop settle is the one moment it plays.
 *
 * Newcomers (in the current snapshot, absent from the previous one) arrive
 * instead of teleporting: the hook stamps them with `data-fresh` so the CSS
 * reveals them once (see `.card[data-fresh]`), then removes the stamp on the
 * next frame batch — the animation belongs to the arrival, not to the card,
 * so a later re-render never replays it.
 *
 * ── THE DECISION IS SEPARATE FROM THE MEASUREMENT ───────────────────────────
 *
 * "Where is every card right now" costs one `getBoundingClientRect()` per card,
 * and a rect read is a LAYOUT read: the engine has to finish every pending style
 * and layout job before it can answer. This hook used to do exactly that on
 * EVERY render of the board — and the board re-renders on every controller
 * notification (a session list burst, a poll, a heartbeat), so a reader scrolling
 * a comment panel over the board paid a full synchronous layout per notification,
 * for cards nobody could see.
 *
 * So the two halves are now separate functions with a cheap boundary between
 * them: {@link structureSignatureOf} reads the DOM ORDER only (no layout), and
 * {@link flipDecisionOf} says whether this render may skip. Only a render that
 * actually moved a card — or a reveal edge — reaches {@link measureRegion}.
 *
 * ── WHY THE REMEMBERED POSITION IS A CONTENT POSITION ───────────────────────
 *
 * Skipping renders means the remembered rects can be older than the last paint:
 * the reader may have scrolled a column, or the board may have scrolled sideways,
 * between the render that measured and the render that animates. Comparing a fresh
 * rect against a stale one would fling the card in from the wrong place. So the
 * memory stores each card's position in the coordinates that do not change when
 * something scrolls — offset from the container, plus that column's scroll offset —
 * and reconstructs the viewport position from the CURRENT scroll offsets. A
 * remembered position is then valid at any later render, which is what makes
 * "measure only when the structure moved" honest instead of merely faster.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react'

const FLIP_MS = 240
const FLIP_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** A card's structural identity: which column, and which index inside it. */
export interface CardStructure {
  status: string
  index: number
}

/** Whether the page asked for reduced motion (decorative animation off). */
function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/**
 * The ids whose structure (column or in-column order) actually changed
 * between two snapshots — the ONLY cards eligible for a FLIP. A card absent
 * from the previous snapshot is new content (no old rect to animate FROM), a
 * card absent from both sides is ignored.
 */
export function flipCandidatesOf(
  previous: ReadonlyMap<string, CardStructure>,
  current: ReadonlyMap<string, CardStructure>,
): string[] {
  const candidates: string[] = []
  for (const [id, now] of current) {
    const before = previous.get(id)
    if (before === undefined) continue
    if (before.status !== now.status || before.index !== now.index) candidates.push(id)
  }
  return candidates
}

/**
 * The board's structure as one comparable string: every column in track order,
 * and the card ids inside it in DOM order.
 *
 * This is the CHEAP half of the hook. `querySelectorAll` walks the tree; it does
 * not ask the engine for a single box, so it never forces a layout flush. That is
 * the whole point of having it: the answer to "did anything move" must be
 * available without paying for rects.
 * @param container - the board region.
 * @returns the signature (stable for an unchanged structure).
 */
export function structureSignatureOf(container: HTMLElement): string {
  const parts: string[] = []
  for (const column of container.querySelectorAll<HTMLElement>('[data-status]')) {
    const ids = [...column.querySelectorAll<HTMLElement>('[data-task-id]')]
      .map(card => card.getAttribute('data-task-id') ?? '')
      .join(',')
    parts.push(`${column.getAttribute('data-status') ?? ''}:${ids}`)
  }
  return parts.join('|')
}

/** What this render is allowed to do — the cheap answer, decided before any rect. */
export type FlipDecision =
  /** Nothing moved and no edge was crossed: do no layout work at all. */
  | { readonly kind: 'skip' }
  /** The structure moved (or the surface was just revealed): measure. */
  | { readonly kind: 'measure'; readonly animate: boolean }

/**
 * Decide, from the signature alone, what this render must do.
 *
 * `quiet` folds the three reasons a move must NOT play (a drag in flight, reduced
 * motion, and the reveal edge). They stay separate facts upstream and become one
 * flag here, because "may play" is one question — two branches would let a drag
 * and reduced motion disagree about which one wins.
 * @param previous - the signature the last measurement was taken from (undefined on mount).
 * @param current - this render's signature.
 * @param quiet - movement must not play (see above).
 * @returns the decision; `skip` means no layout read may follow.
 */
export function flipDecisionOf(
  previous: string | undefined,
  current: string,
  quiet: boolean,
): FlipDecision {
  /* A first render has no baseline to compare against but still needs one
   * measurement (the memory has to start somewhere), and on that pass nothing can
   * move yet. */
  if (previous === undefined) return { kind: 'measure', animate: false }
  /* The remembered positions are CONTENT positions, so an unchanged structure
   * needs no measurement at all — not even after a reveal edge. What a reveal
   * changes is the viewport (a panel is gone), and the reconstruction already
   * reads the live viewport; nothing remembered went stale. */
  if (previous === current) return { kind: 'skip' }
  return { kind: 'measure', animate: !quiet }
}

/** A card's remembered position, in the coordinates that survive a scroll. */
interface CardPlace {
  status: string
  index: number
  /** `rect.left - container.left + trackScrollLeft`. */
  contentLeft: number
  /** `rect.top - container.top + thatColumn.scrollTop`. */
  contentTop: number
}

/** Everything one measurement pass records. */
interface Region {
  places: Map<string, CardPlace>
  structures: Map<string, CardStructure>
  /** Live viewport rects, for the pass that took them (never reused later). */
  rects: Map<string, DOMRect>
  /** Per-status vertical scroll offset at measure time. */
  scrollTops: Map<string, number>
  /** Horizontal scroll of the column track at measure time. */
  trackScroll: number
}

/** The few numbers a later render needs to place a remembered card in the viewport. */
interface LiveFrame {
  left: number
  top: number
  trackScroll: number
  scrollTops: Map<string, number>
}

/** The board's column track (once, by the attribute the FLIP already keys on). */
function trackOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-dsh-tb-columns]')
}

/** Read the current frame WITHOUT touching any card's box. */
function liveFrameOf(container: HTMLElement): LiveFrame {
  const bounds = container.getBoundingClientRect()
  const scrollTops = new Map<string, number>()
  for (const column of container.querySelectorAll<HTMLElement>('[data-status]')) {
    scrollTops.set(column.getAttribute('data-status') ?? '', column.scrollTop)
  }
  return { left: bounds.left, top: bounds.top, trackScroll: trackOf(container)?.scrollLeft ?? 0, scrollTops }
}

/**
 * THE measurement: DOM order plus one rect per card. Every layout read in this
 * module lives here, so "when may we measure" has one answer to point at.
 */
function measureRegion(container: HTMLElement): Region {
  const frame = liveFrameOf(container)
  const places = new Map<string, CardPlace>()
  const structures = new Map<string, CardStructure>()
  const rects = new Map<string, DOMRect>()
  for (const column of container.querySelectorAll<HTMLElement>('[data-status]')) {
    const status = column.getAttribute('data-status') ?? ''
    const scrollTop = frame.scrollTops.get(status) ?? 0
    let index = 0
    for (const card of column.querySelectorAll<HTMLElement>('[data-task-id]')) {
      const id = card.getAttribute('data-task-id')
      const rect = card.getBoundingClientRect()
      if (id !== null) {
        structures.set(id, { status, index })
        rects.set(id, rect)
        places.set(id, {
          status,
          index,
          contentLeft: rect.left - frame.left + frame.trackScroll,
          contentTop: rect.top - frame.top + scrollTop,
        })
      }
      index += 1
    }
  }
  return { places, structures, rects, scrollTops: frame.scrollTops, trackScroll: frame.trackScroll }
}

/**
 * Where a remembered card sat, expressed in THIS render's viewport.
 * @param place - the remembered content position.
 * @param frame - this render's container origin and scroll offsets.
 * @returns the top-left the card departed from.
 */
function rememberedOriginOf(place: CardPlace, frame: LiveFrame): { left: number; top: number } {
  return {
    left: place.contentLeft - frame.trackScroll + frame.left,
    top: place.contentTop - (frame.scrollTops.get(place.status) ?? 0) + frame.top,
  }
}

/**
 * Animate the cards whose structure changed into their new positions.
 *
 * Compact horizontal track: a cross-column move on a phone lands OFF-SCREEN
 * (the target column is not the one under the eye), so the animation —
 * though it plays — is never seen: 「移动没有动效」. Before playing, the
 * moved card's TARGET column is brought into view (instant scroll: a smooth
 * one would fight the rects the animation is computed from). Desktop (no
 * horizontal scroll) never touches it.
 *
 * @param containerRef - the board region (columns → cards, in DOM order).
 * @param disabled - a drag is in flight; the post-drop settle is the only moment
 *   a move plays, so nothing may animate under the pointer.
 * @param revealKey - changes when the surface is REVEALED (a covering layer closed).
 *   A reveal resets the baseline and plays nothing: the reader just closed a panel,
 *   and cards flying into place behind it is noise, not feedback.
 */
export function useFlipRegion(
  containerRef: RefObject<HTMLElement | null>,
  disabled: boolean,
  revealKey?: unknown,
): void {
  const previousSignature = useRef<string | undefined>(undefined)
  const previousPlaces = useRef<ReadonlyMap<string, CardPlace>>(new Map())
  const previousStructures = useRef<ReadonlyMap<string, CardStructure>>(new Map())
  const previousReveal = useRef(revealKey)
  useLayoutEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const revealed = previousReveal.current !== revealKey
    previousReveal.current = revealKey
    const signature = structureSignatureOf(container)
    const quiet = disabled || reducedMotion() || revealed
    const decision = flipDecisionOf(previousSignature.current, signature, quiet)
    previousSignature.current = signature
    /* NO LAYOUT READ MAY FOLLOW A `skip`. This early return is the whole fix for
     * 「每收到一次通知就同步排版一次」: an unchanged board costs one DOM walk. */
    if (decision.kind === 'skip') return
    const region = measureRegion(container)
    if (decision.animate) {
      // Stamped here rather than in the candidates loop below: newcomers
      // are NOT flip candidates (no old rect to animate FROM), so without
      // this loop they would teleport.
      for (const [id] of region.structures) {
        if (previousStructures.current.has(id)) continue
        const element = container.querySelector<HTMLElement>(`[data-task-id="${id}"]`)
        if (element === null || element.hasAttribute('data-fresh')) continue
        element.setAttribute('data-fresh', '')
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => { element.removeAttribute('data-fresh') })
        })
      }
      const candidates = flipCandidatesOf(previousStructures.current, region.structures)
      if (candidates.length > 0) {
        const track = trackOf(container)
        const scrollsSideways = track !== null && track.scrollWidth > track.clientWidth + 1
        const firstModal = container.querySelector<HTMLElement>(`[data-task-id="${candidates[0]}"]`)
        if (track !== null && scrollsSideways) {
          // Center the first moved card's target column in view, instantly.
          const targetColumn = firstModal?.closest('section[data-status]')
          if (targetColumn !== null && targetColumn !== undefined) {
            targetColumn.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' })
          }
        }
        /* The frame is read AFTER the scroll, and the remembered position is
         * reconstructed against it — the pre-scroll rect is not where the card
         * visually departed from once the track moved. */
        const frame = liveFrameOf(container)
        for (const id of candidates) {
          const place = previousPlaces.current.get(id)
          if (place === undefined) continue
          const element = container.querySelector<HTMLElement>(`[data-task-id="${id}"]`)
          if (element === null) continue
          const origin = rememberedOriginOf(place, frame)
          const live = element.getBoundingClientRect()
          const dx = origin.left - live.left
          const dy = origin.top - live.top
          if (dx === 0 && dy === 0) continue
          // WAAPI animations are fire-and-forget: the browser owns each object
          // (auto-cancel on unmount, no inline style left behind, no
          // transitionend), and with snap gone there is nothing to pin during the
          // flight — so nothing here needs to await completion.
          element.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
            { duration: FLIP_MS, easing: FLIP_EASING },
          )
        }
      }
    }
    previousPlaces.current = region.places
    previousStructures.current = region.structures
    /* NO DEPENDENCY ARRAY, DELIBERATELY. A card move is a DOM change that React
     * makes in a commit — nothing in this hook's own inputs changes when it
     * happens, so an effect keyed on `[containerRef, disabled, revealKey]` would
     * never run on the one commit it exists for, and the FLIP would simply stop
     * playing. Running after every commit is the only way to see a structural
     * change; the cost of doing so is one `querySelectorAll` walk, and the
     * measurement — the part that forces a layout — happens only above the
     * `skip` short-circuit. That split is the fix; a dependency array would be a
     * fix for the wrong half. */
  })
}
