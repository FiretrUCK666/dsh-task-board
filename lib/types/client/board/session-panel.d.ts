/**
 * Shared session-panel components: the right-rail building blocks that every
 * session surface composes — the execution review page (ReviewDetail) and the
 * linked-session panel (SessionDetail). Each block is small and self-contained; the callers own
 * their rail layout and their semantic differences (a drive composer vs a
 * direct composer are deliberately NOT shared here — see the two panels).
 *
 * Everything reads the same session-generic faces (sessionInfo,
 * sessionConfig, transcript projections), so any block works for any native
 * session id.
 */
import { type ReactNode } from 'react';
import type { BoardController, PendingInteractionKind, TranscriptProjectionsShape } from '../../core/controller.ts';
import type { WireQuestion } from '../../core/question-rpc.ts';
import { type AgentPresetLabelSource } from '../../core/session-agents.ts';
import type { TaskRecord } from '../../core/tasks.ts';
import { type TranscriptLine } from './review-transcript.ts';
import { type ChipKind } from './Chip.tsx';
import type { CommentView } from './comment-thread.ts';
import { type DraftFile, type DraftImage } from './attach.ts';
import { type FileStager } from './composer-images.ts';
/**
 * The shared transcript-region content: optional header (the review page's
 * outcome banner), the waiting banner, error/loading/empty states, the
 * folded message list (optionally capped to the trailing N, with the native
 * "load earlier" affordance above it when the host holds older messages)
 * and the "滑到最新" pill. Callers own their scroll region and the tail
 * hook; this is pure rendering, so every live session surface looks and
 * behaves identically.
 */
export declare function SessionTranscript({ lines, error, atBottom, jumpToBottom, waiting, maxLines, hasMore, loadingEarlier, pageError, pageUnsupported, onLoadEarlier, before, onRetry, sessionId, controller }: {
    lines: readonly TranscriptLine[] | undefined;
    error: boolean;
    atBottom: boolean;
    jumpToBottom: () => void;
    waiting?: PendingInteractionKind;
    /** Render only the trailing N lines (a capped preview surface's cap). */
    maxLines?: number;
    /** The host holds messages older than the loaded window. */
    hasMore?: boolean;
    /** An earlier page is being fetched right now. */
    loadingEarlier?: boolean;
    /** The last earlier-page read failed (the button stays — tapping retries). */
    pageError?: boolean;
    /** The deployment serves no page endpoint (the button goes away — retrying is pointless). */
    pageUnsupported?: boolean;
    /** Prepend one earlier page above the window (the native grammar). */
    onLoadEarlier?: () => void;
    /** Optional header content inside the region (the review page's outcome banner). */
    before?: ReactNode;
    /** Re-read the tail (the error state's retry — a timeout/unavailable read
     *  must never be a dead end; the caller wires this to the hook's reload). */
    onRetry?: () => void;
    /** The session the tail belongs to + the controller (message images read
     *  their bytes through the official attachment RPC; absent = refs only). */
    sessionId?: string;
    controller?: BoardController;
}): import("react").JSX.Element;
/** One waiting banner, shared by every session surface. */
export declare function SessionWaitingNotice({ waiting }: {
    waiting: PendingInteractionKind | undefined;
}): import("react").JSX.Element | null;
/**
 * The session's real workspace + composed Agent: read-only value rows INSIDE
 * the live config grid (the same row grammar as the model/effort/permission
 * selects, same field order as the task detail's 运行配置) — one module,
 * no separate facts strip, no explanatory paragraph. A value row renders in
 * the same box geometry as a select, so the read-only meaning is carried by
 * the absence of a dropdown affordance, never by prose.
 */
export declare function SessionFacts({ info, agentPresets }: {
    info: {
        cwd?: string;
        agentPreset?: string;
    } | undefined;
    agentPresets?: readonly AgentPresetLabelSource[];
}): import("react").JSX.Element | null;
/** Sum of the transcript's token accounting (the meter's fallback strip). */
interface SessionUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
}
/**
 * The context meter block: native occupancy figure + colored composition
 * bar (from the transcript projections), the cumulative whole-log token
 * totals (from the `tokenUsage` projection — durable, not the paged-window
 * sum below), the whole-log turn/step figures (from `sessionStats`), or the
 * token-sum fallback strip when no projection is served. A high-occupancy
 * state (>= 85%) shifts the reading to the attention tone — the same warn
 * grammar as every board signal.
 */
export declare function ContextMeterPanel({ projections, usage }: {
    projections: TranscriptProjectionsShape | undefined;
    usage: SessionUsage | undefined;
}): import("react").JSX.Element | null;
/**
 * The live session-config editor: model / reasoning effort / permission of
 * any native session, straight from the native APIs (the same sources the
 * harness's own selectors read). Permission applies through the native
 * `/permission` command registry — never a model turn. Self-contained: it
 * loads the model directory on mount and refreshes after every change; the
 * caller may bump `reloadKey` to force a re-read.
 */
export declare function SessionConfigEditor({ sessionId, controller, onChanged, reloadKey }: {
    sessionId: string;
    controller: BoardController;
    /** Fired after a successful change (the caller refreshes its transcript). */
    onChanged?: () => void;
    /** A value whose change forces a full re-read of the model directory. */
    reloadKey?: unknown;
}): import("react").JSX.Element | null;
/**
 * The rail head BODY: context meter + live config editor + session facts,
 * composed in the order every session panel shows them. SessionRail renders
 * it inside the shared Disclosure (the fold + chevron grammar) within the
 * rail's single scroll body; callers pass what they read from their
 * transcript hook (projections via onResult, folded lines). The permission
 * switcher's projection mapping is derived HERE — one source for every panel
 * (a caller-level mapping is how the linked panel lost it).
 */
