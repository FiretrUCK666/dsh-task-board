/**
 * Native-activity detection (session-activity.ts): the running-flip signal
 * behind "两端同步" — out-of-band turns are detected from a related session
 * flipping to running, never from past activity, never on a session the
 * board already owns or already recorded via direct-send.
 */
import { describe, expect, it } from 'vitest'
import { DIRECT_GRACE_MS, EXTERNAL_SETTLE_GRACE_MS, detectExternalTurns, withinGrace, type ActivityBook } from '../src/core/session-activity.ts'

const TASK = 't-1'
const SESSION = 's-1'

function book(): ActivityBook {
  return { running: new Map(), externalSince: new Map() }
}

function candidate(refine = false, hasOpenRound = false, inGrace = false) {
  return {
    taskId: TASK,
    candidate: {
      sessions: [{ sessionId: SESSION, refine }],
      hasOpenRoundOn: () => hasOpenRound,
      inGrace: () => inGrace,
    },
  }
}

/** Wrap a plain running-flag table into the byId shape. */
function byId(flags: Record<string, boolean>): Record<string, { running: boolean }> {
  return Object.fromEntries(Object.entries(flags).map(([id, running]) => [id, { running }]))
}

describe('detectExternalTurns', () => {
  it('the first observation only establishes the baseline — past activity never re-fires', () => {
    const b = book()
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: true }))).toEqual([])
    expect(b.running.get(SESSION)).toBe(true)
  })

  it('a false→true flip with no open round and no grace is detected', () => {
    const b = book()
    detectExternalTurns([candidate()], b, byId({ [SESSION]: false }))
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: true })))
      .toEqual([{ taskId: TASK, sessionId: SESSION, refine: false }])
  })

  it('already-running at baseline plus a later turn is still detected (two flips)', () => {
    const b = book()
    detectExternalTurns([candidate()], b, byId({ [SESSION]: false }))
    detectExternalTurns([candidate()], b, byId({ [SESSION]: true }))
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: false }))).toEqual([])
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: true })))
      .toEqual([{ taskId: TASK, sessionId: SESSION, refine: false }])
  })

  it('skips a flip while the task already has an open round on the session', () => {
    const b = book()
    detectExternalTurns([candidate(false, true)], b, byId({ [SESSION]: false }))
    expect(detectExternalTurns([candidate(false, true)], b, byId({ [SESSION]: true }))).toEqual([])
  })

  it('skips a flip inside the direct-send grace (the turn is already recorded)', () => {
    const b = book()
    detectExternalTurns([candidate(false, false, true)], b, byId({ [SESSION]: false }))
    expect(detectExternalTurns([candidate(false, false, true)], b, byId({ [SESSION]: true }))).toEqual([])
  })

  it('reports refine sessions with the refine flag', () => {
    const b = book()
    detectExternalTurns([candidate(true)], b, byId({ [SESSION]: false }))
    expect(detectExternalTurns([candidate(true)], b, byId({ [SESSION]: true })))
      .toEqual([{ taskId: TASK, sessionId: SESSION, refine: true }])
  })

  it('a session that disappears (running false) never fires', () => {
    const b = book()
    detectExternalTurns([candidate()], b, byId({ [SESSION]: false }))
    expect(detectExternalTurns([candidate()], b, byId({}))).toEqual([])
  })
})

describe('grace helpers', () => {
  it('constants and withinGrace behave as documented', () => {
    expect(DIRECT_GRACE_MS).toBe(60_000)
    expect(EXTERNAL_SETTLE_GRACE_MS).toBe(90_000)
    expect(withinGrace(1_000_000, 999_000)).toBe(true)
    expect(withinGrace(999_000, 1_000_000)).toBe(false)
    expect(withinGrace(undefined, 1_000_000)).toBe(false)
  })
})
