/**
 * Task card: the board's column item. Clicking opens the task detail — it
 * never executes anything directly (detail holds the Run button). Cards are
 * draggable onto other columns; the drop semantics are decided by the board
 * through resolveCardDrop.
 */
import { useState, type CSSProperties } from 'react'
import type { PendingInteractionKind } from '../../core/controller.ts'
import type { TaskLiveState } from '../../core/task-live.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { cardSourceLabel, latestExecutionOf, plainRunsOf, refining, ruleReadiness, taskBindsOf } from '../../core/tasks.ts'
import { sessionRuleReadiness } from '../../core/automation.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { scheduleSummary } from './automation-ui.tsx'
import { cardViewModelOf, titleOrUntitled, type CardSessionDot } from './card-view.ts'
import { Chip } from './Chip.tsx'
import { resultChipKind, waitingKeyOf } from './session-chip.ts'
import { STATUS_KEY } from './status.ts'
import { ColorSwatches, Icon } from './ui.tsx'
import { formatDateTime, formatTime } from './format-time.ts'

/** Tooltip for the schedule chip: THE one summary grammar (shared with the
 *  detail's disclosure and the overview) — honest about the rule's readiness:
 *  chain reports its run budget, cron its next due instant, paused its
 *  blocking status, blocked its cause (plus the failure word when the last
 *  run failed — two orthogonal causes, both named). */
function scheduleChipTitle(task: TaskRecord): string {
  return scheduleSummary(task)
}

/** The open run's state text: either working ("进行中") or blocked on the
 *  user ("等待回应 · 计划确认"). Pure so the chip composition is testable. */
export function runningStateLabel(waiting: PendingInteractionKind | undefined): string {
  return waiting !== undefined
    ? `${t('card.waiting')} · ${t(waitingKeyOf(waiting))}`
    : t('detail.result.running')
}

/** The settled-run count label: "N 次执行" / "N runs". */
export function settledChipLabel(runs: number): string {
  return `${runs} ${t('board.runs')}`
}

/** Whether the card shows the blocked-automation chip: an armed rule that
 *  cannot drive anything (empty prompt — a reason, not a pause). Pure so the
 *  badge composition is testable; the title reuses the schedule summary
 *  grammar, which already names the blocking reason. */
export function showsBlockedChip(task: TaskRecord): boolean {
  return task.schedule?.enabled === true && ruleReadiness(task).kind === 'blocked'
}

/** Whether any ENABLED session rule is blocked on the empty prompt (the
 *  session-rule twin of {@link showsBlockedChip}): a custom-instruction rule
 *  carries its own content and never reads the prompt, so only `usePrompt`
 *  rules count — read through the rule's own readiness, never re-derived. */
export function showsSessionBlocked(task: TaskRecord): boolean {
  if (task.rules === undefined) return false
  return task.rules.some(rule => sessionRuleReadiness(task, rule).kind === 'blocked')
}

/** Whether the automation slot collapses to the single blocked chip: any
 *  blocked automation (task schedule or session rule) owns the slot — the
 *  schedule/chain/progress text yields instead of stacking four chips for
 *  one cause. THE priority table for the card's automation badges. */
export function blockedAutomation(task: TaskRecord): boolean {
  return showsBlockedChip(task) || showsSessionBlocked(task)
}

/** One card in a column — a PURE state summary: title, description, source
 *  line (workspace / bound session), the updated stamp, and the status chips
 *  (what the task IS doing: running / waiting / scheduled / chaining / failed
 *  paused / queued / refining / new). The run window (start/end/duration) and
 *  the comment timeline live in the detail — cards never carry content that
 *  belongs to the conversation pages. */
