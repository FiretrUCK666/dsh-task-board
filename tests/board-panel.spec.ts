/**
 * Board stage contract: the board's seat is the shell's OFFICIAL centre-stage
 * panel, its entry is the shell's own panel row, and NOTHING in the plugin
 * guesses shell DOM or shell class names to get there.
 *
 * Why this is a test and not just a comment: the board used to mount itself by
 * hunting for `[data-pane="conversation"]` and appending a React root into the
 * shell's own grid item. The host removed that attribute; the fallback
 * (`[class*="centerCol"]`) matched a CSS-Module hash that changes whenever the
 * shell rebuilds. The board silently stopped appearing, nothing threw, and every
 * automated check stayed green. These assertions pin the STRUCTURE that replaced
 * it, and refuse the old approach by name.
 *
 * The entry's TOGGLE (click the open board's row to leave) is also pinned here
 * as a real mounted behavior — it runs under jsdom, so the file declares that
 * environment.
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { TaskBoardIcon } from '../src/client/TaskBoardIcon.tsx'
import { TaskBoardPanel, type TaskBoardPanelProps } from '../src/client/TaskBoardPanel.tsx'
import { apply } from '../src/client/index.ts'
import { BundleFreshnessState } from '../src/client/bundle-freshness.ts'
import { BUNDLED_VERSION } from '../src/client/update-source.ts'
import { t } from '../src/client/locales.ts'
import type { BoardController } from '../src/core/controller.ts'
import type { ClientContext } from '../src/client/platform.ts'

// React's act() asks the environment to opt in — one flag for this file.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

/**
 * Drop comments so a ban applies to CODE, not prose.
 *
 * The ban below forbids shell-DOM guesses. The modules that removed them also
 * DOCUMENT them (that is how a future reader learns why they are gone), so a
 * naive substring search would forbid the explanation along with the practice.
 * CSS is returned untouched — `/* *​/` is its only comment form and the sheet has
 * no banned string in prose anyway.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('board stage (official main panel)', () => {
  const client = read('../src/client/index.ts')
  const panel = read('../src/client/TaskBoardPanel.tsx')
  const icon = read('../src/client/TaskBoardIcon.tsx')

  it('registers the board into the official `main` slot under a single shared id', () => {
    // The keyed main slot IS the centre stage; `activePanelId === null` means the
    // Conversation. The id is declared once (GROUP) so the two registrations
    // cannot drift: the shell resolves a panel ROW to its STAGE by this id.
    expect(client).toContain("const GROUP = { id: 'dsh-task-board' } as const")
    expect(client).toContain("ctx.slots.inject('main'")
    expect(client).toContain('key: GROUP.id')
    expect(client).toContain("ctx.slots.inject('sidebar.panellist'")
    expect(client).toContain('id: GROUP.id')
  })

  it('contributes the panel with a component, an inject face and no children table', () => {
    // A dynamically loaded plugin must not declare child slots: the shell only
    // accepts a children table from entries it composes itself.
    expect(client).not.toMatch(/children:\s*\{/)
    expect(panel).toContain('data-dsh-taskboard-view=""')
    // The panel is contributed at apply time while the board is built later, so
    // "not ready" must be a rendered state rather than a reason not to register:
    // the prop admits absence and the absent case renders the loading line.
    expect(panel).toMatch(/BoardController\s*\|\s*undefined/)
    expect(panel).toContain('controller === undefined')
    expect(panel).toContain("t('board.loading')")
  })

  it('renders the board only from props — never creates its own React root', () => {
    // `createRoot` into shell DOM was the old strategy; the shell owns rendering
    // now, so a second root inside its tree would be a bug, not a workaround.
    const code = stripComments(panel)
    expect(code).not.toContain('createRoot')
    expect(code).not.toContain('MutationObserver')
    expect(code).toContain('useEffect')
  })

  it('keeps the board box a named size container (the responsive contract is unchanged)', () => {
    const css = read('../src/client/board.module.css')
    expect(css).toMatch(/\[data-dsh-taskboard-view\]\s*\{[\s\S]*?container-type:\s*inline-size/)
    expect(css).toMatch(/\[data-dsh-taskboard-view\]\s*\{[\s\S]*?container-name:\s*dsh-tb/)
    // No viewport media queries in the board's own sheet.
    expect(css).not.toMatch(/@media\s*\(max-width/)
  })

  it('draws its glyph, owns no row chrome, and reads no selectors (one documented seam)', () => {
    // The shell owns the button, its geometry, hover/active fill, the selected
    // highlight and the label; a second row implementation would drift from the
    // native entries (the rejected alternative). The ONE behavior this
    // component adds — toggling the shell's select when the board is already
    // open — lives on a listener attached to the button that CONTAINS our
    // glyph (the slot contract says the shell owns that button), so the bans
    // below are precise: no selector guessing, no shell DOM writes; the
    // attach/remove pair is asserted as a matched disposer.
    expect(icon).toContain('size: number')
    expect(icon).toContain('active: boolean')
    expect(icon).toContain('onExit?: () => void')
    const code = stripComments(icon)
    expect(code).not.toMatch(/querySelector|getElementsBy|classList|getAttribute|setAttribute|insertBefore|appendChild/)
    expect(code).toContain("closest('button')")
    expect(code).toContain('addEventListener')
    expect(code).toContain('removeEventListener')
  })

  it('has no DOM-guessing mount module left in the tree', () => {
    // cwd-relative under jsdom (the same pattern drag-contract uses): a
    // relative `new URL(..., import.meta.url)` does not survive this
    // environment's URL wiring, while process.cwd() is the repo root here.
    expect(existsSync(join(process.cwd(), 'src', 'client', 'board-mount.tsx'))).toBe(false)
    expect(existsSync(join(process.cwd(), 'src', 'client', 'SidebarFooter.tsx'))).toBe(false)
  })

  it('never reads a shell class name or a removed shell attribute (source-level ban)', () => {
    // The banned strings are the historical guesses, named explicitly so a
    // future "quick fix" cannot reintroduce them quietly. They are assembled from
    // fragments so this spec does not itself contain them.
    const banned = [
      ['data', 'pane'].join('-'),
      ['center', 'Col'].join(''),
      ['data-dsh-taskboard', 'active'].join('-'),
    ]
    const sources = [
      ['../src/client/index.ts', stripComments(client)],
      ['../src/client/TaskBoardPanel.tsx', stripComments(panel)],
      ['../src/client/TaskBoardIcon.tsx', stripComments(icon)],
      ['../src/client/board.module.css', read('../src/client/board.module.css')],
    ] as const
    for (const [name, text] of sources) {
      for (const needle of banned) {
        expect(text.includes(needle), `${name} must not reference "${needle}"`).toBe(false)
      }
    }
  })

  it('leaves the board open state to the panel mount lifetime (one source of truth)', () => {
    // The controller's boardOpen mirrors "this panel is mounted", so the stage
    // and the snapshot cannot disagree; leaving goes through the shell's panel
    // API instead of flipping a boolean the shell never reads.
    expect(panel).toContain('controller.openBoard()')
    expect(panel).toContain('controller.closeBoard()')
    const controller = read('../src/core/controller.ts')
    expect(controller).toContain('showConversation()')
    expect(controller).not.toContain('toggleBoard')
  })
})

describe('entry row toggle (click the open board’s row to leave it)', () => {
  interface MountedRow {
    button: HTMLButtonElement
    icon: SVGSVGElement
    rerender: (active: boolean) => void
    dispose: () => void
  }

  /** One mounted shell row: the shell's own button wrapping our glyph. */
  function mountRow(active: boolean, onExit: () => void, onSelect: () => void): MountedRow {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const row = (isActive: boolean) =>
      createElement(
        'button',
        { type: 'button', onClick: onSelect },
        createElement(TaskBoardIcon, { size: 16, active: isActive, onExit }),
      )
    // Rendering inside act so the glyph's effect (the closest('button')
    // listener) is attached before any click — the behavior under test IS
    // that effect.
    act(() => { root.render(row(active)) })
    const button = host.querySelector('button')
    const icon = host.querySelector('svg')
    if (button === null || icon === null) throw new Error('the row did not mount')
    return {
      button,
      icon,
      rerender: isActive => { act(() => { root.render(row(isActive)) }) },
      dispose: () => { act(() => { root.unmount() }); host.remove() },
    }
  }

  it('board open: a click anywhere on the row EXITS, and the shell select never fires', () => {
    // The keyboard path lands here too: Enter on the focused row dispatches a
    // click whose target IS the button — same listener, same rule. Stopping
    // the native bubble keeps React's root-delegated handler (the shell's
    // `selectPanel(id)`) from ever running.
    const calls: string[] = []
    const row = mountRow(true, () => calls.push('exit'), () => calls.push('select'))
    row.button.click()
    expect(calls).toEqual(['exit'])
    row.dispose()
  })

  it('board open: a click on the glyph itself exits by the same rule', () => {
    const calls: string[] = []
    const row = mountRow(true, () => calls.push('exit'), () => calls.push('select'))
    // SVG elements carry no HTMLElement#click — dispatch the real event type
    // (bubbles up the same path a pointer press would take).
    row.icon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(calls).toEqual(['exit'])
    row.dispose()
  })

  it('board closed: the click passes through and the shell opens the board', () => {
    const calls: string[] = []
    const row = mountRow(false, () => calls.push('exit'), () => calls.push('select'))
    row.button.click()
    expect(calls).toEqual(['select'])
    row.dispose()
  })

  it('flipping active re-binds the rule (a stale closure can never misfire)', () => {
    const calls: string[] = []
    const row = mountRow(true, () => calls.push('exit'), () => calls.push('select'))
    row.rerender(false)
    row.button.click()
    expect(calls, 'after the board closes the same click must select, not exit').toEqual(['select'])
    row.dispose()
  })

  it('without a wrapping button the toggle is ABSENT, not broken (safe degradation)', () => {
    // The failure mode if the shell ever stops rendering the glyph inside a
    // button: `closest` finds nothing, no listener attaches, the click goes
    // nowhere — a missing feature, never a thrown page.
    const calls: string[] = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => { root.render(createElement(TaskBoardIcon, { size: 16, active: true, onExit: () => calls.push('exit') })) })
    const icon = host.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(() => icon!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).not.toThrow()
    expect(calls).toEqual([])
    act(() => { root.unmount() })
    host.remove()
  })

  it('the listener is a matched add/remove pair (lifecycle discipline, no leaks)', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    const wire = button as unknown as {
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void
    }
    const added: string[] = []
    const removed: string[] = []
    const origAdd = wire.addEventListener.bind(button)
    const origRemove = wire.removeEventListener.bind(button)
    wire.addEventListener = (type, listener, options) => { added.push(type); origAdd(type, listener, options) }
    wire.removeEventListener = (type, listener, options) => { removed.push(type); origRemove(type, listener, options) }
    const root = createRoot(button)
    act(() => { root.render(createElement(TaskBoardIcon, { size: 16, active: true, onExit: () => {} })) })
    expect(added).toContain('click')
    act(() => { root.unmount() })
    expect(removed, 'every attached listener must be detached on dispose').toContain('click')
    button.remove()
  })
})

