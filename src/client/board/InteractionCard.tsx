/**
 * Pending native-interaction card: the plan/question the session's agent is
 * waiting on, rendered over the composer so the user answers in place.
 *
 * On 0.1.5 the board is a READ-ONLY mirror of the official pending snapshot:
 * answering stays in the native session (the waterfall is a claim chain, so
 * a board-side answer would race the native composer). The card therefore
 * shows the full batch read-only with a single navigate affordance
 * ("去会话回答" → sessions.open). The legacy in-place grammar (per-question
 * walk/skip/submit) only runs when the controller's face reports
 * `questionAnswerInPlace` (pre-0.1.5 hosts with a live `respond` path);
 * the plan-review grammar degrades the same way (confirm/decline hidden,
 * discuss becomes the navigate action). The card disappears when the host
 * resolves the call (the mirror snapshot drops it).
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import {
  answerBatchOf,
  planDecisionAnswers,
  planQuestionOf,
  type QuestionDraft,
  type WireQuestion,
} from '../../core/question-rpc.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Button } from './ui.tsx'
import { Chip } from './Chip.tsx'
import { PromptInput } from './PromptInput.tsx'

/** Whether a draft carries an answer (an option picked, custom text, or an
 *  explicit skip — all three make the batch complete for that question). */
function draftAnswered(draft: QuestionDraft): boolean {
  return draft.selected.length > 0 || (draft.custom?.trim() ?? '') !== '' || draft.skipped === true
}

