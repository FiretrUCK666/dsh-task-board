import { type ItemKeyActions, type KeyState } from './keyboard.ts';
export interface UseItemKeysOptions {
    /** What the flow knows when a key is pressed. */
    readonly state: KeyState;
    /** One handler per action the map names. Closed, so a name cannot go missing. */
    readonly actions: ItemKeyActions;
    /** The panel's own root, or `null` before it is mounted. */
    readonly surfaceRef: React.RefObject<HTMLElement | null>;
}
/**
 * Listen for the item panel's keys, for as long as the component is mounted.
 *
 * The flow answers a keydown when it is aimed at this panel's subtree, or when
 * it is aimed at nothing (the focus fell back to the body — the state a blank
 * click leaves). Everything else is someone else's key.
 *
 * @param options - the flow's state, its handlers, and the panel's root.
 * @returns nothing; the effect owns the listener and returns the disposer.
 */
export declare function useItemKeys(options: UseItemKeysOptions): void;
