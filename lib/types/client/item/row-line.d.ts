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
    /**
     * **把看板舞台打开在这一行挂着的那张卡上**，由装配层给（见 `ItemListFace.openCard`）。
     *
     * 缺席时卡芯片**退回一枚读数**（不画成一枚按不动的按钮）。
     */
    readonly onOpenCard?: (cardId: string) => void;
    /** 那张卡现在是不是在跑。状态那一组读它：跑着的时候改栏位会被拒。 */
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
