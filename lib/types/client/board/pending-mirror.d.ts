/**
 * Official pending-interaction mirror: the current question face.
 *
 * The waterfall is a claim chain (first answer wins), so the board never
 * REGISTERS a listener of its own — it subscribes to the official uiSession
 * session-status snapshot (the same source the native sidebar and composer
 * read) and, while an entry is live, it holds the carrier object that entry
 * carries.
 *
 * That carried object IS the native `PendingQuestion`: its `answer(answer)`
 * and `cancel()` settle the very waterfall invocation the native composer
 * would settle (verified against the shipped plugin: the carrier exposes
 * `sessionId / kind / key / questions` plus those two methods, and the
 * client-side listener's return value resolves the host call). Answering
 * through it is therefore NOT a competing answerer — nothing new is
 * registered, the same claim is settled once, and the other surface's card
 * drops with the next snapshot notification. In-place answering is offered
 * only for a carrier that really exposes those methods; a host whose
 * snapshot entries carry data but no action (or no uiSession at all) keeps
 * the read-only navigate shell.
 *
 * ENVELOPE (this module is the ONE place the plugin knows it): the host
 * publishes a per-session STATUS map, not a bare interaction map —
 * `sessionStatus: Map<sessionId, { running, pendingInteraction, completionUnread }>`,
 * carrying every session (running and idle alike). The board wants only the
 * pending-interaction half, so {@link pendingOnly} unwraps that ONE layer
 * here and everything downstream still speaks the carrier vocabulary it
 * always spoke. A future envelope change lands in that function alone.
 */
import type { QuestionAnswerEntry, QuestionRpcFace, WireQuestion } from '../../core/question-rpc.ts';
import { type MirrorSnapshotLike } from '../../core/question-mirror.ts';
/**
 * The action half of an official carrier, when the entry has one. Read
 * structurally (never `instanceof` across the plugin boundary): the shipped
 * native `PendingQuestion` exposes both, a snapshot entry that does not is
 * display-only and degrades to the navigate shell.
 */
export interface MirrorCarrierActions {
    answer(answer: {
        answers: readonly QuestionAnswerEntry[];
    }): Promise<unknown> | unknown;
    cancel(): Promise<unknown> | unknown;
}
/** The structural slice of the official uiSession face this mirror reads. */
export interface UiSessionMirrorFace {
    readonly sessionStatus: {
        getSnapshot(): ReadonlyMap<string, unknown>;
        subscribe(listener: () => void): () => void;
    };
}
/** In-place answering over the official pending snapshot (see module doc). */
export declare class PendingMirror implements QuestionRpcFace {
    private readonly uiSession;
    constructor(uiSession: UiSessionMirrorFace | undefined);
    /**
     * The current projection, DERIVED on every read from the official snapshot
     * — there is no cached copy that a missed notification could leave stale,
     * so "what the card shows" and "what an answer settles" are always the same
     * generation of the snapshot.
     */
    private get entries();
    pendingOf(sessionId: string | undefined): WireQuestion | undefined;
    /**
     * Whether ANY live interaction can be settled from here. Read fresh by the
     * card on every render: a data-only snapshot entry (no `answer`/`cancel`)
     * keeps the read-only navigate shell, so "can answer" is never claimed for
     * a carrier that cannot.
     */
    get answerInPlace(): boolean;
    subscribe(listener: () => void): () => void;
    /**
     * Settle the session's live request with the whole answer batch. The
     * identity guard is the contract: the answered carrier must be the SAME
     * object (key and identity) the official snapshot publishes RIGHT NOW — a
     * request answered or cancelled elsewhere, or replaced by a newer one,
     * rejects instead of settling something stale. False = not accepted; the
     * card keeps itself open and reports it.
     */
    answer(rpcId: string, sessionId: string, answers: readonly QuestionAnswerEntry[]): Promise<boolean>;
    /** Reject the whole ask (the tool call settles as cancelled, like the native ×). */
    cancel(rpcId: string): Promise<boolean>;
}
export type { MirrorSnapshotLike };
