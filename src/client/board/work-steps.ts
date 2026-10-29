/**
 * 工作步骤：一轮对话里的过程怎么折、折成什么样。
 *
 * ── 它为什么存在 ────────────────────────────────────────────────────────────
 *
 * 评论区原先按**消息**平铺：一轮里模型中途说了三句、调了四十次工具，屏上就是四十多行。
 * 读者要的是「我一句、它一段」——中间那些是过程，不是回答。
 *
 * 官方会话页正是这么做的，而且**不是靠几个自造的开关**，而是一张策略表：
 * 读者在设置里选的三个开关（工作步骤展示 / 收起时机 / 收起后显示哪些回复）会解析成
 * 四个**能力字段**，渲染层只读这四个字段。本文件就是把那张表镜像过来。
 *
 * ── 为什么镜像而不是引用 ────────────────────────────────────────────────────
 *
 * 那张表住在宿主的浏览器包里，而本仓库的 bundle 纯度门禁禁止跨包值导入
 * （会内联第二份运行时实例）。所以词表照抄一份，并由 `tests/work-steps.spec.ts`
 * 的「词表镜像」一节拿**实际安装的宿主声明文件**逐项对账：官方加一档、改一个字、
 * 改一个字段的取值，那条用例报红并指名。抄一份的代价因此不是漂移，是红。
 *
 * ── 四个能力字段（名字与取值都照官方 `ChatPresentationPolicy`）──────────────
 *
 *   `foldCompletedTurns`     跑完的轮折不折（只有「完全展开」不折）
 *   `stepGrouping`           过程按步分组成可折叠的小组：`collapsed` 始终分组 /
 *                            `history` 只给历史轮分组 / `none` 不分
 *   `liveProcessDetail`      正在跑时组标题里说清「在跑什么」
 *   `settledReasoningPreview` 结算后的思考在标题旁给首行预览
 *
 * ── 三条运行时判据也照官方 ──────────────────────────────────────────────────
 *
 *   `turnProcessAlwaysOpen`   **还在跑 / 被中止 / 被打断 / 出错**的轮永不折
 *   `hasInterleavedInput`     这一轮里读者插过话 → 永不折（读者的话不能被折掉）
 *   `turnProcessOpen`         读者手动开合过就以读者为准，且**按 `turn` + `answerStep`
 *                             一起记**（同一轮的回答又长了一段时，旧选择不串到新版本）
 *
 * 纯逻辑、无框架，单测在 `tests/work-steps.spec.ts` 里跑。
 */

/** 工作步骤展示的详略四档（官方 `ui-chat` 的 `transcriptView`）。 */
export type WorkStepsView = 'compact' | 'standard' | 'detailed' | 'verbose'

/** 什么时候收起（官方 `ui-chat` 的 `collapseTiming`）。 */
export type CollapseTiming = 'completion' | 'next-input'

/** 收起之后显示哪些回复（官方 `ui-chat` 的 `foldedReplies`）。 */
export type FoldedReplies = 'all' | 'final'

/** 过程要不要按步分组成可折叠的小组（官方 `stepGrouping`）。 */
export type StepGrouping = 'collapsed' | 'history' | 'none'

/** 读者在设置里能选的三件事（缺一项就是「没读到」，不是「选了默认」）。 */
export interface WorkStepsPrefs {
  view: WorkStepsView
  collapseTiming: CollapseTiming
  foldedReplies: FoldedReplies
}

/**
 * 这一屏的折法——官方 `ChatPresentationPolicy` 的镜像。
 *
 * **渲染层只读这四个能力字段**，不许再拿 `mode` 去判一次：
 * 一处判断一个说法，两个判据迟早说出两句不同的话。
 */
