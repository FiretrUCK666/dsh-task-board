/**
 * The archive: the one read, and the two writes that only the host may do.
 *
 * WHY IT IS A CALL AND NOT A SLICE OF THE REPLICA. The checklist replica
 * deliberately EXCLUDES deleted rows from `view()` — that is what makes it the
 * live list rather than a graveyard, and every surface reading it would
 * otherwise have to filter tombstones out again. The text of a deleted row
 * lives behind its tombstone on the host, so the only honest way to see it is
 * to ask the host for it, and only when the reader actually opens the archive.
 *
 * IT IS A DERIVED page, not a destination: it does not occupy the page rail,
 * because a rail that grows an entry every time the reader asks a question
 * turns a map into a log. The reader arrives here by clicking the count.
 *
 * THREE CALLS, ONE FILE, and the file is the unit. Reading the archive,
 * bringing a row back and erasing it for good are three halves of ONE question —
 * 「what did I delete, and what can I do about it」 — and they are the three
 * calls that may not be a client commit, because a tombstone carries a stamp
 * only the host knows. Splitting the erase out into a second module would mean a
 * second reader of the same envelope, which is the copy this file was written to
 * avoid.
 *
 * Same discipline as every other call in this layer — one route per verb, one
 * envelope, and an honest failure instead of a plausible-looking empty list.
 */
import { routeUrl } from './route-base.ts'
import type { ItemRecord } from '../core/item.ts'
import { isItemRecordShape } from '../core/item.ts'

/** How long to wait before telling the reader the host could not be reached. */
const ARCHIVE_TIMEOUT_MS = 8_000

/** The retention window, in days — the number the sentences say. */
const ARCHIVE_WINDOW_DAYS = 30

/** One day, in milliseconds — the unit the clock sentences count in. */
const DAY_MS = 86_400_000

/**
 * HOW LONG A TOMBSTONE HAS LEFT, read from the stamp the host keeps.
 *
 * The tombstone's deletion instant is a field of the HOST's tombstone map, and
 * it rides on each row the archive read answers with. A row without one (an
 * older host, a row the client wrote into a commit) has no clock to read, and
 * 「读不到就说读不到」 applies: the caller draws the row without the sentence
 * rather than guessing a date.
 */
export function archiveClockOf(row: ItemRecord, now: number): { readonly gone: number; readonly left: number } | undefined {
  const at = (row as { deletedAt?: unknown }).deletedAt
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return undefined
  const gone = Math.max(0, Math.floor((now - at) / DAY_MS))
  return { gone, left: Math.max(0, ARCHIVE_WINDOW_DAYS - gone) }
}

/**
 * The host's answer, narrowed to the two shapes it can actually return.
 *
 * `why` is a code rather than a sentence so the panel owns the wording (it is
 * translated); the host stays the one that decides the FACT.
 */
export type ArchiveReply =
  | { readonly ok: true; readonly deleted: readonly ItemRecord[] }
  | { readonly ok: false; readonly why: string }

/**
 * Whether an answer is a row — asked ONCE, by the model, which is the only layer
 * that knows what a row is.
 *
 * This file used to carry a private guard of its own, and it was a weakened copy
 * of the model's: the same question — 「is this payload a row」 — with two answers
 * in two layers, neither able to see the other. The copy checked five fields and
 * let through a row with no `notes`, no `tags` and a non-finite `updatedAt`. The
 * model's asks for finite stamps for a reason written down inside it: a `NaN`
 * comparator makes `Array.prototype.sort` treat a pair as EQUAL, so the order
 * quietly becomes arrival order and two devices holding one document render two
 * different lists, with nothing anywhere red.
 *
 * The file lives OUTSIDE `src/client/item/`, which is the other half of why the
 * copy survived: the panel's own 「this surface does not judge」 gate never read
 * this file, so the rule that would have caught it was pointed somewhere the
 * code was not.
 *
 * THE ONE THING THAT IS STILL LOCAL is the narrowing, and it is narrowing rather
 * than judgment: the model's guard reports `RawItem`, which is deliberately not
 * exported, so somebody has to say 「and that is a row this panel renders」. The
 * question is not re-asked here — `isItemRecordShape` has already answered it,
 * and this body cannot answer anything else. What is forbidden is growing that
 * body into a second opinion, which is what it used to be.
 */
function archivedRow(value: unknown): value is ItemRecord {
  return isItemRecordShape(value)
}

