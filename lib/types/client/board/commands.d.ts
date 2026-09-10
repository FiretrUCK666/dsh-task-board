/**
 * Command palette model: the board's actions as a filterable list. Every
 * command reuses an existing handler (new-task modal, cruise toggle,
 * organize mode, automation overview, notifications, back-to-chat) — the
 * palette adds NO new behavior, only a keyboard-first entrance (Ctrl/Cmd+K).
 * Pure and framework-free so the list unit-tests in isolation.
 */
/** One palette row: a stable id, a localized label, an optional hint, and the run. */
export interface PaletteCommand {
    id: 'new' | 'cruise' | 'organize' | 'automation' | 'notify' | 'close';
    label: string;
    run(): void;
}
/** The UI actions the palette triggers (the caller's own setters/handlers). */
export interface PaletteActions {
    cruiseEnabled: boolean;
    openNew(): void;
    toggleCruise(): void;
    openOrganize(): void;
    openAutomation(): void;
    openNotify(): void;
    closeBoard(): void;
}
/** Build the six commands in palette order (labels via the caller's `t`). */
export declare function buildCommands(t: (key: 'board.new' | 'board.cruiseOn' | 'board.cruiseOff' | 'board.organize' | 'board.automation' | 'board.notify' | 'board.close') => string, actions: PaletteActions): PaletteCommand[];
/** Filter commands by a raw query (multi-term AND over the label, case-insensitive). */
export declare function filterCommands(commands: readonly PaletteCommand[], query: string): PaletteCommand[];
