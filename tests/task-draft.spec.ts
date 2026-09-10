/**
 * Task edit drafts (client/board/task-draft.ts): converters carry scalar
 * fields end to end, and malformed persisted drafts degrade safely.
 */
import { describe, expect, it } from 'vitest'
import {
  draftFromTask,
  draftFromTemplate,
  draftToNewInput,
  draftToUpdatePatch,
  stampTemplate,
} from '../src/client/board/task-draft.ts'
import { createTask } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

function draft() {
  return {
    title: 't',
    description: '',
    prompt: 'p',
    promptImages: [],
    promptFiles: [],
    status: 'backlog' as const,
    agentPreset: '',
    workspaceId: '',
    provider: '',
    model: '',
    reasoningEffort: '',
    permission: '',
    color: '',
  }
}

describe('draft scalar converters', () => {
  it('update patches clear with undefined (present-key semantics)', () => {
    expect(draftToUpdatePatch(draft()).provider).toBeUndefined()
    expect(draftToUpdatePatch({ ...draft(), provider: 'my' }).provider).toBe('my')
  })

  it('drafts round-trip the record and normalize persisted junk', () => {
    expect(draftFromTask(createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'a')).provider).toBe('')
  })

  it('routes ride independently on write (same law as update)', () => {
    expect(draftToNewInput({ ...draft(), provider: 'my', model: '' }).provider).toBe('my')
    expect(draftToNewInput({ ...draft(), provider: 'my', model: '' }).model).toBeUndefined()
    expect(draftToNewInput({ ...draft(), provider: '', model: 'mm' }).provider).toBeUndefined()
    expect(draftToNewInput({ ...draft(), provider: '', model: 'mm' }).model).toBe('mm')
  })

  it('draftFromTemplate carries run config and content', () => {
    const stamped = draftFromTemplate({
      id: 't', name: 'T', title: 'x', description: '', prompt: 'p',
      provider: 'ty', model: 'tm', color: '#fff',
    })
    expect(stamped.provider).toBe('ty')
    expect(stamped.model).toBe('tm')
    expect(stamped.color).toBe('#fff')
    const bare = draftFromTemplate({ id: 't', name: 'T', title: 'x', description: '', prompt: 'p' })
    expect(bare.provider).toBe('')
    expect(bare.color).toBe('')
  })

  it('stampTemplate fills blanks only (touched fields always win)', () => {
    const template = { ...draft(), title: 'T', description: 'D', prompt: 'P' }
    const empty = { ...draft(), title: '', description: '', prompt: '' }
    // Empty draft takes everything.
    expect(stampTemplate(empty, template)).toEqual(template)
    // Touched fields survive; blanks fill from the template.
    const filled = stampTemplate({ ...empty, title: 'mine' }, template)
    expect(filled.title).toBe('mine')
    expect(filled.description).toBe('D')    // A non-default status survives too.
    const moved = stampTemplate({ ...empty, status: 'todo' as const }, template)
    expect(moved.status).toBe('todo')
  })

  it('stampTemplate keeps run routes atomic (never a mixed provider/model)', () => {
    const template = {
      ...draft(), provider: 'ty', model: 'tm', reasoningEffort: 'te',
    }
    // A complete user pair wins whole (effort rides with its model).
    const mine = stampTemplate(
      { ...draft(), title: '', description: '', prompt: '', provider: 'my', model: 'mm', reasoningEffort: 'me' },
      template,
    )
    expect([mine.provider, mine.model, mine.reasoningEffort]).toEqual(['my', 'mm', 'me'])
    // A half-touched pair loses whole (no user-provider + template-model mix).
    const half = stampTemplate(
      { ...draft(), title: '', description: '', prompt: '', provider: 'my', model: '', reasoningEffort: '' },
      template,
    )
    expect([half.provider, half.model, half.reasoningEffort]).toEqual(['ty', 'tm', 'te'])
  })
})
