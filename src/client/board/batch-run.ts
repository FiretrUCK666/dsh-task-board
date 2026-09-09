/**
 * Batch run (the organize bar's apex action): which selected cards a
 * "批量执行" tap actually fires. The filter is deliberately thin — only the
 * execution gate (`taskExecutable`: a non-blank prompt) belongs here. Lane
 * business, concurrency budget and revive rules stay inside `runTask` (the
 * single launch point): a card that cannot start right now simply stays put,
 * visibly, instead of failing silently somewhere in the bar.
 *
 * Pure and framework-free so the selection rule unit-tests in isolation.
 */
import { taskExecutable, type TaskRecord } from '../../core/tasks.ts'

/** The selected cards worth firing, in board order (stable, meaningful). */
export function runnableIds(
  tasks: readonly TaskRecord[],
  selectedIds: readonly string[],
): string[] {
  const selected = new Set(selectedIds)
  return tasks
    .filter(task => selected.has(task.id) && taskExecutable(task))
    .map(task => task.id)
}
