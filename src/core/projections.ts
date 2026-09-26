/**
 * Structural projection pick: read the PAGE-SCOPED session-projection values
 * riding the history tail page into the board's `TranscriptProjectionsShape`.
 *
 * `values` is typed as `Partial<SessionProjectionMap>`, a merge table whose
 * keys exist only when the domain packages are imported — this plugin never
 * imports them, so every field is read and shape-guarded structurally.
 * Anything that is not a plain object with the expected numeric fields is
 * dropped (the key's absence is handled gracefully downstream: capability
 * absence is key absence, never a crash, never a fake zero).
 *
 * WHAT DOES NOT BELONG HERE: a value describing what a session IS right now
 * rather than what it had recorded. The `permissions` projection is the case
 * that proved it — `/permission` opens no turn, so this page's copy of it
 * never refreshed and the panel displayed the value from before the user
 * changed anything. Current settings are read live instead (see
 * `SessionConfigFace.readPermission`).
 *
 * Pure and framework-free, so the pick matrix unit-tests in isolation; the
 * client wiring (`index.ts`) only calls it.
 */
import type {
  SessionGoalShape,
  SessionStatsShape,
  SessionTodoShape,
  TokenUsageShape,
  TranscriptLoadResult,
  TranscriptProjectionsShape,
} from './controller.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Pick the board's projection slice out of the tail page's raw values.
 * Unknown, malformed or partial values are dropped key by key — one bad
 * domain never hides the rows the other domains returned.
 */
