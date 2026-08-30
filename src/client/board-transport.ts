/**
 * Browser transport for the board sync client: the four board-route calls
 * over fetch, and the SSE change stream over EventSource. Every failure
 * degrades to `undefined` (the sync client treats it as "host unreachable"
 * and keeps the last known truth), so a dropped packet or a proxy hiccup can
 * never take the board down — the poll + EventSource auto-reconnect recover.
 */
import type { BoardSyncTransport, SyncFetchResult } from '../core/host-sync.ts'
import type { BoardCommit, BoardCommand, BoardEvent, LeaseState } from '../core/board-doc.ts'

/** The board route base path (the naming matrix's `/api/dsh-task-board/*`). */
const ROUTE = '/api/dsh-task-board/board'

/** The route envelope the board handler answers with. */
interface BoardEnvelope {
  ok: boolean
  value?: SyncFetchResult & { lease?: LeaseState }
}

/**
 * Build the transport. `EventSource` is feature-detected: an environment
 * without it (an exotic WebView) still converges through the poll loop, just
 * with higher latency.
 */
export function createBoardTransport(): BoardSyncTransport {
  return {
    async fetch(clientId, since) {
      try {
        const params = new URLSearchParams({ clientId })
        if (since !== undefined) params.set('since', String(since))
        const response = await fetch(`${ROUTE}?${params.toString()}`, { headers: { accept: 'application/json' } })
        if (!response.ok) return undefined
        const envelope = await response.json() as BoardEnvelope
        return envelope.ok ? envelope.value : undefined
      } catch {
        return undefined
      }
    },
    async commit(commit: BoardCommit) {
      try {
        const response = await fetch(ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(commit),
        })
        const envelope = await response.json() as BoardEnvelope
        return envelope.ok ? envelope.value : undefined
      } catch {
        return undefined
      }
    },
    async lease(clientId, options) {
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
        })
        const envelope = await response.json() as BoardEnvelope
        return envelope.ok ? envelope.value?.lease : undefined
      } catch {
        return undefined
      }
    },
    async command(clientId, command: BoardCommand) {
      try {
        await fetch(`${ROUTE}/command`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientId, command }),
        })
      } catch {
        // The relay is best-effort: a lost command is retried by the next
        // user action, and the engine's own reconcile covers automation.
      }
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
