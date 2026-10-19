/**
 * **每一个工作台页面都必须渲染的那些覆盖层。**
 *
 * ── 它解决的是什么 ──────────────────────────────────────────────────────────
 *
 * 检查更新的按钮由 `WorkbenchBar` 渲染（三个页面都有），而它打开的对话框曾经只住在
 * 看板那一页的 JSX 里。于是同一个按钮有两种行为：看板页能弹，另外两页什么都不发生。
 *
 * 那不是漏改一处，是**一个功能被拆在两个地方**——触发在共享层、结果在页面层。每加
 * 一个新页面这个缺口就再出现一次，而它不报错、不红、测试也过：每一页都「正确地」
 * 渲染了自己那份 JSX，只是少了一份。
 *
 * 所以这里把「结果」也收成一处：一个组件，页面把它放到自己的根节点里（或交给
 * `WorkbenchShell` 的 `overlay` 插槽）。加第 4、第 5 个页面时**照抄一行**，而
 * 「有没有抄」由 `design-coverage.spec.ts` 的一个断言回答，不靠记得。
 *
 * ── 为什么不做成「壳自己渲染」 ──────────────────────────────────────────────
 *
 * `WorkbenchShell` 在 `design/` 层，那里不许依赖任何一页的装配（见层方向判据）。
 * 而这个组件要读 `update-controller`（装配层）。所以壳只提供 `overlay` 插槽、内容
 * 由页面传进来——壳不知道覆盖层是什么，页面不需要知道它怎么长。
 *
 * @module dsh-task-board/workbench/WorkbenchOverlays
 */
import { UpdateDialog } from './UpdateDialog.tsx'

/**
 * Render the overlays every workbench page carries.
 * @returns the overlays, mounted at the page root.
 */
export function WorkbenchOverlays() {
  return <UpdateDialog />
}
