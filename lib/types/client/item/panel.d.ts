import type { ItemListFace } from './register.tsx';
/** The panel's props: the slot's own tab hook plus the face we inject. */
export interface ItemListPanelProps {
    useTabInfo: () => unknown;
    face: ItemListFace;
}
/**
 * The page body.
 * @param props - the slot's tab hook and the injected face.
 * @returns the list, its degraded state, or its loading state.
 */
export declare function ItemListPanel(props: ItemListPanelProps): import("react").JSX.Element;
