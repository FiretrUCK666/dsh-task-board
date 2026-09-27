/** Whether the drawer is open, read fresh on every call. */
export declare function isDrawerOpen(): boolean;
/** Open the list. The one thing every outlet goes through. */
export declare function openDrawer(): void;
/** Close it, for the same reason. */
export declare function closeDrawer(): void;
/** Restore what the reader last had open. Called once, when composed. */
export declare function restoreDrawer(): void;
/** Re-read the store when it changes, so two outlets cannot disagree. */
export declare function useDrawerOpen(): boolean;
/** Forget the shared state with the plugin: nothing stays subscribed. */
export declare function resetDrawer(): void;
/**
 * The whole surface: the edge that is always there, and the panel when open.
 *
 * Rendered into the shell's `shell.overlay` seat, which is the official
 * frame-wide layer — a fresh id is added BESIDE the shipped ones, the layer
 * itself is click-through, and an entry opts back into pointer events. So the
 * collapsed edge never blocks the app, and the open panel floats above every
 * column without a hand-rolled portal into the shell's DOM.
 */
export declare function TaskDrawer(): import("react").JSX.Element;
