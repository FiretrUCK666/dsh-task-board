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
import { Markdown } from './Markdown.tsx'
import { sumUsage, type TranscriptLine } from './review-transcript.ts'
import { JumpToLatest, NEAR_BOTTOM_PX, useResizeFollow } from './use-transcript.tsx'
import { Chip, type ChipKind } from './Chip.tsx'
import { CommentsThread } from './CommentsThread.tsx'
import type { CommentView } from './comment-thread.ts'
import { SessionContextBlock } from './SessionContextBlock.tsx'
import type { SessionContext } from './use-interaction.ts'
import { InteractionCard } from './InteractionCard.tsx'
import { AttachmentStrip } from './AttachmentStrip.tsx'
import { admitDraftImages, type DraftImage, type HostImageRefView } from './attach.ts'
import { commentDraftKey, draftStore } from './drafts.ts'
import { PromptInput } from './PromptInput.tsx'
import { Button, Notice, SendModeToggle } from './ui.tsx'

/** Model-select value encoding: provider + model, joined by a NUL separator. */
const MODEL_SEP = '\u0000'

/** The session's real workspace root → short display label (last path
 *  segment). Shared by every session panel. */
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
      <div className={css.reviewMessageText}>
        <Markdown text={props.text} />
      </div>
    </li>
  )
})

/**
 * The shared transcript-region content: optional header (the review page's
 * outcome banner), the waiting banner, error/loading/empty states, the
 * folded message list (optionally capped to the trailing N) and the
 * "滑到最新" pill. Callers own their scroll region and the tail hook; this
 * is pure rendering, so every live session surface looks and behaves
 * identically.
 */
