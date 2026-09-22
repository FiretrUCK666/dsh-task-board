/**
 * Card view-model (client/board/card-view.ts): single prioritized summary —
 * waiting > running > queued > failed > review > idle.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cardLightOf, cardNextActionOf, cardSessionDotStateOf, cardViewModelOf, titleOrUntitled } from '../src/client/board/card-view.ts'
import { createTask, newCommentRound, startExecution, withSchedule, withStatus, type TaskRecord } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

function task() {
  return createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'task-1')
}

describe('titleOrUntitled (the one blank-title judgment)', () => {
  it('reads the title, or the placeholder when blank', () => {
    expect(titleOrUntitled('画猫', '未命名')).toBe('画猫')
    expect(titleOrUntitled('', '未命名')).toBe('未命名')
    expect(titleOrUntitled('   ', '未命名')).toBe('未命名')
  })
})

describe('cardViewModelOf', () => {
  it('idle task with nothing scheduled has no emphasis', () => {
    const view = cardViewModelOf(task())
    expect(view.primary).toEqual({ kind: 'idle' })
    expect(view.active).toBe(false)
    expect(cardNextActionOf(view, task())).toBeUndefined()
  })

  it('waiting outranks running', () => {
    const started = startExecution(task(), NOW, 'e1')
    const view = cardViewModelOf(started.task, { waiting: 'question', pendingCount: 1 })
    expect(view.primary).toEqual({ kind: 'waiting', waiting: 'question' })
    expect(view.active).toBe(true)
  })

  it('an OPEN round lights the card, whether or not a session reports running', () => {
    // The reported defect: a card sitting in 进行中 with the yellow border and no
    // pulse. Its only unfinished round was an EXTERNALLY observed turn, so no
    // session reported `running` — the light used to be driven by exactly that
    // native flag, while the chip and the border were driven by the open round.
    // Two judgments, one card, opposite answers. The light now follows the state
    // the card DISPLAYS, so an open round lights it with or without that flag.
    const open = { id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined, external: true }
    const card = { ...task(), status: 'running' as const, executions: [open] }
    const view = cardViewModelOf(card, {})
    expect(view.primary).toEqual({ kind: 'running' })
    expect(view.active, 'a card reading 进行中 must pulse (the chip and the light are one fact)').toBe(true)
    // The card's own COLUMN is the other half of the same fact, and it is the
    // SAME `task.status` the yellow border reads (`data-status`): a card in
    // 进行中 breathes even with nothing in flight — the 有黄边、没呼吸 report
    // (an armed schedule's gap, a direct steer settled at birth, or a related
    // session whose own turn paused while its subagent keeps working). The
    // border and the light can no longer disagree.
    const settled = { ...card, executions: [{ ...open, endedAt: NOW + 1, result: 'succeeded' as const }] }
    expect(
      cardViewModelOf(settled, {}).active,
      'yellow border on ⇒ breath on: the column is the fact both attributes read',
    ).toBe(true)
    // Out of the running column with nothing in flight: quiet.
    const reviewed = { ...settled, status: 'review' as const }
    expect(cardViewModelOf(reviewed, {}).active).toBe(false)
  })

  it('every way a card reaches the 进行中 column breathes (the light table, one row per fact)', () => {
    // The three reachable holders of the column, all of which used to be able
    // to sit there with the border on and no animation: an open round, a
    // direct steer settled at birth (its session is the only signal), and a
    // chain/budget gap between automatic runs — plus the activity leg a
    // running subagent descendant creates. The light reads the COLUMN, so all
    // of them breathe; the quiet rows stay quiet.
    const openRound = { id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }
    const directRound = { id: 'e2', sessionId: 's-1', startedAt: NOW, endedAt: NOW, result: 'succeeded' as const, error: undefined, direct: true as const }
    const gap = withSchedule(task(), { enabled: true, mode: 'chain', cron: '', runCount: 0 }, NOW)
    const holders: Array<[string, TaskRecord]> = [
      ['an open round', { ...task(), status: 'running' as const, executions: [openRound] }],
      ['a direct steer settled at birth (no open round)', { ...task(), status: 'running' as const, executions: [directRound] }],
      ['a chain gap between runs (no rounds at all)', withStatus(gap, 'running', NOW)],
      ['a live related session with no board round (the subagent case)', { ...task(), status: 'running' as const }],
    ]
    for (const [what, card] of holders) {
      const view = cardViewModelOf(card, {})
      expect(view.active, `${what} must wear the halo`).toBe(true)
      expect(cardLightOf(view.active, false), `${what} must animate`).toBe('halo')
    }
    // Quiet rows: everything settled and out of the column.
    const settledRun = { ...task(), status: 'review' as const, executions: [{ ...openRound, endedAt: NOW, result: 'succeeded' as const }] }
    expect(cardViewModelOf(settledRun, {}).active).toBe(false)
    expect(cardViewModelOf(settledRun, { unviewedCount: 1 }).active, 'unread alone is the RING, never the halo').toBe(false)
    expect(cardLightOf(cardViewModelOf(settledRun, { unviewedCount: 1 }).active, true)).toBe('ring')
  })

  it('the light table: waiting/running pulse, queued/failed/review/idle do not', () => {
    // The board's 光效规则表 as a table: only these two primaries breathe
    // (plus the card's own 进行中 column). `queued` is deliberately quiet —
    // a card with saved-but-not-injected comments is waiting on the engine,
    // not working.
    const started = startExecution(task(), NOW, 'e1')
    expect(cardViewModelOf(started.task, { waiting: 'approval' }).active).toBe(true)
    expect(cardViewModelOf(started.task, {}).active).toBe(true)
    const comment = newCommentRound({ id: 'c1', now: NOW, text: 'hi', sessionId: 's-1', parentExecutionId: 'e-1' })
    expect(cardViewModelOf({ ...task(), executions: [comment] }, {}).active).toBe(false)
    const failed = { ...task(), status: 'review' as const, executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: NOW + 1, result: 'failed' as const, error: undefined }] }
    expect(cardViewModelOf(failed, {}).primary).toEqual({ kind: 'failed' })
    expect(cardViewModelOf(failed, {}).active).toBe(false)
    expect(cardViewModelOf(task(), {}).active).toBe(false)
  })

  it('queued comments surface with their count', () => {
    const base = task()
    const round = newCommentRound({ id: 'c1', now: NOW, text: 'hi', sessionId: 's-1', parentExecutionId: 'e-1' })
    const view = cardViewModelOf({ ...base, executions: [round] }, {})
    expect(view.primary).toEqual({ kind: 'queued', count: 1 })
    expect(cardNextActionOf(view, base)).toEqual({ kind: 'queued', count: 1 })
  })
})

describe('cardSessionDotStateOf (one dot, one loudest truth)', () => {
  /** A task whose s-1 finished a run at NOW+5, optionally reviewed after it. */
  const finished = (viewedAt?: number): TaskRecord => ({
    ...task(),
    executions: [{
      id: 'e1',
      sessionId: 's-1',
      startedAt: NOW,
      endedAt: NOW + 5,
      result: 'succeeded' as const,
      error: undefined,
      ...(viewedAt !== undefined ? { viewedAt } : {}),
    }],
  })
  const faces = (over: { waiting?: boolean; active?: boolean } = {}) => ({
    pendingInteractionOf: (id: string) => (over.waiting === true && id === 's-1' ? 'question' as const : undefined),
    activeOf: (id: string) => over.active === true && id === 's-1',
  })

  it('an unreviewed finish reads unread — the dot answering "which session just finished"', () => {
    // Opened the review page only AFTER the settle: viewedAt moves past the
    // round's activity, so the dot goes quiet — the existing read funnel IS
    // the off switch, no new clock.
    expect(cardSessionDotStateOf(finished(), 's-1', faces())).toBe('unread')
    expect(cardSessionDotStateOf(finished(NOW + 10), 's-1', faces())).toBe('idle')
  })

  it('live states outrank unread (waiting > running > unread > idle)', () => {
    expect(cardSessionDotStateOf(finished(), 's-1', faces({ waiting: true, active: true }))).toBe('waiting')
    expect(cardSessionDotStateOf(finished(), 's-1', faces({ active: true }))).toBe('running')
    expect(cardSessionDotStateOf(finished(), 's-1', faces())).toBe('unread')
    expect(cardSessionDotStateOf(finished(NOW + 10), 's-1', faces())).toBe('idle')
  })

  it('a session with no plain run honestly reads idle (no review state to show)', () => {
    // Bound external conversations never carry a run —
    // they must not borrow another surface's clock to fake an unread glow.
    expect(cardSessionDotStateOf(task(), 's-external', faces())).toBe('idle')
  })

  it('other sessions of the same card are unaffected by s-1 state', () => {
    expect(cardSessionDotStateOf(finished(), 's-2', faces())).toBe('idle')
  })
})

describe('cardLightOf (ONE light at a time, precedence stated not inherited)', () => {
  it('a working card wears the halo, an unread settled one the ring, else none', () => {
    expect(cardLightOf(false, false)).toBe('none')
    expect(cardLightOf(false, true)).toBe('ring')
    expect(cardLightOf(true, false)).toBe('halo')
    // Working AND unread: the halo wins — work in flight is newer than the
    // content it produced, and it is not a request. Stated here once, because
    // both lights set the same `animation` property.
    expect(cardLightOf(true, true)).toBe('halo')
  })

  it('the card renders exactly that one light through ONE attribute', () => {
    // The render must not carry two independent light attributes: with both
    // present the two CSS rules set the same property and the visible light
    // would depend on stylesheet order.
    const card = readFileSync(fileURLToPath(new URL('../src/client/board/TaskCard.tsx', import.meta.url)), 'utf8')
    expect(card).toContain('data-light={light}')
    expect(card).not.toContain('data-unviewed=')
    expect(card).not.toContain('data-active=')
  })
})
