/**
 * 检查更新的对话框。**每一页都渲染同一份**，所以每个页面说到做到。
 *
 * 关着的时候返回 `null`：它常驻在页面上，但闭着时不该留任何痕迹（不占布局、
 * 不参与键盘）。
 * @returns the dialog, or `null` while it is closed.
 */
export declare function UpdateDialog(): import("react").JSX.Element | null;
