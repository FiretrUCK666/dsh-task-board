/**
 * Requirement refinement: the backlog task's AI-assisted research panel.
 *
 * A backlog task is a loose idea; one click starts a refine round in the
 * task's refine session (created lazily through the same session machinery
 * as executions and inheriting the task's run configuration — nothing extra
 * to configure). The AI researches with its own tools, asks the user
 * anything unclear (the board surfaces the wait read-only — answering stays
 * in the native session), and finally delivers a ready-to-run execution
 * prompt that the user applies onto the task with one button — nothing is
 * applied automatically.
 *
 * Layout: header (title + live status + view-session escape) above the
 * shared transcript tail (auto-follow + 滑到最新), then the answer bar
 * (input + send), then the apply action.
 */
import { useEffect, useMemo, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { refinable, refining, refineRoundsOf, type TaskRecord } from '../../core/tasks.ts'
import { isEnglish, t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { resultChipKind } from './session-chip.ts'
import { refineDraftKey, draftStore } from './drafts.ts'
import { AttachmentStrip, attachBusyLabel } from './AttachmentStrip.tsx'
import { COMMENT_IMAGE_BUDGET, MAX_COMMENT_IMAGES, toPromptFile, toPromptImage } from './attach.ts'
import { decodeCommentDraft, encodeCommentDraft, pickedHasFiles, useComposerImages } from './composer-images.ts'
import { useFileStager } from './session-panel.tsx'
import { PromptInput } from './PromptInput.tsx'
import { useSessionContext, useAwaitingCard } from './use-interaction.ts'
import { SessionContextBlock } from './SessionContextBlock.tsx'
import { InteractionCard } from './InteractionCard.tsx'
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
  // The open native interaction (plan confirm / question) + live to-do/goal/
  // subagents of the refine session.
  const context = useSessionContext(controller, sessionId)
  const pendingInteraction = useAwaitingCard(controller, sessionId)

  // 草稿记忆：回答框里打了一半的文字 + 已加的图，切走再回来仍保留（按任务
  // 各自保存）；发送成功即清除。切换任务时读对应任务的草稿。文件只留名
  // （字节不可恢复），回来显示重加提示。
  const [draft, setDraft] = useState<string>(() => decodeCommentDraft(draftStore.get(refineDraftKey(task.id))).text)
  const [applied, setApplied] = useState(false)
  const [unrestoredFiles, setUnrestoredFiles] = useState<string[]>(() =>
    decodeCommentDraft(draftStore.get(refineDraftKey(task.id))).fileNames)
  const [draftOversized, setDraftOversized] = useState(false)
  useEffect(() => {
    const restored = decodeCommentDraft(draftStore.get(refineDraftKey(task.id)))
    setDraft(restored.text)
    setUnrestoredFiles(restored.fileNames)
    setDraftOversized(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  // The live conversation: shared transcript-tail state (auto-follow +
  // 滑到最新), same mechanism as the review page.
  const { lines, error, atBottom, scrollRef, onScroll, jumpToBottom, reload, hasMore, loadingEarlier, loadEarlier } = useTranscriptTail(
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

  // The answer bar's attachment ledger (shared composer hook): pick / drop /
  // paste; images + staged files ride the answer into the refine session.
  // The file lane stages on the refine session (receipts are per-Agent).
  const stager = useFileStager(controller, sessionId)
  const attachments = useComposerImages(COMMENT_IMAGE_BUDGET, MAX_COMMENT_IMAGES, undefined,
    stager !== undefined && sessionId !== undefined ? { sessionId, stage: stager } : undefined)

  // Restore-once per task: images the draft kept come back as chips.
  useEffect(() => {
    const restored = decodeCommentDraft(draftStore.get(refineDraftKey(task.id)))
    if (restored.images.length > 0) attachments.setImages(restored.images)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  // ONE persist grammar (same as the comment composer): text + images +
  // staged file names land in the draft on every change.
  useEffect(() => {
    const { value, imagesDropped } = encodeCommentDraft(draft, attachments.images, attachments.files)
    draftStore.set(refineDraftKey(task.id), value)
    setDraftOversized(imagesDropped)
  }, [task.id, draft, attachments.images, attachments.files])

  const send = (): void => {
    const text = draft.trim()
    if (text === '') return
    const images = attachments.images
    const files = attachments.files.map(toPromptFile)
    if (controller.answerRefine(task.id, text,
      images.length > 0 ? images.map(toPromptImage) : undefined,
      files.length > 0 ? files : undefined)) {
      setDraft('')
      draftStore.clear(refineDraftKey(task.id))
      attachments.setImages([])
      attachments.setFiles([])
      setUnrestoredFiles([])
      setDraftOversized(false)
      setApplied(false)
    }
  }

  // Draft notices (same priority as the comment composer): oversized images
  // + files lost to an unmount (names only — re-add them).
  const draftNotice = draftOversized
    ? t('review.draftImagesDropped')
    : unrestoredFiles.length > 0
      ? t('review.draftFilesGone', { names: unrestoredFiles.slice(0, 3).join('、') })
      : undefined

  const apply = (): void => {
    if (resultText === undefined) return
    if (controller.applyRefineResult(task.id, resultText)) setApplied(true)
  }

  const idle = sessionId === undefined && !active

  return (
    // 「查看会话」住在区块标题行的 action 槽（与会话区/会话规则区同一文法），
    // 不再另起一条假标题行与 Section 头并列。
    <Section
      title={t('detail.refine')}
      className={css.refineSection}
      action={sessionId !== undefined ? (
        <Button size="sm" onClick={() => { controller.openSession(sessionId) }}>
          {t('detail.viewSession')} →
        </Button>
      ) : undefined}
    >

      {idle ? (
        <div className={css.refineIdle}>
          <p className={css.detailText}>{t('detail.refine.idleHint')}</p>
          {/* An all-blank task has nothing to research (the instruction is
              built from title/description/prompt) — launching would burn a
              run for an empty requirement. Disabled with the reason on the
              line, never a silent dead button. */}
          <Button
            variant="primary"
            disabled={!refinable(task)}
            title={!refinable(task) ? t('detail.refine.emptyHint') : undefined}
            onClick={() => { controller.startRefine(task.id, isEnglish()) }}
          >
            {t('detail.refine.start')}
          </Button>
          {!refinable(task) && (
            <p className={css.detailHint}>{t('detail.refine.emptyHint')}</p>
          )}
        </div>
      ) : (
        <>
          {/* 状态行：状态徽章 + 轮次数（区块动作已上提标题行） */}
          <div className={css.refineHeader}>
            {active ? (
              <Chip kind="warn">
                {waiting !== undefined ? t('review.waiting') : t('detail.result.running')}
              </Chip>
            ) : lastRound === undefined ? (
              /* A bound refine session with no settled round yet: its own
                 neutral state — never a guessed "成功". */
              <Chip kind="muted">{t('detail.refine.noResult')}</Chip>
            ) : (
              <Chip kind={resultChipKind(lastRound.result)}>
                {lastRound.result === 'failed' ? t('detail.result.failed') : t('detail.result.succeeded')}
              </Chip>
            )}
            <span className={css.refineRounds}>{t('detail.refine.rounds', { n: String(rounds.length) })}</span>
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
                hasMore={hasMore}
                loadingEarlier={loadingEarlier}
                onLoadEarlier={loadEarlier}
                onRetry={reload}
                sessionId={sessionId}
                controller={controller}
              />
            </div>
          </div>

          {/* 等待通知 */}
          {active && <SessionWaitingNotice waiting={waiting} />}

          {/* 输入区域：与评论/会话面板完全同一套 composer（PromptInput：斜杠补全、
              自动增高、草稿记忆），同一套图片 ledger（选/拖/粘 + 就近拒绝原因），
              发送按钮保持。 */}
          <div className={css.refineInputArea} {...attachments.dropProps}>
            {(pendingInteraction.question !== undefined || pendingInteraction.shell !== undefined) && sessionId !== undefined && (
              <InteractionCard
                key={pendingInteraction.question !== undefined ? pendingInteraction.question.rpcId : `shell-${sessionId}`}
                question={pendingInteraction.question}
                shellWaiting={pendingInteraction.shell}
                sessionId={sessionId}
                controller={controller}
              />
            )}
            {sessionId !== undefined && (
              <SessionContextBlock context={context} sessionId={sessionId} controller={controller} />
            )}
            <PromptInput
              value={draft}
              onChange={next => { setDraft(next) }}
              placeholder={t('detail.refine.answerPlaceholder')}
              rows={3}
              controller={controller}
              sessionId={sessionId}
            />
            <AttachmentStrip
              images={attachments.images}
              files={attachments.files}
              onAdd={files => {
                if (pickedHasFiles(files)) setUnrestoredFiles([])
                void attachments.addFiles(files)
              }}
              onRemoveImage={id => { attachments.setImages(attachments.images.filter(image => image.id !== id)) }}
              onRemoveFile={id => { attachments.setFiles(attachments.files.filter(file => file.id !== id)) }}
              busy={attachments.busy}
              busyLabel={attachments.busy ? attachBusyLabel(attachments.busyKind) : undefined}
              error={attachments.error ?? draftNotice}
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
