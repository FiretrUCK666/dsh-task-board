/**
 * Session posture tests (src/host/session-state.ts) — the four questions the
 * board and the model share one derivation for.
 *
 * Three things are pinned here beyond the obvious yes/no per question:
 *
 *  - "I cannot see it" and "it is not so" are DIFFERENT answers. Every face is
 *    exercised both present and absent, because a module that degrades to
 *    `false` looks perfect on a healthy host and lies on every deployment that
 *    composes less.
 *  - The approval pairing is by REQUEST ID, not by position: an ask with a
 *    decision is not waiting, and a decision with no ask fabricates nothing.
 *  - This module cannot write. That is a mechanical ban, not a promise in a
 *    comment: a reader who needs a memory of the posture has to take one.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  attachQuestionWaitRecorder,
  awaitingAnswerOf,
  awaitingApprovalIn,
  awaitingApprovalOf,
  createQuestionWaitRecorder,
  sessionArchivedOf,
  sessionPostureOf,
  sessionRunningOf,
  type BypassTarget,
  type SessionPostureSources,
} from '../src/host/session-state.ts'

const S = 'sess-1'

/** An agent face with one session's status. */
function agents(status: unknown, id = S): { agents: () => { get: (key: string) => { status: unknown } | undefined } } {
  return { agents: () => ({ get: (key) => (key === id ? { status } : undefined) }) }
}

/** An archive set. */
function archived(ids: readonly string[]): { workspaceRegistry: () => { archivedSessionIds: readonly string[] } } {
  return { workspaceRegistry: () => ({ archivedSessionIds: ids }) }
}

/** A log face over a fixed event list. */
function log(events: readonly unknown[]): { sessionQuery: () => { readSession: (id: string) => Promise<{ events: readonly unknown[] }> } } {
  return { sessionQuery: () => ({ readSession: async () => ({ events }) }) }
}

/** One approval event, in the log's own `{ type, data }` shape. */
function approvalEvent(type: 'approval/asked' | 'approval/decided', id: string): unknown {
  return { type, seq: 1, time: 0, data: { id } }
}

/** A `user-questions/request` payload carrying an agent's session id. */
function questionRequest(sessionId: string | undefined): unknown {
  return { questions: [{ id: 'q1', question: '?' }], agent: sessionId === undefined ? undefined : { session: { id: sessionId } } }
}

/** A bypass target that records its listeners so a test can fire them.
 *  `next` is injectable so a test can drive the real listener into a
 *  rejection — a copy of the listener's logic would prove nothing. */
function fakeTarget(next: () => Promise<unknown> = async () => ({ answers: [] })):
    BypassTarget & { fire(event: string, request: unknown): Promise<unknown>; listeners: string[]; dispose(): void } {
  const listeners = new Map<string, (...args: never[]) => unknown>()
  let dispose: unknown
  const box = {
    listeners: [] as string[],
    on(event: string, listener: (...args: never[]) => unknown) {
      box.listeners.push(event)
      listeners.set(event, listener)
      dispose = () => { listeners.delete(event) }
      return dispose
    },
    fire(event: string, request: unknown) {
      const listener = listeners.get(event) as unknown as (a: unknown, b: () => Promise<unknown>) => Promise<unknown>
      return listener(request, next)
    },
    dispose() { (dispose as () => void)() },
  }
  return box as unknown as BypassTarget & { fire(event: string, request: unknown): Promise<unknown>; listeners: string[]; dispose(): void }
}

describe('1 · is the session working', () => {
  it('says yes for a running agent and no for an idle one', () => {
    expect(sessionRunningOf(agents('running'), S).value).toBe(true)
    expect(sessionRunningOf(agents('idle'), S).value).toBe(false)
  })

  it('refuses to answer for a host without the face — it does not guess "idle"', () => {
    const fact = sessionRunningOf({}, S)
    expect(fact.value).toBe('unknown')
    expect(fact.unreadable).toContain('ctx.agents')
  })

  it('refuses to answer for a session it has no agent for, and for an unrecognised status', () => {
    expect(sessionRunningOf(agents('running', 'other'), S).value).toBe('unknown')
    expect(sessionRunningOf(agents('thinking'), S).value).toBe('unknown')
    expect(sessionRunningOf(agents(undefined), S).value).toBe('unknown')
  })

  it('survives a face that throws, and one whose getter throws', () => {
    const throwing: SessionPostureSources = { agents: () => { throw new Error('hub down') } }
    expect(sessionRunningOf(throwing, S).unreadable).toContain('hub down')
    const badGet = { agents: () => ({ get: () => { throw new Error('no such agent') } }) }
    expect(sessionRunningOf(badGet, S).unreadable).toContain('no such agent')
  })
})

