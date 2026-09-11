/**
 * Client self-report: the running page tells the host which bundle it is and
 * how it actually laid out.
 *
 * The board cannot be diagnosed from the host alone — a page pinned to an old
 * artifact and a page rendering a wrong rule look identical from the outside,
 * and both look identical again in a compressed phone screenshot. This module
 * is the missing channel: one small POST per page load carrying the bundle
 * version and the measured boxes of the landmarks that matter (the search
 * field, the column strip, one pill, the columns), so the host route can hand
 * the truth back to whoever is asking.
 *
 * Diagnostic only: nothing in the board reads it, every failure is silent, and
 * the payload carries no board data — just versions and rectangles.
 * @module dsh-task-board/client/client-report
 */

/** One measured box in CSS pixels (viewport-relative). */
export interface MeasuredBox {
  top: number
  bottom: number
  height: number
}

/** Landmark → class name. The caller supplies the real (scoped) class names,
 *  so this module never guesses a selector. `thumbBar` is the falsifier for
 *  the columns-vs-bar overlap: overlap ⇔ firstColumn.bottom > thumbBar.top. */
export interface LandmarkClasses {
  modes: string
  search: string
  strip: string
  pill: string
  header: string
  columns: string
  firstColumn: string
  primary: string
  thumbBar: string
}

/** Round to a tenth of a pixel (enough for judgement, small on the wire). */
function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** One element's box, or undefined when it is absent or has no area. */
export function boxOf(element: Element | null | undefined): MeasuredBox | undefined {
  if (element === null || element === undefined) return undefined
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return undefined
  return { top: round(rect.top), bottom: round(rect.bottom), height: round(rect.height) }
}

/** The report body the host route accepts. */
export interface ClientReportBody {
  version: string
  href: string
  ua?: string
  viewport?: { width: number; height: number }
  dpr?: number
  boxes?: Record<string, MeasuredBox>
}

/**
 * Measure the board's live geometry through the caller's own class names.
 * Reads only what exists: an unmounted board reports no boxes, never throws.
 * @param landing - the scoped class names of the landmarks.
 * @param root - the subtree to search (the document in production).
 * @returns the box map keyed by landmark name.
 */
export function collectBoardBoxes(landing: LandmarkClasses, root: ParentNode = document): Record<string, MeasuredBox> {
  const boxes: Record<string, MeasuredBox> = {}
  const add = (key: string, selector: string): void => {
    const box = boxOf(root.querySelector(`.${selector}`))
    if (box !== undefined) boxes[key] = box
  }
  add('header', landing.header)
  add('modes', landing.modes)
  add('search', landing.search)
  add('strip', landing.strip)
  add('pill', landing.pill)
  add('columns', landing.columns)
  add('firstColumn', landing.firstColumn)
  add('primary', landing.primary)
  add('thumbBar', landing.thumbBar)
  return boxes
}

/**
 * Compose and send one report. Never throws and never blocks the board: the
 * request is fire-and-forget with a short bound.
 * @param version - the bundle version baked into this page.
 * @param landing - the scoped class names of the landmarks.
 * @param fetchImpl - fetch seam (tests).
 * @param root - the subtree to measure (tests).
 * @returns a promise that resolves once the attempt settled (success or not).
 */
export async function sendClientReport(
  version: string,
  landing: LandmarkClasses,
  fetchImpl: typeof fetch = fetch,
  root: ParentNode = document,
): Promise<void> {
  const body: ClientReportBody = {
    version,
    href: typeof location === 'undefined' ? '' : location.href,
    ...typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? { ua: navigator.userAgent }
      : {},
    ...typeof window !== 'undefined'
      ? { viewport: { width: window.innerWidth, height: window.innerHeight }, dpr: window.devicePixelRatio }
      : {},
    boxes: collectBoardBoxes(landing, root),
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => { ctrl.abort() }, 5_000)
  try {
    await fetchImpl('/api/dsh-task-board/client-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch {
    // A diagnostic that fails is still not an error.
  } finally {
    clearTimeout(timer)
  }
}
