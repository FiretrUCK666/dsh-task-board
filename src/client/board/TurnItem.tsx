/**
 * 一轮的渲染：触发气泡 → 过程（按策略折或摊）→ 折外回复。
 *
 * ── 顺序由 `order` 决定，不由「先摆哪一类」决定 ──────────────────────────────
 *
 * 过程行、中途回复、读者插话**按真实发生的次序**排成一条流（`flowOf`）。曾经的排法是
 * 「先摆完所有工具、再摆所有话」，于是长轮看起来是「四十行堆在上面、两句话接在下面」，
 * 而真实发生的是「思考 → 调工具 → 说一句 → 再调工具」——顺序不是排错了，是**没有排序**。
 *
 * ── 折叠记号的来源 ──────────────────────────────────────────────────────────
 *
 * 折行用的是共享的 `Disclosure`，它的折叠记号只认祖先的 `aria-expanded`
 * （`verify-fold-mark.mjs` 守着这件事），所以这里不写任何旋转规则。
 *
 * ── 判据都在 `work-steps.ts` 里 ─────────────────────────────────────────────
 *
 * 本文件只把它判出来的结果画出来：还在跑的轮、读者插过话的轮、结束得不干净的轮、
 * 以及 `next-input` 时机下最新那一轮——都摊着。判据不在这里，所以两处不会各判一次而打架。
 */
