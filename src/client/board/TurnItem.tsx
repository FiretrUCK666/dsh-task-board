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
  blocksOf, foldKeyOf, groupsSteps, itemsOfTurn,
  policyOfWorkSteps, shouldFoldTurn, summaryOfItems, visibleRepliesOf,
  type WorkStepsPolicy, type WorkStepsPrefs,
} from './work-steps.ts'
import type { TurnFlowItem } from './work-steps.ts'
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
  item: TurnFlowItem
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

/** 折里那一段过程的渲染：**每一组自己的一个小折**（官方 `ProcessGroup`）。 */
function ClusterFold({ cluster, policy, open, onToggle, sessionId, controller }: {
  cluster: Extract<ReturnType<typeof blocksOf>[number], { kind: 'cluster' }>
  policy: WorkStepsPolicy
  open: boolean
  onToggle: () => void
  sessionId?: string
  controller?: BoardController
}) {
  /* **每一组都是自己的一个小折**（读者要的正是这个）。
     一行两行的组也做成折：把阈值写成「超过 N 行才折」，读者就得先数一眼才知道
     能不能点——而这一层存在的意义就是「每步都能单独收起来」，折叠与否不该取决于
     那一天它跑了几行。标题里写着这一组做了什么，收起时那一行本身就是读数。 */
  return (
    <Disclosure
      title={summaryOfItems(cluster.items, policy, WORDS)}
      open={open}
      onToggle={onToggle}
      className={css.reviewStepGroup}
    >
      <ul className={css.reviewStepList}>
        {cluster.items.map(item => (
          <FoldedRow
            key={item.kind === 'step' ? stepKeyOf(item.step) : item.kind === 'reader' ? `i:${item.interjection.id}` : `r:${item.reply.id}`}
            item={item} policy={policy} sessionId={sessionId} controller={controller}
          />
        ))}
      </ul>
    </Disclosure>
  )
}

/** 折里的一整段内容：按块画——过程块各自成折、回复按 block 摆在外面的流里。 */
function FoldedBody({ blocks, policy, sessionId, controller, isOpen, onToggle }: {
  blocks: ReturnType<typeof blocksOf>
  policy: WorkStepsPolicy
  sessionId?: string
  controller?: BoardController
  isOpen: (key: string) => boolean
  onToggle: (key: string) => void
}) {
  return (
    <>
      {blocks.map(block => block.kind === 'reply' ? (
        <FoldedRow
          key={`r:${block.reply.id}`}
          item={{ kind: 'reply', order: block.order, reply: block.reply }}
          policy={policy} sessionId={sessionId} controller={controller}
        />
      ) : (
        <ClusterFold
          key={block.key}
          cluster={block}
          policy={policy}
          open={isOpen(block.key)}
          onToggle={() => onToggle(block.key)}
          sessionId={sessionId}
          controller={controller}
        />
      ))}
    </>
  )
}

/**
 * 一轮对话。
 *
 * 折与不折由 `shouldFoldTurn` 判，**不在这里再判一次**：判据只有一个家，
 * 两处各判一次就会在某个组合下互相打架，而屏上看起来只是「有时候不折」。
 *
 * ── 两级折：整轮一个，轮里每组再一个 ────────────────────────────────────────
 *
 * 官方是两级的（`ProcessGroup`：整轮一个折，轮里按**步**再分组，每组自己收放）。
 * 我们此前只有上一级，于是一轮跑了四十步之后，点开那一个折看到的是一条四十行的
 * 长带子——读者说的「每一个 step 用到的那些东西好像都可以单独折叠收纳起来」
 * 指的就是缺了这一级。
 */
