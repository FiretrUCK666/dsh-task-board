/**
 * Task card: the board's column item. Clicking opens the task detail — it
 * never executes anything directly (detail holds the Run button). Cards are
 * draggable onto other columns; the drop semantics are decided by the board
 * through resolveCardDrop.
 */
import { useState, type CSSProperties } from 'react'
import type { TaskRecord } from '../../core/tasks.ts'
import { cardSourceLabel, taskBindsOf } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { scheduleSummary } from './automation-ui.tsx'
import { cardLightOf, cardUpdatedAtOf, titleOrUntitled, type CardPrimary, type CardSessionDot, type CardViewModel } from './card-view.ts'
import { Chip } from './Chip.tsx'
import { resultChipKind, waitingKeyOf } from './session-chip.ts'
import { STATUS_KEY } from './status.ts'
import { ColorSwatches, Icon } from './ui.tsx'
import { formatDateTime, formatTime } from './format-time.ts'

/** Tooltip for the schedule chip: THE one summary grammar (shared with the
 *  detail's disclosure and the overview) — honest about the rule's readiness:
 *  chain reports its run budget, cron its next due instant, paused its
 *  blocking status, blocked its cause (plus the failure word when the last
 *  work failed — two orthogonal causes, both named). */
function scheduleChipTitle(task: TaskRecord): string {
  return scheduleSummary(task)
}

/**
 * The primary chip's words — THE label grammar for the card's one loudest
 * line. One function so 「等待回应 · 提问」 and 「待处理 3」 (several
 * conversations blocked at once) cannot be spelled two ways, and so a surface
 * that needs the same words without the chip gets them from here.
 */
export function primaryChipLabel(primary: CardPrimary): string {
  switch (primary.kind) {
    case 'waiting':
      return primary.count > 1
        ? `${t('card.pending')} ${String(primary.count)}`
        : `${t('card.waiting')} · ${t(waitingKeyOf(primary.waiting))}`
    case 'running':
      return t('detail.result.running')
    case 'queued':
      return `${t('card.commentQueue')} ${String(primary.count)}`
    case 'gate':
      return primary.failed ? t('card.awaitingDecisionFailed') : t('card.awaitingDecision')
    case 'runs':
      return settledChipLabel(primary.count)
    case 'idle':
      return ''
  }
}

/** The settled-run count label: "N 次执行" / "N runs". */
export function settledChipLabel(runs: number): string {
  return `${runs} ${t('board.runs')}`
}

/** One card in a column — a PURE state summary: title, description, source
 *  line (workspace / bound session), the updated stamp, and the status chips
 *  (what the task IS doing: running / waiting / scheduled / chaining / failed
 *  paused / queued / new). The run window (start/end/duration) and
 *  the comment timeline live in the detail — cards never carry content that
 *  belongs to the conversation pages. */
