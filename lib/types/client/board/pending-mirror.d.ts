/**
 * Official pending-interaction mirror: the 0.1.5 question face.
 *
 * The waterfall is a claim chain (first answer wins), so the board never
 * registers its own listener and never answers — it only SUBSCRIBES to the
 * official uiSession `pendingInteractions` snapshot the host already
 * projects (the same source the native sidebar and composer read). Answers
 * stay in the native session; the board navigates there.
 *
 * The controller keeps consuming the historical `QuestionRpcFace`
 * (WireQuestion), so this adapter normalizes the official carrier into that
 * shape: `key` becomes the display rpcId (never echoed to any wire — there
 * is no respond path), and `answer`/`cancel` always report false so the card
 * degrades to its navigate affordance. One instance per board mount.
 */
import type { QuestionAnswerEntry, QuestionRpcFace, WireQuestion } from '../../core/question-rpc.ts';
import { type MirrorSnapshotLike } from '../../core/question-mirror.ts';
/** The structural slice of the official uiSession face this mirror reads. */
export interface UiSessionMirrorFace {
    readonly pendingInteractions: {
        getSnapshot(): ReadonlyMap<string, unknown>;
        subscribe(listener: () => void): () => void;
    };
}
/** Read-only QuestionRpcFace over the official pending snapshot. */
export declare class PendingMirror implements QuestionRpcFace {
    private readonly uiSession;
    /** The board never answers in place on 0.1.5 (navigate to answer). */
    readonly answerInPlace: false;
    private pending;
    constructor(uiSession: UiSessionMirrorFace | undefined);
    /** Re-read the official snapshot (call on every subscribe notification). */
    refresh(): void;
    pendingOf(sessionId: string | undefined): WireQuestion | undefined;
    subscribe(listener: () => void): () => void;
    answer(_rpcId: string, _sessionId: string, _answers: readonly QuestionAnswerEntry[]): Promise<boolean>;
    cancel(_rpcId: string): Promise<boolean>;
}
export type { MirrorSnapshotLike };
