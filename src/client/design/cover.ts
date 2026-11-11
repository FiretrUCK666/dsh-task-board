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
 * ── 为什么是「层」而不是一个布尔：盖住是一条链，不是一个开关 ────────────────
 *
 * 第一版把这件事答成了一个布尔（`useCovered()` = 有没有任何浮层开着），于是它只回答得
 * 了**最底下那一层**。可叠起来的时候有三层：
 *
 *     看板  ←  卡片详情  ←  会话/复核面板  ←  各种确认弹窗
 *
 * 读者滚动的那个面板下面是**卡片详情**，而它自己也是一个没停过的订阅者：它照旧每 3 秒
 * 收一次快照、重算整张卡（描述、运行配置、会话行、状态按钮）。于是「看板停了」之后手感
 * 仍然不对——停的那一层不是花钱的那一层。**一个开关答不了「我上面还有没有东西」**。
 *
 * 所以问题不是「有没有东西开着」，而是「**我上面**有没有东西开着」。这需要两样：谁开着
 * （登记表），以及谁在谁上面（次序）。次序不能靠挂载先后推——React 的 effect 是子先父后
 * 跑的，卡片详情会排在它自己打开的面板**之后**，恰好反过来。次序是这一页**结构上的事实**，
 * 写在下面那张表里，一处声明；界面里谁是谁的上一层，就是谁。
 *
 * ── 为什么不是复用 `escape-stack` ────────────────────────────────────────────
 *
 * 它记的是**层序**，答的问题是「按一次 Esc 该关哪一层」。这一张表答的是另一件事：
 * **我上面有没有东西**。两者次序恰好相同，但消费者与失效方式完全不同：Esc 栈只对登记了
 * Esc 的层成立，而「盖住」对**任何**画在别人上面的层都成立（一个没有关闭键的确认框也
 * 盖住下面）。合成一个计数就会出现「在 Esc 栈里、但它其实没盖住」和「盖住了、但它不响应
 * Esc」两种错配，而两种都只在手感上出现，屏上不说话。
 *
 * ── 失败方向是「省不下来」，不是「坏掉」 ────────────────────────────────────
 *
 * 一个浮层壳忘了登记，唯一后果是那一层照旧重算（今天的行为），没有任何东西变坏。
 * 反过来（登记了却没在屏幕上）才会让下面停在不该停的地方。所以判据不是「登记的层
 * 一定对」，而是**登记与揭开都只有一个入口**，并且每个壳由门禁点名核对。
 */
import { useEffect, useSyncExternalStore } from 'react'

/**
 * 层的次序，从下到上。**这是唯一一处声明**：谁在谁上面是这一页结构上的事实，不是
 * 运行时判断出来的。
 *
 * 名字用读者看得懂的说法（看板 / 卡片详情 / 会话面板 / 弹窗），不用组件名——组件改名
 * 是常事，而「哪一层盖着哪一层」不是。
 */
export const LAYERS = ['board', 'detail', 'panel', 'dialog'] as const

/** 一层浮层的名字（见 {@link LAYERS}）。 */
export type Layer = (typeof LAYERS)[number]

/** 一层的序号：越大越靠上。表里没有的名字是调用处写错了，不是一种新层。 */
function rankOf(layer: Layer): number {
  return LAYERS.indexOf(layer)
}

/**
 * 打开着的层。**模块级、一个页面一份**——层是 DOM 的事实，不是某一棵子树的。
 *
 * 存的是 Symbol 而不是计数：计数要求每一次登记都恰好配一次注销，而一个被
 * React StrictMode 双调用的 effect 就能让它飘；Set 的成员身份不会飘。
 */
const covers = new Set<{ layer: Layer; token: symbol }>()

/** 谁在听「盖住/揭开」这个边沿。 */
const listeners = new Set<() => void>()

function announce(): void {
  for (const listener of [...listeners]) listener()
}

/** 此刻**最上面**那一层的序号；没有浮层时是 -1（比任何一层都低）。 */
function topRank(): number {
  let top = -1
  for (const cover of covers) top = Math.max(top, rankOf(cover.layer))
  return top
}

/**
 * 登记一层覆盖，直到它卸载。
 *
 * 登记的生命周期**就是挂载的生命周期**：一层浮层只在它真的画在别人上面对才盖住别人，
 * 所以这个 hook 不接受「现在算不算」的参数——传假值而不调用它不是省事，是让调用方把
 * hook 放进条件里（hook 的个数会随渲染变化）。要判断一层「该不该在」，是调用方的事；
 * 一旦它在，它就盖住了下面。
 * @param layer - 这一层是哪一层（见 {@link LAYERS}）。
 */
export function useCover(layer: Layer): void {
  useEffect(() => {
    const entry = { layer, token: Symbol('cover') }
    covers.add(entry)
    announce()
    return () => {
      covers.delete(entry)
      announce()
    }
  }, [layer])
}

/** 订阅「我上面有没有东西」。 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 读的是同一个集合，不是第二份状态。 */
function snapshot(): number {
  return topRank()
}

/**
 * 我上面有没有东西开着。
 *
 * `useSyncExternalStore` 而不是 `useState` + `useEffect`：这是一个**外部事实**（同一个
 * 页面里任何一层浮层都能改变它），而外部事实的首帧必须与渲染同步——用 state 的话，
 * 一个在挂载时就已被盖住的表面会先按「没被盖住」画一帧，再收到通知改正，那一帧里
 * 它会把该省的活干一遍。
 * @param me - 我自己是哪一层；默认 `'board'`（最底下那一层，被任何东西盖住都停）。
 * @returns 我上面有东西开着为真。
 */
export function useCovered(me: Layer = 'board'): boolean {
  const top = useSyncExternalStore(subscribe, snapshot, snapshot)
  /* 我上面 = 比我的序号更大的那一层。同一层永远不盖同一层：两个弹窗叠在一起时，底下
     那个仍然是「上面有东西」，而上面的那个不该因为自己在表里就把自己判成被盖住。 */
  return top > rankOf(me)
}
