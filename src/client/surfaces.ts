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
import { routeUrl } from './route-base.ts'

/** The answer's shape, exactly as the host spells it. */
export interface SurfaceManifest {
  readonly board: boolean
  readonly items: boolean
  readonly agent: boolean
}

/** Which surface a registration is asking about. */
export type SurfaceName = 'board' | 'items'

/** The route, named here once so the manifest has a single home. */
const SURFACES_URL = routeUrl('/api/dsh-task-board/board/surfaces')

/** How long to wait before deciding we cannot know. Short: the answer is local. */
const READ_TIMEOUT_MS = 3_000

/**
 * Ask the host which surfaces are on.
 *
 * Resolves to `undefined` for EVERY failure — network, non-200, malformed JSON,
 * a shape that is not three booleans, or a timeout. There is no "partially
 * known" answer, because a half-answer would make some surfaces vanish and
 * others not, which is the one outcome a reader cannot act on.
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
    // carries `ok` and `value`, not three booleans — and a check that can never
    // pass is worse than no check: it answers `undefined` for a perfectly good
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
 * @param value - the candidate.
 * @returns whether it carries three booleans.
 */
function isManifest(value: unknown): value is SurfaceManifest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.board === 'boolean'
    && typeof record.items === 'boolean'
    && typeof record.agent === 'boolean'
}

/**
 * Should this surface be registered?
 *
 * @param name - the surface asking.
 * @param manifest - what the host said, or `undefined` if it said nothing.
 * @returns whether to register it. `undefined` means YES.
 */
export function surfaceEnabled(
  name: SurfaceName,
  manifest: SurfaceManifest | undefined,
): boolean {
  return manifest === undefined ? true : manifest[name]
}
