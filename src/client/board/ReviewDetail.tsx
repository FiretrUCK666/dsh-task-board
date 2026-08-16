/**
 * Review page: one execution's review surface. Opened by clicking an
 * execution-history row, it shows the session's recent conversation
 * (the transcript tail, folded from raw history events following the
 * native harness rules) plus a live session panel — the execution
 * session's current model/reasoning effort (native models API), its
 * permission (switched through the native `/permission` command registry —
 * never a model turn), its real workspace/Agent facts (from the
 * session-list summary, read-only — an Agent cannot be switched here, the
 * native `agent-preset-locked` constraint is surfaced as read-only facts),
 * and the native context meter (occupancy percent + colored
 * system/tools/messages bar, straight from the `contextPressure`/
 * `contextBreakdown` projections the history tail page carries). When the
 * execution session is blocked on the user (approval / plan review /
 * question — the native sidebar wait signal), a waiting banner explains it
 * and points at "查看会话". The layout is two columns: the conversation
 * owns the full left height; a right rail holds a fixed head (meter,
 * config, session facts — always visible) above an independently scrolling
 * comment thread, with the composer pinned at its bottom. Comments are a
 * per-task FIFO queue — saved rounds (cruise off) wait, queued rounds
 * (cruise on, budget full) show their position, and both can be cancelled
 * until injected; a comment whose first character is '/' is a slash
 * command executed through the native command registry (unknown commands
 * fall back to plain text), exactly like the native composer. Transcript
 * and session data refresh while the panel is open (a lightweight 3s poll
 * gated on the projection watermark + manual refresh), so continuing the
 * conversation in the native session page shows up here. The native
 * session page remains the place for the full transcript ("查看会话");
 * this page never duplicates the full conversation view.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { BoardController, SessionConfigFace, SessionModelChoice, SessionModelGroup, TranscriptEventShape, TranscriptProjectionsShape } from '../../core/controller.ts'
import type { ExecutionRecord, TaskRecord } from '../../core/tasks.ts'
import { permissionLabel } from '../permission-label.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { PromptInput } from './PromptInput.tsx'
import { formatDateTime } from './TaskCard.tsx'
import { foldTranscript, sumUsage, type TranscriptLine } from './review-transcript.ts'
import { contextOccupancy, contextSegments, formatTokens } from './context-meter.ts'

/** Model-select value encoding: provider + model, joined by a NUL separator. */
const MODEL_SEP = '\u0000'

/** The session's real workspace root → short display label (last path segment). */
function workspaceLabelOf(cwd: string): string {
  const segment = cwd.split(/[\\/]+/).filter(Boolean).pop()
  return segment !== undefined && segment !== '' ? segment : cwd
}

/**
 * One memoized transcript row. Props are the primitive render facts (never
 * the line object), so a light poll that re-folds the tail only re-renders
 * the rows whose content actually changed — long transcripts stay smooth.
 */
const TranscriptRow = memo(function TranscriptRow(props:
  | { kind: 'context'; plugin: string; summary: string }
  | { kind: 'message'; role: 'user' | 'assistant'; text: string }
) {
  if (props.kind === 'context') {
    return (
      <li className={css.reviewContext} title={props.summary}>
        {t('review.contextInjection')} · {props.plugin}
      </li>
    )
  }
  return (
    <li className={css.reviewMessage} data-role={props.role}>
      <span className={css.reviewMessageText}>{props.text}</span>
    </li>
  )
})

/** One comment round rendered in the thread, with its live state. */
interface CommentView {
  round: ExecutionRecord
  state: 'saved' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
}

/**
 * Build the comment thread of a task for one session, oldest first. The
 * state machine mirrors the unified dispatcher:
 * - `saved`: cruise off — the comment stays saved (never injected).
 * - `queued`: cruise on but the round waits for a free slot / the task's
 *   busy round (it will inject in order).
 * - `running`: injected, the session is running it.
 * - settled states as recorded.
 */
function commentsOf(task: TaskRecord, sessionId: string | undefined, cruiseOn: boolean): CommentView[] {
  if (sessionId === undefined) return []
  return task.executions
    .filter(round => round.comment !== undefined && round.sessionId === sessionId)
    .map(round => {
      let state: CommentView['state']
      if (round.endedAt !== undefined) state = round.result ?? 'cancelled'
      else if (round.injectedAt !== undefined) state = 'running'
      else state = cruiseOn ? 'queued' : 'saved'
      return { round, state }
    })
}

