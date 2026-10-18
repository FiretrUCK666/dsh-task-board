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
    /* THE VERDICT NO LONGER TRAVELS THROUGH THE PANEL.
     *
     * It used to ride the inject face into the board's props. Warnings are now a
     * workbench-level strip — the same `正在跑 1` problem applied to three pages:
     * a warning only the board could show was invisible on the other two. So the
     * assembly layer publishes the sentences (`setWorkbenchNotices`) and every
     * page's bar prints the same list.
     *
     * The wiring assertions therefore name the NEW path, and the one they must
     * keep is the one that could silently break: something has to subscribe, or
     * a restart behind an open page never reaches the strip. */
    expect(bootstrap).toContain('setWorkbenchNotices(list)')
    expect(bootstrap).toContain('freshness.subscribe(publishNotices)')
    expect(bootstrap).toContain('setWorkbenchNotices(')
    const panel = read('../src/client/TaskBoardPanel.tsx')
    expect(panel, 'the panel must no longer take a freshness probe').not.toContain('freshness={freshness}')
    // Watching, not just probing: a restart must reach an already-open page.
    expect(bootstrap).toContain('return freshness.watch()')
  })

  it('the ASSEMBLY layer turns the verdict into one workbench warning and the page below it is tappable', () => {
    /* The warning moved out of the board and into the workbench strip: same
     * sentence, same action, one home for three pages. What must hold is that
     * the publisher still (a) reads the verdict, (b) points at the reload, and
     * (c) hands the sentence to the strip — a publisher that quietly stopped
     * subscribing is a warning nobody would ever see. */
    const bootstrap = read('../src/client/index.ts')
    expect(bootstrap).toContain('freshness.snapshot()')
    expect(bootstrap).toContain("view.state === 'stale'")
    expect(bootstrap).toContain("'board.bundleStale'")
    expect(bootstrap).toContain('reloadForFreshBundle()')
    // The strip renders an actionable warning as a real BUTTON (touch has no
    // hover — a warning you cannot press is a warning you cannot act on).
    const notice = read('../src/client/design/WorkbenchNotice.tsx')
    expect(notice).toContain('onPress')
    expect(notice).toContain('<button')
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
    const bootstrap = read('../src/client/index.ts')
    expect(bootstrap, 'the direction must come from the two versions the probe carries')
      .toContain('isNewerVersion(view.bundled, view.host)')
    expect(bootstrap, 'the host-old case needs its own copy').toContain("t(hostOld ? 'board.bundleStaleHostOld'")
    expect(bootstrap, 'the host-old case needs its own explainer').toContain("t(hostOld ? 'board.bundleStaleHostOldTitle'")
    // Still actionable: the press reloads, which is the right action for page-old
    // and a harmless retry for host-old.
    expect(bootstrap).toMatch(/onPress: \(\) => \{ reloadForFreshBundle\(\) \}/)
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
