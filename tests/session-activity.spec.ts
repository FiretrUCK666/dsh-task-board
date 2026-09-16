/**
 * Native-activity detection (session-activity.ts): the STATE rule behind
 * "两端同步" — a related session running RIGHT NOW with an unconsumed run
 * period fires exactly one external round (covering the flips the old edge
 * rule sampled AND the sessions already running at page load / bind time),
 * never on a session the board already owns (open round / direct-send turn),
 * never re-firing a completed turn.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DIRECT_GRACE_MS, EXTERNAL_SETTLE_GRACE_MS, buildSessionActivity, detectExternalTurns, latestUserMessage, nativeTurnOf, withinGrace, type ActivityBook } from '../src/core/session-activity.ts'
import type { LineageRow } from '../src/core/session-lineage.ts'

const TASK = 't-1'
const SESSION = 's-1'

function book(): ActivityBook {
  return { running: new Map(), externalSince: new Map(), recorded: new Set() }
}

function candidate(refine = false, hasOpenRound = false, inBoardTurn = false) {
  return {
    taskId: TASK,
    candidate: {
      sessions: [{ sessionId: SESSION, refine }],
      hasOpenRoundOn: () => hasOpenRound,
      inBoardTurnOn: () => inBoardTurn,
    },
  }
}

/** Wrap a plain running-flag table into the byId shape. */
function byId(flags: Record<string, boolean>): Record<string, { running: boolean }> {
  return Object.fromEntries(Object.entries(flags).map(([id, running]) => [id, { running }]))
}

describe('detectExternalTurns', () => {
  it('a session already running on the FIRST observation fires (the seed gap is closed)', () => {
    const b = book()
    // The old edge rule only baselined here — the row showed 进行中 while the
    // card never moved. The state rule fires the round immediately.
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: true })))
      .toEqual([{ taskId: TASK, sessionId: SESSION, refine: false }])
    // Idempotent within the run period: the second pass never double-fires.
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: true }))).toEqual([])
  })

  it('a false→true transition fires exactly once per run period', () => {
    const b = book()
    detectExternalTurns([candidate()], b, byId({ [SESSION]: false }))
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: true })))
      .toEqual([{ taskId: TASK, sessionId: SESSION, refine: false }])
    // Still running: consumed.
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: true }))).toEqual([])
    // Idle: the period ends…
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: false }))).toEqual([])
    // …and the NEXT native turn fires again (two flips, two rounds).
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: true })))
      .toEqual([{ taskId: TASK, sessionId: SESSION, refine: false }])
  })

  it('a lane veto does NOT consume (coverage) but a board turn does (identity)', () => {
    // Open board round on the session (lane held): vetoed this pass, but
    // the period stays UNCONSUMED — when the veto lifts with the session
    // still running, the turn fires. Consuming here is the "card never
    // lights" machine (the veto lifts on settle/cancel, no second edge).
    const b = book()
    expect(detectExternalTurns([candidate(false, true)], b, byId({ [SESSION]: true }))).toEqual([])
    expect(detectExternalTurns([candidate(false, false)], b, byId({ [SESSION]: true })))
      .toEqual([{ taskId: TASK, sessionId: SESSION, refine: false }])
    // Direct-send turn (inBoardTurnOn): identity veto — consumed, never fires.
    const b2 = book()
    detectExternalTurns([candidate(false, false, true)], b2, byId({ [SESSION]: true }))
    expect(detectExternalTurns([candidate()], b2, byId({ [SESSION]: true }))).toEqual([])
  })

  it('reports refine sessions with the refine flag', () => {
    const b = book()
    expect(detectExternalTurns([candidate(true)], b, byId({ [SESSION]: true })))
      .toEqual([{ taskId: TASK, sessionId: SESSION, refine: true }])
  })

  it('a session that disappears (unknown id) never fires and stays unarmed', () => {
    const b = book()
    detectExternalTurns([candidate()], b, byId({ [SESSION]: true }))
    // Gone from the list: reads idle → period re-arms, nothing fires.
    expect(detectExternalTurns([candidate()], b, byId({}))).toEqual([])
    expect(b.recorded.has(SESSION)).toBe(false)
  })

  it('past completed turns never re-fire across passes (a finished session is not running)', () => {
    const b = book()
    // Page load with the session already idle after a long absence: nothing.
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: false }))).toEqual([])
    expect(detectExternalTurns([candidate()], b, byId({ [SESSION]: false }))).toEqual([])
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

  it('carries the message seq as the turn anchor', () => {
    const events = [
      { type: 'user/message', seq: 7, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '旧' }] } },
      { type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '新' }] } },
    ]
    expect(latestUserMessage(events)).toEqual({ text: '新', hasImage: false, anchor: 9 })
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

describe('nativeTurnOf', () => {
  it('parses a live user/message frame into the turn facts (with anchor)', () => {
    expect(nativeTurnOf({ type: 'user/message', seq: 12, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '直接对话' }] } }))
      .toEqual({ text: '直接对话', hasImage: false, anchor: 12 })
  })

  it('ignores everything that is not a user message', () => {
    expect(nativeTurnOf({ type: 'assistant/chunk', data: {} })).toBeUndefined()
    expect(nativeTurnOf({ type: 'user/message', data: { source: { kind: 'injected' }, content: [] } })).toBeUndefined()
    expect(nativeTurnOf(null)).toBeUndefined()
    expect(nativeTurnOf('junk')).toBeUndefined()
  })
})

