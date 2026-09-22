/**
 * Session-state chip grammar — THE derivation of "what chip does this session
 * state render as", shared by every session surface: the task detail's run
 * rows and linked rows, the review page's state row and the linked panel's
 * state row. One kind/spinner mapping, and the only thing a surface chooses
 * is the SETTLED/IDLE label pair (a run row names the execution result, a
 * linked row names the bound session's activity) — so the chip grammar can
 * never drift again, and no surface hand-rolls `as 'waiting.approval'` casts.
 */
import type { PendingInteractionKind } from '../../core/controller.ts';
import { type TaskBoardKey } from '../locales.ts';
import type { ChipKind } from './Chip.tsx';
/** The live session state every row derives (execution kind). */
export type SessionRowState = 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
/** The chip's data (kind + label + spinner + optional explainer) — the row
 *  renders it; `title` carries the state's one-line meaning (hover). */
export type SessionChipShape = {
    kind: ChipKind;
    label: string;
    spinner?: boolean;
    title?: string;
};
/** The waiting-kind locale key, typed (never a string cast). */
export declare function waitingKeyOf(kind: PendingInteractionKind): TaskBoardKey;
/**
 * Why a session cannot be acted on, as ONE sentence — the shared read of
 * `controller.sessionAvailability` for every surface that used to say
 * 「该会话已不可用」 and nothing else.
 *
 * It exists because archiving stopped meaning "gone" once DSH shipped the
 * archive-restore page: an archived session is RECOVERABLE (设置 → 已归档会话 →
 * 取消归档) and returns to every surface at once, since all of them derive from
 * the one registry-global set. A deleted-from-this-card session is recoverable
 * too (drag it back). Only a session with no native summary left is honestly
 * unavailable. `undefined` = nothing to explain; the session is available.
 */
export declare function sessionUnavailableReasonOf(availability: 'visible' | 'archived' | 'removed' | 'gone'): string | undefined;
/**
 * The result → chip COLOR mapping — the one place that decides an execution
 * result's tint (failed red, succeeded green, cancelled/unknown muted). A
 * surface that carries its OWN settled label (the card's "N 次执行")
 * still takes its color from here, so the tint
 * can never drift from the state chip's.
 */
export declare function resultChipKind(result: 'succeeded' | 'failed' | 'cancelled' | undefined): ChipKind;
/**
 * The one chip derivation: waiting/running are live (warn + spinner, the
 * waiting label names the interaction kind); succeeded/failed/cancelled are
 * settled and take the caller's label pair (`settled` for succeeded — the
 * execution result vs the linked activity, `idle` for cancelled — a bound
 * session's no-activity state, a run's cancelled result). `idleTitle` is the
 * hover meaning of the IDLE label — only a linked row passes it (未运行 needs
 * the one-line explanation; a run's 已取消 is self-evident). Locale-free
 * logic stays in session-display; this is the presentation mapping only.
 */
export declare function sessionStateChip(state: SessionRowState, waitingKind: PendingInteractionKind | undefined, settled: TaskBoardKey, idle: TaskBoardKey, idleTitle?: TaskBoardKey): SessionChipShape;
