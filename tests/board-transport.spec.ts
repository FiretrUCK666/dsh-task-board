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
import { CHECKLIST_MIRROR_KEY, createChecklistMirror } from '../src/client/platform.ts'

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

// The second document's two calls. A separate capture helper on purpose: the
// board's own four URLs are pinned above and must stay exactly as they were —
// adding the checklist to THAT list would silently rewrite an existing contract
// instead of adding a new one.
async function captureChecklistUrls(): Promise<{ urls: string[]; methods: string[] }> {
  const urls: string[] = []
  const methods: string[] = []
  vi.stubGlobal('fetch', async (url: unknown, init?: { method?: string }) => {
    urls.push(String(url))
    methods.push(init?.method ?? 'GET')
    return new Response(JSON.stringify({ ok: true, value: { available: true, revision: 3, doc: { revision: 3 } } }), {
      headers: { 'content-type': 'application/json' },
    })
  })
  const transport = createBoardTransport({ timeoutMs: 1_000 })
  await transport.itemsFetch?.('c1', undefined)
  await transport.itemsFetch?.('c1', 2)
  await transport.itemsCommit?.({} as never)
  return { urls, methods }
}

describe('the checklist transport', () => {
  it('addresses the second document on the SAME route, at its own tail', async () => {
    const { urls, methods } = await captureChecklistUrls()
    expect(urls.map(url => new URL(url, ORIGIN_ROOT).href)).toEqual([
      `${ORIGIN_ROOT}api/dsh-task-board/board/items?clientId=c1`,
      `${ORIGIN_ROOT}api/dsh-task-board/board/items?clientId=c1&since=2`,
      `${ORIGIN_ROOT}api/dsh-task-board/board/items`,
    ])
    expect(methods).toEqual(['GET', 'GET', 'POST'])
    for (const url of urls) expect(url.startsWith('/')).toBe(false)
  })

  it('a hanging checklist call resolves undefined like every other failure', async () => {
    hangingFetch()
    const transport = createBoardTransport({ timeoutMs: 30 })
    expect(await transport.itemsFetch?.('c1', undefined)).toBeUndefined()
    expect(await transport.itemsCommit?.({} as never)).toBeUndefined()
  })

  it('a non-2xx checklist answer is not an ack (same as the board)', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 502 }))
    const transport = createBoardTransport({ timeoutMs: 1_000 })
    expect(await transport.itemsCommit?.({} as never)).toBeUndefined()
  })
})

describe('the checklist offline mirror', () => {
  /** A localStorage stand-in that records the key it was asked for. */
  function fakeStorage(initial: Record<string, string> = {}): Storage & { keys: string[] } {
    const map = new Map(Object.entries(initial))
    const keys: string[] = []
    return {
      keys,
      get length() { return map.size },
      clear: () => map.clear(),
      getItem: (key: string) => { keys.push(key); return map.get(key) ?? null },
      key: (index: number) => [...map.keys()][index] ?? null,
      removeItem: (key: string) => { map.delete(key) },
      setItem: (key: string, value: string) => { keys.push(key); map.set(key, value) },
    }
  }

  it('uses the checklist\'s OWN key — a shared key would let one document overwrite the other', () => {
    const storage = fakeStorage()
    const mirror = createChecklistMirror(storage)
    mirror.save([])
    // And it round-trips through that same key, so the mirror really is the
    // evidence the replica reads back.
    expect(storage.keys).toEqual([CHECKLIST_MIRROR_KEY])
    expect(mirror.load()).toEqual([])
    // The frozen task-ledger key is a different name and stays untouched.
    expect(CHECKLIST_MIRROR_KEY).not.toBe('dsh.taskBoard.v1')
  })

  it('a corrupted mirror starts empty and says why, never throws', () => {
    const storage = fakeStorage({ [CHECKLIST_MIRROR_KEY]: 'not json' })
    const mirror = createChecklistMirror(storage)
    expect(mirror.load()).toEqual([])
  })

  it('an empty list round-trips as empty, not as corruption', () => {
    const storage = fakeStorage({ [CHECKLIST_MIRROR_KEY]: '[]' })
    expect(createChecklistMirror(storage).load()).toEqual([])
  })

  it('a store that throws degrades to a no-op mirror (a full disk never breaks the panel)', () => {
    const hostile = {
      get length(): number { throw new Error('denied') },
      clear: () => { throw new Error('denied') },
      getItem: () => { throw new Error('denied') },
      key: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    } as unknown as Storage
    const mirror = createChecklistMirror(hostile)
    expect(mirror.load()).toEqual([])
    expect(() => mirror.save([])).not.toThrow()
    expect(() => mirror.clear()).not.toThrow()
  })
})
