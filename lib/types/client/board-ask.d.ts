/** What the panel sends. Both are plain scalars, and both are the host's to check. */
export interface AskRequestBody {
    readonly taskId: string;
    readonly ref: number;
}
/**
 * The host's answer, narrowed to the two shapes it can actually return.
 *
 * `why` is a code rather than a sentence so the panel owns the wording (it is
 * translated, and the panel knows which case it is in); the host stays the one
 * that decides the FACT.
 */
export type AskReply = {
    readonly ok: true;
    readonly sessionId: string;
    readonly said: string;
} | {
    readonly ok: false;
    readonly why: string;
};
/**
 * Hand one item over.
 *
 * @param body - which card, which item.
 * @param fetchImpl - injected for tests.
 * @returns the host's answer, or a refusal that names the network rather than
 *   pretending the hand-off succeeded.
 */
export declare function itemsAsk(body: AskRequestBody, fetchImpl?: typeof fetch): Promise<AskReply>;
