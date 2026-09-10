import type { ReferenceRemoteFace } from '../../core/controller.ts';
/** One ready-to-render '@' menu row (display + the official splice text). */
export interface ReferenceRow {
    /** Group key: 'files' | 'sessions' (the official menu sections). */
    section: 'files' | 'sessions';
    /** Display title, already prefixed like the official menu (`文件 · x`). */
    name: string;
    /** Secondary line (path / session metadata), when the official menu shows one. */
    description?: string;
    /** Stable row key. */
    key: string;
    /** The official mention text to splice over the @ token. */
    insert: string;
    /** Keep the completion open after the splice (directory quote descent). */
    continue?: boolean;
}
/** Why one half produced no rows — the OFFICIAL log-only contract: a failed
 *  source is removed from the menu silently and logged (the official
 *  ui-reference behaves exactly this way); the menu never carries a failure
 *  text. `code` is the host envelope's error code when one was carried. */
export interface ReferenceDiag {
    /** Files half unavailable (missing namespace / failed RPC). */
    files?: {
        code?: string;
    };
    /** Sessions half unavailable (missing namespace / failed RPC). */
    sessions?: {
        code?: string;
    };
    /** Malformed candidates skipped by the row guard (never crashes the menu). */
    skipped?: number;
}
/** The bridge result: the renderable rows plus why a half is missing. */
export interface ReferenceMenuResult {
    rows: readonly ReferenceRow[];
    diag: ReferenceDiag;
}
/**
 * Fetch the official candidates for one '@' token. Files always run; session
 * discovery is suppressed inside an open quoted path (`@"…`), exactly like
 * the official source. The two halves resolve independently (the official
 * per-domain failure guarantee) and this function NEVER rejects.
 */
export declare function listReferenceRows(bridge: ReferenceRemoteFace | undefined, sessionId: string, query: string, quoted: boolean, signal: AbortSignal): Promise<ReferenceMenuResult>;
/**
 * The board-catalog session rows: the SAME ReferenceRow shape as the official
 * half, sourced from the board's own session catalog (id + latest title,
 * native list order). Used only when the host `candidates` half is
 * unavailable — the gateway refuses the agent lookup for subagent-routed
 * (agent-busy) target sessions, which fails the official discovery too.
 * Inserted text stays the OFFICIAL canonical mention
 * (`formatSessionReferenceMention`), so the host's pre-step parser resolves a
 * picked row exactly like a host candidate. Self is excluded (the official
 * rule); the cap mirrors the host's candidateLimit default.
 */
export declare function catalogSessionRowsOf(catalog: ReadonlyArray<{
    sessionId: string;
    label: string;
}>, targetSessionId: string, limit?: number): ReferenceRow[];
