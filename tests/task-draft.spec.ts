/**
 * Task edit drafts (client/board/task-draft.ts): the `YYYY-MM-DD` due-date
 * round-trip — parse/format are strict inverses, converters carry the field
 * end to end, and malformed persisted drafts degrade to "no due".
 */
import { describe, expect, it } from 'vitest'
import {
  draftFromTask,
  draftToNewInput,
  draftToUpdatePatch,
  normalizeDraft,
  parseDueDateInput,
  toDueDateInput,
} from '../src/client/board/task-draft.ts'
import { createTask } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

function draft() {
  return {
    title: 't',
    description: '',
    prompt: 'p',
    promptImages: [],
    status: 'backlog' as const,
    agentPreset: '',
    workspaceId: '',
    provider: '',
    model: '',
    reasoningEffort: '',
    permission: '',
    dueDate: '',
  }
}

describe('parseDueDateInput / toDueDateInput (strict inverses)', () => {
  it('parses calendar dates to local-midnight epochs', () => {
    const at = parseDueDateInput('2025-01-08')!
    expect(new Date(at).getFullYear()).toBe(2025)
    expect(new Date(at).getMonth()).toBe(0)
    expect(new Date(at).getDate()).toBe(8)
    expect(new Date(at).getHours()).toBe(0)
  })

  it('rejects malformed input (never NaN into the ledger)', () => {
    expect(parseDueDateInput('')).toBeUndefined()
    expect(parseDueDateInput('tomorrow')).toBeUndefined()
    expect(parseDueDateInput('2025-1-8')).toBeUndefined()
    expect(parseDueDateInput('2025-13-40')).toBeUndefined()
  })

  it('round-trips through the input shape', () => {
    const at = parseDueDateInput('2025-01-08')!
    expect(toDueDateInput(at)).toBe('2025-01-08')
  })
})

describe('draft due-date converters', () => {
  it('new inputs carry a valid due date, omit an empty one', () => {
    expect(draftToNewInput({ ...draft(), dueDate: '2025-01-08' }).dueAt)
      .toBe(parseDueDateInput('2025-01-08'))
    expect(draftToNewInput(draft()).dueAt).toBeUndefined()
    expect(draftToNewInput({ ...draft(), dueDate: 'junk' }).dueAt).toBeUndefined()
  })

  it('update patches clear with undefined (present-key semantics)', () => {
    expect(draftToUpdatePatch(draft()).dueAt).toBeUndefined()
    expect(draftToUpdatePatch({ ...draft(), dueDate: '2025-01-08' }).dueAt)
      .toBe(parseDueDateInput('2025-01-08'))
  })

  it('drafts round-trip the record and normalize persisted junk', () => {
    const stamped = { ...createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'a'), dueAt: parseDueDateInput('2025-01-08')! }
    expect(draftFromTask(stamped).dueDate).toBe('2025-01-08')
    expect(draftFromTask(createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'a')).dueDate).toBe('')
    expect(normalizeDraft({ ...draft(), dueDate: 'junk' })?.dueDate).toBe('')
    expect(normalizeDraft({ ...draft(), dueDate: '2025-01-08' })?.dueDate).toBe('2025-01-08')
  })
})
