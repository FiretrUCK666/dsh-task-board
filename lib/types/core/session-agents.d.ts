/**
 * Agent-preset identity helpers plus a device-local ledger of applications
 * made by this board.
 *
 * The Host's `projectionValues.agentPreset` is authoritative for the Session's
 * composition. The ledger covers Hosts that do not expose that projection and
 * records only successful applications, so a failed switch can never be
 * reported as the Session's real Agent. It is a display fallback in localStorage
 * (like drafts), not shared board state: the board document stays untouched.
 *
 * Pure functions plus a storage seam keep identity resolution and persistence
 * independently testable.
 */
/** The localStorage key for the applied-preset ledger (never renamed). */
export declare const SESSION_AGENT_STORAGE_KEY = "dsh.taskBoard.sessionAgents.v1";
/** One recorded application: preset + when (later applications win). */
export interface AppliedPreset {
    preset: string;
    at: number;
}
/** The roster fields needed to render an Agent preset's user-facing name. */
export interface AgentPresetLabelSource {
    id: string;
    name?: string;
}
/** One roster row's display name, with its stable id as the honest fallback. */
export declare function agentPresetNameOf(preset: AgentPresetLabelSource): string;
/** Resolve one applied id to its roster name; an unknown id remains visible. */
export declare function agentPresetLabelOf(preset: string | undefined, roster: readonly AgentPresetLabelSource[]): string | undefined;
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
