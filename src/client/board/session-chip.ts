/**
 * Session-state chip grammar — THE derivation of "what chip does this session
 * state render as", shared by every session surface: the task detail's run
 * rows and linked rows, the review page's state row and the linked panel's
 * state row. One kind/spinner mapping, and the only thing a surface chooses
 * is the SETTLED/IDLE label pair (a run row names the execution result, a
 * linked row names the bound session's activity) — so the chip grammar can
 * never drift again, and no surface hand-rolls `as 'waiting.approval'` casts.
 */
import type { PendingInteractionKind } from '../../core/controller.ts'
import { t, type TaskBoardKey } from '../locales.ts'
import type { ChipKind } from './Chip.tsx'

/** The live session state every row derives (execution kind). */
export type SessionRowState = 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'

/** The chip's data (kind + label + spinner + optional explainer) — the row
 *  renders it; `title` carries the state's one-line meaning (hover). */
export type SessionChipShape = { kind: ChipKind; label: string; spinner?: boolean; title?: string }

/** The waiting-kind locale key, typed (never a string cast). */
export function waitingKeyOf(kind: PendingInteractionKind): TaskBoardKey {
  switch (kind) {
    case 'approval': return 'waiting.approval'
    case 'plan-review': return 'waiting.plan-review'
    case 'question': return 'waiting.question'
  }
}

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
export function sessionStateChip(state: SessionRowState, waitingKind: PendingInteractionKind | undefined, settled: TaskBoardKey, idle: TaskBoardKey, idleTitle?: TaskBoardKey): SessionChipShape {
  switch (state) {
    case 'waiting':
      return waitingKind !== undefined
        ? { kind: 'warn', label: t(waitingKeyOf(waitingKind)), spinner: true }
        : { kind: 'warn', label: t('detail.result.running'), spinner: true }
    case 'running':
      return { kind: 'warn', label: t('detail.result.running'), spinner: true }
    case 'succeeded':
      return { kind: 'success', label: t(settled) }
    case 'failed':
      return { kind: 'error', label: t('detail.result.failed') }
    case 'cancelled':
      // The idle label names the state the caller chose (a run's 已取消 or a
      // bound session's 未运行); the title explains what the WORD means —
      // only for the linked-idle pair (未运行 是什么状态 is never a guess).
      return idleTitle !== undefined
        ? { kind: 'muted', label: t(idle), title: t(idleTitle) }
        : { kind: 'muted', label: t(idle) }
  }
}
