/**
 * Card accent color: the only remaining "labeling" concept (tags were
 * removed — color only). The color is DATA (applied through inline style,
 * persisted on the task record itself), never a CSS literal; the palette
 * below is a curated set of 10 hues chosen to read clearly on both light
 * and dark. Pure and framework-free.
 */
import type { TaskRecord } from './tasks.ts'

/** Curated preset palette (10 hues, clear on light and dark). Data, not CSS. */
export const PALETTE: readonly string[] = [
  '#e5484d', '#f76b15', '#f5a524', '#f2cd35', '#30a46c',
  '#12a594', '#3e63dd', '#6e56cf', '#ab4aba', '#e93d82',
]

/** Set (or clear, with undefined) a task's card accent color. */
export function withTaskColor(task: TaskRecord, color: string | undefined): TaskRecord {
  return color === undefined
    ? { ...task, ...('color' in task ? { color: undefined } : {}) }
    : { ...task, color }
}
