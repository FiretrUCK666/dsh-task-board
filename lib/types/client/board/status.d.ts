/**
 * Shared status copy: one mapping from task status to its locale key, used
 * by the board columns and the task detail badge so both surfaces can never
 * drift apart.
 */
import type { TaskStatus } from '../../core/tasks.ts';
import type { TaskBoardKey } from '../locales.ts';
/** Status → locale key. */
export declare const STATUS_KEY: Record<TaskStatus, TaskBoardKey>;
/**
 * Status → SHORT locale key, read by the compact column navigator. Five equal
 * cells on a phone leave roughly one-and-a-half Chinese characters per label,
 * so the full names all collapse to 「待…」「进…」「已…」 and the navigator
 * stops naming anything at all. The short forms are ordinary locale data (never
 * a hardcoded string, never a truncation rule), and the full name stays on the
 * tab as its accessible name.
 */
export declare const STATUS_SHORT_KEY: Record<TaskStatus, TaskBoardKey>;
/**
 * Paused-rule explanation keyed by the pausing status: ONE map read by both
 * automation surfaces (the detail editor and the overview row derive the same
 * readiness reason, so the reason copy can never drift).
 */
export declare const PAUSED_REASON_KEY: Record<'backlog' | 'review' | 'done', TaskBoardKey>;
