/**
 * The client half of the checklist's pure layer: what an edit DOES to the
 * document, and how a date is written for a human.
 *
 * EVERY JUDGMENT LEFT THIS FILE. What a row says, which page it belongs to, how
 * a group of them reads, what its three dates mean — all of that lives in
 * `core/item-view.ts`, because the panel answering those questions one way and
 * the model another is how a search box finds a row the model cannot. What is
 * left here is the part only a browser can do: the edits, the id minting, and
 * the formatting.
 *
 * TWO RULES, THE SAME TWO THE REST OF THE LAYER KEEPS.
 *
 *  - **AN EDIT THAT CHANGES NOTHING MUST NOT COMMIT.** Every function here
 *    returns the SAME array when the edit is a no-op. The sync replica only
 *    stamps a revision and broadcasts when it is handed a different array, so a
 *    no-op that rebuilt the array would wake every device for a keystroke that
 *    changed no fact. This is the client-side counterpart of the board's
 *    `userEdit` funnel.
 *  - **A REFUSED WRITE KEEPS THE READER'S WORDS.** `addItem` refuses a blank
 *    note by returning the same list and no row, and the caller keeps what was
 *    typed, so a thought can be finished rather than lost to a disabled
 *    button's surprise.
 */
import type { ItemRecord } from '../../core/item.ts';
/** A mutation the reader made, expressed as a partial patch. */
export type ItemEdit = Partial<Pick<ItemRecord, 'title' | 'body' | 'notes' | 'status' | 'priority' | 'tags' | 'startsAfter' | 'dueAt' | 'hardDueAt' | 'taskId'>>;
/**
 * Apply one edit to one row.
 *
 * Returns the SAME array when the edit would change nothing, so the caller can
 * hand it straight to the sync replica and know no revision will be burned.
 * That is the whole point of this function existing: the write path stamps
 * `updatedAt` itself, and an edit that forgot to check would wake every device
 * for a keystroke that changed no fact.
 * @param items - the current list.
 * @param id - the row to change.
 * @param edit - the fields to change.
 * @param now - the edit clock; only a real change moves `updatedAt`.
 * @returns the next list, or the very same one when nothing changed.
 */
export declare function editItem(items: readonly ItemRecord[], id: string, edit: ItemEdit, now: number): readonly ItemRecord[];
/**
 * Toggle one step of one row, creating nothing.
 *
 * Steps are one level deep by model decision, so there is no recursion here and
 * none may be added: a nested checklist is the thing a narrow column cannot
 * show and the design rules refuse to show.
 * @param items - the current list.
 * @param id - the row to change.
 * @param stepId - the step to toggle.
 * @param now - the edit clock.
 * @returns the next list, or the very same one when nothing changed.
 */
export declare function toggleItemStep(items: readonly ItemRecord[], id: string, stepId: string, now: number): readonly ItemRecord[];
/**
 * Remove one row. The document keeps its tombstone, so the row does not come
 * back on its own — the surface that owns recovery says so rather than
 * pretending a delete is final.
 * @param items - the current list.
 * @param id - the row to drop.
 * @returns the next list, or the very same one when it was not there.
 */
export declare function removeItem(items: readonly ItemRecord[], id: string): readonly ItemRecord[];
/**
 * Mint a row identity.
 *
 * `crypto.randomUUID` is a secure-context API and the harness is served from a
 * loopback origin, so this is the path that always runs; the composed fallback
 * exists so a note is never left without an identity rather than failing a
 * note-taking gesture over a browser quirk.
 * @returns a fresh identity.
 */
export declare function newItemId(): string;
/** What a capture hands over to become a row. */
export interface CapturedItem {
    readonly title: string;
    readonly body: string;
    readonly notes: string;
    readonly status: ItemRecord['status'];
    readonly priority: ItemRecord['priority'];
    readonly steps: readonly {
        readonly text: string;
        readonly done: boolean;
    }[];
    readonly tags: readonly string[];
    readonly startsAfter?: number;
    readonly dueAt?: number;
    readonly hardDueAt?: number;
}
/**
 * Append one fresh row, or refuse a blank one.
 *
 * A note with no words in it is not a note, and the empty state promises the
 * reader they can write down a thought — so the gesture that creates the row is
 * the same gesture that writes the first words. Refusing changes nothing AND
 * keeps the words, so the reader can finish the thought instead of losing it.
 * @param items - the current list.
 * @param input - what was captured.
 * @param now - the writing clock.
 * @returns the next list and the row that was added, or no row and the same list.
 */
export declare function addItem(items: readonly ItemRecord[], input: CapturedItem, now: number): {
    readonly items: readonly ItemRecord[];
    readonly added: ItemRecord | undefined;
};
/**
 * Format a date the way the rest of this product formats one.
 *
 * `toLocaleDateString()` with no options is a different answer per machine —
 * `2026/9/28` here, `28/09/2026` there — so it goes through the same language
 * switch the board uses. One rule, one answer, in both places.
 * @param at - the moment, in milliseconds.
 * @param english - whether the active UI language is English.
 * @returns a short human date.
 */
export declare function formatItemDate(at: number, english: boolean): string;
/**
 * Parse a `yyyy-mm-dd` field back into a moment, or `undefined` when blank.
 *
 * The inputs are date fields, so they speak a day and not a clock. Building the
 * moment in local time is the whole point: a date typed as 28 September must
 * land on 28 September for the person who typed it, whatever timezone the
 * browser happens to be in.
 * @param value - the field's value.
 * @returns the moment, or `undefined` for an empty or unparseable field.
 */
export declare function parseItemDate(value: string): number | undefined;
/** Render a moment for a `yyyy-mm-dd` date field. */
export declare function toItemDateField(at: number | undefined): string;
/** Row-height tiers. The reader picks one; `view-prefs.ts` is where it is kept. */
export type ItemDensity = 'compact' | 'comfy';
