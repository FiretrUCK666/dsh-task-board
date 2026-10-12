/**
 * Board stage contract: the board's seat is the shell's OFFICIAL centre-stage
 * panel, its entry is the shell's own panel row, and NOTHING in the plugin
 * guesses shell DOM or shell class names to get there.
 *
 * Why this is a test and not just a comment. A shell attribute
 * (`[data-pane="conversation"]`) and a CSS-Module class hash (`[class*="centerCol"]`)
 * are the two things a plugin may NOT build its seat on: the first the host can
 * remove, the second changes whenever the shell rebuilds. Mounting on either means
 * the board silently stops appearing, nothing throws, and every automated check
 * stays green. These assertions pin the STRUCTURE that replaces that approach, and
 * refuse it by name.
 *
 * The entry's TOGGLE (click the open board's row to leave) is also pinned here
 * as a real mounted behavior — it runs under jsdom, so the file declares that
 * environment.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import type { TaskRecord } from '../src/core/tasks.ts'
import { TaskBoardIcon } from '../src/client/TaskBoardIcon.tsx'
import { TaskBoardPanel, type TaskBoardPanelProps } from '../src/client/TaskBoardPanel.tsx'
import { createTask } from '../src/core/tasks.ts'
import { withSessionRules } from '../src/core/automation.ts'
import { InteractionCard } from '../src/client/board/InteractionCard.tsx'
import { SessionRulesSection } from '../src/client/board/automation-ui.tsx'
import type { WireQuestion } from '../src/core/question-rpc.ts'
import { alignClassNames, panelCss, writeStandalonePage } from './panel-harness.ts'
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
 * The two browser APIs the mounted board touches that jsdom lacks.
 *
 * Module scope on purpose: two describes mount the real panel (the stale-bundle
 * line and the update dialog), and a second copy of these fakes is how one of
 * them would quietly stop matching the other.
 */
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

/**
 * A controller that answers every member the board's render reads.
 * @param tasks - 板上放哪些卡；不传就是空板（其余用例的行为一字不变）。
 */
function boardStub(tasks: readonly TaskRecord[] = []): Record<string, unknown> {
  const snapshot = () => ({
    tasks,
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
      /* **卡片的圆点读它**（`controller.sessionsOf`，与卡里那份列表同一个集合）。少了这一个
         成员，假面就比现实窄：「空板」渲染得出来，「有卡片」的渲染一读就 `undefined.map` 崩
         ——正好在需要它的那一刻暴露（硬性规范 18）。 */
      if (key === 'sessionsOf') return () => []
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

/** Mount the real panel (effects and all) and return its host element. */
async function mountBoard(props: {
  controller?: BoardController
  freshness?: BundleFreshnessState
}): Promise<{ host: HTMLElement; unmount: () => void }> {
  installBrowserFakes()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(TaskBoardPanel, {
      controller: (props.controller ?? boardStub()) as unknown as BoardController,
      ...props.freshness === undefined ? {} : { freshness: props.freshness },
    } as never))
  })
  return {
    host,
    unmount: () => {
      act(() => { root.unmount() })
      host.remove()
    },
  }
}

/**
 * The stale verdict, rendered: what the user actually sees when the page runs
 * an older bundle than the host serves. Mounted through the real panel, so the
 * chain `inject face -> TaskBoardPanel props -> status line` is exercised
 * rather than asserted about.
 */
