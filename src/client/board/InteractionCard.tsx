/**
 * Pending native-interaction card: the plan/question the session's agent is
 * waiting on, rendered IN PLACE over the composer so the user answers right
 * there — in the review page's comment rail and the
 * linked-session panel alike (both read this one component).
 *
 * PARITY WITH THE NATIVE COMPOSER IS THE CONTRACT. The board does not invent
 * its own question UI: it renders the same request the native
 * `QuestionComposer` renders, with the same parts and the same behaviour —
 * eyebrow + title, collapse / dismiss-all icons, the option list (numbered
 * radios, or checkboxes for a multi-select, each with its optional
 * description and the 推荐 badge split off the label suffix), the custom
 * answer field appended to the list (or standing alone as a block when the
 * question offers no options), the pager (上一题 / 第 n / 总数 / 下一题), the
 * near-field error line, and the skip + next/submit pair. Behaviour follows
 * the same rules: a single-select choice auto-advances to the next question;
 * typing a custom answer clears the single-select choice (and vice versa);
 * Enter continues (Shift+Enter breaks a line, an IME composition never
 * submits); a multi-select may carry options AND custom text; an incomplete
 * batch jumps to the first unanswered question and says so; a failed submit
 * keeps the card open with the reason on it.
 *
 * ANSWERING IS IN PLACE, THROUGH THE OFFICIAL CARRIER. The pending question
 * arrives from the official session-status snapshot (each session's
 * `pendingInteraction` — the same source the native composer reads), so
 * `answer`/`cancel` settle the very request
 * the native surface would settle — nothing new is registered, first answer
 * still wins, and the other surface's card drops with the next snapshot
 * notification. A host whose snapshot entries carry data but no action keeps
 * the read-only shell (kind + one navigate affordance); the waiting banner
 * stays available there, so a proven wait never reaches the UI as silence.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import {
  answerBatchOf,
  planDecisionAnswers,
  planQuestionOf,
  type QuestionDraft,
  type WireQuestion,
  type WireQuestionItem,
} from '../../core/question-rpc.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { draftStore, questionDraftKey, restoreQuestionDrafts, saveQuestionDrafts } from './drafts.ts'
import { Markdown } from './Markdown.tsx'
import { Button } from './ui.tsx'
import { Chip } from './Chip.tsx'
import { Icon } from './ui.tsx'

/** The 推荐 suffix the native surface splits off an option label. */
const RECOMMENDED_SUFFIX = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i

/** Split the recommendation suffix without changing the answer value. */
function splitRecommended(label: string): { label: string; recommended: boolean } {
  return RECOMMENDED_SUFFIX.test(label)
    ? { label: label.replace(RECOMMENDED_SUFFIX, ''), recommended: true }
    : { label, recommended: false }
}

/** Whether an event belongs to an active IME composition (native rule). */
function isComposing(event: { nativeEvent: { isComposing?: boolean; keyCode?: number } }): boolean {
  return event.nativeEvent.isComposing === true || event.nativeEvent.keyCode === 229
}

/** Whether a draft carries an answer (an option picked or custom text). */
function draftAnswered(draft: QuestionDraft): boolean {
  return draft.selected.length > 0 || (draft.custom?.trim() ?? '') !== ''
}

/** Whether a draft is complete (answered or explicitly skipped). */
function draftCompleted(draft: QuestionDraft): boolean {
  return draftAnswered(draft) || draft.skipped === true
}

/** Fresh drafts for one batch (never shared between carriers). */
function freshDrafts(questions: readonly WireQuestionItem[]): QuestionDraft[] {
  return questions.map(() => ({ selected: [] }))
}

