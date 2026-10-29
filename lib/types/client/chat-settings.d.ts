import { type WorkStepsPrefs } from './board/work-steps.ts';
import type { ClientContext } from './platform.ts';
/** 官方设置命名空间（`CHAT_SETTINGS_NAMESPACE`）。 */
export declare const CHAT_SETTINGS_NAMESPACE = "ui-chat";
/**
 * 当下这一份设置（给非 React 的读取点与测试用）。
 * @returns 三件事，永远完整。
 */
export declare function workStepsNow(): WorkStepsPrefs;
/**
 * 根部绑定一次：读官方 `ui-chat` 设置并跟随它的变化。
 *
 * 重复调用是幂等的（同一个上下文只订一次），因为它在 `ctx.effect` 里，
 * 而 effect 在热重载时可能重跑。
 * @param ctx - 客户端 cordis 上下文。
 * @returns 解绑函数（随 effect 清理）。
 */
export declare function bindWorkSteps(ctx: ClientContext): () => void;
/**
 * 订阅当前设置（React 读者）。
 *
 * `useSyncExternalStore` 而不是 `useEffect` + `useState`：设置是**外部事实**，
 * 而外部事实的读法必须与渲染同步——否则首帧会画一次默认值、下一帧再跳到真值，
 * 读者看到折行闪一下。
 * @returns 三件事，永远完整。
 */
export declare function useWorkSteps(): WorkStepsPrefs;