describe('stale-bundle status line (rendered through the panel)', () => {
  /**
   * **看板那一侧的工件：这是看板唯一一条能把自己的卡片画出来看的链路。**
   *
   * 清单那一侧是 `writeRenderArtifact`，而看板的验证全在 jsdom 的结构断言与 CSS 契约
   * 里——「卡片上那枚读数长什么样」「窄档会不会折行」这类问题，只读代码回答不了。它与清单
   * 共用**同一台页面装配**（`writeStandalonePage`：宿主真实暗色表、移动端 viewport、外壳给的
   * 确定高度盒子）与同一份样式（`panelCss()` 里本来就含 `board.module.css`），所以两块面板的
   * 截图是可比的——不是两套各写一遍的装置。
   *
   * 静态渲染（`renderToStaticMarkup`）就够：看板的列与卡片都是**从快照算出来的**，不依赖
   * effect，因此不需要 DOM、也不需要 `installBrowserFakes`。
   *
   * **它能证明什么、不能证明什么（写下来，否则这张图会被当成它证明不了的东西）。**
   * 把页面开在 412 宽能证明的是：**CSS 那一半**的响应式——容器查询、换行、让位、芯片不折行。
   * 它**证明不了窄档真正的版面**：看板的窄档是 JS 判的（`useSurfaceNarrow` 量真实盒子的宽度），
   * 而静态渲染里没有布局、更没有那一次测量，所以它画出来的是**宽档的排列被挤进 412**。
   * 要看真正的窄档版面，只能在真浏览器里挂载（带 effect 的渲染）——那是宿主里的事，
   * `file://` 工件做不到。**这一条是这台仪器的边界，不是产品的问题。**
   */
  /**
   * 工件里的两张卡：一张挂着三条清单条目（最急是紧急），一张光卡——那枚读数的「有」与
   * 「没有」两种情形一屏看全。用 core 的真构造器建（`NewTaskInput` 里 `description` 是
   * **必填**，手写的对象少写一个字段不会报错，只会在运行时抛 `trim of undefined`）：手写对象会随字段增加静默变成一个
   * 「看起来很像真卡的东西」（硬性规范 18）。
   */
  function boardFixture(): TaskRecord[] {
    const at = 1_700_000_000_000
    return [
      createTask({ title: '画廊第二版', description: '', prompt: '把画廊的第二版做出来', status: 'todo' }, at, 'task-1'),
      createTask({ title: '光卡：没有挂任何清单条目', description: '', prompt: '随便什么', status: 'backlog' }, at, 'task-2'),
    ]
  }

  function writeBoardArtifact(target: string, mountedOf?: (cardId: string) => { readonly count: number; readonly loudest?: 'low' | 'normal' | 'high' | 'urgent' } | undefined, scheme: 'light' | 'dark' = 'light'): string {
    const aligned = alignClassNames(
      renderToStaticMarkup(createElement(TaskBoardPanel, {
        controller: boardStub(boardFixture()) as unknown as BoardController,
        ...mountedOf === undefined ? {} : { mountedOf },
      } as never)),
      panelCss(),
    )
    /* 深色档与清单那一侧**同一个办法**：`scheme` 是参数，不是环境变量。再加一个
       `DSH_PANEL_SCHEME` 就是同一个能力两套开关，正是这一页反复在消的那种债（硬性规范 17）。 */
    writeStandalonePage(target, aligned.html, aligned.css, scheme, 'task board')
    return aligned.html
  }

  it('writes the board page when DSH_PANEL_HTML names a path', () => {
    const target = process.env.DSH_PANEL_HTML
    if (target === undefined || target === '') return
    /* 一张挂着三条清单条目的卡（最急的一档是紧急）与一张光卡：那一枚读数与「没有条目就不画」
       的两种情况，一屏里都看得到。 */
    const markup = writeBoardArtifact(target, cardId => (cardId === 'task-1' ? { count: 3, loudest: 'urgent' } : undefined))
    /* **工件要能证明自己画对了。** 这台假 controller 若少一个成员（真发生过：卡片的圆点读
       `sessionsOf`，而它没有），渲染要么直接抛、要么**安静地少画一点**——后者最危险：截出来
       是一张看起来很好、实际缺东西的图，而读图的人会照它下结论。所以这里断言它画出了该画的
       那几样，任何一个没了就红。 */
    for (const must of ['画廊第二版', '光卡：没有挂任何清单条目', '挂 3 条 · 最急：紧急', '规划', '待办', '进行', '审核', '完成']) {
      expect(markup, `工件里少了「${must}」——那张图不能用来下结论`).toContain(must)
    }
  })

  it('states the mismatch in a real, tappable status button', async () => {
    const freshness = new BundleFreshnessState({
      bundled: '1.0.0',
      readHostVersion: async () => '2.0.0',
      reload: () => {},
      storage: undefined,
    })
    await freshness.probe()
    const { host, unmount } = await mountBoard({ freshness })
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
    const { host, unmount } = await mountBoard({ freshness })
    expect(host.querySelector('[data-warn="true"]')).toBeNull()
    hostVersion = '99.0.0'
    await act(async () => { await freshness.probe() })
    const warn = host.querySelector('[data-warn="true"]')
    expect(warn, 'the late verdict must reach the mounted board').not.toBeNull()
    expect(warn!.textContent).toContain(t('board.bundleStale', { c: BUNDLED_VERSION, s: '99.0.0' }))
    unmount()
  })
})

