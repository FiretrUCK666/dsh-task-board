import type { ItemRowView } from '../../core/item-view.ts';
import { type TaskStatus } from '../../core/tasks.ts';
import { type ItemStatus } from '../../core/item.ts';
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
    /** Whether the batch is ARMED — the mode whose face is a tickbox in the lead
     *  slot. `picking` without `armed` still answers ⌘-click, `X` and the ⋮ entry;
     *  the box appears the moment there is a mode to show. */
    readonly armed: boolean;
    readonly picked: boolean;
    /** The inline-rename lease: `E` SOCKET. Presence = 「enter the title editor
     *  now」, the number itself never repeats an already-served request. */
    readonly renameNonce?: number;
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
    /** Write this row's OWN status field — only offered while it has no card. */
    readonly onMark: (status: ItemStatus) => void;
    /**
     * Move the card this row hangs off. `undefined` when there is no board to write,
     * in which case the menu's status entries are absent rather than dead.
     */
    readonly onMoveCard?: (status: TaskStatus) => void;
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
    /**
     * Whether that card can run at all (`taskExecutable`: 执行 Prompt 非空).
     *
     * `undefined` = this row has no card (a different sentence, said by 「不挂」),
     * `false` = it has one and it cannot run — the menu then says why.
     */
    readonly runnable?: boolean;
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
