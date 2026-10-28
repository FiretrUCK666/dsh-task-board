import type { BoardController } from '../../core/controller.ts';
/** Prompt textarea with a slash-command and official-reference dropdown. */
export declare function PromptInput({ value, onChange, placeholder, rows, controller, sessionId, invalid, quote, onQuoteConsumed }: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    rows?: number;
    controller: BoardController;
    /** The target session scoping the '@' reference menu (file cwd + session
     *  discovery). undefined = '@' stays closed (no menu); '/' is unaffected. */
    sessionId?: string;
    /** Validation error state: the field's invalid border. */
    invalid?: boolean;
    /**
     * A quote to splice in at the CURRENT caret.
     *
     * The caret lives here (this component's own textarea is its only owner), so the
     * splice must happen here too: a caller that computed an insertion position would
     * be guessing at a number this component already knows. Each arriving quote is
     * consumed exactly once — `onQuoteConsumed` clears the caller's slot, so a later
     * re-render cannot insert the same quote twice (the double-quote bug).
     */
    quote?: string;
    /** Called after `quote` has been spliced in (the caller clears its slot). */
    onQuoteConsumed?: () => void;
}): import("react").JSX.Element;
