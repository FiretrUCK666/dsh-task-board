/**
 * The workbench shell: ONE frame for all three pages.
 *
 * WHY THIS EXISTS AT ALL. The three pages are three separate seats, and the
 * reader's report was 「点总览/看板/清单，整个页面都在动」: three separate frames can
 * only agree by coincidence, and coincidence is what a later single edit
 * destroys. So the frame is a COMPONENT: the page supplies only its content, and
 * every geometric decision — where the bar sits, how much air surrounds it, how
 * far the content starts below it — is made here, once, for all three.
 *
 * THE FIX IS STRUCTURAL, NOT NUMERICAL. Aligning three numbers would have been
 * a patch: the next person to add a fourth page (or to touch one page's
 * padding) reintroduces the drift, silently.
 *
 * WHAT A PAGE MAY STILL DO. Its own interior: columns, rows, cards, scrolling.
 * What it may NOT do is decide its own outer air or draw its own bar. Those two
 * are the shared frame, and a page that re-derives them is a page that will one
 * day disagree with its siblings.
 *
 * WHY THE BAR IS A SIBLING OF THE SCROLLER, NOT INSIDE IT. Scrolling is the
 * page's business; a bar that scrolls away is a bar you cannot leave from. So
 * the shell is a column: the bar row (fixed), the notice strip (fixed, absent
 * when quiet), then a scroller that owns the rest.
 */
import type { ReactNode } from 'react'
import { WorkbenchBar, type WorkbenchTab } from './WorkbenchBar.tsx'
import { WorkbenchNotice, type WorkbenchNoticeItem } from './WorkbenchNotice.tsx'
import css from './components.module.css'

/** Everything the shared frame needs to draw itself. */
export interface WorkbenchShellProps {
  /** Which destination is showing. */
  readonly active: string
  /** The destinations to offer. */
  readonly tabs: readonly WorkbenchTab[]
  /** Accessible name for the navigation group. */
  readonly label: string
  /** The one-line readout; absent prints nothing but keeps the slot. */
  readonly status?: string
  /** Whether the update check is in flight. */
  readonly checking: boolean
  /** The update button's face. */
  readonly checkLabel: string
  /** Run the update check. */
  readonly onCheck: () => void
  /** Accessible name for the exit control. */
  readonly exitLabel: string
  /** Leave the workbench. */
  readonly onExit: () => void
  /** Go to another destination. */
  readonly onNavigate: (id: string) => void
  /** Warnings to carry below the bar; empty renders no strip. */
  readonly notices?: readonly WorkbenchNoticeItem[]
  /**
   * Whether this page's own scroller should own the remaining height. Pages
   * whose interior manages its own scrolling (the list's rail + column, the
   * board's column strip) pass `false` and get a plain block that fills the
   * rest; a page that is one long document (the overview) passes `true`.
   */
  readonly scrolls?: boolean
  /**
   * The page's own seat marker. Each page names its subtree so its sheet can
   * scope selectors to itself; the shell carries it so a page cannot forget it
   * (a missing marker means its whole stylesheet stops matching, silently).
   */
  readonly seat: string
  /**
   * **每一页都要有的那些弹层。**
   *
   * 这个插槽存在的理由：检查更新的按钮由这一层渲染（`checking` / `onCheck`），所以
   * 它打开的对话框也必须在共享层——否则同一个按钮在三页里有两种行为：这一页能弹，
   * 其余两页什么都不发生。那不是漏改一处，是**一个功能被拆在两个地方**：触发在共享
   * 层、结果在页面层。
   *
   * 把内容放这里，等于把「结果」也搬到共享层：壳渲染它一次，每个用壳的页面自动都有，
   * 加第 4、第 5 个页面时不用做任何事。它由**装配层**传入（而不是壳自己 import），
   * 因为壳在 `design/` 里，而 `design/` 不许依赖任何一页——见 `design-coverage.spec.ts`
   * 的层方向判据。
   */
  readonly overlay?: ReactNode
  /** The page. */
  readonly children: ReactNode
}

/**
 * Render the shared workbench frame.
 * @param props - the bar's props, optional warnings, and the page content.
 * @returns the frame: bar row, optional warning strip, then the page.
 */
export function WorkbenchShell({
  active,
  tabs,
  label,
  status,
  checking,
  checkLabel,
  onCheck,
  exitLabel,
  onExit,
  onNavigate,
  notices,
  scrolls = false,
  seat,
  overlay,
  children,
}: WorkbenchShellProps) {
  return (
    <div className={css.workbenchFrame} {...{ [seat]: '' }}>
      <div className={css.workbenchFrameBar}>
        <WorkbenchBar
          active={active}
          tabs={tabs}
          label={label}
          status={status}
          checking={checking}
          checkLabel={checkLabel}
          onCheck={onCheck}
          exitLabel={exitLabel}
          onExit={onExit}
          onNavigate={onNavigate}
        />
      </div>
      {notices !== undefined && notices.length > 0 && (
        <div className={css.workbenchFrameNotice}>
          <WorkbenchNotice items={notices} />
        </div>
      )}
      <div className={scrolls === true ? `${css.workbenchFrameBody} ${css.workbenchFrameScroll}` : css.workbenchFrameBody}>
        {children}
      </div>
      {/* 每一页都要有的弹层。放在 body 之后、与 frame 同级，所以它不会被
          `overflow` 裁掉，也不会参与页面布局。 */}
      {overlay}
    </div>
  )
}
