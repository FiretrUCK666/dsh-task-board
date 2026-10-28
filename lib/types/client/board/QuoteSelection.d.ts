/**
 * 挂在面板上的引用手势。
 *
 * @param props.host - 负责裁决的面板根节点（选区必须落在它之内）；尚未挂载时传 null。
 * @param props.onQuote - 收下已经编码好的引用文本。
 */
export declare function QuoteSelection({ host, onQuote }: {
    host: HTMLElement | null;
    /** 插入这段引用（已经逐行带 `> ` 前缀）。 */
    onQuote: (quote: string) => void;
}): import("react").ReactPortal | null;
