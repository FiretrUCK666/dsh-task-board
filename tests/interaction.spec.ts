/**
 * Pending native-interaction detection: open ask_user_question tool calls,
 * their argument parsing and answer assembly. Pins the plan-review / question
 * contract so the interaction card always reads the real native shapes.
 */
import { describe, expect, it } from 'vitest'
import type { TranscriptEventShape } from '../src/core/controller.ts'
import {
  assembleAnswers, detectPendingInteraction, isOpenTodo, latestSessionTodos, parseQuestionArgs, PLAN_DECLINE_TEMPLATE,
  planConfirmText,
} from '../src/client/board/interaction.ts'

function toolCall(callId: string, name: string, argumentsJson: string): TranscriptEventShape {
  return { type: 'tool/call', seq: 1, data: { callId, name, arguments: argumentsJson } }
}
function toolResult(callId: string): TranscriptEventShape {
  return {
    type: 'tool/result', seq: 2,
    data: { message: { content: [{ type: 'tool', callId }] } },
  }
}

describe('detectPendingInteraction', () => {
  it('returns undefined for an empty or irrelevant event list', () => {
    expect(detectPendingInteraction([])).toBeUndefined()
    expect(detectPendingInteraction([{ type: 'user/message', data: { id: 'm', content: [{ type: 'text', text: 'hi' }] } }])).toBeUndefined()
  })

  it('finds an open ask_user_question call and parses its questions', () => {
    const events = [
      toolCall('c1', 'ask_user_question', JSON.stringify({
        questions: [
          { id: 'q1', question: '对该方案有什么要调整的吗？', options: [{ label: '直接执行' }] },
        ],
      })),
    ]
    const pending = detectPendingInteraction(events)
    expect(pending).toBeDefined()
    expect(pending?.callId).toBe('c1')
    expect(pending?.isPlanReview).toBe(false)
    expect(pending?.questions[0].question).toBe('对该方案有什么要调整的吗？')
    expect(pending?.questions[0].options?.[0].label).toBe('直接执行')
  })

  it('skips a call that already settled (has a tool/result)', () => {
    const events = [
      toolCall('c1', 'ask_user_question', JSON.stringify({ questions: [{ id: 'q1', question: '旧' }] })),
      toolResult('c1'),
      toolCall('c2', 'ask_user_question', JSON.stringify({ questions: [{ id: 'q2', question: '新' }] })),
      toolCall('c3', 'ask_user_question', JSON.stringify({ questions: [{ id: 'q3', question: '更新' }] })),
    ]
    // c1 settled; the newest open one (c3) wins.
    const pending = detectPendingInteraction(events)
    expect(pending?.callId).toBe('c3')
    expect(pending?.questions[0].question).toBe('更新')
  })

  it('recognises a plan-review intent and names it', () => {
    const events = [
      toolCall('p1', 'ask_user_question', JSON.stringify({
        questions: [
          {
            id: 'plan', question: '这个方案可以吗？',
            detail: '# 计划\n1. 第一步', options: [{ label: '批准' }, { label: '修改' }],
            intent: { kind: 'plan-review', approve: '批准' },
          },
        ],
      })),
    ]
    const pending = detectPendingInteraction(events)
    expect(pending?.isPlanReview).toBe(true)
    expect(pending?.questions[0].intent?.kind).toBe('plan-review')
    expect(planConfirmText(pending!)).toBe('批准')
  })

  it('is tolerant to malformed arguments', () => {
    const events = [toolCall('x1', 'ask_user_question', 'not json')]
    expect(detectPendingInteraction(events)).toBeUndefined()
  })
})

describe('parseQuestionArgs', () => {
  it('parses the questions array and a single-question shape', () => {
    const fromArray = parseQuestionArgs(JSON.stringify({ questions: [{ id: 'a', question: 'A' }, { id: 'b', question: 'B', multiSelect: true }] }))
    expect(fromArray?.map(question => question.id)).toEqual(['a', 'b'])
    expect(fromArray?.[1].multiSelect).toBe(true)
    const fromSingle = parseQuestionArgs(JSON.stringify({ id: 's', question: 'S', options: [{ label: 'o' }] }))
    expect(fromSingle?.[0].question).toBe('S')
  })
})

describe('answer assembly', () => {
  it('joins selected labels and custom text per question', () => {
    const text = assembleAnswers([
      { id: 'a', selected: ['选 A'], custom: '补充说明' },
      { id: 'b', selected: [], custom: undefined },
    ])
    expect(text).toBe('选 A · 补充说明')
  })

  it('returns empty text when nothing was answered', () => {
    expect(assembleAnswers([{ id: 'a', selected: [] }])).toBe('')
  })
})

describe('plan decline template', () => {
  it('carries the caller-editable reason placeholder', () => {
    expect(PLAN_DECLINE_TEMPLATE.includes('{reason}')).toBe(true)
  })
})

describe('latestSessionTodos', () => {
  it('reads the newest todo/write snapshot (last write wins)', () => {
    const events = [
      { type: 'todo/write', seq: 1, data: { todos: [{ content: '旧', status: 'pending' }] } },
      { type: 'todo/write', seq: 2, data: { todos: [{ content: '新', status: 'in_progress' }, { content: '完成', status: 'completed' }] } },
    ]
    const todos = latestSessionTodos(events)
    expect(todos?.map(row => row.content)).toEqual(['新', '完成'])
    expect(isOpenTodo(todos![0])).toBe(true)
    expect(isOpenTodo(todos![1])).toBe(false)
  })

  it('returns undefined when the session never wrote a todo', () => {
    expect(latestSessionTodos([{ type: 'user/message', data: { id: 'm' } }])).toBeUndefined()
    expect(latestSessionTodos([])).toBeUndefined()
  })
})
