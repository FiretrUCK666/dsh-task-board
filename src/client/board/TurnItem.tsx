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

/** 折里那一段过程的渲染：**每段过程自己的一个小折**（官方 `ProcessGroup`）。 */
function ClusterFold({ cluster, policy, open, onToggle, grouped, sessionId, controller }: {
  cluster: Extract<ReturnType<typeof blocksOf>[number], { kind: 'cluster' }>
  policy: WorkStepsPolicy
  open: boolean
  onToggle: () => void
  /** 一轮里有多段过程：这一段才需要自己的折。只有一段时它就是内容本身。 */
  grouped: boolean
  sessionId?: string
  controller?: BoardController
}) {
  const rows = (
    <ul className={css.reviewStepList}>
      {cluster.items.map(item => (
        <FoldedRow
          key={item.kind === 'step' ? stepKeyOf(item.step) : item.kind === 'reader' ? `i:${item.interjection.id}` : `r:${item.reply.id}`}
          item={item} policy={policy} sessionId={sessionId} controller={controller}
        />
      ))}
    </ul>
  )
  /* 读者插话那一块：**永远摊着**，不套折（读者自己的话被收起来是最糟的读法）。 */
  if (cluster.reader === true) return rows
  /* 一轮只有一段过程：**不再套一层折**。官方那两级折的存在理由是「一轮里有多段，
     每段能各自收放」；只有一段时再套一层，读者要连点两次才看到第一行，那一层
     就成了纯负担——而且屏上会出现一整列「1 次工具调用」的空折（读者截图里那个）。 */
  if (!grouped) return rows
  return (
    <Disclosure
      title={summaryOfItems(cluster.items, policy, WORDS)}
      open={open}
      onToggle={onToggle}
      className={css.reviewStepGroup}
    >
      {rows}
    </Disclosure>
  )
}

/** 折里的一整段内容：按块画——过程块各自成折、回复按 block 摆在外面的流里。 */
function FoldedBody({ blocks, policy, sessionId, controller, isOpen, onToggle, grouped }: {
  blocks: ReturnType<typeof blocksOf>
  policy: WorkStepsPolicy
  sessionId?: string
  controller?: BoardController
  isOpen: (key: string) => boolean
  onToggle: (key: string) => void
  /** 一轮里有多段过程：每段各自成折；只有一段时不套那一层。 */
  grouped: boolean
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
          grouped={grouped}
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
 * ── 两级折：整轮一个，轮里**多段**过程时每段再一个 ──────────────────────────
 *
 * 官方是两级的（`ProcessGroup`）：整轮一个折，轮里按**连续的一段过程**再分组
 * （切分点只有「说了话」与「过程之外的节点」，**不是步与步的边界**——
 * 见 `blocksOf` 的注释）。这一级只在**一轮里真的有多段**时才出现：只有一段时
 * 再套一层要连点两次才看到第一行，而屏上会多出一整列「1 次工具调用」的空折。
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
  openGroups?: ReadonlySet<string>
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
  /* 组的默认开合：**收起来**（官方 `useDisclosure()` 的 `expanded` 初值是 `null`，
     也就是收着）。只有这一个组、而整轮那个折被读者点开时，外面那层不再套——
     官方那两级折的存在理由是「一轮里有多段过程，每段能各自收放」；只有一段时
     再套一层，读者要连点两次才看到第一行，那一层就成了纯负担。
     `openGroup` 记的是读者**点开过的**组；`isGroupOpen` 见下。 */
  const isGroupOpen = (key: string): boolean => props.openGroups?.has(`${groupPrefix}#${key}`) === true
  const toggleGroup = (key: string): void => { props.onToggleGroup?.(`${groupPrefix}#${key}`) }
  /* 分组只有在一轮里**确实有多段**时才成立（官方那个 `grouped` 开关）；
     一段过程直接摊开，不套空折。 */
  const clusterCount = blocks.filter(block => block.kind === 'cluster').length
  const multiCluster = clusterCount > 1
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
                grouped={multiCluster}
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
                grouped={multiCluster}
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
                grouped={multiCluster}
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
  openGroups?: ReadonlySet<string>
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
            openGroups={props.openGroups}
            onToggleGroup={props.onToggleGroup}
            sessionId={props.sessionId}
            controller={props.controller}
          />
        )
      })}
    </ul>
  )
})
