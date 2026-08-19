/**
 * Board export (board-export.ts): the current-filtered view becomes Markdown
 * or JSON — pure content contract tests (grouping, tags resolved to names,
 * prompt fenced block, last-run line; JSON row shape).
 */
import { describe, expect, it } from 'vitest'
import { renderJsonExport, renderMarkdownExport } from '../src/client/board/board-export.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import type { Tag } from '../src/core/tags.ts'

const NOW = 1_700_000_000_000
const red: Tag = { id: 't-red', name: '紧急', color: '#e5484d' }

function task(overrides: Partial<TaskRecord> & { status: TaskRecord['status'] }): TaskRecord {
  return { ...createTask({ title: 'T', description: '', prompt: '' }, NOW, 't'), ...overrides }
}

const label = (status: string): string => status

describe('renderMarkdownExport', () => {
  it('groups by status with headings, shows only non-empty columns, resolves tags', () => {
    const md = renderMarkdownExport([
      task({
        id: 'a', title: '做登录页', status: 'todo', tags: ['t-red'], description: '接 OAuth', prompt: '完成登录',
        executions: [{ id: 'e1', sessionId: undefined, startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
      }),
      task({ id: 'b', title: '修崩溃', status: 'review', color: '#e5484d' }),
    ], [red], { now: NOW, statusLabel: label })
    expect(md).toContain('## todo (1)')
    expect(md).toContain('## review (1)')
    expect(md).not.toContain('## running')
    expect(md).toContain('### 1. 做登录页')
    expect(md).toContain('- 标签: 紧急')
    expect(md).toContain('接 OAuth')
    expect(md).toContain('```')
    expect(md).toContain('完成登录')
    expect(md).toContain('- 最近执行: 进行中')
    expect(md).toContain('- 卡片颜色: #e5484d')
  })
})

describe('renderJsonExport', () => {
  it('emits a compact row per task with tags as names', () => {
    const json = JSON.parse(renderJsonExport([
      task({ id: 'a', title: '做登录页', status: 'todo', tags: ['t-red'], prompt: 'p' }),
    ], [red])) as Array<Record<string, unknown>>
    expect(json).toHaveLength(1)
    expect(json[0].title).toBe('做登录页')
    expect(json[0].tags).toEqual(['紧急'])
    expect(json[0].status).toBe('todo')
    expect(json[0].lastRun).toBeUndefined()
  })
})
