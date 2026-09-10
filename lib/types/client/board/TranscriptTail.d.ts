/**
 * Shared transcript-tail component: the scrollable conversation tail with
 * auto-follow and the sticky "滑到最新" button. Used by the review page
 * and the refinement panel so every live session surface looks and behaves
 * identically.
 */
import type { BoardController } from '../../core/controller.ts';
/** A live conversation tail in its own scroll region. */
export declare function TranscriptTail({ controller, sessionId, maxLines, reloadKey, className }: {
    controller: BoardController;
    /** The session whose tail to show (undefined = idle/empty). */
    sessionId: string | undefined;
    /** How many trailing lines to render (default: all). */
    maxLines?: number;
    /** A value whose change forces a full reload (e.g. execution count). */
    reloadKey?: unknown;
    /** Extra class on the scroll container (e.g. the refinement panel's sizing). */
    className?: string;
}): import("react").JSX.Element;
