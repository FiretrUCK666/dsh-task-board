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
 * config, session facts — always visible) above a fixed thread header
 * (title + count) and an independently scrolling comment list, with the
 * composer pinned at its bottom. The thread shows only the comments of the
 * execution being reviewed — each execution's page shows its own, the
 * injection queue stays task-level (a round's position is computed over the
 * whole task). Both the transcript and the comment list auto-follow the
 * latest output while at the bottom, with a "滑到最新" button when scrolled
 * up. A comment whose first character is '/' is a slash
 * command executed through the native command registry (unknown commands
 * fall back to plain text), exactly like the native composer. Transcript
 * and session data refresh while the panel is open (a lightweight 3s poll
 * gated on the projection watermark + manual refresh), so continuing the
 * conversation in the native session page shows up here. The native
 * session page remains the place for the full transcript ("查看会话");
 * this page never duplicates the full conversation view.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { BoardController, SessionModelChoice, SessionModelGroup, TranscriptEventShape, TranscriptProjectionsShape } from '../../core/controller.ts'
import { plainRunsOf, type ExecutionRecord, type TaskRecord } from '../../core/tasks.ts'
import { permissionLabel } from '../permission-label.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { PromptInput } from './PromptInput.tsx'
import { formatDateTime } from './TaskCard.tsx'
import { foldTranscript, sumUsage, type TranscriptLine } from './review-transcript.ts'
import { contextOccupancy, contextSegments, formatTokens } from './context-meter.ts'
import { commentsOf, commentKindOf, commentStateKey, queuePositionOf, type CommentViewState } from './comment-thread.ts'

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

/** How close to the bottom a scroll position counts as "at the latest". */
const NEAR_BOTTOM_PX = 24

/**
 * The sticky "滑到最新" affordance shown in a scroll region (transcript or
 * comment thread) when the user has scrolled away from the bottom: one click
 * returns to the latest output. Hidden while the region is at the bottom,
 * where new content already auto-follows.
 */
function JumpToLatest({ atBottom, onJump }: { atBottom: boolean; onJump: () => void }) {
  if (atBottom) return null
  return (
    <button type="button" className={css.reviewJumpLatest} onClick={onJump}>
      <svg className={css.reviewJumpLatestIcon} viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 9.5 8 4.5 13 9.5" />
      </svg>
      {t('review.jumpLatest')}
    </button>
  )
}

