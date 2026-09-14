import type { PendingInteractionKind } from '../../core/controller.ts';
import type { TaskLiveState } from '../../core/task-live.ts';
import type { TaskRecord } from '../../core/tasks.ts';
import { type CardSessionDot } from './card-view.ts';
/** The open run's state text: either working ("进行中") or blocked on the
 *  user ("等待回应 · 计划确认"). Pure so the chip composition is testable. */
export declare function runningStateLabel(waiting: PendingInteractionKind | undefined): string;
/** The settled-run count label: "N 次执行" / "N runs". */
export declare function settledChipLabel(runs: number): string;
/** Whether the card shows the blocked-automation chip: an armed rule that
 *  cannot drive anything (empty prompt — a reason, not a pause). Pure so the
 *  badge composition is testable; the title reuses the schedule summary
 *  grammar, which already names the blocking reason. */
export declare function showsBlockedChip(task: TaskRecord): boolean;
/** Whether any ENABLED session rule is blocked on the empty prompt (the
 *  session-rule twin of {@link showsBlockedChip}): a custom-instruction rule
 *  carries its own content and never reads the prompt, so only `usePrompt`
 *  rules count — read through the rule's own readiness, never re-derived. */
export declare function showsSessionBlocked(task: TaskRecord): boolean;
/** Whether the automation slot collapses to the single blocked chip: any
 *  blocked automation (task schedule or session rule) owns the slot — the
 *  schedule/chain/progress text yields instead of stacking four chips for
 *  one cause. THE priority table for the card's automation badges. */
export declare function blockedAutomation(task: TaskRecord): boolean;
/** One card in a column — a PURE state summary: title, description, source
 *  line (workspace / bound session), the updated stamp, and the status chips
 *  (what the task IS doing: running / waiting / scheduled / chaining / failed
 *  paused / queued / refining / new). The run window (start/end/duration) and
 *  the comment timeline live in the detail — cards never carry content that
 *  belongs to the conversation pages. */
export declare function TaskCard({ task, selected, workspaceTitleOf, boundTitleOf, waiting, pendingCount, pendingTitle, unviewed, unviewedCount, hasUnviewedRun, awaitingDecision, onMoveStep, onClick, onQuickRun, onColorPick, live, dots, overflowDots, nextAction, dotTitleOf }: {
    task: TaskRecord;
    /** Whether the card is picked in multi-select (Ctrl/Cmd+click or organize mode). */
    selected?: boolean;
    /** Resolve a workspace id to its display title (raw id when unknown). */
    workspaceTitleOf: (workspaceId: string) => string;
    /** Resolve a bound session's display title (session-bound tasks show their
     *  session identity, not the default workspace label). */
    boundTitleOf?: (task: TaskRecord) => string;
    /** The open run's session is blocked on the user (approval / plan review / question). */
    waiting?: PendingInteractionKind;
    /** How many sessions of this task are waiting on the user (executions + refine). */
    pendingCount: number;
    /** Tooltip detail listing which execution/session waits on what. */
    pendingTitle: string;
    /** Whether the task has content (settled run / comment / refine) newer than its last open. */
    unviewed: boolean;
    /** How many plain-run executions are unviewed (the "新 N" badge figure). */
    unviewedCount: number;
    /** Whether at least one of those unviewed items is a plain RUN (as opposed to
     *  comment-only activity). The card states a count only when a run is behind
     *  it, so "新 2" can never mean "two comments". Computed by the caller from the
     *  same source as `unviewedCount`, so the two can never disagree. */
    hasUnviewedRun?: boolean;
    /** A review task whose run has settled and no human has passed or sent it
     *  back: the plateau the board used to hide. Unlike `unviewed` it does not
     *  clear when the card is opened — reading is not deciding. */
    awaitingDecision?: boolean;
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
    /** THE live-state derivation (taskLiveStateOf, controller.liveStateOf):
     *  'running' = a related session is genuinely working (board run, direct
     *  steer, session rule, out-of-band chat). Absent = falls back to the
     *  status-based judgment (card used without a controller). */
    live?: TaskLiveState;
    /** Related-session dots (max 3 rendered, overflow counted separately). */
    dots?: readonly CardSessionDot[];
    /** Overflow session count beyond `dots` (+N). */
    overflowDots?: number;
    /** One quiet next-action sentence (localized by the caller). */
    nextAction?: string;
    /** Tooltip for a session dot (session title + state). */
    dotTitleOf?: (sessionId: string) => string;
}): import("react").JSX.Element;
