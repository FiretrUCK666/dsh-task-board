import { DEFAULT_VIEW_PREFS } from './view-prefs.ts';
import type { ItemListFace } from './register.tsx';
export interface ItemListPanelProps {
    readonly face: ItemListFace;
    readonly signal: AbortSignal;
    /**
     * WHICH ROW IS OPEN IN PLACE AT MOUNT, for the capture bench only.
     *
     * The expansion is the largest thing on this panel and the only state a static
     * render cannot reach by itself — `renderToStaticMarkup` presses nothing. So the
     * bench names a row here, and the product code has no idea a capture exists.
     */
    readonly openRow?: string;
    /**
     * THE CLOCK TO START FROM, for the capture bench only.
     *
     * Every date on this panel is judged against one instant, and the bench cannot
     * supply that instant any other way: the panel owns its clock, so rows dated
     * relative to the bench's `NOW` were being read against the real `Date.now()`.
     * The two numbers are each individually plausible, which is why nothing caught it
     * — a fixture built to be nine days late simply photographed as fifteen days late.
     *
     * A SEED, not an override: the panel ages from here either way, so a seeded
     * capture still ticks, and a real panel starts at the real clock.
     */
    readonly now?: number;
}
/**
 * The page body.
 * @param props - the slot's injected face and the plugin's own lifetime.
 * @returns the workbench, or the loading state while the replica settles.
 */
export declare function ItemListPanel(props: ItemListPanelProps): import("react").JSX.Element;
/** Re-exported so the panel's own contract test can name the defaults. */
export { DEFAULT_VIEW_PREFS };
