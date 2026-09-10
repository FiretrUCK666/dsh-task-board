import { type PaletteCommand } from './commands.ts';
export declare function CommandPalette({ commands, onClose, onRun }: {
    commands: readonly PaletteCommand[];
    onClose: () => void;
    /** Runs the command AND closes the palette (the caller closes first when the command opens another surface). */
    onRun: (command: PaletteCommand) => void;
}): import("react").JSX.Element;