/**
 * 检查更新的对话框，按真交互走一遍：按钮 → 检查 → 对话框 → 一键更新 → 结果。
 *
 * 为什么值得单独一条：这个对话框的每一行字都出自**host 报的那一份安装**，而
 * 「host 报错了 profile」正是它出过的那次事故——桌面端装着 npm 版（`^0.8.26`），
 * 却被按 web profile 的 `link:` 报成「本地开发」并给出一条会失败的命令。所以这里
 * 断言的是**屏上的字**，不是 host 的返回值：返回值对了而屏上照旧文写，它就该红。
 */
describe('the update dialog, driven through the header button', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  /** One host view: an npm install inside the desktop application's profile. */
  function viewOf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      packageName: '@firetruck666/dsh-task-board',
      version: '0.8.26',
      spec: '^0.8.26',
      mode: 'npm',
      profile: 'desktop',
      appManaged: false,
      githubSpec: 'github:FiretrUCK666/dsh-task-board',
      plan: {
        mode: 'npm',
        profile: 'desktop',
        appManaged: false,
        packageSpec: '@firetruck666/dsh-task-board@latest',
        apply: 'package',
        steps: [{
          command: 'dsh',
          args: ['plugin', '--profile', 'desktop', 'add', '@firetruck666/dsh-task-board@latest'],
        }],
      },
      ...overrides,
    }
  }

  /** Answer the update route's requests, and count the applies it was asked for. */
  function stubUpdateFetch(answers: {
    view: () => unknown
    apply?: unknown
  }): { posts: number } {
    const counter = { posts: 0 }
    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
      const href = String(url)
      const answer = (payload: unknown): Response => new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
      if (href.includes('registry.npmjs.org')) {
        return answer({
          'dist-tags': { latest: '0.9.60' },
          time: { '0.9.60': '2026-10-12T00:00:00.000Z' },
        })
      }
      /* 板子自己的请求（租约、文档）与这条链路无关，而这个 stub 不该假装它们成了：
         一次真的答复会把租约当成拿到手，于是这个用例在测另一件事（硬性规范 18）。 */
      if (!href.includes('api/dsh-task-board/update')) {
        return answer({ ok: false, error: { code: 'stub', message: 'not stubbed' } })
      }
      if (init?.method === 'POST') {
        counter.posts += 1
        return answer({ ok: true, value: answers.apply })
      }
      return answer({ ok: true, value: answers.view() })
    })
    return counter
  }

  /** Click the one button whose label is exactly this text. */
  async function clickLabel(host: HTMLElement, label: string): Promise<void> {
    const buttons = [...host.querySelectorAll('button')]
    const button = buttons.find(one => one.textContent?.trim() === label)
    expect(
      button,
      `屏上没有「${label}」这个按钮。屏幕上是：[${buttons.map(one => one.textContent?.trim()).join(' | ')}]`,
    ).not.toBeUndefined()
    await act(async () => { button?.click() })
  }

  /** The update dialog as it is on screen. */
  function dialogIn(host: HTMLElement): HTMLElement {
    const dialog = host.querySelector('[role="dialog"]')
    expect(dialog, '更新对话框没有出现').not.toBeNull()
    return dialog as HTMLElement
  }

  it('states the install method and profile of the copy that is running', async () => {
    stubUpdateFetch({ view: () => viewOf() })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    const dialog = dialogIn(host)
    expect(dialog.textContent).toContain(t('board.update.mode.npm'))
    expect(dialog.textContent, '对话框没有说这份安装属于哪个 profile').toContain('desktop')
    expect(dialog.textContent).toContain('0.8.26')
    expect(dialog.textContent).toContain(t('board.update.newVersion', { v: '0.9.60' }))
    // The equivalent terminal line names THIS profile, not a profile written into the bundle.
    expect(dialog.textContent).toContain('dsh plugin --profile desktop add')
    expect(dialog.textContent).toContain(t('board.update.apply'))
    unmount()
  })

  it('says what a packaged application can do instead, and offers no impossible command', async () => {
    // The app's own profile is owned by the app: its CLI refuses it, so a
    // terminal line here would be a command that cannot work.
    stubUpdateFetch({
      view: () => viewOf({ appManaged: true, plan: { ...viewOf().plan as object, appManaged: true, steps: [] } }),
    })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    const dialog = dialogIn(host)
    expect(dialog.textContent).toContain(t('board.update.appManaged'))
    expect(dialog.textContent).not.toContain('dsh plugin --profile')
    expect(dialog.textContent).toContain(t('board.update.apply'))
    unmount()
  })

  it('applies the plan and reports what happened, in this copy’s words', async () => {
    let applied = false
    const counter = stubUpdateFetch({
      view: () => viewOf(applied ? { version: '0.9.60' } : {}),
      apply: { ok: true, outcome: 'restart-required', version: '0.9.60' },
    })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    await clickLabel(host, t('board.update.apply'))
    const dialog = dialogIn(host)
    expect(counter.posts, '按下更新没有发过一次申请').toBe(1)
    expect(dialog.textContent).toContain(t('board.update.restartRequired', { v: '0.9.60' }))
    // Once it is done there is nothing left to press: the action is gone, closing stays.
    expect(dialog.textContent).not.toContain(t('board.update.apply'))
    unmount()
  })

  it('a refused update states the reason, shows the output, and keeps the manual line', async () => {
    stubUpdateFetch({
      view: () => viewOf(),
      apply: { ok: false, error: 'failed', output: 'ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/x: Not Found' },
    })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    await clickLabel(host, t('board.update.apply'))
    const dialog = dialogIn(host)
    expect(dialog.textContent).toContain(t('board.update.applyFailed'))
    expect(dialog.textContent).toContain(t('board.update.reason.failed'))
    expect(dialog.textContent).toContain('ERR_PNPM_FETCH_404')
    // A failure never removes the way out.
    expect(dialog.textContent).toContain('dsh plugin --profile desktop add')
    unmount()
  })

  it('writes the dialog page when DSH_PANEL_HTML names a path', async () => {
    const target = process.env.DSH_PANEL_HTML
    if (target === undefined || target === '') return
    /* 这张工件要能证明自己画对了什么：把失败态开在屏上，因为失败态才是这个对话框里
       元素最多的一档（结果行 + 原因 + 输出块 + 命令 + 重启说明）。缺任何一样，读图的
       人会照一张「看起来很好、其实少了东西」的图下结论。 */
    stubUpdateFetch({
      view: () => viewOf(),
      apply: { ok: false, error: 'failed', output: 'ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/@firetruck666/dsh-task-board: Not Found' },
    })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    await clickLabel(host, t('board.update.apply'))
    const aligned = alignClassNames(host.innerHTML, panelCss())
    writeStandalonePage(target, aligned.html, aligned.css, 'light', 'update dialog')
    for (const must of [
      t('board.update.title'),
      t('board.update.mode.npm'),
      t('board.update.applyFailed'),
      'ERR_PNPM_FETCH_404',
      'dsh plugin --profile desktop add',
    ]) {
      expect(host.innerHTML, `工件里少了「${must}」——那张图不能用来下结论`).toContain(must)
    }
    unmount()
  })
})

