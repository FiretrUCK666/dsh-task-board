import type { BoardController } from '../../core/controller.ts';
import type { RunConfigPresetConfig } from '../../core/run-presets.ts';
export interface RunConfigBlockProps {
    /** 这一刻要显示的那份配置（卡上的，或这一次要用的草稿）。 */
    readonly config: RunConfigPresetConfig;
    /** 折叠头上那一句：这一份是「默认设置」还是「已指定 N 项」。 */
    readonly summary: string;
    /** 只在没挂卡时给的一句话（这一份要跟到哪儿去）。 */
    readonly note?: string | undefined;
    readonly controller: BoardController;
    /** 工作区那一行显示成什么名字；缺席就照 id 写。 */
    readonly workspaceTitleOf?: ((workspaceId: string) => string) | undefined;
    /** 读者按「保存」时把整份配置交给谁（写卡，或写草稿）。 */
    readonly onSave: (next: RunConfigPresetConfig) => void;
}
/**
 * The block.
 * @param props - what it shows, and where a saved value goes.
 * @returns the disclosure with the five rows, the editor behind 改, and the note.
 */
export declare function RunConfigBlock(props: RunConfigBlockProps): import("react").JSX.Element;
