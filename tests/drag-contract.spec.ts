/**
 * Drag-geometry contract: the insertion-gap algorithm — the pointer's Y
 * against each card's gap centers decides the landing gap, symmetric in
 * both directions and correct for any column size — the scrolled indicator
 * math (content coordinates, so the bar sits where the gap is even
 * mid-scroll), the edge-scroll stepper (the drag auto-scroll grammar), and
 * the drop DISPATCH: a real drop gesture, mounted, resolving to the very
 * `moveTask(id, status, beforeId)` the previewed gap promised.
 *
 * The dispatch half is the one contract these pure functions cannot express,
 * and its absence is what let a cross-column drop lose its position: the two
 * halves above stayed green while the wiring re-read the (already cleared)
 * transient gap. It runs under jsdom, so the file declares that environment.
 */
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { indicatorTopOf, insertionGapOf } from '../src/client/board/drop-position.ts'
import { edgeScrollStep } from '../src/client/board/drag-autoscroll.ts'
import { TaskBoard } from '../src/client/board/TaskBoard.tsx'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import { sessionDisplay } from '../src/core/session-display.ts'
import type { BoardController } from '../src/core/controller.ts'
import type { TaskRecord, TaskStatus } from '../src/core/tasks.ts'

/** Cards at fixed vertical positions (top, 40px tall, 8px gaps). */
function cards(ids: string[], startY = 0): Array<{ id: string; rect: { top: number; height: number } }> {
  return ids.map((id, index) => ({
    id,
    rect: { top: startY + index * 48, height: 40 },
  }))
}

const GAP = 8

describe('insertionGapOf', () => {
  it('lands in the gap above a card when the pointer is in its upper half', () => {
    const list = cards(['a', 'b', 'c'])
    // Dragging 'a' down onto 'b' upper half → insert before b, indicator at
    // the gap center above b (b.top - 4).
    expect(insertionGapOf(list, 48 + 5, 'a', GAP)).toEqual({ beforeId: 'b', top: 48 - 4 })
  })

  it('lands in the gap below a card when the pointer is in its lower half', () => {
    const list = cards(['a', 'b', 'c'])
    // Dragging 'a' onto 'b' lower half → the gap below b = the gap above c.
    expect(insertionGapOf(list, 48 + 35, 'a', GAP)).toEqual({ beforeId: 'c', top: 96 - 4 })
  })

  it('appends at the column tail below the last card — the two-card downward swap', () => {
    const list = cards(['a', 'b'])
    // 'a' dragged onto the lower half of the last card → column tail, with
    // the indicator at the tail gap center (b.bottom + 4).
    expect(insertionGapOf(list, 48 + 30, 'a', GAP)).toEqual({ beforeId: undefined, top: 88 + 4 })
  })

  it('excludes the dragged card itself from the gap scan', () => {
    const list = cards(['a', 'b', 'c'])
    // Pointers over the dragged card's own rect still resolve against the
    // other cards' gaps.
    expect(insertionGapOf(list, 0 + 20, 'a', GAP)).toEqual({ beforeId: 'b', top: 48 - 4 })
    expect(insertionGapOf(list, 48 + 20, 'b', GAP)).toEqual({ beforeId: 'c', top: 96 - 4 })
  })

  it('handles an empty column and a lone dragged card', () => {
    expect(insertionGapOf([], 100, 'ghost', GAP)).toEqual({ beforeId: undefined, top: 0 })
    expect(insertionGapOf(cards(['a']), 100, 'a', GAP)).toEqual({ beforeId: undefined, top: 0 })
  })
})

