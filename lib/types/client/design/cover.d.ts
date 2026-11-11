/**
 * 层的次序，从下到上。**这是唯一一处声明**：谁在谁上面是这一页结构上的事实，不是
 * 运行时判断出来的。
 *
 * 名字用读者看得懂的说法（看板 / 卡片详情 / 会话面板 / 弹窗），不用组件名——组件改名
 * 是常事，而「哪一层盖着哪一层」不是。
 */
export declare const LAYERS: readonly ["board", "detail", "panel", "dialog"];
/** 一层浮层的名字（见 {@link LAYERS}）。 */
export type Layer = (typeof LAYERS)[number];
/**
 * 登记一层覆盖，直到它卸载。
 *
 * 登记的生命周期**就是挂载的生命周期**：一层浮层只在它真的画在别人上面对才盖住别人，
 * 所以这个 hook 不接受「现在算不算」的参数——传假值而不调用它不是省事，是让调用方把
 * hook 放进条件里（hook 的个数会随渲染变化）。要判断一层「该不该在」，是调用方的事；
 * 一旦它在，它就盖住了下面。
 * @param layer - 这一层是哪一层（见 {@link LAYERS}）。
 */
export declare function useCover(layer: Layer): void;
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
export declare function useCovered(me?: Layer): boolean;
