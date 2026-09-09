/**
 * Task edit drafts (client/board/task-draft.ts): the `YYYY-MM-DD` due-date
 * round-trip — parse/format are strict inverses, converters carry the field
 * end to end, and malformed persisted drafts degrade to "no due".
 */
import { describe, expect, it } from 'vitest'
import {
  draftFromTask,
  draftFromTemplate,
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
    priority: '',
    labels: '',
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

  it('priority rides the draft as 1/2/3-or-empty (junk normalizes to empty)', () => {
    expect(draftToNewInput({ ...draft(), priority: '1' }).priority).toBe(1)
    expect(draftToNewInput(draft()).priority).toBeUndefined()
    expect(draftToNewInput({ ...draft(), priority: '9' }).priority).toBeUndefined()
    expect(draftToUpdatePatch({ ...draft(), priority: '2' }).priority).toBe(2)
    expect(draftToUpdatePatch(draft()).priority).toBeUndefined()
    expect(draftFromTask(createTask({ title: 't', description: '', prompt: 'p', priority: 3 }, NOW, 'a')).priority).toBe('3')
    expect(normalizeDraft({ ...draft(), priority: 'x' })?.priority).toBe('')
    expect(normalizeDraft({ ...draft(), priority: '2' })?.priority).toBe('2')
  })

  it('labels ride the draft as free text, normalized on write', () => {
    expect(draftToNewInput({ ...draft(), labels: '等车, 电话,等车' }).labels).toEqual(['等车', '电话'])
    expect(draftToNewInput({ ...draft(), labels: '等车，电话；短信|邮件' }).labels).toEqual(['等车', '电话', '短信', '邮件'])
    expect(draftToNewInput(draft()).labels).toBeUndefined()
    expect(draftToUpdatePatch({ ...draft(), labels: 'A、B C' }).labels).toEqual(['a', 'b', 'c'])
    expect(draftToUpdatePatch(draft()).labels).toBeUndefined()
    expect(draftFromTask(createTask({ title: 't', description: '', prompt: 'p', labels: ['x', 'y'] }, NOW, 'a')).labels).toBe('x, y')
    expect(normalizeDraft({ ...draft(), labels: 'x' })?.labels).toBe('x')
  })

  it('draftFromTemplate carries the template inert shape', () => {
    const stamped = draftFromTemplate({
      id: 't', name: 'T', title: 'x', description: '', prompt: 'p',
      dueAt: parseDueDateInput('2025-01-08'), priority: 2, labels: ['a'],
    })
    expect(stamped.dueDate).toBe('2025-01-08')
    expect(stamped.priority).toBe('2')
    expect(stamped.labels).toBe('a')
    const bare = draftFromTemplate({ id: 't', name: 'T', title: 'x', description: '', prompt: 'p' })
    expect(bare.dueDate).toBe('')
    expect(bare.priority).toBe('')
    expect(bare.labels).toBe('')
  })
})
