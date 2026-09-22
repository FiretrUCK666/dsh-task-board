/**
 * The document-relative base for the plugin's own browser-facing host routes.
 *
 * The shell serves the GUI document with `<base href="./">`, so the browser
 * resolves a relative request URL against `document.baseURI` — the mount root
 * of this deployment. A URL that starts with a slash is root-absolute instead:
 * under a reverse-proxy subpath mount it leaves the mount and lands on the
 * proxy (404), while at the origin root the two forms coincide. The official
 * client halves address their host routes relatively for the same reason
 * (`dsh-client-file-upload`: `FILE_UPLOAD_ROUTE = FILE_UPLOAD_PATH.slice(1)`),
 * so `fetch`, `EventSource` and the shell all reach the same deployment.
 *
 * A route literal stays spelled exactly as the host registers it (an absolute
 * pathname starting with `/api/`); dropping the leading slash happens here,
 * once, at the browser boundary.
 * @module dsh-task-board/client/route-base
 */
/**
 * Address one plugin host route from the browser.
 * @param path - the route path as the host registers it (leading slash).
 * @returns the same path document-relative, resolved against `document.baseURI`.
 */
export declare function routeUrl(path: string): string;
