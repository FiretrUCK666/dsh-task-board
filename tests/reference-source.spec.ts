/**
 * Reference-source tests: THE ONE '@' bridge of the board — the official
 * candidate discovery (same two Remote namespaces the harness's ui-reference
 * calls), official insertion grammar, and the per-domain failure guarantee:
 * "either candidate domain can fail independently without hiding the rows
 * the other domain returned" — listReferenceRows NEVER rejects.
 */
import { describe, expect, it } from 'vitest'
import type { ReferenceRemoteFace } from '../src/core/controller.ts'
import { catalogSessionRowsOf, listReferenceRows, type ReferenceMenuResult } from '../src/client/board/reference-source.ts'

/** A fake OFFLINE bridge shaped exactly like the structural face. */
function fakeBridge(): ReferenceRemoteFace {
  return {
    fileReferences: {
      list: async (_sessionId, query) => ({ ok: true as const, value: [
        { kind: 'file', path: 'src/main.ts' },
        { kind: 'directory', path: 'src/components' },
        { kind: 'file', path: 'a file with spaces.txt' },
        { kind: 'file', path: 'notes.md' },
        ...(query === 'x' ? [{ kind: 'file' as const, path: 'xfile.ts' }] : []),
      ] }),
    },
    sessionReferenceResolver: {
      candidates: async () => ({ ok: true as const, value: [
        { sessionId: 's-1', label: '绘画', cwd: '/work', createdAt: 1000, mention: '@[绘画](dsh-session:czc3)' },
        { sessionId: 's-2', label: 's-2', createdAt: 2000, mention: '@[s-2](dsh-session:czc4)' },
      ] }),
    },
  }
}

const signal = (): AbortSignal => new AbortController().signal

