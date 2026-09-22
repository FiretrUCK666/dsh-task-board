/**
 * Board transport timeout (client/board-transport.ts): a hanging socket must
 * resolve to `undefined` like any other failure — an unsettled boot fetch
 * holds `sync.start()` forever and the sidebar entry never binds (mobile
 * "点了没反应、进不去").
 *
 * It also pins the route addressing: every request URL the transport builds is
 * document-relative, so the board follows a reverse-proxy subpath mount
 * instead of leaving it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBoardTransport } from '../src/client/board-transport.ts'

/** Where the GUI is served: at the origin root, and behind a reverse-proxy subpath. */
const ORIGIN_ROOT = 'http://127.0.0.1:3080/'
const SUBPATH_MOUNT = 'https://proxy.example.com/dsh/'

/** A fetch that hangs until aborted (dead tunnel, half-open proxy). */
function hangingFetch(): void {
  vi.stubGlobal('fetch', (_url: unknown, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'))
    })
  }))
}

/**
 * Run every transport call once and capture the URL each one hands the browser
 * (the four fetch calls in order, plus the EventSource stream).
 */
async function captureTransportUrls(): Promise<{ fetches: string[]; stream: string }> {
  const fetches: string[] = []
  let stream = ''
  vi.stubGlobal('fetch', async (url: unknown) => {
    fetches.push(String(url))
    return new Response(JSON.stringify({ ok: true, value: {} }), {
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('EventSource', class {
    onopen: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    constructor(url: string) { stream = url }
    close(): void {}
  })
  const transport = createBoardTransport({ timeoutMs: 1_000 })
  await transport.fetch('c1', undefined)
  await transport.commit({} as never)
  await transport.lease('c1', {})
  await transport.command('c1', {} as never)
  transport.openStream('c1', { onOpen: () => undefined, onEvent: () => undefined })
  return { fetches, stream }
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

describe('the board transport addresses the board route document-relatively', () => {
  it('an origin-root document resolves every call to the URL a root-absolute path would give', async () => {
    const { fetches, stream } = await captureTransportUrls()
    expect(fetches.map(url => new URL(url, ORIGIN_ROOT).href)).toEqual([
      `${ORIGIN_ROOT}api/dsh-task-board/board?clientId=c1`,
      `${ORIGIN_ROOT}api/dsh-task-board/board`,
      `${ORIGIN_ROOT}api/dsh-task-board/board/lease`,
      `${ORIGIN_ROOT}api/dsh-task-board/board/command`,
    ])
    // The stream resolves through the same document base as fetch.
    expect(new URL(stream, ORIGIN_ROOT).href).toBe(`${ORIGIN_ROOT}api/dsh-task-board/board/events?clientId=c1`)
    // And every URL handed to the browser is relative, never an origin-root path.
    for (const url of [...fetches, stream]) expect(url.startsWith('/')).toBe(false)
  })

  it('a subpath mount keeps every request inside the mount', async () => {
    const { fetches, stream } = await captureTransportUrls()
    for (const url of [...fetches, stream]) {
      expect(new URL(url, SUBPATH_MOUNT).href.startsWith(`${SUBPATH_MOUNT}api/dsh-task-board/board`)).toBe(true)
    }
  })
})