describe('2 · is the session archived', () => {
  it('says yes for a member of the archive set and no for everyone else', () => {
    expect(sessionArchivedOf(archived(['other', S]), S).value).toBe(true)
    expect(sessionArchivedOf(archived(['other']), S).value).toBe(false)
    expect(sessionArchivedOf(archived([]), S).value).toBe(false)
  })

  it('refuses to answer without the registry, and never treats "not a member" as "not archived"', () => {
    expect(sessionArchivedOf({}, S).value).toBe('unknown')
    // A registry that exists but carries no archive field is a host that
    // cannot answer — not a session that is definitely not archived.
    const fieldless = { workspaceRegistry: () => ({}) }
    expect(sessionArchivedOf(fieldless, S).value).toBe('unknown')
  })
})

describe('3 · is the session waiting for an approval', () => {
  it('an ask with no decision is waiting; the same ask with one is not', () => {
    const asked = [approvalEvent('approval/asked', 'r1')]
    expect(awaitingApprovalIn(asked)).toBe(true)
    expect(awaitingApprovalIn([...asked, approvalEvent('approval/decided', 'r1')])).toBe(false)
  })

  it('pairs by request id, so another request\'s decision settles nothing', () => {
    const events = [approvalEvent('approval/asked', 'r1'), approvalEvent('approval/asked', 'r2'), approvalEvent('approval/decided', 'r1')]
    expect(awaitingApprovalIn(events)).toBe(true)
    expect(awaitingApprovalIn([...events, approvalEvent('approval/decided', 'r2')])).toBe(false)
  })

  it('a decision with no ask fabricates no wait, and malformed events are skipped', () => {
    expect(awaitingApprovalIn([approvalEvent('approval/decided', 'r1')])).toBe(false)
    // A record we cannot read must never be counted as a settlement.
    expect(awaitingApprovalIn([
      { type: 'approval/asked' },
      { type: 'approval/asked', data: {} },
      { type: 'approval/asked', data: { id: 7 } },
      null,
      'junk',
      approvalEvent('approval/decided', 'r1'),
    ])).toBe(false)
  })

  it('reads the durable log, and says so when the log is unreadable', async () => {
    expect((await awaitingApprovalOf(log([approvalEvent('approval/asked', 'r1')]), S)).value).toBe(true)
    expect((await awaitingApprovalOf({}, S)).value).toBe('unknown')
    const throwing: SessionPostureSources = { sessionQuery: () => ({ readSession: async () => { throw new Error('log gone') } }) }
    expect((await awaitingApprovalOf(throwing, S)).unreadable).toContain('log gone')
    const shapeless = { sessionQuery: () => ({ readSession: async () => ({}) }) }
    expect((await awaitingApprovalOf(shapeless, S)).value).toBe('unknown')
  })
})