/**
 * Read the rows a delete is still holding.
 *
 * A malformed row is DROPPED rather than failing the whole read: the archive is
 * a place to rescue one thing, and a single unreadable row must not cost the
 * reader the other twenty-nine.
 * @param clientId - this device's id, which every call on this prefix carries:
 *   the host renews this tab's engine lease on it, so a reader who sits in the
 *   archive for a while is not mistaken for a tab that went away. It rides the
 *   query string because this is a read and the route reads it there.
 * @param fetchImpl - injected for tests.
 * @returns the rows, or a refusal that names the network rather than showing an
 *   archive that looks empty because the host was never reached.
 */
export async function itemsArchive(
  clientId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ArchiveReply> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ARCHIVE_TIMEOUT_MS)
  try {
    const query = new URLSearchParams({ includeDeleted: '1' })
    if (clientId !== undefined) query.set('clientId', clientId)
    const response = await fetchImpl(
      routeUrl(`/api/dsh-task-board/board/items?${query.toString()}`),
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
    return { ok: true, deleted: deleted.filter(archivedRow) }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/** What a restore says back. `restored` absent means the row did NOT come back. */
export type RestoreReply =
  | {
    readonly ok: true
    readonly restored: ItemRecord | undefined
    /**
     * The host's revision after the restore, or `-1` when it did not say.
     *
     * IT RIDES ALONG FOR THE SAME REASON THE PURGE'S DOES: a restore is a host
     * operation that this device asked for, and this device's own commit frame is
     * dropped by its own client (`own commits arrive via the response` — and a
     * restore IS a response). Without a way to settle locally, the row the reader
     * just brought back stays invisible in the live list until the next poll —
     * measured at up to 30 seconds, which the reader reports as 「点了没反应」.
     */
    readonly revision: number
  }
  | { readonly ok: false; readonly why: string }

/**
 * WHICH ROW TO BRING BACK — and the two keys are NAMED, never one standing in
 * for the other.
 *
 * The tombstone is keyed by the row's own id, so an id always finds the right
 * one. The short number is what a person says out loud, so a number is what a
 * reader can be told to type. They are not interchangeable:
 *
 *  - a row the reader JUST wrote has `ref === 0`, because the document has not
 *    numbered it yet. Addressing that one by number finds no tombstone, the
 *    route answers 200, the document does not change, and a delete that
 *    promised an undo has quietly no way back. So an undo — which the interface
 *    offers one second after the delete and then never again — addresses by
 *    `id`, which is the only key that exists for every row.
 *  - the model's `item.restore` asks 「把 #12 找回来」, and it has no other handle
 *    on the row, so it addresses by `ref`.
 *
 * Hence a union rather than two optional fields: "both" and "neither" are
 * unrepresentable at the type, and the host rejects them anyway. Making them
 * optional would have made a typo a silently unaddressed restore.
 */
export type RestoreAddress = { readonly id: string } | { readonly ref: number }

/**
 * ONE POST TO THE ARCHIVE, and both of its answers come out of it.
 *
 * 找回 and 彻底删除 are the same request with a different verb: one route, one
 * addressing union, one envelope, one timeout, one set of failure words. They
 * were two functions once and the second was a copy of the first, so every lesson
 * written into the copy — the refusal read BEFORE the value, `available` meaning
 * what it means — is a lesson somebody has to remember twice. The route is the
 * only thing that differs, so the route is the only parameter.
 *
 * The failure vocabulary is also shared, and it is deliberately NOT widened:
 * `invalid_argument` reaches here as a code, and `whyLabelOf` is what turns a
 * code into a sentence the reader can act on. A second table of words for the
 * second verb would be two places where 「你给的编号不对」 is written down.
 */
type ArchivePost =
  | { readonly ok: true; readonly value: Record<string, unknown>; readonly revision: number }
  | { readonly ok: false; readonly why: string }

/**
 * Send one addressed write to the archive and read the envelope it answers with.
 * @param verb - the host route segment, `restore` or `purge`.
 * @param address - the row's own id, or its short number. See {@link RestoreAddress}.
 * @param clientId - this device's id, which every write on this prefix carries.
 * @param fetchImpl - injected for tests.
 * @returns the host's own `value`, or a refusal that names the reason.
 */
async function postToArchive(
  verb: 'restore' | 'purge',
  address: RestoreAddress,
  clientId: string,
  fetchImpl: typeof fetch,
): Promise<ArchivePost> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ARCHIVE_TIMEOUT_MS)
  try {
    const response = await fetchImpl(routeUrl(`/api/dsh-task-board/board/items/${verb}`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify('id' in address ? { id: address.id, clientId } : { ref: address.ref, clientId }),
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, why: `hostRefused ${response.status}` }
    const payload: unknown = await response.json()
    const envelope = (payload as { ok?: unknown; value?: unknown; error?: { code?: unknown } } | null)
    // A REFUSAL IS AN ENVELOPE WITH NO `value`, and reading `value` first turned
    // every one of them into 「malformedAnswer」 — a code that names a broken
    // answer rather than the host's actual reason, printed into a Chinese
    // sentence as 「没能找回 #9: malformedAnswer」. The reader was told the host
    // spoke nonsense when the host had in fact answered 「这个编号不对」.
    //
    // So the refusal is read FIRST, from the shape it actually arrives in, and the
    // success envelope is what is left over. Order matters here: the two shapes
    // are distinguishable only by which key is present, and the wrong order picks
    // the wrong one.
    const refused = envelope?.error?.code
    if (typeof refused === 'string' && refused !== '') return { ok: false, why: refused }
    const value = envelope?.value
    if (typeof value !== 'object' || value === null) return { ok: false, why: 'malformedAnswer' }
    // The revision the service decided on rides beside the answer: it is what
    // lets a replica settle the change locally instead of waiting for a
    // broadcast (see ChecklistReplica.pruneDeleted). Absent or non-finite means
    // a caller who does not need it reads `undefined` — never a wrong number.
    const revision = (value as { revision?: unknown }).revision
    const decided = typeof revision === 'number' && Number.isFinite(revision) ? revision : -1
    const record = value as { available?: unknown; error?: { code?: unknown } }
    // The host's own refusal code, when it gave one. A wrong address and a host
    // that cannot be reached are different facts and the panel words them
    // differently, so the code is carried rather than flattened into one
    // "the archive said no".
    const code = record.error?.code
    if (typeof code === 'string' && code !== '') return { ok: false, why: code }
    // A host serving no documents is a different fact from a host that heard
    // the question and found nothing, and the two need different words.
    if (record.available !== true) return { ok: false, why: 'hostUnavailable' }
    return { ok: true, value: record, revision: decided }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

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
 * it is "nothing holds that key", and the panel has to say so rather than close
 * the archive as if the row were back.
 * @param address - the row's own id, or its short number. See {@link RestoreAddress}.
 * @param clientId - this device's id, which every write on this prefix carries.
 * @param fetchImpl - injected for tests.
 * @returns what happened.
 */
export async function itemsRestore(
  address: RestoreAddress,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RestoreReply> {
  const reply = await postToArchive('restore', address, clientId, fetchImpl)
  return reply.ok
    ? {
      ok: true,
      restored: archivedRow(reply.value.restored) ? reply.value.restored : undefined,
      revision: reply.revision,
    }
    : reply
}

/**
 * 「彻底删除」 THREE ANSWERS, and none of them is a boolean.
 *
 * `erased` is the row that was actually destroyed, and its TITLE is what the
 * receipt quotes — the reader pressed a button next to a name, so the receipt
 * names the thing they pressed it on rather than saying 「done」 about a list.
 *
 * `notDeleted` is the case that looks most like a bug and is not: the short
 * number the reader clicked now names a row that is still ON THE LIST. A number
 * is reused the moment a row is erased, so `#12` a moment later can be somebody
 * else's note. The host refuses rather than destroys the wrong row, and the
 * panel's whole job is to say THAT instead of either erasing it or reporting a
 * failure the reader cannot act on.
 *
 * NEITHER is the honest third answer: the host heard the question, the name held
 * nothing to erase, and the archive no longer has that row. That is not an error
 * — the reader wanted it gone and it is gone — so it gets a receipt, not a
 * refusal.
 */
export type PurgeReply =
  | { readonly ok: true; readonly erased: ItemRecord | undefined; readonly notDeleted: boolean; readonly revision: number }
  | { readonly ok: false; readonly why: string }

/**
 * Destroy one archived row for good, tombstone included.
 *
 * The one action on this surface with no way back, which is why it lives in the
 * archive rather than in the row menu: a reader who has to walk to the account of
 * their deletions has at least read the thirty-day sentence on the way.
 * @param address - the row's own id, or its short number. See {@link RestoreAddress}.
 * @param clientId - this device's id, which every write on this prefix carries.
 * @param fetchImpl - injected for tests.
 * @returns what the host did, in the three shapes above.
 */
export async function itemsPurge(
  address: RestoreAddress,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PurgeReply> {
  const reply = await postToArchive('purge', address, clientId, fetchImpl)
  if (!reply.ok) return reply
  return {
    ok: true,
    erased: archivedRow(reply.value.erased) ? reply.value.erased : undefined,
    notDeleted: reply.value.notDeleted === true,
    revision: reply.revision,
  }
}
