/**
 * Session-state bridge (host): exposes the native per-session PLAN mode,
 * active GOAL and live SUBAGENTS to the board's comment/refine surfaces.
 * This is the narrow read-only bridge — it deliberately DOES NOT carry a
 * command catalog (the command directory was removed from the board): only
 * live session state that the surfaces display. We never hardcode plan/goal/
 * subagent shapes; we READ the harness's own services (planMode / goals /
 * subagents) through thin structural faces, so official changes flow in
 * automatically. Any missing/throwing face degrades to that block being
 * absent — never an error surface.
 *
 * NATIVE SHAPES (verified against the deployment's own type definitions):
 * - goal: `goals.get(agent)` → GoalView `{ objective, phase:
 *   'active'|'paused'|'blocked'|'complete', ... }` — a completed goal
 *   (phase 'complete') is NOT in flight, so it is not exposed.
 * - subagents: `subagents.listChildren(parentSessionId)` → entries
 *   `{ kind: 'child'|'diagnostic', label?, activity: 'running'|'inactive',
 *   mode, hasChildren, ... }` (async, keyed by the parent SESSION id, not an
 *   agent object). 'running' = live now; 'inactive' = finished; a
 *   'diagnostic' row is not a child.
 */
import type { Context } from '@deepseek-ai/cordis';
/** The validated, shape-safe view a surface can render. */
export interface SessionStateView {
    plan?: {
        active: boolean;
        pending: boolean;
    };
    goal?: {
        title: string;
        active: boolean;
    };
    /** Child subagent thumbnails of the session (read-only directory view). */
    subagents?: Array<{
        title: string;
        status?: string;
    }>;
}
/** Service faces the host wiring supplies (each optional). */
export interface SessionStateFaces {
    sessions?: {
        get(id: string): unknown | undefined;
    };
    agents?: {
        get(id: string): unknown | undefined;
    };
    planMode?: {
        get(agent: unknown): unknown;
    };
    goals?: {
        get(agent: unknown): unknown;
    };
    subagents?: {
        listChildren(parentSessionId: string): Promise<unknown> | unknown;
    };
}
/**
 * Read the native plan/goal/subagent state of a session. Structural reads
 * only: leaves that are not well-formed are dropped; a missing agent or
 * throwing service produces no block at all.
 */
export declare function readSessionState(faces: SessionStateFaces, sessionId: string): Promise<SessionStateView>;
/** Extract a query parameter out of a raw request URL (no URL dependency). */
export declare function queryParamOf(rawUrl: string | undefined, key: string): string | undefined;
/** HTTP handler: GET /api/dsh-task-board/session-state?sessionId=… → { ok, plan?, goal? }. */
export declare function createSessionStateHandler(faces: SessionStateFaces, read?: (faces: SessionStateFaces, sessionId: string) => Promise<SessionStateView>): (req: {
    url?: string;
}, res: {
    writeHead(status: number, headers?: Record<string, string>): void;
    end(body?: string): void;
}) => Promise<void>;
/** Mount the bridge on the host web surface (mirrors registerSettingsRoute). */
export declare function registerSessionStateRoute(ctx: Context): () => void;
