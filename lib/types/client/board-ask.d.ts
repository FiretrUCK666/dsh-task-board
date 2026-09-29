/**
 * What the panel sends.
 *
 * `id` is how a row is ADDRESSED and `ref` is how it is NAMED, and they are not
 * the same name. A row the document has not numbered yet carries `ref === 0`, so
 * asking by number asks for 「the first row whose number is zero」 — and
 * `.find()` answers that with the FIRST unnumbered row in the document, which is
 * not necessarily the reader's. That hands a stranger's note to a model while the
 * reader watches their own row go into the box, which is the worst shape this
 * surface can fail in.
 *
 * So the panel sends the identity it is holding, exactly as `itemsRestore`
 * already does, and the host prefers it. `ref` stays because the MODEL only
 * ever holds a number — it reads a receipt — and a request that arrives with a
 * number of zero is refused rather than resolved, so the ambiguous case can
 * never be silently answered with the wrong row.
 */
export interface AskRequestBody {
    readonly taskId: string;
    readonly id: string;
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
