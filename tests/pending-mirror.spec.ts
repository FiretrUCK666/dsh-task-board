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

class FakeUiSession {
  snapshot = new Map<string, unknown>()
  private listeners = new Set<() => void>()
  readonly pendingInteractions = {
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

/** A data-only entry (the shape a host without the carrier actions serves). */
const question = (key: string, sessionId: string, text: string, kind = 'question'): [string, unknown] => [
  key,
  { key, kind, sessionId, questions: [{ id: 'q-1', question: text }] },
]

describe('PendingMirror', () => {
  it('projects the official snapshot per session, newest wins', () => {
    const ui = new FakeUiSession()
    ui.snapshot = new Map([
      question('question:1', 's-1', '一'),
      question('question:2', 's-1', '二'),
      question('question:3', 's-2', '三'),
    ])
    const mirror = new PendingMirror(ui)
    expect(mirror.pendingOf('s-1')?.questions[0]?.question).toBe('二')
    expect(mirror.pendingOf('s-1')?.rpcId).toBe('question:2')
    expect(mirror.pendingOf('s-2')?.questions[0]?.question).toBe('三')
    expect(mirror.pendingOf('s-9')).toBeUndefined()
  })

  it('never renders approval carriers', () => {
    const ui = new FakeUiSession()
    ui.snapshot = new Map([
      ['approval:1', { key: 'approval:1', kind: 'approval', sessionId: 's-1' }],
    ])
    const mirror = new PendingMirror(ui)
    expect(mirror.pendingOf('s-1')).toBeUndefined()
    expect(mirror.answerInPlace).toBe(false)
  })

  it('renders a detail-carried plan review (empty question line, plan in detail)', () => {
    const ui = new FakeUiSession()
    ui.snapshot = new Map([
      ['question:9', {
        key: 'question:9', kind: 'plan-review', sessionId: 's-1',
        questions: [{ question: '', detail: '# 计划正文', intent: { kind: 'plan-review', approve: '好' } }],
      }],
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
    ui.publish(new Map([question('question:7', 's-1', '七')]))
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
    ui.snapshot = new Map([['question:1', entry]])
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
    ui.snapshot = new Map([[firstKey, first]])
    const mirror = new PendingMirror(ui)
    // A NEWER interaction replaces the first one (same session, new key).
    const [secondKey, second] = live('question:2', 's-1', '二')
    ui.publish(new Map([[secondKey, second]]))
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
    ui.snapshot = new Map([question('question:1', 's-1', '一')])
    const mirror = new PendingMirror(ui)
    expect(mirror.answerInPlace).toBe(false)
    await expect(mirror.answer('question:1', 's-1', [])).resolves.toBe(false)
    await expect(mirror.cancel('question:1')).resolves.toBe(false)
  })

  it('reports a refused settle as false (the card keeps itself open)', async () => {
    const ui = new FakeUiSession()
    const [, entry] = live('question:1', 's-1', '一')
    entry.answer.mockRejectedValueOnce(new Error('already settled'))
    ui.snapshot = new Map([['question:1', entry]])
    const mirror = new PendingMirror(ui)
    await expect(mirror.answer('question:1', 's-1', [])).resolves.toBe(false)
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
