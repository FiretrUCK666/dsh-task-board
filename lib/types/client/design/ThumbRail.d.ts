export interface ThumbRailProps {
    /** 栏杆里有什么：通常是一件主行动加一两枚常用动作。 */
    readonly children: React.ReactNode;
    /** 无障碍用的名字：这一条是什么（「看板的动作」这类）。 */
    readonly label: string;
}
/**
 * 底部栏杆。
 *
 * 它的定位由**父容器**决定（父容器必须是 `position: relative` 的滚动区）：这里是
 * `position: absolute` 而不是 `fixed`——`fixed` 会相对视口、盖到宿主侧栏上，而这个
 * 栏杆只属于这一页的列区。
 * @param props - 里面装什么，叫什么名字。
 * @returns 贴在容器底部的那一条。
 */
export declare function ThumbRail({ children, label }: ThumbRailProps): React.ReactElement;
