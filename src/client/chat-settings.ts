/**
 * 官方「工作步骤」那三个开关的**客户端唯一入口**：评论区跟随设置页，不再自己维护一套。
 *
 * ── 为什么读官方那一份，而不是自己做一套开关 ────────────────────────────────
 *
 * 同一件事两个开关，迟早一处改了另一处不动，而屏上不会有人说一句话。读者在
 * 「设置 · 通用设置」里选的就是这三项（工作步骤展示 / 收起时机 / 收起后显示的回复），
 * 评论区照那个画——两处永远一致，我们一行设置界面都不用维护。
 *
 * ── 为什么按名读、不进 `inject` ─────────────────────────────────────────────
 *
 * `configForms` 由 `dsh-client-ui-settings` 提供。本插件的 `inject` 每多一项，
 * 在「那个半区永不激活」的部署里就要多等一个服务；而这里的正确行为是**缺席即降级**
 * （读不到就用产品默认，功能照样完整），所以走 `ctx.get` 并容忍 `undefined`。
 * 这与宿主契约表里「按名读的宿主服务」那一栏是同一条纪律。
 *
 * ── 为什么是一个模块级单例，而不是一路传 props ─────────────────────────────
 *
 * 读到它的地方（评论区的两个会话面板）在组件树很深处，而它们与「设置」之间没有任何
 * 其它关系。把上下文一路传下去等于给中间每一层加一个它不用的参数；而绑定这件事
 * 全插件只该发生一次（有一个 `configForms` 订阅就够）。这与 `locale` 是同一个形状：
 * **根部绑一次，叶子按需读**。
 *
 * ── 读不到时说什么 ──────────────────────────────────────────────────────────
 *
 * 只认 `status: 'ready'` 的快照。加载中、命名空间不存在、读失败——三种情况都
 * **保留上一次的好值**：一次读失败不等于「读者把设置改了」，把默认值顶上去会让屏幕
 * 在读者眼前跳一下，而那一跳没有解释。
 */
import { useSyncExternalStore } from 'react'
import {
  DEFAULT_WORK_STEPS,
  prefsOf,
  type WorkStepsPrefs,
} from './board/work-steps.ts'
import type { ClientContext } from './platform.ts'

/** 官方设置命名空间（`CHAT_SETTINGS_NAMESPACE`）。 */
export const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

/**
 * `configForms` 服务里本模块用到的那两个成员。
 *
 * 只声明用到的那两个：声明得比用的多，会在宿主换实现时先红在这里，而红的原因
 * 与这次改动无关。`getSnapshot()` 是稳定引用（每次变更才换），正好喂给
 * `useSyncExternalStore`。
 */
interface ConfigFormsFace {
  get<T>(entryId: string): {
    getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: T | undefined }
    subscribe(listener: () => void): () => void
  }
}

/** 当前值（读不到时是产品默认）。 */
let current: WorkStepsPrefs = DEFAULT_WORK_STEPS
const listeners = new Set<() => void>()

/**
 * 换一个新值并通知所有读者；值没变就不通知（避免无意义的重渲染）。
 * @param next - 新的三件事。
 */
function publish(next: WorkStepsPrefs): void {
  if (next.view === current.view
    && next.collapseTiming === current.collapseTiming
    && next.foldedReplies === current.foldedReplies) return
  current = next
  for (const listener of listeners) listener()
}

/**
 * 当下这一份设置（给非 React 的读取点与测试用）。
 * @returns 三件事，永远完整。
 */
export function workStepsNow(): WorkStepsPrefs {
  return current
}

/**
 * 根部绑定一次：读官方 `ui-chat` 设置并跟随它的变化。
 *
 * 重复调用是幂等的（同一个上下文只订一次），因为它在 `ctx.effect` 里，
 * 而 effect 在热重载时可能重跑。
 * @param ctx - 客户端 cordis 上下文。
 * @returns 解绑函数（随 effect 清理）。
 */
export function bindWorkSteps(ctx: ClientContext): () => void {
  const forms = ctx.get<ConfigFormsFace>('configForms')
  if (forms === undefined || forms === null) return () => {}
  let form: ReturnType<ConfigFormsFace['get']>
  try {
    form = forms.get<unknown>(CHAT_SETTINGS_NAMESPACE)
  } catch {
    /* 服务在、但这个命名空间没被这个部署提供：读不到就是读不到，保留默认。 */
    return () => {}
  }
  if (form === undefined || form === null || typeof form.subscribe !== 'function') return () => {}
  const read = (): void => {
    let snapshot: ReturnType<typeof form.getSnapshot>
    try {
      snapshot = form.getSnapshot()
    } catch {
      /* 读一次失败不等于读者改了设置：保留上一次的好值。 */
      return
    }
    /* 只有 ready 才采纳；loading / unavailable 保留上一次的好值。 */
    if (snapshot.status !== 'ready') return
    publish(prefsOf(snapshot.value))
  }
  read()
  return form.subscribe(read)
}

/**
 * 订阅当前设置（React 读者）。
 *
 * `useSyncExternalStore` 而不是 `useEffect` + `useState`：设置是**外部事实**，
 * 而外部事实的读法必须与渲染同步——否则首帧会画一次默认值、下一帧再跳到真值，
 * 读者看到折行闪一下。
 * @returns 三件事，永远完整。
 */
export function useWorkSteps(): WorkStepsPrefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    workStepsNow,
    workStepsNow,
  )
}
