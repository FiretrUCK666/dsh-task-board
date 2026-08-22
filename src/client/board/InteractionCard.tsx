/**
 * Pending native-interaction card: the plan/question the session's agent is
 * waiting on, rendered over the composer so the user answers in place.
 *
 * The card is driven by the mux tracker (WireQuestion) — answers flow through
 * the same `respond` wire call the native composer uses, so submitting really
 * settles the suspended ask_user_question (a plain comment never resolves
 * it). The grammar mirrors the native flow: an ask walks its questions with
 * 上一题/下一题/跳过本题/提交/放弃整组; a plan review shows the plan with
 * 确认执行/拒绝 (amendments = a revise-with-feedback custom answer)/
 * 去聊天里说 (= cancel). The card disappears when the host resolves the
 * call (question/resolved frame).
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
            <span className={css.chip} data-kind="warn">{t('review.planAwaiting')}</span>
            <span className={css.interactionQuestion}>{planQuestion.question}</span>
            {planQuestion.detail !== undefined && <span className={css.interactionDetail}>{planQuestion.detail}</span>}
            <span className={css.interactionAmend}>
              <input
                className={css.input}
                value={amend}
                placeholder={t('review.interactionAmendPlaceholder')}
                onChange={event => { setAmend(event.target.value) }}
              />
              <span className={css.detailHint}>{t('review.interactionAmendHint')}</span>
            </span>
          </>
        ) : current !== undefined ? (
          <>
            <span className={css.chip} data-kind="warn">{t('review.questionIndex', { n: String(current.index + 1), total: String(question.questions.length) })}</span>
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
            <input
              className={css.input}
              value={drafts[current.index].custom ?? ''}
              placeholder={t('review.interactionTypePlaceholder')}
              onChange={event => { setCustom(event.target.value) }}
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
