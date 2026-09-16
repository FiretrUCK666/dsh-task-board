/**
 * Archive round-trip contract (registry-global archive set → every surface).
 *
 * Why this spec exists: DSH 0.1.6 shipped the archived-session Settings page, so
 * ARCHIVING STOPPED MEANING "GONE". The set is a registry-global id list that
 * never touches workspace accounting, and unarchiving is just removing an id —
 * so every surface that reads it must be a live derivation, and nothing may be
 * memoized or written into the ledger. This walks the whole trip: visible →
 * archived → restored, asserting the card's session rows, the picker and the
 * linked rows all leave and all come back, while a rule's due slot survives.
 */
import { describe, expect, it } from 'vitest'
import { BoardController } from '../src/core/controller.ts'
import type { ExecutionService } from '../src/core/execution.ts'
import { InMemoryTaskStore } from '../src/core/store.ts'
import { createTask } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000
let nextId = 0
const uuid = (): string => { nextId += 1; return `id-${nextId}` }
const flush = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

class FakeSessions {
  runningById: Record<string, boolean> = {}
  titleById: Record<string, string> = {}
  private listeners = new Set<() => void>()
  list = {
    getSnapshot: () => ({
      current: undefined,
      phase: 'ready' as const,
      ids: Object.keys(this.runningById),
      byId: Object.fromEntries(Object.entries(this.runningById).map(([id, running]) => [id, {
        running,
        ...this.titleById[id] !== undefined ? { title: this.titleById[id] } : {},
      }])),
    }),
    subscribe: (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } },
  }
  notify(): void { for (const fn of [...this.listeners]) fn() }
}

class FakeWorkspaces {
  items: Array<{ id: string; title: string; sessionIds: string[] }> = []
  archivedSessionIds: string[] = []
  private listeners = new Set<() => void>()
  list = {
    getSnapshot: () => ({ items: this.items, archivedSessionIds: this.archivedSessionIds }),
    subscribe: (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } },
  }
  notify(): void { for (const fn of [...this.listeners]) fn() }
}

describe('AUDIT archive round trip across every surface', () => {
  it('reports each surface before, during and after archiving', async () => {
    const sessions = new FakeSessions()
    sessions.runningById['s-1'] = false
    sessions.runningById['s-2'] = false
    sessions.titleById['s-1'] = '会话一'
    sessions.titleById['s-2'] = '会话二'
    const workspaces = new FakeWorkspaces()
    workspaces.items = [{ id: 'w-1', title: '项目', sessionIds: ['s-1', 's-2'] }]
    const store = new InMemoryTaskStore()
    const seeded = createTask({ title: 'x', description: '', prompt: 'run' }, NOW, 'task-a')
    store.save([{
      ...seeded,
      binds: [{ kind: 'session', sessionId: 's-2' }],
      executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: NOW + 1, result: 'succeeded', error: undefined }],
      rules: [{ id: 'r1', sessionId: 's-1', instruction: '继续', trigger: 'cron', cron: '*/5 * * * *', send: 'queue', enabled: true, nextAt: NOW, lastAt: undefined }],
    }])
    const controller = new BoardController({
      store, exec: { reconcile: () => undefined } as unknown as ExecutionService,
      sessions: sessions as never, workspaces: workspaces as never,
      now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()

    const snap = (label: string) => {
      const task = controller.getSnapshot().tasks[0]
      const rows = controller.sessionsOf(task).map(r => r.sessionId)
      const labels = controller.sessionLabelsOf(task.id).map(l => l.sessionId)
      const linked = controller.linkedOf(task).map(r => r.sessionId)
      console.log(`${label.padEnd(14)} rows=${JSON.stringify(rows)} picker=${JSON.stringify(labels)} linked=${JSON.stringify(linked)}`)
      return { rows, labels, linked }
    }

    const before = snap('visible')
    expect(before.rows).toEqual(['s-1', 's-2'])

    // --- archive s-1 (a round session) and s-2 (an explicit bind) ---
    workspaces.archivedSessionIds = ['s-1', 's-2']
    workspaces.notify()
    await flush()
    const during = snap('archived')
    expect(during.rows, 'archived sessions leave the card rows').toEqual([])
    expect(during.labels, 'and leave the picker').toEqual([])

    // --- unarchive both ---
    workspaces.archivedSessionIds = []
    workspaces.notify()
    await flush()
    const after = snap('restored')
    expect(after.rows, 'restored sessions come back to the rows').toEqual(['s-1', 's-2'])
    // The picker keeps ITS order (related-set: bind first, then rounds) — the
    // point is that both members are back, not that they re-sort.
    expect([...after.labels].sort(), 'and back to the picker').toEqual(['s-1', 's-2'])

    // --- the rule keeps its due slot through the whole trip ---
    const rule = store.load()[0].rules?.[0]
    expect(rule?.nextAt, 'the due slot survives archive and restore').toBe(NOW)
  })
})
