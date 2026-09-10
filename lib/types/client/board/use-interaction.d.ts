import type { BoardController } from '../../core/controller.ts';
import type { WireQuestion } from '../../core/question-rpc.ts';
import { type SessionTodo } from './interaction.ts';
/** The goal/subagent readout (structural, degraded). The official `goal`
 *  projection wins when served; the session-state bridge is the fallback. */
export interface SessionGoalView {
    title: string;
    active: boolean;
    /** Durable goal identity (projection only — the bridge has no id). */
    id?: string;
    /** Durable lifecycle phase when read from the official `goal` projection. */
    phase?: 'active' | 'paused' | 'blocked' | 'complete';
    /** Admitted goal rounds (projection only). */
    roundsStarted?: number;
    /** Blocker explanation (exactly while phase is `blocked`). */
    blockedReason?: {
        code: string;
        message: string;
    };
    /** Process-local continuation eligibility (official activation hook); the
     *  transcript poll never writes it — it arrives via `remote.goals.get`
     *  once plus `goal/activation-changed`, and survives re-polls while the
     *  goal id is unchanged. */
    activation?: 'armed' | 'disarmed';
}
export interface SessionSubagentView {
    title: string;
    status?: string;
}
/** The full session-context read (all blocks optional by availability). */
export interface SessionContext {
    /** The latest `todo/write` snapshot, if the session ever wrote one. */
    todos?: readonly SessionTodo[];
    /** The active native goal, if any. */
    goal?: SessionGoalView;
    /** Child subagents of the session, if any. */
    subagents?: readonly SessionSubagentView[];
}
/** One 3s poll: transcript → todos; bridge → goal + subagents. The board's
 *  tree stays mounted while hidden (the conversation view takes over), so the
 *  poll pauses whenever the board is not visible — `data-dsh-taskboard-active`
 *  on <html> is the ONE visibility marker (board-mount owns it) — and resumes
 *  with an immediate refresh the moment the board reappears. */
export declare function useSessionContext(controller: BoardController, sessionId: string | undefined): SessionContext;
/**
 * What the comment interface shows for a session's wait: parsed content, or —
 * when the session list proves a plan/question wait but no content parsed —
 * an honest shell (kind + navigate) instead of blank nothing. The shell is
 * the backstop against carrier-shape drift on any present or future host:
 * a proven wait can never again reach the UI as silence. Every surface with
 * a comment composer reads this one hook (review page, session panel,
 * refinement answers) — never useWireQuestion directly for display.
 */
export declare function useAwaitingCard(controller: BoardController, sessionId: string | undefined): {
    question: WireQuestion | undefined;
    shell: 'plan-review' | 'question' | undefined;
};