describe('indicatorTopOf (scrolled content coordinates)', () => {
  it('adds the container scroll offset — the bar never drifts mid-scroll', () => {
    // Container's viewport top 200, scrolled 120 down; a gap at viewport 260
    // sits at content 260 - 200 + 120 = 180.
    expect(indicatorTopOf(260, 200, 120, 1000)).toBe(180)
    expect(indicatorTopOf(260, 200, 0, 1000)).toBe(60)
  })

  it('clamps to the content box (never above the top or below the bottom)', () => {
    expect(indicatorTopOf(5, 200, 0, 1000)).toBe(0)
    expect(indicatorTopOf(5000, 200, 0, 1000)).toBe(1000)
  })

  it('keeps the tail bar inside a container whose scroll height ends at the last row bottom (session-list grammar)', () => {
    // The session list's tail slot: last row bottom (content) + gap/2, with
    // the container's scroll height = last row bottom + the bottom strip
    // (without the strip the bar clamps to the very edge and is clipped by
    // overflow: hidden — the reported "no bar after the last row" bug). The
    // strip is 14px in the real list; the math contract holds for any strip
    // >= the bar height. Use the 22px board grammar for the example.
    const lastRowBottom = 88
    const strip = 22
    const contentHeight = lastRowBottom + strip
    const tail = indicatorTopOf(200 + lastRowBottom + 4, 200, 0, contentHeight)
    expect(tail).toBe(lastRowBottom + 4)
    expect(tail + 4).toBeLessThanOrEqual(contentHeight)
  })
})

