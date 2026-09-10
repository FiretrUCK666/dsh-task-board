/**
 * Session-activity bridge (host): exposes NATIVE per-session state — the plan
 * mode, the active goal and the live slash-command catalog — to the board's
 * comment and refine surfaces. This is the architectural cornerstone of the
 * "no maintenance sync" contract: we never hardcode command names or plan
 * states; we READ the harness's own services (planMode / goals / commands /
 * agents) through thin structural faces, so whatever the official UI gains or
 * renames shows up here automatically. Any face that is missing or throws
 * degrades to that block being absent — never an error surface.
 */
import type { Context } from '@deepseek-ai/cordis';
/** The validated, shape-safe view a surface can render. */
export interface NativeActivityView {
    plan?: {
        active: boolean;
        pending: boolean;
    };
    goal?: {
        title: string;
        active: boolean;
    };
    commands?: Array<{
        name: string;
        description?: string;
    }>;
}
/** Service faces the host wiring supplies (each optional). */
export interface SessionActivityFaces {
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
    commands?: {
        list(agent: unknown): unknown;
    };
}
/**
 * Read the native activity of a session. Structural reads only: leaves that
 * are not well-formed are dropped (a re-shaped harness object keeps the view
 * safe). A missing agent or throwing service produces no block at all.
 */
export declare function readSessionActivity(faces: SessionActivityFaces, sessionId: string): NativeActivityView;
/** Extract a query parameter out of a raw request URL (no URL dependency). */
export declare function queryParamOf(rawUrl: string | undefined, key: string): string | undefined;
/** HTTP handler: GET /api/dsh-task-board/session-activity?sessionId=… → { ok, plan?, goal?, commands? }. */
export declare function createSessionActivityHandler(faces: SessionActivityFaces, read?: (faces: SessionActivityFaces, sessionId: string) => NativeActivityView): (req: {
    url?: string;
}, res: {
    writeHead(status: number, headers?: Record<string, string>): void;
    end(body?: string): void;
}) => Promise<void>;
/** Mount the bridge on the host web surface (mirrors registerSettingsRoute). */
export declare function registerSessionActivityRoute(ctx: Context): () => void;
