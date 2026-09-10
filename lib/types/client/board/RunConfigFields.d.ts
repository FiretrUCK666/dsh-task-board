import type { BoardController } from '../../core/controller.ts';
import { type RunConfigPresetConfig } from '../../core/run-presets.ts';
export declare function RunConfigFields({ value, onChange, controller }: {
    value: RunConfigPresetConfig;
    onChange: (next: RunConfigPresetConfig) => void;
    controller: BoardController;
}): import("react").JSX.Element;
