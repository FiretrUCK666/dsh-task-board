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
 *
 * Layout: header (title + live status + view-session escape) above the
 * shared transcript tail (auto-follow + 滑到最新), then the answer bar
 * (input + send), then the apply action.
 */
import { useMemo, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { refining, refineRoundsOf, type TaskRecord } from '../../core/tasks.ts'
import { isEnglish, t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { PromptInput } from './PromptInput.tsx'
import { TranscriptRow } from './ReviewDetail.tsx'
import { JumpToLatest, useTranscriptTail } from './use-transcript.tsx'

export function RefineSection({ controller, task }: {
  controller: BoardController
  task: TaskRecord
}) {
  const sessionId = task.refineSessionId
  const active = refining(task)
  const rounds = refineRoundsOf(task)
  const lastRound = rounds[rounds.length - 1]
  const waiting = controller.pendingInteractionOf(sessionId)

  const [draft, setDraft] = useState('')
  const [applied, setApplied] = useState(false)

  // The live conversation: shared transcript-tail state (auto-follow +
  // 滑到最新), same mechanism as the review page.
  const { lines, error, atBottom, scrollRef, onScroll, jumpToBottom } = useTranscriptTail(
    controller,
    sessionId,
    rounds.length,
  )

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
    <section className={`${css.detailSection} ${css.refineSection}`}>
      <h4>{t('detail.refine')}</h4>

      {idle ? (
        <div className={css.refineIdle}>
          <p className={css.detailText}>{t('detail.refine.idleHint')}</p>
          <button
            type="button"
            className={css.primaryButton}
            onClick={() => { controller.startRefine(task.id, isEnglish()) }}
          >
            {t('detail.refine.start')}
          </button>
        </div>
      ) : (
        <>
          {/* 头部信息：状态徽章 + 轮次数 + 查看会话按钮 */}
          <div className={css.refineHeader}>
            <div className={css.refineHeaderLeft}>
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
            </div>
            {sessionId !== undefined && (
              <button
                type="button"
                className={css.ghostButton}
                onClick={() => { controller.openSession(sessionId) }}
              >
                {t('detail.viewSession')} →
              </button>
            )}
          </div>

          {/* 错误提示 */}
          {lastRound?.result === 'failed' && lastRound.error !== undefined && lastRound.error !== '' && (
            <span className={css.executionError}>{lastRound.error}</span>
          )}

          {/* 对话区域 */}
          <div
            className={css.refineTranscriptArea}
            ref={scrollRef}
            onScroll={onScroll}
          >
            <div className={css.refineTail}>
              {error ? (
                <p className={css.detailText}>{t('review.transcriptUnavailable')}</p>
              ) : lines === undefined ? (
                <p className={css.detailText}>{t('review.loading')}</p>
              ) : lines.length === 0 ? (
                <p className={css.detailText}>{t('review.transcriptEmpty')}</p>
              ) : (
                <ul className={css.reviewTranscript}>
                  {lines.slice(-12).map(line => line.kind === 'context' ? (
                    <TranscriptRow key={line.id} kind="context" plugin={line.plugin} summary={line.summary} />
                  ) : (
                    <TranscriptRow key={line.id} kind="message" role={line.role} text={line.text} />
                  ))}
                </ul>
              )}
              <JumpToLatest atBottom={atBottom} onJump={jumpToBottom} />
            </div>
          </div>

          {/* 等待通知 */}
          {active && waiting !== undefined && (
            <div className={css.waitingNotice} role="status">
              <Chip kind="warn" fill={false}>{t('review.waiting')}</Chip>
              <span>
                {t('review.waitingTitle', { kind: t(`waiting.${waiting}` as 'waiting.approval') })}
              </span>
            </div>
          )}

          {/* 输入区域：文本框 + 发送按钮（上下布局） */}
          <div className={css.refineInputArea}>
            <textarea
              className={css.refineTextarea}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('detail.refine.answerPlaceholder')}
            />
            <button
              type="button"
              className={css.primaryButton}
              disabled={draft.trim() === ''}
              onClick={send}
            >
              {t('detail.refine.send')}
            </button>
          </div>

          {/* 操作区域：应用到任务按钮 */}
          <div className={css.refineActionArea}>
            <button
              type="button"
              className={`${css.primaryButton} ${css.refineApplyButton}`}
              disabled={resultText === undefined}
              title={resultText === undefined ? t('detail.refine.noResult') : undefined}
              onClick={apply}
            >
              {t('detail.refine.apply')}
            </button>
            {applied && <span className={css.detailHint}>{t('detail.refine.applied')}</span>}
          </div>
        </>
      )}
    </section>
  )
}
