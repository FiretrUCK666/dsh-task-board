/**
 * Browser transport for the board sync client: the four board-route calls
 * over fetch, and the SSE change stream over EventSource. Every failure
 * degrades to `undefined` (the sync client treats it as "host unreachable"
 * and keeps the last known truth), so a dropped packet or a proxy hiccup can
 * never take the board down — the poll + EventSource auto-reconnect recover.
 */
import type { BoardSyncTransport, SyncFetchResult } from '../core/host-sync.ts'
import type { BoardCommit, BoardCommand, BoardEvent, LeaseWire } from '../core/board-doc.ts'

/** The board route base path (the naming matrix's `/api/dsh-task-board/*`). */
const ROUTE = '/api/dsh-task-board/board'

/** The route envelope the board handler answers with. The lease is the WIRE
 *  shape (an older host may answer without `proto`/`bootedAt` — that absence
 *  IS the stale-host evidence, so it must survive to the sync client). */
interface BoardEnvelope {
  ok: boolean
  value?: SyncFetchResult & { lease?: LeaseWire }
}

/**
 * Build the transport. `EventSource` is feature-detected: an environment
 * without it (an exotic WebView) still converges through the poll loop, just
 * with higher latency.
 *
 * Every request is time-bounded (`timeoutMs`, default 15s): a hanging socket
 * (dead tunnel, half-open proxy) must resolve to `undefined` like any other
 * failure — an unsettled boot fetch holds `sync.start()` forever, and the
 * sidebar entry never binds, which is exactly the mobile "点了没反应、进不去".
 * A timeout is a failure like any other: the sync client falls back and the
 * poll/EventSource loop recovers when the line is back.
 */
export function createBoardTransport(options?: { timeoutMs?: number }): BoardSyncTransport {
  const timeoutMs = options?.timeoutMs ?? 15_000
  // One choke point for every request below: race the fetch against a timer.
  // The timer unrefs nothing (browser) and is always cleared — a resolved
  // fetch never leaks a pending timeout, and an abort surfaces as a catch,
  // which every caller already maps to `undefined`.
  const bounded = async <T>(run: (signal: AbortSignal) => Promise<T | undefined>): Promise<T | undefined> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => { ctrl.abort() }, timeoutMs)
    try {
      return await run(ctrl.signal)
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    async fetch(clientId, since) {
      return bounded(async signal => {
        try {
          const params = new URLSearchParams({ clientId })
          if (since !== undefined) params.set('since', String(since))
          const response = await fetch(`${ROUTE}?${params.toString()}`, { headers: { accept: 'application/json' }, signal })
          if (!response.ok) return undefined
          const envelope = await response.json() as BoardEnvelope
          return envelope.ok ? envelope.value : undefined
        } catch {
          return undefined
        }
      })
    },
    async commit(commit: BoardCommit) {
      return bounded(async signal => {
        try {
          const response = await fetch(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(commit),
            signal,
          })
          const envelope = await response.json() as BoardEnvelope
          return envelope.ok ? envelope.value : undefined
        } catch {
          return undefined
        }
      })
    },
    async lease(clientId, options) {
      return bounded(async signal => {
        try {
          const response = await fetch(`${ROUTE}/lease`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(options.release
              ? { clientId, release: true }
              : {
                  clientId,
                  ...options.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {},
                  ...options.active === false ? { active: false } : {},
                }),
            signal,
          })
          const envelope = await response.json() as BoardEnvelope
          return envelope.ok ? envelope.value?.lease : undefined
        } catch {
          return undefined
        }
      })
    },
    async command(clientId, command: BoardCommand) {
      await bounded(async signal => {
        try {
          await fetch(`${ROUTE}/command`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ clientId, command }),
            signal,
          })
        } catch {
          // The relay is best-effort: a lost command is retried by the next
          // user action, and the engine's own reconcile covers automation.
        }
        return undefined
      })
    },
    openStream(clientId, handlers) {
      const Source = (globalThis as { EventSource?: new (url: string) => {
        onopen: (() => void) | null
        onmessage: ((event: { data: string }) => void) | null
        close(): void
      } }).EventSource
      if (Source === undefined) return () => undefined
      const source = new Source(`${ROUTE}/events?clientId=${encodeURIComponent(clientId)}`)
      source.onopen = () => handlers.onOpen()
      source.onmessage = event => {
        try {
          handlers.onEvent(JSON.parse(event.data) as BoardEvent)
        } catch {
          // A malformed frame is dropped; the next frame or poll recovers.
        }
      }
      // 'error' needs no handler: EventSource reconnects on its own and fires
      // onopen again, which resyncs. close() is the only teardown.
      return () => source.close()
    },
  }
}
