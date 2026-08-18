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
import { useCallback, useEffect, useState } from 'react'
import type { BoardController, PendingInteractionKind, SessionModelChoice, SessionModelGroup, TranscriptProjectionsShape } from '../../core/controller.ts'
import { permissionLabel } from '../permission-label.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { contextOccupancy, contextSegments, formatTokens } from './context-meter.ts'
import { sumUsage, type TranscriptLine } from './review-transcript.ts'
import { Notice } from './ui.tsx'

/** Model-select value encoding: provider + model, joined by a NUL separator. */
const MODEL_SEP = '\u0000'

/** The session's real workspace root → short display label (last path
 *  segment). Shared by every session panel. */
export function workspaceLabelOf(cwd: string): string {
  const segment = cwd.split(/[\\/]+/).filter(Boolean).pop()
  return segment !== undefined && segment !== '' ? segment : cwd
}

/** One waiting banner, shared by every session surface. */
export function SessionWaitingNotice({ waiting }: { waiting: PendingInteractionKind | undefined }) {
  if (waiting === undefined) return null
  return (
    <Notice chip={t('review.waiting')}>
      {t('review.waitingTitle', { kind: t(`waiting.${waiting}` as 'waiting.approval') })}
    </Notice>
  )
}

/** The session facts block: its real workspace + composed Agent (read-only). */
export function SessionFacts({ info }: { info: { cwd?: string; agentPreset?: string } | undefined }) {
  if (info === undefined) return null
  return (
    <div className={css.reviewSessionFacts}>
      <span className={css.reviewSessionFact}>
        <span className={css.reviewSessionFactLabel}>{t('review.sessionWorkspace')}</span>
        <span
          className={css.reviewSessionFactValue}
          title={info.cwd ?? undefined}
        >
          {info.cwd !== undefined ? workspaceLabelOf(info.cwd) : t('review.sessionUnknown')}
        </span>
      </span>
      <span className={css.reviewSessionFact}>
        <span className={css.reviewSessionFactLabel}>{t('review.sessionAgent')}</span>
        <span className={css.reviewSessionFactValue}>
          {info.agentPreset !== undefined ? info.agentPreset : t('review.sessionDefaultAgent')}
        </span>
      </span>
    </div>
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
 * bar (from the transcript projections), or the token-sum fallback strip
 * when no projection is served. A high-occupancy state (>= 85%) shifts the
 * reading to the attention tone — the same warn grammar as every board
 * signal.
 */
export function ContextMeterPanel({ projections, usage }: {
  projections: TranscriptProjectionsShape | undefined
  usage: SessionUsage | undefined
}) {
  const occupancy = contextOccupancy(projections?.contextPressure)
  const segments = occupancy !== undefined
    ? contextSegments(occupancy, projections?.contextBreakdown)
    : undefined
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
    )
  }
  if (usage !== undefined) {
    return (
      <p className={css.reviewUsage}>
        {t('review.usage')}：
        {t('review.usageInput', { n: String(usage.inputTokens) })} · {t('review.usageOutput', { n: String(usage.outputTokens) })}
        {usage.cacheReadTokens !== undefined && ` · ${t('review.usageCacheRead', { n: String(usage.cacheReadTokens) })}`}
        {usage.cacheWriteTokens !== undefined && ` · ${t('review.usageCacheWrite', { n: String(usage.cacheWriteTokens) })}`}
        {usage.reasoningTokens !== undefined && ` · ${t('review.usageReasoning', { n: String(usage.reasoningTokens) })}`}
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
  const [configUnavailable, setConfigUnavailable] = useState(false)
  const [configBusy, setConfigBusy] = useState(false)
  const [configMessage, setConfigMessage] = useState<string | undefined>(undefined)
  const [permissionRows, setPermissionRows] = useState<readonly { id: string; name?: string; description?: string }[] | undefined>(undefined)

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
      if (result === undefined) setConfigUnavailable(true)
      else {
        setConfigUnavailable(false)
        setSessionModels(result)
      }
    })
  }, [sessionConfig, sessionId])

  // Load on open + whenever the caller forces a re-read.
  useEffect(() => { reloadPanel() }, [reloadPanel, reloadKey])

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
      setConfigBusy(false)
      setConfigMessage(result.ok ? t('review.configApplied') : result.error)
      // The session's real permission changed through the native command;
      // refresh so the projection-backed select shows the new value.
      if (result.ok) {
        reloadPanel()
        onChanged?.()
      }
    })
  }

  if (sessionConfig === undefined) return null

  const options = permissionOptions ?? permissionRows
  const value = permissionValue ?? ''

  return (
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
          {options !== undefined && (
            <span className={css.reviewConfigRow}>
              <span className={css.reviewConfigLabel}>{t('review.permission')}</span>
              <span className={css.selectWrap}>
                <select
                  className={css.input}
                  value={value}
                  disabled={configBusy}
                  onChange={event => { applyPermission(event.target.value) }}
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
      <SessionFacts info={controller.sessionInfo(sessionId)} />
      <span className={css.reviewConfigHint}>{t('review.sessionHint')}</span>
    </section>
  )
}

/**
 * The shared rail head: context meter + live config editor + session facts,
 * composed in the order every session panel shows them. Callers wrap it in
 * their rail layout (the fixed `.reviewRailHead` block) and pass what they
 * read from their transcript hook (projections via onResult, folded lines).
 */
export function SessionRailHead({ sessionId, controller, projections, lines, onChanged, reloadKey, permissionValue, permissionOptions }: {
  sessionId: string | undefined
  controller: BoardController
  projections: TranscriptProjectionsShape | undefined
  /** The folded transcript lines (token-accounting fallback for the meter). */
  lines: readonly TranscriptLine[] | undefined
  onChanged?: () => void
  reloadKey?: unknown
  permissionValue?: string
  permissionOptions?: readonly { id: string; name?: string; description?: string }[]
}) {
  // Without a session there is nothing to show (the caller keeps its rail
  // empty, exactly like the pre-refactor gating on sessionId).
  if (sessionId === undefined) return null
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
