/**
 * THE FIELDS THIS CARD READS.
 *
 * Named in one place because "the field is absent, so the line is not drawn"
 * is exactly how a TYPO becomes a silently empty card instead of a red
 * build — the same disease the `as TaskBoardKey` cast had: a checker that has
 * been told to stay quiet. `tests/item-panel.spec.ts` scans the producer's
 * source and fails if any name here is gone, so a rename upstream breaks a
 * test instead of quietly emptying a card mid-conversation.
 *
 * Verbatim from the producer (`src/host/agent/tools.ts`, `presentationOf`):
 * `dryRun` `persisted` `ok` `summary` `counts` `items` `tasks`
 * `enginePending` `reports`.
 */
export declare const PRESENTATION_FIELDS: readonly ["dryRun", "persisted", "ok", "summary", "counts", "items", "tasks", "enginePending", "reports"];
/**
 * Register the tool-call views this plugin owns.
 *
 * Keyed by the WIRE tool name — the contract says a keyed hit replaces the
 * generic row, and a name that is not in flight simply never renders (so a
 * typo is a missing card, not a crash). Nothing here is registered for the
 * plumbing tools beyond returning nothing.
 * @param register - the slot's register function, read by the caller.
 * @returns a disposer removing every entry.
 */
export declare function registerToolViews(register: (slot: string, key: string, component: unknown) => () => void, namespace: string): () => void;
