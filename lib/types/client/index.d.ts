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
import './design/tokens.module.css';
import './design/base.module.css';
import './design/components.module.css';
import type { ApiFace, ClientContext } from './platform.ts';
import type { AttachmentRef, PromptAttachment } from '../core/attachment.ts';
/** What the plugin's own attachment door publishes (see {@link createAttachmentBridge}). */
export interface AttachmentBridge {
    /** Admit picked bytes into the official store; the durable ref comes back. */
    admitAttachment(input: {
        name: string;
        data: string;
        mediaType?: string;
    }): Promise<{
        ok: true;
        ref: AttachmentRef;
    } | {
        ok: false;
        error: string;
    }>;
    /** Deliver one round of text + attachments into a session. */
    sendComment(sessionId: string, text: string, mode?: 'queue' | 'steer', attachments?: readonly PromptAttachment[]): Promise<{
        ok: true;
    } | {
        ok: false;
        error: string;
    }>;
}
/**
 * The plugin's own attachment door: admit bytes into the harness's attachment
 * store, read them back when a message is actually sent, and materialize the
 * official prompt parts from them.
 *
 * WHY IT IS ITS OWN FACTORY. The three steps are one contract — what is admitted
 * is a durable reference, what is read back is that same reference, and what is
 * sent is the bytes it names — and it is the only place in the client half where
 * a reference crosses the wire. Read together, the whole lane can be checked
 * (`tests/composer-attachments.spec.ts` drives it through this entry).
 *
 * A CHECKLIST ROW HAS NO SESSION, which is why the durable store is used at all:
 * the official `fileUploads` face mints a receipt for one Agent, and a document
 * needs a reference that outlives every session. The bytes still live where the
 * harness already keeps them; this plugin creates no directory and no second
 * copy.
 * @param api - the domain API face (the official prompt send and file staging).
 * @returns the two doors the wiring publishes.
 */
export declare function createAttachmentBridge(api: ApiFace): AttachmentBridge;
/**
 * Required services (fiber inject waiting — the runtime must be up first).
 *
 * `slots` is listed here as a hard service dependency even though it is not
 * declared in `dsh.client.inject` in package.json: the `slots` service is
 * seeded by the web shell itself (the platform seed table in
 * build/web-platform.ts's PLATFORM_MODULES), so it is not a package this plugin
 * needs the loader to bring up. `sessions` / `workspaces` are the client
 * object-layer services (dsh-api-session-controller / workspace-controller),
 * `connection` the wire carrier, `locale` the copy service, and `remote` the
 * Typert-generated Host API namespaces — all real services, with the
 * package-name edges declared in `dsh.client.inject`. `uiSession` is the
 * session-UI adapter (dsh-client-ui-session): the board only subscribes to
 * its official session-status snapshot (read-only — answering stays
 * in the native session), never registering a waterfall listener of its own.
 * Navigation is NOT a required service: `ctx.uiWorkspace` is read optionally
 * at call time (see the sessions.open adapter in buildApi).
 */
export declare const inject: string[];
/**
 * Mount the task board.
 * @param ctx - client root context (services: sessions, workspaces).
 */
export declare function apply(ctx: ClientContext): void;
