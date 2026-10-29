/**
 * One turn's render: 触发气泡 →（按策略）过程折行 → 折外回复。
 *
 * ── 折叠记号的来源 ──────────────────────────────────────────────────────────
 *
 * 折行用的是共享的 `Disclosure`，它的折叠记号只认祖先的 `aria-expanded`
 * （`verify-fold-mark.mjs` 守着这件事），所以这里不写任何旋转规则。
 *
 * ── 「永不折」的四条边界在 `work-steps.ts` 里 ────────────────────────────────
 *
 * 本文件只负责把它判出来的结果画出来：还在跑的轮、读者插过话的轮、结束得不干净的
 * 轮、以及 `next-input` 时机下最新那一轮——都摊着。判据不在这里，所以两处不会
 * 各判一次而打架。
 */
import { memo } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { Disclosure } from '../design/ui.tsx'
import { t } from '../locales.ts'
import css from '../board.module.css'
import components from '../design/components.module.css'
import { finalReplyOf, foldSummaryOf, shapeOfWorkSteps, shouldFoldTurn, type WorkStepsPrefs, type WorkStepsShape } from './work-steps.ts'
import type { TranscriptImage, TranscriptStep, TranscriptTurn } from './review-transcript.ts'
import { MessageImages } from './message-image.tsx'
import { Markdown } from './Markdown.tsx'

/** 折行标题用到的词；由调用方从词表取，判据本身不读词表（因此可单测）。 */
const WORDS = {
  tools: (n: number) => t('review.stepsTools', { n: String(n) }),
  reasoning: (n: number) => t('review.stepsReasoning', { n: String(n) }),
  context: (n: number) => t('review.stepsContext', { n: String(n) }),
  running: (name: string) => t('review.stepsRunning', { name }),
  completed: t('review.stepsCompleted'),
}

/** 一条过程行：工具 / 思考 / 上下文，各一行，语法一致（弱色、可扫读）。 */
function StepRow({ step }: { step: TranscriptStep }) {
  if (step.kind === 'tool') {
    return (
      <li className={css.reviewStep} data-state={step.state}>
        <span className={`${css.reviewStepName} ${components.truncate}`}>{step.name}</span>
        <span className={css.reviewStepState}>
          {t(step.state === 'running' ? 'review.stepRunning'
            : step.state === 'unsettled' ? 'review.stepUnsettled' : 'review.stepSettled')}
        </span>
      </li>
    )
  }
  if (step.kind === 'reasoning') {
    return (
      <li className={css.reviewStep} title={step.preview}>
        <span className={`${css.reviewStepName} ${components.truncate}`}>{t('review.stepThought')}</span>
        <span className={css.reviewStepState}>{t('review.stepChars', { n: String(step.chars) })}</span>
      </li>
    )
  }
  return (
    <li className={css.reviewStep} title={step.summary}>
      <span className={`${css.reviewStepName} ${components.truncate}`}>{t('review.contextInjection')}</span>
      <span className={css.reviewStepState}>{step.producer}</span>
    </li>
  )
}

/** 一条助手回复（图片在上、正文在下——与用户气泡同一条内部语法）。 */
function Reply({ text, images, sessionId, controller }: {
  text: string
  images?: readonly TranscriptImage[]
  sessionId?: string
  controller?: BoardController
}) {
  return (
    <>
      <MessageImages images={images} sessionId={sessionId} controller={controller} />
      {text !== '' && (
        <div className={css.reviewMessageText}>
          <Markdown text={text} />
        </div>
      )}
    </>
  )
}

/** 一条过程行的稳定 key（工具用 callId，思考与上下文用自己拼的 id）。 */
function stepKeyOf(step: TranscriptStep): string {
  return step.kind === 'tool' ? `t:${step.id}` : step.kind === 'reasoning' ? step.id : `c:${step.id}`
}

/**
 * 一轮对话。
 *
 * 折与不折由 `shouldFoldTurn` 判，**不在这里再判一次**：判据只有一个家，
 * 两处各判一次就会在某个组合下互相打架，而屏上看起来只是「有时候不折」。
 */
