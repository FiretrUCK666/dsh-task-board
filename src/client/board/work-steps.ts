/**
 * 工作步骤：把一轮对话拆成「过程」与「最后那段话」，并决定折成什么样。
 *
 * ── 它为什么存在 ────────────────────────────────────────────────────────────
 *
 * 评论区原先按**消息**铺：一轮里模型中途说了三句、调了两个工具，屏上就是七八行。
 * 读者要的是「我一句、它一段」——中间那些是过程，不是回答。
 *
 * 官方会话页有三件事：**工作步骤展示**（四档详略）、**什么时候收起**（跑完就收 /
 * 下一次输入才收）、**收起后显示什么**（全部回复 / 只最后一条）。这三个开关住在
 * 宿主设置文档的 `ui-chat` 命名空间里，本文件**镜像它们的词表与语义**，于是读者在
 * 通用设置里选了什么，评论区就是什么——两处永远一致，我们不再维护第二套设置。
 *
 * ── 为什么镜像而不是引用 ────────────────────────────────────────────────────
 *
 * 那三个词表住在宿主的浏览器包里，而本仓库的 bundle 纯度门禁禁止跨包值导入
 * （会内联第二份运行时实例）。所以词表照抄一份，并由
 * `tests/work-steps.spec.ts` 的「词表镜像」那一节拿**实际安装的宿主声明文件**逐项
 * 对账：官方加一档、改一个字，那条用例报红并指名。抄一份的代价因此不是漂移，是红。
 *
 * 纯逻辑、无框架，单测在 `tests/work-steps.spec.ts` 里跑。
 */

/** 工作步骤展示的详略四档（官方 `ui-chat` 的 `transcriptView`）。 */
export type WorkStepsView = 'compact' | 'standard' | 'detailed' | 'verbose'

/** 什么时候收起（官方 `ui-chat` 的 `collapseTiming`）。 */
export type CollapseTiming = 'completion' | 'next-input'

/** 收起之后显示哪些回复（官方 `ui-chat` 的 `foldedReplies`）。 */
export type FoldedReplies = 'all' | 'final'

/** 读者在设置里能选的三件事（缺一项就是「没读到」，不是「选了默认」）。 */
export interface WorkStepsPrefs {
  view: WorkStepsView
  collapseTiming: CollapseTiming
  foldedReplies: FoldedReplies
}

/**
 * 这个部署读不到设置时的口径：**折叠 + 跑完就收 + 只留最后一条**。
 *
 * 与官方默认一致不是理由——理由是这三档合起来正好是「评论区最短、信息最不丢」
 * 的那一档：过程一条都没写丢，只是折起来了。读不到设置时安静的默认才诚实。
 */
export const DEFAULT_WORK_STEPS: WorkStepsPrefs = {
  view: 'detailed',
  collapseTiming: 'completion',
  foldedReplies: 'final',
}

/**
 * 一段过程里的一步：工具调用、思考、上下文注入。
 *
 * **类型只有一个家**（`review-transcript.ts`）——它是那条事件语法的读法所在，
 * 而本文件只判「折里放多细」。抄一份的结果是：那条语法加一类步骤时，这里不会跟着变，
 * 而屏上只会少一种行，没有任何报错。
 */
export type { TranscriptReply, TranscriptTurn, TranscriptStep as WorkStep } from './review-transcript.ts'
import type { TranscriptTurn } from './review-transcript.ts'

/** 折起来之后，屏幕上留下的东西。 */
export interface WorkStepsShape {
  /** 已经结束的轮要不要折叠。 */
  foldCompleted: boolean
  /** 折行标题里要不要带工具名与计数（简档只给计数）。 */
  showStepNames: boolean
  /** 折里要不要画思考行。 */
  showReasoning: boolean
  /** 折里要不要按步分段（详细档按步，简档与标准档平铺）。 */
  groupByStep: boolean
  /** 折外要不要把中途那些回复也露出来（`all` 档）。 */
  keepAllReplies: boolean
  /** 收起时机是不是「下一次输入才收」。 */
  collapseOnNextInput: boolean
}