export function TaskCard({ task, selected, workspaceTitleOf, boundTitleOf, pendingTitle, view, onMoveStep, onClick, onQuickRun, onColorPick, dots, overflowDots, nextAction, dotTitleOf }: {
  task: TaskRecord
  /** Whether the card is picked in multi-select (Ctrl/Cmd+click or organize mode). */
  selected?: boolean
  /** Resolve a workspace id to its display title (raw id when unknown). */
  workspaceTitleOf: (workspaceId: string) => string
  /** Resolve a bound session's display title (session-bound tasks show their
   *  session identity, not the default workspace label). */
  boundTitleOf?: (task: TaskRecord) => string
  /** Tooltip detail listing which conversation waits on what. */
  pendingTitle: string
  /**
   * THE card summary (card-view.ts): every chip, the breath and the run guard
   * read fields from it. The component derives nothing of its own — that split
   * is what let the card's own priority ranking and its rendered ranking drift
   * apart, and let a failure the model could not see print no word at all.
   */
  view: CardViewModel
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
  // The card's source line — one derivation for every card (see
  // cardSourceLabel): the bound session's title when it differs from the
  // task title, else the workspace label. Empty = no source line.
  const sourceLabel = cardSourceLabel(
    task,
    taskBindsOf(task).some(bind => bind.kind === 'session') ? boundTitleOf?.(task) ?? '' : '',
    task.workspaceId !== undefined ? workspaceTitleOf(task.workspaceId) : '',
  )
  // The breath is owned by the view model (same priority as the primary chip);
  // ONE light at a time, decided in one place (cardLightOf): a card that is
  // working AND unread wears the in-flight halo — never both, and never a
  // winner left to stylesheet order.
  const light = cardLightOf(view.active, view.unviewed)
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
      data-light={light}
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
          tabIndex={view.running ? -1 : 0}
          title={t('card.quickRun')}
          aria-disabled={view.running ? true : undefined}
          onClick={event => {
            if (view.running) return
            event.stopPropagation()
            onQuickRun()
          }}
          onKeyDown={event => {
            if (view.running) return
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
          <span
            className={css.cardTime}
            title={formatDateTime(cardUpdatedAtOf(task))}
          >
            {t('board.updated')} {formatTime(cardUpdatedAtOf(task))}
          </span>
        </span>
        {/* Row 2: the card's chips, straight off the view model.
            (1) The PRIMARY chip IS `view.primary` — the same value the
            next-action line above reads. The model and the render used to be
            TWO chains, which is why a queued card showed no primary at all and
            a failed one named itself twice on one card.
            (2) The row renders whenever there is ANYTHING to say. Each chip
            below already carries its own condition, so the row needs no gate
            of its own — a gate here once hid the whole row for a card whose
            session was asking a question, i.e. exactly when the one signal
            that asks the user to act was unrenderable. */}
        {(() => {
          const primary = view.primary
          const primaryChip = primary.kind === 'waiting' ? (
            <Chip kind="warn" fill={false} title={pendingTitle !== ''
              ? pendingTitle
              : t('card.waitingTitle', { kind: t(waitingKeyOf(primary.waiting)) })}>
              {primaryChipLabel(primary)}
            </Chip>
          ) : primary.kind === 'running' ? (
            <Chip kind="warn" fill={false} icon={<span className={css.spinner} aria-hidden="true" />}>
              {primaryChipLabel(primary)}
            </Chip>
          ) : primary.kind === 'queued' ? (
            <Chip kind="warn" fill={false} title={t('card.commentQueueTitle', { n: String(primary.count) })}>
              {primaryChipLabel(primary)}
            </Chip>
          ) : primary.kind === 'gate' ? (
            /* The human gate, stated as a FACT rather than as an unread state.
               It retires in exactly two ways — the user LOOKS (the same read
               clock as 新 and the ring) or DECIDES (通过/打回 move the card).
               There is no third, and none of them is the other. STATIC (no
               breathing): the amber breath belongs to unread alone. */
            <Chip kind="warn" fill={false} title={t('card.awaitingDecisionTitle')}>
              {primaryChipLabel(primary)}
            </Chip>
          ) : primary.kind === 'runs' ? (
            <Chip kind={resultChipKind(primary.failed ? 'failed' : 'succeeded')} fill={false}>
              {primaryChipLabel(primary)}
            </Chip>
          ) : undefined
          const automationChips = (
            <>
              {task.schedule?.enabled === true && view.autoBlocked === undefined && (
                <Chip fill={false} title={scheduleChipTitle(task)}>
                  {task.schedule.mode === 'chain' ? t('card.chain') : t('card.scheduled')}
                </Chip>
              )}
              {task.schedule?.enabled === true && task.schedule.maxRuns !== undefined && view.autoBlocked === undefined && (
                <Chip kind="muted" fill={false} title={t('card.batchProgress')}>
                  {task.schedule.runCount}/{task.schedule.maxRuns}
                </Chip>
              )}
              {/* Blocked automation owns the wording slot (task schedule or any
                  session rule): one cause, one chip — the schedule/batch text yields
                  instead of stacking four chips for it. Live progress is orthogonal
                  and survives (see view.chaining). */}
              {view.autoBlocked !== undefined && (
                <Chip kind="error" fill={false} title={scheduleChipTitle(task)}>
                  {t('card.autoBlocked')}
                </Chip>
              )}
              {view.chaining && (
                <Chip kind="warn" fill={false} title={t('card.chainingTitle')}>
                  {t('card.chaining')}
                </Chip>
              )}
              {/* Automation paused by a failed run: the review column reads "failure
                  stopped the rule" at a glance, distinct from "success awaiting
                  confirmation". */}
              {view.autoPausedFailed && (
                <Chip kind="error" fill={false} title={t('card.autoPausedFailedTitle')}>
                  {t('card.autoPausedFailed')}
                </Chip>
              )}
              {view.unviewed && (
                /* Two different facts used to render identically: "a run settled and
                   you have not looked" and "only a comment arrived". Only the first
                   means a round is finished and the card may be ready to move; the
                   second means somebody said something. Stating the count only when a
                   run is behind it keeps the number meaningful — a bare new-comment
                   label is the comment-only case. */
                <Chip kind="warn" fill={false} title={t(view.unviewedRunCount > 0 ? 'card.newContentTitle' : 'card.newCommentTitle')}>
                  {view.unviewedRunCount > 0 ? `${t('card.newContent')} ${view.unviewedRunCount}` : t('card.newComment')}
                </Chip>
              )}
            </>
          )
          const hasAnything = primaryChip !== undefined
            || task.schedule?.enabled === true
            || view.unviewed
            || view.chaining
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
