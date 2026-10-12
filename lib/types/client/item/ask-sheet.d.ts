import type { BoardController } from '../../core/controller.ts';
import type { RunConfigPresetConfig } from '../../core/run-presets.ts';
export interface AskSheetProps {
    readonly open: boolean;
    readonly onClose: () => void;
    /** `ask` = 交给它（存下配置并且马上发出去）；`save` = 只存下配置。 */
    readonly verb: 'ask' | 'save';
    /** 这一条自己的话要送出去什么（一行摘要，读者按之前能读到）。 */
    readonly summary: string;
    readonly config: RunConfigPresetConfig;
    readonly onConfig: (next: RunConfigPresetConfig) => void;
    readonly controller: BoardController;
    /** 那一次已经发出去、还没回来（按钮在这一刻禁用，免得连按两次）。 */
    readonly busy: boolean;
    /** 主按钮那一下：`ask` 时是「建卡 / 写配置 / 发出去」，`save` 时是「写进那张卡」。 */
    readonly onSubmit: () => void;
}
/**
 * The sheet.
 * @param props - whether it is open, which verb it carries, and what it will send.
 * @returns the overlay, or nothing.
 */
export declare function AskSheet(props: AskSheetProps): import("react").JSX.Element | null;