/**
 * 四档详略 → 六个布尔。**这是唯一一张对照表**，别处不许再判一次。
 *
 * 读法：一档只决定「折里放多细」，不决定「有没有折」——只有 `verbose` 不折。
 * 这与官方的 `POLICIES` 表同构（那边四个键，这边落到画法上六个）。
 * @param view - 四档之一。
 * @returns 这一档的折法。
 */
export function shapeOfView(view: WorkStepsView): WorkStepsShape {
  switch (view) {
    case 'compact':
      return { foldCompleted: true, showStepNames: false, showReasoning: false, groupByStep: false, keepAllReplies: false, collapseOnNextInput: false }
    case 'standard':
      return { foldCompleted: true, showStepNames: true, showReasoning: false, groupByStep: false, keepAllReplies: false, collapseOnNextInput: false }
    case 'verbose':
      return { foldCompleted: false, showStepNames: true, showReasoning: true, groupByStep: true, keepAllReplies: true, collapseOnNextInput: false }
    case 'detailed':
      return { foldCompleted: true, showStepNames: true, showReasoning: true, groupByStep: true, keepAllReplies: false, collapseOnNextInput: false }
  }
}

/**
 * 三件事一起 → 这一屏的折法。
 *
 * 两件事**不由详略档决定**，而由另外两个开关决定：
 *   - `foldedReplies: 'all'` 让中途回复也露在折外（`keepAllReplies`）；
 *   - `collapseTiming: 'next-input'` 让最新那一轮完成之后先不折
 *     （`collapseOnNextInput`，由调用方判「它是不是最新」）。
 * @param prefs - 读者选的那三件事。
 * @returns 这一屏的折法。
 */
export function shapeOfWorkSteps(prefs: WorkStepsPrefs): WorkStepsShape {
  const shape = shapeOfView(prefs.view)
  return {
    ...shape,
    keepAllReplies: shape.keepAllReplies || prefs.foldedReplies === 'all',
    collapseOnNextInput: prefs.collapseTiming === 'next-input',
  }
}

/**
 * 一轮的「最后那段话」——`final` 档露在折外的那一条。
 *
 * 判据是**最后一条带文字的助手消息**，不是「空前的那条」：有些轮在最后一段
 * 之后还会有一条只有图片的消息，那条不是回答。
 * @param turn - 一轮。
 * @returns 那一条；这一轮没有文字回复时为 undefined。
 */
export function finalReplyOf(turn: TranscriptTurn): TranscriptTurn['replies'][number] | undefined {
  for (let index = turn.replies.length - 1; index >= 0; index -= 1) {
    const reply = turn.replies[index]
    if (reply.text !== '') return reply
  }
  return undefined
}

/**
 * 这一轮此刻该不该折起来。
 *
 * 四条「永不折」的硬边界，每一条都对应一次「折起来就读错了」：
 *   1. **还在跑**（没有 `endedAt`）——过程就是它此刻的状态，折起来等于说「它停了」；
 *   2. **这一轮里有读者自己的话**（`hasReaderTurn`）——读者的话被折进「过程」里
 *      是这套界面里最不能接受的一件事；
 *   3. **结束得不好**（`endReason` 不是 `completed`）——失败现场要露出来；
 *   4. **它是最新那一轮，而时机是 `next-input`**——读者还没开始下一句，先让它摊着。
 * @param turn - 一轮。
 * @param shape - 这一屏的折法。
 * @param options - `isLatest`：它是不是最新那一轮；`hasReaderTurn`：这一轮里有没有
 *   读者插的话。两者都由调用方给出（本函数不读全局状态，因此可单测）。
 * @returns 该不该折。
 */
export function shouldFoldTurn(
  turn: TranscriptTurn,
  shape: WorkStepsShape,
  options: { isLatest: boolean; hasReaderTurn: boolean } = { isLatest: false, hasReaderTurn: false },
): boolean {
  if (!shape.foldCompleted) return false
  if (turn.endedAt === undefined) return false
  if (turn.endReason !== undefined && turn.endReason !== 'completed') return false
  if (options.hasReaderTurn) return false
  if (shape.collapseOnNextInput && options.isLatest) return false
  /* 折里什么都不会有的轮**不折**：一个点开是空的折，比不折更糟——
     读者点了一次，学到的是「这个能点但没用」。 */
  if (turn.steps.length === 0) return false
  return true
}

