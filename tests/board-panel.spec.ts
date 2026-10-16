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
import { createTask, newCommentRound, settleExecution, startExecution } from '../src/core/tasks.ts'
import { withSessionRules } from '../src/core/automation.ts'
import { InteractionCard } from '../src/client/board/InteractionCard.tsx'
import { settledChipLabel } from '../src/client/board/TaskCard.tsx'
import { resultChipKind } from '../src/client/board/session-chip.ts'
import { PRIORITY_LABEL } from '../src/client/item/labels.ts'
import { SessionRulesSection } from '../src/client/board/automation-ui.tsx'
import { AttachmentStrip, formatBytes } from '../src/client/board/AttachmentStrip.tsx'
import type { DraftAttachment } from '../src/client/board/composer-attachments.ts'
import type { WireQuestion } from '../src/core/question-rpc.ts'
import { alignClassNames, panelCss, railWrap, writeStandalonePage } from './panel-harness.ts'
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

/**
 * Every board this file has mounted and not yet torn down.
 *
 * A test that fails throws before its own `unmount()`, and the tree it left
 * behind puts a second board on the NEXT test's screen — which is how one real
 * failure reads as five and hides which one was real. Cleanup belongs to the
 * harness, not to the last line of every test.
 */
const liveMounts: Array<() => void> = []

