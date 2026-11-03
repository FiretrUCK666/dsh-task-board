/**
 * Linked-sessions derivation: the pure logic behind a task's 链接会话 section.
 *
 * A linked row exists for a session the user explicitly bound to the task
 * (dragged in from the sidebar, created through the detail, picked in the
 * add-session dialog, or snapshotted at workspace-folder creation). A
 * WORKSPACE BIND is a source/config association (where the task came from,
 * where it runs) — it contributes NO rows by itself, so a session the user
 * creates in the main UI never appears on a task card by itself. (The
 * earlier live-member derivation was exactly that bug: every new session in
 * a bound workspace flooded into the card.) The folder-drop snapshot above
 * is the deliberate exception: at CREATION the card takes the workspace's
 * current live sessions as explicit rows — a snapshot, not a subscription.
 *
 * The session row is derived live from the native session snapshot (title,
 * running, pending interaction), so renames and state changes surface with no
 * manual copy, no drift. An explicitly bound session is never filtered by
 * BLANK (the user dragged it in on purpose) and only the user's own hide set
 * applies here; ARCHIVING is applied one level up, in `linkedOf`, because the
 * archive set is a registry-global concern (and it is reversible — the row
 * comes back the moment the session is unarchived). Pure and framework-free.
 */
import type { TaskRecord } from './tasks.ts';
import type { PendingInteractionKind } from './controller.ts';
/** The subset of a native session row the derivation reads. The controller
 *  supplies `running` as the session's ACTIVITY answer (its own turn or a
 *  running subagent descendant — the one derivation in session-activity.ts),
 *  never the bare flag: a session whose own turn paused while the subagent it
 *  summoned keeps working still renders as working, exactly like the official
 *  sidebar. */
export interface LinkedSessionSource {
    title?: string;
    /** The session's workspace directory path (its folder label derives from it). */
    cwd?: string;
    /** Empty-log placeholder (a blank session is a "New Session" slot, not a conversation). */
    blank: boolean;
    /** Whether the session is still working (activity: own turn ∨ running
     *  subagent descendant), as resolved by the caller. */
    running: boolean;
    updatedAt: number;
}
/** One linked-session row the board renders. */
export interface LinkedSessionRow {
    sessionId: string;
    /** Session title, else its workspace folder's last path segment, else the id. */
    title: string;
    /** The workspace folder label (cwd's last segment), when the cwd is known. */
    workspaceLabel?: string;
    /** Whether the session is still working (see {@link LinkedSessionSource.running}). */
    running: boolean;
    pendingInteraction?: PendingInteractionKind;
    updatedAt: number;
    /**
     * The session is ARCHIVED natively: put away, still there.
     *
     * ── WHY THE ROW EXISTS AND IS MARKED, INSTEAD OF BEING SKIPPED ────────────
     *
     * Archiving is reversible ("可恢复的隐藏"), and the derivation used to apply it by
     * `continue`ing past the row — so on the card, an archived conversation became
     * INDISTINGUISHABLE FROM A DELETED ONE. A person who tidied their sidebar saw
     * the card quietly lose a session it still owns, and the only way to tell
     * 「放起来了」 from 「没了」 was to go and un-archive it in the native sidebar to
     * find out. That is the same class of lie this project refuses everywhere: a
     * surface reporting an absence it cannot actually attest.
     *
     * The row stays and says so, so a reader can see the session is still bound.
     * `hidden` is different and remains a pure display choice the person made ON THE
     * CARD (`task.hidden.sessions`) — those rows are dropped here, because hiding is
     * an instruction about this panel rather than a fact about the session.
     */
    archived: boolean;
}
/** Inputs the derivation needs from the native domains (read-only snapshots). */
export interface LinkedSources {
    /** Every session row, keyed by id (sessions.list.byId). */
    byId: Readonly<Record<string, LinkedSessionSource>>;
    /** The task's display-hidden linked-session ids (task.hidden.sessions). */
    hidden: readonly string[];
}
/** Short display label of a directory path (last non-empty segment). THE one
 *  cwd→label derivation, shared with the session panels' workspace rows. */
export declare function workspaceLabelOf(cwd: string): string;
/**
 * The session's REAL name, or undefined. A durable title that is exactly the
 * workspace (project) BASENAME is the host's DETERMINISTIC auto-name — the
 * fallback it projects after the first message when nothing named the
 * session — NOT a name a human chose. Every title surface (run rows, linked
 * rows, panel headers) reads through here, so a fresh session never presents
 * its folder as its title. A user who deliberately names a session after its
 * own folder is the accepted, genuinely-ambiguous edge.
 */
export declare function realTitleOf(title: string | undefined, cwd: string | undefined): string | undefined;
/** The default title of a freshly dragged-in binding (from its native source). */
export declare function boundSourceTitle(bind: NonNullable<TaskRecord['bind']>, ctx: {
    sessions: Readonly<Record<string, Pick<LinkedSessionSource, 'title' | 'cwd'>>>;
    workspaces: readonly {
        id: string;
        title: string;
    }[];
}): string;
/** Classify an id drawn from a sidebar drag as a native session or workspace. */
export declare function resolveExternalKind(id: string, ctx: {
    sessions: Readonly<Record<string, unknown>>;
    workspaces: readonly {
        id: string;
    }[];
}): 'session' | 'workspace' | undefined;
/**
 * Derive the linked-session rows of one bind from the native snapshot.
 *
 * - session bind → exactly that session (never filtered by archived/blank:
 *   the user dragged it in on purpose; only the hide set applies);
 * - workspace bind → NO rows by itself (a workspace is a source/config
 *   association, never a subscription — folder drops snapshot their members
 *   as explicit session binds at creation instead);
 * - unbound → no rows.
 */
export declare function deriveLinkedSessions(bind: TaskRecord['bind'], sources: LinkedSources): readonly LinkedSessionRow[];
