/**
 * Pending `ask_user_question` answers over the official mirror.
 *
 * The waterfall is a CLAIM chain (first answer wins, never a broadcast), so the
 * board never registers its own answerer — it settles the official carrier it
 * received from the uiSession session-status snapshot, in that session's
 * `pendingInteraction` field (see question-mirror.ts). This module keeps the wire model (frame
 * normalization, the per-rpcId pending projection, answer assembly and the
 * plan-review grammar) shared by both the legacy tracker path and the mirror
 * path. Framework-free and DOM-free, so the rules unit-test in isolation. The
 * live stream and the wire calls live in the client tracker; the controller
 * exposes a thin `QuestionRpcFace`.
 *
 * Frame identity: the host mints one rpcId per open `ask()` and replays it
 * verbatim on reconnects (refresh-recovery baseline), so the answer echoes
 * the requested frame's rpcId, never a minted one.
 */
/** One normalized question item (unknown shapes trimmed to the wire contract). */
export interface WireQuestionItem {
    /** Stable caller-provided question id, echoed in the answer. */
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
    /** Plan-review intent: the question IS a plan awaiting confirmation. */
    intent?: {
        kind: 'plan-review';
        approve: string;
    };
}
/** One pending question batch on the wire, keyed for answering. */
export interface WireQuestion {
    /** The host-minted rpcId the answer must echo. */
    rpcId: string;
    /** The session the question was asked in. */
    sessionId: string;
    /** The whole question batch (one ask, many questions, one answer). */
    questions: readonly WireQuestionItem[];
    /** True when any question declares a plan-review intent. */
    isPlanReview: boolean;
}
/** One question's local draft: selections + optional free text. */
export interface QuestionDraft {
    selected: string[];
    custom?: string;
    /** Explicitly skipped (submitted as an empty selection). */
    skipped?: boolean;
}
/** One answered question in the answer batch (skip = empty selected). */
export interface QuestionAnswerEntry {
    id: string;
    selected: string[];
    custom?: string;
}
/** The legacy frames this model consumes (narrowed structural slices). */
export type QuestionFrameIn = {
    type: 'question/requested';
    rpcId: string;
    sessionId: string;
    questions: unknown;
} | {
    type: 'question/resolved';
    questionRpcId: string;
};
/** Plan-review decision a UI can send (see planDecisionAnswers). */
export type PlanDecision = 'approve' | 'decline';
/**
 * The waiting kind of one session — the `kind` discriminator the official
 * session-status snapshot publishes on a session's `pendingInteraction`:
 * `question` / `plan-review` from the user-questions domain, `approval` from
 * the approval domain (plan-review outranks the rest when several domains
 * wait — the host resolves precedence before publishing). The same three the
 * native sidebar's amber dot derives from. A kind outside this set is a
 * domain this board cannot name and reads as "not waiting" rather than
 * guessing a label.
 */
export type PendingInteractionKind = 'approval' | 'plan-review' | 'question';
/** The controller's thin question surface (implemented by the official mirror
 *  or the legacy tracker; absent when the host wire is unavailable — surfaces
 *  then hide the card). On 0.1.5 the mirror IS able to answer in place
 *  (`answerInPlace` is true while the official snapshot publishes an
 *  interactive carrier): it settles the very request the native composer
 *  holds, without registering a second answerer. A snapshot entry that
 *  carries data but no action keeps `answerInPlace` false and the card
 *  degrades to navigate-to-answer. */
export interface QuestionRpcFace {
    /** The pending wire question for one session (newest wins), if any. */
    pendingOf(sessionId: string | undefined): WireQuestion | undefined;
    /** React to pending-question changes (requested/resolved frames). */
    subscribe(listener: () => void): () => void;
    /**
     * The waiting kind of one session (the SIGNAL half of the same official
     * snapshot this face reads — content above, waiting here), absent when the
     * session is not waiting. This is THE source cards, bells, session rows and
     * the live state read; a face that cannot observe waiting omits it and the
     * board honestly shows no waiting state.
     */
    waitingKindOf?(sessionId: string | undefined): PendingInteractionKind | undefined;
    /** Whether the board answers in place (false = navigate to answer). */
    readonly answerInPlace?: boolean;
    /** Deliver the whole answer batch; false = refused, stale or unavailable
     *  (the card stays open and shows the reason — never a silent close). */
    answer(rpcId: string, sessionId: string, answers: readonly QuestionAnswerEntry[]): Promise<boolean>;
    /** Reject the whole ask (the host resolves the tool call as cancelled). */
    cancel(rpcId: string): Promise<boolean>;
}
/** Whether a raw item is a plan review whose body lives in `detail` alone:
 *  intent-tagged plan-review + non-empty detail (mirrors the official
 *  planReviewOf narrowing — question text is NOT required there). Shared by
 *  the legacy wire normalizer below and the official-snapshot mirror, so a
 *  detail-carried plan is never silently dropped on either path. */
export declare function isDetailOnlyPlanItem(value: unknown): boolean;
/** Normalize one wire question item; drop anything malformed. */
export declare function normalizeWireQuestion(value: unknown): WireQuestionItem | undefined;
/** Normalize a whole wire question list; undefined when nothing is usable. */
export declare function wireQuestionsOf(value: unknown): WireQuestionItem[] | undefined;
/** Immutable application of one legacy frame onto the pending map (same map on no-op). */
export declare function reduceQuestionFrames(pending: ReadonlyMap<string, WireQuestion>, frame: QuestionFrameIn): ReadonlyMap<string, WireQuestion>;
/** The pending wire question for one session (newest wins), when any. */
export declare function pendingQuestionOf(pending: ReadonlyMap<string, WireQuestion>, sessionId: string | undefined): WireQuestion | undefined;
/** The plan-review question of a batch, when the batch IS a plan review. */
export declare function planQuestionOf(question: WireQuestion): WireQuestionItem | undefined;
/** The approve label of a plan-review question (the intent names it). */
export declare function approveLabelOf(item: WireQuestionItem | undefined): string | undefined;
/** The decline label of a plan-review question (first non-approve option). */
export declare function declineLabelOf(item: WireQuestionItem | undefined): string | undefined;
/**
 * The answer batch for a plan-review decision.
 * - approve: select the intent's approve label;
 * - decline without amendments: select the first non-approve option;
 * - decline with amendments: revise-with-feedback — a custom-only answer
 *   (host validation forbids a single-select option alongside custom text).
 */
export declare function planDecisionAnswers(item: WireQuestionItem, decision: PlanDecision, amend: string): QuestionAnswerEntry[];
/**
 * The whole answer batch from per-question drafts: one entry per question,
 * in batch order, ids matching the requested frame (a skipped question is an
 * empty selection; a missing answer is a server-side rejection, never sent
 * silently). Custom text rides alongside selections only for multi-select.
 */
export declare function answerBatchOf(question: WireQuestion, drafts: readonly QuestionDraft[]): QuestionAnswerEntry[];
