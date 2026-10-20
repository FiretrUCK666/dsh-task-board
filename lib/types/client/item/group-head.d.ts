import { type ItemMarkId } from './marks.tsx';
/** 那一句解释的把手：谁来开、开没开、说的是哪一块。 */
interface GroupNoteHandle {
    /** 那句话所在元素的 id（`aria-controls` 指过去）。 */
    readonly id: string;
    readonly open: boolean;
    readonly onToggle: () => void;
    /** 这枚按钮的可达名——它要说清叫出来的是**哪一句**，而不是「按钮」。 */
    readonly label: string;
}
/**
 * 一句按需解释的**一个实例**：它自己的开关、它自己的 id。
 *
 * `useId` 而不是手写字符串：这个面板可以在同一页里出现两次（看板与清单各一个舞台），
 * 手写的 id 会在第二份里撞车，而撞车之后 `aria-controls` 指向的是**另外那一份的那句话**。
 *
 * 它住在这一份文件里而不是各页各写一遍：三个消费点（日程页两种节头、安静行、新建那张纸
 * 的看板卡片）用的是**同一件事**，而三份 `useState` 里迟早有一份忘了复位。
 * @param label - 这枚按钮的可达名。
 * @returns 那枚按钮要的把手（`id` 与 `open` 也在里面，容器读它挂 `data-note`）。
 */
export declare function useNote(label: string): GroupNoteHandle;
/**
 * 那句解释的入口：一枚 `InfoMark` 包在真按钮里。
 *
 * **它按得动，而它旁边那块按不动**——所以按钮、可达名与两个 ARIA 属性是承重的，不是装饰
 * （硬性规范 11③：触屏没有悬停，承载必要信息的说明不能只挂 `title=`）。
 *
 * 尺寸由调用点给，因为记号要跟它所在那一行的字阶同档：一节的头（15）比属性表里的一格（12）
 * 大一号。**记号的边长是这一族唯一的自由度**——着色、命中区、对齐都由 `.itemGroupWhy` 说。
 * @param props - 哪一句的把手，记号多大。
 * @returns 那枚按钮。
 */
export declare function NoteEntry(props: {
    readonly note: GroupNoteHandle;
    readonly size?: number;
}): React.ReactElement;
interface GroupHeadProps {
    /** 谁在说话：一块内容的题，还是一段列表的说明。 */
    readonly as?: 'heading' | 'presentation';
    /** 字阶两档，见文件头。 */
    readonly size?: 'section' | 'segment';
    /** 这一组戴哪一枚记号；不戴就给 `undefined`（不是每一组都有记号可戴）。 */
    readonly mark?: ItemMarkId;
    readonly word: string;
    readonly count: string;
    /** 按天分的那几节：那一天的读数。 */
    readonly when?: string;
    readonly note?: GroupNoteHandle;
}
/**
 * 一枚组头。
 * @param props - 谁在说话、字阶、记号、词、数、日期，以及那句解释的把手。
 * @returns 那一行头。
 */
export declare function GroupHead(props: GroupHeadProps): React.ReactElement;
export {};
