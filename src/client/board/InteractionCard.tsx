/**
 * Pending native-interaction card: the plan/question the session's agent is
 * waiting on, rendered over the composer so the user answers in place —
 * exactly the native plan-review / ask flow, without any slash command. One
 * grammar for both: a plan-review shows its plan plus 确认/拒绝 (+ typing to
 * amend); a question shows its options as tappable choices plus free typing,
 * with 下一题/跳过 for multi-question asks. Sending an answer is a normal
 * comment through the existing steer channel, so the agent reads it as plain
 * typing in the native chat.
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { assembleAnswers, PLAN_DECLINE_TEMPLATE, planConfirmText, type InteractionQuestion, type PendingInteraction } from './interaction.ts'
import { Button } from './ui.tsx'

/** The interaction card (see module doc). Renders nothing while idle. */
export function InteractionCard({ interaction, taskId, sessionId, controller }: {
  interaction: PendingInteraction
  /** The task owning the session (target of the steer comment). */
  taskId: string
  sessionId: string
  controller: BoardController
}) {
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selections, setSelections] = useState<Array<{ selected: string[]; custom?: string }>>(() =>
    interaction.questions.map(() => ({ selected: [] })),
  )
  const [amend, setAmend] = useState<string>('')

  const send = async (text: string): Promise<void> => {
    await controller.steerComment(taskId, sessionId, text)
  }

  const confirm = (): void => {
    void send(planConfirmText(interaction))
  }

  const decline = (): void => {
    const text = PLAN_DECLINE_TEMPLATE.replace('{reason}', amend.trim() === '' ? t('review.interactionDeclineShort') : amend.trim())
    void send(text)
  }

  // Plan review shows the plan question itself; an ask flow walks its list.
  const planQuestion: InteractionQuestion | undefined = interaction.isPlanReview
    ? interaction.questions.find(question => question.intent?.kind === 'plan-review')
    : undefined
  const current: { question: InteractionQuestion; index: number } | undefined = interaction.isPlanReview
    ? undefined
    : { question: interaction.questions[questionIndex], index: questionIndex }
  const options = current !== undefined ? (current.question.options ?? []) : (planQuestion?.options ?? [])

  const toggleOption = (label: string): void => {
    setSelections(previous => previous.map((entry, index) => {
      if (index !== questionIndex) return entry
      if (current?.question.multiSelect === true) {
        return { ...entry, selected: entry.selected.includes(label)
          ? entry.selected.filter(item => item !== label)
          : [...entry.selected, label] }
      }
      return { ...entry, selected: [label] }
    }))
  }

  const setCustom = (text: string): void => {
    setSelections(previous => previous.map((entry, index) => index === questionIndex ? { ...entry, custom: text } : entry))
  }

  const nextQuestion = (): void => {
    if (current === undefined) return
    if (current.index < interaction.questions.length - 1) setQuestionIndex(current.index + 1)
  }

  const submitAnswers = (): void => {
    void send(assembleAnswers(selections.map((entry, index) => ({
      id: interaction.questions[index]?.id ?? String(index),
      selected: entry.selected,
      custom: entry.custom,
    }))))
  }

  const lastQuestion = current !== undefined && current.index === interaction.questions.length - 1
  const declineRejected = amend.trim() === '' // empty reason: fall back to short text

  return (
    <div className={css.interactionCard} data-plan={interaction.isPlanReview ? 'true' : undefined}>
      {planQuestion !== undefined ? (
        <>
          <span className={css.chip} data-kind="warn">{t('review.planAwaiting')}</span>
          <span className={css.interactionQuestion}>{planQuestion.question}</span>
          {planQuestion.detail !== undefined && <span className={css.interactionDetail}>{planQuestion.detail}</span>}
          <span className={css.interactionActions}>
            <Button variant="primary" onClick={confirm}>{t('review.planConfirm')}</Button>
            <Button variant="ghost" onClick={decline} disabled={declineRejected}>{t('review.planDecline')}</Button>
          </span>
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
          <span className={css.chip} data-kind="warn">{t('review.questionIndex', { n: String(current.index + 1), total: String(interaction.questions.length) })}</span>
          <span className={css.interactionQuestion}>{current.question.question}</span>
          {current.question.detail !== undefined && <span className={css.interactionDetail}>{current.question.detail}</span>}
          {options.length > 0 && (
            <span className={css.interactionOptions}>
              {options.map((option: { label: string; description?: string }) => (
                <button
                  key={option.label}
                  type="button"
                  className={`${css.interactionOption}${selections[current.index].selected.includes(option.label) ? ` ${css.interactionOptionOn}` : ''}`}
                  onClick={() => { toggleOption(option.label) }}
                >
                  {option.label}
                </button>
              ))}
            </span>
          )}
          <input
            className={css.input}
            value={selections[current.index].custom ?? ''}
            placeholder={t('review.interactionTypePlaceholder')}
            onChange={event => { setCustom(event.target.value) }}
          />
          <span className={css.interactionActions}>
            {!lastQuestion ? (
              <Button variant="ghost" onClick={nextQuestion}>{t('review.interactionNext')}</Button>
            ) : (
              <Button variant="primary" onClick={submitAnswers}>{t('review.interactionSubmit')}</Button>
            )}
            <Button variant="ghost" onClick={() => { if (current.index > 0) setQuestionIndex(current.index - 1) }} disabled={current.index === 0}>
              {t('review.interactionPrev')}
            </Button>
          </span>
        </>
      ) : null}
    </div>
  )
}
