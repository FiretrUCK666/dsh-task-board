/**
 * The live-page report channel: the host keeps what each open page said about
 * itself (its bundle version and the boxes it measured), and hands them back
 * on the update route. Together with the client-side collector these are the
 * two halves of the one instrument that tells a stale page apart from a wrong
 * rule — the distinction every "the board looks wrong on my phone" report has
 * actually been about.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  clearClientReports,
  createClientReportHandler,
  normalizeClientReport,
  readClientReports,
  recordClientReport,
} from '../src/host/client-report-route.ts'
import { boxOf, collectBoardBoxes, type LandmarkClasses } from '../src/client/client-report.ts'

afterEach(() => { clearClientReports() })

/** A stand-in response capturing status + body. */
function fakeResponse(): { res: ServerResponse; status: () => number; body: () => string } {
  let code = 0
  let text = ''
  const res = {
    writeHead: (status: number) => { code = status; return res },
    end: (chunk?: string) => { text = chunk ?? '' },
  } as unknown as ServerResponse
  return { res, status: () => code, body: () => text }
}

/** A stand-in request carrying a JSON body. */
function fakeRequest(method: string, body?: unknown): IncomingMessage {
  const listeners = new Map<string, (arg?: unknown) => void>()
  const req = {
    method,
    on: (event: string, fn: (arg?: unknown) => void) => { listeners.set(event, fn); return req },
    destroy: () => {},
  } as unknown as IncomingMessage
  // Deliver the body on the next tick, exactly like a real socket.
  setTimeout(() => {
    if (body !== undefined) listeners.get('data')?.(Buffer.from(JSON.stringify(body), 'utf8'))
    listeners.get('end')?.()
  }, 0)
  return req
}

describe('normalizeClientReport', () => {
  it('keeps the version and rounds the measured boxes', () => {
    const report = normalizeClientReport({
      version: '0.2.96',
      href: 'http://192.168.31.98:3082/?x=1',
      ua: 'Android Chrome',
      viewport: { width: 373.4, height: 812.6 },
      dpr: 3.214,
      boxes: { strip: { top: 320.44, bottom: 368.46, height: 48.02 }, junk: { top: 'x' } },
    }, 1_700_000_000_000)
    expect(report?.version).toBe('0.2.96')
    expect(report?.viewport).toEqual({ width: 373, height: 813 })
    expect(report?.dpr).toBe(3.21)
    expect(report?.boxes?.strip).toEqual({ top: 320.4, bottom: 368.5, height: 48 })
    expect(report?.boxes?.junk).toBeUndefined()
    expect(report?.receivedAt).toBe(1_700_000_000_000)
  })

  it('refuses a body with no usable version (never a failure surface)', () => {
    expect(normalizeClientReport(null, 1)).toBeUndefined()
    expect(normalizeClientReport({}, 1)).toBeUndefined()
    expect(normalizeClientReport({ version: '' }, 1)).toBeUndefined()
  })
})

describe('the report ring', () => {
  it('keeps the newest first and stays bounded', () => {
    for (let i = 0; i < 12; i++) {
      recordClientReport({ version: `v${i}`, href: '', receivedAt: i })
    }
    const reports = readClientReports()
    expect(reports).toHaveLength(8)
    expect(reports[0]?.version).toBe('v11')
    // A copy: mutating the read result never touches the ring.
    reports[0]!.version = 'mutated'
    expect(readClientReports()[0]?.version).toBe('v11')
  })
})

describe('the report route', () => {
  it('stores a well-formed POST and answers ok', async () => {
    const handler = createClientReportHandler(() => 42)
    const { res, status, body } = fakeResponse()
    await handler(fakeRequest('POST', { version: '0.2.96', boxes: { strip: { top: 1, bottom: 2, height: 1 } } }), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body())).toEqual({ ok: true, value: { stored: true } })
    expect(readClientReports()[0]).toMatchObject({ version: '0.2.96', receivedAt: 42 })
  })

  it('degrades to stored:false on junk instead of erroring', async () => {
    const handler = createClientReportHandler()
    for (const payload of ['not json at all', { nothing: true }]) {
      const { res, status, body } = fakeResponse()
      const req = payload === 'not json at all'
        ? (() => {
          const listeners = new Map<string, (arg?: unknown) => void>()
          const raw = { method: 'POST', on: (e: string, fn: (a?: unknown) => void) => { listeners.set(e, fn); return raw }, destroy: () => {} } as unknown as IncomingMessage
          setTimeout(() => { listeners.get('data')?.(Buffer.from('not json at all', 'utf8')); listeners.get('end')?.() }, 0)
          return raw
        })()
        : fakeRequest('POST', payload)
      await handler(req, res)
      expect(status()).toBe(200)
      expect(JSON.parse(body())).toEqual({ ok: true, value: { stored: false } })
    }
    expect(readClientReports()).toHaveLength(0)
  })

  it('refuses a non-POST method', async () => {
    const handler = createClientReportHandler()
    const { res, status } = fakeResponse()
    await handler(fakeRequest('GET'), res)
    expect(status()).toBe(405)
  })
})

describe('the client collector', () => {
  const landing: LandmarkClasses = {
    modes: 'modes_x', search: 'search_x', strip: 'strip_x', pill: 'pill_x',
    header: 'header_x', columns: 'columns_x', firstColumn: 'column_x', primary: 'primary_x',
  }

  it('reports only the landmarks that exist and have area', () => {
    const boxes: Record<string, { top: number; bottom: number; height: number }> = {
      header_x: { top: 0, bottom: 160, height: 160 },
      strip_x: { top: 320, bottom: 368, height: 48 },
      pill_x: { top: 330, bottom: 358, height: 28 },
      search_x: { top: 280, bottom: 308, height: 28 },
    }
    const root = {
      querySelector: (selector: string) => {
        const key = selector.slice(1)
        const box = boxes[key]
        if (box === undefined) return null
        return { getBoundingClientRect: () => ({ ...box, width: 100, left: 0, right: 100 }) }
      },
    } as unknown as ParentNode
    const measured = collectBoardBoxes(landing, root)
    expect(Object.keys(measured).sort()).toEqual(['header', 'pill', 'search', 'strip'])
    expect(measured.strip).toEqual({ top: 320, bottom: 368, height: 48 })
    // The gap the whole investigation was about is computable from the report.
    expect(measured.pill!.top - measured.search!.bottom).toBe(22)
  })

  it('treats a zero-area element as absent (hidden strip on a wide board)', () => {
    expect(boxOf({ getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0, width: 0 }) } as unknown as Element)).toBeUndefined()
    expect(boxOf(null)).toBeUndefined()
  })
})

describe('wiring (the channel cannot be dropped silently)', () => {
  const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('the host registers the route and exposes the reports on the update view', () => {
    expect(read('../src/index.ts')).toContain('registerClientReportRoute(ctx, \'dsh-task-board\')')
    const update = read('../src/host/update-route.ts')
    expect(update).toContain('readClientReports()')
    expect(update).toContain('clients')
  })

  it('the mounted board sends one report with its own scoped class names', () => {
    const board = read('../src/client/board/TaskBoard.tsx')
    expect(board).toContain('sendClientReport(BUNDLED_VERSION, {')
    expect(board).toContain('strip: css.columnTabs')
    expect(board).toContain('pill: css.columnTab')
  })
})
