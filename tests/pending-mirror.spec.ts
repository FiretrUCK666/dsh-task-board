/**
 * PendingMirror contract: the official snapshot projects into per-session
 * newest-wins WireQuestions, approvals never render, and — while an entry
 * carries the native carrier's own `answer`/`cancel` — the face settles THAT
 * request in place (never a second answerer, never a stale object). A
 * display-only entry (or no uiSession at all) reports `answerInPlace` false so
 * the card degrades to navigate-to-answer. Drives the face with a
 * hand-controlled fake uiSession (snapshot + listener set), no real host.
 */
import { describe, expect, it, vi } from 'vitest'
import { PendingMirror } from '../src/client/board/pending-mirror.ts'

/** One live interactive carrier, shaped like the native `PendingQuestion`. */
interface FakeCarrier {
  sessionId: string
  kind: string
  key: string
  questions: { id: string; question: string }[]
  answer: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}

function carrier(sessionId: string, text: string, kind = 'question'): FakeCarrier {
  return {
    sessionId,
    kind,
    key: '',
    questions: [{ id: 'q-1', question: text }],
    answer: vi.fn(async (_answer: unknown) => undefined),
    cancel: vi.fn(async () => undefined),
  }
}

/** One interactive carrier under its own key (the snapshot pair). */
function live(key: string, sessionId: string, text: string, kind = 'question'): [string, FakeCarrier] {
  const entry = carrier(sessionId, text, kind)
  entry.key = key
  return [key, entry]
}

/**
 * The host's session-status source, reproduced at its ACTUAL shape: the snapshot
 * is `Map<sessionId, { running, pendingInteraction, completionUnread }>` and the
 * interaction rides inside that status object (this is what the real alpha.2
 * `uiSession.sessionStatus` publishes). The fake deliberately does NOT hand the
 * mirror a bare carrier map — that shape belonged to the removed
 * `pendingInteractions` field, and reproducing it here would let the mirror pass
 * its tests while being blind on a real host.
 */
class FakeUiSession {
  snapshot = new Map<string, unknown>()
  private listeners = new Set<() => void>()
  readonly sessionStatus = {
    getSnapshot: () => this.snapshot as ReadonlyMap<string, unknown>,
    subscribe: (fn: () => void): (() => void) => {
      this.listeners.add(fn)
      return () => { this.listeners.delete(fn) }
    },
  }
  publish(snapshot: Map<string, unknown>): void {
    this.snapshot = snapshot
    for (const fn of [...this.listeners]) fn()
  }
}

/** Wrap one interaction in the host's per-session status envelope. */
const status = (interaction: unknown, running = false): { running: boolean; pendingInteraction: unknown; completionUnread: boolean } =>
  ({ running, pendingInteraction: interaction, completionUnread: false })

/** A session-status snapshot entry with NO pending interaction (idle/running). */
const idleStatus = (running: boolean): { running: boolean; pendingInteraction: undefined; completionUnread: boolean } =>
  ({ running, pendingInteraction: undefined, completionUnread: false })

/** A data-only entry (the shape a host without the carrier actions serves). */
const question = (key: string, sessionId: string, text: string, kind = 'question'): [string, unknown] => [
  key,
  { key, kind, sessionId, questions: [{ id: 'q-1', question: text }] },
]

