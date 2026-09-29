import type { ItemRecord } from '../core/item.ts';
/**
 * The host's answer, narrowed to the two shapes it can actually return.
 *
 * `why` is a code rather than a sentence so the panel owns the wording (it is
 * translated); the host stays the one that decides the FACT.
 */
export type ArchiveReply = {
    readonly ok: true;
    readonly deleted: readonly ItemRecord[];
} | {
    readonly ok: false;
    readonly why: string;
};
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
export declare function itemsArchive(fetchImpl?: typeof fetch): Promise<ArchiveReply>;
/** What a restore says back. `restored` absent means the row did NOT come back. */
export type RestoreReply = {
    readonly ok: true;
    readonly restored: ItemRecord | undefined;
} | {
    readonly ok: false;
    readonly why: string;
};
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
export type RestoreAddress = {
    readonly id: string;
} | {
    readonly ref: number;
};
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
export declare function itemsRestore(address: RestoreAddress, clientId: string, fetchImpl?: typeof fetch): Promise<RestoreReply>;