describe('listReferenceRows (官方 @ 候选桥)', () => {
  it('merges files and sessions in official order (files first, then sessions)', async () => {
    const { rows } = await listReferenceRows(fakeBridge(), 's-target', '', false, signal())
    expect(rows.map(row => row.section)).toEqual([
      'files', 'files', 'files', 'files', 'sessions', 'sessions',
    ])
  })

  it('renders the official copy: 文件/文件夹/Session names + descriptions', async () => {
    const { rows } = await listReferenceRows(fakeBridge(), 's-target', '', false, signal())
    expect(rows[0].name).toBe('文件 · main.ts')
    expect(rows[0].description).toBe('src/main.ts')
    expect(rows[1].name).toBe('文件夹 · components/')
    expect(rows[2].name).toBe('文件 · a file with spaces.txt')
    expect(rows[4].name).toBe('Session · 绘画')
    // A labelled session includes its id (official description rule).
    expect(rows[4].description).toBe('s-1 · /work · 1970-01-01T00:00:01.000Z')
    expect(rows[4].insert).toBe('@[绘画](dsh-session:czc3)')
    // A session with no recorded title shows the id and omits the id prefix
    // from the description (official rule).
    expect(rows[5].name).toBe('Session · s-2')
    expect(rows[5].description).toBe('（无工作目录） · 1970-01-01T00:00:02.000Z')
  })

  it('inserts OFFICIAL file mentions (@path; quoted only when needed)', async () => {
    const { rows } = await listReferenceRows(fakeBridge(), 's-target', '', false, signal())
    expect(rows[0].insert).toBe('@src/main.ts')
    expect(rows[1].insert).toBe('@src/components/')
    expect(rows[1].continue).toBe(true) // directory descent
    expect(rows[2].insert).toBe('@"a file with spaces.txt"')
  })

  it('suppresses session discovery inside an open quoted path (official rule)', async () => {
    let candidatesCalled = 0
    const bridge: ReferenceRemoteFace = {
      fileReferences: {
        list: async () => ({ ok: true as const, value: [{ kind: 'file', path: 'notes.md' }] }),
      },
      sessionReferenceResolver: {
        candidates: async () => {
          candidatesCalled += 1
          return { ok: true as const, value: [] }
        },
      },
    }
    const { rows, diag } = await listReferenceRows(bridge, 's-target', 'src/', true, signal())
    expect(rows.every(row => row.section === 'files')).toBe(true)
    expect(candidatesCalled).toBe(0)
    expect(diag.sessions).toBeUndefined() // suppressed half is not a failure
  })

  it('passes the query through to the official namespaces (server-side filter)', async () => {
    const { rows } = await listReferenceRows(fakeBridge(), 's-target', 'x', false, signal())
    expect(rows.some(row => row.description === 'xfile.ts')).toBe(true)
  })

  it('returns no rows and no diag when the bridge is absent (no @ menu)', async () => {
    expect(await listReferenceRows(undefined, 's-target', '', false, signal())).toEqual({ rows: [], diag: {} })
  })

  it('reports both halves when the host envelope is ok:false for both', async () => {
    const failing: ReferenceRemoteFace = {
      fileReferences: {
        list: async () => ({ ok: false as const, error: { code: 'FILE_INDEX_UNAVAILABLE', message: 'no index' } }),
      },
      sessionReferenceResolver: {
        candidates: async () => ({ ok: false as const, error: { code: 'SESSION_REFERENCE_INVALID_CONFIG', message: 'no config' } }),
      },
    }
    const { rows, diag } = await listReferenceRows(failing, 's-target', '', false, signal())
    expect(rows).toEqual([])
    expect(diag.files).toEqual({ code: 'FILE_INDEX_UNAVAILABLE' })
    expect(diag.sessions).toEqual({ code: 'SESSION_REFERENCE_INVALID_CONFIG' })
  })

  it('keeps one half when the other half rejects (official per-domain guarantee)', async () => {
    const bridge: ReferenceRemoteFace = {
      fileReferences: {
        list: async () => { throw new Error('file half down') },
      },
      sessionReferenceResolver: {
        candidates: async () => ({ ok: true as const, value: [
          { sessionId: 's-9', label: '绘画', cwd: '/work', createdAt: 1000, mention: '@[绘画](dsh-session:czc9)' },
        ] }),
      },
    }
    const { rows, diag } = await listReferenceRows(bridge, 's-target', '', false, signal())
    expect(rows.map(row => row.section)).toEqual(['sessions'])
    expect(diag.files).toBeDefined()
    expect(diag.sessions).toBeUndefined()
  })

  it('keeps the files half when the sessions namespace is absent', async () => {
    const bridge: ReferenceRemoteFace = {
      fileReferences: {
        list: async () => ({ ok: true as const, value: [{ kind: 'file', path: 'notes.md' }] }),
      },
    }
    const { rows, diag } = await listReferenceRows(bridge, 's-target', '', false, signal())
    expect(rows.map(row => row.section)).toEqual(['files'])
    expect(diag.sessions).toBeDefined()
    expect(diag.files).toBeUndefined()
  })

  it('carries a synchronous throw as a degraded half, never a rejection', async () => {
    const bridge: ReferenceRemoteFace = {
      fileReferences: {
        list: () => { throw new Error('sync boom') },
      },
      sessionReferenceResolver: {
        candidates: async () => ({ ok: true as const, value: [] }),
      },
    }
    const result: ReferenceMenuResult = await listReferenceRows(bridge, 's-target', '', false, signal())
    expect(result.rows).toEqual([])
    expect(result.diag.files).toBeDefined()
  })

  it('omits the date for missing or malformed createdAt instead of crashing', async () => {
    const bridge: ReferenceRemoteFace = {
      sessionReferenceResolver: {
        candidates: async () => ({ ok: true as const, value: [
          { sessionId: 'a', label: '无日期', cwd: '/w', createdAt: undefined as unknown as number, mention: '@[无日期](dsh-session:a)' },
          { sessionId: 'b', label: 'NaN', createdAt: NaN, mention: '@[NaN](dsh-session:b)' },
          { sessionId: 'c', label: '坏串', createdAt: 'not-a-date' as unknown as number, mention: '@[坏串](dsh-session:c)' },
          { sessionId: 'd', label: '字串', createdAt: '2026-01-02T03:04:05.000Z' as unknown as number, mention: '@[字串](dsh-session:d)' },
        ] }),
      },
    }
    const { rows, diag } = await listReferenceRows(bridge, 's-target', '', false, signal())
    expect(rows.map(row => row.description)).toEqual([
      'a · /w',
      'b · （无工作目录）',
      'c · （无工作目录）',
      'd · （无工作目录） · 2026-01-02T03:04:05.000Z',
    ])
    expect(diag.skipped).toBeUndefined()
  })

  it('skips malformed file rows without losing the healthy ones', async () => {
    const bridge: ReferenceRemoteFace = {
      fileReferences: {
        list: async () => ({ ok: true as const, value: [
          { kind: 'file', path: 'ok.ts' },
          { kind: 'file', path: undefined as unknown as string },
        ] }),
      },
    }
    const { rows, diag } = await listReferenceRows(bridge, 's-target', '', false, signal())
    expect(rows.map(row => row.name)).toEqual(['文件 · ok.ts'])
    expect(diag.skipped).toBe(1)
  })

  it('returns empty rows once the request is aborted', async () => {
    const controller = new AbortController()
    const bridge: ReferenceRemoteFace = {
      fileReferences: {
        list: async () => {
          await new Promise(resolve => { setTimeout(resolve, 5) })
          return { ok: true as const, value: [{ kind: 'file', path: 'late.ts' }] }
        },
      },
    }
    const pending = listReferenceRows(bridge, 's-target', '', false, controller.signal)
    controller.abort()
    expect(await pending).toEqual({ rows: [], diag: {} })
  })

  it('reports a failed half in diag only (the official log-only contract — no menu text)', async () => {
    const bridge: ReferenceRemoteFace = {
      fileReferences: {
        list: async () => ({ ok: false as const, error: { code: 'agent-busy', message: 'subagent routing' } }),
      },
      sessionReferenceResolver: {
        candidates: async () => ({ ok: true as const, value: [
          { sessionId: 's-9', label: '绘画', cwd: '/work', createdAt: 1000, mention: '@[绘画](dsh-session:czc9)' },
        ] }),
      },
    }
    const { rows, diag } = await listReferenceRows(bridge, 's-target', '', false, signal())
    // The failed half vanishes from the menu (no rows, no failure row); the
    // reason travels in diag for the console — exactly the official contract.
    expect(rows.map(row => row.section)).toEqual(['sessions'])
    expect(diag.files).toEqual({ code: 'agent-busy' })
    expect(diag.sessions).toBeUndefined()
  })
})

