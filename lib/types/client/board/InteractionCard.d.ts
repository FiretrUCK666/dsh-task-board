import type { BoardController } from '../../core/controller.ts';
import { type WireQuestion } from '../../core/question-rpc.ts';
/** The interaction card (see module doc). Renders nothing while idle. */
export declare function InteractionCard({ question, shellWaiting, sessionId, controller }: {
    /** Parsed wire content; absent with `shellWaiting` = proven wait, unknown body. */
    question: WireQuestion | undefined;
    /** Honest fallback kind when the session list proves a wait but no content
     *  parsed (carrier-shape drift, present or future host) — renders the shell
     *  card instead of blank nothing. Absent with `question` = idle. */
    shellWaiting?: 'plan-review' | 'question';
    sessionId: string;
    controller: BoardController;
}): import("react").JSX.Element | null;
