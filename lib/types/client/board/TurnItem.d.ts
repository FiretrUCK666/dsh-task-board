import type { BoardController } from '../../core/controller.ts';
import { type WorkStepsPolicy, type WorkStepsPrefs } from './work-steps.ts';
import type { TranscriptTurn } from './review-transcript.ts';
/**
 * 一轮对话。
 *
 * 折与不折由 `shouldFoldTurn` 判，**不在这里再判一次**：判据只有一个家，
 * 两处各判一次就会在某个组合下互相打架，而屏上看起来只是「有时候不折」。
 */
export declare const TurnItem: import("react").NamedExoticComponent<{
    turn: TranscriptTurn;
    policy: WorkStepsPolicy;
    /** 它是不是最新那一轮（`next-input` 时机要用）。 */
    isLatest: boolean;
    /** 读者把这一折点开了吗（由 `SessionTranscript` 记，跨重渲染保持）。 */
    open: boolean;
    onToggle: () => void;
    sessionId?: string;
    controller?: BoardController;
}>;
/**
 * 一组轮：把策略算一次，逐轮画。
 *
 * 每轮的折开状态存在这里（`Set<turn>`），因为它是**读者这一次看的时候的选择**，
 * 不是会话数据：重新读一次尾窗口不该把读者点开的折又合上。
 */
export declare const TurnList: import("react").NamedExoticComponent<{
    turns: readonly TranscriptTurn[];
    prefs: WorkStepsPrefs;
    sessionId?: string;
    controller?: BoardController;
    openTurns: ReadonlySet<string>;
    onToggle: (key: string) => void;
}>;
