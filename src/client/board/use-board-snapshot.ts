/**
 * 看板的快照，**订阅着的**那一份。
 *
 * ── 为什么这是一个 hook，而不是一句 `controller.getSnapshot()` ──────────────
 *
 * 清单面板读看板的三张映射（哪张卡在哪一栏、哪张卡跑得起来、能挂哪些卡）不许是「顺手
 * 取一次快照」：`useMemo(..., [face.controller, items])`——两个键都不随看板变，而面板
 * 也没有订阅 controller。于是**在清单开着的时候把一张卡拖到另一栏，清单那一行还停在
 * 上一栏**，直到某一行的内容被改动才跟着重画；卡被删掉时也一样，清单那一行继续写着
 * 「已挂载」。屏上没有一处说这件事，因为它是「没发生」，不是「报错」。
 *
 * 一层视图读另一层的事实，只有一种形状是可靠的：**订阅过的派生**。同一个 hook 由所有
 * 页面共用，于是不可能一页订阅、另一页只取一次。
 *
 * ── 为什么订阅只有这一处 ────────────────────────────────────────────────────
 *
 * `useState` + `useEffect` + `subscribe` 这三行曾经同时在五个文件里各写一遍，其中三份
 * 逐字相同。**同一个机制有第二份实现**的代价不是那几行：是改一处不会改到另一处，而屏上
 * 没有任何一处会说这件事。所以订阅只在这里发生；谁要快照，就调这个 hook。
 * `tests/panel-render.spec.ts` 的「ONE subscription seam」守着这条。
 *
 * 这条也决定了缓存有没有用：`getSnapshot` 现在对「数据没变」返回同一个对象
 * （见 controller），订阅者于是能靠引用比对跳过重画——而**只有走这个 hook 的页面**
 * 是「一处改、处处受益」。
 *
 * ── 两个入口，一个实现 ──────────────────────────────────────────────────────
 *
 * 装配层可能给不出 controller（那一屏没有看板）。两种调用方对「没有看板」的答案需求
 * 不同：**可能没有**的那种拿到 `BoardSnapshot | undefined`，`undefined` 是一个答案而
 * 不是缺失——那时每张映射都是空的，读它们的地方要么退回「读不到」，要么干脆不画；把
 * 「看不见」说成「没有」是这一页明确拒绝的那类谎话。
 *
 * **声明了 controller 必填**的那些（看板自己、自动化面板、会话浮层：它们只在有看板时
 * 挂载）拿到不带 `undefined` 的快照，于是不必对每个字段写一次「不可能为空」的断言。
 *
 * 所以这里有两个名字、**一个实现**：必填的那个转手交给可空的那个，自己只负责把那句
 * 「不可能为空」说一次。**不用 TS 重载**——同一个名字声明三遍会被「一个名字只有一个
 * 家」那道门禁读成两个家（它判的是声明次数，读不到「这是重载」这个意图）。两个名字
 * 没有这个歧义，也让调用处一眼看得出自己拿的是哪一种。
 */
import { useEffect, useRef, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'

/** 看板快照的形状由 controller 自己说了算，这里不写第二遍。 */
export type BoardSnapshot = ReturnType<BoardController['getSnapshot']>

/**
 * Subscribe to the board's snapshot, or `undefined` when there is no board.
 * @param controller - 装配层给的看板控制器；`undefined` = 这一屏没有看板。
 * @param held - 这一层此刻是不是**被盖着**（见 `design/cover.ts`）。被盖着的表面不
 *   接收新快照：它的可见输出没有人在看，而每次通知都意味着一整棵子树的重算；重算本身
 *   不发生在读者眼里，代价却落在读者正滚动的那个面板的手感上。
 * @returns 当前快照，或 `undefined`（没有看板）。controller 变了或看板改了都会重画。
 */
export function useBoardSnapshot(controller: BoardController | undefined, held = false): BoardSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | undefined>(() => controller?.getSnapshot())
  /* `held` 走 ref，不进依赖数组：它一变就重建订阅的话，揭开那一刻要在同一个提交里
   * 先注销再重新挂上，而这两步之间到达的通知会被丢掉——丢掉的是「揭开之后该显示什么」。
   * 订阅只认 controller，这是它唯一真正的依赖。 */
  const heldRef = useRef(held)
  heldRef.current = held
  useEffect(() => {
    if (controller === undefined) {
      setSnapshot(undefined)
      return undefined
    }
    // 先读一次：controller 可能在两次渲染之间就换过（或刚回来）。
    setSnapshot(controller.getSnapshot())
    return controller.subscribe(() => {
      // 盖着的时候**不接收**：这一跳就是「一个字的活都不干」的全部实现。
      if (heldRef.current) return
      setSnapshot(controller.getSnapshot())
    })
  }, [controller])
  /* 揭开的那一刻补读一次，把被盖住期间错过的改动对齐。
   *
   * 这一次读是必须的，不是保险：`getSnapshot()` 的缓存被每一次 `notify()` 丢掉（见
   * controller），所以盖着期间到达的通知已经把缓存清了；不补读，揭开后看到的就是
   * 打开面板那一刻的旧数据，直到下一次通知。而它只在边沿发生一次——不是每帧。 */
  useEffect(() => {
    if (held || controller === undefined) return
    setSnapshot(current => {
      const next = controller.getSnapshot()
      return next === current ? current : next
    })
  }, [controller, held])
  return snapshot
}

/**
 * The same subscription for a caller that REQUIRES a board.
 *
 * One line, and the line is the point: it states once that this caller cannot be
 * without a board, instead of making every field of every snapshot read assert it.
 * @param controller - 装配层给的看板控制器（必填）。
 * @param held - 这一层此刻是不是被盖着（见 `useBoardSnapshot`）。
 * @returns 当前快照；controller 变了或看板改了都会重画。
 */
export function useRequiredBoardSnapshot(controller: BoardController, held = false): BoardSnapshot {
  // `?? controller.getSnapshot()` is unreachable in practice (the argument is not
  // undefined) and is not a fallback for a missing board: it keeps the type honest
  // without a cast, so a future change to the nullable hook cannot silently start
  // handing `undefined` to a caller that has no branch for it.
  return useBoardSnapshot(controller, held) ?? controller.getSnapshot()
}