/** The interaction card (see module doc). Renders nothing while idle. */
export function InteractionCard({ question, sessionId, controller }: {
  question: WireQuestion
  sessionId: string
  controller: BoardController
}) {
  const [questionIndex, setQuestionIndex] = useState(0)
  const [drafts, setDrafts] = useState<QuestionDraft[]>(() =>
    question.questions.map(() => ({ selected: [] })),
  )
  const [amend, setAmend] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  // 0.1.5 mirror mode: the board never answers — the card is read-only with
  // a navigate affordance. The legacy in-place grammar below only runs on
  // hosts whose face still settles the call (questionAnswerInPlace).
  if (!controller.questionAnswerInPlace) {
    return (
      <MirrorQuestionCard question={question} sessionId={sessionId} controller={controller} />
    )
  }

  // Plan review shows the plan question itself; an ask flow walks its list.
  const planQuestion = question.isPlanReview ? planQuestionOf(question) : undefined
  const current = planQuestion === undefined
    ? { item: question.questions[questionIndex], index: questionIndex }
    : undefined
  const options = current?.item.options ?? []

  const send = async (answers: ReturnType<typeof answerBatchOf>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const accepted = await controller.answerQuestion(question.rpcId, sessionId, answers)
    setBusy(false)
    if (!accepted) setError(t('review.interactionRejected'))
    // On acceptance the resolved frame drops the card; nothing to do here.
  }

  const declinePlan = (): void => {
    const item = planQuestion
    if (item === undefined) return
    void send(planDecisionAnswers(item, 'decline', amend))
  }

  const confirmPlan = (): void => {
    const item = planQuestion
    if (item === undefined) return
    void send(planDecisionAnswers(item, 'approve', amend))
  }

  const discussPlan = (): void => {
    setBusy(true)
    setError(undefined)
    void controller.cancelQuestion(question.rpcId).then(accepted => {
      setBusy(false)
      if (!accepted) setError(t('review.interactionRejected'))
    })
  }

  const toggleOption = (label: string): void => {
    setDrafts(previous => previous.map((entry, index) => {
      if (index !== questionIndex) return entry
      if (current?.item.multiSelect === true) {
        return { ...entry, selected: entry.selected.includes(label)
          ? entry.selected.filter(item => item !== label)
          : [...entry.selected, label], skipped: false }
      }
      // Single-select: picking an option is the whole answer (no custom text).
      return { selected: [label], skipped: false }
    }))
    setError(undefined)
  }

  const setCustom = (text: string): void => {
    setDrafts(previous => previous.map((entry, index) => {
      if (index !== questionIndex) return entry
      // Single-select custom text replaces any selection (host forbids both).
      return current?.item.multiSelect === true
        ? { ...entry, custom: text, skipped: false }
        : { selected: [], custom: text, skipped: false }
    }))
    setError(undefined)
  }

  const nextQuestion = (): void => {
    if (current === undefined) return
    if (!draftAnswered(drafts[current.index])) {
      setError(t('review.interactionUnanswered'))
      return
    }
    if (current.index < question.questions.length - 1) {
      setQuestionIndex(current.index + 1)
      setError(undefined)
    }
  }

  const submitAnswers = (): void => {
    // The batch must be complete (answered or skipped) and in frame order.
    const missing = drafts.findIndex(draft => !draftAnswered(draft))
    if (missing >= 0) {
      setQuestionIndex(missing)
      setError(t('review.interactionUnanswered'))
      return
    }
    void send(answerBatchOf(question, drafts))
  }

  const skipQuestion = (): void => {
    if (current === undefined) return
    const nextDrafts = drafts.map((entry, index) => index === current.index
      ? { selected: [], custom: '', skipped: true }
      : entry)
    setDrafts(nextDrafts)
    setError(undefined)
    if (current.index < question.questions.length - 1) {
      setQuestionIndex(current.index + 1)
      return
    }
    void send(answerBatchOf(question, nextDrafts))
  }

  const lastQuestion = current !== undefined && current.index === question.questions.length - 1

  return (
    <div className={css.interactionCard} data-plan={planQuestion !== undefined ? 'true' : undefined}>
      {/* The body scrolls on its own; the action row stays pinned at the
          card's bottom — a long plan/question can never push 确认/拒绝 (or
          the composer below) out of reach. One grammar for plan and ask. */}
      <div className={css.interactionCardBody}>
        {planQuestion !== undefined ? (
          <>
            <Chip kind="warn" title={t('review.planAwaiting')}>{t('review.planAwaiting')}</Chip>
            <span className={css.interactionQuestion}>{planQuestion.question}</span>
            {planQuestion.detail !== undefined && <span className={css.interactionDetail}>{planQuestion.detail}</span>}
            <span className={css.interactionAmend}>
              <PromptInput
                value={amend}
                onChange={setAmend}
                placeholder={t('review.interactionAmendPlaceholder')}
                rows={2}
                controller={controller}
                sessionId={sessionId}
              />
              <span className={css.detailHint}>{t('review.interactionAmendHint')}</span>
            </span>
          </>
        ) : current !== undefined ? (
          <>
            <Chip kind="warn" title={t('review.questionIndex', { n: String(current.index + 1), total: String(question.questions.length) })}>{t('review.questionIndex', { n: String(current.index + 1), total: String(question.questions.length) })}</Chip>
            <span className={css.interactionQuestion}>{current.item.question}</span>
            {current.item.detail !== undefined && <span className={css.interactionDetail}>{current.item.detail}</span>}
            {options.length > 0 && (
              <span className={css.interactionOptions}>
                {options.map((option: { label: string; description?: string }) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`${css.interactionOption}${drafts[current.index].selected.includes(option.label) ? ` ${css.interactionOptionOn}` : ''}`}
                    onClick={() => { toggleOption(option.label) }}
                  >
                    {option.label}
                  </button>
                ))}
              </span>
            )}
            <PromptInput
              value={drafts[current.index].custom ?? ''}
              onChange={next => { setCustom(next) }}
              placeholder={t('review.interactionTypePlaceholder')}
              rows={2}
              controller={controller}
              sessionId={sessionId}
            />
          </>
        ) : null}
      </div>
      {planQuestion !== undefined ? (
        <span className={css.interactionActions}>
          <Button variant="primary" disabled={busy} onClick={confirmPlan}>{t('review.planConfirm')}</Button>
          <Button variant="ghost" disabled={busy} onClick={declinePlan}>{t('review.planDecline')}</Button>
          <Button variant="ghost" disabled={busy} onClick={discussPlan}>{t('review.interactionDiscuss')}</Button>
        </span>
      ) : current !== undefined ? (
        <span className={css.interactionActions}>
          <Button variant="primary" disabled={busy} onClick={lastQuestion ? submitAnswers : nextQuestion}>
            {lastQuestion ? t('review.interactionSubmit') : t('review.interactionNext')}
          </Button>
          <Button variant="ghost" disabled={busy || current.index === 0} onClick={() => { setQuestionIndex(current.index - 1) }}>
            {t('review.interactionPrev')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={skipQuestion}>{t('review.interactionSkip')}</Button>
          <Button variant="ghost" disabled={busy} onClick={discussPlan}>{t('review.interactionAbandon')}</Button>
        </span>
      ) : null}
      {error !== undefined && <span className={css.detailHint}>{error}</span>}
    </div>
  )
}

/**
 * The 0.1.5 read-only mirror card: the full batch (every question, its
 * detail and its options as plain text — never as clickable answers) with
 * ONE action: navigate to the native session, where the official composer
 * settles the call. No draft state, no submit path, nothing that could race
 * the native answerer. Same chrome (card body + pinned action row) so the
 * rail geometry never diverges between hosts.
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
              <span key={item.id} className={css.interactionQuestion}>
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