/**
 * 看板的另外两处界面：会话规则表单（那条自填指令带的附件）与只读那张计划卡。
 *
 * ── 为什么需要第二台工件 ──────────────────────────────────────────────────────
 *
 * `writeBoardArtifact` 画的是**看板舞台**（列与卡片），而这两处住在看板的另一半：一个在任务
 * 详情的「自动化」里，一个在复核页的交互区。它们此前**一张图都没有**——「附件条在看板上
 * 长什么样」「计划正文到底渲染成了什么」只靠结构断言回答，而结构断言答不了排版。
 *
 * ── 它能证明什么、不能证明什么 ───────────────────────────────────────────────
 *
 * 与看板那一台同一条边界（见 `writeBoardArtifact` 的注释）：静态渲染没有布局，所以窄档
 * 那一条证明的是 **CSS 的响应式一半**（换行、让位、芯片不折行），不是 `useSurfaceNarrow`
 * 真正判出来的窄档版面。规则表单那一张还多一层：它是 **jsdom 里挂载、点开之后取下的真实
 * DOM**，所以「点了编辑，表单里的芯片画出来了」这件事本身也在图里。
 */
describe('看板的另外两处界面（规则表单的附件条 / 只读计划卡）', () => {
  /** 一条带附件的规则：表单打开时要看得到芯片，否则这一张图证明不了那一格画得对。 */
  const LAMP = { attachmentId: 'att-lamp', name: '灯位.png', bytes: 2048, mediaType: 'image/png' }

  function ruleTask(): TaskRecord {
    const at = 1_700_000_000_000
    const base = createTask({ title: '画廊第二版', description: '', prompt: '把画廊的第二版做出来' }, at, 'task-1')
    return withSessionRules(base, [{
      id: 'rule-1', sessionId: 's-1', instruction: '看一眼这面墙，然后告诉我灯该换哪种',
      trigger: 'cron', cron: '0 9 * * *', send: 'queue', enabled: true, nextAt: at + 3_600_000,
      attachments: [LAMP],
    }])
  }

  /** 这一面只用到这几样；少哪一个，渲染会自己抛，而不是安静地少画一点。 */
  function ruleFace(): BoardController {
    return {
      sessionLabelsOf: () => [{ sessionId: 's-1', title: '画廊那条对话' }],
      /* `presetStore` 是**排期预设**那个 store，它的 `load()` 回的是**表**（不是
         `{ presets }` 那个对象——运行配置预设的 store 才是那样）。假面给错形状，
         渲染时抛的是 `custom.map is not a function`，看起来像组件坏了。 */
      presetStore: () => ({ load: () => [], save: () => undefined, clear: () => undefined }),
      sessionAvailability: () => ({ kind: 'available' }),
      attachmentsAvailable: () => false,
      admitAttachment: async () => ({ ok: false as const, error: 'no-store' }),
      /* 指令那个框里的 `/` 菜单要读它（`PromptInput` 一挂载就读）。**没有运行目录是
         一个答案**（部署没接那个目录时真实 controller 回的正是 undefined），所以这一档
         是「这一台没有斜杠菜单」，不是「假面少画一点」。 */
      runCatalog: () => undefined,
      toggleSessionRule: () => undefined,
      deleteSessionRule: () => true,
    } as unknown as BoardController
  }

  /** 一份计划：标题、清单、任务勾选与表格各一个，好一眼看出渲染器有没有干活。 */
  function planQuestion(): WireQuestion {
    return {
      rpcId: 'rpc-plan-1',
      sessionId: 's-1',
      isPlanReview: true,
      questions: [{
        id: 'plan',
        question: '这份计划可以开工吗？',
        intent: { kind: 'plan-review', approve: '确认' },
        detail: [
          '## 计划：换掉东墙的灯',
          '',
          '- [x] 先看现场',
          '- 换灯',
          '  1. 断电',
          '  2. 上灯',
          '',
          '| 谁 | 什么时候 |',
          '| :-- | --: |',
          '| 我 | 明天 |',
        ].join('\n'),
      }],
    }
  }

  it('writes the page when DSH_BOARD_SHOT names one, and it carries what it must', async () => {
    const target = process.env.DSH_PANEL_HTML
    const asked = process.env.DSH_BOARD_SHOT
    if (target === undefined || target === '' || asked === undefined || asked === '') return
    const host = document.createElement('div')
    document.body.appendChild(host)
    let markup = ''
    const must: string[] = []
    try {
      if (asked === 'plan-card') {
        markup = renderToStaticMarkup(createElement(InteractionCard, {
          question: planQuestion(),
          shellWaiting: undefined,
          sessionId: 's-1',
          controller: { questionAnswerInPlace: false, openSession: () => undefined } as never,
        } as never))
        /* **这一张图要能证明渲染器真的渲染了。** 计划正文此前是 `<span>` 里的裸文本，所以这里
           读的是**元素**：标题、清单、编号清单、表格各自到位，记号本身不再出现在屏上。 */
        must.push('换掉东墙的灯', '先看现场', '断电')
        for (const element of ['<h3', '<ul', '<ol', '<table']) {
          expect(markup, `计划正文里没有 ${element}——它又被当成纯文本画了`).toContain(element)
        }
        expect(markup, '任务勾选的记号被原样打印出来了').not.toContain('[x]')
        expect(markup, '标题的记号被原样打印出来了').not.toContain('##')
      } else if (asked === 'rule-form') {
        const root = createRoot(host)
        await act(async () => {
          root.render(createElement(SessionRulesSection, { controller: ruleFace(), task: ruleTask() } as never))
        })
        // 表单要点一下才开（`formKey` 是这一节自己的状态），点的是那一行的「编辑」。
        const edit = [...host.querySelectorAll('button')].find(node => (node.textContent ?? '').trim() === t('auto.rule.edit'))
        if (edit === undefined) throw new Error('规则那一行上没有「编辑」——这一张图拍不到表单')
        await act(async () => { edit.click() })
        /* **jsdom 量不出高度，于是它会写下一个零。** 那个自增高的文本域（`PromptInput`）
           在自己的 effect 里读 `scrollHeight` 来定高，而 jsdom 的 `scrollHeight` 永远是 0
           ——截下来的那一行是 `style="height: 0px"`，图上就是一道被切掉一半的扁带。那是
           **仪器的边界，不是版面的样子**：这一页没有布局，所以这个框的高度只能由它自己声明的
           `rows` 给。把那个零去掉，工件画的才是读者会看到的那三行——留着一个只有 jsdom 造得出
           的零，读图的人会以为这个表单坏了。 */
        markup = host.innerHTML.replace(/style="height: 0px; overflow-y: hidden;"/g, '')
        must.push('灯位.png', '看一眼这面墙', '含 1 张图片')
        root.unmount()
      } else {
        throw new Error(`DSH_BOARD_SHOT=${asked} names nothing this file can draw (rule-form | plan-card)`)
      }
      const aligned = alignClassNames(markup, panelCss())
      writeStandalonePage(target, aligned.html, aligned.css, 'light', 'board shot')
      for (const needle of must) {
        expect(markup, `工件里少了「${needle}」——那张图不能用来下结论`).toContain(needle)
      }
      expect(existsSync(target)).toBe(true)
    } finally {
      document.body.removeChild(host)
    }
  })
})
