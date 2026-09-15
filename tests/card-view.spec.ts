/**
 * Card view-model (client/board/card-view.ts): single prioritized summary —
 * waiting > running > refining > queued > failed > review > idle.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cardLightOf, cardNextActionOf, cardViewModelOf, titleOrUntitled } from '../src/client/board/card-view.ts'
import { createTask, newCommentRound, startExecution } from '../src/core/tasks.ts'

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
    // Settled rounds — nothing in flight — stay quiet.
    const settled = { ...card, executions: [{ ...open, endedAt: NOW + 1, result: 'succeeded' as const }] }
    expect(cardViewModelOf(settled, {}).active).toBe(false)
  })

  it('the light table: waiting/running/refining pulse, queued/failed/review/idle do not', () => {
    // The board's 光效规则表 as a table: only these three primaries breathe.
    // `queued` is deliberately quiet — a card with saved-but-not-injected
    // comments is waiting on the engine, not working.
    const started = startExecution(task(), NOW, 'e1')
    expect(cardViewModelOf(started.task, { waiting: 'approval' }).active).toBe(true)
    expect(cardViewModelOf(started.task, {}).active).toBe(true)
    const refine = { ...task(), refineSessionId: 's-refine', executions: [{ id: 'r1', sessionId: 's-refine', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined, refine: true }] }
    expect(cardViewModelOf(refine, {}).primary).toEqual({ kind: 'refining' })
    expect(cardViewModelOf(refine, {}).active).toBe(true)
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

  it('dots cap at 3 with overflow counted', () => {
    const view = cardViewModelOf(task(), {
      sessionIds: ['a', 'b', 'c', 'd'],
      sessionStateOf: () => 'idle',
    })
    expect(view.dots).toHaveLength(3)
    expect(view.overflowDots).toBe(1)
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
