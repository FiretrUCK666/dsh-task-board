/**
 * PendingMirror contract: the official snapshot projects into per-session
 * newest-wins WireQuestions, approvals never render, and the face never
 * answers in place (navigate-to-answer). Drives the face with a
 * hand-controlled fake uiSession (snapshot + listener set), no real host.
 */
import { describe, expect, it } from 'vitest'
import { PendingMirror } from '../src/client/board/pending-mirror.ts'

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

  it('never answers in place: answer/cancel always report false', async () => {
    const ui = new FakeUiSession()
    ui.snapshot = new Map([question('question:1', 's-1', '一')])
    const mirror = new PendingMirror(ui)
    expect(mirror.answerInPlace).toBe(false)
    await expect(mirror.answer('question:1', 's-1', [])).resolves.toBe(false)
    await expect(mirror.cancel('question:1')).resolves.toBe(false)
  })

  it('degrades to empty without a uiSession face', async () => {
    const mirror = new PendingMirror(undefined)
    expect(mirror.pendingOf('s-1')).toBeUndefined()
    let calls = 0
    const dispose = mirror.subscribe(() => { calls += 1 })
    dispose()
    expect(calls).toBe(0)
    await expect(mirror.answer('k', 's-1', [])).resolves.toBe(false)
  })
})
