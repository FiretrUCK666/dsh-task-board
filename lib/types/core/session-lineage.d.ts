/**
 * Subagent lineage — THE one place the board rolls a session's work up from
 * its subagent descendants.
 *
 * A session's own turn can stop while the subagent it summoned keeps working:
 * the official sidebar answers that case by walking `parentId` up an
 * UNINTERRUPTED `origin === 'subagent'` chain (`indexSubagentDescendants` in
 * dsh-client-ui-workspace — the projection behind 「N 个子代理运行中」), and the
 * board reads the very same `sessions.list` projection, so it must reach the
 * same conclusion the same way. A second, hand-rolled lineage rule here is how
 * the two sidebars start disagreeing about the same session.
 *
 * This is a literal port of that function, not a re-invention. Four semantics
 * are load-bearing and are copied one for one:
 * 1. `origin === 'subagent'` is the FIRST gate — a fork also carries a
 *    `parentId` but writes no `origin`, so it is never counted as a child;
 * 2. the chain is walked LEVEL BY LEVEL, so every ancestor on an uninterrupted
 *    subagent chain is credited (multi-level grandchildren included);
 * 3. `runningCount` accumulates the TRAVERSED node's own `running` — a stopped
 *    middle node whose child is still running leaves its ancestors live;
 * 4. a `seen` set stops a cycle, and a parent row that is missing from the
 *    snapshot simply ends the walk (never throws, never hangs).
 *
 * Identity comes from the RECORD KEY, not from a field on the row: the official
 * projection sets `byId[entry.sessionId].id = entry.sessionId`, so the two are
 * the same value — reading the key keeps this module independent of a field the
 * board's structural row type does not declare.
 *
 * Pure and framework-free: no IO, no subscription, no module-level cache. The
 * caller owns the returned index and rebuilds it when the snapshot REFERENCE
 * changes, so a read is an O(1) lookup and never re-walks the lineage.
 */
/** The lineage facts one session row must carry (a slice of the list row). */
export interface LineageRow {
    /** The session's own turn flag (the sheet's `byId[id].running`). */
    running: boolean;
    /** The session this one was spawned from, when the host recorded one. */
    parentId?: string;
    /** Coarse durable origin; `'subagent'` marks an agent-summoned session. */
    origin?: 'subagent';
}
/** Descendant totals under one ancestor (the official projection's shape). */
export interface DescendantRollup {
    /** Uninterrupted subagent-origin descendants at any depth. */
    count: number;
    /** How many of those descendants report `running` right now. */
    runningCount: number;
}
/** Ancestor id → descendant totals. Ids with no subagent descendant are absent. */
export type LineageIndex = ReadonlyMap<string, DescendantRollup>;
/**
 * Index uninterrupted subagent descendants under each ancestor.
 *
 * @param rows - session rows keyed by id (the list snapshot's `byId`, verbatim).
 * @returns descendant totals keyed by possible parent id.
 */
export declare function indexSubagentDescendants(rows: Readonly<Record<string, LineageRow | undefined>>): LineageIndex;