describe('drop decision legibility (wiring)', () => {
  it('the column dragover names its outcome through the platform cursor', () => {
    // A refusing column must show not-allowed BEFORE release: a designed
    // refusal (busy card, rerun lane) with no advance signal reads as
    // 「拖了也插不进」. Set only on the card path — the external branch keeps
    // the sidebar's own effectAllowed (an incompatible value would block it).
    // Read from the real filesystem by path (this file runs under jsdom, where
    // `import.meta.url` is an http URL and not a file URL).
    const board = readFileSync(join(process.cwd(), 'src', 'client', 'board', 'TaskBoard.tsx'), 'utf8')
    expect(board).toContain("event.dataTransfer.dropEffect = insertable ? 'move' : 'none'")
  })
})
describe('drop dispatch (the gap the preview promises is the gap the drop takes)', () => {
  /** Card box used by the fake layout below (cards, and the 8px grid gap). */
  const CARD_H = 40
  const COLUMN_TOP = 100

  /**
   * jsdom has no layout, so the ONE thing the drop math reads — a card's rect —
   * is faked here: card index inside its column decides its top. Everything
   * else (the mounted tree, the events, the decisions) is the real component.
   */
  const installLayout = (): void => {
    window.Element.prototype.getBoundingClientRect = function rect(this: Element) {
      const el = this as HTMLElement
      const taskId = el.getAttribute?.('data-task-id')
      if (taskId !== null && taskId !== undefined) {
        const column = el.closest('section[data-status]')
        const inColumn = column === null ? [] : Array.from(column.querySelectorAll('[data-task-id]'))
        const top = COLUMN_TOP + inColumn.indexOf(el) * (CARD_H + 8)
        return {
          x: 0, y: top, top, bottom: top + CARD_H, left: 0, right: 200, width: 200, height: CARD_H,
          toJSON() { return this },
        } as DOMRect
      }
      return {
        x: 0, y: 0, top: 0, bottom: 600, left: 0, right: 400, width: 400, height: 600,
        toJSON() { return this },
      } as DOMRect
    }
  }

  /** A ledger row as the board renders it (the fields the card summary reads). */
  const card = (id: string, status: TaskStatus, order: number): TaskRecord => ({
    id, title: id, description: '', prompt: 'p', status, order,
    createdAt: 0, updatedAt: 0, executions: [], statusHistory: [], viewedAt: 0,
  })

  /** A controller that records moves; everything else the board reads is inert. */
  const boardStub = (tasks: ReturnType<typeof card>[]) => {
    const moves: Array<{ id: string; status: string; beforeId?: string }> = []
    const snapshot = () => ({
      tasks,
      boardOpen: true,
      selectedTaskId: undefined,
      cruise: { enabled: false, limit: 3, schedule: [] },
      stats: { running: 0, queued: 0 },
      skips: { overlap: 0, missed: 0 },
      heartbeat: { lastOkAt: 0 },
      engine: { held: true, synced: false, hostProto: 2, bootedAt: undefined },
    })
    const controller = new Proxy({} as Record<string, unknown>, {
      get(_target, key) {
        if (key === 'getSnapshot') return snapshot
        if (key === 'moveTask') return (id: string, status: string, beforeId?: string) => {
          moves.push({ id, status, ...(beforeId !== undefined ? { beforeId } : {}) })
        }
        if (key === 'subscribe' || key === 'subscribeQuestions') return () => () => {}
        if (key === 'linkedOf') return () => []
        if (key === 'relatedSessionIdSet') return () => new Set<string>()
        if (key === 'liveStateOf') return () => 'idle'
        if (key === 'sessionActiveOf') return () => false
        if (key === 'pendingInteractionOf' || key === 'questionPendingOf') return () => undefined
        if (key === 'sessionTitle') return () => undefined
        if (key === 'boundSourceTitleOf') return () => ''
        if (key === 'runCatalog') return () => undefined
        if (key === 'externalKindOf') return () => undefined
        if (key === 'canRecheckSeat') return () => false
        if (key === 'ts') return () => 0
        return () => undefined
      },
    })
    return { controller, moves }
  }

  /** One real drag event of the given type at (100, clientY). */
  const dragEvent = (type: string, target: Element, clientY: number): void => {
    const init = { bubbles: true, cancelable: true }
    const event = typeof window.DragEvent === 'function'
      ? new window.DragEvent(type, init)
      : new window.Event(type, init)
    Object.defineProperty(event, 'clientX', { value: 100, configurable: true })
    Object.defineProperty(event, 'clientY', { value: clientY, configurable: true })
    Object.defineProperty(event, 'dataTransfer', {
      configurable: true,
      value: {
        types: ['text/plain'],
        effectAllowed: 'move',
        dropEffect: 'none',
        setData() {}, getData: () => '', setDragImage() {}, files: [],
      },
    })
    target.dispatchEvent(event)
  }

  /**
   * The two browser APIs the mounted board touches that jsdom does not
   * implement: the column-identity observer and the reduced-motion query. Both
   * are inert here — the contract under test is the drop path, not the layout.
   */
  const installBrowserFakes = (): void => {
    const g = globalThis as unknown as Record<string, unknown>
    g.ResizeObserver = g.ResizeObserver ?? class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    if (typeof window.matchMedia !== 'function') {
      const w = window as unknown as Record<string, unknown>
      w.matchMedia = (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return false },
      })
    }
  }

  /** Mount the board with `tasks`, drag `dragId` onto a card, and report the moves. */
  const dragOnto = async (
    tasks: ReturnType<typeof card>[],
    dragId: string,
    targetId: string,
    pointerInUpperHalf: boolean,
  ): Promise<{ moves: Array<{ id: string; status: string; beforeId?: string }>; targetStatus: string }> => {
    installBrowserFakes()
    installLayout()
    const { controller, moves } = boardStub(tasks)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    // One cast at the boundary: the stub answers every member the board asks
    // for (see boardStub) and records the one call this contract is about.
    await act(async () => {
      root.render(createElement(TaskBoard, { controller: controller as unknown as BoardController }))
    })

    const source = host.querySelector(`[data-task-id="${dragId}"]`)
    const target = host.querySelector(`[data-task-id="${targetId}"]`)
    const targetStatus = target?.getAttribute('data-status') ?? ''
    expect(source).not.toBeNull()
    expect(target).not.toBeNull()
    const targetTop = target!.getBoundingClientRect().top
    const y = targetTop + (pointerInUpperHalf ? 10 : CARD_H - 10)

    await act(async () => { dragEvent('dragstart', source!, y) })
    await act(async () => {
      dragEvent('dragenter', target!, y)
      dragEvent('dragover', target!, y)
    })
    await act(async () => { dragEvent('drop', target!, y) })
    return { moves, targetStatus }
  }

  it('a CROSS-column drop inserts at the previewed gap, not the column tail', async () => {
    // The reported defect: x (待办) dropped on h's upper half in 待规划 — the
    // indicator promises the gap above h, so the move must name h. The drop
    // path used to re-read the transient gap ref AFTER clearing it, so the
    // position was always lost and the card fell to the tail.
    const { moves, targetStatus } = await dragOnto(
      [card('x', 'todo', 0), card('g', 'backlog', 0), card('h', 'backlog', 1)],
      'x',
      'h',
      true,
    )
    expect(targetStatus).toBe('backlog')
    expect(moves).toEqual([{ id: 'x', status: 'backlog', beforeId: 'h' }])
  })

  it('a cross-column drop in the lower half inserts BELOW that card', async () => {
    // Same gesture geometry, other half: the gap below g is the gap above h.
    const { moves } = await dragOnto(
      [card('x', 'todo', 0), card('g', 'backlog', 0), card('h', 'backlog', 1)],
      'x',
      'g',
      false,
    )
    expect(moves).toEqual([{ id: 'x', status: 'backlog', beforeId: 'h' }])
  })

  it('a cross-column drop on the last card lower half lands at the tail (no beforeId)', async () => {
    // The mirror case must stay honest too: the tail is a real gap, so the
    // move carries no anchor — and it is the ONLY path that legitimately does.
    const { moves } = await dragOnto(
      [card('x', 'todo', 0), card('g', 'backlog', 0), card('h', 'backlog', 1)],
      'x',
      'h',
      false,
    )
    expect(moves).toEqual([{ id: 'x', status: 'backlog' }])
  })

  it('a SAME-column reorder keeps its previewed gap', async () => {
    const { moves } = await dragOnto(
      [card('a', 'todo', 0), card('b', 'todo', 1), card('c', 'todo', 2)],
      'c',
      'b',
      true,
    )
    expect(moves).toEqual([{ id: 'c', status: 'todo', beforeId: 'b' }])
  })
})

