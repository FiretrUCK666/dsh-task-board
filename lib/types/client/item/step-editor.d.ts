import type { ItemRecord } from '../../core/item.ts';
export interface ItemStepsProps {
    /** The row being edited. Its `id` is what a new step's id is derived from. */
    readonly item: ItemRecord;
    /** Bumped by 「编辑步骤」; the field takes the caret when it changes. */
    readonly focusRequest?: number;
    readonly onToggle: (stepId: string) => void;
    readonly onAdd: (text: string) => void;
    readonly onRemove: (stepId: string) => void;
    readonly onMove: (stepId: string, by: -1 | 1) => void;
}
/**
 * The checklist.
 * @param props - the row, the focus request and the four hand-offs.
 * @returns the list, then the field that adds to it.
 */
export declare function ItemSteps(props: ItemStepsProps): import("react").JSX.Element;
