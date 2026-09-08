/**
 * ActivityWake contract: the 0.1.5 native-activity wake channel.
 *
 * Two listeners, one input: the direct `api-session/activity` event (where
 * the host serves remote.$on) plus the list `updatedAt` projection (every
 * host moves it on the same gate). Both feed one callback; the controller
 * owns dedup + engine gating + the tail read. Fakes drive both faces.
 */
import { describe, expect, it } from 'vitest'
import { stampOf, watchSessionActivity, ACTIVITY_EVENT } from '../src/client/board/activity-wake.ts'

function fakeCtx(opts: {
  remote?: { on: (event: string, listener: (...args: unknown[]) => void) => () => void; events: string[] }
  rows?: Record<string, { updatedAt?: unknown }>
} = {}) {
  const events: string[] = opts.remote?.events ?? []
  const remote = opts.remote === undefined ? undefined : {
    $on: (event: string, listener: (...args: unknown[]) => void): (() => void) => {
      events.push(event)
      return opts.remote!.on(event, listener)
    },
  }
  let rows = opts.rows ?? {}
  const listListeners = new Set<() => void>()
  return {
    ctx: {
      get: (name: string) => (name === 'remote' ? remote : undefined),
      sessions: {
        list: {
          getSnapshot: () => ({ byId: rows }),
          subscribe: (fn: () => void): (() => void) => {
            listListeners.add(fn)
            return () => { listListeners.delete(fn) }
          },
        },
      },
    },
    events,
    setRows: (next: Record<string, { updatedAt?: unknown }>) => {
      rows = next
      for (const fn of [...listListeners]) fn()
    },
    remoteListeners: new Map<string, (...args: unknown[]) => void>(),
  }
}

describe('stampOf', () => {
  it('accepts finite numbers, drops everything else', () => {
    expect(stampOf(12)).toBe(12)
    expect(stampOf(undefined)).toBeUndefined()
    expect(stampOf('12')).toBeUndefined()
    expect(stampOf(Number.NaN)).toBeUndefined()
  })
})

describe('watchSessionActivity', () => {
  it('subscribes the official activity event name', () => {
    const fake = fakeCtx({ remote: { events: [], on: () => () => {} } })
    const dispose = watchSessionActivity(fake.ctx as never, () => {})
    expect(fake.events).toContain(ACTIVITY_EVENT)
    dispose()
  })

  it('forwards direct wakes with a numeric stamp only', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const fake = fakeCtx({ remote: { events: [], on: (event, fn) => { listeners.set(event, fn); return () => {} } } })
    const seen: Array<[string, number]> = []
    const dispose = watchSessionActivity(fake.ctx as never, (id, stamp) => { seen.push([id, stamp]) })
    listeners.get(ACTIVITY_EVENT)?.('s-1', 100)
    listeners.get(ACTIVITY_EVENT)?.('s-1', 'junk')
    listeners.get(ACTIVITY_EVENT)?.('', 101)
    expect(seen).toEqual([['s-1', 100]])
    dispose()
  })

  it('primes from the list, then wakes only on stamp advances', () => {
    const fake = fakeCtx({ rows: { 's-1': { updatedAt: 50 } } })
    const seen: Array<[string, number]> = []
    const dispose = watchSessionActivity(fake.ctx as never, (id, stamp) => { seen.push([id, stamp]) })
    // Prime: the first sight is a baseline, never a wake.
    expect(seen).toEqual([])
    // Same stamp: no wake.
    fake.setRows({ 's-1': { updatedAt: 50 } })
    expect(seen).toEqual([])
    // Advance: one wake.
    fake.setRows({ 's-1': { updatedAt: 77 } })
    expect(seen).toEqual([['s-1', 77]])
    // New session with a stamp: baseline for it (prime-on-sight), no wake.
    fake.setRows({ 's-1': { updatedAt: 77 }, 's-2': { updatedAt: 5 } })
    expect(seen).toEqual([['s-1', 77]])
    // …until it advances too.
    fake.setRows({ 's-1': { updatedAt: 77 }, 's-2': { updatedAt: 6 } })
    expect(seen).toEqual([['s-1', 77], ['s-2', 6]])
    dispose()
  })

  it('works without a remote face (list-only hosts)', () => {
    const fake = fakeCtx({ rows: {} })
    const seen: Array<[string, number]> = []
    const dispose = watchSessionActivity(fake.ctx as never, (id, stamp) => { seen.push([id, stamp]) })
    fake.setRows({ 's-1': { updatedAt: 9 } })
    fake.setRows({ 's-1': { updatedAt: 10 } })
    expect(seen).toEqual([['s-1', 10]])
    dispose()
  })
})
