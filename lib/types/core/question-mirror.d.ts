/**
 * Official pending-interaction read model (the answer side).
 *
 * The waterfall (`user-questions/request`) is a CLAIM chain, not a broadcast:
 * the board must never register its own listener (it would race the native
 * composer). The official read-only projection is the uiSession session-status
 * snapshot, whose per-session `pendingInteraction` field carries the live
 * request, and each interaction carries its session, kind and full question
 * batch — AND, on the shipped host, the carrier's own `answer`/`cancel` (the
 * native `PendingQuestion`). The board subscribes to that snapshot for DISPLAY
 * and, when the carrier exposes those actions, settles the request through the
 * very object it received: same claim, no second answerer, so the two surfaces
 * can never disagree about who answered. A carrier without them is display-only
 * and the card degrades to navigate-to-answer.
 *
 * Framework-free and DOM-free, so the rules unit-test in isolation (the live
 * subscription and the action calls live in the client adapter).
 */
/** The three waiting kinds the native session rows surface. */
export type MirrorWaitingKind = 'approval' | 'plan-review' | 'question';
/** One normalized question item (unknown shapes trimmed to the wire contract). */
export interface MirrorQuestionItem {
    /** Stable caller-provided question id. */
    id: string;
    /** The question to display. */
    question: string;
    /** Optional supporting detail (kept out of option labels). */
    detail?: string;
    /** Optional short heading/group label. */
    header?: string;
    /** Optional choices a capable UI can render as a menu. */
    options?: readonly {
        label: string;
        description?: string;
    }[];
    /** Whether more than one option may be selected (defaults to single). */
    multiSelect?: boolean;
}
/** One pending question batch on the official mirror, keyed for display. */
export interface MirrorQuestion {
    /** The mirror render identity (the official carrier key). */
    key: string;
    /** The session the question was asked in. */
    sessionId: string;
    /** The whole question batch (one ask, many questions). */
    questions: readonly MirrorQuestionItem[];
    /** True when the batch IS a plan review (single intent-tagged question). */
    isPlanReview: boolean;
}
/**
 * What the comment interface shows for a session's wait: parsed content, or
 * — when the session list proves a plan/question wait but no content parsed —
 * an honest shell (kind + navigate) instead of blank nothing. The shell is
 * the backstop against any future carrier-shape drift: a proven wait can
 * never again reach the UI as silence.
 */
export type AwaitingCard<T = MirrorQuestion> = {
    type: 'content';
    question: T;
} | {
    type: 'shell';
    waitingKind: 'plan-review' | 'question';
};
/** Fold one session's wire content + waiting signal into its card (pure). */
export declare function awaitingOf<T>(question: T | undefined, waitingKind: MirrorWaitingKind | undefined): AwaitingCard<T> | undefined;
/** The structural slice of an official interaction the mirror reads. */
export interface MirrorInteractionLike {
    readonly key?: unknown;
    readonly kind?: unknown;
    readonly sessionId?: unknown;
    readonly questions?: unknown;
}
/** The structural slice of the official pending snapshot. */
export type MirrorSnapshotLike = ReadonlyMap<string, MirrorInteractionLike>;
/**
 * Normalize one mirror question item; drop anything malformed. Same grammar
 * as the historical wire model (question-rpc.ts): the question text is
 * mandatory — EXCEPT a detail-carried plan review (see isDetailOnlyPlanItem),
 * whose body lives in `detail` by official contract.
 */
export declare function normalizeMirrorQuestion(value: unknown): MirrorQuestionItem | undefined;
/** Normalize a whole mirror question list; undefined when nothing is usable. */
export declare function mirrorQuestionsOf(value: unknown): MirrorQuestionItem[] | undefined;
/**
 * Whether an official mirror interaction is a question the board renders:
 * the carrier kind is `question` or `plan-review` (never `approval` — the
 * approval card belongs to the native surface).
 */
export declare function isMirrorQuestionKind(kind: unknown): boolean;
/**
 * Normalize one official mirror interaction into the board's display model;
 * undefined when it is not a renderable question batch (approval carriers,
 * malformed shapes, empty batches). The key falls back to the map key so a
 * carrier without one still renders stably.
 */
export declare function mirrorQuestionOf(sessionId: string, mapKey: string, interaction: MirrorInteractionLike | undefined): MirrorQuestion | undefined;
/**
 * The pending mirror question for one session, when any. The snapshot is
 * keyed BY SESSION, so at most one interaction wins per session upstream —
 * the newest renderable entry wins here.
 */
export declare function pendingMirrorOf(snapshot: MirrorSnapshotLike | undefined, sessionId: string | undefined): MirrorQuestion | undefined;
/**
 * The waiting kind of one session from the official mirror: a question batch
 * reads as `question`/`plan-review` (the kind string), an approval carrier
 * reads as `approval`, anything else is not waiting. This is the SAME signal
 * the native sidebar consumes — the board's waiting display and the native
 * one can never disagree again.
 */
export declare function mirrorWaitingOf(snapshot: MirrorSnapshotLike | undefined, sessionId: string | undefined): MirrorWaitingKind | undefined;
