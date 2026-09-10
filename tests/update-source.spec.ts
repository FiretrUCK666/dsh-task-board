/**
 * Browser update-source readers (src/client/update-source.ts): the host view
 * passes through shape-guarded, the npm packument yields latest + publish
 * instant, and every failure — HTTP error, hang, malformed body, old host
 * without the route — degrades to `undefined` (inline retry, never a crash).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchNpmLatest, fetchUpdateSource } from '../src/client/update-source.ts'

afterEach(() => { vi.unstubAllGlobals() })

/** Stub fetch with one canned JSON answer. */
function answerJson(payload: unknown, status = 200): void {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
}

/** Stub fetch with a hang until aborted (dead tunnel, half-open proxy). */
function hangFetch(): void {
  vi.stubGlobal('fetch', (_url: unknown, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'))
    })
  }))
}

describe('fetchUpdateSource', () => {
  it('passes a well-formed host view through', async () => {
    answerJson({
      ok: true,
      value: {
        packageName: '@firetruck666/dsh-task-board',
        version: '0.2.81',
        spec: 'link:/repo',
        mode: 'local',
        githubSpec: 'github:FiretrUCK666/dsh-task-board',
        git: { head: 'aaa', remoteHead: 'bbb', dirty: true },
      },
    })
    expect(await fetchUpdateSource(1_000)).toEqual({
      packageName: '@firetruck666/dsh-task-board',
      version: '0.2.81',
      spec: 'link:/repo',
      mode: 'local',
      githubSpec: 'github:FiretrUCK666/dsh-task-board',
      git: { head: 'aaa', remoteHead: 'bbb', dirty: true },
    })
  })

  it('drops malformed envelopes and HTTP errors to undefined', async () => {
    answerJson({ ok: true, value: { version: '0.2.81' } })
    expect(await fetchUpdateSource(1_000)).toBeUndefined()
    answerJson({ ok: false, error: { code: 'x', message: 'y' } })
    expect(await fetchUpdateSource(1_000)).toBeUndefined()
    answerJson({}, 404)
    expect(await fetchUpdateSource(1_000)).toBeUndefined()
  })

  it('a hanging host resolves undefined within the timeout', async () => {
    hangFetch()
    const started = Date.now()
    expect(await fetchUpdateSource(30)).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})

describe('fetchNpmLatest', () => {
  it('reads dist-tags.latest plus its publish instant', async () => {
    answerJson({
      'dist-tags': { latest: '0.2.81' },
      time: { '0.2.80': '2026-09-10T22:21:52.483Z', '0.2.81': '2026-09-11T10:00:00.000Z' },
    })
    expect(await fetchNpmLatest('@firetruck666/dsh-task-board', 1_000)).toEqual({
      version: '0.2.81',
      publishedAt: '2026-09-11T10:00:00.000Z',
    })
  })

  it('a missing publish instant still yields the version', async () => {
    answerJson({ 'dist-tags': { latest: '0.2.81' }, time: {} })
    expect(await fetchNpmLatest('@firetruck666/dsh-task-board', 1_000)).toEqual({
      version: '0.2.81',
    })
  })

  it('malformed packuments and hangs degrade to undefined', async () => {
    answerJson({ 'dist-tags': {} })
    expect(await fetchNpmLatest('@firetruck666/dsh-task-board', 1_000)).toBeUndefined()
    hangFetch()
    expect(await fetchNpmLatest('@firetruck666/dsh-task-board', 30)).toBeUndefined()
  })
})