describe('4 · is the session waiting for an answer', () => {
  it('the bypass brackets the dispatch and never claims it', async () => {
    const recorder = createQuestionWaitRecorder()
    const target = fakeTarget()
    attachQuestionWaitRecorder(target, recorder)
    expect(target.listeners).toEqual(['user-questions/request'])

    const settled = target.fire('user-questions/request', questionRequest(S))
    // While the dispatch is in flight the session is waiting…
    expect(awaitingAnswerOf(recorder, S).value).toBe(true)
    // …and our listener delegates rather than answering.
    await expect(settled).resolves.toEqual({ answers: [] })
    expect(awaitingAnswerOf(recorder, S).value).toBe(false)
  })

  it('releases the window even when the dispatch rejects', async () => {
    const recorder = createQuestionWaitRecorder()
    const target = fakeTarget(async () => { throw new Error('aborted') })
    attachQuestionWaitRecorder(target, recorder)
    const settled = target.fire('user-questions/request', questionRequest(S))
    expect(awaitingAnswerOf(recorder, S).value).toBe(true)
    await expect(settled).rejects.toThrow('aborted')
    expect(awaitingAnswerOf(recorder, S).value).toBe(false)
  })

  it('the registration comes off with its disposer', () => {
    const recorder = createQuestionWaitRecorder()
    const target = fakeTarget()
    const dispose = attachQuestionWaitRecorder(target, recorder)
    dispose()
    expect(() => target.fire('user-questions/request', questionRequest(S))).toThrow()
  })

  it('counts overlapping questions per session, so one answer cannot clear another', async () => {
    const recorder = createQuestionWaitRecorder()
    recorder.noteAsk(S)
    recorder.noteAsk(S)
    recorder.noteSettled(S)
    expect(awaitingAnswerOf(recorder, S).value).toBe(true)
    recorder.noteSettled(S)
    expect(awaitingAnswerOf(recorder, S).value).toBe(false)
  })

  it('says "I was not looking" rather than "nobody is waiting"', () => {
    expect(awaitingAnswerOf(undefined, S).value).toBe('unknown')
    expect(awaitingAnswerOf(undefined, S).unreadable).toContain('no question bypass')
    // A recorder that has never seen a dispatch has told us nothing yet.
    const fresh = createQuestionWaitRecorder()
    expect(awaitingAnswerOf(fresh, S).value).toBe('unknown')
    expect(awaitingAnswerOf(fresh, S).unreadable).toContain('not seen a dispatch')
    // Once it has observed one, absence becomes a real answer again.
    fresh.noteAsk('other')
    expect(awaitingAnswerOf(fresh, S).value).toBe(false)
  })

  it('a payload with no session id is delegated without a ledger entry', async () => {
    const recorder = createQuestionWaitRecorder()
    const target = fakeTarget()
    attachQuestionWaitRecorder(target, recorder)
    await expect(target.fire('user-questions/request', questionRequest(undefined))).resolves.toEqual({ answers: [] })
    expect(awaitingAnswerOf(recorder, S).value).toBe('unknown')
  })

  it('disposing the recorder forgets every open window', () => {
    const recorder = createQuestionWaitRecorder()
    recorder.noteAsk(S)
    recorder.dispose()
    expect(recorder.awaitingOf(S)).toBe(false)
  })
})

describe('the one derivation', () => {
  it('answers all four from one set of sources', async () => {
    const sources: SessionPostureSources = {
      ...agents('running'),
      ...archived([S]),
      ...log([approvalEvent('approval/asked', 'r1')]),
    }
    const recorder = createQuestionWaitRecorder()
    recorder.noteAsk(S)
    const posture = await sessionPostureOf(sources, recorder, S)
    expect(posture).toEqual({
      sessionId: S,
      running: { value: true },
      archived: { value: true },
      awaitingApproval: { value: true },
      awaitingAnswer: { value: true },
    })
  })

  it('reports every gap honestly instead of failing the whole read', async () => {
    const posture = await sessionPostureOf({}, undefined, S)
    expect(posture.sessionId).toBe(S)
    for (const fact of [posture.running, posture.archived, posture.awaitingApproval, posture.awaitingAnswer]) {
      expect(fact.value).toBe('unknown')
      expect(fact.unreadable).toBeTruthy()
    }
  })
})

describe('this module cannot write', () => {
  // Posture is volatile: a running flag flips twice a minute. Persisting it
  // would broadcast a commit to every replica for every flip, on the one
  // channel the board uses for real edits. So the ban is mechanical — a
  // promise in a comment is not a promise.
  it('carries no write, broadcast or answering path, and imports no SDK runtime', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/host/session-state.ts', import.meta.url)), 'utf8')
    const forbidden = [
      /\.putRecord\(/, /\.deleteRecord\(/, /\.setGlobal\(/, /\.backupRecord\(/,
      /\bbroadcast\(/, /\.commit\(/, /\.submitCommand\(/, /\.open\(/,
      /\bfetch\(/, /\blocalStorage\b/, /\.writeFile/, /\.rename\(/,
      // approving or answering on the human's behalf is the one thing the
      // posture module must never grow
      /\.answer\(/, /\.cancel\(/, /\.retain\(/, /approval\/request/,
    ]
    for (const pattern of forbidden) {
      expect(source, `session-state.ts must not contain ${pattern}`).not.toMatch(pattern)
    }
    // Structural faces only: a runtime import would put the SDK in the bundle.
    expect(source).not.toMatch(/from '@deepseek-ai\//)
  })
})
