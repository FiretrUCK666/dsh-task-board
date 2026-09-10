/**
 * Permission-catalog route layer: the minimal HTTP surface that exposes the
 * deployment's native permission presets to the browser half.
 *
 * The option list is never hard-coded: it is read live from the host's
 * `permissionPresets` service (composed by `@deepseek-ai/dsh-permission-presets`
 * when the deployment mounts it), so a preset-table change in the harness or
 * the deployment shows up in the task form without a plugin update. The
 * handler is split from the pure processing function (`createPermissionHandler`)
 * so the response logic is unit-testable without a live server.
 *
 * GET /api/<ns>/permissions → {ok:true, value:{available, options}} when the
 *                             permission service is composed, or
 *                             {ok:true, value:{available:false}} otherwise.
 * @module dsh-task-board/host/permission-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
/** One selectable permission preset, as the task form renders it. */
export interface PermissionOptionView {
    /** Preset machine value (the key the `/permission` command accepts). */
    id: string;
    /** Display name the preset published, or the table key when it published none. */
    name: string;
    /** One user-facing sentence on what the preset means; absent when not configured. */
    description?: string;
}
/**
 * The permission-catalog view served to the browser half. `available: false`
 * means no permission service is composed and the form hides the selector.
 */
export interface PermissionCatalogView {
    available: boolean;
    options?: readonly PermissionOptionView[];
}
/**
 * The narrow structural face the route needs from the native
 * `permissionPresets` service. Declared structurally (framework-free, like
 * the other runtime faces) so the plugin never imports the SDK package.
 */
export interface PermissionPresetCatalogFace {
    /** The advertised preset names, in the preset table's declaration order. */
    readonly names: readonly string[];
    /** Build the client option for one table entry; unknown names throw. */
    optionOf(name: string): {
        value: string;
        name: string;
        description?: string;
    };
}
/** The service face the pure handler needs (real service or fake). */
export interface PermissionRouteDeps {
    /**
     * Read the current catalog view, or undefined when no permission service
     * is composed. Called per request so a service mounting after this route
     * registered is picked up immediately.
     */
    read(): PermissionCatalogView | undefined;
}
/**
 * Build the pure permission-catalog route processor. The returned handler
 * translates an HTTP GET into the catalog envelope without touching the
 * server.
 * @param deps - the catalog face (real or fake).
 * @returns an HTTP handler for GET on the permission route.
 */
export declare function createPermissionHandler(deps: PermissionRouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/**
 * Register the permission-catalog route on the host web server, reading the
 * native permission service on every request.
 * @param ctx - context carrying the webServer service.
 * @param ns - the plugin namespace (route path prefix).
 * @returns the route disposer, or a no-op when the web server is absent.
 */
export declare function registerPermissionRoute(ctx: Context, ns: string): () => void;
