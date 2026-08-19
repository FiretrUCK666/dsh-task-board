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
import { useEffect, useMemo, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { refining, refineRoundsOf, type TaskRecord } from '../../core/tasks.ts'
import { isEnglish, t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { refineDraftKey, draftStore } from './drafts.ts'
import { PromptInput } from './PromptInput.tsx'
import { useTranscriptTail } from './use-transcript.tsx'
import { SessionTranscript, SessionWaitingNotice } from './session-panel.tsx'
import { Button, Section } from './ui.tsx'

export function RefineSection({ controller, task }: {
  controller: BoardController
  task: TaskRecord
}) {
  const sessionId = task.refineSessionId
  const active = refining(task)
  const rounds = refineRoundsOf(task)
  const lastRound = rounds[rounds.length - 1]
  const waiting = controller.pendingInteractionOf(sessionId)

  // 草稿记忆：回答框里打了一半的文字，切走再回来仍保留（按任务各自保存）；
  // 发送成功即清除。切换任务时读对应任务的草稿。
  const [draft, setDraft] = useState<string>(() => draftStore.get(refineDraftKey(task.id)) ?? '')
  const [applied, setApplied] = useState(false)
  useEffect(() => {
    setDraft(draftStore.get(refineDraftKey(task.id)) ?? '')
  }, [task.id])

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
      draftStore.clear(refineDraftKey(task.id))
      setApplied(false)
    }
  }

  const apply = (): void => {
    if (resultText === undefined) return
    if (controller.applyRefineResult(task.id, resultText)) setApplied(true)
  }

  const idle = sessionId === undefined && !active

  return (
    <Section title={t('detail.refine')} className={css.refineSection}>

      {idle ? (
        <div className={css.refineIdle}>
          <p className={css.detailText}>{t('detail.refine.idleHint')}</p>
          <Button variant="primary" onClick={() => { controller.startRefine(task.id, isEnglish()) }}>
            {t('detail.refine.start')}
          </Button>
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
              <Button size="sm" onClick={() => { controller.openSession(sessionId) }}>
                {t('detail.viewSession')} →
              </Button>
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
              <SessionTranscript
                lines={lines}
                error={error}
                atBottom={atBottom}
                jumpToBottom={jumpToBottom}
                maxLines={12}
              />
            </div>
          </div>

          {/* 等待通知 */}
          {active && <SessionWaitingNotice waiting={waiting} />}

          {/* 输入区域：与评论/会话面板完全同一套 composer（PromptInput：斜杠补全、
              自动增高、草稿记忆），发送按钮保持。 */}
          <div className={css.refineInputArea}>
            <PromptInput
              value={draft}
              onChange={next => {
                setDraft(next)
                draftStore.set(refineDraftKey(task.id), next)
              }}
              placeholder={t('detail.refine.answerPlaceholder')}
              rows={3}
              controller={controller}
            />
            <Button variant="primary" disabled={draft.trim() === ''} onClick={send}>
              {t('detail.refine.send')}
            </Button>
          </div>

          {/* 操作区域：应用到任务按钮 */}
          <div className={css.refineActionArea}>
            <Button
              variant="primary"
              className={css.refineApplyButton}
              disabled={resultText === undefined}
              title={resultText === undefined ? t('detail.refine.noResult') : undefined}
              onClick={apply}
            >
              {t('detail.refine.apply')}
            </Button>
            {applied && <span className={css.detailHint}>{t('detail.refine.applied')}</span>}
          </div>
        </>
      )}
    </Section>
  )
}
