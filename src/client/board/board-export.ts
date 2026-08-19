/**
 * Board export (workbench feature): turn the CURRENT FILTERED board view into
 * a plain-text artifact — Markdown (human handoff) or JSON (machine). Pure
 * and framework-free so the content contract unit-tests; the download glue
 * lives in the component. Export is a snapshot at the click: no live sync, no
 * state changes.
 */
import type { TaskRecord } from '../../core/tasks.ts'
import type { Tag } from '../../core/tags.ts'

export interface ExportTagRow { name: string; color: string }
export interface ExportContext {
  tags: Tag[]
  now: number
  filename?: string
}

/** Resolve a task's tags to catalog rows (unknown ids skipped). */
export function exportTaskTags(task: TaskRecord, catalog: readonly Tag[]): ExportTagRow[] {
  return (task.tags ?? [])
    .map(id => catalog.find(tag => tag.id === id))
    .filter((tag): tag is Tag => tag !== undefined)
    .map(tag => ({ name: tag.name, color: tag.color }))
}

/** The machine-readable row (JSON export). */
export function exportTaskJson(task: TaskRecord, catalog: readonly Tag[]): Record<string, unknown> {
  const latest = task.executions[task.executions.length - 1]
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    prompt: task.prompt,
    status: task.status,
    tags: exportTaskTags(task, catalog).map(tag => tag.name),
    color: task.color ?? undefined,
    lastRun: latest === undefined
      ? undefined
      : {
          result: latest.result ?? undefined,
          startedAt: latest.startedAt,
          endedAt: latest.endedAt ?? undefined,
        },
    updatedAt: task.updatedAt,
  }
}

/** Boolean switch for a filtered preview export (export uses the same view). */

/**
 * Render the task list as Markdown, grouped by status (only the columns that
 * contain tasks appear). Status labels follow the column-order list.
 */
export function renderMarkdownExport(
  tasks: readonly TaskRecord[],
  catalog: readonly Tag[],
  options: { filename?: string; now: number; statusLabel: (status: TaskRecord['status']) => string },
): string {
  const lines: string[] = ['# dsh-task-board', '', `导出时间: ${new Date(options.now).toLocaleString()}`, '']
  const order: TaskRecord['status'][] = ['backlog', 'todo', 'running', 'review', 'done']
  for (const status of order) {
    const rows = tasks.filter(task => task.status === status)
    if (rows.length === 0) continue
    lines.push(`## ${options.statusLabel(status)} (${rows.length})`, '')
    rows.forEach((task, index) => {
      lines.push(`### ${index + 1}. ${task.title}`, '')
      if (task.description !== '') lines.push(task.description.trim(), '')
      const tags = exportTaskTags(task, catalog)
      if (tags.length > 0) lines.push(`- 标签: ${tags.map(tag => tag.name).join('、')}`)
      if (task.color !== undefined) lines.push(`- 卡片颜色: ${task.color}`)
      const prompt = task.prompt.trim()
      if (prompt !== '') lines.push('- Prompt:', '', '```', prompt, '```', '')
      const latest = task.executions[task.executions.length - 1]
      if (latest !== undefined) {
        lines.push(`- 最近执行: ${latest.result ?? '进行中'}${latest.startedAt > 0 ? ` · ${new Date(latest.startedAt).toLocaleString()}` : ''}`)
      }
      lines.push('')
    })
  }
  return lines.join('\n')
}

/** Render the task list as a JSON document. */
export function renderJsonExport(tasks: readonly TaskRecord[], catalog: readonly Tag[]): string {
  return JSON.stringify(tasks.map(task => exportTaskJson(task, catalog)), null, 2)
}
