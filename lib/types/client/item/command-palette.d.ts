import { type ItemQuery, type ItemSort } from '../../core/item-view.ts';
import { type ItemRecord } from '../../core/item.ts';
/** One answer in the palette: a label, and what pressing it does. */
export interface PaletteAction {
    /**
     * The action's own name, and the only thing the palette routes on.
     *
     * A `page-` id is a way to GET somewhere and lands on its own row; every other
     * id is something to DO and lands on the actions row. One convention, in the
     * name the panel already gives each action, rather than a second list the two
     * halves would have to keep in step.
     */
    readonly id: string;
    readonly label: string;
    readonly run: () => void;
}
/**
 * WHAT THE PANEL'S KEY MAP CAN ASK OF THE BOX.
 *
 * The candidate cursor is state HERE — it is derived from this component's own
 * text, this component's own options — so the map cannot compute it and the box
 * cannot be navigated by a table that has never seen a candidate. So the box
 * publishes the four commands and the panel calls them: one direction, no second
 * copy of the candidate list, and no callback that reaches back into this
 * component's state by another name.
 */
export interface PaletteCommands {
    /** Move the candidate cursor, wrapping at both ends. */
    readonly step: (by: number) => void;
    /** Run the candidate under the cursor. */
    readonly pick: () => void;
    /** Open the key help sheet. */
    readonly showKeys: () => void;
}
export interface ItemCommandPaletteProps {
    readonly open: boolean;
    /** The whole query, exactly as the reader typed it. The ONLY state. */
    readonly text: string;
    readonly onText: (next: string) => void;
    readonly query: ItemQuery;
    readonly tags: readonly (readonly string[])[];
    readonly sort: ItemSort;
    readonly onSort: (next: ItemSort) => void;
    /** Set a priority on whatever the cursor is on. Undefined before a row is chosen. */
    readonly onPriority: ((priority: ItemRecord['priority']) => void) | undefined;
    /** The rows to offer as jump targets. */
    readonly rows: readonly ItemRecord[];
    readonly actions: readonly PaletteAction[];
    readonly onPickRow: (id: string) => void;
    readonly onClose: () => void;
    /**
     * The palette has just closed, and the focus is owed to whatever opened it.
     *
     * A MODAL SURFACE OWES THE FOCUS BACK, and the box cannot give it back to a
     * button it does not own: the reader pressed `⌘K` and the focus is in a field
     * they cannot see from, so closing it leaves the panel with no focus at all and
     * the next key they press answers to nothing. The caller knows which control
     * opened the box, so it takes this call and gives the focus to that control.
     */
    readonly onClosed?: () => void;
    /**
     * The candidate cursor, as commands — see {@link PaletteCommands}. Optional
     * because a caller that renders the palette without the key map (a screenshot,
     * a story) has nothing to call them with.
     */
    readonly onCommands?: (commands: PaletteCommands | undefined) => void;
}
export declare function ItemCommandPalette(props: ItemCommandPaletteProps): import("react").JSX.Element;
