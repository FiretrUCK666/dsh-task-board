/**
 * The panel's one-click hand-off: give one item to the model of the session
 * its card runs in.
 *
 * It is a POST on the board's own prefix because that is where the two
 * documents and the truth they share already live — and because the SESSION is
 * a host fact, not a browser one. The panel shows no conversation while it is
 * open, so the target has to be resolved where the sessions are.
 *
 * Same discipline as every other call in this layer: one route, one envelope,
 * and an honest failure instead of an optimistic success the host never made.
 */
import { routeUrl } from './route-base.ts'

/** What the panel sends. Both are plain scalars, and both are the host's to check. */
export interface AskRequestBody {
  readonly taskId: string
  readonly ref: number
}

/**
 * The host's answer, narrowed to the two shapes it can actually return.
 *
 * `why` is a code rather than a sentence so the panel owns the wording (it is
 * translated, and the panel knows which case it is in); the host stays the one
 * that decides the FACT.
 */
export type AskReply =
  | { readonly ok: true; readonly sessionId: string; readonly said: string }
  | { readonly ok: false; readonly why: string }

/** How long to wait before telling the reader we could not reach the host. */
const ASK_TIMEOUT_MS = 8_000

/**
 * Hand one item over.
 *
 * @param body - which card, which item.
 * @param fetchImpl - injected for tests.
 * @returns the host's answer, or a refusal that names the network rather than
 *   pretending the hand-off succeeded.
 */
export async function itemsAsk(
  body: AskRequestBody,
  fetchImpl: typeof fetch = fetch,
): Promise<AskReply> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ASK_TIMEOUT_MS)
  try {
    const response = await fetchImpl(routeUrl('/api/dsh-task-board/board/ask'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, why: `hostRefused ${response.status}` }
    const payload: unknown = await response.json()
    const value = (payload as { value?: unknown } | null)?.value
    if (typeof value !== 'object' || value === null) return { ok: false, why: 'malformedAnswer' }
    const record = value as Record<string, unknown>
    if (record.ok === true && typeof record.sessionId === 'string') {
      return { ok: true, sessionId: record.sessionId, said: typeof record.said === 'string' ? record.said : '' }
    }
    if (record.ok === false && typeof record.why === 'string') return { ok: false, why: record.why }
    return { ok: false, why: 'unrecognisedAnswer' }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}
