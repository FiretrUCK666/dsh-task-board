// @vitest-environment jsdom
/**
 * **检查更新的对话框，在清单页上也真的弹得出来。**
 *
 * ── 这个文件存在的理由 ──────────────────────────────────────────────────────
 *
 * 读者报过一个 bug：点「检查更新」，总览和清单那两页什么都不发生，只有看板能弹。
 *
 * 成因不是漏改一处，是**一个功能被拆在两个地方**：按钮由 `WorkbenchBar` 渲染（三页
 * 都有），而对话框当时住在看板页的 JSX 里。每加一个新页面这个缺口就再出现一次，而
 * 它不报错、不红、测试也过——每一页都「正确地」渲染了自己那份 JSX，只是少了一份。
 *
 * 后来对话框抽成了 `UpdateDialog`，由 `WorkbenchOverlays` 挂载，三页各挂一次。
 *
 * ── 两条断言分别管什么 ──────────────────────────────────────────────────────
 *
 * **静态那条**（`design-coverage.spec.ts`）：用了 `WorkbenchBar` / `WorkbenchShell`
 * 的页面必须也渲染 `WorkbenchOverlays`。它管「有没有接上」——判据读的是「用了栏」
 * 这个结构事实，不是一张名单，所以第 4、第 5 个页面自动被覆盖。
 *
 * **这里这条**（动态）：真的挂一页，真的点那颗按钮，真的断言对话框出现。
 * 它管「接上了之后是不是真的弹得出来」——一条 import、一行 JSX 都在，运行时仍可能
 * 因为条件渲染、层级或 `inert` 而不出现。
 *
 * ── 为什么这里只有清单页 ────────────────────────────────────────────────────
 *
 * 看板页由 `board-panel.spec.ts` 的「the update dialog, driven through the header
 * button」整组（11 条）覆盖，走的是同一颗按钮、同一份 `UpdateDialog`。总览页与看板
 * 页**共用同一条 `WorkbenchShell` + `overlay` 通路**，那条通路由看板那组覆盖。
 *
 * 所以这里挂的是三页里**唯一一条不同的通路**：清单页自己拼的框架（它不用
 * `WorkbenchShell`，栏要横跨左栏与主列）。也就是唯一可能单独坏掉的那一页——读者报
 * 的正是它。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { updateController } from '../src/client/workbench/update-controller.ts'
import { t } from '../src/client/locales.ts'
import { mountPanel } from './panel-harness.ts'
import type { ItemRecord } from '../src/core/item.ts'

/**
 * 一颗最小可渲染的行。
 *
 * `attachments` / `steps` / `tags` 必须是**数组**：清单页会把它们 `map` 出来，缺一个
 * 就抛 `list is not iterable`，而那个报错读起来像挂载器坏了，其实是夹具少了一个字段。
 * @returns 一行。
 */
function oneRow(): ItemRecord[] {
  return [{
    id: 'r-1',
    ref: 1,
    title: '一行就够',
    body: '',
    attachments: [],
    notes: '',
    steps: [],
    status: 'todo',
    priority: 'normal',
    tags: [],
    createdAt: '2026-09-29T08:00:00.000Z',
    updatedAt: '2026-09-29T08:00:00.000Z',
  } as unknown as ItemRecord]
}

/**
 * 让 host 的更新视图答得出来：`check()` 拿到它才会设 `open = true`。
 *
 * 形状照 `board-panel.spec.ts` 的 `viewOf`——那是这份契约的既有权威。`parsePlan` 与
 * `parseLatest` 对缺字段是**静默丢弃**：少一个 `dir` 或 `steps`，整份视图读成
 * `undefined`，于是对话框永远不开，而屏上只说「检查失败」。
 * @param over - 覆盖用的字段。
 */
function stubUpdateFetch(over: Record<string, unknown> = {}): void {
  vi.stubGlobal('fetch', async (url: unknown) => {
    const href = String(url)
    const answer = (payload: unknown): Response => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    /* 面板自己的请求（租约、文档）不该被这个 stub 假装成成功：一次真的答复会把租约
       当成拿到手，于是这条用例在测另一件事。只批准更新那一条路。 */
    if (!href.includes('api/dsh-task-board/update')) {
      return answer({ ok: false, error: { code: 'stub', message: 'not stubbed' } })
    }
    return answer({
      ok: true,
      value: {
        packageName: '@firetruck666/dsh-task-board',
        version: '0.8.26',
        spec: '^0.8.26',
        mode: 'npm',
        profile: 'web',
        dir: 'C:/Users/u/.dsh/profiles/web',
        appManaged: false,
        evidence: { linked: false, declared: true, disagreement: false },
        githubSpec: 'github:FiretrUCK666/dsh-task-board',
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
        ...over,
      },
    })
  })
}

/**
 * 对话框在不在页面上。
 *
 * **查 `document.body`，不是查面板的子树。** `Dialog` 默认走 portal——它把自己挂到
 * body 上，因为一个弹层要相对**整个工作台**定位，而不是相对碰巧包住它的那层 box
 * （见 `Dialog.tsx` 的头注释）。所以「面板 host 里有没有 `role=dialog`」永远是 0，
 * 而那不是缺陷，是 portal 的应有行为；查错了地方会把正确实现报成缺陷。
 * @returns 开着则真。
 */
