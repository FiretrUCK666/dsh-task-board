/** The narrow face of the right sidebar's controller that opening needs. */
export interface ListOpenerFace {
    readonly mounted: {
        getSnapshot(): string | undefined;
        subscribe(fn: () => void): () => void;
    };
    openTab(kind: string, options?: Record<string, unknown>): void;
}
/** How a surface asks the question. */
export interface ListLauncher {
    /** True only while a sidebar seat is actually on screen. */
    available(): boolean;
    /** Open the list. `false` means there was no seat — never a pretend success. */
    open(): boolean;
    /** Follow the seat, so a button can appear and disappear with it. */
    subscribe(onChange: () => void): () => void;
}
/**
 * Build the real launcher over one sidebar controller.
 *
 * Exported so a test can drive it without a shell, and so the rule lives in
 * exactly one place.
 * @param sidebar - the controller, or undefined when it is not composed.
 * @returns a launcher that refuses when there is no seat.
 */
export declare function makeListLauncher(sidebar: ListOpenerFace | undefined): ListLauncher;
/** Publish the launcher while this plugin is composed. */
export declare function publishListLauncher(sidebar: ListOpenerFace | undefined): () => void;
/** The current launcher, without a subscription. */
export declare function listLauncher(): ListLauncher;
/**
 * The launcher, subscribed to the seat it depends on.
 *
 * Re-renders exactly when the seat appears or goes: that is the moment the
 * button has to appear and disappear. The snapshot is a number rather than the
 * session id on purpose — `useSyncExternalStore` compares it, and a session id
 * that changed without changing the seat would re-render for nothing.
 */
export declare function useListLauncher(): ListLauncher;
/**
 * The button both surfaces render.
 *
 * It renders NOTHING when there is no seat. That is the deliberate answer to
 * "grey it out and say why on hover": a button that cannot work, offering
 * itself anyway, is a small lie — and on a touch surface the explanation
 * would be unreachable by definition.
 * @param className - extra class for the surface placing it.
 * @returns the button, or nothing.
 */
export declare function ListOpenButton(props?: {
    readonly className?: string;
}): import("react").JSX.Element | null;