import { memo } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { Disclosure } from '../design/ui.tsx'
import { t } from '../locales.ts'
import css from '../board.module.css'
import components from '../design/components.module.css'
import {
  flowOf as flowOfTurn, foldedRepliesOf, foldKeyOf, foldSummaryOf, groupsSteps,
  policyOfWorkSteps, shouldFoldTurn, visibleRepliesOf,
  type WorkStepsPolicy, type WorkStepsPrefs,
} from './work-steps.ts'
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
function StepRow({ step, policy }: { step: TranscriptStep; policy: WorkStepsPolicy }) {
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
    /* 结算后的思考给首行预览（`settledReasoningPreview`）：只报字数时读者读不出
       「它在想哪件事」，而这块屏上正是他判断要不要点开折的那一眼。 */
    return (
      <li className={css.reviewStep} title={step.preview}>
        <span className={`${css.reviewStepName} ${components.truncate}`}>
          {policy.settledReasoningPreview && step.preview !== ''
            ? `${t('review.stepThought')} · ${step.preview}`
            : t('review.stepThought')}
        </span>
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

/** 读者中途插的一句话。它必须**看得见**：那一轮因此永不折，折掉了读者的话是最糟的读法。 */
function ReaderSay({ text, images, sessionId, controller }: {
  text: string
  images?: readonly TranscriptImage[]
  sessionId?: string
  controller?: BoardController
}) {
  return (
    <div className={css.reviewMessage} data-role="user">
      <Reply text={text} images={images} sessionId={sessionId} controller={controller} />
    </div>
  )
}

/** 一条过程行的稳定 key（工具用 callId，思考与上下文用自己拼的 id）。 */
function stepKeyOf(step: TranscriptStep): string {
  return step.kind === 'tool' ? `t:${step.id}` : step.kind === 'reasoning' ? step.id : `c:${step.id}`
}

/** 折里的一行：过程行或一条被收起来的中途回复。 */
function FoldedRow({ item, policy, sessionId, controller }: {
  item: ReturnType<typeof flowOfTurn>[number]
  policy: WorkStepsPolicy
  sessionId?: string
  controller?: BoardController
}) {
  if (item.kind === 'step') return <StepRow step={item.step} policy={policy} />
  if (item.kind === 'reader') {
    return (
      <li className={css.reviewStepReply}>
        <ReaderSay text={item.interjection.text} images={item.interjection.images} sessionId={sessionId} controller={controller} />
      </li>
    )
  }
  return (
    <li className={css.reviewStepReply}>
      <Reply text={item.reply.text} images={item.reply.images} sessionId={sessionId} controller={controller} />
    </li>
  )
}

/**
 * 一轮对话。
 *
 * 折与不折由 `shouldFoldTurn` 判，**不在这里再判一次**：判据只有一个家，
 * 两处各判一次就会在某个组合下互相打架，而屏上看起来只是「有时候不折」。
 */
export const TurnItem = memo(function TurnItem(props: {
  turn: TranscriptTurn
  policy: WorkStepsPolicy
  /** 它是不是最新那一轮（`next-input` 时机要用）。 */
  isLatest: boolean
  /** 读者把这一折点开了吗（由 `SessionTranscript` 记，跨重渲染保持）。 */
  open: boolean
  onToggle: () => void
  sessionId?: string
  controller?: BoardController
}) {
  const { turn, policy, sessionId, controller } = props
  const folded = shouldFoldTurn(turn, policy, {
    isLatest: props.isLatest,
    hasReaderTurn: turn.interjections.length > 0,
  })
  const visible = visibleRepliesOf(turn, policy)
  const hidden = foldedRepliesOf(turn, policy)
  const visibleIds = new Set(visible.map(reply => reply.id))
  const hiddenIds = new Set(hidden.map(reply => reply.id))
  /* 折里那一行：过程行按真实次序，中途回复（`final` 档才进折）夹在它发生的位置上。 */
  const foldRows = [
    ...flowOfTurn(turn).filter(item => item.kind === 'step'
      || (item.kind === 'reply' && hiddenIds.has(item.reply.id))),
    /* 折里的插话不会走到这里（有插话的轮永不折），但保持它可画：宁可多一行，不可吞一句。 */
    ...flowOfTurn(turn).filter(item => item.kind === 'reader'),
  ].sort((a, b) => a.order - b.order)
  const grouped = groupsSteps(policy, { isHistorical: folded, deferCollapse: !folded && props.isLatest })
  /* 摊着那一支的内容：①按真实次序的**一条流**（过程行 / 中途回复 / 读者插话交错），
     折外回复另摆。 */
  const openRows = flowOfTurn(turn).filter(item => item.kind !== 'reply' || !visibleIds.has(item.reply.id))
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
            title={foldSummaryOf(turn, policy, WORDS)}
            open={props.open}
            onToggle={props.onToggle}
            className={css.reviewWorkSteps}
          >
            <ul className={css.reviewStepList}>
              {foldRows.map(item => (
                <FoldedRow
                  key={item.kind === 'step' ? stepKeyOf(item.step) : item.kind === 'reader' ? `i:${item.interjection.id}` : `r:${item.reply.id}`}
                  item={item}
                  policy={policy}
                  sessionId={sessionId}
                  controller={controller}
                />
              ))}
            </ul>
          </Disclosure>
          {visible.map(reply => (
            <div key={reply.id} className={css.reviewMessage} data-role="assistant">
              <Reply text={reply.text} images={reply.images} sessionId={sessionId} controller={controller} />
            </div>
          ))}
        </>
      ) : (
        <>
          {/* 摊着也分两种（官方 `stepGrouping`）：简洁/标准连**在跑**的过程都收在一个
              可折叠的组里（默认展开），详细档只给历史轮分组——所以在跑的轮平铺。
              这就是「什么时候开始把过程收起来」的那半个开关。 */}
          {grouped ? (
            <Disclosure
              title={foldSummaryOf(turn, policy, WORDS)}
              open={props.open}
              onToggle={props.onToggle}
              className={css.reviewWorkSteps}
            >
              <ul className={css.reviewStepList}>
                {openRows.map(item => (
                  <FoldedRow
                    key={item.kind === 'step' ? stepKeyOf(item.step) : item.kind === 'reader' ? `i:${item.interjection.id}` : `r:${item.reply.id}`}
                    item={item}
                    policy={policy}
                    sessionId={sessionId}
                    controller={controller}
                  />
                ))}
              </ul>
            </Disclosure>
          ) : (
            <ul className={css.reviewStepList}>
              {openRows.map(item => (
                <FoldedRow
                  key={item.kind === 'step' ? stepKeyOf(item.step) : item.kind === 'reader' ? `i:${item.interjection.id}` : `r:${item.reply.id}`}
                  item={item}
                  policy={policy}
                  sessionId={sessionId}
                  controller={controller}
                />
              ))}
            </ul>
          )}
          {visible.map(reply => (
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
 * 一组轮：把策略算一次，逐轮画。
 *
 * 每轮的折开状态存在这里（`Set<turn>`），因为它是**读者这一次看的时候的选择**，
 * 不是会话数据：重新读一次尾窗口不该把读者点开的折又合上。
 */
export const TurnList = memo(function TurnList(props: {
  turns: readonly TranscriptTurn[]
  prefs: WorkStepsPrefs
  sessionId?: string
  controller?: BoardController
  openTurns: ReadonlySet<string>
  onToggle: (key: string) => void
}) {
  const policy = policyOfWorkSteps(props.prefs)
  return (
    <ul className={css.reviewTranscript}>
      {props.turns.map((turn, index) => {
        /* 键是 `turn` + `answerStep`（见 `foldKeyOf`）：同一轮的回答又长了一段时，
           读者对上一版折的选择不会串到新那一段上。 */
        const key = foldKeyOf(turn)
        return (
          <TurnItem
            key={turn.turn}
            turn={turn}
            policy={policy}
            isLatest={index === props.turns.length - 1}
            open={props.openTurns.has(key)}
            onToggle={() => props.onToggle(key)}
            sessionId={props.sessionId}
            controller={props.controller}
          />
        )
      })}
    </ul>
  )
})