/** The interaction card (see module doc). Renders nothing while idle. */
export function InteractionCard({ question, shellWaiting, sessionId, controller }: {
  /** Parsed wire content; absent with `shellWaiting` = proven wait, unknown body. */
  question: WireQuestion | undefined
  /** Honest fallback kind when the session list proves a wait but no content
   *  parsed (carrier-shape drift, present or future host) — renders the shell
   *  card instead of blank nothing. Absent with `question` = idle. */
  shellWaiting?: 'plan-review' | 'question'
  sessionId: string
  controller: BoardController
}) {
  // A proven wait whose body could not be read — a request the board cannot
  // settle, or an EMPTY body. Either way the honest surface is the shell: the
  // kind, one line saying the body is unreadable, and the one navigate action
  // (the native session always has the whole story). Same chrome as the
  // content card, so the rail geometry can never diverge between the two.
  if (shellWaiting !== undefined && (question === undefined || !controller.questionAnswerInPlace)) {
    return (
      <div className={css.interactionCard} data-plan={shellWaiting === 'plan-review' ? 'true' : undefined}>
        <div className={css.interactionCardBody}>
          <Chip kind="warn" title={t('review.planAwaiting')}>{t('review.planAwaiting')}</Chip>
          <span className={css.interactionQuestion}>{t('review.interactionBodyMissing')}</span>
        </div>
        <span className={css.interactionActions}>
          <Button variant="primary" onClick={() => { controller.openSession(sessionId) }}>
            {t('review.interactionGoAnswer')}
          </Button>
        </span>
      </div>
    )
  }
  if (question === undefined) return null
  // The carrier cannot be settled from here (a snapshot entry without its own
  // answer/cancel, or a host with no uiSession): the read-only card is the
  // honest surface — the whole batch, no submit path that could race the
  // native answerer.
  if (!controller.questionAnswerInPlace) {
    return <MirrorQuestionCard question={question} sessionId={sessionId} controller={controller} />
  }
  const planQuestion = question.isPlanReview ? planQuestionOf(question) : undefined
  return planQuestion === undefined
    ? <QuestionFlow question={question} sessionId={sessionId} controller={controller} />
    : <PlanReviewCard question={question} item={planQuestion} sessionId={sessionId} controller={controller} />
}

/**
 * The generic question flow — one carrier, many questions, one answer batch.
 * Drafts live in this component and are re-created whenever the carrier's
 * identity changes, so a second request can never inherit the first one's
 * half-typed answers.
 */
