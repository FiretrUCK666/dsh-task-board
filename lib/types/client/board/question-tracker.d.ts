/**
 * Legacy live tracker for pending native questions: opens one live stream
 * (pre-0.5 hosts replay every still-pending question frame on a new stream,
 * then push live frames), reduces them into the pure pending map, and
 * answers/cancels through the same `respond` wire call the native composer
 * uses. On 0.1.5 the stream is gone and the board settles the official
 * carrier instead (`pending-mirror.ts`); this tracker stays as the fallback
 * while no uiSession face is served. One instance per board mount —
 * every surface (review page, session panel) reads the same
 * projection by session id, so answering on one surface is instantly
 * reflected everywhere, and the card disappears when the host resolves the
 * call (question/resolved frame).
 */
import type { IApiClient } from '../platform.ts';
import { type PendingInteractionKind, type QuestionAnswerEntry, type QuestionRpcFace, type WireQuestion } from '../../core/question-rpc.ts';
/** Open lazily on first reader; frames flow only while someone consumes. */
export declare class QuestionTracker implements QuestionRpcFace {
    private readonly api;
    private pending;
    private readonly listeners;
    /** Raw session-event fan-out (the legacy stream's `session/event` frames):
     *  the board's legacy native-turn channel (see controller.recordNativeTurn). */
    private readonly sessionListeners;
    private controller;
    private reconnectTimer;
    constructor(api: IApiClient);
    /**
     * Observe raw native session events as they stream in (every session, live
     * — the stream replays only pending approval/question frames, so listeners
     * never see history re-fired). @returns the disposer.
     */
    addSessionListener(listener: (sessionId: string, event: unknown) => void): () => void;
    /** Start the live stream once (idempotent); aborts on teardown. */
    start(): void;
    /** Close the stream and clear all listeners (plugin teardown). */
    dispose(): void;
    private pump;
    private apply;
    pendingOf(sessionId: string | undefined): WireQuestion | undefined;
    /**
     * The waiting kind from the legacy wire: question frames only — the old
     * stream replays questions, so an approval wait has no observation point
     * here and reads as not waiting (an honest absence, never a guessed label).
     */
    waitingKindOf(sessionId: string | undefined): PendingInteractionKind | undefined;
    subscribe(listener: () => void): () => void;
    answer(rpcId: string, sessionId: string, answers: readonly QuestionAnswerEntry[]): Promise<boolean>;
    cancel(rpcId: string): Promise<boolean>;
    /** The one wire boundary: POST /api/respond with the client-response form. */
    private respond;
}
