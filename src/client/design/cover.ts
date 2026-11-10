/**
 * 「此刻有没有东西盖着我」——被盖住的那一层，**一个字的活都不该干**。
 *
 * ── 为什么这件事需要一个登记表，而不是一条 CSS 选择器 ──────────────────────
 *
 * 样式里已经有一条判据（`board.module.css` 的「ANIMATION STOPS WHEN AN OVERLAY
 * COVERS IT」）：只要层里有一个 `.modalBackdrop`，被盖住的那一层就
 * `animation-play-state: paused`、列就 `content-visibility: hidden`。那条规则管住了
 * **动画**和**绘制**两件事，而「盖住」这件事一共管四件：
 *
 *     动画 · 绘制 · 布局 · React 的重算
 *
 * 后两件选择器管不着。React 在 `setState` 之前不会去问一个选择器匹配了什么，而
 * 被盖住的看板仍然订阅着 controller 的快照：跑着的会话每隔几秒触发一次全局通知，
 * 整块板就重渲染一遍（每张卡重新派生、每条评论列表重新比对），**而这一切发生在读者
 * 正用手滚动的那个面板后面**。代价不在屏幕上，在手感上。
 *
 * ── 为什么不是复用 `escape-stack` ────────────────────────────────────────────
 *
 * 它记的是**层序**，答的问题是「按一次 Esc 该关哪一层」，而且只对登记了 Esc 的层成立。
 * 这里问的是另一件事：**有没有东西盖着我**。把两者并成一个计数，就会出现「在 Esc
 * 栈里、但它其实没盖住看板」和「盖住了、但它不响应 Esc」两种错配——前一种让看板白停，
 * 后一种让看板该停没停，而两种都只在滚动的手感上出现，屏上不说话。
 *
 * ── 失败方向是「省不下来」，不是「坏掉」 ────────────────────────────────────
 *
 * 一个浮层壳忘了登记，唯一后果是那一层照旧重算（今天的行为），没有任何东西变坏。
 * 反过来（登记了却没在屏幕上）才会让看板停在不该停的地方。所以判据不是「登记的层
 * 一定对」，而是**登记与揭开都只有一个入口**，并且三个壳由门禁点名核对。
 */
import { useEffect, useSyncExternalStore } from 'react'

/**
 * 打开着的覆盖层。**模块级、一个页面一份**——层是 DOM 的事实，不是某一棵子树的。
 *
 * 存的是 Symbol 而不是计数：计数要求每一次登记都恰好配一次注销，而一个被
 * React StrictMode 双调用的 effect 就能让它飘；Set 的成员身份不会飘。
 */
const covers = new Set<symbol>()

/** 谁在听「盖住/揭开」这个边沿。 */
const listeners = new Set<() => void>()

function announce(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * 登记一层覆盖，直到它卸载。
 *
 * `active` 为假时不登记——一个只画一帧的浮层不构成「盖住」。传假值而不是不调用这个
 * hook，是为了让调用者不必把 hook 放进条件里（那会让 hook 的个数随渲染变化）。
 * @param active - 这一层此刻是否真的在屏幕上。
 */
export function useCover(active = true): void {
  useEffect(() => {
    if (!active) return undefined
    const token = Symbol('cover')
    covers.add(token)
    announce()
    return () => {
      covers.delete(token)
      announce()
    }
  }, [active])
}

/** 订阅「此刻有没有东西盖着我」。 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 此刻有没有东西盖着我（读的是同一个集合，不是第二份状态）。 */
function snapshot(): boolean {
  return covers.size > 0
}

/**
 * 读者此刻是不是被一层浮层盖着。
 *
 * `useSyncExternalStore` 而不是 `useState` + `useEffect`：这是一个**外部事实**（同一个
 * 页面里任何一层浮层都能改变它），而外部事实的首帧必须与渲染同步——用 state 的话，
 * 一个在挂载时就已被盖住的表面会先按「没被盖住」画一帧，再收到通知改正，那一帧里
 * 它会把该省的活干一遍。
 * @returns 盖着为真。
 */
export function useCovered(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
