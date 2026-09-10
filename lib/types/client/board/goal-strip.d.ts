import type { BoardController } from '../../core/controller.ts';
import type { SessionGoalView } from './use-interaction.ts';
export declare function GoalStrip({ sessionId, controller, goal, activation }: {
    sessionId: string;
    controller: BoardController;
    /** The projected goal (undefined/null = the strip renders nothing). */
    goal: SessionGoalView | undefined | null;
    /** Process-local activation (unknown = treat an active goal as armed). */
    activation: 'armed' | 'disarmed' | undefined;
}): import("react").JSX.Element | null;
