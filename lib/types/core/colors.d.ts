/**
 * Card accent color: the only remaining "labeling" concept (tags were
 * removed — color only). The color is DATA (applied through inline style,
 * persisted on the task record itself), never a CSS literal; the palette
 * below is a curated set of 10 hues chosen to read clearly on both light
 * and dark. Pure and framework-free.
 */
import type { TaskRecord } from './tasks.ts';
/** Curated preset palette (10 hues, clear on light and dark). Data, not CSS. */
export declare const PALETTE: readonly string[];
/** Set (or clear, with undefined) a task's card accent color. */
export declare function withTaskColor(task: TaskRecord, color: string | undefined): TaskRecord;
