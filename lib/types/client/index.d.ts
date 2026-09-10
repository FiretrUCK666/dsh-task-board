/**
 * Task-board client plugin: wires the framework-free core (controller,
 * execution service, store) to the real client runtime and mounts the two
 * DOM surfaces — the sidebar entry row and the board view in the center
 * column.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 */
import type { ClientContext } from './platform.ts';
/**
 * Required services (fiber inject waiting — the runtime must be up first).
 *
 * `slots` is listed here as a hard service dependency even though it is not
 * declared in `dsh.client.inject` in package.json: the `slots` service is
 * seeded by the web shell itself (the platform seed table in
 * web-platform.ts's PLATFORM_MODULES), so it is not a package this plugin
 * needs the loader to bring up. `sessions` / `workspaces` are the client
 * object-layer services (dsh-api-session-controller / workspace-controller),
 * `connection` the wire carrier, `locale` the copy service, and `remote` the
 * Typert-generated Host API namespaces — all real alpha.3 services, with the
 * package-name edges declared in `dsh.client.inject`. `uiSession` is the
 * session-UI adapter (dsh-client-ui-session): the board only subscribes to
 * its official `pendingInteractions` snapshot (read-only — answering stays
 * in the native session), never registering a waterfall listener of its own.
 */
export declare const inject: string[];
/**
 * Mount the task board.
 * @param ctx - client root context (services: sessions, workspaces).
 */
export declare function apply(ctx: ClientContext): void;