/**
 * The plugin boundary the shell reads: the `main` registration's inject face.
 *
 * The panel is contributed at apply time while the board is built behind it, so
 * that face is the ONLY channel carrying live state into the panel. A value the
 * panel declares but the face never publishes is invisible at runtime — the
 * prop is merely never passed, no error anywhere — which is exactly how the
 * stale-bundle status line went silent while both files stayed green. These
 * tests drive the REAL `apply` and read the face it registers.
 */
describe('panel inject face (the live state the shell hands the panel)', () => {
  interface FakeRegistration {
    name: string
    inject: () => unknown
  }

  /**
   * The client context the plugin's synchronous mount path reads. The board
   * mounts as soon as this entry is evaluated — being composed IS the enabled
   * state — so the fake carries no settings scope at all.
   */
  function fakeClientContext() {
    const effects: Array<() => void> = []
    const registrations = new Map<string, FakeRegistration>()
    const sessionsSnapshot = { ids: [], byId: {}, phase: 'ready' as const }
    const workspacesSnapshot = { items: [], archivedSessionIds: [] }
    const ctx = {
      effect: (fn: () => void | (() => void)) => {
        const dispose = fn()
        if (typeof dispose === 'function') effects.push(dispose)
        return () => {}
      },
      locale: { register: () => () => {} },
      slots: {
        inject: (_name: string, contribute: () => void | (() => void)) => {
          const dispose = contribute()
          if (typeof dispose === 'function') effects.push(dispose)
          return () => {}
        },
        register: (entry: FakeRegistration) => {
          registrations.set(entry.name, entry)
          return () => { registrations.delete(entry.name) }
        },
      },
      get: () => undefined,
      sessions: {
        list: { getSnapshot: () => sessionsSnapshot, subscribe: () => () => {} },
        binding: () => undefined,
      },
      workspaces: {
        list: { getSnapshot: () => workspacesSnapshot, subscribe: () => () => {} },
      },
    }
    return {
      ctx,
      registrations,
      /** Fiber teardown: every effect the plugin registered, disposed. */
      disposeAll() { for (const dispose of effects.splice(0)) dispose() },
    }
  }

  it('carries the bundle-freshness state next to the controller, and withdraws both with the board', () => {
    const fake = fakeClientContext()
    apply(fake.ctx as unknown as ClientContext)
    const main = fake.registrations.get('main')
    expect(main, 'the board panel must be contributed to the main slot').toBeDefined()

    const face = main!.inject() as TaskBoardPanelProps
    expect(face.controller).toBeDefined()
    // The verdict source is created at apply time and must ride the same face;
    // without it TaskBoard's `freshnessView` is undefined forever and the whole
    // stale status line (with its retry button) can never render.
    expect(face.freshness).toBeInstanceOf(BundleFreshnessState)
    expect(face.freshness?.snapshot().bundled).toBe(BUNDLED_VERSION)

    // Read fresh on every call: one live instance, a new face object per render.
    expect((main!.inject() as TaskBoardPanelProps).freshness).toBe(face.freshness)
    expect(main!.inject()).not.toBe(face)

    // Fiber teardown (the plugin manager switched this entry off, so the whole
    // client half is disposed): the face publishes nothing, so a late render
    // cannot subscribe to a dead probe.
    fake.disposeAll()
    const afterDispose = main!.inject() as TaskBoardPanelProps
    expect(afterDispose.controller).toBeUndefined()
    expect(afterDispose.freshness).toBeUndefined()
  })
})