export function pickTranscriptProjections(
  values: Record<string, unknown> | undefined,
): Pick<TranscriptLoadResult, 'projections'> {
  if (values === undefined) return {}
  const projections: TranscriptProjectionsShape = {}
  const pressure = values.contextPressure
  if (isRecord(pressure)) {
    projections.contextPressure = {
      ...num(pressure.pressureTokens) !== undefined ? { pressureTokens: pressure.pressureTokens as number } : {},
      ...num(pressure.projectedTokens) !== undefined ? { projectedTokens: pressure.projectedTokens as number } : {},
      ...num(pressure.contextWindow) !== undefined ? { contextWindow: pressure.contextWindow as number } : {},
    }
  }
  const breakdown = values.contextBreakdown
  if (isRecord(breakdown)) {
    const systemTokens = num(breakdown.systemTokens)
    const toolsTokens = num(breakdown.toolsTokens)
    const messageTokens = num(breakdown.messageTokens)
    if (systemTokens !== undefined && toolsTokens !== undefined && messageTokens !== undefined) {
      projections.contextBreakdown = { systemTokens, toolsTokens, messageTokens }
    }
  }
  // NOT lifted here: the `permissions` projection. This block is the one riding
  // a HISTORY PAGE, i.e. a snapshot of past events — right for what a session
  // HAD SAID (todos, token accounting, context pressure), wrong for what a
  // session IS. A per-session setting like the permission preset is changed by
  // a command that never opens a turn, so no new event appears and this copy
  // never refreshes; the panel read it and showed a stale value forever. It
  // now comes from the live projection read (`SessionConfigFace.readPermission`).
  // The official `todos` projection (the harness's own TodoPanel reads the
  // same host-computed whole list) — structural pick, no typing imports.
  const todos = values.todos
  if (Array.isArray(todos)) {
    const rows: SessionTodoShape[] = []
    for (const item of todos) {
      if (!isRecord(item)) continue
      if (typeof item.content !== 'string' || item.content === '') continue
      const status = item.status === 'in_progress' || item.status === 'completed' ? item.status : 'pending'
      rows.push({ content: item.content, status })
    }
    if (rows.length > 0) projections.todos = rows
  }
  // Cumulative whole-log token usage (the meter package's durable totals —
  // the four buckets are disjoint; all four must be numbers or the key drops).
  const tokenUsage = values.tokenUsage
  if (isRecord(tokenUsage)) {
    const uncachedInputTokens = num(tokenUsage.uncachedInputTokens)
    const outputTokens = num(tokenUsage.outputTokens)
    const cacheReadTokens = num(tokenUsage.cacheReadTokens)
    const cacheWriteTokens = num(tokenUsage.cacheWriteTokens)
    if (
      uncachedInputTokens !== undefined && outputTokens !== undefined
      && cacheReadTokens !== undefined && cacheWriteTokens !== undefined
    ) {
      const usage: TokenUsageShape = { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
      projections.tokenUsage = usage
    }
  }
  // Whole-log turn/step figures (all eight fields numeric, or the key drops —
  // every field is 0 until its first contributing event lands, so zeros are
  // valid values and only non-numbers disqualify).
  const sessionStats = values.sessionStats
  if (isRecord(sessionStats)) {
    const turns = num(sessionStats.turns)
    const steps = num(sessionStats.steps)
    const llmMs = num(sessionStats.llmMs)
    const toolMs = num(sessionStats.toolMs)
    const ttftMs = num(sessionStats.ttftMs)
    const ttftSteps = num(sessionStats.ttftSteps)
    const decodeMs = num(sessionStats.decodeMs)
    const decodeTokens = num(sessionStats.decodeTokens)
    if (
      turns !== undefined && steps !== undefined && llmMs !== undefined && toolMs !== undefined
      && ttftMs !== undefined && ttftSteps !== undefined && decodeMs !== undefined && decodeTokens !== undefined
    ) {
      const stats: SessionStatsShape = { turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
      projections.sessionStats = stats
    }
  }
  // The current goal (`GoalProjection | null`): `null` means cleared/none
  // (kept as null so the readout can hide deterministically); a `complete`
  // phase is dropped (the official surface renders nothing for it).
  const goal = values.goal
  if (goal === null) {
    projections.goal = null
  } else if (isRecord(goal)) {
    const inner = goal.goal
    if (isRecord(inner)) {
      const id = str(inner.id)
      const revision = num(inner.revision)
      const objective = str(inner.objective)
      const phase = inner.phase
      // `maxGoalRounds` lives on the durable snapshot (inside `goal.goal`);
      // the counters live on the projection shell around it.
      const maxGoalRounds = num(inner.maxGoalRounds)
      const roundsStarted = num(goal.roundsStarted)
      const createdAt = num(goal.createdAt)
      const updatedAt = num(goal.updatedAt)
      if (
        id !== undefined && id !== '' && revision !== undefined && objective !== undefined && objective !== ''
        && (phase === 'active' || phase === 'paused' || phase === 'blocked')
        && maxGoalRounds !== undefined && roundsStarted !== undefined
        && createdAt !== undefined && updatedAt !== undefined
      ) {
        const snapshot: SessionGoalShape = {
          id,
          revision,
          objective,
          phase,
          maxGoalRounds,
          roundsStarted,
          createdAt,
          updatedAt,
        }
        const blockedReason = inner.blockedReason
        if (phase === 'blocked' && isRecord(blockedReason)) {
          const code = str(blockedReason.code)
          const message = str(blockedReason.message)
          if (code !== undefined && message !== undefined && message.trim() !== '') {
            snapshot.blockedReason = { code, message: message.trim() }
          }
        }
        projections.goal = snapshot
      }
    }
  }
  return projections.contextPressure !== undefined || projections.contextBreakdown !== undefined
    || projections.todos !== undefined
    || projections.tokenUsage !== undefined || projections.sessionStats !== undefined
    || projections.goal !== undefined
    ? { projections }
    : {}
}

/**
 * The session's LIVE permission value, read from a projection BASELINE (the
 * host's own `permissions` projection — the same value its permission selector
 * displays).
 *
 * This is the panel's ONLY source for the value, and it is deliberately not
 * {@link pickTranscriptProjections}: that one reads a history page, which is a
 * snapshot of past events. `/permission` opens no turn, so no new event ever
 * appears and a page-scoped copy of this value never refreshes — the panel read
 * it and showed the preset from before the user changed anything, for as long
 * as the panel stayed open.
 *
 * TWO things the host keeps apart, and so does this: the projection carries
 **only** `currentValue` (its wire shape is exactly `{ currentValue: string }`),
 * while the CHOICES come from the separate permission-preset catalog — the
 * harness's own selector joins them the same way. Reading an option list out of
 * the projection is how a perfectly good value reads as "unavailable".
 *
 * `undefined` = the host does not serve the projection, or serves it in a
 * shape this plugin cannot read honestly. The caller then SAYS SO; it must
 * never substitute a default, because 「默认」 is itself a claim about the
 * session's state.
 */
export function readPermissionValueOf(values: Record<string, unknown> | undefined): string | undefined {
  const permissions = values?.permissions
  if (typeof permissions !== 'object' || permissions === null) return undefined
  const currentValue = (permissions as { currentValue?: unknown }).currentValue
  return typeof currentValue === 'string' ? currentValue : undefined
}
