/**
 * Applied-preset ledger: which agent preset the board last successfully
 * composed each session from. The host offers a preset SWITCH (`select`)
 * but no read-back — no list field, no models-API field, no projection
 * carries a session's composed preset — so a display that reads "the
 * session's preset" from the host reads a ghost field (always undefined,
 * always "部署默认"). The board, on the other hand, knows exactly what it
 * applied where (every `selectAgentPreset.ok` flows through the execution
 * service): recording that is the only honest source.
 *
 * Device-local localStorage (like drafts): a display hint, not board truth
 * — the shared document is untouched, so no migration and no merge grammar.
 * Read priority stays host-first (`sessionInfo` prefers a served
 * `summary.agentPreset` when a future host serves one); the ledger is the
 * fallback, "部署默认" the last resort. Pure functions + a storage seam, so
 * everything unit-tests in isolation.
 */
/** The localStorage key for the applied-preset ledger (never renamed). */
export declare const SESSION_AGENT_STORAGE_KEY = "dsh.taskBoard.sessionAgents.v1";
/** One recorded application: preset + when (later applications win). */
export interface AppliedPreset {
    preset: string;
    at: number;
}
/** Persistence seam for the ledger. */
export interface SessionAgentStore {
    load(): Record<string, AppliedPreset>;
    save(ledger: Record<string, AppliedPreset>): void;
}
/**
 * Record a successful application (no-op for blank presets; later wins).
 * Failures must never be recorded — the session kept its previous preset.
 */
export declare function recordApplied(ledger: Record<string, AppliedPreset>, sessionId: string, preset: string, now: number): Record<string, AppliedPreset>;
/** The board-applied preset of a session, or undefined when never applied. */
export declare function appliedOf(ledger: Record<string, AppliedPreset>, sessionId: string): string | undefined;
/** Store-level read (undefined store = unknown, never a throw). */
export declare function appliedPresetOf(store: SessionAgentStore | undefined, sessionId: string): string | undefined;
/** Structural check: string presets only (anything else is dropped). */
export declare function normalizeLedger(raw: unknown): Record<string, AppliedPreset>;
/** localStorage-backed ledger (device-local, like drafts). */
export declare class LocalStorageSessionAgentStore implements SessionAgentStore {
    load(): Record<string, AppliedPreset>;
    save(ledger: Record<string, AppliedPreset>): void;
}
