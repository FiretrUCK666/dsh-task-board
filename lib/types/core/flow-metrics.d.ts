/**
 * Flow metrics (the smallest honest set): cycle-time distribution + weekly
 * throughput, derived ONLY from the column-move ledger (statusHistory —
 * without it every duration is a guess, so functions below return undefined
 * instead of inventing numbers from updatedAt).
 *
 * - Cycle time: first entry into `running` → first entry into `done` after
 *   it, elapsed calendar days (review counts: the human gate is waiting too,
 *   and waiting is the enemy — stated here once, never re-debated per call).
 * - Throughput: done tasks per week over the trailing 28 days (only tasks
 *   reaching done count — never execution rounds, never comments).
 * - Expression: distributions, never means (p85 answers "when will it be
 *   done", a mean answers nothing). Framework-free, unit-tested in isolation.
 */
import type { TaskRecord } from './tasks.ts';
/** Trailing window for throughput (28 days = 4 weeks). */
export declare const THROUGHPUT_WINDOW_MS: number;
/** Elapsed cycle days for one task: the FIRST trip (first running → first
 *  done after it). Rework (running→done→running→done) measures once — the
 *  first delivery, never the rework tail (stated here, never re-debated per
 *  call). Elapsed calendar days, review included. Undefined when the trip is
 *  incomplete, unrecorded (legacy rows), or reaches into the future (clock
 *  skew is data dirt — the same law as throughput). */
export declare function cycleDaysOf(task: Pick<TaskRecord, 'statusHistory'>, now?: number): number | undefined;
/** The p-th percentile of an ascending-sorted sample (nearest-rank);
 *  undefined on empty input (no sample, no number — never zero-fill). */
export declare function percentileOf(sorted: readonly number[], p: number): number | undefined;
/** Done task count per week over the trailing window. The atom is the
 *  COMPLETION EVENT (a `done` entry in the ledger), never the current
 *  column: a task revived for a follow-up comment keeps the completion it
 *  already earned (columns aggregate sessions, history records events). Count
 *  caliber is PER TASK (at most one per window, by its last completion) —
 *  rework within the window does not double-count; a double delivery reads
 *  as one steady completion, never two. Future instants never count (clock
 *  skew is data dirt, not throughput). */
export declare function throughputPerWeek(tasks: readonly Pick<TaskRecord, 'status' | 'statusHistory'>[], now?: number): number;
/** The board's flow summary: samples (measurable first trips), the p85
 *  cycle in days, and weekly throughput. The two halves gate INDEPENDENTLY:
 *  direct-to-done completions (no running leg) count for throughput but can
 *  never form a cycle — throughput without a cycle still shows, a cycle
 *  without recent completions still shows, zero of both stays quiet (never
 *  a pseudo-number before real history exists). */
export declare function flowSummaryOf(tasks: readonly Pick<TaskRecord, 'status' | 'statusHistory'>[], now?: number): {
    samples: number;
    p85Days?: number;
    perWeek: number;
};
