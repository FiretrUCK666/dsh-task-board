import type { TaskRecord } from '../../core/tasks.ts';
import { type CardPrimary, type CardSessionDot, type CardViewModel } from './card-view.ts';
/**
 * The primary chip's words — THE label grammar for the card's one loudest
 * line. One function so 「等待回应 · 提问」 and 「待处理 3」 (several
 * conversations blocked at once) cannot be spelled two ways, and so a surface
 * that needs the same words without the chip gets them from here.
 */
export declare function primaryChipLabel(primary: CardPrimary): string;
/** The settled-run count label: "N 次执行" / "N runs". */
export declare function settledChipLabel(runs: number): string;
/** One card in a column — a PURE state summary: title, description, source
 *  line (workspace / bound session), the updated stamp, and the status chips
 *  (what the task IS doing: running / waiting / scheduled / chaining / failed
 *  paused / queued / new). The run window (start/end/duration) and
 *  the comment timeline live in the detail — cards never carry content that
 *  belongs to the conversation pages. */
export declare function TaskCard({ task, selected, workspaceTitleOf, boundTitleOf, pendingTitle, view, onMoveStep, onClick, onQuickRun, onColorPick, dots, overflowDots, nextAction, dotTitleOf }: {
    task: TaskRecord;
    /** Whether the card is picked in multi-select (Ctrl/Cmd+click or organize mode). */
    selected?: boolean;
    /** Resolve a workspace id to its display title (raw id when unknown). */
    workspaceTitleOf: (workspaceId: string) => string;
    /** Resolve a bound session's display title (session-bound tasks show their
     *  session identity, not the default workspace label). */
    boundTitleOf?: (task: TaskRecord) => string;
    /** Tooltip detail listing which conversation waits on what. */
    pendingTitle: string;
    /**
     * THE card summary (card-view.ts): every chip, the breath and the run guard
     * read fields from it. The component derives nothing of its own — that split
     * is what let the card's own priority ranking and its rendered ranking drift
     * apart, and let a failure the model could not see print no word at all.
     */
    view: CardViewModel;
    onClick: (event: React.MouseEvent) => void;
    /** Optional hover quick-action: run the task right from the card (rerun
     *  semantics, same run guard; disabled while a run is open). */
    onQuickRun?: () => void;
    /** Keyboard column step: -1 = one column left, +1 = one column right, along
     *  the board's own COLUMNS order. The caller resolves it through the same
     *  `resolveCardDrop` a drag uses, so the keyboard cannot reach a move the
     *  pointer would refuse. Absent = no keyboard moves (read-only surfaces). */
    onMoveStep?: (direction: -1 | 1) => void;
    /** Optional hover quick-action: pick a card color right from the card. */
    onColorPick?: (color: string | undefined) => void;
    /** Related-session dots (max 3 rendered, overflow counted separately). */
    dots?: readonly CardSessionDot[];
    /** Overflow session count beyond `dots` (+N). */
    overflowDots?: number;
    /** One quiet next-action sentence (localized by the caller). */
    nextAction?: string;
    /** Tooltip for a session dot (session title + state). */
    dotTitleOf?: (sessionId: string) => string;
}): import("react").JSX.Element;
