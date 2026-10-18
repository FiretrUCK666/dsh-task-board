/**
 * The workbench bar: three pages, one identity, one way out.
 *
 * WHY THIS IS A COMPONENT AND NOT THREE COPIES. The board, the list and the
 * overview are three separate seats in the shell (one `main` key each, one
 * sidebar row each), so "which page am I on" cannot be answered by the shell's
 * own chrome — it answers "which plugin", not "which page". The bar is the only
 * surface that says it, and a second copy of it in one page would drift from
 * the other two the first time either changed. Three renderers, one component.
 *
 * WHY IT IS NOT THE EXISTING `Segmented`. That component is a `radiogroup`: it
 * selects a value inside one control. These are destinations — pressing one
 * replaces the whole stage — so the semantics are `nav` + `aria-current="page"`,
 * and a radiogroup would announce "option 2 of 3 selected" for a page change.
 * The visual grammar (a sliding pill in a track) is shared; the meaning is not.
 *
 * WHY THE ACTIVE PILL BELONGS TO THE TAB ITSELF. It used to be one absolutely
 * positioned thumb whose width was `(100% - 4px) / count` and whose offset was
 * `index * 100%` — fractional geometry against a track list, sitting on a nav
 * that could also be squeezed by the status line beside it. The arithmetic was
 * one padding box away from the tracks it was supposed to cover, and the result
 * was exactly what the reader reported: 「点来点去，高亮的位置一直变」.
 *
 * A pill that is the tab's own background cannot disagree with its own label:
 * there is no second box to place, nothing to re-measure when the sidebar
 * collapses, and no count to divide by. Switching pages cross-fades the fill
 * (one `background`/`box-shadow` transition) instead of sliding a box across
 * two tracks — the arrival is what the eye needs, not the journey.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. No primary action, no search box, no
 * notification bell: every page already owns those in its own toolbar, and two
 * "new" buttons on one screen is how a product ends up with two different
 * meanings for the same word. The bar navigates, reports, and exits.
 *
 * The bar is presentation only: labels, counts and the active page arrive as
 * props from the page layer, which is where the locale and the surface switch
 * live. A design component that reached for either would be a page in disguise.
 */
import { Icon } from './ui.tsx'
import css from './components.module.css'

/** One destination the workbench can show. */
export interface WorkbenchTab {
  /** Stable id, the value `onNavigate` receives back. */
  readonly id: string
  /** Already-localised name. */
  readonly label: string
  /**
   * A count that belongs to this destination (「等你处理 3」 on the board,
   * 「逾期 2」 on the list). Absent or zero renders no badge: a zero badge is
   * a promise that something is there to look at.
   */
  readonly badge?: number
  /** Full name for the pointer tooltip, when the tab label is shortened. */
  readonly title?: string
}

export interface WorkbenchBarProps {
  /** Which destination is showing; must match one tab id. */
  readonly active: string
  /** The destinations to offer, in reading order. */
  readonly tabs: readonly WorkbenchTab[]
  /** Accessible name for the navigation group. */
  readonly label: string
  /**
   * The one-line state of the whole workbench ("等你处理 3 · 进行中 1").
   * Absent when there is nothing to report — an always-present line makes the
   * reader scan a readout that says "nothing" on most days.
   */
  readonly status?: string
  /** Accessible name for the exit control. */
  readonly exitLabel: string
  /** Leave the workbench (back to the shell's conversation). */
  readonly onExit: () => void
  /** Go to another destination. */
  readonly onNavigate: (id: string) => void
}

/**
 * Render the workbench bar.
 * @param props - destinations, the active one, the status line and the exit.
 * @returns the bar, as one flex row that wraps rather than hides.
 */
export function WorkbenchBar({ active, tabs, label, status, exitLabel, onExit, onNavigate }: WorkbenchBarProps) {
  return (
    <div className={css.workbenchBar}>
      <nav className={css.workbenchNav} aria-label={label}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={css.workbenchTab}
            aria-current={tab.id === active ? 'page' : undefined}
            title={tab.title}
            onClick={() => { onNavigate(tab.id) }}
          >
            <span className={css.workbenchTabLabel}>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0
              ? <span className={css.workbenchTabBadge} aria-hidden="true">{tab.badge > 99 ? '99+' : tab.badge}</span>
              : null}
          </button>
        ))}
      </nav>
      {/* 一个具名 spacer，而不是给状态行一个 `margin-inline-start: auto`：自动外边距
          只把**换行后的首项**推到末端，而这里状态行与出口是两个必须一起靠右的东西。
          spacer 吃掉所有空隙，于是窄档换行时它们落到第二行、由出口自己的外边距收右。 */}
      <span className={css.workbenchSpacer} aria-hidden="true" />
      {status === undefined || status === ''
        ? null
        : <p className={css.workbenchStatus}>{status}</p>}
      <button
        type="button"
        className={css.workbenchExit}
        onClick={onExit}
        title={exitLabel}
        aria-label={exitLabel}
      >
        <Icon name="arrowLeft" />
      </button>
    </div>
  )
}