function dialogOpen(): boolean {
  return [...document.querySelectorAll('[role="dialog"]')]
    .some((one) => (one.textContent ?? '').includes(t('board.update.title')))
}

/**
 * 找到「检查更新」那颗按钮。
 * @param host - 面板挂载到的那棵树。
 * @returns 那颗按钮，或 `undefined`。
 */
function checkButton(host: HTMLElement): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')]
    .find((one) => (one.textContent ?? '').includes(t('board.update.check')))
}

/**
 * 点一下「检查更新」，并把 `check()` 那条异步链跑完。
 *
 * 两件事都必须做对：
 *
 * 1. **微任务要跑完。** `check()` 是 `void (async () => { await fetchUpdateSource() … })()`，
 *    设 `open = true` 发生在若干个 `await` 之后。一次同步的 `act` 读到的仍是
 *    `checking`，断言会把「还没到」读成「永远不会」。
 * 2. **`act` 要括住整段。** 状态经 `useSyncExternalStore` 通知，渲染发生在 `act`
 *    退出时；把点击留在 `act` 外面，断言读到的是上一帧的 DOM。
 * @param host - 面板挂载到的那棵树。
 */
async function pressCheck(host: HTMLElement): Promise<void> {
  const button = checkButton(host)
  expect(button, '清单页上根本没有「检查更新」这颗按钮').toBeDefined()
  await act(async () => {
    button?.click()
    for (let i = 0; i < 12; i += 1) await Promise.resolve()
  })
}

describe('the update dialog opens on the list page too', () => {
  /* 控制器是单例，状态会跨用例存活（那是产品的设计：一次检查不该因为切页而丢）。
     所以每条用例从静止开始，模拟一次「刚打开页面」。 */
  beforeEach(() => {
    updateController.reset()
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('the button is there, and pressing it opens the dialog', async () => {
    const panel = mountPanel(oneRow(), 'list', 'wide')
    try {
      /* **stub 必须在挂载之后设。** `mountPanel` 会给面板装它自己那一套假面（租约、
         文档、SSE），其中包含它对 `fetch` 的处理——先设的全局 stub 会被它盖掉，于是
         `check()` 发出去的请求落进假面，`fetchUpdateSource` 读不到东西，phase 变
         `failed`，而那不是缺陷。顺序反过来才是在测真实的那条链路。 */
      stubUpdateFetch()
      await pressCheck(panel.host)
      expect(dialogOpen(), '清单页点了检查更新，对话框没有出现——这正是读者报的那件事').toBe(true)
    } finally {
      act(() => { panel.dispose() })
    }
  })

  it('closing it puts the page back the way it was', async () => {
    const panel = mountPanel(oneRow(), 'list', 'wide')
    try {
      stubUpdateFetch()
      await pressCheck(panel.host)
      expect(dialogOpen(), '对话框没开，这条用例的前提不成立').toBe(true)
      /* 关掉：`role="dialog"` 必须离开 DOM，而不只是被藏起来——留在 DOM 里的模态
         会继续吃掉键盘，那是「关不掉」的一种。 */
      const close = [...document.querySelectorAll('button')]
        .find((one) => (one.textContent ?? '').trim() === t('detail.close'))
      expect(close, '对话框里没有「关闭」那颗按钮').toBeDefined()
      await act(async () => { close?.click() })
      expect(dialogOpen(), '按了关闭，对话框仍在 DOM 里').toBe(false)
    } finally {
      act(() => { panel.dispose() })
    }
  })

  it('the page behind the dialog is inert while it is open', async () => {
    /* **`aria-modal` 是一个承诺，这条是它没写成字的那一半。**
       清单页不像另外两页那样走 `WorkbenchShell`——它自己拼框架，并且自己管着自己的
       `inert`（`overlayIsModal`）。所以「更新对话框开着时，背后的内容还活着吗」是
       这一页**独有**的问题：另外两页的答案来自壳，这一页没有壳可依。
       答案必须是活的之外没有活的：一个键盘使用者不能从打开的对话框里 Tab 出去，
       操作他看不见的一列。
       机制在 `Dialog` 自己那一侧（`useModalInert` + `boardBox()` 把弹层 portal 进
       座位内部，所以「弹层之外、座位之内」是被标记的范围），这里只断言结果。 */
    const panel = mountPanel(oneRow(), 'list', 'wide')
    try {
      stubUpdateFetch()
      await pressCheck(panel.host)
      const dialog = document.querySelector('[role="dialog"]')
      expect(dialog, '对话框没开，这条用例的前提不成立').not.toBeNull()
      const seat = dialog?.closest('[data-dsh-taskboard-view]')
      expect(seat, '弹层被 portal 到座位之外了，于是「外面的一切」无处可标——背景会保持完全可用').not.toBeNull()
      const siblings = [...(seat?.children ?? [])].filter((one) => !one.contains(dialog))
      expect(siblings.length, '座位里没有「背后的内容」可标，这条用例测不到东西').toBeGreaterThan(0)
      const live = siblings.filter((one) => !one.hasAttribute('inert'))
      expect(live, '对话框开着，背后这些节点仍可聚焦（缺 inert）').toEqual([])
      for (const one of siblings) {
        expect(one.getAttribute('aria-hidden'), '读屏仍会念到弹窗底下那一页').toBe('true')
      }
    } finally {
      act(() => { panel.dispose() })
    }
  })
})
