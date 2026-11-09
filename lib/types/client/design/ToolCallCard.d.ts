/**
 * THE TOOL-CALL CARD: the model's work, as a sentence in the transcript.
 *
 * WHY IT LIVES HERE AND NOT IN `chat/`. The card is rendered by the SHELL, in the
 * conversation tree, so it is the one surface this plugin draws entirely outside
 * its own seats. Two consequences followed from putting it in a page sheet:
 *
 *  1. It read `board.module.css` — a page's stylesheet — from a page that does not
 *     own it, so `chat/` had no stylesheet of its own and the card's rules sat in
 *     a 7000-line file belonging to another surface.
 *  2. It carried the plugin's token scope only by accident of living in that
 *     sheet, so the one thing it genuinely needs (eleven `--dsh-tb-*` values) was
 *     tied to a file with no business supplying them.
 *
 * So the family moved here, which is where a component that two containers render
 * belongs — the fact that one of those containers is the host's conversation
 * rather than one of our panels does not change that.
 *
 * IT CARRIES THE PLUGIN'S FULL TOKEN SCOPE, AND THAT WAS MEASURED, NOT ASSUMED.
 * A narrowed scope (only the eleven properties this sheet reads) was built and
 * then thrown away. 119 declarations x N cards looks expensive, but on 150 cards
 * both variants held 60fps with zero dropped frames, and a second home for the
 * alias layer is a REAL defect — `verify-palette` refuses two declaration sites
 * for `--dsh-tb-text-1`, because one concept with two homes is how a colour
 * family ends up with two values. Trading a real defect for a cost that does not
 * appear in frames is the wrong way round, so the card reads the same scope every
 * other surface reads.
 *
 * WHAT IT IS NOT. It is not a general transcript card — it draws this plugin's
 * receipts only, and every field comes from `presentationMeta`, computed by the
 * tool definition and persisted by the host. It invents nothing: a field it cannot
 * read is simply not shown, because a summary that guesses is the same defect as
 * one that lies.
 *
 * @module dsh-task-board/src/client/design/ToolCallCard
 */
import type { ReactNode } from 'react';
/** One operation the model reported, already classified. */
export interface ToolCardOp {
    /** What happened, in the tool's own classification. */
    readonly kind: string;
    /** The address the operation touched (`#12`, a title), when it has one. */
    readonly ref?: string;
    /** The name a reader recognises, when the operation has one. */
    readonly title?: string;
    /** The one-line specific behind the kind. */
    readonly detail: string;
    /** Whether this particular operation succeeded. */
    readonly ok: boolean;
}
/** Everything the card shows. Assembled by the caller from `presentationMeta`. */
export interface ToolCallCardProps {
    /** The headline sentence — counts, or the rehearsal sentence. */
    readonly headline: string;
    /** A one-line summary under the headline; omitted when empty. */
    readonly summary?: string;
    /** The notes: rehearsal, not-written, engine-pending. Any that apply. */
    readonly notes?: readonly string[];
    /** The operations behind the headline. */
    readonly ops?: readonly ToolCardOp[];
    /** Whether the whole call succeeded (drives the icon tone and the border). */
    readonly ok: boolean;
    /** Rendered after the ops — the "show all" control, when there are more. */
    readonly more?: ReactNode;
}
/**
 * Render one tool-call receipt.
 * @param props - everything above, already resolved to display strings.
 * @returns the card, ready to sit in the host's transcript.
 */
export declare function ToolCallCard(props: ToolCallCardProps): import("react").JSX.Element;
