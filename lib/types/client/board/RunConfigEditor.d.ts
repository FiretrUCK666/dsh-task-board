import type { BoardController } from '../../core/controller.ts';
import type { RunConfigPresetConfig } from '../../core/run-presets.ts';
/** The run configuration field editor (see module doc). */
export declare function RunConfigEditor({ value, onChange, controller }: {
    value: RunConfigPresetConfig;
    onChange: (next: RunConfigPresetConfig) => void;
    controller: BoardController;
}): import("react").JSX.Element;
