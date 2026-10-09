/**
 * 看板的快照，**订阅着的**那一份。
 *
 * ── 为什么这是一个 hook，而不是一句 `controller.getSnapshot()` ──────────────
 *
 * 清单面板读看板的三张映射（哪张卡在哪一栏、哪张卡跑得起来、能挂哪些卡）原来是「顺手
 * 取一次快照」：`useMemo(..., [face.controller, items])`——两个键都不随看板变，而面板
 * 也没有订阅 controller。于是**在清单开着的时候把一张卡拖到另一栏，清单那一行还停在
 * 上一栏**，直到某一行的内容被改动才跟着重画；卡被删掉时也一样，清单那一行继续写着
 * 「已挂载」。屏上没有任何一处说这件事，因为它是「没发生」，不是「报错」。
 *
 * 一层视图读另一层的事实，只有一种形状是可靠的：**订阅过的派生**。同一个 hook 由看板
 * 自己与清单面板共用，于是两边不可能一个订阅、一个只取一次。
 *
 * `undefined` 表示**这台机器没有看板**（装配层没给 controller）。它是一个答案，不是
 * 缺失：那时每张映射都是空的，而读它们的地方要么退回「读不到」，要么干脆不画——把
 * 「看不见」说成「没有」是这一页明确拒绝的那类谎话。
 */
import { useEffect, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'

/** 看板快照的形状由 controller 自己说了算，这里不写第二遍。 */
export type BoardSnapshot = ReturnType<BoardController['getSnapshot']>

/**
 * Subscribe to the board's snapshot, or `undefined` when there is no board.
 * @param controller - 装配层给的看板控制器，`undefined` = 这一屏没有看板。
 * @returns 当前快照；controller 变了或看板改了都会重画。
 */
export function useBoardSnapshot(controller: BoardController | undefined): BoardSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | undefined>(() => controller?.getSnapshot())
  useEffect(() => {
    if (controller === undefined) {
      setSnapshot(undefined)
      return undefined
    }
    // 先读一次：controller 可能在两次渲染之间就换过（或刚回来）。
    setSnapshot(controller.getSnapshot())
    return controller.subscribe(() => setSnapshot(controller.getSnapshot()))
  }, [controller])
  return snapshot
}