/**
 * 折行标题里那句「做了什么」。
 *
 * 简档只说数量（`showStepNames: false`）；其余档点出最后一次工具名，因为读者扫一眼
 * 想知道的是「它刚才在动什么」。没有工具时退回思考与上下文的计数——**每一档都有话说**，
 * 不出现一个只有箭头的空折行。
 * @param turn - 一轮。
 * @param shape - 这一屏的折法。
 * @param words - 各个词；由调用方从词表取（本函数不读词表，因此可单测）。
 * @returns 一行字。
 */
export function foldSummaryOf(
  turn: TranscriptTurn,
  shape: WorkStepsShape,
  words: { tools: (n: number) => string; reasoning: (n: number) => string; context: (n: number) => string; running: (name: string) => string; completed: string },
): string {
  const tools = turn.steps.filter(step => step.kind === 'tool')
  const reasoning = turn.steps.filter(step => step.kind === 'reasoning').length
  const context = turn.steps.filter(step => step.kind === 'context').length
  const running = tools.find(step => step.kind === 'tool' && step.state === 'running')
  if (running !== undefined && running.kind === 'tool') return words.running(running.name)
  const parts: string[] = []
  if (tools.length > 0) parts.push(shape.showStepNames ? words.tools(tools.length) : words.tools(tools.length))
  if (shape.showReasoning && reasoning > 0) parts.push(words.reasoning(reasoning))
  if (context > 0) parts.push(words.context(context))
  if (parts.length === 0) return words.completed
  return parts.join(' · ')
}

/**
 * 把宿主给的字符串读成四档之一；读不出来就是「没读到」，由调用方回落到默认。
 *
 * 两种历史拼写读作 `detailed`：`normal` 与 `expanded` 曾经是官方的档位名，
 * 老设置文档里还留着它们——读作详略**不变**是唯一不会让读者发现「我选的档变了」的读法。
 * @param raw - 设置里的原值。
 * @returns 四档之一；不认识时 undefined。
 */
export function viewOf(raw: unknown): WorkStepsView | undefined {
  if (raw === 'compact' || raw === 'standard' || raw === 'detailed' || raw === 'verbose') return raw
  if (raw === 'normal' || raw === 'expanded') return 'detailed'
  return undefined
}

/**
 * 读收起时机；不认识时 undefined。
 * @param raw - 设置里的原值。
 * @returns 两种之一；不认识时 undefined。
 */
export function collapseTimingOf(raw: unknown): CollapseTiming | undefined {
  if (raw === 'completion' || raw === 'next-input') return raw
  return undefined
}

/**
 * 读「收起后显示哪些回复」；不认识时 undefined。
 * @param raw - 设置里的原值。
 * @returns 两种之一；不认识时 undefined。
 */
export function foldedRepliesOf(raw: unknown): FoldedReplies | undefined {
  if (raw === 'all' || raw === 'final') return raw
  return undefined
}

/**
 * 把设置快照的原始形状读成三件事；读不到的项各自回落默认。
 *
 * **逐项回落，不整体回落**：读者把「收起时机」改了而详略档没动过，那一档不该跟着
 * 变回默认。这也让「设置里只有一项」这种正常情况不至于把另外两项一起打回原形。
 * @param raw - `configForms` 给的快照值（结构未知，逐项窄化）。
 * @returns 三件事，永远完整。
 */
export function prefsOf(raw: unknown): WorkStepsPrefs {
  const row = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  return {
    view: viewOf(row.transcriptView) ?? DEFAULT_WORK_STEPS.view,
    collapseTiming: collapseTimingOf(row.collapseTiming) ?? DEFAULT_WORK_STEPS.collapseTiming,
    foldedReplies: foldedRepliesOf(row.foldedReplies) ?? DEFAULT_WORK_STEPS.foldedReplies,
  }
}
