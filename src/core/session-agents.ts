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
export const SESSION_AGENT_STORAGE_KEY = 'dsh.taskBoard.sessionAgents.v1'

/** One recorded application: preset + when (later applications win). */
export interface AppliedPreset {
  preset: string
  at: number
}

/** The roster fields needed to render an Agent preset's user-facing name. */
export interface AgentPresetLabelSource {
  id: string
  name?: string
}

/** One roster row's display name, with its stable id as the honest fallback. */
export function agentPresetNameOf(preset: AgentPresetLabelSource): string {
  return preset.name !== undefined && preset.name !== '' ? preset.name : preset.id
}

/** Resolve one applied id to its roster name; an unknown id remains visible. */
export function agentPresetLabelOf(
  preset: string | undefined,
  roster: readonly AgentPresetLabelSource[],
): string | undefined {
  if (preset === undefined || preset === '') return undefined
  const row = roster.find(candidate => candidate.id === preset)
  return row === undefined ? preset : agentPresetNameOf(row)
}

/** Persistence seam for the ledger. */
export interface SessionAgentStore {
  load(): Record<string, AppliedPreset>
  save(ledger: Record<string, AppliedPreset>): void
}

/**
 * Record a successful application (no-op for blank presets; later wins).
 * Failures must never be recorded — the session kept its previous preset.
 */
export function recordApplied(
  ledger: Record<string, AppliedPreset>,
  sessionId: string,
  preset: string,
  now: number,
): Record<string, AppliedPreset> {
  if (preset.trim() === '') return ledger
  return { ...ledger, [sessionId]: { preset, at: now } }
}

/** The board-applied preset of a session, or undefined when never applied. */
export function appliedOf(
  ledger: Record<string, AppliedPreset>,
  sessionId: string,
): string | undefined {
  return ledger[sessionId]?.preset
}

/** Store-level read (undefined store = unknown, never a throw). */
export function appliedPresetOf(
  store: SessionAgentStore | undefined,
  sessionId: string,
): string | undefined {
  if (store === undefined) return undefined
  return appliedOf(store.load(), sessionId)
}

/** Structural check: string presets only (anything else is dropped). */
export function normalizeLedger(raw: unknown): Record<string, AppliedPreset> {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, AppliedPreset> = {}
  for (const [sessionId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (typeof record.preset !== 'string' || record.preset.trim() === '') continue
    out[sessionId] = {
      preset: record.preset,
      at: typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : 0,
    }
  }
  return out
}

/** localStorage-backed ledger (device-local, like drafts). */
export class LocalStorageSessionAgentStore implements SessionAgentStore {
  load(): Record<string, AppliedPreset> {
    try {
      const raw = globalThis.localStorage?.getItem(SESSION_AGENT_STORAGE_KEY)
      if (raw === undefined || raw === null) return {}
      return normalizeLedger(JSON.parse(raw) as unknown)
    } catch {
      return {}
    }
  }

  save(ledger: Record<string, AppliedPreset>): void {
    try {
      globalThis.localStorage?.setItem(SESSION_AGENT_STORAGE_KEY, JSON.stringify(ledger))
    } catch {
      // Quota or privacy mode: the display hint degrades to this session
      // (the in-memory copy the caller already holds) instead of throwing.
    }
  }
}
