import type { BoardController } from '../../core/controller.ts';
import type { SessionContext } from './use-interaction.ts';
/** The deterministic context readout (see module doc): self-contained — the
 *  collapsed/expanded state and the outside-click dismissal live here.
 *  `className` lets a surface switch the expanded panel from its DEFAULT
 *  popover to the IN-FLOW dock row: the review/session header passes
 *  `.reviewHeaderContext` (the open wrap dissolves so the panel joins the
 *  header grid as its own full-width row).
 *  `sessionId` + `controller` switch the goal row from the read-only legacy
 *  text to the interactive goal strip (pause / resume / edit / clear through
 *  the official verbs); absent = read-only (old hosts without remote.goals). */
export declare function SessionContextBlock({ context, className, sessionId, controller }: {
    context: SessionContext;
    className?: string;
    sessionId?: string;
    controller?: BoardController;
}): import("react").JSX.Element | null;