export declare function SessionRailHead({ sessionId, controller, projections, lines, onChanged, reloadKey }: {
    sessionId: string | undefined;
    controller: BoardController;
    projections: TranscriptProjectionsShape | undefined;
    /** The folded transcript lines (token-accounting fallback for the meter). */
    lines: readonly TranscriptLine[] | undefined;
    onChanged?: () => void;
    reloadKey?: unknown;
}): import("react").JSX.Element | null;
/**
 * THE session rail — the one composition every session panel renders (the
 * execution review page and the linked-session panel share it verbatim), and
 * THE height contract that ends the squeeze-and-clip family of bugs.
 *
 * It hands its caller TWO blocks, never four:
 *
 *   [ folds: live state row → collapsible CONFIG head → collapsible COMMENTS ]
 *   [ the caller's pinned composer                                           ]
 *
 * Desktop geometry: the rail is a flex column — the folds block absorbs the
 * height (its comments region owns the one scroll box inside it) and the
 * composer is `flex: none` below, so nothing can push the send box away.
 *
 * Narrow geometry (the panel's own container query): the rail box steps aside
 * (`display: contents`) and the panel becomes a THREE-ROW grid —
 * `folds / transcript / composer`. That is the whole fix for 「上下文一多就把
 * 评论和留言按钮全部截断」:
 *   - the folds block is capped (a fraction of the panel) and bounds a fully
 *     rendered head, so an expanded config can never eat the screen;
 *   - the comments box owns its capped scroll at every width (one grammar —
 *     滑到最新 drives it, desktop and phone);
 *   - the transcript owns the flexible middle row and always keeps room;
 *   - the composer is its own grid row at the panel's bottom edge — not the
 *     last item in someone else's scroll content (which is exactly how it used
 *     to end up below the fold, unreachable).
 * Because the folds block is capped and the comments box scrolls inside
 * its own cap, opening one fold never reflows the other, and 滑到最新
 * drives the box that actually holds the comments — at every width.
 *
 * Callers pass data and their send semantics; the grammar, the folds and the
 * hint line live here exactly once — no panel can drift again.
 */
export declare function SessionRail({ stateChip, updatedAt, sessionId, controller, projections, lines, onChanged, reloadKey, task, thread, onCancelComment, interaction, shellWaiting, composer }: {
    /** The live state row (chip + updated time); absent hides the whole row. */
    stateChip?: {
        kind: ChipKind;
        label: string;
        spinner?: boolean;
    };
    updatedAt?: string;
    sessionId: string | undefined;
    controller: BoardController;
    projections: TranscriptProjectionsShape | undefined;
    lines: readonly TranscriptLine[] | undefined;
    onChanged?: () => void;
    reloadKey?: unknown;
    task: TaskRecord;
    thread: readonly CommentView[];
    onCancelComment: (roundId: string) => boolean;
    /** The pending native question (plan confirm / ask); absent hides the card. */
    interaction: WireQuestion | undefined;
    /** Proven wait without parsed content (carrier-shape backstop): renders the
     *  honest shell card instead of blank nothing. Absent with `interaction`. */
    shellWaiting?: 'plan-review' | 'question';
    /** The pinned composer (the panel's send semantics stay in the caller). */
    composer: ReactNode;
}): import("react").JSX.Element;
/**
 * The pinned composer of the rail — one grammar for every session panel:
 * prompt input (slash autocomplete) + attachment strip + send-mode switch
 * (排队/插话) + the primary send button + ONE quiet line under it.
 *
 * The explanation line belongs to the COMPOSER, not to the comment thread:
 * what 排队/插话 do, and why sending is refused (a finished task, a gone
 * session), is information a touch user must be able to reach — it can never
 * live only in a foldable explanation or a hover-only tooltip. Draft / steer
 * here (the per-session draft slot, shared across panels); the caller
 * supplies only the send semantics:
 *   - onDrive(text, images, files) schedules a session-anchored comment round
 *     (true = saved, the draft clears) — / commands route through the native
 *     registry; attachments ride the round and go out WITH it when the lane
 *     frees (排队 means wait, with or without attachments);
 *   - onSteer(text) delivers the comment straight to the session now;
 *   - onSteerImages(text, images) delivers text + images at once (插话 with a
 *     picture); onSteerFiles(text, images, files) the same with files. The
 *     send mode is the user's toggle — attachments never force steer.
 */
/** Stage one file's bytes on a session via the controller's upload face. */
export declare function useFileStager(controller: BoardController, sessionId: string | undefined): FileStager | undefined;
export declare function SessionComposer({ controller, taskId, sessionId, placeholder, disabled, hint, onDrive, onSteer, onSteerImages, onSteerFiles }: {
    controller: BoardController;
    taskId: string;
    sessionId: string | undefined;
    placeholder: string;
    /** Extra rejection state (done task / gone session): blocks the send. */
    disabled?: boolean;
    /** The composer's own explanation (blocking reason, or the drive hint). */
    hint?: string;
    onDrive: (text: string, images: readonly DraftImage[], files: readonly DraftFile[]) => boolean;
    onSteer: (text: string) => Promise<boolean>;
    onSteerImages: (text: string, images: readonly DraftImage[]) => Promise<boolean>;
    /** Steer with staged files (absent = this surface closes the file lane). */
    onSteerFiles?: (text: string, images: readonly DraftImage[], files: readonly DraftFile[]) => Promise<boolean>;
}): import("react").JSX.Element;
export {};