describe('catalogSessionRowsOf (宿主候选不可用时看板目录的会话行)', () => {
  const catalog = [
    { sessionId: 's-target', label: '目标(排除)' },
    { sessionId: 's-1', label: '绘画' },
    { sessionId: 's-2', label: 's-2' },
  ]

  it('excludes the target session (official self rule)', () => {
    const rows = catalogSessionRowsOf(catalog, 's-target')
    expect(rows.map(row => row.key)).toEqual(['session:s-1', 'session:s-2'])
  })

  it('renders official row copy and the OFFICIAL canonical mention', () => {
    const rows = catalogSessionRowsOf(catalog, 's-target')
    expect(rows[0].name).toBe('Session · 绘画')
    expect(rows[0].description).toBe('s-1 · （无工作目录）')
    expect(rows[0].insert).toBe('@[绘画](dsh-session:InMtMSI)')
    expect(rows[1].description).toBe('（无工作目录）')
    expect(rows[1].insert).toBe('@[s-2](dsh-session:InMtMiI)')
  })

  it('escapes a label like the deployed mention encoding', () => {
    const rows = catalogSessionRowsOf([{ sessionId: 's1', label: 'a[b]\\c' }], 'target')
    expect(rows[0].insert).toBe('@[a[b\\]\\\\c](dsh-session:InMxIg)')
  })

  it('caps at the host candidateLimit default', () => {
    const many = Array.from({ length: 60 }, (_value, index) => ({ sessionId: `s-${index}`, label: `L${index}` }))
    expect(catalogSessionRowsOf(many, 's-target').length).toBe(50)
  })

  it('preserves catalog order', () => {
    const rows = catalogSessionRowsOf([{ sessionId: 'b', label: 'B' }, { sessionId: 'a', label: 'A' }], 'target')
    expect(rows.map(row => row.name)).toEqual(['Session · B', 'Session · A'])
  })
})