export interface WorkStepsPolicy {
  /** 读者选的那一档（只用于诊断与布局重置，不参与判断）。 */
  mode: WorkStepsView
  collapseTiming: CollapseTiming
  foldedReplies: FoldedReplies
  /** 跑完的轮折不折。 */
  foldCompletedTurns: boolean
  /** 过程要不要按步分组。 */
  stepGrouping: StepGrouping
  /** 正在跑时，组标题里说清在跑什么。 */
  liveProcessDetail: boolean
  /** 结算后的思考给首行预览。 */
  settledReasoningPreview: boolean
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
 * 四档详略 → 四个能力。**这是唯一一张对照表**，逐格照官方 `POLICIES`。
 *
 * 读法（也是官方读法）：
 *   - 前三档都**折**跑完的轮，只有「完全展开」不折；
 *   - 「简洁」「标准」把过程**始终**分组，「详细」只给**历史**轮分组，
 *     「完全展开」**不分**（它就是「什么都摊开」）；
 *   - 「简洁」不说自己正在跑什么、也不给思考预览；其余三档都给；
 *   - 「完全展开」在跑的时候反而不说细节——它已经把一切摊开了，不需要标题。
 * @param view - 四档之一。
 * @returns 这一档的四个能力（另两个开关由 `policyOf` 补上）。
 */
export function policyOfView(view: WorkStepsView): Omit<WorkStepsPolicy, 'collapseTiming' | 'foldedReplies'> {
  switch (view) {
    case 'compact':
      return { mode: view, foldCompletedTurns: true, stepGrouping: 'collapsed', liveProcessDetail: false, settledReasoningPreview: false }
    case 'standard':
      return { mode: view, foldCompletedTurns: true, stepGrouping: 'collapsed', liveProcessDetail: true, settledReasoningPreview: true }
    case 'verbose':
      return { mode: view, foldCompletedTurns: false, stepGrouping: 'none', liveProcessDetail: false, settledReasoningPreview: true }
    case 'detailed':
      return { mode: view, foldCompletedTurns: true, stepGrouping: 'history', liveProcessDetail: true, settledReasoningPreview: true }
  }
}

/**
 * 三件事一起 → 这一屏的折法（官方 `presentationPolicyFor` 的镜像）。
 * @param prefs - 读者选的那三件事。
 * @returns 完整的策略对象。
 */
export function policyOfWorkSteps(prefs: WorkStepsPrefs): WorkStepsPolicy {
  return { ...policyOfView(prefs.view), collapseTiming: prefs.collapseTiming, foldedReplies: prefs.foldedReplies }
}

/**
 * 一段过程里的一步：工具调用、思考、上下文注入。
 *
 * **类型只有一个家**（`review-transcript.ts`）——它是那条事件语法的读法所在，
 * 而本文件只判「折里放多细」。抄一份的结果是：那条语法加一类步骤时，这里不会跟着变，
 * 而屏上只会少一种行，没有任何报错。
 */
export type { TranscriptReply, TranscriptTurn, TranscriptStep as WorkStep, TranscriptInterjection, TurnAnswerBoundary, TurnFlowItem } from './review-transcript.ts'
import type { TranscriptTurn } from './review-transcript.ts'

/**
 * 一轮里「过程行 / 回复 / 读者插话」按**真实发生顺序**排成一条流。
 *
 * 这是「顺序对不上」那个病根的治法：过程与回复被收进两个数组，画的时候如果先摆完
 * 所有工具再摆所有话，读者看到的就是「几十行工具堆在上面、两句话接在下面」，而真实
 * 发生的是「思考 → 调工具 → 说一句 → 再调工具」。到达次序是唯一真相，排序只在这里做。
 *
 * **实现只有一个家**（`review-transcript.ts` 的 `flowOf`，它就是那条语法的读法），
 * 这里只做转出，免得渲染层去认识两个模块名。
 */
export { flowOf } from './review-transcript.ts'

/**
 * 这一步要不要分组画（官方 `grouped`）。
 *
 * `history` 档只给**历史**轮分组：正在跑的那一轮要一句一句看得见，
 * 一旦跑完变成「历史」，同样的内容收进组里。读者要的正是这个区别。
 * @param policy - 这一屏的折法。
 * @param options - `isHistorical`：这一轮是不是历史（跑完了）；`deferCollapse`：它是不是
 *   最新跑完、还按 `next-input` 摊着的那一轮。
 * @returns 要不要按步分组。
 */
export function groupsSteps(
  policy: WorkStepsPolicy,
  options: { isHistorical: boolean; deferCollapse: boolean },
): boolean {
  if (policy.stepGrouping === 'none') return false
  if (policy.stepGrouping === 'collapsed') return true
  return options.isHistorical && !options.deferCollapse
}

/**
 * 一轮的「最后那段话」——折起来之后仍然露在外面的那条回复。
 *
 * 判据**不是「最后一条带文字的消息」**，而是官方那条**最终回答边界**
 * （`review-transcript.ts` 的 `answerBoundaryOf`）：最后一步里带文字、且那一步没有
 * 工具调用的那条。少了这个边界，一路上「途中说的话」会跟最终回答排在同一层，
 * 读者看到的就是「过程堆在上面、话接在下面，对不上哪句属于哪段」。
 * @param turn - 一轮。
 * @returns 那一条；这一轮还没有最终回答时为 undefined。
 */
export function finalReplyOf(turn: TranscriptTurn): TranscriptTurn['replies'][number] | undefined {
  if (turn.answer === undefined) return undefined
  return turn.replies.find(reply => reply.id === turn.answer?.replyId)
}

/**
 * 这一轮折起来之后，**折里**显示哪些回复。
 *
 * `foldedReplies: 'all'` 时中途那些回复**不进折**（它们露在外面）；
 * `'final'` 时它们进折——这正是「收起后显示的回复」那个开关的全部含义。
 * @param turn - 一轮。
 * @param policy - 这一屏的折法。
 * @returns 该折进过程的回复。
 */
export function foldedRepliesOf(turn: TranscriptTurn, policy: WorkStepsPolicy): TranscriptTurn['replies'] {
  if (policy.foldedReplies === 'all') return []
  if (turn.answer === undefined) return []
  return turn.replies.filter(reply => reply.step < (turn.answer?.step ?? 0))
}

/**
 * 这一轮**露在折外**的回复（顺序保持发生顺序）。
 * @param turn - 一轮。
 * @param policy - 这一屏的折法。
 * @returns 该露出来的回复。
 */
export function visibleRepliesOf(turn: TranscriptTurn, policy: WorkStepsPolicy): TranscriptTurn['replies'] {
  if (policy.foldedReplies === 'all') return turn.replies
  const answer = finalReplyOf(turn)
  return answer === undefined ? [] : [answer]
}

/**
 * 这一轮此刻该不该折起来。
 *
 * 四条「永不折」的硬边界，每一条都照官方，每一条都对应一次「折起来就读错了」：
 *   1. **还在跑**（没有 `endedAt`）——过程就是它此刻的状态，折起来等于说「它停了」；
 *   2. **结束得不好**（`aborted` / `interrupted` / `error`）——失败现场要露出来；
 *   3. **这一轮里有读者自己的话**（`hasReaderTurn`）——读者的话被折进「过程」里
 *      是这套界面里最不能接受的一件事；
 *   4. **它是最新跑完的那一轮，而时机是 `next-input`**——读者还没开始下一句，先让它摊着。
 *
 * 另加一条本项目的边界：**折里什么都不会有的轮不折**——一个点开是空的折，比不折更糟。
 * @param turn - 一轮。
 * @param policy - 这一屏的折法。
 * @param options - `isLatest`：它是不是最新那一轮；`hasReaderTurn`：这一轮里有没有
 *   读者插的话。两者都由调用方给出（本函数不读全局状态，因此可单测）。
 * @returns 该不该折。
 */
export function shouldFoldTurn(
  turn: TranscriptTurn,
  policy: WorkStepsPolicy,
  options: { isLatest: boolean; hasReaderTurn: boolean } = { isLatest: false, hasReaderTurn: false },
): boolean {
  if (!policy.foldCompletedTurns) return false
  if (turn.endedAt === undefined) return false
  if (turn.endReason !== undefined && turn.endReason !== 'completed') return false
  if (options.hasReaderTurn) return false
  if (policy.collapseTiming === 'next-input' && options.isLatest) return false
  if (turn.steps.length === 0) return false
  return true
}

/**
 * 折行标题里那句「做了什么」。
 *
 * 正在跑时（`liveProcessDetail`）说「正在跑最后那个工具」——读者扫一眼想知道的是
 * 「它现在在动什么」；跑完了就退回计数。没有工具时退回思考与上下文的计数，
 * **每一档都有话说**，不出现一个只有箭头的空折行。
 * @param turn - 一轮。
 * @param policy - 这一屏的折法。
 * @param words - 各个词；由调用方从词表取（本函数不读词表，因此可单测）。
 * @returns 一行字。
 */
export function foldSummaryOf(
  turn: TranscriptTurn,
  policy: WorkStepsPolicy,
  words: { tools: (n: number) => string; reasoning: (n: number) => string; context: (n: number) => string; running: (name: string) => string; completed: string },
): string {
  const tools = turn.steps.filter(step => step.kind === 'tool')
  const reasoning = turn.steps.filter(step => step.kind === 'reasoning').length
  const context = turn.steps.filter(step => step.kind === 'context').length
  const running = tools.find(step => step.kind === 'tool' && step.state === 'running')
  if (policy.liveProcessDetail && running !== undefined && running.kind === 'tool') return words.running(running.name)
  const parts: string[] = []
  if (tools.length > 0) parts.push(words.tools(tools.length))
  if (reasoning > 0) parts.push(words.reasoning(reasoning))
  if (context > 0) parts.push(words.context(context))
  if (parts.length === 0) return words.completed
  return parts.join(' · ')
}

/**
 * 一轮的折开状态用它当键——**`turn` + `answerStep` 一起**，照官方
 * `turnProcessOpen` 的那条判据（那边存的是 `{turn, answerStep}`，取用时比对
 * `stored.answerStep !== (spec.answerStep ?? 0)` 就回落到默认）。
 *
 * 只用轮号是不够的：同一轮里最终回答又长了一段（`answerStep` 变了），读者对
 * **上一版**折的选择不该自动套到**新那一段**上——那会让读者以为
 * 「我明明点开了，它自己又合上了」。
 * @param turn - 一轮。
 * @returns 稳定的键。
 */
export function foldKeyOf(turn: TranscriptTurn): string {
  return `${turn.turn}#${turn.answer?.step ?? 0}`
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
export function foldedRepliesChoiceOf(raw: unknown): FoldedReplies | undefined {
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
    foldedReplies: foldedRepliesChoiceOf(row.foldedReplies) ?? DEFAULT_WORK_STEPS.foldedReplies,
  }
}