/** The chip label of a comment display state ("排队中 · 第 N 位" uses the task-level queue position). */
function commentLabel(state: CommentViewState, position: number): string {
  return state === 'queued'
    ? t('review.commentQueued', { n: String(position) })
    : t(commentStateKey(state))
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
  // This execution's own comment thread (the review page shows only the
  // comments submitted from the execution being reviewed).
  const comments = commentsOf(current, execution, cruiseOn)
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
  // Both scroll regions (conversation + comment list) auto-follow their
  // latest output while the user is at the bottom; scrolling up pauses the
  // follow and shows a "滑到最新" button (`JumpToLatest`) to return.
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const [transcriptAtBottom, setTranscriptAtBottom] = useState(true)
  const threadScrollRef = useRef<HTMLDivElement | null>(null)
  const [threadAtBottom, setThreadAtBottom] = useState(true)
  // The comment-thread change fingerprint (id+state of every round): the
  // thread follow fires only on real comment changes — new saves, state
  // transitions — never on unrelated re-renders from the light poll.
  const threadFingerprint = comments.map(view => `${view.round.id}:${view.state}`).join('|')

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

  // Follow new conversation output: at the bottom, new lines scroll the
  // transcript down with the reply — no manual dragging while a comment
  // continuation streams. A deliberate scroll-up pauses the follow until
  // the user returns to the bottom (or clicks the jump button).
  useEffect(() => {
    const element = transcriptScrollRef.current
    if (element === null || !transcriptAtBottom) return
    element.scrollTop = element.scrollHeight
  }, [lines, transcriptAtBottom])

  const onTranscriptScroll = (): void => {
    const element = transcriptScrollRef.current
    if (element === null) return
    setTranscriptAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX)
  }

  const jumpTranscript = (): void => {
    const element = transcriptScrollRef.current
    if (element === null) return
    element.scrollTop = element.scrollHeight
    setTranscriptAtBottom(true)
  }

  // The same follow for the comment list: new rounds and state transitions
  // scroll it to the newest comment while at the bottom.
  useEffect(() => {
    const element = threadScrollRef.current
    if (element === null || !threadAtBottom) return
    element.scrollTop = element.scrollHeight
  }, [threadFingerprint, threadAtBottom])

  const onThreadScroll = (): void => {
    const element = threadScrollRef.current
    if (element === null) return
    setThreadAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX)
  }

  const jumpThread = (): void => {
    const element = threadScrollRef.current
    if (element === null) return
    element.scrollTop = element.scrollHeight
    setThreadAtBottom(true)
  }

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
      // The session's real permission changed through the native command;
      // refresh so the projection-backed select shows the new value.
      if (result.ok) reload()
    })
  }

  // The permission switcher's truth: the session's live permission select
  // from the native `permissions` projection (the same value the harness
  // PermissionSelect reads) — never the task card's permission field, which
  // only configures the next fresh run. Without a projection (deployment
  // without the registry) it falls back to the route-backed preset catalog
  // and the task field.
  const livePermission = projections?.permissions
  const permissionOptions: readonly { id: string; name?: string; description?: string }[] | undefined
    = livePermission !== undefined
      ? livePermission.options.map(option => ({ id: option.value, name: option.name, ...option.description !== undefined ? { description: option.description } : {} }))
      : permissionRows
  const permissionValue = livePermission !== undefined
    ? livePermission.currentValue
    : (current.permission ?? '')

  // The run's sequence among the task's plain runs (comment rounds excluded).
  const runIndex = plainRunsOf(current).findIndex(candidate => candidate.id === execution.id) + 1
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
            <div
              className={css.reviewTranscriptScroll}
              ref={transcriptScrollRef}
              onScroll={onTranscriptScroll}
            >
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

            <JumpToLatest atBottom={transcriptAtBottom} onJump={jumpTranscript} />

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
                  {permissionOptions !== undefined && (
                    <span className={css.reviewConfigRow}>
                      <span className={css.reviewConfigLabel}>{t('review.permission')}</span>
                      <span className={css.selectWrap}>
                        <select
                          className={css.input}
                          value={permissionValue}
                          disabled={configBusy}
                          onChange={event => { applyPermission(event.target.value) }}
                        >
                          <option value="">{t('new.permissionDefault')}</option>
                          {permissionOptions.map(row => (
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

            {/* The thread header: title + count, fixed — the count never
                scrolls away no matter how long the comment list grows. */}
            <div className={css.reviewThreadHeader}>
              <h4 className={css.reviewThreadTitle}>
                {t('review.comments')}
                <span className={css.reviewThreadCount}>{comments.length}</span>
              </h4>
            </div>

            {/* The comment list scrolls in its own region below the header;
                the rail head and the count above stay visible. Saved or queued
                rounds (not yet injected) can be cancelled; injected ones show
                their live state. New rounds follow while at the bottom. */}
            <div className={css.reviewRailThread} ref={threadScrollRef} onScroll={onThreadScroll}>
            <div className={css.reviewCommentList}>
              {comments.length === 0 ? (
                <p className={css.detailText}>{t('review.noComments')}</p>
              ) : (
                <ul className={css.reviewComments}>
                  {comments.map(view => {
                    const position = queuePositionOf(current, view.round.id)
                    const cancellable = view.state === 'saved' || view.state === 'queued'
                    return (
                      <li key={view.round.id} className={css.reviewComment}>
                        <span className={css.reviewCommentText}>
                          {view.round.command === true && <span className={css.reviewCommentCommand} aria-hidden="true">/</span>}
                          {view.round.comment}
                        </span>
                        <span className={css.reviewCommentMeta}>
                          <Chip kind={commentKindOf(view.state)}>{commentLabel(view.state, position)}</Chip>
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
            <JumpToLatest atBottom={threadAtBottom} onJump={jumpThread} />
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
