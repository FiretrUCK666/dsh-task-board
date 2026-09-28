import { DEFAULT_VIEW_PREFS } from './view-prefs.ts';
import type { ItemListFace } from './register.tsx';
export interface ItemListPanelProps {
    readonly face: ItemListFace;
    readonly signal: AbortSignal;
}
/**
 * The page body.
 * @param props - the slot's injected face and the plugin's own lifetime.
 * @returns the workbench, or the loading state while the replica settles.
 */
export declare function ItemListPanel(props: ItemListPanelProps): import("react").JSX.Element;
/** Re-exported so the panel's own contract test can name the defaults. */
export { DEFAULT_VIEW_PREFS };
