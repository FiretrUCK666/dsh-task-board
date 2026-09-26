import type { BoardController } from '../../core/controller.ts';
/** One picker's props. The two callers differ ONLY in `exclude` / `onSubmit`. */
export declare function SessionPickerDialog({ controller, exclude, title, submitLabel, onSubmit, onClose }: {
    controller: BoardController;
    /** Sessions this surface must not offer (the card's own related set);
     *  undefined at the board level, where nothing is bound yet. */
    exclude?: ReadonlySet<string>;
    title: string;
    submitLabel: string;
    onSubmit: (sessionIds: readonly string[]) => void;
    onClose: () => void;
}): import("react").JSX.Element;
