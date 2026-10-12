/**
 * PendingMirror contract: the official snapshot projects into per-session
 * newest-wins WireQuestions, approvals never render, and — while an entry
 * carries the native carrier's own `answer`/`dismiss` — the face settles THAT
 * request in place (never a second answerer, never a stale object). A
 * display-only entry (or no uiSession at all) reports `canAnswerOf` false FOR
 * THAT SESSION so the card degrades to navigate-to-answer — and an answerable
 * carrier in one session never makes another session's card answerable. Drives
 * the face with a hand-controlled fake uiSession (snapshot + listener set), no
 * real host.
 *
 * The carrier's SHAPE is the contract this file pins hardest: the names, the
 * payload envelope, and the near-miss shape (`cancel` instead of `dismiss`) that
 * makes the whole card read-only on a real host while every test still passes.
 */
import { describe, expect, it, vi } from 'vitest'
import { PendingMirror } from '../src/client/board/pending-mirror.ts'
import { planApproveAnswers, planQuestionOf } from '../src/core/question-rpc.ts'

/** One question as the official batch carries it. */
interface FakeQuestion {
  id: string
  question: string
  detail?: string
  options?: { label: string }[]
  intent?: { kind: string; approve: string }
}

/** One live interactive carrier, shaped like the native `PendingQuestion`. */
interface FakeCarrier {
  sessionId: string
  kind: string
  key: string
  questions: FakeQuestion[]
  channel: 'waterfall' | 'rpc' | 'none'
  answer: ReturnType<typeof vi.fn>
  dismiss: ReturnType<typeof vi.fn>
  snapshot: ReturnType<typeof vi.fn>
}