export const TurnItem = memo(function TurnItem(props: {
  turn: TranscriptTurn
  shape: WorkStepsShape
  /** 它是不是最新那一轮（`next-input` 时机要用）。 */
  isLatest: boolean
  /** 读者把这一折点开了吗（由 `SessionTranscript` 记，跨重渲染保持）。 */
  open: boolean
  onToggle: () => void
  sessionId?: string
  controller?: BoardController
}) {
  const { turn, shape, sessionId, controller } = props
  const folded = shouldFoldTurn(turn, shape, {
    isLatest: props.isLatest,
    hasReaderTurn: turn.interjections.length > 0,
  })
  const finalReply = finalReplyOf(turn)
  /* `all` 档把中途回复也露在折外；`final` 档只有最后那一条。 */
  const visibleReplies = shape.keepAllReplies ? turn.replies : finalReply === undefined ? [] : [finalReply]
  const hiddenReplies = turn.replies.filter(reply => !visibleReplies.includes(reply))
  return (
    <li className={css.reviewTurn}>
      {turn.trigger !== undefined && (
        <div className={css.reviewMessage} data-role="user">
          <Reply text={turn.trigger.text} images={turn.trigger.images} sessionId={sessionId} controller={controller} />
        </div>
      )}
      {folded ? (
        <>
          <Disclosure
            title={foldSummaryOf(turn, shape, WORDS)}
            open={props.open}
            onToggle={props.onToggle}
            className={css.reviewWorkSteps}
          >
            <ul className={css.reviewStepList}>
              {/* 折里先画过程，再画那些「没露在折外」的回复——顺序就是发生的顺序，
                  而中途那几句在 `final` 档里正是读者选「只留最后一段」时要求收起来的东西。 */}
              {turn.steps.map(step => <StepRow key={stepKeyOf(step)} step={step} />)}
              {hiddenReplies.map(reply => (
                <li key={reply.id} className={css.reviewStepReply}>
                  <Reply text={reply.text} images={reply.images} sessionId={sessionId} controller={controller} />
                </li>
              ))}
            </ul>
          </Disclosure>
          {visibleReplies.map(reply => (
            <div key={reply.id} className={css.reviewMessage} data-role="assistant">
              <Reply text={reply.text} images={reply.images} sessionId={sessionId} controller={controller} />
            </div>
          ))}
        </>
      ) : (
        <>
          {turn.steps.length > 0 && (
            <ul className={css.reviewStepList}>
              {turn.steps.map(step => <StepRow key={stepKeyOf(step)} step={step} />)}
            </ul>
          )}
          {turn.replies.map(reply => (
            <div key={reply.id} className={css.reviewMessage} data-role="assistant">
              <Reply text={reply.text} images={reply.images} sessionId={sessionId} controller={controller} />
            </div>
          ))}
        </>
      )}
    </li>
  )
})

/**
 * 一组轮：把折法算一次，逐轮画。
 *
 * 每轮的折开状态存在这里（`Set<turn>`），因为它是**读者这一次看的时候的选择**，
 * 不是会话数据：重新读一次尾窗口不该把读者点开的折又合上。
 */
export const TurnList = memo(function TurnList(props: {
  turns: readonly TranscriptTurn[]
  prefs: WorkStepsPrefs
  sessionId?: string
  controller?: BoardController
  openTurns: ReadonlySet<number>
  onToggle: (turn: number) => void
}) {
  const shape = shapeOfWorkSteps(props.prefs)
  return (
    <ul className={css.reviewTranscript}>
      {props.turns.map((turn, index) => (
        <TurnItem
          key={turn.turn}
          turn={turn}
          shape={shape}
          isLatest={index === props.turns.length - 1}
          open={props.openTurns.has(turn.turn)}
          onToggle={() => props.onToggle(turn.turn)}
          sessionId={props.sessionId}
          controller={props.controller}
        />
      ))}
    </ul>
  )
})