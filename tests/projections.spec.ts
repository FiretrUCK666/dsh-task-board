/**
 * Projection pick matrix (core/projections.ts): every official tail-page key
 * is picked structurally, malformed domains drop key by key, and one bad
 * domain never hides the others. Capability absence is key absence.
 */
import { describe, expect, it } from 'vitest'
import { pickTranscriptProjections, readPermissionProjectionOf } from '../src/core/projections.ts'

const goalValue = {
  goal: {
    id: 'g-1', revision: 3, objective: '做完大升级', phase: 'active',
    maxGoalRounds: 30,
  },
  roundsStarted: 2, createdAt: 1000, updatedAt: 2000,
}

describe('pickTranscriptProjections', () => {
  it('returns {} for undefined or empty values', () => {
    expect(pickTranscriptProjections(undefined)).toEqual({})
    expect(pickTranscriptProjections({})).toEqual({})
  })

  it('picks the page-scoped keys unchanged', () => {
    const out = pickTranscriptProjections({
      contextPressure: { projectedTokens: 100, contextWindow: 1000 },
      contextBreakdown: { systemTokens: 1, toolsTokens: 2, messageTokens: 3 },
      todos: [{ content: 'x', status: 'in_progress' }],
    })
    expect(out.projections?.contextPressure).toEqual({ projectedTokens: 100, contextWindow: 1000 })
    expect(out.projections?.contextBreakdown).toEqual({ systemTokens: 1, toolsTokens: 2, messageTokens: 3 })
    expect(out.projections?.todos).toEqual([{ content: 'x', status: 'in_progress' }])
  })

  it('does NOT lift the permission projection: it is a current fact, not a page fact', () => {
    // `/permission` never opens a turn, so a page-scoped copy of this value
    // would never refresh — the panel read it and displayed a stale preset
    // forever. It is read live now (SessionConfigFace.readPermission), and its
    // absence here is the contract, not an oversight.
    const out = pickTranscriptProjections({
      permissions: { options: [{ value: 'a', name: 'A' }], currentValue: 'a' },
    }) as { projections?: Record<string, unknown> }
    expect(out.projections?.permissions).toBeUndefined()
    expect(out.projections).toBeUndefined()
  })

  it('picks whole-log tokenUsage only when all four buckets are numbers', () => {
    const full = { uncachedInputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 }
    expect(pickTranscriptProjections({ tokenUsage: full }).projections?.tokenUsage).toEqual(full)
    // Partial or garbage drops the key (zeros stay valid).
    expect(pickTranscriptProjections({ tokenUsage: { ...full, outputTokens: 'x' } }).projections?.tokenUsage)
      .toBeUndefined()
    expect(pickTranscriptProjections({
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }).projections?.tokenUsage).toEqual({
      uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    })
  })

  it('picks sessionStats only when all eight fields are numbers', () => {
    const full = { turns: 2, steps: 5, llmMs: 100, toolMs: 50, ttftMs: 10, ttftSteps: 1, decodeMs: 90, decodeTokens: 30 }
    expect(pickTranscriptProjections({ sessionStats: full }).projections?.sessionStats).toEqual(full)
    expect(pickTranscriptProjections({ sessionStats: { ...full, turns: '2' } }).projections?.sessionStats)
      .toBeUndefined()
  })

  it('picks a live goal, keeps null as cleared, drops complete', () => {
    expect(pickTranscriptProjections({ goal: goalValue }).projections?.goal).toMatchObject({
      id: 'g-1', revision: 3, objective: '做完大升级', phase: 'active', roundsStarted: 2,
    })
    expect(pickTranscriptProjections({ goal: null }).projections?.goal).toBeNull()
    const complete = { ...goalValue, goal: { ...goalValue.goal, phase: 'complete' } }
    expect(pickTranscriptProjections({ goal: complete }).projections?.goal).toBeUndefined()
  })

  it('keeps the blocked reason only for blocked goals with a well-formed reason', () => {
    const blocked = {
      ...goalValue,
      goal: { ...goalValue.goal, phase: 'blocked', blockedReason: { code: 'no-auth', message: '等审批' } },
    }
    expect(pickTranscriptProjections({ goal: blocked }).projections?.goal?.blockedReason)
      .toEqual({ code: 'no-auth', message: '等审批' })
    const badReason = {
      ...goalValue,
      goal: { ...goalValue.goal, phase: 'blocked', blockedReason: { code: 'x' } },
    }
    expect(pickTranscriptProjections({ goal: badReason }).projections?.goal?.blockedReason).toBeUndefined()
    // A non-blocked goal never carries a reason, even if one is attached.
    const active = { ...goalValue, goal: { ...goalValue.goal, blockedReason: { code: 'x', message: 'y' } } }
    expect(pickTranscriptProjections({ goal: active }).projections?.goal?.blockedReason).toBeUndefined()
  })

  it('one bad domain never hides the good ones', () => {
    const out = pickTranscriptProjections({
      tokenUsage: { uncachedInputTokens: 'bad' },
      todos: [{ content: 'x', status: 'pending' }],
      goal: goalValue,
    })
    expect(out.projections?.tokenUsage).toBeUndefined()
    expect(out.projections?.todos).toEqual([{ content: 'x', status: 'pending' }])
    expect(out.projections?.goal).toMatchObject({ id: 'g-1' })
  })
})

describe('readPermissionProjectionOf (the live permission read)', () => {
  const baseline = (currentValue: string) => ({
    permissions: {
      currentValue,
      options: [
        { value: 'read-only', name: '只读' },
        { value: 'workspace-write', name: '工作区可写' },
      ],
    },
  })

  it('returns the session\'s real selection, with the host\'s own options', () => {
    expect(readPermissionProjectionOf(baseline('workspace-write'))).toEqual({
      value: 'workspace-write',
      options: [
        { value: 'read-only', name: '只读' },
        { value: 'workspace-write', name: '工作区可写' },
      ],
    })
  })

  it('a value absent from the baseline is never dressed up as a default', () => {
    // It would render a select sitting on a blank entry — the same lie in a
    // new place: a select that looks like it knows the answer and does not.
    expect(readPermissionProjectionOf(baseline('auto'))).toBeUndefined()
  })

  it('absent, malformed, or option-less baselines answer "I cannot read this"', () => {
    expect(readPermissionProjectionOf(undefined)).toBeUndefined()
    expect(readPermissionProjectionOf({})).toBeUndefined()
    expect(readPermissionProjectionOf({ permissions: 'nope' })).toBeUndefined()
    expect(readPermissionProjectionOf({ permissions: { options: [], currentValue: '' } })).toBeUndefined()
    // A missing `name` is honest data, not a failure: the label falls back.
    expect(readPermissionProjectionOf({ permissions: { currentValue: 'x', options: [{ value: 'x' }] } }))
      .toEqual({ value: 'x', options: [{ value: 'x' }] })
  })

  it('reads the CURRENT value, which is the whole difference from the page', () => {
    // The reported bug as the difference between two channels: a history page
    // written before the user switched keeps reporting the old preset, and
    // reading it again returns the old preset again — because `/permission`
    // opens no turn, so no new event would ever refresh it. The live baseline
    // moves the moment the write lands.
    expect(readPermissionProjectionOf(baseline('read-only'))?.value).toBe('read-only')
    expect(readPermissionProjectionOf(baseline('workspace-write'))?.value).toBe('workspace-write')
    expect((pickTranscriptProjections(baseline('read-only')) as { projections?: Record<string, unknown> })
      .projections?.permissions).toBeUndefined()
  })
})
