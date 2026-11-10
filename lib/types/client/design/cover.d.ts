/**
 * 登记一层覆盖，直到它卸载。
 *
 * `active` 为假时不登记——一个只画一帧的浮层不构成「盖住」。传假值而不是不调用这个
 * hook，是为了让调用者不必把 hook 放进条件里（那会让 hook 的个数随渲染变化）。
 * @param active - 这一层此刻是否真的在屏幕上。
 */
export declare function useCover(active?: boolean): void;
/**
 * 读者此刻是不是被一层浮层盖着。
 *
 * `useSyncExternalStore` 而不是 `useState` + `useEffect`：这是一个**外部事实**（同一个
 * 页面里任何一层浮层都能改变它），而外部事实的首帧必须与渲染同步——用 state 的话，
 * 一个在挂载时就已被盖住的表面会先按「没被盖住」画一帧，再收到通知改正，那一帧里
 * 它会把该省的活干一遍。
 * @returns 盖着为真。
 */
export declare function useCovered(): boolean;
