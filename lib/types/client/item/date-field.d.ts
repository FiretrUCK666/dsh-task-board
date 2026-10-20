import { type DateBadReason } from './model.ts';
/**
 * 一个读不懂的日期，说给人听的那句话。
 * @param reason - 哪一种读不懂（三种的改法不同，见 `DateBadReason`）。
 * @param word - 读者写的那串字，原样带进句子里。
 * @returns 那一句。
 */
export declare function dateBadWords(reason: DateBadReason, word: string): string;
/** What one date field needs. Nothing about where it is drawn. */
interface DateFieldProps {
    /** The text the reader has typed. The field is CONTROLLED: the draft is the
     *  surface's state, because the surface is what finally writes it down. */
    readonly value: string;
    readonly onChange: (value: string) => void;
    /** The spellings this field accepts, shown as the placeholder. */
    readonly hint: string;
    readonly ariaLabel: string;
    /** The reading clock: a WORD resolves against the panel's now, not the machine's. */
    readonly now: number;
    /**
     * Whether the reader has just TRIED to commit a value that cannot be read.
     *
     * A prop and not a derivation, because 「读不懂」 is a fact about an attempt:
     * the first character of 「明天」 is unreadable and is not a mistake.
     */
    readonly bad?: boolean;
    /** Enter. The detail commits its edit; the sheet saves the whole capture. */
    readonly onEnter?: () => void;
    /**
     * Give up on this field — Escape, and a press outside it.
     *
     * ABSENT MEANS THE KEYS ARE NOT THIS FIELD'S: see the note above about layers.
     */
    readonly onDismiss?: () => void;
    /** The focus hinge, for a surface that opens the field and wants the caret in it. */
    readonly focusRef?: (node: HTMLInputElement | null) => void;
}
/**
 * One date field.
 * @param props - the draft, the clock, and the two verdicts the caller owns.
 * @returns the input and, under it, one line saying what it read or why it could not.
 */
export declare function DateField(props: DateFieldProps): import("react").JSX.Element;
export {};
