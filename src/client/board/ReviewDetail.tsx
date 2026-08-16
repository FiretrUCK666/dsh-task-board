/**
 * Review page: one execution's review surface. Opened by clicking an
 * execution-history row, it shows the session's recent conversation
 * (the transcript tail, folded from raw history events following the
 * native harness rules) plus a live session panel — the execution
 * session's current model/reasoning effort (native models API), its
 * permission (native /permission path) and the token usage summed from
 * the transcript. The conversation scrolls in its own region; the comment
 * thread and composer stay fixed at the bottom, so sending a comment never
 * requires scrolling through a long conversation. Transcript and session
 * data refresh while the panel is open (10s cadence + manual refresh), so
 * continuing the conversation in the native session page shows up here.
 * The native session page remains the place for the full transcript
 * ("查看会话"); this page never duplicates the full conversation view.
 */
import { useCallback, useEffect, useState } from 'react'
import type { BoardController, SessionConfigFace, SessionModelChoice, SessionModelGroup } from '../../core/controller.ts'
import type { ExecutionRecord, TaskRecord } from '../../core/tasks.ts'
import { permissionLabel } from '../permission-label.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { PromptInput } from './PromptInput.tsx'
import { formatDateTime } from './TaskCard.tsx'
import { foldTranscript, sumUsage, type TranscriptLine } from './review-transcript.ts'

/** Model-select value encoding: provider + model, joined by a NUL separator. */
const MODEL_SEP = '\u0000'

/** One comment round rendered in the thread, with its live state. */
interface CommentView {
  round: ExecutionRecord
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
}

/** Build the comment thread of a task for one session, oldest first. */
function commentsOf(task: TaskRecord, sessionId: string | undefined): CommentView[] {
  if (sessionId === undefined) return []
  return task.executions
    .filter(round => round.comment !== undefined && round.sessionId === sessionId)
    .map(round => ({
      round,
      state: round.endedAt !== undefined
        ? (round.result ?? 'cancelled')
        : task.status === 'running' ? 'running' : 'pending',
    }))
}

/** Comment-round state → chip color + label key. */
function commentStateOf(state: CommentView['state']): { kind: 'success' | 'error' | 'warn' | 'muted'; label: string } {
  switch (state) {
    case 'succeeded': return { kind: 'success', label: t('review.commentSucceeded') }
    case 'failed': return { kind: 'error', label: t('review.commentFailed') }
    case 'running': return { kind: 'warn', label: t('review.commentRunning') }
    case 'cancelled': return { kind: 'muted', label: t('review.commentCancelled') }
    case 'pending': return { kind: 'muted', label: t('review.commentPending') }
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
  const comments = commentsOf(current, sessionId)
  const sessionConfig = controller.sessionConfig()

  const [lines, setLines] = useState<readonly TranscriptLine[] | undefined>(undefined)
  const [transcriptError, setTranscriptError] = useState(false)
  // Live session panel: current selection + selectable directory.
  const [sessionModels, setSessionModels] = useState<{ current: SessionModelChoice; groups: readonly SessionModelGroup[] } | undefined>(undefined)
  const [configUnavailable, setConfigUnavailable] = useState(false)
  const [configBusy, setConfigBusy] = useState(false)
  const [configMessage, setConfigMessage] = useState<string | undefined>(undefined)
  const [permissionRows, setPermissionRows] = useState<readonly { id: string; name?: string; description?: string }[] | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [lastCommentId, setLastCommentId] = useState<string | undefined>(undefined)

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

  /** Reload transcript + session panel from the live native sources. */
  const reload = useCallback((): void => {
    if (sessionId === undefined) return
    void controller.loadTranscript(sessionId).then(events => {
      if (events === undefined) setTranscriptError(true)
      else {
        setTranscriptError(false)
        setLines(foldTranscript(events))
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

  // Load on open + whenever the task's run history changes (a comment
  // injected or settled), and refresh on a light cadence while the panel is
  // open so edits made in the native session page show up here.
  useEffect(() => { reload() }, [reload, current.executions.length, current.status])
  useEffect(() => {
    const timer = setInterval(reload, 10_000)
    return () => { clearInterval(timer) }
  }, [reload])

  const submit = (): void => {
    const text = draft.trim()
    if (text === '') return
    const round = controller.submitComment(current.id, execution.id, text)
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
          {/* The conversation region: its own scrollbar — a long transcript
              never pushes the comment thread out of view. */}
          <div className={css.reviewTranscriptScroll}>
            <div className={css.reviewOutcome}>
              <Chip kind={execution.result === 'failed' ? 'error' : execution.result === 'succeeded' ? 'success' : 'muted'}>
                {execution.result === undefined ? t('detail.result.running') : t(`detail.result.${execution.result}` as 'detail.result.succeeded')}
              </Chip>
              <span className={css.reviewOutcomeMeta}>
                {t('detail.executionEnded')} {execution.endedAt !== undefined ? formatDateTime(execution.endedAt) : '—'}
              </span>
            </div>

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
                  <li key={line.id} className={css.reviewContext} title={line.summary}>
                    {t('review.contextInjection')} · {line.plugin}
                  </li>
                ) : (
                  <li key={line.id} className={css.reviewMessage} data-role={line.role}>
                    <span className={css.reviewMessageText}>{line.text}</span>
                  </li>
                ))}
              </ul>
            )}

            {usage !== undefined && (
              <p className={css.reviewUsage}>
                {t('review.usage')}：
                {t('review.usageInput', { n: String(usage.inputTokens) })} · {t('review.usageOutput', { n: String(usage.outputTokens) })}
                {usage.cacheReadTokens !== undefined && ` · ${t('review.usageCacheRead', { n: String(usage.cacheReadTokens) })}`}
                {usage.cacheWriteTokens !== undefined && ` · ${t('review.usageCacheWrite', { n: String(usage.cacheWriteTokens) })}`}
                {usage.reasoningTokens !== undefined && ` · ${t('review.usageReasoning', { n: String(usage.reasoningTokens) })}`}
              </p>
            )}
          </div>

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
              <span className={css.reviewConfigHint}>{t('review.configHint')}</span>
            </section>
          )}

          {/* The comment thread: a clearly separated zone, fixed at the
              bottom — comments are human interventions, distinct from the
              conversation above. Pending comments (cruise off) can be
              cancelled; injected ones show their live state. */}
          <section className={`${css.reviewSection} ${css.reviewThread}`}>
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
                    const state = commentStateOf(view.state)
                    return (
                      <li key={view.round.id} className={css.reviewComment}>
                        <span className={css.reviewCommentText}>{view.round.comment}</span>
                        <span className={css.reviewCommentMeta}>
                          <Chip kind={state.kind}>{state.label}</Chip>
                          <span className={css.reviewCommentTime}>{formatDateTime(view.round.startedAt)}</span>
                          {view.state === 'pending' && (
                            <button
                              type="button"
                              className={css.reviewCommentCancel}
                              onClick={() => { controller.cancelComment(view.round.id) }}
                            >
                              {t('review.commentCancel')}
                            </button>
                          )}
                        </span>
                        {view.state === 'failed' && view.round.error !== undefined && view.round.error !== '' && (
                          <span className={css.executionError}>{view.round.error}</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* The composer: a comment continues the conversation in-session.
                It shares the prompt autocomplete with the task form — the
                same live slash catalog, so commands and skills never drift. */}
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
                    {current.status === 'running' ? t('review.commentInjected') : t('review.commentPendingHint')}
                  </span>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
