import type { ItemRecord } from '../core/item.ts';
/**
 * HOW LONG A TOMBSTONE HAS LEFT, read from the stamp the host keeps.
 *
 * The tombstone's deletion instant is a field of the HOST's tombstone map, and
 * it rides on each row the archive read answers with. A row without one (an
 * older host, a row the client wrote into a commit) has no clock to read, and
 * 「读不到就说读不到」 applies: the caller draws the row without the sentence
 * rather than guessing a date.
 */
export declare function archiveClockOf(row: ItemRecord, now: number): {
    readonly gone: number;
    readonly left: number;
} | undefined;
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
export type PurgeReply = {
    readonly ok: true;
    readonly erased: ItemRecord | undefined;
    readonly notDeleted: boolean;
    readonly revision: number;
} | {
    readonly ok: false;
    readonly why: string;
};
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
export declare function itemsPurge(address: RestoreAddress, clientId: string, fetchImpl?: typeof fetch): Promise<PurgeReply>;