export const TurnItem = memo(function TurnItem(props: {
  turn: TranscriptTurn
  policy: WorkStepsPolicy
  /** 它是不是最新那一轮（`next-input` 时机要用）。 */
  isLatest: boolean
  /** 读者把这一折点开了吗（由 `SessionTranscript` 记，跨重渲染保持）。 */
  open: boolean
  onToggle: () => void
  /** 轮里某一组的开合（键 = `foldKeyOf(turn)` + 组 key，也是读者这一次的选择）。 */
  collapsedGroups?: ReadonlySet<string>
  onToggleGroup?: (key: string) => void
  sessionId?: string
  controller?: BoardController
}) {
  const { turn, policy, sessionId, controller } = props
  const folded = shouldFoldTurn(turn, policy, {
    isLatest: props.isLatest,
    hasReaderTurn: turn.interjections.length > 0,
  })
  const visible = visibleRepliesOf(turn, policy)
  const visibleIds = new Set(visible.map(reply => reply.id))
  /* 块的切分是**一次**的：折里与摊着两支共用同一份，两处不各切一次。 */
  const blocks = blocksOf(turn)
  const groupPrefix = foldKeyOf(turn)
  /* 组的默认开合：**展开**。读者点开整轮那个折，就是想看这一轮到底干了什么；
     若里面每个组又各自收着，他还得再点一次才看到第一行——那是把官方那两级
     折的意思读反了。
     官方的 `ProcessGroup` 在轮结束时把组标成 `closed`，但官方同时把**整轮那个折**
     也收着，两者互为前提：读者一动手点开整轮，看到的就是过程本身。
     所以这里记的是**读者主动收起来的组**（`collapsedGroups`）：不在集合里 = 展开。 */
  const isGroupOpen = (key: string): boolean => props.collapsedGroups?.has(`${groupPrefix}#${key}`) !== true
  const toggleGroup = (key: string): void => { props.onToggleGroup?.(`${groupPrefix}#${key}`) }
  /* 这一支画哪些块：过程块全部画，**回复块只画那些属于「折里」的**
     （折外那些在下面单独成流，画两遍就是重复）。
     `verbose` 档（`stepGrouping: 'none'`）里所有回复都露在外面，于是这里一条回复都不剩。 */
  const bodyBlocks = blocks.filter(block => block.kind === 'cluster' || !visibleIds.has(block.reply.id))
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
            title={summaryOfItems(itemsOfTurn(turn), policy, WORDS)}
            open={props.open}
            onToggle={props.onToggle}
            className={css.reviewWorkSteps}
          >
            <div className={css.reviewStepList}>
              <FoldedBody
                blocks={bodyBlocks}
                policy={policy}
                sessionId={sessionId}
                controller={controller}
                isOpen={isGroupOpen}
                onToggle={toggleGroup}
              />
            </div>
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
              可折叠的组里（默认展开），详细档只给历史轮分组——所以在跑的轮平铺。 */}
          {groupsSteps(policy, { isHistorical: false, deferCollapse: props.isLatest }) ? (
            <Disclosure
              title={summaryOfItems(itemsOfTurn(turn), policy, WORDS)}
              open={props.open}
              onToggle={props.onToggle}
              className={css.reviewWorkSteps}
            >
              <div className={css.reviewStepList}>
                <FoldedBody
                  blocks={bodyBlocks}
                  policy={policy}
                  sessionId={sessionId}
                  controller={controller}
                  isOpen={isGroupOpen}
                  onToggle={toggleGroup}
                />
              </div>
            </Disclosure>
          ) : (
            <div className={css.reviewStepList}>
              <FoldedBody
                blocks={bodyBlocks}
                policy={policy}
                sessionId={sessionId}
                controller={controller}
                isOpen={isGroupOpen}
                onToggle={toggleGroup}
              />
            </div>
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
  /** 轮里某一组的开合（键含轮的 `foldKeyOf`，见 `TurnItem`）。 */
  collapsedGroups?: ReadonlySet<string>
  onToggleGroup?: (key: string) => void
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
            collapsedGroups={props.collapsedGroups}
            onToggleGroup={props.onToggleGroup}
            sessionId={props.sessionId}
            controller={props.controller}
          />
        )
      })}
    </ul>
  )
})