function QuestionFlow({ question, sessionId, controller }: {
  question: WireQuestion
  sessionId: string
  controller: BoardController
}) {
  // `progress` is keyed by carrier: the state below belongs to `key`, so a
  // re-render with a different request starts clean in the SAME pass (no
  // stale frame of the previous request's answers).
  //
  // Initialised from the draft store, which is what makes a half-completed
  // answer survive the exits that used to destroy it: Escape, a backdrop tap,
  // a reload, or a re-published carrier. The key is the host's rpcId, replayed
  // identically for as long as the ask() is open, so the same card comes back
  // with the same answers. A new request mints a new rpcId and starts clean.
  const [progress, setProgress] = useState<{ key: string; index: number; drafts: QuestionDraft[] }>(
    () => ({
      key: question.rpcId,
      index: 0,
      drafts: restoreQuestionDrafts(draftStore, question.rpcId) ?? freshDrafts(question.questions),
    }),
  )
  const [busy, setBusy] = useState<'answer' | 'cancel' | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [minimized, setMinimized] = useState(false)
  // A stable id so the collapse button can point at what it collapses: a control
  // that reports `aria-expanded` without `aria-controls` tells a screen reader its
  // state but not its subject.
  const bodyId = useId()
  // Questions whose custom field already took focus: auto-focus is a
  // first-visit affordance only (native rule — refocusing on every advance
  // would fight the user's own navigation).
  const focused = useRef<Set<number>>(new Set())

  const current = progress.key === question.rpcId
    ? progress
    : { key: question.rpcId, index: 0, drafts: freshDrafts(question.questions) }
  const { index, drafts } = current
  const item = question.questions[index]
  const draft = drafts[index] ?? { selected: [] }
  const options = item?.options ?? []
  const hasOptions = options.length > 0
  const last = index === question.questions.length - 1

  const replaceProgress = (nextIndex: number, nextDrafts: QuestionDraft[]): void => {
    setProgress({ key: question.rpcId, index: nextIndex, drafts: nextDrafts })
  }

  // Persist every answer as it is made. This is the whole durability story for
  // the product's highest-stakes interaction: the exits that used to discard a
  // half-completed batch (Escape, an accidental backdrop tap, a reload, a
  // re-published carrier) now merely hide it, and coming back restores it.
  // Keyed by rpcId, so it can never leak into a different request.
  useEffect(() => {
    if (progress.key !== question.rpcId) return
    saveQuestionDrafts(draftStore, question.rpcId, progress.drafts)
  }, [progress, question.rpcId])

  const updateDraft = (update: (entry: QuestionDraft) => QuestionDraft, nextIndex: number = index): void => {
    replaceProgress(nextIndex, drafts.map((entry, entryIndex) => entryIndex === index ? update(entry) : entry))
    setError(undefined)
  }

  const choose = (label: string): void => {
    updateDraft(entry => item?.multiSelect === true
      ? {
        ...entry,
        selected: entry.selected.includes(label)
          ? entry.selected.filter(selected => selected !== label)
          : [...entry.selected, label],
        skipped: false,
      }
      // Single-select: picking an option IS the whole answer (no custom text).
      : { selected: [label], custom: '', skipped: false },
    // Native auto-advance: a single-select choice moves on when it is not the
    // last question; a multi-select stays put.
    item?.multiSelect !== true && !last ? index + 1 : index)
  }

  const setCustom = (text: string): void => {
    updateDraft(entry => ({
      ...entry,
      // Single-select: custom text replaces any selection (host forbids both).
      selected: item?.multiSelect === true ? entry.selected : [],
      custom: text,
      skipped: false,
    }))
  }

  const continueFromCustom = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return
    event.preventDefault()
    continueFlow()
  }

  const submit = (values: QuestionDraft[]): void => {
    const missing = values.findIndex(entry => !draftCompleted(entry))
    if (missing >= 0) {
      replaceProgress(missing, values)
      setError(t('review.interactionIncomplete'))
      return
    }
    setBusy('answer')
    setError(undefined)
    void controller.answerQuestion(question.rpcId, sessionId, answerBatchOf(question, values)).then(accepted => {
      setBusy(undefined)
      // Accepted: the snapshot drops the carrier and this card unmounts —
      // nothing to do here. Rejected: the card STAYS, with the reason on it.
      if (!accepted) {
        setError(t('review.interactionRejected'))
        return
      }
      // Accepted is the ONE moment the answers stop being a draft: they are now
      // the host's answer, so the saved copy is released (a later request mints
      // a new rpcId anyway, but leaving it would keep a stale slot alive).
      draftStore.clear(questionDraftKey(question.rpcId))
    })
  }

  const continueFlow = (): void => {
    if (!draftAnswered(draft)) {
      setError(t('review.interactionUnanswered'))
      return
    }
    if (!last) {
      replaceProgress(index + 1, drafts)
      setError(undefined)
      return
    }
    submit(drafts)
  }

  const skip = (): void => {
    const nextDrafts = drafts.map((entry, entryIndex) => entryIndex === index
      ? { selected: [], custom: '', skipped: true }
      : entry)
    replaceProgress(last ? index : index + 1, nextDrafts)
    setError(undefined)
    if (!last) return
    submit(nextDrafts)
  }

  const dismissAll = (): void => {
    setBusy('cancel')
    setError(undefined)
    void controller.cancelQuestion(question.rpcId).then(accepted => {
      setBusy(undefined)
      if (!accepted) setError(t('review.interactionRejected'))
    })
  }

  const disabled = busy !== undefined

  /**
   * The option list is announced as `role="radiogroup"` (single-select) or `role="group"`
   * (multi-select), and a radiogroup PROMISES arrow-key navigation with roving tabindex.
   * Neither existed: the options were plain buttons reachable only by Tab, so the
   * announced interaction model was false and a five-option question cost five tab
   * stops. The roles were right; the behaviour was missing.
   *
   * WAI-ARIA radio grammar: Up/Down (and Left/Right, which the pattern also allows)
   * move within the group AND select, wrapping at both ends; Home/End jump to the
   * ends. For a checkbox group the arrows only move — toggling on arrow is checkbox
   * behaviour, not radio behaviour, and this group is a set of independent answers.
   * Enter keeps its existing job (submit the whole batch once every question is
   * complete); the two never collide because they are different keys.
   */
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const onOptionKeyDown = (event: React.KeyboardEvent, optionIndex: number): void => {
    const count = options.length
    if (count === 0) return
    let next: number | undefined
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (optionIndex + 1) % count
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (optionIndex - 1 + count) % count
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    if (next === undefined) return
    event.preventDefault()
    const target = options[next]
    if (target === undefined) return
    if (item?.multiSelect !== true) choose(target.label)
    optionRefs.current[next]?.focus()
  }
  // Roving tabindex: the group is ONE stop, and the checked option (or the first when
  // nothing is checked) is the one that carries it.
  const selectedOptionIndex = options.findIndex(option => draft.selected.includes(option.label))
  const rovingIndex = selectedOptionIndex >= 0 ? selectedOptionIndex : 0

  return (
    <section className={css.interactionCard} data-plan={undefined} aria-label={item?.question ?? t('review.planAwaiting')}>
      <header className={css.interactionHead}>
        <div className={css.interactionHeading}>
          {item?.header !== undefined && item.header !== '' && (
            <div className={css.interactionEyebrow}>{item.header}</div>
          )}
          <h2 className={css.interactionTitle}>{item?.question ?? ''}</h2>
        </div>
        {/* Header actions mirror the native pair: collapse (the card keeps its
            head only) and dismiss-the-whole-request. */}
        <div className={css.interactionHeadActions}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t(minimized ? 'review.interactionExpand' : 'review.interactionCollapse')}
            title={t(minimized ? 'review.interactionExpand' : 'review.interactionCollapse')}
            aria-expanded={!minimized}
            aria-controls={bodyId}
            disabled={disabled}
            onClick={() => { setMinimized(value => !value) }}
          >
            {/* The arrow turns around. It used to render `chevronDown` expanded and
                `arrowDown` collapsed — two glyphs half a unit apart, both pointing
                down, so the icon said "down" either way and only `aria-expanded`
                carried the state (to screen readers alone). */}
            <Icon name={minimized ? 'chevronDown' : 'arrowUp'} />
          </button>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('review.interactionAbandon')}
            title={t('review.interactionAbandon')}
            disabled={disabled}
            onClick={dismissAll}
          >
            <Icon name="close" />
          </button>
        </div>
      </header>

      {!minimized && (
        <>
          <div className={css.interactionBody} id={bodyId}>
            {item?.detail !== undefined && item.detail !== '' && (
              <div className={css.interactionDetail}>
                <Markdown text={item.detail} />
              </div>
            )}
            <div
              className={css.interactionOptions}
              role={item?.multiSelect === true ? 'group' : 'radiogroup'}
              aria-label={item?.question ?? ''}
            >
              {options.map((option, optionIndex) => {
                const selected = draft.selected.includes(option.label)
                const display = splitRecommended(option.label)
                return (
                  <button
                    key={`${option.label}-${String(optionIndex)}`}
                    type="button"
                    className={`${css.interactionOptionButton}${selected && item?.multiSelect !== true ? ` ${css.interactionOptionOn}` : ''}`}
                    role={item?.multiSelect === true ? 'checkbox' : 'radio'}
                    aria-checked={selected}
                    aria-label={display.label}
                    ref={element => { optionRefs.current[optionIndex] = element }}
                    tabIndex={optionIndex === rovingIndex ? 0 : -1}
                    disabled={disabled}
                    onClick={() => { choose(option.label) }}
                    onKeyDown={event => {
                      // Arrow/Home/End first: they belong to the radio group and must
                      // not be swallowed by the Enter shortcut below.
                      onOptionKeyDown(event, optionIndex)
                      if (event.defaultPrevented) return
                      // Native shortcut: Enter on an option submits the whole
                      // batch, but only once every question is complete.
                      if (event.key !== 'Enter' || !drafts.every(draftCompleted)) return
                      event.preventDefault()
                      submit(drafts)
                    }}
                  >
                    {item?.multiSelect === true
                      ? (
                        <span
                          className={`${css.interactionCheck}${selected ? ` ${css.interactionCheckOn}` : ''}`}
                          aria-hidden="true"
                        >
                          {selected && <Icon name="check" />}
                        </span>
                      )
                      : <span className={css.interactionOptionNumber} aria-hidden="true">{optionIndex + 1}</span>}
                    <span className={css.interactionOptionCopy}>
                      <span className={css.interactionOptionLine}>
                        <span className={css.interactionOptionLabel}>{display.label}</span>
                        {display.recommended && <span className={css.interactionBadge}>{t('review.interactionRecommended')}</span>}
                        {option.description !== undefined && (
                          <span className={css.interactionOptionDescription}>{option.description}</span>
                        )}
                      </span>
                    </span>
                  </button>
                )
              })}
              {hasOptions && (
                <div className={`${css.interactionCustomRow}${(draft.custom ?? '') !== '' ? ` ${css.interactionCustomRowOn}` : ''}`}>
                  {item?.multiSelect === true
                    ? (
                      <span
                        className={`${css.interactionCheck}${(draft.custom ?? '') !== '' ? ` ${css.interactionCheckOn}` : ''}`}
                        aria-hidden="true"
                      >
                        {(draft.custom ?? '') !== '' && <Icon name="check" />}
                      </span>
                    )
                    : <span className={css.interactionOptionNumber} aria-hidden="true"><Icon name="pencil" /></span>}
                  <AnswerField
                    variant="inline"
                    value={draft.custom ?? ''}
                    disabled={disabled}
                    placeholder={t('review.interactionTypePlaceholder')}
                    onChange={setCustom}
                    onKeyDown={continueFromCustom}
                  />
                </div>
              )}
            </div>
            {/* No options at all: the answer field is the question's whole body
                (native block variant). */}
            {!hasOptions && (
              <AnswerField
                variant="block"
                focusOnMount={!focused.current.has(index)}
                value={draft.custom ?? ''}
                disabled={disabled}
                placeholder={t('review.interactionTypePlaceholder')}
                onFocus={() => { focused.current.add(index) }}
                onChange={setCustom}
                onKeyDown={continueFromCustom}
              />
            )}
          </div>

          <footer className={css.interactionFooter}>
            <div className={css.interactionPager}>
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('review.interactionPrev')}
                title={t('review.interactionPrev')}
                disabled={index === 0 || disabled}
                onClick={() => { replaceProgress(index - 1, drafts); setError(undefined) }}
              >
                <Icon name="arrowLeft" />
              </button>
              <span className={css.interactionProgress}>
                {t('review.interactionProgress', { n: String(index + 1), total: String(question.questions.length) })}
              </span>
              <button
                type="button"
                className={css.iconButton}
                /* The pager's forward arrow and the primary button were BOTH named
                   「下一题」 while behaving differently: the arrow moves between
                   questions without submitting (and without the "answer this one
                   first" guard the primary button carries). Two controls with one
                   accessible name is an ambiguous target for voice control — "click
                   下一题" matches either — and it also hid the guard difference from
                   screen-reader users, who could not tell which one would refuse.
                   The arrow now says what it actually does. */
                aria-label={t('review.interactionNextQuestion')}
                title={t('review.interactionNextQuestion')}
                disabled={last || disabled}
                onClick={() => { replaceProgress(index + 1, drafts); setError(undefined) }}
              >
                <Icon name="arrowRight" />
              </button>
            </div>
            {/* role=status: the reason for a refusal is announced, not just
                painted (native grammar). */}
            <div className={css.interactionFeedback} role="status">{error ?? ''}</div>
            <div className={css.interactionFooterActions}>
              <Button variant="ghost" disabled={disabled} onClick={skip}>
                {t('review.interactionSkip')}
              </Button>
              <Button variant="primary" disabled={disabled || !draftAnswered(draft)} onClick={continueFlow}>
                {busy === 'answer'
                  ? t('review.interactionSubmitting')
                  : last ? t('review.interactionSubmit') : t('review.interactionNext')}
              </Button>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}