export function TaskCard({ task, selected, workspaceTitleOf, boundTitleOf, waiting, pendingCount, pendingTitle, unviewed, unviewedCount, hasUnviewedRun, awaitingDecision, onMoveStep, onClick, onQuickRun, onColorPick, live, dots, overflowDots, nextAction, dotTitleOf }: {
  task: TaskRecord
  /** Whether the card is picked in multi-select (Ctrl/Cmd+click or organize mode). */
  selected?: boolean
  /** Resolve a workspace id to its display title (raw id when unknown). */
  workspaceTitleOf: (workspaceId: string) => string
  /** Resolve a bound session's display title (session-bound tasks show their
   *  session identity, not the default workspace label). */
  boundTitleOf?: (task: TaskRecord) => string
  /** The open run's session is blocked on the user (approval / plan review / question). */
  waiting?: PendingInteractionKind
  /** How many sessions of this task are waiting on the user (executions + refine). */
  pendingCount: number
  /** Tooltip detail listing which execution/session waits on what. */
  pendingTitle: string
  /** Whether the task has content (settled run / comment / refine) newer than its last open. */
  unviewed: boolean
  /** How many plain-run executions are unviewed (the "新 N" badge figure). */
  unviewedCount: number
  /** Whether at least one of those unviewed items is a plain RUN (as opposed to
   *  comment-only activity). The card states a count only when a run is behind
   *  it, so "新 2" can never mean "two comments". Computed by the caller from the
   *  same source as `unviewedCount`, so the two can never disagree. */
  hasUnviewedRun?: boolean
  /** A review task whose run has settled and no human has passed or sent it
   *  back: the plateau the board used to hide. Unlike `unviewed` it does not
   *  clear when the card is opened — reading is not deciding. */
  awaitingDecision?: boolean
  onClick: (event: React.MouseEvent) => void
  /** Optional hover quick-action: run the task right from the card (rerun
   *  semantics, same run guard; disabled while a run is open). */
  onQuickRun?: () => void
  /** Keyboard column step: -1 = one column left, +1 = one column right, along
   *  the board's own COLUMNS order. The caller resolves it through the same
   *  `resolveCardDrop` a drag uses, so the keyboard cannot reach a move the
   *  pointer would refuse. Absent = no keyboard moves (read-only surfaces). */
  onMoveStep?: (direction: -1 | 1) => void
  /** Optional hover quick-action: pick a card color right from the card. */
  onColorPick?: (color: string | undefined) => void
  /** THE live-state derivation (taskLiveStateOf, controller.liveStateOf):
   *  'running' = a related session is genuinely working (board run, direct
   *  steer, session rule, out-of-band chat). Absent = falls back to the
   *  status-based judgment (card used without a controller). */
  live?: TaskLiveState
  /** Related-session dots (max 3 rendered, overflow counted separately). */
  dots?: readonly CardSessionDot[]
  /** Overflow session count beyond `dots` (+N). */
  overflowDots?: number
  /** One quiet next-action sentence (localized by the caller). */
  nextAction?: string
  /** Tooltip for a session dot (session title + state). */
  dotTitleOf?: (sessionId: string) => string
}) {
  const [dragging, setDragging] = useState(false)
  const latest = latestExecutionOf(task)
  // Single derivation for the card's live summary (see card-view.ts) — the
  // chips below still read the same fields so the view-model never drifts
  // from the render.
  const view = cardViewModelOf(task, {
    live,
    pendingCount,
    ...(waiting !== undefined ? { waiting } : {}),
    unviewedCount,
  })
  // Plain-run count (comment continuation rounds are not executions): the
  // single numbering source shared with the detail list and review badge.
  const runs = plainRunsOf(task)
  const lastPlain = runs[runs.length - 1]
  // Only a genuinely open round shows the in-progress indicator, and "open"
  // is the shared judgment: ANY of this card's sessions in flight (a card can
  // run several at once), never "the last row is unsettled". A pending comment
  // round (task sitting in review) must never spin.
  const running = view.running
  // Display truth splits from the gate above: a lone refinement round keeps
  // the card in its backlog column doing preparation — the chip must read
  // 完善中 (its own badge below), never 进行中. Quick-run blocking, budget
  // and drop rules stay on `running`.
  const showingRunning = view.showingRunning
  // Comments saved but not yet injected (the task's queue): a quiet warn
  // badge so a card waiting for the dispatcher is never mistaken for idle.
  const queuedComments = view.queued
  // A live chain run: the "接续中" chip names the automation mode BEHIND the running
  // state, and it survives a blocked rule — a live run and a blocked rule are
  // orthogonal causes, so hiding progress would lie about what is actually moving.
  const chaining = task.schedule?.enabled === true
    && task.schedule.mode === 'chain'
    && task.status === 'running'
  // The card's source line — one derivation for every card (see
  // cardSourceLabel): the bound session's title when it differs from the
  // task title, else the workspace label. Empty = no source line.
  const sourceLabel = cardSourceLabel(
    task,
    taskBindsOf(task).some(bind => bind.kind === 'session') ? boundTitleOf?.(task) ?? '' : '',
    task.workspaceId !== undefined ? workspaceTitleOf(task.workspaceId) : '',
  )
  // Automation paused because the latest plain run failed (the "failure
  // pauses the rule" signal), vs. a review pause for a successful run.
  const readiness = ruleReadiness(task)
  const pausedFailed = readiness.kind === 'paused' && readiness.status === 'review'
    && lastPlain !== undefined && lastPlain.result === 'failed'
  // Breathing is owned by the view-model (same priority as the primary chip):
  // the component never re-derives it, so the light can never drift from the
  // text it accompanies.
  const active = view.active
  return (
    /* A card is a clickable REGION, never a <button>: the color swatches and
       the quick-run control inside are real interactive elements, and a
       button inside a button is invalid HTML with a broken keyboard/screen
       reader model. The region handles Enter/Space itself (same activation
       as a click); the inner controls stop propagation. */
    <div
      role="button"
      tabIndex={0}
      className={`${css.card}${dragging ? ` ${css.dragging}` : ''}${selected ? ` ${css.selectedCard}` : ''}`}
      style={task.color !== undefined ? ({ '--card-tint': task.color } as CSSProperties) : undefined}
      data-status={task.status}
      data-task-id={task.id}
      data-unviewed={unviewed ? '' : undefined}
      data-active={active ? '' : undefined}
      draggable
      onClick={onClick}
      onKeyDown={event => {
        // Keyboard parity for the one interaction that used to be mouse-only.
        // `[` / `]` step the card one column along the SAME COLUMNS order the
        // board renders, and the caller runs them through `resolveCardDrop` — so
        // a key move can never take a path a drag could not refuse. Modifier
        // combinations are left alone: Ctrl+[ and friends belong to the browser.
        if (onMoveStep !== undefined && (event.key === '[' || event.key === ']')) {
          if (event.ctrlKey || event.metaKey || event.altKey) return
          event.preventDefault()
          onMoveStep(event.key === ']' ? 1 : -1)
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick(event as unknown as React.MouseEvent)
        }
      }}
      title={task.description !== '' ? task.description : task.title}
      /* The accessible name carries the keyboard grammar, which is how a shortcut
         becomes discoverable at all: a screen-reader or keyboard user hears the
         card, its column, and the keys that move it, without opening anything. */
      aria-label={onMoveStep === undefined
        ? undefined
        : t('card.keyboardLabel', {
          title: titleOrUntitled(task.title, t('card.untitled')),
          column: t(STATUS_KEY[task.status]),
        })}
      onDragStart={event => {
        setDragging(true)
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
        // Self-drawn ghost: a CLONE of the card with every hover decoration
        // (color bar / quick-run / attention ring) stripped — the native
        // snap of the live element would freeze the hover palette and the
        // play pill inside the drag image (the "ghost contains color dots"
        // symptom). The clone is detached and removed after the snapshot;
        // the pointer stays the anchor.
        const source = event.currentTarget
        const clone = source.cloneNode(true) as HTMLElement
        clone.style.position = 'fixed'
        clone.style.left = '-9999px'
        clone.style.top = '0'
        clone.style.width = `${source.offsetWidth}px`
        for (const hidden of clone.querySelectorAll('[data-ghost-hide]')) {
          (hidden as HTMLElement).style.display = 'none'
        }
        document.body.appendChild(clone)
        event.dataTransfer.setDragImage(clone, source.offsetWidth / 2, source.offsetHeight / 2)
        window.setTimeout(() => { clone.remove() }, 0)
      }}
      onDragEnd={() => { setDragging(false) }}
    >
      {onQuickRun !== undefined && (
        <span
          className={css.cardQuickRun}
          data-ghost-hide=""
          role="button"
          tabIndex={running ? -1 : 0}
          title={t('card.quickRun')}
          aria-disabled={running ? true : undefined}
          onClick={event => {
            if (running) return
            event.stopPropagation()
            onQuickRun()
          }}
          onKeyDown={event => {
            if (running) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              onQuickRun()
            }
          }}
        >
          <Icon name="play" />
        </span>
      )}
      {selected === true && (
        <span className={css.cardSelectedBadge} data-ghost-hide="" aria-hidden="true">
          <Icon name="check" />
        </span>
      )}
      <span className={css.cardTitleRow}>
        {/* The card's真实 color: a solid dot in the EXACT picked color (the
            palette swatch is 100% of the data color; a blended card tint can
            never show it exactly). The dot carries the identity, the 6% tint
            below is pure atmosphere. */}
        {task.color !== undefined && (
          <span className={css.cardColorMark} style={{ background: task.color }} aria-hidden="true" />
        )}
        <span className={css.cardTitle}>
          {titleOrUntitled(task.title, t('card.untitled'))}
        </span>
      </span>
      {task.description !== '' && <span className={css.cardExcerpt}>{task.description}</span>}
      {/* The next-action line sits directly under the content, BEFORE the meta
          block. It is the card's verb — "what do I do about this" — and it used to
          be the last child: smallest type, last in reading order, and the first
          thing to be truncated (it was `nowrap` with an ellipsis, and every one of
          its sentences is long enough to truncate on a narrow card). Position,
          size and truncation all told the same wrong story about the least
          decorative line on the card. */}
      {nextAction !== undefined && nextAction !== '' && (
        <span className={css.cardNext}>{nextAction}</span>
      )}
      <span className={css.cardMeta}>
        {/* Row 1 is identical on every card: source line (when there IS one
            — a source named like the task is never repeated) + last activity. */}
        <span className={css.cardMetaRow}>
          {sourceLabel !== '' && (
            <span
              className={css.cardWorkspace}
              title={sourceLabel}
            >
              <span className={css.cardWorkspaceDot} aria-hidden="true" />
              <span className={css.cardWorkspaceName}>{sourceLabel}</span>
            </span>
          )}
          <span className={css.cardTime} title={formatDateTime(task.updatedAt)}>
            {t('board.updated')} {formatTime(task.updatedAt)}
          </span>
        </span>
        {/* Row 2: the card's chips. Two rules govern this row, and both used to be
            broken.

            (1) The PRIMARY chip comes first. `cardViewModelOf` computes a priority
            (waiting > running > refining > queued > failed > review > idle) and the
            render used to put that winner LAST, behind every automation badge — so
            the row's reading order contradicted the view model's own ranking, on the
            surface whose whole job is a five-second scan.

            (2) The row must render whenever there is ANYTHING to say. Its gate used
            to be `schedule?.enabled === true || latest !== undefined`, which is false
            for a card that has never run and has no schedule — and that is exactly
            the shape of "somebody just made this card and the agent is asking a
            question". The view model reported `primary: waiting` while the gate hid
            the entire row, so the one signal that asks the user to act was
            unrenderable precisely when it mattered. Each chip below already carries
            its own condition, so the row needs no gate of its own. */}
        {(() => {
          const primaryChip = showingRunning ? (
            <Chip kind="warn" fill={false} title={waiting !== undefined
              ? t('card.waitingTitle', { kind: t(waitingKeyOf(waiting)) })
              : undefined}
              icon={<span className={css.spinner} aria-hidden="true" />}>
              {runningStateLabel(waiting)}
            </Chip>
          ) : pendingCount > 0 ? (
            <Chip kind="warn" fill={false} title={pendingTitle}>
              {t('card.pending')} {pendingCount}
            </Chip>
          ) : awaitingDecision === true ? (
            /* The human gate, stated as a FACT rather than as an unread state.
               `unviewed` retires the moment the card is opened; this does not,
               because reading a finished run is not the same as passing or sending
               it back — a card that has been glanced at used to become
               indistinguishable from a filed one. STATIC (no breathing): the amber
               breath belongs to unread alone, so the two can never be confused. */
            <Chip kind="warn" fill={false} title={t('card.awaitingDecisionTitle')}>
              {t('card.awaitingDecision')}
            </Chip>
          ) : refining(task) ? (
            <Chip kind="warn" fill={false} title={t('card.refiningTitle')}>
              {t('card.refining')}
            </Chip>
          ) : lastPlain !== undefined ? (
            <Chip kind={resultChipKind(lastPlain.result)} fill={false}>
              {settledChipLabel(runs.length)}
            </Chip>
          ) : undefined
          const automationChips = (
            <>
              {task.schedule?.enabled === true && !blockedAutomation(task) && (
                <Chip fill={false} title={scheduleChipTitle(task)}>
                  {task.schedule.mode === 'chain' ? t('card.chain') : t('card.scheduled')}
                </Chip>
              )}
              {task.schedule?.enabled === true && task.schedule.maxRuns !== undefined && !blockedAutomation(task) && (
                <Chip kind="muted" fill={false} title={t('card.batchProgress')}>
                  {task.schedule.runCount}/{task.schedule.maxRuns}
                </Chip>
              )}
              {/* Blocked automation owns the wording slot (task schedule or any
                  session rule): one cause, one chip — the schedule/batch text yields
                  instead of stacking four chips for it. Live progress is orthogonal
                  and survives (see chaining). */}
              {blockedAutomation(task) && (
                <Chip kind="error" fill={false} title={scheduleChipTitle(task)}>
                  {t('card.autoBlocked')}
                </Chip>
              )}
              {chaining && (
                <Chip kind="warn" fill={false} title={t('card.chainingTitle')}>
                  {t('card.chaining')}
                </Chip>
              )}
              {/* Automation paused by a failed run: the review column reads "failure
                  stopped the rule" at a glance, distinct from "success awaiting
                  confirmation". */}
              {pausedFailed && (
                <Chip kind="error" fill={false} title={t('card.autoPausedFailedTitle')}>
                  {t('card.autoPausedFailed')}
                </Chip>
              )}
              {queuedComments > 0 && (
                <Chip kind="warn" fill={false} title={t('card.commentQueueTitle')}>
                  {t('card.commentQueue')} {queuedComments}
                </Chip>
              )}
              {unviewed && (
                /* Two different facts used to render identically: "a run settled and
                   you have not looked" and "only a comment arrived". Only the first
                   means a round is finished and the card may be ready to move; the
                   second means somebody said something. Stating the count only when a
                   run is behind it keeps the number meaningful — a bare new-comment
                   label is the comment-only case. */
                <Chip kind="warn" fill={false} title={t(hasUnviewedRun ? 'card.newContentTitle' : 'card.newCommentTitle')}>
                  {hasUnviewedRun ? `${t('card.newContent')} ${unviewedCount}` : t('card.newComment')}
                </Chip>
              )}
            </>
          )
          const hasAnything = primaryChip !== undefined
            || task.schedule?.enabled === true
            || latest !== undefined
            || queuedComments > 0
            || unviewed
            || pausedFailed
            || chaining
          if (!hasAnything) return null
          return (
            <span className={css.cardBadges}>
              {primaryChip}
              {automationChips}
            </span>
          )
        })()}
      </span>
      {/* Sessions strip: who is working on this card, and how many. The dots are a
          pure-visual encoding (colour + position carry the state), and their content
          used to live only in a `title` on a non-focusable span inside an
          `aria-hidden` container — so "which of my sessions is working, and how
          many are there" was a fact only sighted hovering users could get. Now the
          strip keeps the dots decorative and states the same thing in words for
          assistive tech, exactly as the notification bell does. */}
      {dots !== undefined && dots.length > 0 && (
        <span className={css.cardSessions}>
          {dots.map(dot => (
            <span
              key={dot.sessionId}
              className={css.cardSessionDot}
              data-state={dot.state}
              title={dotTitleOf?.(dot.sessionId) ?? dot.sessionId}
              aria-hidden="true"
            />
          ))}
          {(overflowDots ?? 0) > 0 && (
            <span className={css.cardSessionMore} aria-hidden="true">+{String(overflowDots)}</span>
          )}
          <span className={css.visuallyHidden}>
            {t('card.sessionsForAt', {
              sessions: dots.map(dot => dotTitleOf?.(dot.sessionId) ?? dot.sessionId).join('；'),
              n: String((dots.length + (overflowDots ?? 0))),
            })}
          </span>
        </span>
      )}
      {onColorPick !== undefined && (
        <span className={css.cardColorBar} data-ghost-hide="" onClick={event => { event.stopPropagation() }}>
          <ColorSwatches value={task.color} onChange={color => { onColorPick(color) }} />
        </span>
      )}
    </div>
  )
}
