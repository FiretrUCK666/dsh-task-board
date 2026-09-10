import type { BoardController } from '../../core/controller.ts';
import type { RunConfigPresetConfig, RunPresetStore, RunPresetsDocument } from '../../core/run-presets.ts';
/** The run-config preset manager (see module doc). */
export declare function RunPresetManager({ store, doc, current, controller, onChanged, onClose }: {
    store: RunPresetStore;
    doc: RunPresetsDocument;
    /** The form's current run-config (a NEW preset seeds from it). */
    current: RunConfigPresetConfig;
    controller: BoardController;
    onChanged: (next: RunPresetsDocument) => void;
    onClose: () => void;
}): import("react").JSX.Element;
