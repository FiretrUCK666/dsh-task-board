/**
 * The board panel: the task board's seat in the shell's CENTRE STAGE.
 *
 * The board used to mount itself into the shell's DOM — hunt for the
 * conversation column by a `data-pane` attribute, keep a MutationObserver
 * watching for the frame to arrive, render a React root into an extra child
 * appended to the shell's own grid item, and hide the conversation with a
 * `<html>` attribute plus a stylesheet rule. Every one of those steps was a
 * guess about shell internals: the attribute disappeared in a host upgrade, and
 * the fallback (`[class*="centerCol"]`) matched a CSS-Module hash that changes
 * whenever the shell rebuilds — so the board could silently stop appearing with
 * no error anywhere.
 *
 * This component is registered into the official `main` slot instead. That slot
 * IS the centre stage (`activePanelId: null` means the Conversation), it is
 * keyed (one panel per key, the same mechanism the shipped Plugins panel uses),
 * and `ctx.layout.selectPanel` is the official way to bring a panel forward.
 * Nothing here reads or writes shell DOM, so nothing here can break when the
 * shell's markup changes.
 *
 * The width contract is unchanged and now STRUCTURAL: `[data-dsh-taskboard-view]`
 * stays a named inline-size container, and the shell's three-column grid hands
 * the panel its real width — which is what the board's `@container` rules
 * already measured against (never the viewport).
 *
 * `boardOpen` is driven from the panel's own mount lifetime (one source: the
 * stage is showing exactly when this component is mounted), so the controller's
 * snapshot and the visible stage can never disagree.
 */
import type { BoardController } from '../core/controller.ts';
import type { BundleFreshnessState } from './bundle-freshness.ts';
/** Props the shell's `main` slot renderer binds for this panel. */
export interface TaskBoardPanelProps {
    /**
     * The live board, injected through the slot's inject face. `undefined` until
     * the background mount settles (and again after disposal) — the panel is
     * contributed at apply time so the shell can always resolve its row to a
     * stage, which is why "not ready yet" is a rendered state rather than a
     * reason not to register. Spelled as a union rather than `?:` so the inject
     * face can hand over an explicitly absent controller without a cast.
     */
    controller: BoardController | undefined;
    /**
     * The live stale-bundle verdict, published on the same inject face as the
     * controller and withdrawn with it. Optional so a composition that publishes
     * no verdict still mounts the board; when absent the board renders no status
     * line (see bundle-freshness.ts).
     */
    freshness?: BundleFreshnessState;
}
/**
 * Render the task board as a centre-stage panel.
 * @param props - the injected controller and freshness state.
 * @returns the board surface, or the loading state while the board is not ready.
 */
export declare function TaskBoardPanel({ controller, freshness }: TaskBoardPanelProps): import("react").JSX.Element;
