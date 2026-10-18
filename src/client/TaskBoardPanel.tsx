/**
 * The board panel: the task board's seat in the shell's CENTRE STAGE.
 *
 * Mounting into the shell's DOM is a guess about shell internals: hunt for the
 * conversation column by a `data-pane` attribute, keep a MutationObserver
 * watching for the frame to arrive, render a React root into an extra child
 * appended to the shell's own grid item, and hide the conversation with a
 * `<html>` attribute plus a stylesheet rule. The attribute disappears in a host
 * upgrade, and the fallback (`[class*="centerCol"]`) matches a CSS-Module hash
 * that changes whenever the shell rebuilds — so the board silently stops
 * appearing with no error anywhere.
 *
 * This component is registered into the official `main` slot instead. That slot
 * IS the centre stage (`activePanelId: null` means the Conversation), it is
 * keyed (one panel per key, the same mechanism the shipped Plugins panel uses),
 * and `ctx.layout.selectPanel` is the official way to bring a panel forward.
 * Nothing here reads or writes shell DOM, so nothing here can break when the
 * shell's markup changes.
 *
 * The width contract is STRUCTURAL: `[data-dsh-taskboard-view]` stays a named
 * inline-size container, and the shell's three-column grid hands the panel its
 * real width — which is what the board's `@container` rules already measured
 * against (never the viewport).
 *
 * `boardOpen` is driven from the panel's own mount lifetime (one source: the
 * stage is showing exactly when this component is mounted), so the controller's
 * snapshot and the visible stage can never disagree.
 */

import { useEffect } from 'react'
import type { BoardController } from '../core/controller.ts'
import type { ItemPriority } from '../core/item.ts'
import { t } from './locales.ts'
import { TaskBoard } from './board/TaskBoard.tsx'
import css from './board.module.css'

/** Props the shell's `main` slot renderer binds for this panel. */
export interface TaskBoardPanelProps {
  /**
   * The live board, injected through the slot's inject face. `undefined` until
   * the background mount settles (and again after disposal) — the panel is
   * contributed at apply time so the shell can always resolve its row to a
   * stage, which is why "not ready yet" is a rendered state rather than a
   * reason not to register. Spelled as a union rather than `?:` so the inject
   * face can hand over an explicitly absent controller without a cast.
   */
  controller: BoardController | undefined

  /**
   * **这张卡上挂着几条清单条目、最急的是哪一档。**
   *
   * 看板面板自己看不到清单那份文档（两个主舞台面板各读各的），所以这个读数是**装配层**算好
   * 递进来的——那一层同时握着两份文档，也只有它该知道两边怎么对。缺席时卡片那一格不画
   * （看板完全可以独立使用：没有清单条目的卡什么都不显示）。
   *
   * 它是**显示值**，不是看板从此会读清单的语法：一张卡能怎么被搜、被筛仍然是看板自己的事
   * （见 `task-search.ts` 的律），按这一格跳过去筛选发生在清单那一侧。
   */
  mountedOf?: (cardId: string) => { readonly count: number; readonly loudest?: ItemPriority } | undefined
  /** 按那枚读数时走的那扇门：抬清单面板 + 只看挂着这张卡的条目（装配层接的两件事）。 */
  onOpenRows?: (cardId: string) => void
}

/**
 * Render the task board as a centre-stage panel.
 * @param props - the injected controller and the two cross-panel readings.
 * @returns the board surface, or the loading state while the board is not ready.
 */
export function TaskBoardPanel({ controller, mountedOf, onOpenRows }: TaskBoardPanelProps) {
  useEffect(() => {
    if (controller === undefined) return
    // The stage is showing this panel: that IS the board being open.
    controller.openBoard()
    return () => { controller.closeBoard() }
  }, [controller])

  return (
    <div className={css.panelStage} data-dsh-taskboard-view="">
      {controller === undefined
        ? <p className={css.panelLoading} role="status">{t('board.loading')}</p>
        : <TaskBoard controller={controller} mountedOf={mountedOf} onOpenRows={onOpenRows} />}
    </div>
  )
}
