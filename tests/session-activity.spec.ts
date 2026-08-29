/**
 * Native-activity detection (session-activity.ts): the running-flip signal
 * behind "两端同步" — out-of-band turns are detected from a related session
 * flipping to running, never from past activity, never on a session the
 * board already owns or already recorded via direct-send.
 */
import { describe, expect, it } from 'vitest'
import { DIRECT_GRACE_MS, EXTERNAL_SETTLE_GRACE_MS, detectExternalTurns, latestUserMessage, withinGrace, type ActivityBook } from '../src/core/session-activity.ts'

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

  it('seeding: a never-seen session already running does NOT fire during the seed pass', () => {
    const b = book()
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: true }))).toEqual([])
    expect(b.seeded).toBe(true)
  })

  it('after seeding, a session entering the related set while already running fires (born at its first message)', () => {
    const b = book()
    // Seed with a DIFFERENT session: the target session has never been seen.
    const other = {
      taskId: TASK,
      candidate: {
        sessions: [{ sessionId: 's-other', refine: false }],
        hasOpenRoundOn: () => false,
        inGrace: () => false,
      },
    }
    detectExternalTurns([other], b, byId({ 's-other': false }))
    expect(b.seeded).toBe(true)
    // The new session appears (a fresh workspace member mid-conversation):
    // no flip can ever be observed for it — its first sighting IS the turn.
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: true })))
      .toEqual([{ taskId: TASK, sessionId: SESSION, refine: false }])
    // Idempotent: the second sighting is a baseline, never a duplicate.
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: true }))).toEqual([])
  })

  it('after seeding, a first sighting that is NOT running only baselines', () => {
    const b = book()
    detectExternalTurns([candidate(false, false)], b, byId({ [SESSION]: false }))
    // Classic flip still applies to the now-known session.
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: true })))
      .toEqual([{ taskId: TASK, sessionId: SESSION, refine: false }])
  })

  it('first-sighting detection respects the open-round and grace guards', () => {
    const b = book()
    detectExternalTurns([candidate(false, false)], b, byId({ [SESSION]: false }))
    expect(detectExternalTurns([candidate(false, true)], b, byId({ [SESSION]: true }))).toEqual([])
    const graced = {
      taskId: TASK,
      candidate: {
        sessions: [{ sessionId: 's-g', refine: false }],
        hasOpenRoundOn: () => false,
        inGrace: () => true,
      },
    }
    expect(detectExternalTurns([graced], b, byId({ 's-g': true }))).toEqual([])
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

describe('latestUserMessage', () => {
  it('returns the newest native user text (skipping injected/context rows)', () => {
    const events = [
      { type: 'user/message', data: { source: { kind: 'injected' }, content: [{ type: 'text', text: '插件注入' }] } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '回应' }] } } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: ' 你好，plan mode ' }, { type: 'text', text: '继续' }] } },
    ]
    expect(latestUserMessage(events)).toEqual({ text: '你好，plan mode\n继续', hasImage: false })
  })

  it('the LATEST user message is the truth — never falls back to an older text', () => {
    const events = [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '较早的消息' }] } },
      // A picture-only message follows: its truth is "a picture", not the
      // older text above (a fallback would mislabel the thread).
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'image', attachment: {} }] } },
    ]
    expect(latestUserMessage(events)).toEqual({ hasImage: true })
  })

  it('a picture + text message reports both facts', () => {
    const events = [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '看图' }, { type: 'image', attachment: {} }] } },
    ]
    expect(latestUserMessage(events)).toEqual({ text: '看图', hasImage: true })
  })

  it('returns undefined for a missing window or non-user tails', () => {
    expect(latestUserMessage([])).toBeUndefined()
    expect(latestUserMessage([{ type: 'assistant/message', data: {} }])).toBeUndefined()
    expect(latestUserMessage([{ type: 'user/message', data: { source: { kind: 'injected' }, content: [{ type: 'text', text: 'x' }] } }])).toBeUndefined()
  })
})
