/**
 * Route-backed settings scope for the task-board plugin's settings namespace.
 *
 * The plugin is standalone: it must not depend on a sibling settings-surface
 * package to bind its namespace scope. Instead this scope reads and writes the
 * namespace through the plugin's own host route (`/api/dsh-task-board/settings`),
 * mirroring the contract the SDK's `SettingsScope<T>` exposes so the card form
 * can consume it unchanged.
 *
 * Fetch failures degrade to an `unavailable` snapshot rather than throwing.
 * @module dsh-task-board/client/route-scope
 */
import type { SettingsScopeSnapshot } from './platform.ts';
/** The JSON view the host settings route returns. */
export interface SettingsRouteView {
    available: boolean;
    value?: unknown;
    base?: unknown;
    user?: unknown;
    writable?: boolean;
    revision?: number;
}
/** The ok/error envelope the host settings route returns. */
export interface RouteOk {
    ok: true;
    value: SettingsRouteView;
}
export interface RouteFail {
    ok: false;
    error: {
        code: string;
        message: string;
    };
}
export type RouteEnvelope = RouteOk | RouteFail;
/** One path edit sent to the route's POST handler. */
export type SettingsRouteOp = {
    op: 'set';
    path: string[];
    value?: unknown;
} | {
    op: 'unset';
    path: string[];
    value?: never;
};
/**
 * A reactive settings scope backed by the plugin's host route. It mirrors the
 * shape of `SettingsScope<T>` (getSnapshot/subscribe/set/unset/dispose) so the
 * card form and fixture-free tests can treat it as a drop-in.
 */
export declare class RouteSettingsScope<T> {
    private readonly namespace;
    private snapshot;
    private readonly listeners;
    private disposed;
    /**
     * Serialized request lane: the initial load and every mutation run one at a
     * time, so a slow load response can never overwrite the fresh view of a
     * write that ran after it, and a write's revision always comes from the
     * snapshot the previous request settled (the SDK scope's write queue).
     */
    private lane;
    /**
     * @param namespace - the settings namespace this scope reads (route path tail).
     */
    constructor(namespace: string);
    /** @returns the current snapshot (stable reference until the next change). */
    getSnapshot(): SettingsScopeSnapshot<T>;
    /**
     * Observe snapshot replacements.
     * @param listener - invoked after each snapshot change.
     * @returns the disposer removing this listener.
     */
    subscribe(listener: () => void): () => void;
    /**
     * Queue one field write through the route and adopt the returned fresh view.
     * The write carries the latest known namespace revision for stale-write
     * fencing, matching the SDK scope's revision contract.
     * @param field - scalar field inside the namespace section.
     * @param value - JSON-shaped value selected by the user.
     */
    set(field: string, value: unknown): Promise<void>;
    /**
     * Queue one field clear so it re-inherits the composition layer.
     * @param field - scalar field inside the namespace section.
     */
    unset(field: string): Promise<void>;
    /** Stop all listeners and drops further updates. */
    dispose(): void;
    /** Run one request on the serialized lane (order = arrival stay order). */
    private enqueue;
    /** Fetch the namespace view through the route and adopt it. */
    private load;
    /** Send path ops through the route and adopt the returned fresh view. */
    private mutate;
    /** Adopt a new snapshot and notify subscribers. */
    private settle;
}