afterEach(() => {
  for (const unmount of liveMounts.splice(0)) unmount()
})

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
  const unmount = (): void => {
    // Idempotent: a test may tear down early, and this registry tears down again.
    if (!host.isConnected) return
    act(() => { root.unmount() })
    host.remove()
  }
  liveMounts.push(unmount)
  return { host, unmount }
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
   * 工件里的五张卡：**卡片那一行芯片画得出的三种主芯片各一张，外加两张对照卡**。
   *
   * 为什么后三张是必需的。只画两张**没有任何主芯片**的卡，卡片上那一行芯片就一枚也不会出现
   * ——而读者报的正是这一行。「待你决断」「评论排队」这些词不是卡片自己
   * 算的：主芯片来自 `cardViewModelOf.primary`，它读的是**这张卡自己那几轮工作**（开着的轮 /
   * 排队中的评论 / 结算过的工作）加上**读时钟**。所以后三张卡全部走 core 的真构造器与真语义：
   * `startExecution` 开一轮、`settleExecution` 结算（成功一律落回「审核」），评论走
   * `newCommentRound`。手写的对象只会随字段增加静默变成一个「看起来很像真卡的东西」
   * （硬性规范 18）——`NewTaskInput` 里的 `description` 是必填，少写一个字段不报错，只在
   * 运行时抛 `trim of undefined`。
   *
   * 三张结算卡之间只差一件事——**看没看过**（读状态），而它们三个说的也正是三句不同的话：
   * 没人看过 →「待你决断」；看过、还没裁决 →「1 次执行」（成功底色）；看过的卡上再追一条评论
   * 在排队 →「评论排队 1」。一屏看全，才能一眼看出这不是同一句话说了三遍。
   */
  function boardFixture(): TaskRecord[] {
    const at = 1_700_000_000_000
    /** 跑完一轮的卡：开一轮、把会话补上（真流程里由创建过程回填）、结算成功。 */
    const ran = (id: string, title: string, sessionId: string): TaskRecord => {
      const opened = startExecution(
        createTask({ title, description: '', prompt: '跑一遍，把结果留在卡上', status: 'todo' }, at, id),
        at + 2_000,
        `run-${id}`,
      )
      const withSession: TaskRecord = {
        ...opened.task,
        executions: opened.task.executions.map(round => ({ ...round, sessionId })),
      }
      return settleExecution(withSession, `run-${id}`, 'succeeded', at + 3_000, undefined)
    }
    /**
     * 「这一轮已经看过了」：控制器写的就是这一对戳记——任务自己的 `viewedAt` 加上每条轮次的
     * `viewedAt`（`markTaskViewed` / `markAllViewed`）。读时钟只朝前走，所以传进来的时刻必须
     * 在结算之后，否则卡上会多出一枚「新」。
     */
    const lookedAt = (task: TaskRecord, when: number): TaskRecord => ({
      ...task,
      viewedAt: Math.max(task.viewedAt ?? 0, when),
      executions: task.executions.map(round => ({ ...round, viewedAt: when })),
    })
    const queuedBase = lookedAt(ran('task-queued', '跑完了、看过了，又追了一条评论在排队', 'sess-queue'), at + 4_000)
    return [
      createTask({ title: '画廊第二版', description: '', prompt: '把画廊的第二版做出来', status: 'todo' }, at, 'task-1'),
      createTask({ title: '光卡：没有挂任何清单条目', description: '', prompt: '随便什么', status: 'backlog' }, at, 'task-2'),
      /* 「待你决断」：跑完了，谁也还没看过。它同时还会带一枚「新 1」——两枚读的是同一个读时钟，
         所以这一档必然一起出现，不是多画了一枚。 */
      ran('task-review', '跑完了，还没人看过', 'sess-review'),
      /* 「1 次执行」（成功底色）：同一轮工作，只是已经看过、还没裁决。 */
      lookedAt(ran('task-settled', '跑完了，也看过了，就等你裁决', 'sess-settled'), at + 4_000),
      /* 「评论排队 1」：看过的结算卡上再追一条评论——排队中的评论压过「裁决」那一枚
         （`cardViewModelOf` 只有一条链，一张卡只有一个主芯片）。 */
      lookedAt({
        ...queuedBase,
        executions: [...queuedBase.executions, newCommentRound({
          id: 'comment-queued',
          now: at + 5_000,
          text: '把东墙那盏灯换成轨道灯，再拍一张',
          sessionId: 'sess-queue',
          parentExecutionId: 'run-task-queued',
        })],
      }, at + 5_000),
    ]
  }

  function writeBoardArtifact(target: string, mountedOf?: (cardId: string) => { readonly count: number; readonly loudest?: 'low' | 'normal' | 'high' | 'urgent' } | undefined, scheme: 'light' | 'dark' = process.env.DSH_PANEL_DARK === '1' ? 'dark' : 'light'): string {
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
    /* 第一张卡上那枚清单条目读数（「挂 3 条 · 最急：紧急」）：这件事实只在这里写一次，
       下面那条名单里的一项是它自己长出来的（硬性规范 17）。 */
    const mounted = { count: 3, loudest: 'urgent' } as const
    const markup = writeBoardArtifact(target, cardId => (cardId === 'task-1' ? mounted : undefined))
    /* **工件要能证明自己画对了。** 这台假 controller 若少一个成员（真发生过：卡片的圆点读
       `sessionsOf`，而它没有），渲染要么直接抛、要么**安静地少画一点**——后者最危险：截出来
       是一张看起来很好、实际缺东西的图，而读图的人会照它下结论。所以这里断言它画出了该画的
       那几样，任何一个没了就红。
       芯片那一行的词一律**从定义处取**，不在这里抄第二遍：那张卡的清单条目读数由夹具自己
       算出来，另外三枚主芯片分别是待你决断（结算完、没人看过）、`settledChipLabel`（结算完、
       看过了还没裁决）、评论排队（同一张卡上又追了一条）。 */
    for (const must of [
      '画廊第二版',
      '光卡：没有挂任何清单条目',
      t('card.mountedRows', { n: String(mounted.count), tier: t(PRIORITY_LABEL[mounted.loudest]) }),
      t('card.awaitingDecision'),
      settledChipLabel(1),
      t('card.commentQueue'),
      '规划',
      '待办',
      '进行',
      '审核',
      '完成',
    ]) {
      expect(markup, `工件里少了「${must}」——那张图不能用来下结论`).toContain(must)
    }
    /* 结算成功那一枚的**词**是「N 次执行」（`board.runs`），它的**成功**在底色上——底色由
       `resultChipKind` 那一个映射给，所以这里钉的是那个映射的结果，不是一个写死的色名。 */
    expect(markup, '结算成功的那一枚芯片没有成功的底色').toContain(`data-kind="${resultChipKind('succeeded')}"`)
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

  /** One host view: an npm install inside a profile the reader started themselves. */
  function viewOf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      packageName: '@firetruck666/dsh-task-board',
      version: '0.8.26',
      spec: '^0.8.26',
      mode: 'npm',
      profile: 'web',
      dir: 'C:/Users/u/.dsh/profiles/web',
      appManaged: false,
      evidence: { linked: false, declared: true, disagreement: false },
      githubSpec: 'github:FiretrUCK666/dsh-task-board',
      // The newest upstream travels IN this view: only the host knows which
      // registry (or mirror, or proxy) this installation uses.
      latest: {
        version: '0.9.60',
        publishedAt: '2026-10-12T00:00:00.000Z',
        registry: 'https://registry.npmjs.org/',
        source: 'registry',
      },
      plan: {
        mode: 'npm',
        packageName: '@firetruck666/dsh-task-board',
        profile: 'web',
        appManaged: false,
        packageSpec: '@firetruck666/dsh-task-board@latest',
        apply: 'package',
        reinstall: true,
        steps: [{
          command: 'dsh',
          args: ['plugin', '--profile', 'web', 'add', '@firetruck666/dsh-task-board@latest'],
        }],
      },
      ...overrides,
    }
  }

  /**
   * The same install inside the desktop application's own profile. The app owns
   * that profile, so the host reports no terminal command at all — the two
   * fields move together, and a fixture that carried both would pin a state
   * production cannot reach.
   */
  function appManagedView(): Record<string, unknown> {
    return viewOf({
      profile: 'desktop',
      dir: 'C:/Users/u/.dsh/profiles/desktop',
      appManaged: true,
      plan: {
        mode: 'npm',
        packageName: '@firetruck666/dsh-task-board',
        profile: 'desktop',
        appManaged: true,
        packageSpec: '@firetruck666/dsh-task-board@latest',
        apply: 'package',
        reinstall: true,
        steps: [],
      },
    })
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

  it('names the copy that is running, its location, and the registry it asked', async () => {
    stubUpdateFetch({ view: () => viewOf() })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    const dialog = dialogIn(host)
    expect(dialog.textContent).toContain(t('board.update.mode.npm'))
    expect(dialog.textContent, '对话框没有说这份安装属于哪个 profile').toContain('web')
    expect(dialog.textContent).toContain('0.8.26')
    expect(dialog.textContent, '对话框没有说这份安装在哪').toContain('C:/Users/u/.dsh/profiles/web')
    expect(dialog.textContent).toContain(t('board.update.newVersion', { v: '0.9.60' }))
    expect(dialog.textContent, '对话框没有说问的是哪个源').toContain('https://registry.npmjs.org/')
    // The equivalent terminal line names THIS profile, not a profile written into the bundle.
    expect(dialog.textContent).toContain('dsh plugin --profile web add')
    expect(dialog.textContent).toContain(t('board.update.apply'))
    unmount()
  })

  it('draws the command as whole words, so a hyphen never splits a name', async () => {
    // The command is a line the reader retypes. Default line breaking also
    // breaks AFTER a hyphen, so a scoped package name came out as
    // `@firetruck666/dsh-task-` / `board@latest` whenever the line ended there —
    // two words, in a string that must be typed exactly. jsdom has no line
    // breaking, so what is pinned is the structure the browser needs: one
    // element per word, and a rule that keeps each word whole.
    stubUpdateFetch({ view: () => viewOf() })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    const dialog = dialogIn(host)
    const words = [...(dialog.querySelector('code')?.querySelectorAll('span') ?? [])]
      .map(one => one.textContent)
    expect(words).toEqual([
      'dsh', 'plugin', '--profile', 'web', 'add', '@firetruck666/dsh-task-board@latest',
    ])
    const aligned = alignClassNames(dialog.innerHTML, panelCss())
    const wordClass = /<code><span class="([^"]+)"/.exec(aligned.html)?.[1]
    expect(wordClass, '命令的词没有自己的类，无从保证不被拆开').toBeDefined()
    expect(aligned.css).toMatch(new RegExp(`\\.${String(wordClass)}\\s*\\{[^}]*white-space:\\s*nowrap`))
    unmount()
  })

  it('cannot read the latest version without saying so, and never says "up to date"', async () => {
    // The three-state verdict, driven through the screen: a host that could not
    // reach its registry must not arrive as a conclusion.
    stubUpdateFetch({ view: () => viewOf({ latest: undefined }) })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    const dialog = dialogIn(host)
    expect(dialog.textContent).toContain(t('board.update.noLatest'))
    expect(dialog.textContent).not.toContain(t('board.update.newVersion', { v: '0.9.60' }))
    // 不能是死路：命令仍然在。
    expect(dialog.textContent).toContain('dsh plugin --profile web add')
    unmount()
  })

  it('a packaged application is given no command, and is pointed at the app instead', async () => {
    // The CLI has two shims and only the application's own accepts this profile
    // name: the npm-installed one errors with "profile \"desktop\" is managed
    // exclusively by the Electron application". Which one a reader has is not
    // something this page can see, so it names the route that always works
    // instead of a line that works for one of them.
    stubUpdateFetch({ view: () => appManagedView() })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    const dialog = dialogIn(host)
    expect(dialog.textContent).toContain(t('board.update.appManaged'))
    expect(dialog.textContent, '桌面端不该给出一条终端命令').not.toContain('dsh plugin --profile')
    // 一键更新仍然在：那条路走的是 host 自己的安装服务，不经过任何命令行。
    expect(dialog.textContent).toContain(t('board.update.apply'))
    unmount()
  })

  it('a host that can name no profile invents no command, and still offers the button', async () => {
    // The two ways of having no command are different and must stay different:
    // here nothing owns the profile and the profile simply could not be named,
    // so the reader gets no line to type — and the button, which never needed a
    // profile name, is still there.
    const plan = { ...viewOf().plan as object, profile: undefined, steps: [] }
    stubUpdateFetch({ view: () => viewOf({ profile: undefined, plan }) })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    const dialog = dialogIn(host)
    expect(dialog.textContent).not.toContain('dsh plugin --profile')
    expect(dialog.textContent).not.toContain(t('board.update.appManaged'))
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

  it('a run that changed nothing says so, and keeps the button (it is not a success)', async () => {
    stubUpdateFetch({
      view: () => viewOf(),
      apply: { ok: true, outcome: 'unchanged', version: '0.8.26' },
    })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    await clickLabel(host, t('board.update.apply'))
    const dialog = dialogIn(host)
    expect(dialog.textContent).toContain(t('board.update.unchanged', { v: '0.8.26' }))
    // 「已更新到 v」正是读者无法核对、却会照着它行动的那句话：它一个字都不许出现。
    expect(dialog.textContent).not.toContain(t('board.update.restartRequired', { v: '0.8.26' }))
    expect(dialog.textContent).not.toContain(t('board.update.applied', { v: '0.8.26' }))
    // 跑完没变化，按钮要留着：保护期过了、或换个装法之后，同一按还有意义。
    expect(dialog.textContent).toContain(t('board.update.apply'))
    unmount()
  })

  it('the dialog states what the profile declares — the answer to "why not the new one"', async () => {
    stubUpdateFetch({ view: () => viewOf() })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    expect(dialogIn(host).textContent).toContain(t('board.update.spec', { spec: '^0.8.26' }))
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
    expect(dialog.textContent).toContain('dsh plugin --profile web add')
    unmount()
  })

  it('writes the dialog page when DSH_PANEL_HTML names a path', async () => {
    const target = process.env.DSH_PANEL_HTML
    if (target === undefined || target === '') return
    /* 每一张工件都要能证明自己画对了什么，而两张证明的东西不同：第一张是失败态（这个
       对话框里元素最多的一档：结果行 + 原因 + 输出块 + 命令 + 重启说明），第二张是应用
       托管 profile 那一档，它证明的是**有没有那条命令**。缺任何一样，读图的人会照一张
       「看起来很好、其实少了东西」的图下结论，所以两张各查各的清单。 */
    stubUpdateFetch({
      view: () => viewOf(),
      apply: { ok: false, error: 'failed', output: 'ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/@firetruck666/dsh-task-board: Not Found' },
    })
    const { host, unmount } = await mountBoard({})
    await clickLabel(host, t('board.update.check'))
    await clickLabel(host, t('board.update.apply'))
    /* 读的是屏上的字，不是标记：工件是给人看的图，一段只活在属性里、读者看不到的文本
       不该让这张图算数（而命令现在由多个词元素拼成，源码里本来就没有那一整串）。 */
    for (const must of [
      t('board.update.title'),
      t('board.update.mode.npm'),
      t('board.update.applyFailed'),
      'ERR_PNPM_FETCH_404',
      'dsh plugin --profile web add',
    ]) {
      expect(host.textContent, `工件里少了「${must}」——那张图不能用来下结论`).toContain(must)
    }
    const aligned = alignClassNames(host.innerHTML, panelCss())
    writeStandalonePage(target, aligned.html, aligned.css, process.env.DSH_PANEL_DARK === '1' ? 'dark' : 'light', 'update dialog')
    /* 第二张：换的是 host 的答复，不是再挂一块板——两块板会让第二块落到 viewport 之外，
       截出来只有第一块（第一版就是这么错的）。此时按钮上写的是刚才那个结论，点它等于
       再查一次（面板自己的规矩），这就是同一块板换一份答复的路。 */
    stubUpdateFetch({ view: () => appManagedView() })
    await clickLabel(host, t('board.update.available', { v: '0.9.60' }))
    for (const must of [t('board.update.appManaged'), t('board.update.apply')]) {
      expect(host.textContent, `第二张工件里少了「${must}」——那张图不能用来下结论`).toContain(must)
    }
    expect(host.textContent, '应用托管的那一档不该有终端命令').not.toContain('dsh plugin --profile')
    const managedAligned = alignClassNames(host.innerHTML, panelCss())
    writeStandalonePage(
      target.replace(/\.html?$/i, '.app-managed.html'),
      managedAligned.html,
      managedAligned.css,
      process.env.DSH_PANEL_DARK === '1' ? 'dark' : 'light',
      'update dialog, application-managed profile',
    )
    /* 第三张：跑完版本没动的那一档——按下更新、什么都没变。它是这套文案里最容易说错的
       一处：安装服务报的是"包管理器做成了什么"，而"装最新版"解析到已经装着的那个版本时
       它成功退出、什么也没做（真机上就是安装器的供应链保护期把刚发布的那一版挡在解析
       之外）。那张图必须写着"没有变化"，一个字的"已更新到"都不能有。 */
    stubUpdateFetch({
      view: () => viewOf(),
      apply: { ok: true, outcome: 'unchanged', version: '0.8.26' },
    })
    await clickLabel(host, t('board.update.available', { v: '0.9.60' }))
    await clickLabel(host, t('board.update.apply'))
    for (const must of [
      t('board.update.unchanged', { v: '0.8.26' }),
      t('board.update.spec', { spec: '^0.8.26' }),
      t('board.update.apply'),
    ]) {
      expect(host.textContent, `第三张工件里少了「${must}」——那张图不能用来下结论`).toContain(must)
    }
    expect(
      host.textContent,
      '一次没有变化的更新被说成了"已更新到"——那正是读者无法核对、却会照着它行动的那句话',
    ).not.toContain(t('board.update.restartRequired', { v: '0.8.26' }))
    const unchangedAligned = alignClassNames(host.innerHTML, panelCss())
    writeStandalonePage(
      target.replace(/\.html?$/i, '.unchanged.html'),
      unchangedAligned.html,
      unchangedAligned.css,
      process.env.DSH_PANEL_DARK === '1' ? 'dark' : 'light',
      'update dialog, nothing changed',
    )
    unmount()
  })
})

