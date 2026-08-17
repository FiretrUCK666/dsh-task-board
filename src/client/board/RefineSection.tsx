/**
 * Requirement refinement: the backlog task's AI-assisted research panel.
 *
 * A backlog task is a loose idea; one click starts a refine round in the
 * task's refine session (created lazily through the same session machinery
 * as executions and inheriting the task's run configuration — nothing extra
 * to configure). The AI researches with its own tools, asks the user
 * anything unclear (the board surfaces the wait and the user answers right
 * here), and finally delivers a ready-to-run execution prompt that the user
 * applies onto the task with one button — nothing is applied automatically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BoardController, TranscriptEventShape } from '../../core/controller.ts'
import { refining, refineRoundsOf, type TaskRecord } from '../../core/tasks.ts'
import { isEnglish, t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { PromptInput } from './PromptInput.tsx'
import { TranscriptRow } from './ReviewDetail.tsx'
import { foldTranscript, type TranscriptLine } from './review-transcript.ts'

/** The watermark of a loaded result (tail seq; 0 when empty). */
function watermarkOf(result: { events: readonly TranscriptEventShape[] }): number {
  const tail = result.events[result.events.length - 1]
  return tail?.seq ?? result.events.length
}

export function RefineSection({ controller, task }: {
  controller: BoardController
  task: TaskRecord
}) {
  const sessionId = task.refineSessionId
  const active = refining(task)
  const rounds = refineRoundsOf(task)
  const lastRound = rounds[rounds.length - 1]
  const waiting = controller.pendingInteractionOf(sessionId)

  const [lines, setLines] = useState<readonly TranscriptLine[] | undefined>(undefined)
  const [transcriptError, setTranscriptError] = useState(false)
  const [draft, setDraft] = useState('')
  const [applied, setApplied] = useState(false)
  const watermarkRef = useRef<number | undefined>(undefined)

  const load = useCallback((): void => {
    if (sessionId === undefined) return
    void controller.loadTranscript(sessionId).then(result => {
      if (result === undefined) {
        setTranscriptError(true)
        return
      }
      setTranscriptError(false)
      watermarkRef.current = watermarkOf(result)
      setLines(foldTranscript(result.events))
    })
  }, [controller, sessionId])

  // Load on open/session change; the light poll keeps the conversation and
  // the waiting state live while the section is mounted (watermark-gated).
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (sessionId === undefined) return
    const timer = setInterval(() => {
      void controller.loadTranscript(sessionId).then(result => {
        if (result === undefined || watermarkRef.current === watermarkOf(result)) return
        watermarkRef.current = watermarkOf(result)
        setTranscriptError(false)
        setLines(foldTranscript(result.events))
      })
    }, 3_000)
    return () => { clearInterval(timer) }
  }, [controller, sessionId])

  // The refinement result = the latest assistant message of the conversation
  // (the template makes the final prompt the closing turn).
  const resultText = useMemo(() => {
    if (lines === undefined) return undefined
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]
      if (line.kind === 'message' && line.role === 'assistant' && line.text.trim() !== '') return line.text
    }
    return undefined
  }, [lines])

  const send = (): void => {
    const text = draft.trim()
    if (text === '') return
    if (controller.answerRefine(task.id, text)) {
      setDraft('')
      setApplied(false)
    }
  }

  const apply = (): void => {
    if (resultText === undefined) return
    if (controller.applyRefineResult(task.id, resultText)) setApplied(true)
  }

  const idle = sessionId === undefined && !active

  return (
    <section className={css.detailSection}>
      <h4>{t('detail.refine')}</h4>

      {idle ? (
        <>
          <p className={css.detailText}>{t('detail.refine.idleHint')}</p>
          <span className={css.moveRow}>
            <button
              type="button"
              className={css.primaryButton}
              onClick={() => { controller.startRefine(task.id, isEnglish()) }}
            >
              {t('detail.refine.start')}
            </button>
          </span>
        </>
      ) : (
        <>
          <span className={css.refineStatusRow}>
            {active ? (
              <Chip kind="warn">
                {waiting !== undefined ? t('review.waiting') : t('detail.result.running')}
              </Chip>
            ) : (
              <Chip kind={lastRound?.result === 'failed' ? 'error' : 'success'}>
                {lastRound?.result === 'failed' ? t('detail.result.failed') : t('detail.result.succeeded')}
              </Chip>
            )}
            <span className={css.refineRounds}>{t('detail.refine.rounds', { n: String(rounds.length) })}</span>
          </span>

          {lastRound?.result === 'failed' && lastRound.error !== undefined && lastRound.error !== '' && (
            <span className={css.executionError}>{lastRound.error}</span>
          )}

          {transcriptError ? (
            <p className={css.detailText}>{t('review.transcriptUnavailable')}</p>
          ) : lines === undefined || lines.length === 0 ? (
            <p className={css.detailText}>{t('review.loading')}</p>
          ) : (
            <ul className={`${css.reviewTranscript} ${css.refineTail}`}>
              {lines.slice(-8).map(line => line.kind === 'context' ? (
                <TranscriptRow key={line.id} kind="context" plugin={line.plugin} summary={line.summary} />
              ) : (
                <TranscriptRow key={line.id} kind="message" role={line.role} text={line.text} />
              ))}
            </ul>
          )}

          {active && waiting !== undefined && (
            <p className={css.detailText}>
              {t('review.waitingTitle', { kind: t(`waiting.${waiting}` as 'waiting.approval') })}
            </p>
          )}

          <div className={css.refineAnswerRow}>
            <PromptInput
              value={draft}
              onChange={setDraft}
              placeholder={t('detail.refine.answerPlaceholder')}
              rows={1}
              controller={controller}
            />
            <button type="button" className={css.primaryButton} disabled={draft.trim() === ''} onClick={send}>
              {t('detail.refine.send')}
            </button>
          </div>

          <span className={css.moveRow}>
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
              className={css.primaryButton}
              disabled={resultText === undefined}
              title={resultText === undefined ? t('detail.refine.noResult') : undefined}
              onClick={apply}
            >
              {t('detail.refine.apply')}
            </button>
          </span>
          {applied && <p className={css.detailHint}>{t('detail.refine.applied')}</p>}
        </>
      )}
    </section>
  )
}
