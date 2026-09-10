/**
 * Board export (workbench feature): turn the CURRENT FILTERED board view into
 * a plain-text artifact — Markdown (human handoff) or JSON (machine). Pure
 * and framework-free so the content contract unit-tests; the download glue
 * lives in the component. Export is a snapshot at the click: no live sync, no
 * state changes.
 */
import type { TaskRecord } from '../../core/tasks.ts';
import type { Tag } from '../../core/tags.ts';
export interface ExportTagRow {
    name: string;
    color: string;
}
export interface ExportContext {
    tags: Tag[];
    now: number;
    filename?: string;
}
/** Resolve a task's tags to catalog rows (unknown ids skipped). */
export declare function exportTaskTags(task: TaskRecord, catalog: readonly Tag[]): ExportTagRow[];
/** The machine-readable row (JSON export). */
export declare function exportTaskJson(task: TaskRecord, catalog: readonly Tag[]): Record<string, unknown>;
/** Boolean switch for a filtered preview export (export uses the same view). */
/**
 * Render the task list as Markdown, grouped by status (only the columns that
 * contain tasks appear). Status labels follow the column-order list.
 */
export declare function renderMarkdownExport(tasks: readonly TaskRecord[], catalog: readonly Tag[], options: {
    filename?: string;
    now: number;
    statusLabel: (status: TaskRecord['status']) => string;
}): string;
/** Render the task list as a JSON document. */
export declare function renderJsonExport(tasks: readonly TaskRecord[], catalog: readonly Tag[]): string;
