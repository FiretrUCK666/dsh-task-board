import { type ReactNode } from 'react';
import type { BoardController } from '../../core/controller.ts';
import type { SessionContext } from './use-interaction.ts';
/** The shared panel frame (see module doc). */
export declare function SessionFrame({ title, badge, ariaLabel, actions, context, contextSessionId, controller, main, rail, onClose }: {
    /** Panel title (the task title on both surfaces). */
    title: string;
    /** Optional type badge text — its family identity; absent hides the badge. */
    badge?: string;
    /** Dialog aria-label. */
    ariaLabel: string;
    /** Header actions (refresh / view session). */
    actions: ReactNode;
    /** The session's live context readout (todos/goal/subagents): lives in the
     *  header, one horizontal plane beside 刷新 (the user's ask). Wide = inline
     *  popover placed between the title and the actions; narrow = the second
     *  header line's left member. */
    context?: SessionContext;
    /** The session the context belongs to: with `controller` it switches the
     *  goal row to the interactive strip (pause / resume / edit / clear). */
    contextSessionId?: string;
    controller?: BoardController;
    /** Left column: the conversation region (caller owns its scroll region). */
    main: ReactNode;
    /** Right column: the rail (caller owns its content). */
    rail: ReactNode;
    onClose: () => void;
}): import("react").ReactPortal;