export function SessionTranscript({ lines, error, atBottom, jumpToBottom, waiting, maxLines, before }: {
  lines: readonly TranscriptLine[] | undefined
  error: boolean
  atBottom: boolean
  jumpToBottom: () => void
  waiting?: PendingInteractionKind
  /** Render only the trailing N lines (the refinement panel's cap). */
  maxLines?: number
  /** Optional header content inside the region (the review page's outcome banner). */
  before?: ReactNode
}) {
  const shown = lines === undefined ? undefined : maxLines === undefined ? lines : lines.slice(-maxLines)
  return (
    <>
      {before}
      <SessionWaitingNotice waiting={waiting} />
      {error ? (
        <p className={css.detailText}>{t('review.transcriptUnavailable')}</p>
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
      <SessionFacts info={controller.sessionInfo(sessionId)} />
      <span className={css.reviewConfigHint}>{t('review.sessionHint')}</span>
    </section>
  )
}

/**
 * The shared rail head: context meter + live config editor + session facts,
 * composed in the order every session panel shows them. Callers wrap it in
 * their rail layout (the fixed `.sessionRailHead` block) and pass what they
 * read from their transcript hook (projections via onResult, folded lines).
 * The permission switcher's projection mapping is derived HERE — one source
 * for every panel (a caller-level mapping is how the linked panel lost it).
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
 * execution review page and the linked-session panel share it verbatim):
 * session context block → live state row (chip + updated time; absent hides
 * the row) → the fixed rail head (context meter + live config + session
 * facts, own padding/separation) → fixed thread header → one quiet hint line
 * → the comment thread in its OWN scroll region (auto-follow + 滑到最新) →
 * the pending interaction card → the caller's pinned composer. Callers pass
 * data and their send semantics; the grammar, the follow mechanics and the
 * hint line live here exactly once — no panel can drift again.
 */
export function SessionRail({ context, contextOpen, onToggleContext, stateChip, updatedAt, sessionId, controller, projections, lines, onChanged, reloadKey, hint, task, thread, onCancelComment, interaction, composer }: {
  context: SessionContext
  contextOpen: boolean
  onToggleContext: () => void
  /** The live state row (chip + updated time); absent hides the whole row. */
  stateChip?: { kind: ChipKind; label: string; spinner?: boolean }
  updatedAt?: string
  sessionId: string | undefined
  controller: BoardController
  projections: TranscriptProjectionsShape | undefined
  lines: readonly TranscriptLine[] | undefined
  onChanged?: () => void
  reloadKey?: unknown
  /** The quiet line under the thread header: a blocking reason, or the drive
   *  explanation (the default when absent). */
  hint?: string
  task: TaskRecord
  thread: readonly CommentView[]
  onCancelComment: (roundId: string) => boolean
  /** The pending native question (plan confirm / ask); absent hides the card. */
  interaction: WireQuestion | undefined
  /** The pinned composer (the panel's send semantics stay in the caller). */
  composer: ReactNode
}) {
  // The comment thread auto-follows its latest round (fingerprint-gated) and
  // scrolls in its OWN region: the rail head and the thread header stay
  // fixed, the list scrolls, and 滑到最新 jumps to the newest comment. One
  // mechanism for every panel — the region's size also depends on the async
  // rail head, so a resize follower re-pins while at the bottom.
  const threadScrollRef = useRef<HTMLDivElement | null>(null)
  const [threadAtBottom, setThreadAtBottom] = useState(true)
  const threadAtBottomRef = useRef(true)
  useEffect(() => { threadAtBottomRef.current = threadAtBottom })
  useResizeFollow(threadScrollRef, threadAtBottomRef)
  const threadFingerprint = thread.map(view => `${view.round.id}:${view.state}`).join('|')
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
  return (
    <>
      <SessionContextBlock context={context} open={contextOpen} onToggle={onToggleContext} />
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
      <div className={css.sessionRailHead}>
        <SessionRailHead
          sessionId={sessionId}
          controller={controller}
          projections={projections}
          lines={lines}
          onChanged={onChanged}
          reloadKey={reloadKey}
        />
      </div>
      <div className={css.reviewThreadHeader}>
        <h4 className={css.reviewThreadTitle}>
          {t('review.comments')}
          <span className={css.reviewThreadCount}>{thread.length}</span>
        </h4>
      </div>
      {/* One quiet line: the drive explanation in the normal case, the
          blocking reason (done task / gone session) in the exceptional
          case — never a stack of texts, never inside the send row. */}
      <p className={css.detailHint}>{hint ?? t('detail.sessionDriveHint')}</p>
      <div className={css.sessionRailScroll} ref={threadScrollRef} onScroll={onThreadScroll}>
        <CommentsThread task={task} views={thread} onCancel={onCancelComment} />
        <JumpToLatest atBottom={threadAtBottom} onJump={jumpThread} />
      </div>
      {interaction !== undefined && sessionId !== undefined && (
        <InteractionCard key={interaction.rpcId} question={interaction} sessionId={sessionId} controller={controller} />
      )}
      {composer}
    </>
  )
}

/**
 * The pinned composer of the rail — one grammar for every session panel:
 * prompt input (slash autocomplete) + attachment strip + send-mode switch
 * (排队/插话) + the primary send button. Draft / steer mode / attached
 * images live here (the per-session draft slot, shared across panels); the
 * caller supplies only the send semantics:
 *   - onDrive(text) schedules a session-anchored comment round (true = saved,
 *     the draft clears) — / commands route through the native registry;
 *   - onSteer(text) delivers the comment straight to the session now;
 *   - onSteerImages(text, refs) delivers text + admitted image refs at once
 *     (images always go immediately — they belong to the current exchange).
 */
export function SessionComposer({ controller, taskId, sessionId, placeholder, disabled, onDrive, onSteer, onSteerImages }: {
  controller: BoardController
  taskId: string
  sessionId: string | undefined
  placeholder: string
  /** Extra rejection state (done task / gone session): blocks the send. */
  disabled?: boolean
  onDrive: (text: string) => boolean
  onSteer: (text: string) => Promise<boolean>
  onSteerImages: (text: string, refs: readonly HostImageRefView[]) => Promise<boolean>
}) {
  const storeKey = sessionId === undefined ? undefined : commentDraftKey(taskId, sessionId)
  const [draft, setDraft] = useState<string>(() => (storeKey !== undefined ? draftStore.get(storeKey) ?? '' : ''))
  const [steer, setSteer] = useState(false)
  const [attachedImages, setAttachedImages] = useState<readonly DraftImage[]>([])
  const mentions = controller.sessionLabelsOf(taskId).map(({ sessionId, title }) => ({ id: sessionId, title }))
  const clear = (): void => {
    setDraft('')
    setAttachedImages([])
    if (storeKey !== undefined) draftStore.clear(storeKey)
  }
  const submit = (): void => {
    const text = draft.trim()
    if ((text === '' && attachedImages.length === 0) || disabled === true) return
    if (attachedImages.length > 0) {
      // Images go out immediately through the steer path — a picture belongs
      // to the current exchange, not a queue.
      void admitDraftImages(attachedImages).then(refs => {
        if (refs.length === 0) return
        void onSteerImages(text, refs).then(ok => { if (ok) clear() })
      })
      return
    }
    // Send mode: 排队 = the dispatcher injects a session-anchored message
    // round (same queue as every comment); 插话 = deliver straight to the
    // native session now, bypassing queue/budget/cruise. One message, two
    // send modes, one grammar everywhere.
    if (steer) {
      void onSteer(text).then(ok => { if (ok) clear() })
      return
    }
    if (onDrive(text)) clear()
  }
  return (
    <div className={css.reviewComposer}>
      <PromptInput
        value={draft}
        onChange={next => {
          setDraft(next)
          if (storeKey !== undefined) draftStore.set(storeKey, next)
        }}
        placeholder={placeholder}
        rows={3}
        controller={controller}
        mentions={mentions}
      />
      <div className={css.reviewComposerRow}>
        <AttachmentStrip images={attachedImages} onChange={setAttachedImages} />
        <SendModeToggle steer={steer} onChange={setSteer} />
        <Button
          variant="primary"
          disabled={(draft.trim() === '' && attachedImages.length === 0) || disabled === true}
          onClick={submit}
        >
          {t('review.commentSend')}
        </Button>
      </div>
    </div>
  )
}