/** The 1-based queue position of an uninjected round (its order among the task's pending rounds). */
function queuePositionOf(comments: readonly CommentView[], roundId: string): number {
  const pending = comments
    .filter(view => view.state === 'saved' || view.state === 'queued' || view.state === 'running')
    .sort((a, b) => a.round.startedAt - b.round.startedAt)
  const index = pending.findIndex(view => view.round.id === roundId)
  return index < 0 ? 0 : index + 1
}

/** Comment-round state → chip color + label key. */
function commentStateOf(state: CommentView['state'], position: number): { kind: 'success' | 'error' | 'warn' | 'muted'; label: string } {
  switch (state) {
    case 'succeeded': return { kind: 'success', label: t('review.commentSucceeded') }
    case 'failed': return { kind: 'error', label: t('review.commentFailed') }
    case 'cancelled': return { kind: 'muted', label: t('review.commentCancelled') }
    case 'running': return { kind: 'warn', label: t('review.commentRunning') }
    case 'queued': return { kind: 'warn', label: t('review.commentQueued', { n: String(position) }) }
    case 'saved': return { kind: 'muted', label: t('review.commentPending') }
  }
}

/** The review page (see module doc). */
export function ReviewDetail({ controller, task, execution, onClose }: {
  controller: BoardController
  /** The task owning the execution (re-read from the controller snapshot on updates). */
  task: TaskRecord
  /** The execution row that was clicked (its session is reviewed and continued). */
  execution: ExecutionRecord
  onClose: () => void
}) {
  const [snapshot, setSnapshot] = useState(controller.getSnapshot())
  useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller])
  // The live task record: the clicked execution may have been superseded.
  const current = snapshot.tasks.find(candidate => candidate.id === task.id) ?? task
  const sessionId = execution.sessionId
  const cruiseOn = snapshot.cruise.enabled
  const comments = commentsOf(current, sessionId, cruiseOn)
  const sessionConfig = controller.sessionConfig()

  const [lines, setLines] = useState<readonly TranscriptLine[] | undefined>(undefined)
  const [transcriptError, setTranscriptError] = useState(false)
  // Native projection baseline (context pressure / breakdown) from the
  // history tail page — the source of the context meter below.
  const [projections, setProjections] = useState<TranscriptProjectionsShape | undefined>(undefined)
  // Live session panel: current selection + selectable directory.
  const [sessionModels, setSessionModels] = useState<{ current: SessionModelChoice; groups: readonly SessionModelGroup[] } | undefined>(undefined)
  const [configUnavailable, setConfigUnavailable] = useState(false)
  const [configBusy, setConfigBusy] = useState(false)
  const [configMessage, setConfigMessage] = useState<string | undefined>(undefined)
  const [permissionRows, setPermissionRows] = useState<readonly { id: string; name?: string; description?: string }[] | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [lastCommentId, setLastCommentId] = useState<string | undefined>(undefined)
  // The last observed transcript watermark (the tail event's seq): the light
  // poll only re-renders when new events actually arrived, so an idle
  // session costs nothing and a busy one re-renders only on real progress.
  const watermarkRef = useRef<number | undefined>(undefined)

  // The native permission-preset directory for the permission switcher
  // (same catalog as the new-task form; absent = no switcher).
  useEffect(() => {
    let alive = true
    void (async () => {
      const rows = await controller.runCatalog()?.listPermissions()
      if (alive) setPermissionRows(rows)
    })()
    return () => { alive = false }
  }, [controller])

  /** The transcript watermark of a loaded result (tail seq; 0 when empty). */
  const watermarkOf = (result: { events: readonly TranscriptEventShape[] }): number => {
    const tail = result.events[result.events.length - 1]
    return tail?.seq ?? result.events.length
  }

  /** Full reload: transcript + session panel (open, task changes, manual). */
  const reload = useCallback((): void => {
    if (sessionId === undefined) return
    void controller.loadTranscript(sessionId).then(result => {
      if (result === undefined) setTranscriptError(true)
      else {
        setTranscriptError(false)
        watermarkRef.current = watermarkOf(result)
        setLines(foldTranscript(result.events))
        setProjections(result.projections)
      }
    })
    if (sessionConfig !== undefined) {
      void sessionConfig.readModels(sessionId).then(result => {
        if (result === undefined) setConfigUnavailable(true)
        else {
          setConfigUnavailable(false)
          setSessionModels(result)
        }
      })
    }
  }, [controller, sessionId, sessionConfig])

  /** Light sync poll: refetch the transcript tail and re-render only when
   *  the watermark moved (new events). Never touches the session panel. */
  const poll = useCallback((): void => {
    if (sessionId === undefined) return
    void controller.loadTranscript(sessionId).then(result => {
      if (result === undefined) return
      if (watermarkRef.current === watermarkOf(result)) return
      watermarkRef.current = watermarkOf(result)
      setTranscriptError(false)
      setLines(foldTranscript(result.events))
      setProjections(result.projections)
    })
  }, [controller, sessionId])

  // Load on open + whenever the task's run history changes (a comment
  // injected or settled) — a full reload.
  useEffect(() => { reload() }, [reload, current.executions.length, current.status])
  // Light poll at 3s while the panel is open; paused while the tab is
  // hidden (the native rhythm), with an immediate catch-up on return.
  useEffect(() => {
    const timer = setInterval(poll, 3_000)
    const onVisibility = (): void => { if (!document.hidden) poll() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [poll])

  const submit = (): void => {
    const text = draft.trim()
    if (text === '') return
    // A draft whose first non-space character is '/' is a slash command,
    // exactly like the native composer: it executes through the host command
    // registry (unknown commands fall back to plain text). Plain prompts
    // never start with '/', so nothing user-typed is misrouted.
    const round = controller.submitComment(current.id, execution.id, text, text.startsWith('/'))
    if (round !== undefined) {
      setLastCommentId(round.id)
      setDraft('')
    }
  }

  /** Apply a new model selection to the execution session. */
  const applyModel = (key: string): void => {
    if (sessionConfig === undefined || sessionId === undefined || sessionModels === undefined) return
    const sepIndex = key.indexOf(MODEL_SEP)
    if (sepIndex < 0) return
    const provider = key.slice(0, sepIndex)
    const model = key.slice(sepIndex + 1)
    const group = sessionModels.groups.find(candidate => candidate.provider === provider)
    const row = group?.models.find(candidate => candidate.id === model)
    const effort = row?.reasoning?.defaultEffort
    setConfigBusy(true)
    setConfigMessage(undefined)
    void sessionConfig.selectModel(sessionId, { provider, model, ...effort !== undefined ? { reasoningEffort: effort } : {} }).then(result => {
      setConfigBusy(false)
      setConfigMessage(result.ok ? t('review.configApplied') : result.error)
      if (result.ok) reload()
    })
  }

  /** Apply a reasoning effort to the current model selection. */
  const applyEffort = (effort: string): void => {
    if (sessionConfig === undefined || sessionId === undefined || sessionModels === undefined) return
    const selection = sessionModels.current
    setConfigBusy(true)
    setConfigMessage(undefined)
    void sessionConfig.selectModel(sessionId, {
      provider: selection.provider,
      model: selection.model,
      ...effort !== '' ? { reasoningEffort: effort } : {},
    }).then(result => {
      setConfigBusy(false)
      setConfigMessage(result.ok ? t('review.configApplied') : result.error)
      if (result.ok) reload()
    })
  }

  /** Apply a permission preset to the execution session. */
  const applyPermission = (permission: string): void => {
    if (sessionConfig === undefined || sessionId === undefined || permission === '') return
    setConfigBusy(true)
    setConfigMessage(undefined)
    void sessionConfig.setPermission(sessionId, permission).then(result => {
      setConfigBusy(false)
      setConfigMessage(result.ok ? t('review.configApplied') : result.error)
    })
  }

  // The run's sequence among the task's plain runs (comment rounds excluded).
  const runIndex = current.executions
    .filter(candidate => candidate.comment === undefined)
    .indexOf(execution) + 1
  const usage = sumUsage(lines ?? [])
  // The execution session is blocked on the user (approval / plan review /
  // question): surfaced live from the native session-list signal.
  const waiting = controller.pendingInteractionOf(sessionId)
  // The session's real workspace + composed Agent (distinct from the task
  // card's run configuration, which feeds the next fresh run).
  const sessionInfo = controller.sessionInfo(sessionId)
  // Context meter: the native occupancy figure (~N / M) + colored composition
  // bar. Falls back to the per-message usage sum when no projection is served.
  const occupancy = contextOccupancy(projections?.contextPressure)
  const meterSegments = occupancy !== undefined
    ? contextSegments(occupancy, projections?.contextBreakdown)
    : undefined

  return (
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className={css.review} role="dialog" aria-label={t('review.title')}>
        <header className={css.reviewHeader}>
          <h2 className={css.reviewTitle}>
            {current.title}
            <span className={css.reviewBadge}>
              {t('detail.executionNo', { n: String(runIndex) })}
            </span>
          </h2>
          <div className={css.reviewActions}>
            <button
              type="button"
              className={css.ghostButton}
              onClick={reload}
              title={t('review.refresh')}
            >
              {t('review.refresh')}
            </button>
            {sessionId !== undefined && (
              <button
                type="button"
                className={css.ghostButton}
                onClick={() => { controller.openSession(sessionId) }}
              >
                {t('detail.viewSession')} →
              </button>
            )}
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('detail.close')}
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        <div className={css.reviewBody}>
          {/* Left column: the conversation — full-height, its own scrollbar.
              The rail on the right holds everything else, so a long
              transcript never competes with config or comments. */}
          <div className={css.reviewMain}>
            <div className={css.reviewTranscriptScroll}>
            <div className={css.reviewOutcome}>
              <Chip kind={execution.result === 'failed' ? 'error' : execution.result === 'succeeded' ? 'success' : 'muted'}>
                {execution.result === undefined ? t('detail.result.running') : t(`detail.result.${execution.result}` as 'detail.result.succeeded')}
              </Chip>
              <span className={css.reviewOutcomeMeta}>
                {t('detail.executionEnded')} {execution.endedAt !== undefined ? formatDateTime(execution.endedAt) : '—'}
              </span>
            </div>

            {waiting !== undefined && (
              <div className={css.reviewWaiting} role="status">
                <Chip kind="warn" fill={false}>{t('review.waiting')}</Chip>
                <span>
                  {t('review.waitingTitle', { kind: t(`waiting.${waiting}` as 'waiting.approval') })}
                </span>
              </div>
            )}

            {sessionId === undefined ? (
              <p className={css.detailText}>{t('review.noSession')}</p>
            ) : transcriptError ? (
              <p className={css.detailText}>{t('review.transcriptUnavailable')}</p>
            ) : lines === undefined ? (
              <p className={css.detailText}>{t('review.loading')}</p>
            ) : lines.length === 0 ? (
              <p className={css.detailText}>{t('review.transcriptEmpty')}</p>
            ) : (
              <ul className={css.reviewTranscript}>
                {lines.map(line => line.kind === 'context' ? (
                  <TranscriptRow
                    key={line.id}
                    kind="context"
                    plugin={line.plugin}
                    summary={line.summary}
                  />
                ) : (
                  <TranscriptRow
                    key={line.id}
                    kind="message"
                    role={line.role}
                    text={line.text}
                  />
                ))}
              </ul>
            )}

            {/* The context meter note: rendered in the right rail below. */}
            </div>
          </div>

          {/* Right rail: context meter, session config and session facts in a
              fixed head — always visible no matter how long the comment
              thread grows — then the comment thread in its own scroll region,
              and the composer pinned at the rail's bottom. */}
          <aside className={css.reviewRail}>
            <div className={css.reviewRailHead}>
          {sessionId !== undefined && meterSegments !== undefined && occupancy !== undefined && (
            <div className={css.reviewContextMeter} aria-label={t('review.meterOf', { percent: `${occupancy.percent}%` })}>
              <div className={css.reviewMeterHead}>
                <span className={css.reviewMeterReading}>{t('review.meterUsed')}</span>
                <span className={css.reviewMeterPercent}>{occupancy.percent}%</span>
                <span className={css.reviewMeterFigures}>
                  {t('review.meterFigures', {
                    used: formatTokens(occupancy.usedTokens),
                    window: formatTokens(occupancy.contextWindow),
                  })}
                </span>
              </div>
              <div className={css.reviewMeterBar} aria-hidden="true">
                {meterSegments.map(segment => (
                  <span
                    key={segment.key}
                    className={`${css.reviewMeterSegment}${segment.className !== undefined ? ` ${css[segment.className as keyof typeof css]}` : ''}`}
                    style={{ width: `${segment.width}%` }}
                  />
                ))}
              </div>
              {(() => {
                const breakdown = projections?.contextBreakdown
                if (breakdown === undefined) return null
                return (
                  <div className={css.reviewMeterRows}>
                    <span className={css.reviewMeterRow}>
                      <span className={`${css.reviewMeterSwatch} ${css.meterSystem}`} aria-hidden="true" />
                      <span>{t('review.meterSystem')}</span>
                      <span className={css.reviewMeterValue}>~{formatTokens(breakdown.systemTokens)}</span>
                    </span>
                    <span className={css.reviewMeterRow}>
                      <span className={`${css.reviewMeterSwatch} ${css.meterTools}`} aria-hidden="true" />
                      <span>{t('review.meterTools')}</span>
                      <span className={css.reviewMeterValue}>~{formatTokens(breakdown.toolsTokens)}</span>
                    </span>
                    <span className={css.reviewMeterRow}>
                      <span className={`${css.reviewMeterSwatch} ${css.meterMessages}`} aria-hidden="true" />
                      <span>{t('review.meterMessages')}</span>
                      <span className={css.reviewMeterValue}>~{formatTokens(breakdown.messageTokens)}</span>
                    </span>
                  </div>
                )
              })()}
            </div>
          )}

          {sessionId !== undefined && meterSegments === undefined && usage !== undefined && (
            <p className={css.reviewUsage}>
              {t('review.usage')}：
              {t('review.usageInput', { n: String(usage.inputTokens) })} · {t('review.usageOutput', { n: String(usage.outputTokens) })}
              {usage.cacheReadTokens !== undefined && ` · ${t('review.usageCacheRead', { n: String(usage.cacheReadTokens) })}`}
              {usage.cacheWriteTokens !== undefined && ` · ${t('review.usageCacheWrite', { n: String(usage.cacheWriteTokens) })}`}
              {usage.reasoningTokens !== undefined && ` · ${t('review.usageReasoning', { n: String(usage.reasoningTokens) })}`}
            </p>
          )}

          {/* The live session panel: model / effort / permission of this
              execution session — the same native APIs the harness uses. */}
          {sessionId !== undefined && sessionConfig !== undefined && (
            <section className={css.reviewConfig}>
              <span className={css.reviewConfigTitle}>{t('review.config')}</span>
              {configUnavailable || sessionModels === undefined ? (
                <span className={css.reviewConfigUnavailable}>{t('review.configUnavailable')}</span>
              ) : (
                <div className={css.reviewConfigGrid}>
                  <span className={css.reviewConfigRow}>
                    <span className={css.reviewConfigLabel}>{t('review.model')}</span>
                    <span className={css.selectWrap}>
                      <select
                        className={css.input}
                        value={`${sessionModels.current.provider}${MODEL_SEP}${sessionModels.current.model}`}
                        disabled={configBusy}
                        onChange={event => { applyModel(event.target.value) }}
                      >
                        {sessionModels.groups.flatMap(group => group.models.map(model => (
                          <option key={`${group.provider}${MODEL_SEP}${model.id}`} value={`${group.provider}${MODEL_SEP}${model.id}`}>
                            {group.provider} / {model.name ?? model.id}
                          </option>
                        )))}
                      </select>
                    </span>
                  </span>
                  {(() => {
                    const group = sessionModels.groups.find(candidate => candidate.provider === sessionModels.current.provider)
                    const row = group?.models.find(candidate => candidate.id === sessionModels.current.model)
                    const efforts = row?.reasoning?.efforts ?? []
                    if (efforts.length === 0) return null
                    return (
                      <span className={css.reviewConfigRow}>
                        <span className={css.reviewConfigLabel}>{t('review.effort')}</span>
                        <span className={css.selectWrap}>
                          <select
                            className={css.input}
                            value={sessionModels.current.reasoningEffort ?? ''}
                            disabled={configBusy}
                            onChange={event => { applyEffort(event.target.value) }}
                          >
                            <option value="">{t('review.effortDefault')}</option>
                            {efforts.map(effort => (
                              <option key={effort.id} value={effort.id}>{effort.name ?? effort.id}</option>
                            ))}
                          </select>
                        </span>
                      </span>
                    )
                  })()}
                  {permissionRows !== undefined && (
                    <span className={css.reviewConfigRow}>
                      <span className={css.reviewConfigLabel}>{t('review.permission')}</span>
                      <span className={css.selectWrap}>
                        <select
                          className={css.input}
                          value={current.permission ?? ''}
                          disabled={configBusy}
                          onChange={event => { applyPermission(event.target.value) }}
                        >
                          <option value="">{t('new.permissionDefault')}</option>
                          {permissionRows.map(row => (
                            <option key={row.id} value={row.id}>{permissionLabel(row.id, row.name)}</option>
                          ))}
                        </select>
                      </span>
                    </span>
                  )}
                </div>
              )}
              {configMessage !== undefined && <span className={css.reviewConfigMessage}>{configMessage}</span>}
              {sessionId !== undefined && sessionInfo !== undefined && (
                <div className={css.reviewSessionFacts}>
                  <span className={css.reviewSessionFact}>
                    <span className={css.reviewSessionFactLabel}>{t('review.sessionWorkspace')}</span>
                    <span
                      className={css.reviewSessionFactValue}
                      title={sessionInfo.cwd ?? undefined}
                    >
                      {sessionInfo.cwd !== undefined ? workspaceLabelOf(sessionInfo.cwd) : t('review.sessionUnknown')}
                    </span>
                  </span>
                  <span className={css.reviewSessionFact}>
                    <span className={css.reviewSessionFactLabel}>{t('review.sessionAgent')}</span>
                    <span className={css.reviewSessionFactValue}>
                      {sessionInfo.agentPreset !== undefined ? sessionInfo.agentPreset : t('review.sessionDefaultAgent')}
                    </span>
                  </span>
                </div>
              )}
              <span className={css.reviewConfigHint}>{t('review.sessionHint')}</span>
            </section>
          )}
            </div>

            {/* The comment thread scrolls in its own region: however long it
                grows, the rail head above stays visible. Saved or queued
                rounds (not yet injected) can be cancelled; injected ones
                show their live state. */}
            <div className={css.reviewRailThread}>
            <h4 className={css.reviewThreadTitle}>
              {t('review.comments')}
              <span className={css.reviewThreadCount}>{comments.length}</span>
            </h4>
            <div className={css.reviewCommentList}>
              {comments.length === 0 ? (
                <p className={css.detailText}>{t('review.noComments')}</p>
              ) : (
                <ul className={css.reviewComments}>
                  {comments.map(view => {
                    const position = queuePositionOf(comments, view.round.id)
                    const state = commentStateOf(view.state, position)
                    const cancellable = view.state === 'saved' || view.state === 'queued'
                    return (
                      <li key={view.round.id} className={css.reviewComment}>
                        <span className={css.reviewCommentText}>
                          {view.round.command === true && <span className={css.reviewCommentCommand} aria-hidden="true">/</span>}
                          {view.round.comment}
                        </span>
                        <span className={css.reviewCommentMeta}>
                          <Chip kind={state.kind}>{state.label}</Chip>
                          <span className={css.reviewCommentTime}>{formatDateTime(view.round.startedAt)}</span>
                          {cancellable && (
                            <button
                              type="button"
                              className={css.reviewCommentCancel}
                              onClick={() => { controller.cancelComment(view.round.id) }}
                            >
                              {t('review.commentCancel')}
                            </button>
                          )}
                        </span>
                        {/* A settled command round carries its registry
                            outcome (e.g. "/permission read-only" → "preset
                            read-only", or an unknown-preset error). */}
                        {view.round.command === true && view.round.error !== undefined && view.round.error !== '' && (
                          <span className={`${css.executionError}${view.state === 'succeeded' ? ` ${css.reviewCommandOutcome}` : ''}`}>{view.round.error}</span>
                        )}
                        {view.state === 'failed' && view.round.command !== true && view.round.error !== undefined && view.round.error !== '' && (
                          <span className={css.executionError}>{view.round.error}</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            </div>

            {/* The composer, pinned at the rail's bottom: a comment continues
                the conversation in-session. It shares the prompt autocomplete
                with the task form — the same live slash catalog, so commands
                and skills never drift. */}
            <div className={css.reviewComposer}>
              <PromptInput
                value={draft}
                onChange={setDraft}
                placeholder={t('review.commentPlaceholder')}
                rows={3}
                controller={controller}
              />
              <div className={css.reviewComposerRow}>
                <button type="button" className={css.primaryButton} disabled={draft.trim() === ''} onClick={submit}>
                  {t('review.commentSend')}
                </button>
                {lastCommentId !== undefined && !current.executions.some(round => round.id === lastCommentId && round.endedAt !== undefined) && (
                  <span className={css.reviewComposerHint}>
                    {current.status === 'running' ? t('review.commentInjected')
                      : cruiseOn ? t('review.commentQueuedHint')
                        : t('review.commentPendingHint')}
                  </span>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
