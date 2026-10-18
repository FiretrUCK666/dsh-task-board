/**
 * 一页的总览。
 *
 * @param props.now - 这一次读数的时刻，注入进 `summaryOf`。截图台用它把「今天」钉在
 *   夹具那一天；产品里不传，读真实时钟。它是一个种子而不是覆盖：页面照样跟着看板重画。
 * @returns 页面本身。
 */
export declare function HomePage({ now }: {
    readonly now?: number;
}): import("react").JSX.Element;
