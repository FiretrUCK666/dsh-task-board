/**
 * Requirement-refinement copy: the prompt sent as the first turn of a task's
 * refine session. The agent researches (with whatever tools the harness
 * gives it — web search, page fetch, …), asks the user anything unclear,
 * and finally emits a ready-to-run execution prompt. Pure and framework-free
 * so the template unit-tests in isolation; the same builder serves both
 * languages.
 */
import type { TaskRecord } from './tasks.ts'

/**
 * The first-turn instruction for a task's refine session.
 * @param task - the backlog task whose requirement is being fleshed out.
 * @param english - whether to write the instruction in English.
 */
export function buildRefinePrompt(task: TaskRecord, english: boolean): string {
  const title = task.title.trim()
  const description = task.description.trim()
  const prompt = task.prompt.trim()
  const requirement = [
    ...(title !== '' ? [english ? `**Title**: ${title}` : `**标题**：${title}`] : []),
    ...(description !== '' ? [english ? `**Description**: ${description}` : `**描述**：${description}`] : []),
    ...(prompt !== '' ? [english ? `**Current prompt**: ${prompt}` : `**当前 Prompt**：${prompt}`] : []),
  ].join('\n')
  if (english) {
    return [
      'You are a requirement research and refinement assistant. Work through the raw requirement below:',
      '',
      '1. Research first: understand the requirement, identify what is vague or missing, and gather what you need — use any tool available to you (web search, page fetching, etc.).',
      '2. Ask before assuming: if key information is missing or several directions are possible, ask me one question at a time and wait for my answer (I reply in this conversation). Do not guess.',
      '3. Deliver: combine your research with my answers into a final, ready-to-run execution prompt — clear goal, scope, constraints, acceptance criteria and steps, in the language of the requirement.',
      '',
      'Output format (strict):',
      '## Requirement Summary',
      '(one or two sentences)',
      '## Final Execution Prompt',
      '(the complete instruction text, ready to copy and execute)',
      '',
      'Raw requirement:',
      requirement,
    ].join('\n')
  }
  return [
    '你是需求调研与方案完善助手。请围绕下面的「原始需求」展开工作：',
    '',
    '1. 先调研：理解需求，识别模糊点与缺口，收集所需资料——可以使用你拥有的一切工具（联网搜索、抓取网页等）。',
    '2. 先问再定：关键信息缺失或存在多个可选方向时，逐条向我提问确认（我会在对话中回答），不要臆断。',
    '3. 最终产出：综合调研结果与我的回答，产出一份可直接执行的「最终执行 Prompt」——写清目标、范围、约束、验收标准与执行步骤，语言与需求的输入语言一致。',
    '',
    '输出格式（严格遵守）：',
    '## 需求摘要',
    '（一两句话概括）',
    '## 最终执行 Prompt',
    '（可整体复制执行的完整指令文本）',
    '',
    '原始需求如下：',
    requirement,
  ].join('\n')
}