/**
 * The 会话 list of the open task's detail is the board's card reorder grammar on
 * a second surface (its own `sessionGapRef`, its own clear), so the same
 * drop-dispatch contract applies to it — and this is the surface a regression
 * would reach second.
 */
describe('session-list drop dispatch (TaskDetail)', () => {
  const installLayout = (): void => {
    window.Element.prototype.getBoundingClientRect = function rect(this: Element) {
      const el = this as HTMLElement
      const sessionId = el.getAttribute?.('data-session-id')
      if (sessionId !== null && sessionId !== undefined) {
        const rows = el.parentElement === null
          ? []
          : Array.from(el.parentElement.querySelectorAll('[data-session-id]'))
        const top = 100 + rows.indexOf(el) * 48
        return {
          x: 0, y: top, top, bottom: top + 40, left: 0, right: 300, width: 300, height: 40,
          toJSON() { return this },
        } as DOMRect
      }
      return {
        x: 0, y: 0, top: 0, bottom: 600, left: 0, right: 400, width: 400, height: 600,
        toJSON() { return this },
      } as DOMRect
    }
  }

  /** The one browser API the mounted detail touches that jsdom lacks. */
  const installBrowserFakes = (): void => {
    const g = globalThis as unknown as Record<string, unknown>
    g.ResizeObserver = g.ResizeObserver ?? class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  }

  const stubTask = (): TaskRecord => {
    // Two settled plain runs, one per 会话 row: the row derivation the detail
    // renders reads the real execution list (sessionDisplay over its rounds).
    const executions = ['s-1', 's-2'].map((sessionId, index) => ({
      id: `e-${index + 1}`, sessionId, startedAt: 1, endedAt: 2, result: 'succeeded' as const, error: undefined,
    }))
    return {
      id: 't-1', title: 't', description: '', prompt: 'p', status: 'todo', order: 0,
      createdAt: 0, updatedAt: 0, viewedAt: 0, executions, statusHistory: [],
    }
  }

  /** The 会话 rows the detail renders (the app's own display derivation). */
  const sessionRows = (task: TaskRecord) => task.executions.map(execution => ({
    sessionId: execution.sessionId as string,
    title: execution.sessionId as string,
    executionId: execution.id,
    display: sessionDisplay(task, execution, undefined, false),
    updatedAt: execution.startedAt,
    unviewed: false,
  }))

  /** A controller stub that records 会话 reorders and reports its gaps. */
  const detailStub = (task: TaskRecord) => {
    const reorders: Array<{ taskId: string; sessionId: string; beforeId?: string }> = []
    const asked = new Set<string | symbol>()
    const rows = sessionRows(task)
    const controller = new Proxy({} as Record<string, unknown>, {
      get(_target, key) {
        asked.add(key)
        if (key === 'sessionsOf') return () => rows
        if (key === 'reorderTaskSession') return (taskId: string, sessionId: string, beforeId?: string) => {
          reorders.push({ taskId, sessionId, ...(beforeId !== undefined ? { beforeId } : {}) })
          return true
        }
        if (key === 'getSnapshot') return () => ({
          tasks: [{ ...task }],
          boardOpen: true,
          selectedTaskId: task.id,
          cruise: { enabled: false, limit: 3, schedule: [] },
          stats: { running: 0, queued: 0 },
          skips: { overlap: 0, missed: 0 },
          heartbeat: { lastOkAt: 0 },
          engine: { held: true, synced: false, hostProto: 2, bootedAt: undefined },
        })
        if (key === 'referenceSessionOf') return () => undefined
        if (key === 'sessionTitle') return () => undefined
        if (key === 'sessionActiveOf') return () => false
        if (key === 'pendingInteractionOf') return () => undefined
        if (key === 'sessionLabelsOf') return () => []
        if (key === 'externalKindOf') return () => undefined
        if (key === 'ts') return () => 0
        return () => undefined
      },
    })
    return { controller, reorders, asked }
  }

  const dragEvent = (type: string, target: Element, clientY: number): void => {
    const init = { bubbles: true, cancelable: true }
    const event = typeof window.DragEvent === 'function'
      ? new window.DragEvent(type, init)
      : new window.Event(type, init)
    Object.defineProperty(event, 'clientX', { value: 100, configurable: true })
    Object.defineProperty(event, 'clientY', { value: clientY, configurable: true })
    Object.defineProperty(event, 'dataTransfer', {
      configurable: true,
      value: {
        types: ['text/plain'],
        effectAllowed: 'move',
        dropEffect: 'none',
        setData() {}, getData: () => '', setDragImage() {}, files: [],
      },
    })
    target.dispatchEvent(event)
  }

  it('reorders the 会话 list at the previewed gap, not the end of the list', async () => {
    installBrowserFakes()
    installLayout()
    const task = stubTask()
    const { controller, reorders, asked } = detailStub(task)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(TaskDetail, {
        controller: controller as unknown as BoardController,
        task,
        workspaceTitleOf: () => 'w',
        dragSourceRef: { current: false },
      }))
    })

    const dragged = host.querySelector('[data-session-id="s-1"]')
    const target = host.querySelector('[data-session-id="s-2"]')
    expect(dragged).not.toBeNull()
    expect(target).not.toBeNull()

    // s-2's upper half: the promised gap is above s-2.
    const y = target!.getBoundingClientRect().top + 10
    await act(async () => { dragEvent('dragstart', dragged!, y) })
    await act(async () => { dragEvent('dragover', target!.parentElement!, y) })
    await act(async () => { dragEvent('drop', target!.parentElement!, y) })

    expect(reorders).toEqual([{ taskId: 't-1', sessionId: 's-1', beforeId: 's-2' }])
    // The stub answered every member the detail asked for: a new dependency
    // arriving later lands here as a named miss instead of a silent undefined.
    const unhandled = [...asked].filter(key => ![
      'sessionsOf', 'reorderTaskSession', 'getSnapshot', 'referenceSessionOf',
      'sessionTitle', 'sessionActiveOf', 'pendingInteractionOf', 'sessionLabelsOf',
      'externalKindOf', 'ts',
    ].includes(String(key)))
    expect(unhandled).toEqual([])
  })
})

describe('edgeScrollStep (drag edge auto-scroll)', () => {
  it('returns 0 outside the edge zones and outside the box', () => {
    expect(edgeScrollStep(100, 0, 600, 48, 14)).toBe(0)
    expect(edgeScrollStep(599 - 48 - 1, 0, 599)).toBe(0)
    expect(edgeScrollStep(-10, 0, 600)).toBe(0)
    expect(edgeScrollStep(700, 0, 600)).toBe(0)
  })

  it('scrolls down near the bottom edge, scaling with proximity', () => {
    expect(edgeScrollStep(600, 0, 600, 48, 14)).toBe(14)
    expect(edgeScrollStep(576, 0, 600, 48, 14)).toBe(7)
    expect(edgeScrollStep(553, 0, 600, 48, 14)).toBe(1)
  })

  it('scrolls up near the top edge, negative (up)', () => {
    expect(edgeScrollStep(0, 0, 600, 48, 14)).toBe(-14)
    expect(edgeScrollStep(24, 0, 600, 48, 14)).toBe(-7)
    expect(edgeScrollStep(47, 0, 600, 48, 14)).toBe(-1)
  })
})