function carrier(sessionId: string, text: string, kind = 'question'): FakeCarrier {
  const entry: FakeCarrier = {
    sessionId,
    kind,
    key: '',
    questions: [{ id: 'q-1', question: text }],
    channel: 'waterfall',
    answer: vi.fn(async (_answer: unknown) => undefined),
    dismiss: vi.fn(async () => undefined),
    snapshot: vi.fn(() => ({ channel: entry.channel })),
  }
  return entry
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
    expect(mirror.canAnswerOf('s-run')).toBe(false)
    expect(mirror.canAnswerOf(undefined)).toBe(false)
  })

  it('waitingKindOf reads the SIGNAL from the status envelope — all three kinds, unknown reads as none', () => {
    const ui = new FakeUiSession()
    ui.snapshot = new Map([
      ['s-1', status(question('question:1', 's-1', '一')[1])],
      ['s-2', status(question('plan:1', 's-2', 'p', 'plan-review')[1])],
      ['s-3', status({ key: 'approval:1', kind: 'approval', sessionId: 's-3' })],
      ['s-4', status({ key: 'future:1', kind: 'future-domain', sessionId: 's-4' })],
      ['s-run', idleStatus(true)],
    ])
    const mirror = new PendingMirror(ui)
    expect(mirror.waitingKindOf('s-1')).toBe('question')
    expect(mirror.waitingKindOf('s-2')).toBe('plan-review')
    // The SIGNAL keeps approvals the CONTENT projection drops on purpose —
    // the bell and the card chips must show an approval wait even though the
    // board never renders an approval card (the native surface owns it).
    expect(mirror.waitingKindOf('s-3')).toBe('approval')
    expect(mirror.pendingOf('s-3')).toBeUndefined()
    // An unknown future domain kind reads as NOT waiting — never a guessed label.
    expect(mirror.waitingKindOf('s-4')).toBeUndefined()
    expect(mirror.waitingKindOf('s-run')).toBeUndefined()
    expect(mirror.waitingKindOf(undefined)).toBeUndefined()
  })

  it('without a uiSession the face observes no waiting (honest absence)', () => {
    const mirror = new PendingMirror(undefined)
    expect(mirror.waitingKindOf('s-1')).toBeUndefined()
    expect(mirror.pendingOf('s-1')).toBeUndefined()
    expect(mirror.canAnswerOf('s-1')).toBe(false)
  })

  it('never renders approval carriers', () => {
    const ui = new FakeUiSession()
    ui.snapshot = new Map([
      ['s-1', status({ key: 'approval:1', kind: 'approval', sessionId: 's-1' })],
    ])
    const mirror = new PendingMirror(ui)
    expect(mirror.pendingOf('s-1')).toBeUndefined()
    expect(mirror.canAnswerOf('s-1')).toBe(false)
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
    expect(mirror.canAnswerOf('s-1')).toBe(true)
    const answers = [{ id: 'q-1', selected: ['好'] }]
    await expect(mirror.answer('question:1', 's-1', answers)).resolves.toBe(true)
    // The ONE answerer: the request's own method, with the native answer shape.
    expect(entry.answer).toHaveBeenCalledTimes(1)
    expect(entry.answer).toHaveBeenCalledWith({ answers })
    /* A live waterfall settles through the carrier alone: the composer seat stays
       put (the card leaves with the next snapshot), so nothing else is called. */
    expect(entry.dismiss).not.toHaveBeenCalled()
    await expect(mirror.cancel('question:1')).resolves.toBe(true)
    expect(entry.dismiss).toHaveBeenCalledTimes(1)
  })

  it('answers with the asker own approve label (never the option order) and in the host envelope', async () => {
    /* The whole in-place path, end to end minus the DOM: the intent rides the
       projection, the plan grammar turns it into the asker's own label, and the
       carrier receives `{ answers: [...] }` — the shape the host validates. */
    const ui = new FakeUiSession()
    const [, entry] = live('question:9', 's-1', 'Approve this plan?', 'plan-review')
    entry.questions = [{
      id: 'plan-review',
      question: 'Approve this plan and leave plan mode?',
      detail: '# 计划',
      // The approve option is SECOND on purpose: an answer read off the option
      // order would send 'Keep planning' here.
      options: [{ label: 'Keep planning' }, { label: 'Approve' }],
      intent: { kind: 'plan-review', approve: 'Approve' },
    }]
    ui.snapshot = new Map([['s-1', status(entry)]])
    const mirror = new PendingMirror(ui)
    const item = planQuestionOf(mirror.pendingOf('s-1')!)!
    await expect(mirror.answer('question:9', 's-1', planApproveAnswers(item))).resolves.toBe(true)
    expect(entry.answer).toHaveBeenCalledWith({ answers: [{ id: 'plan-review', selected: ['Approve'] }] })
  })

  it('releases the composer seat only on the Remote channel, and never fails the answer for it', async () => {
    /* A question the host already CONTINUED answers through the Remote path and
       the answered card still holds the composer seat; the official plan panel
       releases it with a second call. A released-but-unreleased seat is a visible
       bug (a dead card over the composer), while a failed release happens AFTER
       the answer was delivered — so it reports, and the answer still counts. */
    const ui = new FakeUiSession()
    const [, remote] = live('question:1', 's-1', '一')
    remote.channel = 'rpc'
    remote.dismiss.mockRejectedValueOnce(new Error('already gone'))
    ui.snapshot = new Map([['s-1', status(remote)]])
    const mirror = new PendingMirror(ui)
    await expect(mirror.answer('question:1', 's-1', [])).resolves.toBe(true)
    expect(remote.dismiss).toHaveBeenCalledTimes(1)
  })

  it('refuses to promise a verb the carrier does not have', async () => {
    /* THE DRIFT RATCHET. The real defect: the board probed for `answer` +
       `cancel`, while the shipped carrier declares `answer` + `dismiss` — so
       `canAnswerOf` was false on every real host, every card fell to the read-only
       shell, and the dismissal call would have thrown on the reader's click.
       A carrier missing EITHER method is not answerable here. */
    const cancelsOnly = {
      key: 'question:1', kind: 'question', sessionId: 's-1',
      questions: [{ id: 'q-1', question: '一' }],
      answer: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    }
    const dismissesOnly = {
      key: 'question:2', kind: 'question', sessionId: 's-1',
      questions: [{ id: 'q-2', question: '二' }],
      dismiss: vi.fn(async () => undefined),
    }
    const ui = new FakeUiSession()
    ui.snapshot = new Map([['s-1', status(cancelsOnly)]])
    expect(new PendingMirror(ui).canAnswerOf('s-1')).toBe(false)
    ui.snapshot = new Map([['s-2', status({ ...dismissesOnly, sessionId: 's-2' })]])
    const mirror = new PendingMirror(ui)
    expect(mirror.canAnswerOf('s-2')).toBe(false)
    await expect(mirror.answer('question:2', 's-2', [])).resolves.toBe(false)
    await expect(mirror.cancel('question:2')).resolves.toBe(false)
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
    expect(first.dismiss).not.toHaveBeenCalled()
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
    expect(mirror.canAnswerOf('s-1')).toBe(false)
    await expect(mirror.answer('question:1', 's-1', [])).resolves.toBe(false)
    await expect(mirror.cancel('question:1')).resolves.toBe(false)
  })

  it('answers per SESSION: an interactive carrier never makes another session answerable', async () => {
    /* The defect this pins: the face used to scan EVERY entry and report
       「answerable」 when ANY carrier was interactive. A card then drew the
       answerable menu for a session whose own carrier was display-only — the
       reader pressed an option and the settle was refused, with nothing on the
       screen explaining why (「按钮点了没反应」). The question is about THIS
       card's carrier, so it is asked with THIS card's session. */
    const ui = new FakeUiSession()
    const [, liveEntry] = live('question:1', 's-live', '一')
    ui.snapshot = new Map([
      ['s-live', status(liveEntry)],
      ['s-plain', status(question('question:2', 's-plain', '二')[1])],
    ])
    const mirror = new PendingMirror(ui)
    expect(mirror.canAnswerOf('s-live')).toBe(true)
    expect(mirror.canAnswerOf('s-plain')).toBe(false)
    // The settle follows the same per-session answer, so the display-only
    // session is refused here rather than drawn as answerable and failing later.
    await expect(mirror.answer('question:1', 's-live', [])).resolves.toBe(true)
    await expect(mirror.answer('question:2', 's-plain', [])).resolves.toBe(false)
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
    // The drift pin: the mirror reads the per-session status envelope, and a bare
    // `Map<sessionId, carrier>` under `pendingInteractions` is the shape that
    // makes it go blind — the member does not exist, and nothing on the screen
    // says so. This asserts the envelope the mirror actually consumes, so
    // re-introducing the old shape fails here instead of on a user's screen.
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
    expect(mirror.canAnswerOf('s-1')).toBe(false)
    let calls = 0
    const dispose = mirror.subscribe(() => { calls += 1 })
    dispose()
    expect(calls).toBe(0)
    await expect(mirror.answer('k', 's-1', [])).resolves.toBe(false)
    await expect(mirror.cancel('k')).resolves.toBe(false)
  })
})