/**
 * The stale verdict, rendered: what the user actually sees when the page runs
 * an older bundle than the host serves. Mounted through the real panel, so the
 * chain `inject face -> TaskBoardPanel props -> status line` is exercised
 * rather than asserted about.
 */
describe('stale-bundle status line (rendered through the panel)', () => {
  /** The two browser APIs the mounted board touches that jsdom lacks. */
  function installBrowserFakes(): void {
    const g = globalThis as unknown as Record<string, unknown>
    g.ResizeObserver = g.ResizeObserver ?? class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    if (typeof window.matchMedia !== 'function') {
      const w = window as unknown as Record<string, unknown>
      w.matchMedia = (query: string) => ({
        matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return false },
      })
    }
  }

  /** A controller that answers every member the board's render reads. */
  function boardStub(): Record<string, unknown> {
    const snapshot = () => ({
      tasks: [],
      boardOpen: true,
      selectedTaskId: undefined,
      cruise: { enabled: false, limit: 3, schedule: [] },
      stats: { running: 0, queued: 0 },
      skips: { overlap: 0, missed: 0 },
      heartbeat: { lastOkAt: 0 },
      engine: { held: true, synced: false, hostProto: 2, bootedAt: undefined },
    })
    return new Proxy({} as Record<string, unknown>, {
      get(_target, key) {
        if (key === 'getSnapshot') return snapshot
        if (key === 'subscribe' || key === 'subscribeQuestions') return () => () => {}
        if (key === 'linkedOf') return () => []
        if (key === 'relatedSessionIdSet') return () => new Set<string>()
        if (key === 'liveStateOf') return () => 'idle'
        if (key === 'sessionActiveOf') return () => false
        if (key === 'pendingInteractionOf' || key === 'questionPendingOf') return () => undefined
        if (key === 'sessionTitle') return () => undefined
        if (key === 'boundSourceTitleOf') return () => ''
        if (key === 'runCatalog') return () => undefined
        if (key === 'externalKindOf') return () => undefined
        if (key === 'canRecheckSeat') return () => false
        if (key === 'ts') return () => 0
        return () => undefined
      },
    })
  }

  /** Mount the panel with one freshness source and return its host element. */
  async function mountPanel(freshness: BundleFreshnessState): Promise<{
    host: HTMLElement
    unmount: () => void
  }> {
    installBrowserFakes()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(TaskBoardPanel, {
        controller: boardStub() as unknown as BoardController,
        freshness,
      }))
    })
    return {
      host,
      unmount: () => {
        act(() => { root.unmount() })
        host.remove()
      },
    }
  }

  it('states the mismatch in a real, tappable status button', async () => {
    const freshness = new BundleFreshnessState({
      bundled: '1.0.0',
      readHostVersion: async () => '2.0.0',
      reload: () => {},
      storage: undefined,
    })
    await freshness.probe()
    const { host, unmount } = await mountPanel(freshness)
    const warn = host.querySelector('[data-warn="true"]')
    expect(warn, 'the page-old verdict must render as the warn status button').not.toBeNull()
    expect(warn!.tagName).toBe('BUTTON')
    expect(warn!.textContent).toContain(t('board.bundleStale', { c: '1.0.0', s: '2.0.0' }))
    unmount()
  })

  it('says nothing while the versions agree, then states a verdict that arrives after mount', async () => {
    // The production sequence: the board mounts while the probe is still in
    // flight (or has agreed), and the mismatch is discovered LATER. The line
    // must appear from the subscription, not only from the first snapshot.
    let hostVersion = BUNDLED_VERSION
    const freshness = new BundleFreshnessState({
      bundled: BUNDLED_VERSION,
      readHostVersion: async () => hostVersion,
      reload: () => {},
      storage: undefined,
    })
    await freshness.probe()
    const { host, unmount } = await mountPanel(freshness)
    expect(host.querySelector('[data-warn="true"]')).toBeNull()
    hostVersion = '99.0.0'
    await act(async () => { await freshness.probe() })
    const warn = host.querySelector('[data-warn="true"]')
    expect(warn, 'the late verdict must reach the mounted board').not.toBeNull()
    expect(warn!.textContent).toContain(t('board.bundleStale', { c: BUNDLED_VERSION, s: '99.0.0' }))
    unmount()
  })
})
