/**
 * Session live to-do readout: the todo/write last-write-wins snapshot and the
 * open-row rule the context block renders.
 */
import { describe, expect, it } from 'vitest'
import { isOpenTodo, latestSessionTodos } from '../src/client/board/interaction.ts'

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

  it('drops malformed rows and normalizes unknown statuses to pending', () => {
    const todos = latestSessionTodos([
      { type: 'todo/write', seq: 1, data: { todos: [{ content: '', status: 'x' }, { content: 'ok', status: 'weird' }, 'junk'] } },
    ])
    expect(todos).toEqual([{ content: 'ok', status: 'pending' }])
  })
})
