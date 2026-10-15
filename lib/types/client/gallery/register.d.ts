/**
 * The gallery's stage identity — ONE value for both official registrations, the
 * `main` key and the panel-list entry id, exactly as the board and the list
 * keep their own in one place so "they agree" is structural.
 */
export declare const GALLERY_GROUP: {
    readonly id: "dsh-task-board-design";
};
/** The cordis client context, narrowed to the two calls this contribution makes. */
interface Context {
    get(name: string): unknown;
    effect(run: () => void | (() => void), label?: string): () => void;
}
/**
 * Contribute the gallery, when the host says its surface is on.
 * @param ctx - the client context.
 * @param returnToConversation - the one way out, shared with the other panels.
 * @returns a disposer removing everything this contributed.
 */
export declare function registerDesignGallery(ctx: Context, returnToConversation: () => void): () => void;
export {};
