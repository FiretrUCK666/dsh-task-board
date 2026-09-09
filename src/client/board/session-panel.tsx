/**
 * Shared session-panel components: the right-rail building blocks that every
 * session surface composes — the execution review page (ReviewDetail), the
 * linked-session panel (SessionDetail) and the refinement panel
 * (RefineSection). Each block is small and self-contained; the callers own
 * their rail layout and their semantic differences (a drive composer vs a
 * direct composer are deliberately NOT shared here — see the two panels).
 *
 * Everything reads the same session-generic faces (sessionInfo,
 * sessionConfig, transcript projections), so any block works for any native
 * session id.
 */
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { BoardController, PendingInteractionKind, SessionModelChoice, SessionModelGroup, TranscriptProjectionsShape } from '../../core/controller.ts'
import type { WireQuestion } from '../../core/question-rpc.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { permissionLabel } from '../permission-label.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { contextOccupancy, contextSegments, formatTokens } from './context-meter.ts'
import { formatDuration } from './format-time.ts'
import { Markdown } from './Markdown.tsx'
import { sumUsage, type TranscriptImage, type TranscriptLine } from './review-transcript.ts'
import { JumpToLatest, useFollowScroll } from './use-transcript.tsx'
import { useSurfaceNarrow } from './use-narrow.ts'
import { Chip, type ChipKind } from './Chip.tsx'
import { CommentsThread } from './CommentsThread.tsx'
import type { CommentView } from './comment-thread.ts'
import { InteractionCard } from './InteractionCard.tsx'
import { AttachmentStrip } from './AttachmentStrip.tsx'
import { COMMENT_IMAGE_BUDGET, MAX_COMMENT_IMAGES, type DraftFile, type DraftImage } from './attach.ts'
import { useComposerImages, type FileStager } from './composer-images.ts'
import { commentDraftKey, draftStore } from './drafts.ts'
import { PromptInput } from './PromptInput.tsx'
import { Button, Disclosure, Notice, SendModeToggle } from './ui.tsx'
import { workspaceLabelOf } from '../../core/linked-sessions.ts'
import { waitingKeyOf } from './session-chip.ts'

/** Model-select value encoding: provider + model, joined by a NUL separator. */
const MODEL_SEP = '\u0000'

/**
 * One message image: the durable ref is read back through the official
 * attachment RPC (cached + single-flighted by the wiring), then shown as a
 * click-to-open thumbnail. While loading it keeps its box (no layout jump);
 * a failed/absent read degrades to a quiet name chip, never a broken icon.
 */
function MessageImage({ controller, sessionId, image }: {
  controller: BoardController
  sessionId: string
  image: TranscriptImage
}) {
  const [src, setSrc] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    void controller.loadImage(sessionId, image.attachmentId).then(value => {
      if (!alive) return
      if (value === undefined) setFailed(true)
      else setSrc(`data:${value.mediaType};base64,${value.data}`)
    })
    return () => { alive = false }
  }, [controller, sessionId, image.attachmentId])
  if (failed) {
    return <span className={css.reviewImageMissing} title={image.name ?? ''}>{t('review.imageMissing')}</span>
  }
  if (src === undefined) {
    return <span className={css.reviewImageBox} aria-hidden="true" />
  }
  return (
    <a className={css.reviewImageBox} href={src} target="_blank" rel="noreferrer" title={image.name ?? ''}>
      <img className={css.reviewImage} src={src} alt={image.name ?? ''} loading="lazy" />
    </a>
  )
}

/**
 * One memoized transcript row. Props are the primitive render facts (never
 * the line object), so a light poll that re-folds the tail only re-renders
 * the rows whose content actually changed — long transcripts stay smooth.
 */
const TranscriptRow = memo(function TranscriptRow(props:
  | { kind: 'context'; plugin: string; summary: string }
  | { kind: 'message'; role: 'user' | 'assistant'; text: string; sessionId?: string; controller?: BoardController; images?: TranscriptImage[] }
) {
  if (props.kind === 'context') {
    return (
      <li className={css.reviewContext} title={props.summary}>
        {t('review.contextInjection')} · {props.plugin}
      </li>
    )
  }
  const images = props.images ?? []
  const { controller, sessionId } = props
  return (
    <li className={css.reviewMessage} data-role={props.role}>
      {images.length > 0 && controller !== undefined && sessionId !== undefined && (
        <span className={css.reviewImageRow}>
          {images.map(image => (
            <MessageImage key={image.attachmentId} controller={controller} sessionId={sessionId} image={image} />
          ))}
        </span>
      )}
      {props.text !== '' && (
        <div className={css.reviewMessageText}>
          <Markdown text={props.text} />
        </div>
      )}
    </li>
  )
})

/**
 * The shared transcript-region content: optional header (the review page's
 * outcome banner), the waiting banner, error/loading/empty states, the
 * folded message list (optionally capped to the trailing N, with the native
 * "load earlier" affordance above it when the host holds older messages)
 * and the "滑到最新" pill. Callers own their scroll region and the tail
 * hook; this is pure rendering, so every live session surface looks and
 * behaves identically.
 */
