/** Confirm overlay props. */
interface ConfirmDialogProps {
    title: string;
    message: string;
    confirmLabel: string;
    /** Render the confirm button in the danger style. */
    danger?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}
/** Small confirm overlay. AlWAYS portaled: a confirmation is an overlay on
 *  an overlay — it must escape the enclosing dialog's box (see Dialog). */
export declare function ConfirmDialog({ title, message, confirmLabel, danger, onCancel, onConfirm }: ConfirmDialogProps): import("react").JSX.Element;
export {};
