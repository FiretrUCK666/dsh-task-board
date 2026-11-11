/**
 * 被盖住的表面**仍然收得到「位置」**——这条契约是关闭按钮的地基。
 *
 * ── 为什么它必须单独钉一次 ──────────────────────────────────────────────────
 *
 * 上一次修复的判据是「盖着就一个字的活都不干」，而那一版的实现写成了一句
 * `if (held) return`：**所有**通知都不进来。这条契约在纸面上完全成立，代价却落在
 * 另一个地方——盖着我的那一层关掉时，通知也是从这里走的。于是读者按下叉号，
 * 外面那层永远不知道「该收起来了」，面板就留在屏上。
 *
 * 屏上唯一的证据是「按了没反应」，而所有静态判据都是绿的。所以这条契约必须由**真的
 * 挂一次订阅**来证明：位置变了要重画，数据变了不许重画。
 *
 * 它跑在 jsdom 下，读的是 `src/` 里同一份 hook（不抄一份进测试——抄了就是在量一个
 * 已经不存在的东西）。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useBoardSnapshot, type BoardSnapshot } from '../src/client/board/use-board-snapshot.ts'
import type { BoardController } from '../src/core/controller.ts'

/** The smallest controller the seam actually uses: a cached getSnapshot + subscribe. */
function fakeBoard(): {
  controller: BoardController
  seen: () => BoardSnapshot
  /** One notification. Mutate the underlying state first. */
  notify: () => void
  set: (patch: Partial<BoardSnapshot>) => void
} {
  let state: BoardSnapshot = {
    tasks: [],
    boardOpen: true,
    selectedTaskId: undefined,
    cruise: { enabled: true, limit: 3, schedule: [] },
    stats: { running: 0, queued: 0 },
    skips: { overlap: 0, missed: 0 },
    heartbeat: { lastOkAt: undefined },
    engine: { held: false, synced: false, hostProto: 2, bootedAt: undefined },
  }
  let cached: BoardSnapshot | undefined
  const listeners = new Set<() => void>()
  const controller = {
    getSnapshot: () => (cached ??= state),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  } as unknown as BoardController
  return {
    controller,
    seen: () => state,
    notify: () => {
      // Exactly what the real controller does: drop the cache, then wake everyone.
      cached = undefined
      for (const listener of [...listeners]) listener()
    },
    set: (patch) => { state = { ...state, ...patch }; cached = undefined },
  }
}

/** Mount a probe that records every value the hook handed it. */
function probeMount(): {
  values: Array<BoardSnapshot | undefined>
  render: (controller: BoardController, held: boolean) => Promise<void>
  root: ReturnType<typeof createRoot>
  cleanup: () => Promise<void>
} {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const values: Array<BoardSnapshot | undefined> = []
  function Probe({ controller, held }: { controller: BoardController; held: boolean }): ReactElement {
    const snapshot = useBoardSnapshot(controller, held)
    values.push(snapshot)
    return createElement('span')
  }
  return {
    values,
    root,
    render: async (controller, heldNow) => {
      await act(async () => { root.render(createElement(Probe, { controller, held: heldNow })) })
    },
    cleanup: async () => {
      await act(async () => { root.unmount() })
      host.remove()
    },
  }
}

describe('a covered surface still hears the position half', () => {
  it('while held, a notification that only moves DATA draws nothing', async () => {
    const board = fakeBoard()
    const probe = probeMount()
    try {
      await probe.render(board.controller, true)
      const before = probe.values.length
      for (let i = 0; i < 5; i += 1) {
        board.set({ tasks: [] , stats: { running: i, queued: 0 } })
        await act(async () => { board.notify() })
      }
      expect(probe.values.length, 'a covered surface must not re-draw for data it cannot see')
        .toBe(before)
    } finally {
      await probe.cleanup()
    }
  })

  it('while held, a notification that moves the SELECTION does draw', async () => {
    /* This is the close button. `closeTask()` writes `selectedTaskId = undefined`
       and notifies; if the held listener swallowed that, the sheet would never
       learn it should unmount — the reader presses × and nothing happens. */
    const board = fakeBoard()
    const probe = probeMount()
    try {
      await probe.render(board.controller, true)
      const before = probe.values.length
      board.set({ selectedTaskId: 'task-7' })
      await act(async () => { board.notify() })
      expect(probe.values.length, 'the position half must pass through the hold').toBeGreaterThan(before)
      expect(probe.values.at(-1)?.selectedTaskId, 'and it must carry the new position').toBe('task-7')

      const afterOpen = probe.values.length
      board.set({ selectedTaskId: undefined })
      await act(async () => { board.notify() })
      expect(probe.values.length, 'closing must also pass through — this is the × button').toBeGreaterThan(afterOpen)
      expect(probe.values.at(-1)?.selectedTaskId).toBeUndefined()
    } finally {
      await probe.cleanup()
    }
  })

  it('while held, `boardOpen` also passes — it is a position, not data', async () => {
    const board = fakeBoard()
    const probe = probeMount()
    try {
      await probe.render(board.controller, true)
      const before = probe.values.length
      board.set({ boardOpen: false })
      await act(async () => { board.notify() })
      expect(probe.values.length).toBeGreaterThan(before)
    } finally {
      await probe.cleanup()
    }
  })

  it('on reveal the surface re-reads once, so it shows the latest data', async () => {
    const board = fakeBoard()
    const probe = probeMount()
    try {
      await probe.render(board.controller, true)
      const held = board.seen()
      board.set({ stats: { running: 9, queued: 4 } })
      await act(async () => { board.notify() })
      expect(probe.values.at(-1), 'held = the old frame').toBe(held)

      await probe.render(board.controller, false)
      expect(probe.values.at(-1)?.stats, 'the reveal must hand over the CURRENT data').toEqual({ running: 9, queued: 4 })
    } finally {
      await probe.cleanup()
    }
  })

  it('not held: every notification is honoured', async () => {
    const board = fakeBoard()
    const probe = probeMount()
    try {
      await probe.render(board.controller, false)
      const before = probe.values.length
      board.set({ stats: { running: 1, queued: 0 } })
      await act(async () => { board.notify() })
      expect(probe.values.length).toBeGreaterThan(before)
      expect(probe.values.at(-1)?.stats).toEqual({ running: 1, queued: 0 })
    } finally {
      await probe.cleanup()
    }
  })
})