describe('PendingMirror', () => {
  it('projects the official snapshot per session, newest wins', () => {
    const ui = new FakeUiSession()
    ui.snapshot = new Map([
      ['s-1', status(question('question:1', 's-1', '一')[1])],
      ['s-1', status(question('question:2', 's-1', '二')[1])],
      ['s-2', status(question('question:3', 's-2', '三')[1])],
    ])
    const mirror = new PendingMirror(ui)
    expect(mirror.pendingOf('s-1')?.questions[0]?.question).toBe('二')
    expect(mirror.pendingOf('s-1')?.rpcId).toBe('question:2')
    expect(mirror.pendingOf('s-2')?.questions[0]?.question).toBe('三')
    expect(mirror.pendingOf('s-9')).toBeUndefined()
  })

  it('ignores sessions with no pending interaction (running or idle status entries)', () => {
    // The host's snapshot carries EVERY session, so a running session with no
    // question must project as "no pending card" — reading the status object
    // itself as a carrier would invent a card out of a running session.
    const ui = new FakeUiSession()
    ui.snapshot = new Map([
      ['s-run', idleStatus(true)],
      ['s-idle', idleStatus(false)],
    ])
    const mirror = new PendingMirror(ui)
    expect(mirror.pendingOf('s-run')).toBeUndefined()
    expect(mirror.pendingOf('s-idle')).toBeUndefined()
    expect(mirror.answerInPlace).toBe(false)
  })

  it('never renders approval carriers', () => {
    const ui = new FakeUiSession()
    ui.snapshot = new Map([
      ['s-1', status({ key: 'approval:1', kind: 'approval', sessionId: 's-1' })],
    ])
    const mirror = new PendingMirror(ui)
    expect(mirror.pendingOf('s-1')).toBeUndefined()
    expect(mirror.answerInPlace).toBe(false)
  })

  it('renders a detail-carried plan review (empty question line, plan in detail)', () => {
    const ui = new FakeUiSession()
    ui.snapshot = new Map([
      ['s-1', status({
        key: 'question:9', kind: 'plan-review', sessionId: 's-1',
        questions: [{ question: '', detail: '# 计划正文', intent: { kind: 'plan-review', approve: '好' } }],
      })],
    ])
    const mirror = new PendingMirror(ui)
    const pending = mirror.pendingOf('s-1')
    expect(pending?.isPlanReview).toBe(true)
    expect(pending?.questions[0]?.detail).toBe('# 计划正文')
  })

  it('notifies subscribers when the official snapshot moves', () => {
    const ui = new FakeUiSession()
    const mirror = new PendingMirror(ui)
    let calls = 0
    const dispose = mirror.subscribe(() => { calls += 1 })
    expect(mirror.pendingOf('s-1')).toBeUndefined()
    ui.publish(new Map([['s-1', status(question('question:7', 's-1', '七')[1])]]))
    expect(calls).toBe(1)
    expect(mirror.pendingOf('s-1')?.questions[0]?.question).toBe('七')
    ui.publish(new Map())
    expect(calls).toBe(2)
    expect(mirror.pendingOf('s-1')).toBeUndefined()
    dispose()
  })

  it('settles the carrier it received (in place, whole batch, native shape)', async () => {
    const ui = new FakeUiSession()
    const [, entry] = live('question:1', 's-1', '一')
    ui.snapshot = new Map([['s-1', status(entry)]])
    const mirror = new PendingMirror(ui)
    expect(mirror.answerInPlace).toBe(true)
    const answers = [{ id: 'q-1', selected: ['好'] }]
    await expect(mirror.answer('question:1', 's-1', answers)).resolves.toBe(true)
    // The ONE answerer: the request's own method, with the native answer shape.
    expect(entry.answer).toHaveBeenCalledTimes(1)
    expect(entry.answer).toHaveBeenCalledWith({ answers })
    await expect(mirror.cancel('question:1')).resolves.toBe(true)
    expect(entry.cancel).toHaveBeenCalledTimes(1)
  })

  it('refuses a stale identity instead of settling something else', async () => {
    const ui = new FakeUiSession()
    const [firstKey, first] = live('question:1', 's-1', '一')
    ui.snapshot = new Map([[firstKey, status(first)]])
    const mirror = new PendingMirror(ui)
    // A NEWER interaction replaces the first one (same session, new key).
    const [secondKey, second] = live('question:2', 's-1', '二')
    ui.publish(new Map([[secondKey, status(second)]]))
    await expect(mirror.answer('question:1', 's-1', [])).resolves.toBe(false)
    await expect(mirror.cancel('question:1')).resolves.toBe(false)
    expect(first.answer).not.toHaveBeenCalled()
    expect(first.cancel).not.toHaveBeenCalled()
    // The live one still answers.
    await expect(mirror.answer('question:2', 's-1', [])).resolves.toBe(true)
    // A settled request is gone: nothing left to settle.
    ui.publish(new Map())
    await expect(mirror.answer('question:2', 's-1', [])).resolves.toBe(false)
  })

  it('never answers a carrier that exposes no action (display-only entry)', async () => {
    const ui = new FakeUiSession()
    ui.snapshot = new Map([['s-1', status(question('question:1', 's-1', '一')[1])]])
    const mirror = new PendingMirror(ui)
    expect(mirror.answerInPlace).toBe(false)
    await expect(mirror.answer('question:1', 's-1', [])).resolves.toBe(false)
    await expect(mirror.cancel('question:1')).resolves.toBe(false)
  })

  it('reports a refused settle as false (the card keeps itself open)', async () => {
    const ui = new FakeUiSession()
    const [, entry] = live('question:1', 's-1', '一')
    entry.answer.mockRejectedValueOnce(new Error('already settled'))
    ui.snapshot = new Map([['s-1', status(entry)]])
    const mirror = new PendingMirror(ui)
    await expect(mirror.answer('question:1', 's-1', [])).resolves.toBe(false)
  })

  it('reads the session-status envelope, not a bare interaction map', () => {
    // The drift pin: the host used to publish a bare `Map<sessionId, carrier>`
    // under `pendingInteractions`. That field was REMOVED and replaced by the
    // per-session status map, and the board's mirror silently went blind (it
    // read a member that no longer existed). This asserts the envelope the
    // mirror actually consumes, so re-introducing the old shape fails here
    // instead of on a user's screen.
    const ui = new FakeUiSession()
    const [, entry] = live('question:1', 's-1', '一')
    ui.snapshot = new Map([['s-1', entry]])
    const mirror = new PendingMirror(ui)
    expect(mirror.pendingOf('s-1')).toBeUndefined()

    ui.snapshot = new Map([['s-1', status(entry)]])
    expect(mirror.pendingOf('s-1')?.questions[0]?.question).toBe('一')
  })

  it('degrades to empty without a uiSession face', async () => {
    const mirror = new PendingMirror(undefined)
    expect(mirror.pendingOf('s-1')).toBeUndefined()
    expect(mirror.answerInPlace).toBe(false)
    let calls = 0
    const dispose = mirror.subscribe(() => { calls += 1 })
    dispose()
    expect(calls).toBe(0)
    await expect(mirror.answer('k', 's-1', [])).resolves.toBe(false)
    await expect(mirror.cancel('k')).resolves.toBe(false)
  })
})
