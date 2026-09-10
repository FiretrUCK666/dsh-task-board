/**
 * The sidebar footer action entry: the task-board's OFFICIAL sidebar seat.
 *
 * Registers into the shell's `sidebar.footer.action` slot — a LIST-kind hole
 * beside Settings, declared by the sidebar's own SidebarRoot. It is the only
 * third-party sidebar affordance the shell renders in EVERY presentation
 * (wide column, collapsed rail and the mobile overlaid drawer are the same
 * React tree, so the entry is always rendered). This REPLACES the old
 * DOM-injection row (`sidebar-entry.ts`), which only landed in the column's
 * inner subtree — the mobile overlaid render never showed it, which is the
 * root of the "按钮时隐时现" problem.
 *
 * The component is plain React (the shell renders it with the slot's owner
 * props); the controller is the bridge to the board: a `toggle` callback and
 * a `boardOpen` snapshot. mountUiBody binds the real board controller once
 * the UI mounts; before that the row renders but clicks are inert (a bound
 * board always arrives within the frame the board mounts).
 */
import type { SnapshotSelector } from './platform.ts';
import { type SnapshotStore } from './platform.ts';
/** The footer action's display state (what the component renders). */
export interface SidebarFooterState {
    /** Whether the board is currently open (accent highlight). */
    boardOpen: boolean;
    /**
     * A click arrived before the board bound (mountUiBody still syncing): the
     * open intent is queued and will fire the instant the board is bound. Until
     * then the row shows the waiting treatment — a click is never silently
     * swallowed (the "点了没反应" on slow tunnels).
     */
    pendingOpen: boolean;
}
/** The registration-side face the slot entry injects. */
export interface SidebarFooterFace {
    hooks: {
        sidebarFooter: SnapshotStore<SidebarFooterState>;
    };
    /** Request the board to toggle (queues until bound; never a silent drop). */
    toggle: () => void;
}
/**
 * The footer action controller: owns the display snapshot and the toggle
 * callback. The toggle is a settable handle — mountUiBody binds the real
 * board controller later, so this controller can be created (and the slot
 * registered) before the heavier board stack exists. A click before binding
 * is QUEUED (pendingOpen) and fires on bindBoard — the slow-network window
 * where the board is still syncing never eats a user's tap.
 */
export declare class SidebarFooterController {
    private store;
    private open;
    private pending;
    private toggleFn;
    /** Bind the board's toggle callback (and its open state) once the UI mounts.
     *  A queued click fires immediately; the pending flag clears. */
    bindBoard(open: () => boolean, toggle: () => void): void;
    /** Reflect a board open/close transition into the row's highlight. */
    setOpen(open: boolean): void;
    /** Detach the board and clear the highlight (disposal path). */
    dispose(): void;
    /**
     * Build the face the slot registration injects. Called once by the slot
     * machinery; the component receives the snapshot store via useSidebarFooter.
     */
    inject(): SidebarFooterFace;
    private publish;
}
/** Props the shell binds for the footer entry: owner share + inject face. */
type SidebarFooterProps = {
    wide: boolean;
} & {
    useSidebarFooter: SnapshotSelector<SidebarFooterState>;
} & {
    toggle: () => void;
};
/**
 * Render the sidebar footer action: a labeled row in the wide column, an icon
 * in the rail/collapsed form. The shell supplies `wide` (its column state);
 * the accent shows while the board is open, and the pending treatment while a
 * queued click is waiting for the board to bind (slow network).
 */
export declare function SidebarFooter(props: SidebarFooterProps): import("react").JSX.Element;
export {};