/**
 * THE activity layer of the same module: "is this session still working?"
 * (own turn ∨ running subagent descendant), three-valued so "no verdict" can
 * never be read as "not working". The detector tests above stay RAW-value
 * tests — the two questions must never be merged (see the last block).
 */
describe('sessionActivityOf / sessionActiveOf / buildSessionActivity (the one activity derivation)', () => {
  const rows = (spec: Record<string, [boolean, string | undefined, 'subagent' | undefined]>): Record<string, LineageRow> => {
    const out: Record<string, LineageRow> = {}
    for (const [id, [running, parentId, origin]] of Object.entries(spec)) {
      out[id] = {
        running,
        ...parentId !== undefined ? { parentId } : {},
        ...origin !== undefined ? { origin } : {},
      }
    }
    return out
  }
  const index = (spec: Parameters<typeof rows>[0], ready = true) =>
    buildSessionActivity(rows(spec), ready).activity

  it('own turn ⇒ own (the active flag is the same value)', () => {
    const activity = index({ P: [true, undefined, undefined] })
    expect(activity.activityOf('P')).toBe('own')
    expect(activity.active('P')).toBe(true)
  })

  it('own turn stopped, subagent descendant running ⇒ descendant, and ACTIVE', () => {
    // THE reported case: the parent's own turn is over while the subagent it
    // summoned keeps working. The official sidebar calls this still working.
    const activity = index({ P: [false, undefined, undefined], C: [true, 'P', 'subagent'] })
    expect(activity.activityOf('P')).toBe('descendant')
    expect(activity.active('P')).toBe(true)
    expect(activity.descendantRunningCount('P')).toBe(1)
    // The child answers for its own turn.
    expect(activity.activityOf('C')).toBe('own')
  })

  it('all descendants finished ⇒ idle (the rollback)', () => {
    const activity = index({ P: [false, undefined, undefined], C: [false, 'P', 'subagent'] })
    expect(activity.activityOf('P')).toBe('idle')
    expect(activity.active('P')).toBe(false)
    expect(activity.descendantRunningCount('P')).toBe(0)
  })

  it('a fork never makes its source active (origin is the first gate)', () => {
    const activity = index({ P: [false, undefined, undefined], F: [true, 'P', undefined] })
    expect(activity.activityOf('P')).toBe('idle')
  })

  it('a row missing from a READY snapshot is UNKNOWN — never idle, never active', () => {
    // The host list is the only truth: an absent row cannot tell "the work
    // stopped" from "the session is not in this page".
    const activity = index({})
    expect(activity.activityOf('GONE')).toBe('unknown')
    expect(activity.active('GONE')).toBe(false)
  })

  it('a list that has NOT ARRIVED testifies about nothing (every answer unknown)', () => {
    const activity = index({ P: [true, undefined, undefined] }, false)
    expect(activity.ready).toBe(false)
    expect(activity.activityOf('P')).toBe('unknown')
    expect(activity.active('P')).toBe(false)
  })

  it('an archived descendant still counts (the official rollup filters no archives)', () => {
    // Archive is a display concern of the registry, never an input here: the
    // row still says a subagent is running, so the ancestor is active. The
    // board must not cache an archive conclusion into activity (it is
    // reversible — un-archiving restores the session).
    const activity = index({ P: [false, undefined, undefined], C: [true, 'P', 'subagent'] })
    expect(activity.active('P')).toBe(true)
  })
})

describe('the detector keeps reading the RAW turn flag (activity never feeds it)', () => {
  it('a running DESCENDANT does not fire an external round for its idle parent', () => {
    // The reverse-deadlock guard: rolling descendants into the detector would
    // fabricate a round on the parent (anchored to an old user message) and
    // hold its lane. The detector must see the parent's own flag only.
    const b = book()
    const parent = { taskId: TASK, candidate: { sessions: [{ sessionId: 'P', refine: false }], hasOpenRoundOn: () => false, inBoardTurnOn: () => false } }
    const byIdRaw = { P: { running: false }, C: { running: true, parentId: 'P', origin: 'subagent' as const } }
    expect(detectExternalTurns([parent], b, byIdRaw)).toEqual([])
  })

  it('the source pins that read: the detector reads byId[...].running and never the activity read', () => {
    // A text-level contract, because the two live in one module: the detector
    // body must contain the raw read and must not call the activity helpers.
    const source = readFileSync(fileURLToPath(new URL('../src/core/session-activity.ts', import.meta.url)), 'utf8')
    const body = source.slice(source.indexOf('export function detectExternalTurns'))
      .slice(0, source.slice(source.indexOf('export function detectExternalTurns')).indexOf('\n}'))
    expect(body).toContain('byId[session.sessionId]?.running')
    expect(body).not.toContain('sessionActiveOf')
    expect(body).not.toContain('sessionActivityOf')
    expect(body).not.toContain('buildSessionActivity')
  })
})
