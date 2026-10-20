/**
 * Which of this plugin's surfaces are switched on, as the browser sees it.
 *
 * The host answers on `GET /api/dsh-task-board/board/surfaces`, and the answer
 * is derived from the rows the loader actually evaluated (see
 * `src/host/surfaces.ts`). Turning a row off therefore stops the loader from
 * evaluating it, which is why there is no runtime check anywhere else: a switch
 * that lived in the code would be one refactor away from lying.
 *
 * THE FAILURE DIRECTION IS THE WHOLE DESIGN. A read that fails, times out, or
 * answers with a shape we do not recognise resolves to `undefined`, and
 * `surfaceEnabled('items', undefined)` is TRUE — so a reader that cannot reach
 * the host registers everything it otherwise would. The switch narrows; it
 * never widens, and a broken switch leaves the plugin exactly as it was before
 * anyone thought about switches.
 *
 * Read ONCE per registration, before the panel is contributed. Reading per
 * render would make a surface appear and disappear under the reader's cursor.
 */
import { SURFACE_IDS, type SurfaceId, type SurfaceManifest } from '../core/surfaces.ts'
import { routeUrl } from './route-base.ts'

/**
 * The answer's shape and the names a registration may ask about — ONE home.
 *
 * Both come from `core/surfaces.ts`, where the plugin's surface list lives
 * (`SURFACE_IDS`). The browser half used to spell its own list of names, and
 * it was one short: the host can announce the agent row, and the browser had
 * no name for it. A shorter list does not error — it just means the browser
 * can never ask about that surface — so the list is derived, not written out.
 */
export type { SurfaceManifest }

/** Which surface a registration is asking about: the plugin's own surface list. */
export type SurfaceName = SurfaceId

/** The route, named here once so the manifest has a single home. */
const SURFACES_URL = routeUrl('/api/dsh-task-board/board/surfaces')

/** How long to wait before deciding we cannot know. Short: the answer is local. */
const READ_TIMEOUT_MS = 3_000

/**
 * Ask the host which surfaces are on.
 *
 * Resolves to `undefined` for EVERY failure — network, non-200, malformed JSON,
 * a shape that is not one boolean per surface, or a timeout. There is no
 * "partially known" answer, because a half-answer would make some surfaces
 * vanish and others not, which is the one outcome a reader cannot act on.
 * @param fetchImpl - injected for tests.
 * @returns the manifest, or `undefined` when it could not be read.
 */
export async function readSurfaceManifest(
  fetchImpl: typeof fetch = fetch,
): Promise<SurfaceManifest | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, READ_TIMEOUT_MS)
  try {
    const response = await fetchImpl(SURFACES_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return undefined
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) return undefined
    // Unwrap the plugin's shared envelope FIRST, then judge the value. Checking
    // the envelope for the manifest's own shape can never pass — the envelope
    // carries `ok` and `value`, not the per-surface flags — and a check that can
    // never pass is worse than no check: it answers `undefined` for a perfectly good
    // answer, which here means "narrow nothing" and hides the switch.
    return isManifest((body as { value?: unknown }).value) ? (body as { value: SurfaceManifest }).value : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Is this the manifest shape? A plain structural test, because a value that
 * merely LOOKS right would silently switch a surface off.
 *
 * The keys are read off the plugin's own surface list, not written out here:
 * a spelled-out copy of the list is a list that goes short the day a surface
 * is added — and it goes short SILENTLY, because a missing key only means the
 * whole manifest is dropped, which reads as "the host said nothing".
 * @param value - the candidate.
 * @returns whether it carries one boolean per surface.
 */
function isManifest(value: unknown): value is SurfaceManifest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return SURFACE_IDS.every(id => typeof record[id] === 'boolean')
}

/**
 * Should this surface be registered?
 *
 * THE FALLBACK IS PER-SURFACE, and that is the whole reason it is a parameter.
 * A manifest that cannot be read means "the host said nothing", and the
 * product panels must register anyway — a broken switch must leave the plugin
 * exactly as it was before anyone thought about switches. The gallery is the
 * opposite case: it is a developer instrument, so an unreadable manifest must
 * leave it ABSENT rather than put a design catalogue in front of a user whose
 * host is simply unreachable. One default cannot serve both directions.
 *
 * @param name - the surface asking.
 * @param manifest - what the host said, or `undefined` if it said nothing.
 * @param whenUnknown - what an unreadable manifest means for this surface.
 * @returns whether to register it.
 */
export function surfaceEnabled(
  name: SurfaceName,
  manifest: SurfaceManifest | undefined,
  whenUnknown = true,
): boolean {
  return manifest === undefined ? whenUnknown : manifest[name]
}
