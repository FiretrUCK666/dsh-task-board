import type { ItemRecord } from '../../core/item.ts';
import { itemRowViewOf, type ItemDensity, type ItemEdit } from './model.ts';
import type { ItemListFace, ItemTabHookContext } from './register.tsx';
/** The panel's props: the slot's own tab hook plus the face we inject. */
export interface ItemListPanelProps {
    useTabInfo: () => ItemTabHookContext;
    face: ItemListFace;
}
/**
 * One row of the list. Clicking it opens level 1 in place.
 *
 * Exported so the detail — the part a reader can actually fill in — can be
 * rendered with it OPEN in a test. Asserting "this control exists" against a
 * collapsed row proves nothing: the control is not in the DOM at all until the
 * row is open, and a test that pretended otherwise would have been testing a
 * fiction.
 */
export declare function ItemRow(props: {
    readonly view: ReturnType<typeof itemRowViewOf>;
    readonly density: ItemDensity;
    readonly english: boolean;
    readonly expanded: boolean;
    readonly fresh: boolean;
    readonly panelId: string;
    readonly onToggle: () => void;
    readonly onEdit: (edit: ItemEdit) => void;
    readonly onToggleStep: (stepId: string) => void;
    readonly onRemove: () => void;
    /** The board cards this item may hang off, already titled. */
    readonly cards: readonly {
        readonly id: string;
        readonly title: string;
    }[];
    /** The title of the card it currently hangs off, or undefined if it has none. */
    readonly linkedCardTitle: string | undefined;
}): import("react").JSX.Element;
/** The stored value behind a status the reader picked. */
export declare function storedStatusFor(picked: string): ItemRecord['status'];
/**
 * The page body.
 * @param props - the slot's tab hook and the injected face.
 * @returns the list, its degraded state, or its loading state.
 */
export declare function ItemListPanel(props: ItemListPanelProps): import("react").JSX.Element;
