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
 * @param options - the flow's state, its handlers, and the box to listen on.
 * @returns nothing; the effect owns the listener and returns the disposer.
 */
export declare function useItemKeys(options: UseItemKeysOptions): void;
