/**
 * Requirement-refinement template tests: the first-turn instruction embeds
 * the task's title/description/prompt and drives the agent to research, ask,
 * and deliver a final execution prompt.
 */
import { describe, expect, it } from 'vitest'
import { createTask } from '../src/core/tasks.ts'
import { buildRefinePrompt } from '../src/core/refine.ts'

const NOW = 1_700_000_000_000

function sampleTask() {
  return createTask(
    { title: '做一个搜索工具', description: '想找个好用的方案', prompt: '请实现一个搜索工具' },
    NOW,
    'task-1',
  )
}

describe('buildRefinePrompt', () => {
  it('embeds title, description and prompt into the zh instruction', () => {
    const prompt = buildRefinePrompt(sampleTask(), false)
    expect(prompt).toContain('**标题**：做一个搜索工具')
    expect(prompt).toContain('**描述**：想找个好用的方案')
    expect(prompt).toContain('**当前 Prompt**：请实现一个搜索工具')
    expect(prompt).toContain('## 最终执行 Prompt')
    expect(prompt).toContain('## 需求摘要')
  })

  it('embeds the same fields into the en instruction', () => {
    const prompt = buildRefinePrompt(sampleTask(), true)
    expect(prompt).toContain('**Title**: 做一个搜索工具')
    expect(prompt).toContain('**Description**: 想找个好用的方案')
    expect(prompt).toContain('**Current prompt**: 请实现一个搜索工具')
    expect(prompt).toContain('## Final Execution Prompt')
  })

  it('omits empty fields', () => {
    const task = createTask({ title: '只留标题', description: '', prompt: '' }, NOW, 'task-2')
    const prompt = buildRefinePrompt(task, false)
    expect(prompt).toContain('**标题**：只留标题')
    expect(prompt).not.toContain('**描述**')
    expect(prompt).not.toContain('**当前 Prompt**')
  })

  it('instructs the agent to ask before assuming', () => {
    const prompt = buildRefinePrompt(sampleTask(), false)
    expect(prompt).toContain('提问')
    const en = buildRefinePrompt(sampleTask(), true)
    expect(en).toContain('ask me')
  })
})