/**
 * The auto-growing answer field (native grammar): a textarea over a hidden
 * mirror that owns the height, so a long answer soft-wraps and grows while
 * Shift+Enter still breaks a line; past the cap the textarea scrolls itself.
 * Mirror and textarea share font, line-height, padding and wrapping rules or
 * the two heights diverge.
 */
function AnswerField({ variant, value, placeholder, disabled, focusOnMount, onChange, onKeyDown, onFocus }: {
  variant: 'inline' | 'block'
  value: string
  placeholder: string
  disabled: boolean
  focusOnMount?: boolean
  onChange: (text: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus?: () => void
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  // Focus after mount (never native `autoFocus`): the card can be rendered
  // inside a Dialog subtree, where a mount-time focus would race the dialog's
  // own focus loop — one mechanism, no competition.
  useEffect(() => {
    if (focusOnMount === true) inputRef.current?.focus()
  }, [focusOnMount])
  return (
    <div className={`${css.interactionField}${variant === 'inline' ? ` ${css.interactionFieldInline}` : ` ${css.interactionFieldBlock}`}`}>
      <div aria-hidden="true" className={css.interactionFieldMirror}>{`${value}\n`}</div>
      <textarea
        ref={inputRef}
        className={css.interactionFieldInput}
        value={value}
        disabled={disabled}
        rows={1}
        placeholder={placeholder}
        onFocus={onFocus}
        onChange={event => { onChange(event.target.value) }}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

/**
 * The plan under review: the plan body (Markdown, its own scroll region) with the
 * three decisions the hosted plan card itself offers — 去聊天里说 (dismiss the
 * request, keep discussing), 拒绝 and 确认执行. The approve label is the intent's
 * own, never inferred from option order.
 *
 * This card used to carry a fourth affordance, an amendment field whose text turned
 * a refusal into "revise with feedback". It was removed for parity: the hosted plan
 * card offers no such input, and a board card that invents an extra decision is not
 * the same card. `planDecisionAnswers` still accepts an amendment (the host API
 * supports revise-with-feedback), so restoring it is a UI change, not a new
 * capability — and `''` here is deliberate rather than an oversight.
 */
function PlanReviewCard({ question, item, sessionId, controller }: {
  question: WireQuestion
  item: WireQuestionItem
  sessionId: string
  controller: BoardController
}) {
  const plan = item.detail ?? item.question
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const approve = useMemo(() => planDecisionAnswers(item, 'approve', ''), [item])
  const decline = useMemo(() => planDecisionAnswers(item, 'decline', ''), [item])

  const send = (answers: ReturnType<typeof planDecisionAnswers>): void => {
    setBusy(true)
    setError(undefined)
    void controller.answerQuestion(question.rpcId, sessionId, answers).then(accepted => {
      setBusy(false)
      if (!accepted) setError(t('review.interactionRejected'))
    })
  }
  const discuss = (): void => {
    setBusy(true)
    setError(undefined)
    void controller.cancelQuestion(question.rpcId).then(accepted => {
      setBusy(false)
      if (!accepted) setError(t('review.interactionRejected'))
    })
  }

  return (
    <section className={css.interactionCard} data-plan="true" aria-label={item.question}>
      <div className={css.interactionStrip}>
        <span className={css.interactionStripDot} aria-hidden="true" />
        {t('review.planAwaiting')}
      </div>
      <div className={css.interactionPlanBody}>
        <Markdown text={plan} />
      </div>
      <div className={css.interactionFooter}>
        <div className={css.interactionFeedback} role="status">{error ?? ''}</div>
        <div className={css.interactionFooterActions}>
          <Button variant="ghost" disabled={busy} onClick={discuss}>{t('review.interactionDiscuss')}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => { send(decline) }}>{t('review.planDecline')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => { send(approve) }}>{t('review.planConfirm')}</Button>
        </div>
      </div>
    </section>
  )
}

/**
 * The read-only card for a carrier the board cannot settle (a snapshot entry
 * without its own answer/cancel, or no uiSession at all): the full batch —
 * every question, its detail, its options as plain text, never as clickable
 * answers — with ONE action: navigate to the native session, where the
 * official composer owns the call. Same chrome as the interactive card, so
 * the rail geometry never diverges between hosts. (A proven wait with no
 * readable body is the shell, rendered by the caller.)
 */
function MirrorQuestionCard({ question, sessionId, controller }: {
  question: WireQuestion
  sessionId: string
  controller: BoardController
}) {
  const planQuestion = question.isPlanReview ? planQuestionOf(question) : undefined
  const goAnswer = (): void => {
    controller.openSession(sessionId)
  }
  return (
    <div className={css.interactionCard} data-plan={planQuestion !== undefined ? 'true' : undefined}>
      <div className={css.interactionCardBody}>
        {planQuestion !== undefined ? (
          <>
            <Chip kind="warn" title={t('review.planAwaiting')}>{t('review.planAwaiting')}</Chip>
            <span className={css.interactionQuestion}>{planQuestion.question}</span>
            {planQuestion.detail !== undefined && <span className={css.interactionDetail}>{planQuestion.detail}</span>}
          </>
        ) : (
          <>
            {question.questions.map((item, index) => (
              /* Two different jobs, two class names. This element is the question
                 BLOCK (chip + text + detail + options stacked); the span inside is
                 the question TEXT, which owns the typography. They used to share
                 `.interactionQuestion`, so the same class was a layout container in
                 one place and a text style in the other — the kind of overload that
                 reads as a bug and invites a wrong "fix". */
              <span key={item.id} className={css.interactionQuestionBlock}>
                <span className={css.interactionQuestion}>
                  <Chip
                    kind="warn"
                    title={t('review.questionIndex', { n: String(index + 1), total: String(question.questions.length) })}
                  >
                    {t('review.questionIndex', { n: String(index + 1), total: String(question.questions.length) })}
                  </Chip>
                  {' '}{item.question}
                </span>
                {item.detail !== undefined && <span className={css.interactionDetail}>{item.detail}</span>}
                {(item.options ?? []).length > 0 && (
                  <span className={css.interactionOptions}>
                    {(item.options ?? []).map(option => (
                      <span
                        key={option.label}
                        className={css.interactionOption}
                        title={option.description}
                      >
                        {option.label}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            ))}
          </>
        )}
      </div>
      <span className={css.interactionActions}>
        <Button variant="primary" onClick={goAnswer}>{t('review.interactionGoAnswer')}</Button>
      </span>
    </div>
  )
}
