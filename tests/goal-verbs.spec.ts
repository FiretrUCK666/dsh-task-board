/**
 * Goal verbs adapter (core/goal-verbs.ts): the CAS ref is read at
 * call time, missing faces degrade to named failures, and remote outcomes
 * normalize to one result shape.
 */
import { describe, expect, it } from 'vitest'
import {
  goalRefOf,
  makeGoalVerbs,
  noCurrentGoal,
  toVerbResult,
  type GoalBindingFace,
  type GoalsRemoteFace,
} from '../src/core/goal-verbs.ts'

function bindingOf(snapshot: unknown): (sessionId: string) => GoalBindingFace | undefined {
  return () => snapshot === undefined
    ? undefined
    : { projections: { faceOf: (key: string) => key === 'goal' ? { getSnapshot: () => snapshot } : undefined } }
}

function remoteOf(overrides: Partial<GoalsRemoteFace> = {}): GoalsRemoteFace & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    get: async () => ({ ok: true, value: null }),
    edit: async () => { calls.push('edit'); return { ok: true } },
    pause: async () => { calls.push('pause'); return { ok: true } },
    resume: async () => { calls.push('resume'); return { ok: true } },
    clear: async () => { calls.push('clear'); return { ok: true } },
    ...overrides,
  }
}

describe('goalRefOf', () => {
  it('reads the live ref (no staleness fence — the RPC CAS guards)', () => {
    expect(goalRefOf(bindingOf({ goal: { id: 'g-1', revision: 4 } })('s')))
      .toEqual({ id: 'g-1', revision: 4 })
  })

  it('reports no ref for absent binding / projection / goal / malformed ref', () => {
    expect(goalRefOf(undefined)).toBeUndefined()
    expect(goalRefOf(bindingOf(undefined)('s'))).toBeUndefined()
    expect(goalRefOf(bindingOf(null)('s'))).toBeUndefined()
    expect(goalRefOf(bindingOf({})('s'))).toBeUndefined()
    expect(goalRefOf(bindingOf({ goal: { id: '', revision: 1 } })('s'))).toBeUndefined()
    expect(goalRefOf(bindingOf({ goal: { id: 'g', revision: Number.NaN } })('s'))).toBeUndefined()
  })
})

describe('makeGoalVerbs', () => {
  it('calls the remote with the call-time ref (fresh, never cached)', async () => {
    let snapshot: unknown = { goal: { id: 'g-1', revision: 1 } }
    const remote = remoteOf()
    const verbs = makeGoalVerbs(() => bindingOf(snapshot)('s'), remote, 's')
    await verbs.pause()
    expect(remote.calls).toEqual(['pause'])
    // The ref is re-read per call: a revision bump between calls rides along.
    snapshot = { goal: { id: 'g-1', revision: 2 } }
    const seen: unknown[] = []
    const remote2 = remoteOf({ pause: async (_s: string, ref: unknown) => { seen.push(ref); return { ok: true } } })
    await makeGoalVerbs(() => bindingOf(snapshot)('s'), remote2, 's').pause()
    expect(seen).toEqual([{ id: 'g-1', revision: 2 }])
  })

  it('reports no-current-goal when the binding has no goal (never calls remote)', async () => {
    const remote = remoteOf()
    const verbs = makeGoalVerbs(bindingOf(undefined), remote, 's')
    expect(await verbs.pause()).toEqual(noCurrentGoal())
    expect(await verbs.edit('x')).toEqual(noCurrentGoal())
    expect(await verbs.clear()).toEqual(noCurrentGoal())
    expect(remote.calls).toEqual([])
  })

  it('reports remote-unavailable when the face is absent (never throws)', async () => {
    const verbs = makeGoalVerbs(bindingOf({ goal: { id: 'g', revision: 1 } }), undefined, 's')
    const result = await verbs.pause()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('remote/unavailable')
  })

  it('normalizes remote failures and throws to named results', async () => {
    const fail = remoteOf({ pause: async () => ({ ok: false, error: { code: 'GOAL_CONFLICT', message: 'stale revision' } }) })
    const verbs = makeGoalVerbs(bindingOf({ goal: { id: 'g', revision: 1 } }), fail, 's')
    expect(await verbs.pause()).toEqual({ ok: false, error: { code: 'GOAL_CONFLICT', message: 'stale revision' } })
    const boom = remoteOf({
      pause: async () => { throw new Error('socket reset') },
    })
    expect(await makeGoalVerbs(bindingOf({ goal: { id: 'g', revision: 1 } }), boom, 's').pause())
      .toEqual({ ok: false, error: { code: 'goal/pause-failed', message: 'socket reset' } })
  })

  it('sends the edit patch as { objective } (the official shape)', async () => {
    const seen: unknown[] = []
    const remote = remoteOf({
      edit: async (_s: string, _ref: unknown, patch: unknown) => { seen.push(patch); return { ok: true } },
    })
    await makeGoalVerbs(bindingOf({ goal: { id: 'g', revision: 1 } }), remote, 's').edit(' new aim ')
    expect(seen).toEqual([{ objective: ' new aim ' }])
  })
})

describe('toVerbResult', () => {
  it('passes ok through and names malformed outcomes', () => {
    expect(toVerbResult({ ok: true }, 'pause')).toEqual({ ok: true })
    expect(toVerbResult({ ok: false, error: { code: '', message: 'bad' } }, 'pause'))
      .toEqual({ ok: false, error: { code: 'goal/pause-failed', message: 'bad' } })
    expect(toVerbResult(undefined, 'clear'))
      .toEqual({ ok: false, error: { code: 'goal/clear-failed', message: 'undefined' } })
  })
})
