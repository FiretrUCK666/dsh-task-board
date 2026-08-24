/**
 * Reference-source tests: THE ONE '@' bridge of the board — the official
 * candidate discovery (same two Remote namespaces the harness's ui-reference
 * calls), official insertion grammar, and graceful degradation.
 */
import { describe, expect, it } from 'vitest'
import type { ReferenceRemoteFace } from '../src/core/controller.ts'
import { listReferenceRows } from '../src/client/board/reference-source.ts'

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
    const rows = await listReferenceRows(fakeBridge(), 's-target', '', false, signal())
    expect(rows.map(row => row.section)).toEqual([
      'files', 'files', 'files', 'files', 'sessions', 'sessions',
    ])
  })

  it('renders the official copy: 文件/文件夹/Session names + descriptions', async () => {
    const rows = await listReferenceRows(fakeBridge(), 's-target', '', false, signal())
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
    const rows = await listReferenceRows(fakeBridge(), 's-target', '', false, signal())
    expect(rows[0].insert).toBe('@src/main.ts')
    expect(rows[1].insert).toBe('@src/components/')
    expect(rows[1].continue).toBe(true) // directory descent
    expect(rows[2].insert).toBe('@"a file with spaces.txt"')
  })

  it('suppresses session discovery inside an open quoted path (official rule)', async () => {
    const rows = await listReferenceRows(fakeBridge(), 's-target', 'src/', true, signal())
    expect(rows.every(row => row.section === 'files')).toBe(true)
  })

  it('passes the query through to the official namespaces (server-side filter)', async () => {
    const rows = await listReferenceRows(fakeBridge(), 's-target', 'x', false, signal())
    expect(rows.some(row => row.description === 'xfile.ts')).toBe(true)
  })

  it('returns an empty list when the bridge is absent (no @ menu)', async () => {
    expect(await listReferenceRows(undefined, 's-target', '', false, signal())).toEqual([])
  })

  it('degrades each half independently when a namespace fails', async () => {
    const failing: ReferenceRemoteFace = {
      fileReferences: {
        list: async () => ({ ok: false as const, error: 'boom' }),
      },
      sessionReferenceResolver: {
        candidates: async () => ({ ok: false as const, error: 'boom' }),
      },
    }
    expect(await listReferenceRows(failing, 's-target', '', false, signal())).toEqual([])
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
    expect(await pending).toEqual([])
  })
})