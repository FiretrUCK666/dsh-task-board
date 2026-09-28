/**
 * The archive's one read: the rows a delete is still holding.
 *
 * WHY IT IS A CALL AND NOT A SLICE OF THE REPLICA. The checklist replica
 * deliberately EXCLUDES deleted rows from `view()` — that is what makes it the
 * live list rather than a graveyard, and every surface reading it would
 * otherwise have to filter tombstones out again. The text of a deleted row
 * lives behind its tombstone on the host, so the only honest way to see it is
 * to ask the host for it, and only when the reader actually opens the archive.
 *
 * It is a DERIVED page, not a destination: it does not occupy the page rail,
 * because a rail that grows an entry every time the reader asks a question
 * turns a map into a log. The reader arrives here by clicking the count.
 *
 * Same discipline as every other call in this layer — one route, one envelope,
 * and an honest failure instead of a plausible-looking empty list.
 */
import { routeUrl } from './route-base.ts'
import type { ItemRecord } from '../core/item.ts'

/** How long to wait before telling the reader the host could not be reached. */
const ARCHIVE_TIMEOUT_MS = 8_000

/**
 * The host's answer, narrowed to the two shapes it can actually return.
 *
 * `why` is a code rather than a sentence so the panel owns the wording (it is
 * translated); the host stays the one that decides the FACT.
 */
export type ArchiveReply =
  | { readonly ok: true; readonly deleted: readonly ItemRecord[] }
  | { readonly ok: false; readonly why: string }

/** Whether a payload is a row this panel can render, read narrowly on purpose. */
function isItemRecord(value: unknown): value is ItemRecord {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && row.id !== ''
    && typeof row.ref === 'number'
    && typeof row.title === 'string'
    && typeof row.body === 'string'
    && typeof row.status === 'string'
}

/**
 * Read the rows a delete is still holding.
 *
 * A malformed row is DROPPED rather than failing the whole read: the archive is
 * a place to rescue one thing, and a single unreadable row must not cost the
 * reader the other twenty-nine.
 * @param fetchImpl - injected for tests.
 * @returns the rows, or a refusal that names the network rather than showing an
 *   archive that looks empty because the host was never reached.
 */
export async function itemsArchive(
  fetchImpl: typeof fetch = fetch,
): Promise<ArchiveReply> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ARCHIVE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(
      routeUrl('/api/dsh-task-board/board/items?includeDeleted=1'),
      { headers: { accept: 'application/json' }, signal: controller.signal },
    )
    if (!response.ok) return { ok: false, why: `hostRefused ${response.status}` }
    const payload: unknown = await response.json()
    const value = (payload as { value?: unknown } | null)?.value
    if (typeof value !== 'object' || value === null) return { ok: false, why: 'malformedAnswer' }
    const deleted = (value as { deleted?: unknown }).deleted
    // An answer with no `deleted` array is NOT "the archive is empty": it is an
    // answer from a host that never heard of the question, and reporting it as
    // empty would tell the reader their deletions are gone when they may not be.
    if (!Array.isArray(deleted)) return { ok: false, why: 'unrecognisedAnswer' }
    return { ok: true, deleted: deleted.filter(isItemRecord) }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/** What a restore says back. `restored` absent means the row did NOT come back. */
export type RestoreReply =
  | { readonly ok: true; readonly restored: ItemRecord | undefined }
  | { readonly ok: false; readonly why: string }

/**
 * Put one deleted row back.
 *
 * It is a HOST operation and not a client commit, and the reason is worth
 * stating once: a tombstone is stamped one millisecond above the row it
 * removed, so re-submitting that row untouched is exactly the stale copy the
 * tombstone exists to swallow. The commit would be accepted, nothing would
 * change, and the reader would be told it worked. Only the host knows the stamp,
 * so only the host may write it.
 *
 * A refusal is reported as a refusal. `ok: true` with no row is NOT success —
 * it is "nothing holds that number", and the panel has to say so rather than
 * close the archive as if the row were back.
 * @param ref - the short number, with or without its `#`.
 * @param clientId - this device's id, which every write on this prefix carries.
 * @param fetchImpl - injected for tests.
 * @returns what happened.
 */
export async function itemsRestore(
  ref: number,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RestoreReply> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ARCHIVE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(routeUrl('/api/dsh-task-board/board/items/restore'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ref, clientId }),
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, why: `hostRefused ${response.status}` }
    const payload: unknown = await response.json()
    const value = (payload as { value?: unknown } | null)?.value
    if (typeof value !== 'object' || value === null) return { ok: false, why: 'malformedAnswer' }
    const record = value as { available?: unknown; restored?: unknown }
    // A host serving no documents is a different fact from a host that heard
    // the question and found nothing, and the two need different words.
    if (record.available !== true) return { ok: false, why: 'hostUnavailable' }
    return { ok: true, restored: isItemRecord(record.restored) ? record.restored : undefined }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}
