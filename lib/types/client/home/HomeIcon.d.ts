/** shell 给面板列表项绑定的 props。 */
export interface HomeIconProps {
    /** 请求的方形边长（宽栏与图标栏两档由 shell 决定）。 */
    size: number;
    /** 这一面板是否正显示在主栏里。 */
    active: boolean;
    /**
     * 离开总览（选回对话）。由注册方注入——它握着唯一那条出口，与「回到对话」同一个
     * `selectPanel(null)` 漏斗，所以「离开」在两个面板上不可能有两种意思。
     * 缺席 = 纯图标：不挂监听、不做切换，这一行仍然能把面板打开。
     */
    onExit?: () => void;
}
/**
 * 画出总览的图标；面板开着时把它接成「再按一下即离开」。
 * @param props - shell 给的图标份额，加上注入的出口。
 * @returns 图标元素。
 */
export declare function HomeIcon({ size, active, onExit }: HomeIconProps): import("react").JSX.Element;