/**
 * 看板的另外几处界面：会话规则表单（那条自填指令带的附件）、只读那张计划卡，以及
 * **附件条自己在它两个宿主里的样子**（`attach-strip`）。
 *
 * ── 为什么需要第二台工件 ──────────────────────────────────────────────────────
 *
 * `writeBoardArtifact` 画的是**看板舞台**（列与卡片），而这几处住在看板的另一半：一个在任务
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
describe('看板的另外几处界面（规则表单的附件条 / 只读计划卡 / 附件条的两个宿主）', () => {
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

  /** 一份计划：标题、清单、任务勾选与表格各一个，好一眼看出渲染器有没有干活。
   *  两个选项与它们的说明照宿主真实的计划题给——`dsh-plan-mode` 写的就是
   *  Approve / Keep planning 这一对，说明由提问方自己写。 */
  function planQuestion(): WireQuestion {
    return {
      rpcId: 'rpc-plan-1',
      sessionId: 's-1',
      isPlanReview: true,
      questions: [{
        id: 'plan',
        question: '这份计划可以开工吗？',
        intent: { kind: 'plan-review', approve: '确认' },
        options: [
          { label: '确认', description: '离开计划模式，从下一步开始照着它做' },
          { label: '再改改', description: '不批准：改完再拿回来' },
        ],
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

  /** 同一份计划，只是提问方**没有给第二个选项**——官方 `PlanReview.decline`
   *  对这种情况就是缺席，于是可作答的那张卡只有两行。 */
  function planOnlyApprove(): WireQuestion {
    const question = planQuestion()
    return {
      ...question,
      questions: [{ ...question.questions[0]!, options: [question.questions[0]!.options![0]!] }],
    }
  }

  /**
   * 一道**普通的问题**（不是计划）——`/question` 那一支，也就是用户报「评论区里直接截断」
   * 的那张卡。两道题装在一个批次里（原生就是一次问多题、一次答完），第一道带说明与四个
   * 带描述的选项，于是卡的正文**真的比它的窗口高**——那正是被截断的那个状态。
   */
  function askQuestion(): WireQuestion {
    return {
      rpcId: 'rpc-ask-1',
      sessionId: 's-1',
      isPlanReview: false,
      questions: [
        {
          id: 'lamp',
          header: '选型',
          question: '东墙那盏灯用哪一种？',
          detail: '现场量到的层高是 2.7 米，原来的灯座留在原位不动。',
          options: [
            { label: '轨道灯', description: '想挪就挪，但天花板要加一条轨道' },
            { label: '吸顶灯', description: '不动天花板，改动最小' },
            { label: '吊灯', description: '最好看，但要重新拉线' },
            { label: '先不换', description: '把这一次留到装修一起做' },
          ],
        },
        {
          id: 'who',
          header: '验收',
          question: '装完谁来验收？',
          options: [
            { label: '我自己看' },
            { label: '叫上房东' },
          ],
        },
      ],
    }
  }

  /** 同一批问题，只是这台机器的宿主不让就地作答——只读那张卡。 */
  function mirrorQuestion(): WireQuestion {
    return { ...askQuestion(), isPlanReview: false }
  }

  /* ── 附件条自己的那一页（`DSH_BOARD_SHOT=attach-strip`）─────────────────────
   *
   * WHY IT EXISTS. 这条附件条是五处界面共用的元件（看板那张纸的执行 Prompt、复核页的
   * 留言框、规则那条自填指令、清单展开区的正文、新建那条纸）。既有的工件页里，四张常拍的
   * （`tb-items` / `tb-board` / `tb-ask` / `tb-plan-live`）元素数是 **0**：规则在样式表里，
   * DOM 不在任何一张图上（数过：`attachStrip` / `attachRow` / `attachAdd` / `attachChip` /
   * `attachHint` 各 0）。另有两条路径**顺带**画得到它——`DSH_PANEL_MOUNT=prompt-form`
   * （看板那张纸的 Prompt 那一格）与清单页开着一行时——但那是别人页面上的配角，于是有两档
   * 一直没有图：**空账本那一档**（就是用户截的那一格：只有一颗圆形的「＋」），以及**看板留言框
   * 那个宿主**（`.reviewComposer`）。
   *
   * WHAT IT DRAWS. 一个宿主一条**真实的祖先链**，链上每一层都是产品自己的类名，所以
   * **宽度是算出来的，不是写死的**（这一页里没有一处 `width`）：
   *
   *   · 看板留言框：`.review → .reviewBody → .reviewRail`，留言框是那条轨的第二个孩子
   *     （`.sessionRailFolds` 是它的兄弟，不是它的父级）。板盒是
   *     `min(880px,100%)`，`.reviewRail` 是 `min(344px, 46cqw)`——1440 下量到 344，
   *     于是留言框的内容盒是 316，而两枚芯片（各到 180 的上限）真的比它宽，横滚是真的；
   *     412 下 `.review` 落进 `@container dsh-tb-panel` 的窄档，这份留言框整幅铺开（量到 396）。
   *   · 清单展开区：`.itemPanelStage → .itemRoot → .itemWorkbench → .itemListColumn →
   *     .itemFlow → .itemTable → .itemTableBody → .itemRow → .itemDetail → .itemOpen →
   *     .itemOpenMain → .itemOpenText → .itemOpenSection → .itemBodyField → .itemAttachRow`
   *     ——**层数与顺序逐条照真实的 DOM**（对着真实清单页里那条链核对过）。`.itemRoot` 是
   *     几何令牌与具名容器的声明处（少了它，这一档的样子不是清单的样子），行形状由
   *     `.itemListColumn` 那个 `dsh-tb-item-list` 给——窄档一条线、宽档一张表。宽档量到
   *     `.itemAttachRow` 在 x=341 / 736 宽，与真实清单页里同一个盒子量到的数**一模一样**。
   *
   * 两种账本各画两遍（空档 = 用户截图里的那一档；两枚芯片 = 长名字用省略号收尾、
   * 文件带字节读数），所以「宿主有没有影响这一条」与「账本有没有影响这一条」是两个
   * 看得出来的方向。
   *
   * NOT PROVEN HERE. 窄屏真正的版面判定（`useSurfaceNarrow` 那次测量）不在图上：静态
   * 渲染没有布局。这一页给的是 `@container` 那一半。**触屏那一档要另外拍**——两条滚动条
   * 只在 `(hover: none) and (pointer: coarse)` 里出现（触屏那一段给 `.attachAdd` /
   * `.attachRemove` 加了一圈 `inset: -7px` 的命中环，那圈环超出 `overflow-x: auto`
   * 的那一行时，两个轴一起成为可滚动区），所以那张图要用
   * `--touch --scrollbars` 拍，否则它看不见这两条。
   */

  /**
   * 两枚附件：一个长到只能用省略号收尾的名字，和一个带字节读数的文件。
   *
   * 名字与字节都**不写第二遍**：产物里要出现的字面量由这两个字段自己长出来
   * （`formatBytes` 是元件导出的那一个），所以改一处不会让这一页的判据变成谎话。
   */
  const stripChips: readonly DraftAttachment[] = [
    {
      id: 'att-east-wall:0',
      attachmentId: 'att-east-wall',
      name: '东墙灯位实测-下午补光后-第二次补拍.png',
      bytes: 2_411_724,
      mediaType: 'image/png',
      width: 1600,
      height: 1200,
    },
    { id: 'att-socket-note:1', attachmentId: 'att-socket-note', name: '灯座型号与层高记录.txt', bytes: 4096 },
  ]

  /**
   * 把几层壳套在一段内芯外面，**开合由同一个数组给**。
   *
   * 这一页的宿主链是手写标签串出来的，而少写一个 `</div>` 的症状是**DOM 长在错的父亲下面**：
   * 它不报错、不抛，量出来只是「这一格怎么这么窄」——两个清单例子叠在一起时，第二个的附件条
   * 量到 154px 宽、y=1392（视口只有 1100），而元素计数一切正常。层数与它的开合因此只能有
   * 一个出处。
   */
  function wrap(tags: readonly string[], inner: string): string {
    return tags.reduceRight((acc, tag) => `<${tag}>${acc}</div>`, inner)
  }

  /** 一条附件条，按两处真实调用点的形状接线（留言框不给 hint，展开区给）。 */
  function stripIn(attachments: readonly DraftAttachment[], hint?: string): string {
    return renderToStaticMarkup(createElement(AttachmentStrip, {
      attachments,
      onAdd: () => undefined,
      onRemove: () => undefined,
      ...hint === undefined ? {} : { hint },
    }))
  }

  /** 看板留言框那条真实的祖先链。链上不留别的行：它们不碰这一条的宽。 */
  function composerHost(strip: string): string {
    const rail = wrap(['div class="reviewRail"'], [
      '<div class="sessionRailFolds"></div>',
      wrap(['div class="reviewComposer"'], '<textarea class="input promptTextarea" rows="3" readonly></textarea>' + strip),
    ].join(''))
    return wrap(['div class="review"'], [
      '<div class="reviewHeader">画廊第二版</div>',
      wrap(['div class="reviewBody"'], '<div class="reviewMain"></div>' + rail),
    ].join(''))
  }

  /** 清单展开区那条真实的祖先链，到 `.itemAttachRow` 为止——层数与顺序逐条照真实的 DOM，
   *  `.itemTable` / `.itemTableBody` 也在内（它们夹在行与滚动体之间，漏掉它们，这一页与
   *  产品的差别就只差一次「某天有人给那张表加一条宽度的规则」）。
   *  正文那个写入框不画：它与附件条同宽，画上它只是让这一页更长。 */
  function itemHost(strip: string): string {
    const section = wrap(['div class="itemOpenSection"'], [
      `<p class="itemOpenCaption">${t('item.field.body')}</p>`,
      wrap(['div class="itemBodyField"'], `<div class="itemAttachRow">${strip}</div>`),
    ].join(''))
    return wrap([
      'div class="itemPanelStage"',
      'div class="itemRoot"',
      'div class="itemWorkbench"',
      'div class="itemListColumn"',
      'div class="itemFlow"',
      'div class="itemTable"',
      'div class="itemTableBody"',
      'div class="itemRow" data-open=""',
      'div class="itemDetail"',
      'div class="itemOpen"',
      'div class="itemOpenMain"',
      'div class="itemOpenText"',
    ], section)
  }

  /**
   * 清单那两例各裹一层**没有类名**的盒子。
   *
   * 它管的是高度，不是宽度。面板根是 `block-size: 100%`（`.itemPanelStage` 与 `.itemRoot`
   * 各一次）——面板的身高就是宿主给它的盒子，这在真实页面里是对的（面板占满舞台）；而这一页
   * 里那条百分比会一路量到 `.panelStage`（= 整个窗口），于是第一例吃掉一屏、第二例落到折线
   * 以下，永远看不见（量到过：第二个例子的附件条在 y=1392，而视口只有 1100）。一层自动高度的
   * 普通盒子让那条百分比退回 `auto`，面板按内容定高；而这一条的宽度与行的形状都由**宽度**
   * 决定，一个像素都不因此改变（改前改后各量一次：`.itemAttachRow` 都是 x=341 / 736 宽——
   * 与真实清单页里同一个盒子量到的一样）。
   */
  function itemCase(strip: string): string {
    return `<div>${itemHost(strip)}</div>`
  }

  /** 每一例上面那一行说明。它是仪器的话，穿的是产品那件安静的字衣（`.detailHint`），
   *  所以这一页不必再自带一份样式表——第二份样式表是同一个问题的第二个答案。 */
  function caseCaption(text: string): string {
    return `<p class="detailHint">${text}</p>`
  }

  /** 这一页：两种账本 × 两个宿主，四例，一屏之内。 */
  function attachStripPage(): string {
    return [
      caseCaption('看板留言框（.reviewComposer）· 还没有附件：就是用户截图里的那一档'),
      composerHost(stripIn([])),
      caseCaption('看板留言框 · 两枚附件：长名字用省略号收尾，文件带字节读数'),
      composerHost(stripIn(stripChips)),
      caseCaption('清单展开区（.itemAttachRow）· 还没有附件'),
      itemCase(stripIn([], t('item.attach.hint'))),
      caseCaption('清单展开区 · 同一对附件'),
      itemCase(stripIn(stripChips, t('item.attach.hint'))),
    ].join('\n')
  }

  it('writes the page when DSH_BOARD_SHOT names one, and it carries what it must', async () => {
    const target = process.env.DSH_PANEL_HTML
    const asked = process.env.DSH_BOARD_SHOT
    if (target === undefined || target === '' || asked === undefined || asked === '') return
    const host = document.createElement('div')
    document.body.appendChild(host)
    let markup = ''
    const must: string[] = []
    /* 交互卡那几张**一律装进真实祖先链**（见 `railWrap`）。画在顶层会让卡里那条
       `max-height: max(290px, min(320px, 100%))` 里的 `100%` 量到整个窗口——那正是
       「问题卡在窄档被评论框切掉下半张」能藏这么久的原因。规则表单不住在右栏，不套。 */
    const rail = asked.startsWith('plan-card') || asked.startsWith('question')
    try {
      if (asked === 'plan-card' || asked === 'plan-card-live' || asked === 'plan-card-single') {
        /* 三张：**只读那一支**（这台机器的宿主不提供就地作答：选项是引用行 + 那扇门）、
           **能就地答那一支**（三行真动作），以及**提问方没给第二个选项那一支**（两行：
           「拒绝」没有可发的标签，就不该画成一个按不动的行）。它们此前只有结构断言，
           而「一横一横还是胶囊」正是结构断言不了的那一半。 */
        const single = asked === 'plan-card-single'
        const answerable = asked !== 'plan-card'
        markup = renderToStaticMarkup(createElement(InteractionCard, {
          question: single ? planOnlyApprove() : planQuestion(),
          shellWaiting: undefined,
          sessionId: 's-1',
          controller: {
            questionAnswerableOf: () => answerable,
            openSession: () => undefined,
            answerQuestion: async () => true,
            cancelQuestion: async () => true,
          } as never,
        } as never))
        /* **这一张图要能证明渲染器真的渲染了。** 计划正文此前是 `<span>` 里的裸文本，所以这里
           读的是**元素**：标题、清单、编号清单、表格各自到位，记号本身不再出现在屏上。 */
        must.push('换掉东墙的灯', '先看现场', '断电')
        must.push(...answerable
          ? single
            ? [t('review.planConfirm'), t('review.interactionDiscuss')]
            : [t('review.planConfirm'), t('review.planDecline'), t('review.interactionDiscuss')]
          : [t('review.interactionOffered'), t('review.interactionReadOnlyWhy'), t('review.interactionGoAnswer')])
        if (single) {
          expect(markup, '没有可拒的选项，却画了「拒绝」那一行').not.toContain(t('review.planDecline'))
        }
        for (const element of ['<h3', '<ul', '<ol', '<table']) {
          expect(markup, `计划正文里没有 ${element}——它又被当成纯文本画了`).toContain(element)
        }
        expect(markup, '任务勾选的记号被原样打印出来了').not.toContain('[x]')
        expect(markup, '标题的记号被原样打印出来了').not.toContain('##')
      } else if (asked === 'question-card' || asked === 'question-mirror') {
        /* 普通的问题卡（`/question` 那一支）。**这一支此前一张图都没有**：工件只画了计划卡与
           规则表单，于是「问题卡被评论区切掉下半张」这件事没有任何仪器看得见——结构断言答不了
           「装它的盒子有多高」，而卡的整条高度契约恰恰只关于那个盒子。 */
        const answerable = asked === 'question-card'
        markup = renderToStaticMarkup(createElement(InteractionCard, {
          question: answerable ? askQuestion() : mirrorQuestion(),
          shellWaiting: undefined,
          sessionId: 's-1',
          controller: {
            questionAnswerableOf: () => answerable,
            openSession: () => undefined,
            answerQuestion: async () => true,
            cancelQuestion: async () => true,
          } as never,
        } as never))
        must.push('东墙那盏灯用哪一种？', '轨道灯', '不动天花板，改动最小')
        must.push(...answerable
          ? [t('review.interactionSkip'), t('review.interactionNext'), t('review.interactionProgress', { n: '1', total: '2' })]
          : [t('review.interactionOffered'), t('review.interactionGoAnswer')])
      } else if (asked === 'attach-strip') {
        markup = attachStripPage()
        /* **工件要能证明自己画对了。** 两条断言各管一件事：这一条是**住在真实宿主里**
           （两根链的父级取自两处调用点的实际父级，不是一条裸的 div），以及它自己那几个槽
           都在（那一颗圆形的「＋」、芯片的名字槽与字节槽、去掉它的那枚、以及展开区那句
           说明）。名字与字节**从夹具自己长出来**，不在这里抄第二遍。 */
        must.push(
          'class="reviewComposer"',
          'class="itemAttachRow"',
          'attachAdd',
          'attachChipName',
          'attachChipMeta',
          'attachRemove',
          'attachHint',
          ...stripChips.flatMap(chip => [chip.name, formatBytes(chip.bytes)]),
        )
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
        throw new Error(`DSH_BOARD_SHOT=${asked} names nothing this file can draw (rule-form | plan-card | plan-card-live | plan-card-single | question-card | question-mirror | attach-strip)`)
      }
      const aligned = alignClassNames(rail ? railWrap(markup) : markup, panelCss())
      writeStandalonePage(target, aligned.html, aligned.css, process.env.DSH_PANEL_DARK === '1' ? 'dark' : 'light', 'board shot')
      for (const needle of must) {
        expect(markup, `工件里少了「${needle}」——那张图不能用来下结论`).toContain(needle)
      }
      expect(existsSync(target)).toBe(true)
    } finally {
      document.body.removeChild(host)
    }
  })
})

/**
 * 交互卡的两支：**能就地答的那一支，每一行都是真按钮**（按一次真的把那一批答案送出去）；
 * **答不了的那一支，一个能按的东西都不许有**——它只引用会话给的选项，并说出为什么。
 *
 * 这一节钉的是用户报的那两件事：「approve / keep planning 点了没反应」，以及「排版从一横一横
 * 变成胶囊」。两个根因各有各的落点：判据按**会话**算（别的会话能答，不许把这条会话的卡也画成
 * 能答）由 `pending-mirror.spec.ts` 钉；这里钉的是卡本身——能答的时候它画什么、不能答的时候
 * 它画什么。
 */
describe('交互卡：能答就画成能按的，不能答就说清楚', () => {
  /** 一张只用到这几个成员的面：判据、两条结算路、那扇门。 */
  function face(canAnswer: boolean, answerQuestion = vi.fn(async () => true)): {
    controller: BoardController
    answerQuestion: typeof answerQuestion
    cancelQuestion: ReturnType<typeof vi.fn>
  } {
    const cancelQuestion = vi.fn(async () => true)
    return {
      controller: {
        questionAnswerableOf: () => canAnswer,
        answerQuestion,
        cancelQuestion,
        openSession: vi.fn(),
      } as unknown as BoardController,
      answerQuestion,
      cancelQuestion,
    }
  }

  /** 宿主真实的计划题：两个选项 + 提问方自己写的说明。**批准项故意排在第二位**——
   *  一眼就能看出答案读的是 `intent.approve`，还是「第一个选项」。 */
  function plan(): WireQuestion {
    return {
      rpcId: 'rpc-plan-1',
      sessionId: 's-1',
      isPlanReview: true,
      questions: [{
        id: 'plan',
        question: '这份计划可以开工吗？',
        intent: { kind: 'plan-review', approve: '确认' },
        options: [
          { label: '再改改', description: '不批准：改完再拿回来' },
          { label: '确认', description: '离开计划模式，从下一步开始照着它做' },
        ],
        detail: '## 计划：换掉东墙的灯',
      }],
    }
  }

  it('answers in place: every decision is a real row, and one click sends the verbatim label', async () => {
    const { controller, answerQuestion, cancelQuestion } = face(true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(createElement(InteractionCard, {
          question: plan(),
          shellWaiting: undefined,
          sessionId: 's-1',
          controller,
        } as never))
      })
      const rows = [...host.querySelectorAll('button')]
      expect(rows.length, '计划卡的动作不是三行按钮——读者按不到').toBe(3)
      expect(rows.map(row => row.textContent ?? '').join('|')).toContain(t('review.interactionDiscuss'))
      const approveRow = rows.find(row => (row.textContent ?? '').includes(t('review.planConfirm')))
      expect(approveRow, '没有「确认执行」那一行').toBeDefined()
      await act(async () => { approveRow?.click() })
      /* **载荷里是提问方自己那个标签**（逐字），不是我们的词：答案必须带原标签才算数，
         而屏上写的是我们的话——两件事各归各的，正是这张卡最容易接错的一根线。
         批准项排在第二位，所以这里同时钉住「标签来自 intent，不是第一个选项」。 */
      expect(answerQuestion).toHaveBeenCalledTimes(1)
      expect(answerQuestion).toHaveBeenCalledWith('rpc-plan-1', 's-1', [{ id: 'plan', selected: ['确认'] }])
      // 「拒绝」是提问方自己另一个选项的一次普通作答，同样是逐字原标签。
      const declineRow = rows.find(row => (row.textContent ?? '').includes(t('review.planDecline')))
      expect(declineRow, '没有「拒绝」那一行').toBeDefined()
      await act(async () => { declineRow?.click() })
      expect(answerQuestion).toHaveBeenNthCalledWith(2, 'rpc-plan-1', 's-1', [{ id: 'plan', selected: ['再改改'] }])
      // 「去聊天里说」把这一次确认交回会话：走载体的 dismiss，不占答案通道。
      const discussRow = rows.find(row => (row.textContent ?? '').includes(t('review.interactionDiscuss')))
      await act(async () => { discussRow?.click() })
      expect(cancelQuestion).toHaveBeenCalledWith('rpc-plan-1')
      expect(answerQuestion).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => { root.unmount() })
      document.body.removeChild(host)
    }
  })

  it('a plan whose asker offered no alternative has no refusal row (never an empty selection)', () => {
    // 官方把「另一个选项」建模成可选的（`PlanReview.decline` 缺席即没有），
    // 所以没有可拒的东西时就**不画那一行**——发一个空选择是按「跳过整道题」被读的，
    // 那是另一个答案。
    const single = plan()
    single.questions = [{ ...single.questions[0]!, options: [{ label: '确认' }] }]
    const markup = renderToStaticMarkup(createElement(InteractionCard, {
      question: single,
      shellWaiting: undefined,
      sessionId: 's-1',
      controller: face(true).controller,
    } as never))
    expect((markup.match(/<button/g) ?? []).length, '没有可拒的选项，却多画了一行').toBe(2)
    expect(markup).not.toContain(t('review.planDecline'))
    expect(markup).toContain(t('review.planConfirm'))
    expect(markup).toContain(t('review.interactionDiscuss'))
  })

  it('a question batch answers in place: one option click per question, then one submit', async () => {
    /* 普通问题与计划走的是**两条不同的路**（计划那条读 `intent.approve`，这一条读
       `choose` → 单选自动翻页 → `answerBatchOf`），各有各的门禁——一条绿了不算另一条也绿。
       这条此前一张图、一次点击都没有。 */
    const batch: WireQuestion = {
      rpcId: 'rpc-ask-1',
      sessionId: 's-1',
      isPlanReview: false,
      questions: [
        { id: 'lamp', question: '灯用哪一种？', options: [{ label: '轨道灯' }, { label: '吸顶灯' }] },
        { id: 'who', question: '谁来验收？', options: [{ label: '我自己看' }] },
      ],
    }
    const { controller, answerQuestion } = face(true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(createElement(InteractionCard, {
          question: batch,
          shellWaiting: undefined,
          sessionId: 's-1',
          controller,
        } as never))
      })
      const optionRow = (label: string): HTMLButtonElement | undefined =>
        [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')]
          .find(row => (row.textContent ?? '').includes(label))
      expect(optionRow('轨道灯'), '第一题没有画出选项——读者无从作答').toBeDefined()
      await act(async () => { optionRow('轨道灯')?.click() })
      // 单选选完就翻页（原生那一支的规矩），所以第二题的题面必须已经在屏上。
      expect(host.textContent, '选了第一题却没有翻到第二题').toContain('谁来验收？')
      await act(async () => { optionRow('我自己看')?.click() })
      const submit = [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find(row => (row.textContent ?? '').trim() === t('review.interactionSubmit'))
      expect(submit, '两题都答完了，却没有「提交」那一枚').toBeDefined()
      await act(async () => { submit?.click() })
      expect(answerQuestion).toHaveBeenCalledWith('rpc-ask-1', 's-1', [
        { id: 'lamp', selected: ['轨道灯'] },
        { id: 'who', selected: ['我自己看'] },
      ])
    } finally {
      await act(async () => { root.unmount() })
      document.body.removeChild(host)
    }
  })

  it('cannot answer here: the card quotes the options and nothing in it looks pressable', () => {
    const markup = renderToStaticMarkup(createElement(InteractionCard, {
      question: plan(),
      shellWaiting: undefined,
      sessionId: 's-1',
      controller: face(false).controller,
    } as never))
    // 只有那扇门是一枚按钮；会话给的选项是引用行（`li`），不是胶囊。
    expect((markup.match(/<button/g) ?? []).length, '只读卡里出现了能按的东西').toBe(1)
    expect(markup).toContain(t('review.interactionGoAnswer'))
    expect(markup).toContain(t('review.interactionOffered'))
    expect(markup).toContain(t('review.interactionReadOnlyWhy'))
    // 说明读得见（不再塞进 `title=`）：触屏没有 hover，说明不能只挂在 title 上。
    expect(markup).toContain('离开计划模式，从下一步开始照着它做')
  })
})