export function SessionTranscript({ lines, error, atBottom, jumpToBottom, waiting, maxLines, hasMore, loadingEarlier, onLoadEarlier, before, onRetry, sessionId, controller }: {
  lines: readonly TranscriptLine[] | undefined
  error: boolean
  atBottom: boolean
  jumpToBottom: () => void
  waiting?: PendingInteractionKind
  /** Render only the trailing N lines (the refinement panel's cap). */
  maxLines?: number
  /** The host holds messages older than the loaded window. */
  hasMore?: boolean
  /** An earlier page is being fetched right now. */
  loadingEarlier?: boolean
  /** Prepend one earlier page above the window (the native grammar). */
  onLoadEarlier?: () => void
  /** Optional header content inside the region (the review page's outcome banner). */
  before?: ReactNode
  /** Re-read the tail (the error state's retry — a timeout/unavailable read
   *  must never be a dead end; the caller wires this to the hook's reload). */
  onRetry?: () => void
  /** The session the tail belongs to + the controller (message images read
   *  their bytes through the official attachment RPC; absent = refs only). */
  sessionId?: string
  controller?: BoardController
}) {
  const shown = lines === undefined ? undefined : maxLines === undefined ? lines : lines.slice(-maxLines)
  // The native "load earlier" row belongs ABOVE the list (older messages
  // live above), capped to the uncapped surface — a capped refinement tail
  // never pages (its window is a preview, not the log). It renders whenever
  // the host says there IS more — even over an empty window (a misaligned
  // tail that folds to zero lines with hasMore must still offer the way
  // back; an empty text with no button is a dead end that reads as "没有了").
  const paging = hasMore === true && maxLines === undefined && onLoadEarlier !== undefined
  return (
    <>
      {before}
      <SessionWaitingNotice waiting={waiting} />
      {paging && (
        <div className={css.transcriptEarlierRow}>
          <Button size="sm" disabled={loadingEarlier === true} onClick={onLoadEarlier}>
            {t(loadingEarlier === true ? 'review.loadingEarlierBusy' : 'review.loadEarlier')}
          </Button>
        </div>
      )}
      {error ? (
        <div className={css.transcriptErrorRow}>
          <p className={css.detailText}>{t('review.transcriptUnavailable')}</p>
          {onRetry !== undefined && (
            <Button size="sm" onClick={onRetry}>{t('review.retry')}</Button>
          )}
        </div>
      ) : shown === undefined ? (
        <p className={css.detailText}>{t('review.loading')}</p>
      ) : shown.length === 0 ? (
        <p className={css.detailText}>{t('review.transcriptEmpty')}</p>
      ) : (
        <ul className={css.reviewTranscript}>
          {shown.map(line => line.kind === 'context' ? (
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
              sessionId={sessionId}
              controller={controller}
              images={line.images}
            />
          ))}
        </ul>
      )}
      <JumpToLatest atBottom={atBottom} onJump={jumpToBottom} />
    </>
  )
}

/** One waiting banner, shared by every session surface. */
export function SessionWaitingNotice({ waiting }: { waiting: PendingInteractionKind | undefined }) {
  if (waiting === undefined) return null
  return (
    <Notice chip={t('review.waiting')}>
      {t('review.waitingTitle', { kind: t(waitingKeyOf(waiting)) })}
    </Notice>
  )
}

/**
 * The session's real workspace + composed Agent: read-only value rows INSIDE
 * the live config grid (the same row grammar as the model/effort/permission
 * selects, same field order as the task detail's 运行配置) — one module,
 * no separate facts strip, no explanatory paragraph. A value row renders in
 * the same box geometry as a select, so the read-only meaning is carried by
 * the absence of a dropdown affordance, never by prose.
 */
export function SessionFacts({ info }: { info: { cwd?: string; agentPreset?: string } | undefined }) {
  if (info === undefined) return null
  return (
    <>
      <span className={css.reviewConfigRow}>
        <span className={css.reviewConfigLabel}>{t('review.sessionWorkspace')}</span>
        <span className={css.reviewConfigValue} title={info.cwd ?? undefined}>
          {info.cwd !== undefined ? workspaceLabelOf(info.cwd) : t('review.sessionUnknown')}
        </span>
      </span>
      <span className={css.reviewConfigRow}>
        <span className={css.reviewConfigLabel}>{t('review.sessionAgent')}</span>
        <span className={css.reviewConfigValue} title={info.agentPreset ?? undefined}>
          {info.agentPreset !== undefined ? info.agentPreset : t('review.sessionDefaultAgent')}
        </span>
      </span>
    </>
  )
}

/** Sum of the transcript's token accounting (the meter's fallback strip). */
interface SessionUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/**
 * The context meter block: native occupancy figure + colored composition
 * bar (from the transcript projections), the cumulative whole-log token
 * totals (from the `tokenUsage` projection — durable, not the paged-window
 * sum below), the whole-log turn/step figures (from `sessionStats`), or the
 * token-sum fallback strip when no projection is served. A high-occupancy
 * state (>= 85%) shifts the reading to the attention tone — the same warn
 * grammar as every board signal.
 */
