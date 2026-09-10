import { type PresetStore, type SchedulePreset } from '../../core/presets.ts';
/** The merged list shown in the preset dropdown (defaults + custom). */
export declare function mergedPresets(store: PresetStore): SchedulePreset[];
/** Whether a preset id belongs to the built-in defaults. */
export declare function presetIsDefault(preset: SchedulePreset): boolean;
/** The preset manager overlay. */
export declare function PresetManager({ store, onClose }: {
    store: PresetStore;
    onClose: () => void;
}): import("react").JSX.Element;
