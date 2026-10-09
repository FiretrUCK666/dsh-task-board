/**
 * Quick capture: turn one line of typing into a structured row.
 *
 * WHAT THIS IS FOR. The capture box is the whole reason the panel exists, and
 * it is the one place where speed beats completeness. A reader who has to open
 * a form, pick a priority from a menu and fill a date field has spent four
 * times the effort of writing the sentence, and the thought that arrived while
 * they were clicking is gone. So the box takes the sentence and reads the
 * structure out of it: `#画廊` is a tag, `!1` is a priority, `@明天` is a date.
 *
 * TWO RULES, BOTH LEARNED FROM THE FAILURE EVERYONE ELSE SHARES.
 *
 *  **NEVER GUESS.** An ambiguous spelling stays literal text. `@9/28` resolves
 *  to this year, and when that day has already passed the token is NOT
 *  consumed — because "this year or next" is exactly the guess that makes a
 *  date land a day out, and a reader who cannot trust the box stops using it.
 *  The reader sees their own words untouched, which is the only honest answer
 *  to a string that could mean two things; `@2027/9/28` is there when they mean
 *  next year.
 *
 *  **EVERY RECOGNITION IS UNDOABLE, IN THE TEXT ITSELF.** Each recognised
 *  token comes back with the exact range it occupies, and escaping one rewrites
 *  the source with a backslash in front of it. So the escape is not a mode, not
 *  a setting and not a hidden flag: it is visible in the box, it survives the
 *  next keystroke, and a reader who disagrees with the parser can see exactly
 *  which word the parser claimed and take it back.
 *
 * A parser that cannot be argued with is worse than no parser, because the
 * reader's only remaining option is to stop writing in the box at all.
 */
import { type ItemPriority } from '../../core/item-view.ts';
/** What a recognised token became. Drives the chip the box draws. */
export type ComposerTokenKind = 'tag' | 'priority' | 'due' | 'hard' | 'earliest' | 'step';
/** One recognised piece of the source, with the range it occupies. */
export interface ComposerToken {
    /** Start offset in the source text, inclusive. */
    readonly start: number;
    /** End offset in the source text, exclusive. */
    readonly end: number;
    /** The characters as typed, backslash excluded. */
    readonly raw: string;
    readonly kind: ComposerTokenKind;
    /** The tag's text, the priority tier, or a step's line. Undefined for dates. */
    readonly text: string | undefined;
    /** The resolved instant, for the three date kinds. */
    readonly at: number | undefined;
    /** Whether a step token was ticked. */
    readonly done: boolean | undefined;
}
/** One step as it will be stored: the document mints the id, not the parser. */
export interface ComposerStep {
    readonly text: string;
    readonly done: boolean;
}
/** Everything a capture produced, and the tokens it was built from. */
export interface ComposerParse {
    /** The first surviving prose line. */
    readonly title: string;
    /** The remaining prose lines. */
    readonly body: string;
    readonly steps: ComposerStep[];
    readonly tags: string[];
    /** `undefined` when the writer never said, so the model's default is untouched. */
    readonly priority: ItemPriority | undefined;
    readonly dueAt: number | undefined;
    readonly hardDueAt: number | undefined;
    readonly startsAfter: number | undefined;
    readonly tokens: ComposerToken[];
    /** The source with every checkbox line removed — what a re-parse should read. */
    readonly source: string;
}
/**
 * Read one capture.
 *
 * Line-oriented on purpose: a checkbox belongs to a line, and a token belongs to
 * a line's text, so a capture written across three lines gets its steps from
 * the lines that asked for them and its prose from the rest. Offsets are
 * tracked against the whole source so a chip drawn on line three can still say
 * which characters it is claiming.
 * @param text - what is in the box.
 * @param now - the reading clock, so a date word means today.
 * @returns the structured row, and every token that was recognised.
 */
export declare function parseComposerInput(text: string, now: number): ComposerParse;
/**
 * Take one token back: rewrite the source so the word becomes plain text again.
 *
 * The rewrite puts a backslash in front of the token's own first character and
 * changes nothing else, so the reader can see in the box which word was claimed
 * and that the claim has been withdrawn. Re-parsing reads the backslash, drops
 * it, and hands the character back as prose.
 * @param text - the current source.
 * @param token - the token to release.
 * @returns the source with that token escaped.
 */
export declare function escapeComposerToken(text: string, token: ComposerToken): string;