export function ContextMeterPanel({ projections, usage }: {
  projections: TranscriptProjectionsShape | undefined
  usage: SessionUsage | undefined
}) {
  const occupancy = contextOccupancy(projections?.contextPressure)
  const segments = occupancy !== undefined
    ? contextSegments(occupancy, projections?.contextBreakdown)
    : undefined
  // Cumulative whole-log totals ride the projection; the paged-window sum is
  // only the fallback when the meter package is absent.
  const total = projections?.tokenUsage !== undefined
    ? {
      inputTokens: projections.tokenUsage.uncachedInputTokens,
      outputTokens: projections.tokenUsage.outputTokens,
      cacheReadTokens: projections.tokenUsage.cacheReadTokens,
      cacheWriteTokens: projections.tokenUsage.cacheWriteTokens,
    }
    : usage
  const totalCumulative = projections?.tokenUsage !== undefined
  if (occupancy !== undefined && segments !== undefined) {
    const warn = occupancy.percent >= 85
    return (
      <div
        className={css.reviewContextMeter}
        data-warn={warn ? '' : undefined}
        aria-label={t('review.meterOf', { percent: `${occupancy.percent}%` })}
      >
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
          {segments.map(segment => (
            <span
              key={segment.key}
              className={`${css.reviewMeterSegment}${segment.className !== undefined ? ` ${css[segment.className]}` : ''}`}
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
        {totalCumulative && total !== undefined && (
          <p className={css.reviewUsage}>
            {t('review.usageTotal')} · {t('review.usageInput', { n: formatTokens(total.inputTokens) })} · {t('review.usageOutput', { n: formatTokens(total.outputTokens) })}
            {total.cacheReadTokens !== undefined && ` · ${t('review.usageCacheRead', { n: formatTokens(total.cacheReadTokens) })}`}
            {total.cacheWriteTokens !== undefined && ` · ${t('review.usageCacheWrite', { n: formatTokens(total.cacheWriteTokens) })}`}
          </p>
        )}
        {(() => {
          const stats = projections?.sessionStats
          if (stats === undefined) return null
          return (
            <p className={css.reviewUsage}>
              {t('review.statsTurns', { turns: String(stats.turns), steps: String(stats.steps) })}
              {(stats.llmMs > 0 || stats.toolMs > 0) && ` · ${t('review.statsTime', {
                llm: formatDuration(stats.llmMs),
                tool: formatDuration(stats.toolMs),
              })}`}
            </p>
          )
        })()}
      </div>
    )
  }
  if (total !== undefined) {
    if (totalCumulative) {
      return (
        <p className={css.reviewUsage}>
          {t('review.usageTotal')} · {t('review.usageInput', { n: formatTokens(total.inputTokens) })} · {t('review.usageOutput', { n: formatTokens(total.outputTokens) })}
          {total.cacheReadTokens !== undefined && ` · ${t('review.usageCacheRead', { n: formatTokens(total.cacheReadTokens) })}`}
          {total.cacheWriteTokens !== undefined && ` · ${t('review.usageCacheWrite', { n: formatTokens(total.cacheWriteTokens) })}`}
        </p>
      )
    }
    return (
      <p className={css.reviewUsage}>
        {t('review.usage')}：
        {t('review.usageInput', { n: String(total.inputTokens) })} · {t('review.usageOutput', { n: String(total.outputTokens) })}
        {total.cacheReadTokens !== undefined && ` · ${t('review.usageCacheRead', { n: String(total.cacheReadTokens) })}`}
        {total.cacheWriteTokens !== undefined && ` · ${t('review.usageCacheWrite', { n: String(total.cacheWriteTokens) })}`}
        {total.reasoningTokens !== undefined && ` · ${t('review.usageReasoning', { n: String(total.reasoningTokens) })}`}
      </p>
    )
  }
  return null
}

/**
 * The live session-config editor: model / reasoning effort / permission of
 * any native session, straight from the native APIs (the same sources the
 * harness's own selectors read). Permission applies through the native
 * `/permission` command registry — never a model turn. Self-contained: it
 * loads the model directory on mount and refreshes after every change; the
 * caller may bump `reloadKey` to force a re-read.
 */
export function SessionConfigEditor({ sessionId, controller, permissionValue, permissionOptions, onChanged, reloadKey }: {
  sessionId: string
  controller: BoardController
  /** Projection-backed permission value (authoritative when present). */
  permissionValue?: string
  /** Projection-backed permission options; absent = the route catalog. */
  permissionOptions?: readonly { id: string; name?: string; description?: string }[]
  /** Fired after a successful change (the caller refreshes its transcript). */
  onChanged?: () => void
  /** A value whose change forces a full re-read of the model directory. */
  reloadKey?: unknown
}) {
  const sessionConfig = controller.sessionConfig()
  const [sessionModels, setSessionModels] = useState<{ current: SessionModelChoice; groups: readonly SessionModelGroup[] } | undefined>(undefined)
  // THREE states, never two: "still loading" and "the read failed" are
  // different facts, and showing the first as the red error line is how a
  // slow phone link read as a broken session (「会话经常加载不了」).
  const [configFailed, setConfigFailed] = useState(false)
  const [configBusy, setConfigBusy] = useState(false)
  const [configMessage, setConfigMessage] = useState<string | undefined>(undefined)
  const [permissionRows, setPermissionRows] = useState<readonly { id: string; name?: string; description?: string }[] | undefined>(undefined)
  // The permission select's local fallback: the last permission the user
  // chose (and applied). A controlled select bound only to the projection
  // snaps back to the old value the moment a choice is made — with no
  // projection (or a still-stale one) the local choice is the only truth
  // we have, so it must hold until the projection confirms it.
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  // Alive guard: every async handler (panel reload, model/effort/permission
  // applies) must not touch state after the panel unmounted — the panel can
  // close while a read/apply is still in flight, and a late `.then` must
  // not repaint a dead surface.
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  // The projection is the session's live truth: when it reports a value that
  // differs from our local choice, the choice is stale (the permission was
  // changed elsewhere) and the projection takes over. The session's default
  // ('') never clears the choice — that is exactly the no-projection case.
  // While an apply is in flight (configBusy) the arbitration is paused so a
  // stale projection can never interrupt the user's in-flight selection.
  useEffect(() => {
    if (!configBusy && permissionValue !== undefined && permissionValue !== '' && permissionValue !== chosen) {
      setChosen(undefined)
    }
  }, [permissionValue, chosen, configBusy])

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

  /** Re-read the live session panel (model selection + directory). */
  const reloadPanel = useCallback((): void => {
    if (sessionConfig === undefined) return
    void sessionConfig.readModels(sessionId).then(result => {
      if (!aliveRef.current) return
      if (result === undefined) setConfigFailed(true)
      else {
        setConfigFailed(false)
        setSessionModels(result)
      }
    })
  }, [sessionConfig, sessionId])

  // Load on open + whenever the caller forces a re-read (+ the retry nonce).
  const [retryNonce, setRetryNonce] = useState(0)
  useEffect(() => { reloadPanel() }, [reloadPanel, reloadKey, retryNonce])

  // SELF-HEALING failure: a transient read failure (flaky phone link, the
  // host mid-restart) retries once after a beat on its own, and again when
  // the tab returns to the foreground — a failure is never a dead end the
  // user must discover and punch through manually. One retry in flight.
  const pendingRetryRef = useRef(false)
  const failedRef = useRef(false)
  failedRef.current = configFailed
  const scheduleRetry = useCallback((): void => {
    if (pendingRetryRef.current) return
    pendingRetryRef.current = true
    setTimeout(() => {
      pendingRetryRef.current = false
      if (aliveRef.current) setRetryNonce(value => value + 1)
    }, 2_000)
  }, [])
  useEffect(() => {
    const onVisibility = (): void => { if (!document.hidden && failedRef.current) scheduleRetry() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { document.removeEventListener('visibilitychange', onVisibility) }
  }, [scheduleRetry])
  useEffect(() => { if (configFailed) scheduleRetry() }, [configFailed, scheduleRetry])

  /** Apply a new model selection to the session. */
  const applyModel = (key: string): void => {
    if (sessionConfig === undefined || sessionModels === undefined) return
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
      if (!aliveRef.current) return
      setConfigBusy(false)
      setConfigMessage(result.ok ? t('review.configApplied') : result.error)
      if (result.ok) {
        reloadPanel()
        onChanged?.()
      }
    })
  }

  /** Apply a reasoning effort to the current model selection. */
  const applyEffort = (effort: string): void => {
    if (sessionConfig === undefined || sessionModels === undefined) return
    const selection = sessionModels.current
    setConfigBusy(true)
    setConfigMessage(undefined)
    void sessionConfig.selectModel(sessionId, {
      provider: selection.provider,
      model: selection.model,
      ...effort !== '' ? { reasoningEffort: effort } : {},
    }).then(result => {
      if (!aliveRef.current) return
      setConfigBusy(false)
      setConfigMessage(result.ok ? t('review.configApplied') : result.error)
      if (result.ok) {
        reloadPanel()
        onChanged?.()
      }
    })
  }

  /** Apply a permission preset to the session. */
  const applyPermission = (permission: string): void => {
    if (sessionConfig === undefined || permission === '') return
    setConfigBusy(true)
    setConfigMessage(undefined)
    void sessionConfig.setPermission(sessionId, permission).then(result => {
      if (!aliveRef.current) return
      setConfigBusy(false)
      setConfigMessage(result.ok ? t('review.configApplied') : result.error)
      if (result.ok) {
        // The session's real permission changed through the native command;
        // refresh so the projection-backed select shows the new value.
        reloadPanel()
        onChanged?.()
      } else {
        // The switch failed — the session's permission is unchanged; drop
        // the optimistic choice so the select shows the previous truth.
        setChosen(undefined)
      }
    })
  }

  if (sessionConfig === undefined) return null

  const options = permissionOptions ?? permissionRows
  // Display truth: the user's local choice first (it is newest), then the
  // projection's value when it has confirmed one, then the default option.
  const value = chosen ?? permissionValue ?? ''

  return (
    <section className={css.reviewConfig}>
      <span className={css.reviewConfigTitle}>{t('review.config')}</span>
      {sessionModels === undefined ? (
        configFailed ? (
          // Failed, and the automatic retry did not land: say so honestly and
          // hand the user the retry — never a red line on a still-loading read.
          <span className={css.reviewConfigFailed}>
            <span className={css.reviewConfigUnavailable}>{t('review.configUnavailable')}</span>
            <Button size="sm" onClick={scheduleRetry}>{t('review.retry')}</Button>
          </span>
        ) : (
          <span className={css.reviewConfigLoading}>{t('review.configLoading')}</span>
        )
      ) : (
        <div className={css.reviewConfigGrid}>
          {/* The session's real composition first, matching the task detail's
              run-config field order: workspace → agent → model → effort →
              permission. Read-only rows are plain value boxes (no dropdown
              affordance); the selects apply instantly. */}
          <SessionFacts info={controller.sessionInfo(sessionId)} />
          <span className={css.reviewConfigRow}>
            <span className={css.reviewConfigLabel}>{t('review.model')}</span>
            <span className={css.selectWrap}>
              <select
                className={css.input}
                value={`${sessionModels.current.provider}${MODEL_SEP}${sessionModels.current.model}`}
                disabled={configBusy}
                onChange={event => { applyModel(event.target.value) }}
              >
                {sessionModels.groups.map(group => (
                  <optgroup key={group.provider} label={group.provider}>
                    {group.models.map(model => (
                      <option key={`${group.provider}${MODEL_SEP}${model.id}`} value={`${group.provider}${MODEL_SEP}${model.id}`}>
                        {model.name ?? model.id}
                      </option>
                    ))}
                  </optgroup>
                ))}
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
          {options !== undefined && (
            <span className={css.reviewConfigRow}>
              <span className={css.reviewConfigLabel}>{t('review.permission')}</span>
              <span className={css.selectWrap}>
                <select
                  className={css.input}
                  value={value}
                  disabled={configBusy}
                  onChange={event => {
                    // Optimistic local choice: the select must hold the
                    // user's selection even before the projection confirms
                    // it — otherwise a controlled select with no local
                    // fallback snaps back to the old value immediately.
                    setChosen(event.target.value)
                    applyPermission(event.target.value)
                  }}
                >
                  <option value="">{t('new.permissionDefault')}</option>
                  {options.map(row => (
                    <option key={row.id} value={row.id}>{permissionLabel(row.id, row.name)}</option>
                  ))}
                </select>
              </span>
            </span>
          )}
        </div>
      )}
      {configMessage !== undefined && <span className={css.reviewConfigMessage}>{configMessage}</span>}
    </section>
  )
}

/**
 * The rail head BODY: context meter + live config editor + session facts,
 * composed in the order every session panel shows them. SessionRail renders
 * it inside the shared Disclosure (the fold + chevron grammar) within the
 * rail's single scroll body; callers pass what they read from their
 * transcript hook (projections via onResult, folded lines). The permission
 * switcher's projection mapping is derived HERE — one source for every panel
 * (a caller-level mapping is how the linked panel lost it).
 */
export function SessionRailHead({ sessionId, controller, projections, lines, onChanged, reloadKey }: {
  sessionId: string | undefined
  controller: BoardController
  projections: TranscriptProjectionsShape | undefined
  /** The folded transcript lines (token-accounting fallback for the meter). */
  lines: readonly TranscriptLine[] | undefined
  onChanged?: () => void
  reloadKey?: unknown
}) {
  // Without a session there is nothing to show (the caller keeps its rail
  // empty, exactly like the pre-refactor gating on sessionId).
  if (sessionId === undefined) return null
  // The permission switcher's truth: the session's live permission select
  // from the native `permissions` projection (the same value the harness
  // PermissionSelect reads) — never the task card's permission field, which
  // only configures the next fresh run. Without a projection the editor
  // falls back to the route-backed preset catalog + its local choice.
  const livePermission = projections?.permissions
  const permissionOptions = livePermission !== undefined
    ? livePermission.options.map(option => ({ id: option.value, name: option.name, ...option.description !== undefined ? { description: option.description } : {} }))
    : undefined
  const permissionValue = livePermission !== undefined ? livePermission.currentValue : undefined
  return (
    <>
      <ContextMeterPanel projections={projections} usage={sumUsage(lines ?? [])} />
      <SessionConfigEditor
        sessionId={sessionId}
        controller={controller}
        onChanged={onChanged}
        reloadKey={reloadKey}
        permissionValue={permissionValue}
        permissionOptions={permissionOptions}
      />
    </>
  )
}

/**
 * THE session rail — the one composition every session panel renders (the
 * execution review page and the linked-session panel share it verbatim), and
 * THE height contract that ends the squeeze-and-clip family of bugs.
 *
 * It hands its caller TWO blocks, never four:
 *
 *   [ folds: live state row → collapsible CONFIG head → collapsible COMMENTS ]
 *   [ the caller's pinned composer                                           ]
 *
 * Desktop geometry: the rail is a flex column — the folds block absorbs the
 * height (its comments region owns the one scroll box inside it) and the
 * composer is `flex: none` below, so nothing can push the send box away.
 *
 * Narrow geometry (the panel's own container query): the rail box steps aside
 * (`display: contents`) and the panel becomes a THREE-ROW grid —
 * `folds / transcript / composer`. That is the whole fix for 「上下文一多就把
 * 评论和留言按钮全部截断」:
 *   - the folds block is capped (a fraction of the panel) and bounds a fully
 *     rendered head, so an expanded config can never eat the screen;
 *   - the comments box owns its capped scroll at every width (one grammar —
 *     滑到最新 drives it, desktop and phone);
 *   - the transcript owns the flexible middle row and always keeps room;
 *   - the composer is its own grid row at the panel's bottom edge — not the
 *     last item in someone else's scroll content (which is exactly how it used
 *     to end up below the fold, unreachable).
 * Because the folds block is capped and the comments box scrolls inside
 * its own cap, opening one fold never reflows the other, and 滑到最新
 * drives the box that actually holds the comments — at every width.
 *
 * Callers pass data and their send semantics; the grammar, the folds and the
 * hint line live here exactly once — no panel can drift again.
 */
export function SessionRail({ stateChip, updatedAt, sessionId, controller, projections, lines, onChanged, reloadKey, task, thread, onCancelComment, interaction, composer }: {
  /** The live state row (chip + updated time); absent hides the whole row. */
  stateChip?: { kind: ChipKind; label: string; spinner?: boolean }
  updatedAt?: string
  sessionId: string | undefined
  controller: BoardController
  projections: TranscriptProjectionsShape | undefined
  lines: readonly TranscriptLine[] | undefined
  onChanged?: () => void
  reloadKey?: unknown
  task: TaskRecord
  thread: readonly CommentView[]
  onCancelComment: (roundId: string) => boolean
  /** The pending native question (plan confirm / ask); absent hides the card. */
  interaction: WireQuestion | undefined
  /** The pinned composer (the panel's send semantics stay in the caller). */
  composer: ReactNode
}) {
  // The comment thread follows its latest round through the SAME mechanism as
  // the transcript (resolved scroller + capture listener + pinning). The ROOT
  // is the comments box itself at every width — 滑到最新 always drives the
  // region that actually holds the comments.
  const commentsScrollRef = useRef<HTMLDivElement | null>(null)
  const [commentsAtBottom, setCommentsAtBottom] = useState(true)
  // Both folds start with the config head FOLDED on a phone: the
  // conversation and the send box are the first screen, while the comments
  // fold starts OPEN at every width (one grammar — the thread is always the
  // first screen, collapsible on tap). A wide rail absorbs the config
  // (two-column config grid), so it starts open there. The signal is the PANEL's own width (the same
  // surface the CSS container query measures, via `useSurfaceNarrow`) — NOT the
  // viewport: a mid-size window with the shell sidebar open already renders the
  // stacked panel while the viewport still says "wide", and a default that
  // followed the viewport would disagree with what the user is looking at.
  const [narrowPanel, foldsRef] = useSurfaceNarrow('[data-dsh-taskboard-panel]', 600)
  const [headOpen, setHeadOpen] = useState(!narrowPanel)
  // The comments fold starts OPEN at every width (one grammar, desktop and
  // phone): the thread is the first screen, and the Disclosure row collapses
  // it on tap. Only the config head starts folded on a phone.
  const [commentsOpen, setCommentsOpen] = useState(true)
  const threadFingerprint = thread.map(view => `${view.round.id}:${view.state}`).join('|')
  const { measure: onCommentsScroll, jumpToBottom: jumpComments } = useFollowScroll(
    commentsScrollRef, commentsAtBottom, setCommentsAtBottom, threadFingerprint,
    /* Remount signal: folding the comments unmounts .commentsScroll; the fold
       state flips back on re-expand, so the observer + follow effects re-bind
       to the NEW element (a fold→expand loop used to lose bottom-follow and
       the 滑到最新 button — the review caught it). */
    commentsOpen || interaction !== undefined,
    /* A MANUAL open must NOT pin to the bottom: the immediate scroll pushed
       the fold head off-screen and the reader had to drag back up to re-fold
       (「评论一点开直接拉到底」). A pending question keeps the pin (it must be
       seen — jumpComments below also forces it). */
    interaction !== undefined,
  )
  // A pending question is the ONE thing in this panel the user must answer for
  // the session to move at all — so arriving must bring it into view even when
  // the reader had scrolled up (the follow-while-at-bottom rule deliberately
  // does not fire for them). The force-opened fold alone is not enough on a
  // phone: the card can still sit below the capped region's viewport with its
  // 确认/拒绝 buttons off-screen and no hint that anything is waiting.
  useEffect(() => {
    if (interaction !== undefined) jumpComments()
  }, [interaction?.rpcId, jumpComments])
  // The collapsed head still says something: the live context occupancy
  // rides the disclosure summary (zero-omission quietness, same as every
  // other summary — no projection, no line).
  const occupancy = contextOccupancy(projections?.contextPressure)
  return (
    <>
      <div className={css.sessionRailFolds} ref={foldsRef}>
        {stateChip !== undefined && updatedAt !== undefined && (
          <div className={css.sessionFacts}>
            <Chip
              kind={stateChip.kind}
              icon={stateChip.spinner === true ? <span className={css.spinner} aria-hidden="true" /> : undefined}
            >
              {stateChip.label}
            </Chip>
            <span className={css.sessionFactTime}>{t('detail.sessionUpdated')} {updatedAt}</span>
          </div>
        )}
        {/* The head (context meter + live run config): ONE Disclosure fold.
            OPENED = rendered FULLY — the body carries no scrollbar of its own
            (a config cut at the model row WITH its own slider is exactly the
            「显示不全」 disease). On a phone the FOLDS BLOCK is the scroller,
            so a fully-rendered config stays reachable without stealing the
            transcript's or the composer's room. */}
        <div className={css.sessionRailHead}>
          <Disclosure
            title={t('review.railHeadTitle')}
            summary={occupancy !== undefined ? `${occupancy.percent}%` : undefined}
            open={headOpen}
            onToggle={() => { setHeadOpen(!headOpen) }}
          >
            <SessionRailHead
              sessionId={sessionId}
              controller={controller}
              projections={projections}
              lines={lines}
              onChanged={onChanged}
              reloadKey={reloadKey}
            />
          </Disclosure>
        </div>
        {/* The comments: ONE Disclosure fold, open at every width. OPENED =
            the thread box with its own capped scroll (the desktop grammar,
            both widths — 滑到最新 drives this box, the follow hook resolves
            the real scroller). A pending interaction FORCE-opens it — the
            InteractionCard carries the answer affordance (in place on legacy
            hosts, navigate-to-answer on 0.1.5), so a collapsed fold can never
            hide it; the summary names that wait too. */}
        <div className={css.sessionRailComments} data-open={commentsOpen || interaction !== undefined}>
          <Disclosure
            title={t('review.comments')}
            summary={interaction !== undefined ? t('review.waiting') : String(thread.length)}
            open={commentsOpen || interaction !== undefined}
            /* While the card forces the fold open, the row is INERT: flipping
               the hidden flag anyway made the tap look dead (aria-expanded
               stayed true) and then silently collapsed the thread the moment
               the question was answered — a state that contradicts what the
               user just saw. */
            onToggle={() => { if (interaction === undefined) setCommentsOpen(!commentsOpen) }}
          >
            <div className={css.commentsScroll} ref={commentsScrollRef} onScroll={onCommentsScroll}>
              <CommentsThread task={task} views={thread} onCancel={onCancelComment} />
              {interaction !== undefined && sessionId !== undefined && (
                <InteractionCard key={interaction.rpcId} question={interaction} sessionId={sessionId} controller={controller} />
              )}
              <JumpToLatest atBottom={commentsAtBottom} onJump={jumpComments} />
            </div>
          </Disclosure>
        </div>
      </div>
      {composer}
    </>
  )
}

/**
 * The pinned composer of the rail — one grammar for every session panel:
 * prompt input (slash autocomplete) + attachment strip + send-mode switch
 * (排队/插话) + the primary send button + ONE quiet line under it.
 *
 * The explanation line belongs to the COMPOSER, not to the comment thread:
 * what 排队/插话 do, and why sending is refused (a finished task, a gone
 * session), is information a touch user must be able to reach — it can never
 * live only in a foldable explanation or a hover-only tooltip. Draft / steer
 * here (the per-session draft slot, shared across panels); the caller
 * supplies only the send semantics:
 *   - onDrive(text, images, files) schedules a session-anchored comment round
 *     (true = saved, the draft clears) — / commands route through the native
 *     registry; attachments ride the round and go out WITH it when the lane
 *     frees (排队 means wait, with or without attachments);
 *   - onSteer(text) delivers the comment straight to the session now;
 *   - onSteerImages(text, images) delivers text + images at once (插话 with a
 *     picture); onSteerFiles(text, images, files) the same with files. The
 *     send mode is the user's toggle — attachments never force steer.
 */

/** Stage one file's bytes on a session via the controller's upload face. */
export function useFileStager(controller: BoardController, sessionId: string | undefined): FileStager | undefined {
  if (sessionId === undefined) return undefined
  const upload = controller.uploadFile(sessionId)
  if (upload === undefined) return undefined
  return async (target: string, file: File) => upload(target, file)
}

export function SessionComposer({ controller, taskId, sessionId, placeholder, disabled, hint, onDrive, onSteer, onSteerImages, onSteerFiles }: {
  controller: BoardController
  taskId: string
  sessionId: string | undefined
  placeholder: string
  /** Extra rejection state (done task / gone session): blocks the send. */
  disabled?: boolean
  /** The composer's own explanation (blocking reason, or the drive hint). */
  hint?: string
  onDrive: (text: string, images: readonly DraftImage[], files: readonly DraftFile[]) => boolean
  onSteer: (text: string) => Promise<boolean>
  onSteerImages: (text: string, images: readonly DraftImage[]) => Promise<boolean>
  /** Steer with staged files (absent = this surface closes the file lane). */
  onSteerFiles?: (text: string, images: readonly DraftImage[], files: readonly DraftFile[]) => Promise<boolean>
}) {
  const storeKey = sessionId === undefined ? undefined : commentDraftKey(taskId, sessionId)
  const [draft, setDraft] = useState<string>(() => (storeKey !== undefined ? draftStore.get(storeKey) ?? '' : ''))
  const [steer, setSteer] = useState(false)
  // The attachment ledger is the SHARED hook: pick / drop-anywhere / paste,
  // image compression + file staging, count caps and every rejection said
  // out loud. The composer container carries the drop/paste props so a
  // desktop user can drop a file or paste a screenshot anywhere on it, not
  // just on the thin strip. The file lane stages on THIS session (receipts
  // are per-Agent); without a session it stays closed (images only).
  const stager = useFileStager(controller, sessionId)
  const attachments = useComposerImages(COMMENT_IMAGE_BUDGET, MAX_COMMENT_IMAGES, undefined,
    stager !== undefined && sessionId !== undefined ? { sessionId, stage: stager } : undefined)
  const { images: attachedImages, files: attachedFiles, setImages, setFiles, addFiles, dropProps } = attachments
  // A failed SEND is distinct from a failed INTAKE; surface it right under
  // the composer (never a silent drop — the user must know their words and
  // attachments did not go out).
  const [sendError, setSendError] = useState<string | undefined>(undefined)
  const clear = (): void => {
    setDraft('')
    setImages([])
    setFiles([])
    setSendError(undefined)
    if (storeKey !== undefined) draftStore.clear(storeKey)
  }
  const submit = (): void => {
    const text = draft.trim()
    if ((text === '' && attachedImages.length === 0 && attachedFiles.length === 0) || disabled === true) return
    // ONE clear grammar for every send mode: the draft leaves the composer at
    // submit, so a repeated click can never double-send (queue cleared right
    // away; steer only after the host answered — a quick second click would
    // have sent the same message twice). A rejection restores the draft so
    // the user keeps their words to retry.
    const restore = (): void => {
      setDraft(text)
      setImages(attachedImages)
      setFiles(attachedFiles)
      if (storeKey !== undefined) draftStore.set(storeKey, text)
    }
    clear()
    // The send mode is the user's toggle — NEVER overridden by the presence of
    // attachments (that was the bug: a queued picture jumped the queue and sent
    // immediately while the session was still running).
    if (steer) {
      const sent = attachedFiles.length > 0 && onSteerFiles !== undefined
        ? onSteerFiles(text, attachedImages, attachedFiles)
        : attachedImages.length > 0 ? onSteerImages(text, attachedImages) : onSteer(text)
      void sent.then(ok => { if (!ok) restore() })
      return
    }
    // 排队: the dispatcher injects this round (text + attachments) when the
    // session's lane is free — it waits behind the running turn, never jumps it.
    if (!onDrive(text, attachedImages, attachedFiles)) restore()
  }
  const busyLabel = attachments.busy
    ? (attachedFiles.length > 0 ? t('review.attachFileBusy') : t('review.attachBusy'))
    : undefined
  return (
    <div className={css.reviewComposer} {...dropProps}>
      <PromptInput
        value={draft}
        onChange={next => {
          setDraft(next)
          if (storeKey !== undefined) draftStore.set(storeKey, next)
        }}
        placeholder={placeholder}
        rows={3}
        controller={controller}
        sessionId={sessionId}
      />
      {/* The attachment strip is its OWN row between the input and the action
          row: chips wrap there and can never grow the action row, so the send
          button stays visible + tappable no matter how many files are
          picked (the "选图后发送按钮被挤没" bug). */}
      <AttachmentStrip
        images={attachedImages}
        files={attachedFiles}
        onAdd={addFiles}
        onRemoveImage={id => { setImages(attachedImages.filter(image => image.id !== id)) }}
        onRemoveFile={id => { setFiles(attachedFiles.filter(file => file.id !== id)) }}
        busy={attachments.busy}
        busyLabel={busyLabel}
        error={attachments.error ?? sendError}
      />
      <div className={css.reviewComposerRow}>
        <SendModeToggle steer={steer} onChange={setSteer} />
        <Button
          variant="primary"
          disabled={(draft.trim() === '' && attachedImages.length === 0 && attachedFiles.length === 0) || disabled === true}
          onClick={submit}
        >
          {t('review.commentSend')}
        </Button>
      </div>
      {/* One quiet line, owned by the composer: what the two send modes do, or
          the reason sending is refused. It lives HERE (not inside any fold)
          because a touch user has no hover to discover the explanation
          with. */}
      <p className={css.detailHint}>{hint ?? t('detail.sessionDriveHint')}</p>
    </div>
  )
}
