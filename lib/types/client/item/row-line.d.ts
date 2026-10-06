import type { ItemRowView } from '../../core/item-view.ts';
export interface ItemRowLineProps {
    readonly view: ItemRowView;
    /** THE PANEL'S CLOCK, passed in rather than read. Two clocks on one row is a row
     *  that says 「还早」 and shows last year's date. */
    readonly now: number;
    readonly panelId: string;
    readonly expanded: boolean;
    readonly selected: boolean;
    /** Whether the keyboard cursor sits on this row. Unlike `selected` (which
     *  marks the row whose detail is being read), the cursor is where the next
     *  keystroke will act — and it must be VISIBLE, because every write on this
     *  panel goes through it. */
    readonly cursor: boolean;
    readonly onSelect: () => void;
    readonly onToggle: () => void;
    /** Whether this PAGE batches. The inbox and the agenda answer false, so a row there
     *  carries no way to be held. */
    readonly picking: boolean;
    readonly picked: boolean;
    /** Hold one row, optionally as a range over what is on screen. */
    readonly onPick: (extend: boolean) => void;
    readonly onPatch: (patch: {
        readonly title: string;
    }) => void;
    readonly menuOpen: boolean;
    readonly onMenuToggle: () => void;
    readonly onMenuClose: () => void;
    readonly onAsk: () => void;
    readonly asking: boolean;
    readonly receipt?: string;
    readonly onMark: (status: 'open' | 'blocked' | 'done') => void;
    /** Open the checklist and put the caret in its field. Three things at once: close
     *  the menu, select the row, expand it — picking without expanding leaves the
     *  reader looking at a selected row with no checklist on screen. */
    readonly onSteps: () => void;
    readonly onPromote: () => void;
    /** 开工 — run the card this row hangs off, through the SAME `runTask` the
     *  catalog's `task.run` binds. Not `rerunTask`: a row that runs a card one way
     *  while the model runs it another is two definitions of 「开工」 on one
     *  installation. */
    readonly onStart: () => void;
    /** Whether that card is running, so 「开工」 is not offered twice. */
    readonly running: boolean;
    readonly onRemove: () => void;
    /** The in-place detail, rendered only when `inPlace` and open. */
    readonly inPlace: boolean;
    readonly detail?: React.ReactNode;
}
/**
 * One row.
 * @param props - the projection and every hand-off it needs.
 * @returns the row: a bead, a sentence, its tags and one control.
 */
export declare function ItemRowLine(props: ItemRowLineProps): import("react").JSX.Element;
