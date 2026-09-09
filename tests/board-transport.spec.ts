/**
 * Board transport timeout (client/board-transport.ts): a hanging socket must
 * resolve to `undefined` like any other failure — an unsettled boot fetch
 * holds `sync.start()` forever and the sidebar entry never binds (mobile
 * "点了没反应、进不去").
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBoardTransport } from '../src/client/board-transport.ts'

/** A fetch that hangs until aborted (dead tunnel, half-open proxy). */
function hangingFetch(): void {
  vi.stubGlobal('fetch', (_url: unknown, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'))
    })
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('createBoardTransport timeout', () => {
  it('a hanging boot fetch resolves undefined within the timeout (entry always binds)', async () => {
    hangingFetch()
    const transport = createBoardTransport({ timeoutMs: 30 })
    const started = Date.now()
    expect(await transport.fetch('c1', undefined)).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('hanging commit/lease also resolve undefined (no hung socket anywhere)', async () => {
    hangingFetch()
    const transport = createBoardTransport({ timeoutMs: 30 })
    expect(await transport.commit({} as never)).toBeUndefined()
    expect(await transport.lease('c1', {})).toBeUndefined()
    // Fire-and-forget command still settles (never holds its caller).
    await transport.command('c1', {} as never)
  })

  it('a fast host passes through untouched (timeout only bounds the hang)', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, value: { revision: 7 } }), {
      headers: { 'content-type': 'application/json' },
    }))
    const transport = createBoardTransport({ timeoutMs: 1_000 })
    expect(await transport.fetch('c1', undefined)).toEqual({ revision: 7 })
  })
})
