/**
 * The stale-bundle policy: version comparison, the one-reload guard, and the
 * "never a false alarm, never a loop" behaviour. The reload itself is a seam,
 * so the whole policy is exercised here without a browser.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { BundleFreshnessState, freshnessOf } from '../src/client/bundle-freshness.ts'

/** An in-memory sessionStorage stand-in. */
function memoryStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void; map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
  }
}

describe('freshnessOf', () => {
  it('agrees when the host serves the version this bundle was built from', () => {
    expect(freshnessOf('0.2.93', '0.2.93')).toBe('current')
  })

  it('reads a disagreement as stale', () => {
    expect(freshnessOf('0.2.90', '0.2.93')).toBe('stale')
  })

  it('an unreadable host is never evidence (no false alarm, no reload loop)', () => {
    expect(freshnessOf('0.2.93', undefined)).toBe('unknown')
    expect(freshnessOf('0.2.93', '')).toBe('unknown')
    expect(freshnessOf('unknown', '0.2.93')).toBe('unknown')
    expect(freshnessOf('', '0.2.93')).toBe('unknown')
  })
})

describe('BundleFreshnessState', () => {
  it('stays silent while the versions agree', async () => {
    const reload = vi.fn()
    const state = new BundleFreshnessState({
      bundled: '0.2.93',
      readHostVersion: async () => '0.2.93',
      reload,
      storage: memoryStorage(),
    })
    const view = await state.probe()
    expect(view.state).toBe('current')
    expect(view.host).toBe('0.2.93')
    expect(reload).not.toHaveBeenCalled()
  })

  it('re-enters the boot graph exactly once for a stale pair', async () => {
    const reload = vi.fn()
    const storage = memoryStorage()
    const state = new BundleFreshnessState({
      bundled: '0.2.90',
      readHostVersion: async () => '0.2.93',
      reload,
      storage,
    })
    const first = await state.probe()
    expect(first.state).toBe('stale')
    expect(first.retried).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    // The guard survives a page that comes back with the same pair: the second
    // probe states the mismatch instead of reloading forever.
    const second = new BundleFreshnessState({
      bundled: '0.2.90',
      readHostVersion: async () => '0.2.93',
      reload,
      storage,
    })
    const view = await second.probe()
    expect(view.state).toBe('stale')
    expect(view.retried).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('a NEW host version earns its own retry (the guard is per pair)', async () => {
    const reload = vi.fn()
    const storage = memoryStorage()
    const first = new BundleFreshnessState({ bundled: '0.2.90', readHostVersion: async () => '0.2.93', reload, storage })
    await first.probe()
    const next = new BundleFreshnessState({ bundled: '0.2.90', readHostVersion: async () => '0.2.94', reload, storage })
    await next.probe()
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('a throwing version reader degrades to unknown and never reloads', async () => {
    const reload = vi.fn()
    const state = new BundleFreshnessState({
      bundled: '0.2.93',
      readHostVersion: async () => { throw new Error('offline') },
      reload,
      storage: memoryStorage(),
    })
    const view = await state.probe()
    expect(view.state).toBe('unknown')
    expect(reload).not.toHaveBeenCalled()
  })

  it('a throwing storage loses only the guard, not the policy', async () => {
    const reload = vi.fn()
    const state = new BundleFreshnessState({
      bundled: '0.2.90',
      readHostVersion: async () => '0.2.93',
      reload,
      storage: { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } },
    })
    const view = await state.probe()
    expect(view.state).toBe('stale')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('subscribers see the verdict exactly once per probe', async () => {
    const seen: string[] = []
    const state = new BundleFreshnessState({
      bundled: '0.2.90',
      readHostVersion: async () => '0.2.93',
      reload: () => {},
      storage: memoryStorage(),
    })
    const dispose = state.subscribe(() => { seen.push(state.snapshot().state) })
    await state.probe()
    dispose()
    expect(seen).toEqual(['stale', 'stale'])
  })

  it('watch() re-probes on a foreground return and on the slow interval, and stops on dispose', async () => {
    vi.useFakeTimers()
    const listeners = new Map<string, () => void>()
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (type: string, fn: () => void) => { listeners.set(type, fn) },
      removeEventListener: (type: string) => { listeners.delete(type) },
    })
    const readHostVersion = vi.fn(async () => '0.2.93')
    const state = new BundleFreshnessState({
      bundled: '0.2.90',
      readHostVersion,
      reload: () => {},
      storage: memoryStorage(),
    })
    const dispose = state.watch(1_000)
    expect(readHostVersion).not.toHaveBeenCalled()
    // Returning to the page re-checks (this is how a host restart reaches an
    // already-open tab).
    listeners.get('visibilitychange')?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(readHostVersion).toHaveBeenCalledTimes(1)
    // …and the slow interval keeps it honest while the page just sits there.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(readHostVersion).toHaveBeenCalledTimes(2)
    dispose()
    expect(listeners.has('visibilitychange')).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(readHostVersion).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('watch() stays quiet while the page is hidden', async () => {
    const listeners = new Map<string, () => void>()
    vi.stubGlobal('document', {
      visibilityState: 'hidden',
      addEventListener: (type: string, fn: () => void) => { listeners.set(type, fn) },
      removeEventListener: (type: string) => { listeners.delete(type) },
    })
    const readHostVersion = vi.fn(async () => '0.2.93')
    const state = new BundleFreshnessState({
      bundled: '0.2.90',
      readHostVersion,
      reload: () => {},
      storage: memoryStorage(),
    })
    const dispose = state.watch(10_000)
    listeners.get('visibilitychange')?.()
    await Promise.resolve()
    expect(readHostVersion).not.toHaveBeenCalled()
    dispose()
    vi.unstubAllGlobals()
  })
})

describe('wiring (the probe cannot be dropped silently)', () => {
  const read = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('the client bootstrap probes at apply time and threads the verdict to the board', () => {
    const bootstrap = read('../src/client/index.ts')
    expect(bootstrap).toContain('new BundleFreshnessState({')
    expect(bootstrap).toContain('bundled: BOARD_VERSION')
    expect(bootstrap).toContain('void freshness.probe()')
    // The verdict reaches the board through the panel registration: the stage
    // holder publishes it and `inject()` hands it over together with the
    // controller, which is the ONLY path into the panel's props. Declaring the
    // prop and rendering it are not enough — a face that omits the field leaves
    // `freshnessView` undefined forever, with the status line below it dead.
    expect(bootstrap).toContain('new TaskBoardStage()')
    expect(bootstrap).toContain('stage.bind(controller, freshness)')
    expect(bootstrap).toMatch(/inject\(\):\s*\{[^}]*freshness/)
    const panel = read('../src/client/TaskBoardPanel.tsx')
    expect(panel).toContain('<TaskBoard controller={controller} freshness={freshness} />')
    // Watching, not just probing: a restart must reach an already-open page.
    expect(bootstrap).toContain('return freshness.watch()')
  })

  it('the board renders the stale verdict as a real, tappable status line', () => {
    const board = read('../src/client/board/TaskBoard.tsx')
    expect(board).toContain('freshness?.snapshot()')
    expect(board).toContain("freshnessView?.state === 'stale'")
    // The key must be REACHED, not written in a particular shape: the render picks
    // between two copy sets with a ternary, so `t('board.bundleStale'` never appears
    // as one contiguous string. Assert the key's presence and let the shape be the
    // implementation's business.
    expect(board).toContain("'board.bundleStale'")
    expect(board).toContain('reloadForFreshBundle()')
    // It rides the settled status-button grammar (a warn-styled real button),
    // never a bare title attribute (touch has no hover).
    expect(board).toMatch(/data-warn="true"[\s\S]{0,400}reloadForFreshBundle\(\)/)
  })

  it('the warning names WHICH side is stale, because the two need different actions', () => {
    // `stale` covers two situations and only one of them is fixed by a reload:
    //   - the PAGE loaded an older bundle -> the reload the button offers works;
    //   - the HOST is older than the page -> the package was updated on disk and
    //     `dsh web` was never restarted, so reloading fetches the same old server
    //     however many times it is tried. "tap to force reload" sends the user in a
    //     circle.
    // The second is what a maintainer sees after any version bump before restarting,
    // so it is the ordinary case, not an edge case.
    const board = read('../src/client/board/TaskBoard.tsx')
    expect(board, 'the direction must come from the two versions the probe carries')
      .toContain('isNewerVersion(freshnessView.bundled, freshnessView.host)')
    expect(board, 'the host-old case needs its own copy').toContain("t(hostOld ? 'board.bundleStaleHostOld'")
    expect(board, 'the host-old case needs its own explainer').toContain("t(hostOld ? 'board.bundleStaleHostOldTitle'")
    // Still a real button in both cases: tapping reloads, which is the right action
    // for page-old and a harmless retry for host-old.
    expect(board).toMatch(/data-warn="true"[\s\S]{0,600}reloadForFreshBundle\(\)/)
  })

  it('both dictionaries carry the copy (the warning can never read as a raw key)', () => {
    const locales = read('../src/client/locales.ts')
    for (const key of [
      'board.bundleStale',
      'board.bundleStaleTitle',
      'board.bundleStaleHostOld',
      'board.bundleStaleHostOldTitle',
    ]) {
      expect(locales.match(new RegExp(`'${key}':`, 'g')) ?? []).toHaveLength(2)
    }
  })
})
