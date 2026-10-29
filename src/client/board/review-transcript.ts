/**
 * Review-page transcript: fold a raw session-history event list into **turns**,
 * the way the native conversation does.
 *
 * ── 为什么按「轮」而不是按「消息」 ──────────────────────────────────────────
 *
 * 按消息铺的时候，一轮里模型中途说了三句、调了两个工具，屏上就是七八行。读者要的是
 * 「我一句、它一段」：中间那些是过程，不是回答。
 *
 * 一轮 = 读者说的一句话 + 中间的过程（工具、思考、上下文注入）+ 它最后那段话。
 * 过程交给 `work-steps.ts` 决定折成什么样，本文件只负责**如实分组**。
 *
 * ── 事件语法（读真实会话日志确认过）────────────────────────────────────────
 *
 *   `turn/start`      `{ turn }`
 *   `step/start`      `{ turn, step }`（过程分段用）
 *   `user/message`    **扁平**：`{ id, content[], source:{kind,…} }`
 *                     `source.kind === 'user'` 才是读者的话；其余是注入
 *   `assistant/message` **包裹**：`{ turn, step, message:{ id, content[] }, usage? }`
 *                     `content` 里的 `reasoning` 块是思考，`text` 块是回复
 *   `tool/call`       `{ turn, step, callId, name, arguments }`
 *   `tool/result`     `{ turn, step, message:{ toolCallId, isError, content[] } }`
 *   `turn/end`        `{ turn, reason:{ kind } }`
 *
 * ── 三条不许丢的边界 ────────────────────────────────────────────────────────
 *
 *   1. **窗口被切掉的头**：尾窗口从半轮开始是常态。于是「没有 `turn/start`」不许
 *      导致内容被丢——用助手消息自带的 `turn` 号合成一组。宁可分组略有偏差，不可吞内容。
 *   2. **有调用没结果**：工具调了没有回音。轮已结束就是 `unsettled`（**不谎称失败**），
 *      还在跑就是 `running`。
 *   3. **一轮里读者自己说了话**：那一轮永远不折（由 `work-steps.ts` 判）。
 *
 * 纯逻辑、无框架，`tests/review-page.spec.ts` 的 `foldTurns` 一节单测它。
 */
import { contentTextOf } from '../../core/session-activity.ts'

/**
 * 一条消息携带的那张图——**官方 `ImageAttachmentRef` 的整份**。
 *
 * 官方的读图门（`sessions.attachment`）要的是一份**完整引用**：它按契约校验
 * ID、格式、**字节长度与尺寸**。发一份只剩 `attachmentId` 的瘦身版会**当场被拒**，
 * 界面于是降级成 `[图片]`——那个降级看起来像「图片坏了」，其实是读法不对。
 *
 * 所以这里的字段是**照官方的 required 集合**收的，而且只多不少：手抄一份字段表
 * 就是漏字段（这条写在 `AGENTS.md` 的不变量里）。`tests/attachment-contract.spec.ts`
 * 拿**实际安装的宿主声明文件**逐字段对账，官方加字段时它报红并指名。
 */
export interface TranscriptImage {
  attachmentId: string
  mediaType: string
  /** 精确字节长度（官方 required：读回时要按它校验）。 */
  bytes: number
  /** 内在宽度（官方 required）。 */
  width: number
  /** 内在高度（官方 required）。 */
  height: number
  /** 显示名（官方 optional）。 */
  name?: string
  /**
   * 归正前的原始尺寸（官方 optional，只在归一化缩过图时出现）。
   *
   * 它不参与渲染，但**必须跟着走**：宿主对这份引用的校验可能要看它，而
   * 「哪些字段能省」不是我们能猜的——`tests/attachment-contract.spec.ts` 就是
   * 拿官方声明逐字段比出来的，省掉它那条当场报红。
   */
  originalDimensions?: { width: number; height: number }
}

/** Token accounting of one assistant message (native `usage` payload). */
export interface TranscriptUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** One process step inside a turn. */
export type TranscriptStep =
  /** 一次工具调用；`state` 由 `tool/call` 与 `tool/result` 配对推出。 */
  | { kind: 'tool'; id: string; name: string; state: 'running' | 'settled' | 'unsettled'; step: number; order: number }
  /** 一段思考：只留字数与首行（正文太长，折行里放不下也不该占内存）。 */
  | { kind: 'reasoning'; id: string; chars: number; preview: string; step: number; order: number }
  /** 一次上下文注入（技能、指令文件、会话引用、定时通知…）。 */
  | { kind: 'context'; id: string; producer: string; summary: string; at: number; order: number }

/** One assistant reply inside a turn. */
export interface TranscriptReply {
  id: string
  text: string
  images?: TranscriptImage[]
  at: number
  usage?: TranscriptUsage
  /** 这条回复属于哪一步（官方 `step`）。**它是最终回答边界的唯一依据**：
   *  官方的「最终回答」= 这一轮**最后一步**里那条带文字、且同一步没有工具调用的
   *  助手消息；它之前的每一条回复都算过程。少了这个号，就只能按「第几条」猜。 */
  step: number
  /** 它在这条事件流里的到达次序。**顺序的唯一真相**：过程行与回复各自记序号，
   *  画的时候按号排，于是「思考 → 调工具 → 说一句 → 再调工具」就是它真实发生的
   *  顺序，而不是「先摆完所有工具、再摆所有话」。 */
  order: number
}

/** 读者中途插的一句话。 */
export interface TranscriptInterjection {
  id: string
  text: string
  images?: TranscriptImage[]
  at: number
  /** 它插在哪一步（按到达时的步号记）——插话要画在它真正打断的位置上。 */
  step: number
  order: number
}

/** 一条轮内的画序单元：过程行、回复、读者插话各是其中一种。 */
export type TurnFlowItem =
  | { kind: 'step'; order: number; step: TranscriptStep }
  | { kind: 'reply'; order: number; reply: TranscriptReply }
  | { kind: 'reader'; order: number; interjection: TranscriptInterjection }

/**
 * 一轮的「最终回答边界」——官方 `TurnProcessSpec` 的那三个字段。
 *
 * 官方的折叠不是「过程一块、回复一块」，而是先算出**最终回答从哪一步开始**：
 *
 *   `answerStep` = 这一轮**最后一步**（`turn.steps.at(-1)`）；
 *   那一步里**带文字、且那一步没有工具调用**的最后一条助手消息，就是最终回答；
 *   它**之前**的所有助手消息（哪怕是完整的一段落）都算过程，折起来。
 *
 * 少了这个边界，一长串工具调用和几句「途中说的话」会被排在同一层，于是读者看到的
 * 是「过程堆在上面、话接在下面，对不上哪句属于哪段」——那不是排序问题，是边界没算。
 */
export interface TurnAnswerBoundary {
  /** 最终回答所在的那一步。 */
  step: number
  /** 那一步里作为最终回答的那条回复。 */
  replyId: string
  /** 边界**之前**的回复条数（官方 `messageCount`：这些全算过程）。 */
  messageCount: number
}

/**
 * 算出一轮的最终回答边界；还拿不出来时返回 undefined。
 *
 * 判据逐条照官方：只看**最后一步**；那一步有工具调用 = 这一轮还在干活，没有最终
 * 回答（整轮摊着）；最后一步里没有带文字的回复 = 同上（`latestAnswer` 返回 null）。
 * @param replies - 这一轮的回复，按发生顺序。
 * @param steps - 这一轮的过程行（用来判「那一步有没有工具调用」）。
 */
export function answerBoundaryOf(
  replies: readonly { id: string; text: string; step: number }[],
  steps: readonly { kind: 'tool' | 'reasoning' | 'context'; step?: number }[],
): TurnAnswerBoundary | undefined {
  if (replies.length === 0) return undefined
  const answerStep = Math.max(...replies.map(reply => reply.step))
  if (steps.some(step => step.kind === 'tool' && step.step === answerStep)) return undefined
  /* 最后一步里**带文字**的最后一条：空文字的纯图片消息不充当最终回答。 */
  const candidates = replies.filter(reply => reply.step === answerStep && reply.text.trim() !== '')
  const answer = candidates[candidates.length - 1]
  if (answer === undefined) return undefined
  return {
    step: answerStep,
    replyId: answer.id,
    messageCount: replies.filter(reply => reply.step < answerStep).length,
  }
}

/** One turn: what the reader said, what happened, what came out. */
export interface TranscriptTurn {
  /** 宿主给这一轮的编号。 */
  turn: number
  /** 触发这一轮的那句话；窗口把它切掉时缺席（过程与回复照样画）。 */
  trigger?: {
    id: string
    text: string
    images?: TranscriptImage[]
    at: number
  }
  /** 这一轮里读者中途插的话（非空 = 这一轮永不折）。 */
  interjections: TranscriptInterjection[]
  /** 过程行，按发生顺序。 */
  steps: TranscriptStep[]
  /** 这一轮的助手回复，按发生顺序（`final` 档只露最后一条）。 */
  replies: TranscriptReply[]
  /** 最终回答从哪一步开始（官方边界）；拿不出来时为 undefined。 */
  answer?: TurnAnswerBoundary
  /** 这一轮结束时的时间戳；还在跑或窗口里没有 `turn/end` 时为 undefined。 */
  endedAt?: number
  /** 结束原因（`completed` / `aborted` / `interrupted` / 其他）。 */
  endReason?: string
}

/** The raw history-event slice the fold reads (structural, narrowed). */
export interface TranscriptEvent {
  type: string
  seq?: number
  time?: number
  data?: unknown
}

/** The structural shape of a `user/message` payload (flat, not wrapped). */
interface UserMessageShape {
  id?: unknown
  content?: unknown
  source?: {
    kind?: unknown
    summary?: unknown
    /** `skill-invocation` names the skill it invoked. */
    name?: unknown
    /** `session-reference` lists the sessions it snapshotted. */
    references?: unknown
    /** `agent-instructions` lists the instruction files it loaded/changed. */
    changes?: unknown
  }
}

/** The structural shape of an `assistant/message` payload (message wrapped). */
interface AssistantMessageShape {
  turn?: unknown
  step?: unknown
  message?: { id?: unknown; content?: unknown }
  usage?: unknown
}

/** One non-empty string member of a structural record, else undefined. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A usable turn number, else undefined. */
function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** The distinct non-empty `field` values of one list member, joined in
 *  appearance order; undefined when the member is absent or carries none. */
function joinedFieldOf(list: unknown, field: string): string | undefined {
  if (!Array.isArray(list)) return undefined
  const seen: string[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const value = nonEmptyString((entry as Record<string, unknown>)[field])
    if (value !== undefined && !seen.includes(value)) seen.push(value)
  }
  return seen.length > 0 ? seen.join(', ') : undefined
}

/**
 * The producer label of one context source, mirroring the official
 * `contextProducer` grammar (`dsh-client-ui-trajectory`): the three kinds that
 * point at the data they injected name THAT — the referenced sessions'
 * labels, the instruction files' paths, the skill's name — and every other
 * kind is its own label. A source with no usable kind is the generic
 * `context` row.
 */
function contextProducerOf(source: UserMessageShape['source']): string {
  if (source === undefined) return 'context'
  const kind = nonEmptyString(source.kind)
  if (kind === undefined) return 'context'
  switch (kind) {
    case 'session-reference': return joinedFieldOf(source.references, 'label') ?? kind
    case 'agent-instructions': return joinedFieldOf(source.changes, 'path') ?? kind
    case 'skill-invocation': return nonEmptyString(source.name) ?? kind
    default: return kind
  }
}

/**
 * 一段思考的识别与摘要：`content` 里的 `reasoning` 块。
 *
 * 只留**字数与首行**。整段思考通常几千字，折行里放不下、留在内存里也不划算；
 * 而「让读者知道它想了一下」只需要这两样。
 * @param content - 助手消息的 content。
 * @returns 每一段思考的摘要（空数组 = 没有思考）。
 */
export function reasoningOf(content: unknown): { chars: number; preview: string }[] {
  if (!Array.isArray(content)) return []
  const out: { chars: number; preview: string }[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const entry = block as { type?: unknown; text?: unknown }
    if (entry.type !== 'reasoning' || typeof entry.text !== 'string') continue
    const text = entry.text.trim()
    if (text === '') continue
    out.push({ chars: text.length, preview: firstLineOf(text) })
  }
  return out
}

/**
 * 一段文本的首行，压到一个窄折行放得下的长度。
 * @param text - 原文。
 * @returns 首行（过长时截断）。
 */
function firstLineOf(text: string): string {
  const line = text.split('\n').find(one => one.trim() !== '') ?? ''
  const trimmed = line.trim()
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed
}

/**
 * The structural shape of one `tool/result` payload: the wrapped message names
 * the call it answers and says whether it failed.
 */
interface ToolResultShape {
  message?: { toolCallId?: unknown; isError?: unknown }
  turn?: unknown
  step?: unknown
}

/** The structural shape of one `tool/call` payload. */
interface ToolCallShape {
  turn?: unknown
  step?: unknown
  callId?: unknown
  name?: unknown
}

/**
 * Fold history events into turns (see module doc).
 *
 * 分组键是**轮号**：`turn/start` 开一轮，`turn/end` 收一轮，中间的事件按自己的
 * `data.turn` 归队；没有轮号的事件（注入、以及窗口被切掉时留下的消息）落在
 * 「当前这一轮」里。窗口从半轮开始时，第一条带轮号的助手消息会合成那一轮。
 * @param events - 会话历史事件（顺序即发生顺序）。
 * @returns 轮列表（按首次出现顺序）。
 */
export function foldTurns(events: readonly TranscriptEvent[]): TranscriptTurn[] {
  const turns = new Map<number, TranscriptTurn>()
  /** 落位轮号：没有轮号的事件落进它。 */
  let cursor = 0
  /** 下一轮要用的人工轮号（窗口里没有 `turn/start` 时）。 */
  let synthetic = 0
  /** 全局到达计数器：**画序的唯一真相**（见 `TranscriptReply.order`）。 */
  let order = 0
  /** 最后见到的步号：`user/message` 不带步号，插话要落进它被打断的那一步。 */
  let lastStep = 0
  /** `callId → 那条 tool 步骤`，供 `tool/result` 回填状态。 */
  const openCalls = new Map<string, Extract<TranscriptStep, { kind: 'tool' }>>()

  const turnOf = (turn: number): TranscriptTurn => {
    const existing = turns.get(turn)
    if (existing !== undefined) return existing
    const created: TranscriptTurn = { turn, interjections: [], steps: [], replies: [] }
    turns.set(turn, created)
    return created
  }

  for (const event of events) {
    const at = typeof event.time === 'number' ? event.time : 0
    const fallbackId = String(event.seq ?? `${event.type}:${at}`)
    const data = event.data
    if (typeof data !== 'object' || data === null) continue

    if (event.type === 'turn/start') {
      const turn = numberOf((data as { turn?: unknown }).turn)
      if (turn !== undefined) {
        cursor = turn
        turnOf(turn)
      }
      continue
    }

    if (event.type === 'turn/end') {
      const row = data as { turn?: unknown; reason?: { kind?: unknown } }
      const turn = numberOf(row.turn)
      if (turn === undefined) continue
      const target = turnOf(turn)
      target.endedAt = at
      const kind = nonEmptyString(row.reason?.kind)
      if (kind !== undefined) target.endReason = kind
      continue
    }

    if (event.type === 'user/message') {
      const row = data as UserMessageShape
      const text = contentTextOf(row.content)
      const images = contentImagesOf(row.content)
      if (text === '' && images.length === 0) continue
      const id = String(row.id ?? fallbackId)
      if (row.source?.kind !== 'user') {
        /* 注入不是读者的话：它是那一轮的过程之一。 */
        turnOf(cursor).steps.push({
          kind: 'context',
          id,
          producer: contextProducerOf(row.source),
          summary: typeof row.source?.summary === 'string' ? row.source.summary : '',
          at,
          order: (order += 1),
        })
        continue
      }
      const target = turnOf(cursor)
      /* 这一轮里**第一句**读者的话就是触发句；之后的都是中途插话。
         判据只看「有没有过触发句」，不看过程走到哪一步——运行时上下文与指令文件
         都在读者那句话**之前**注入，按「过程为空」判会把真正的问题降级成插话。 */
      if (target.trigger === undefined) {
        target.trigger = { id, text, ...images.length > 0 ? { images } : {}, at }
      } else {
        /* 插话记下**到达时的步号与次序**：它要画在真正被打断的那个位置上，
           而不是被收进某个「插话区」——那样读者就看不出它打断了哪一步。 */
        target.interjections.push({
          id,
          text,
          ...images.length > 0 ? { images } : {},
          at,
          step: lastStep,
          order: (order += 1),
        })
      }
      continue
    }

    if (event.type === 'assistant/message') {
      const row = data as AssistantMessageShape
      const message = row.message
      if (typeof message !== 'object' || message === null) continue
      const declared = numberOf(row.turn)
      if (declared !== undefined) {
        /* 窗口可能没给 `turn/start`：以助手消息自带的轮号为准，合成那一轮。 */
        if (!turns.has(declared)) cursor = declared
      }
      const turn = declared ?? (turns.has(cursor) ? cursor : (synthetic += 1))
      const target = turnOf(turn)
      const step = numberOf(row.step) ?? 0
      lastStep = step
      const text = contentTextOf(message.content)
      const images = contentImagesOf(message.content)
      const id = String(message.id ?? fallbackId)
      const reasoning = reasoningOf(message.content)
      for (const [index, one] of reasoning.entries()) {
        target.steps.push({ kind: 'reasoning', id: `${id}:r${index}`, chars: one.chars, preview: one.preview, step, order: (order += 1) })
      }
      if (text === '' && images.length === 0) continue
      const usage = row.usage
      target.replies.push({
        id,
        text,
        ...images.length > 0 ? { images } : {},
        at,
        step,
        order: (order += 1),
        ...usage !== undefined && isUsage(usage) ? { usage } : {},
      })
      continue
    }

    if (event.type === 'tool/call') {
      const row = data as ToolCallShape
      const turn = numberOf(row.turn) ?? (turns.has(cursor) ? cursor : (synthetic += 1))
      const target = turnOf(turn)
      const callId = nonEmptyString(row.callId) ?? fallbackId
      const callStep = numberOf(row.step) ?? 0
      lastStep = callStep
      const step: Extract<TranscriptStep, { kind: 'tool' }> = {
        kind: 'tool',
        id: callId,
        name: nonEmptyString(row.name) ?? 'tool',
        state: 'running',
        step: callStep,
        order: (order += 1),
      }
      target.steps.push(step)
      openCalls.set(callId, step)
      continue
    }

    if (event.type === 'tool/result') {
      const row = data as ToolResultShape
      const callId = nonEmptyString(row.message?.toolCallId)
      if (callId === undefined) continue
      const called = openCalls.get(callId)
      if (called === undefined) continue
      /* 失败也是一种结算，但界面要能说出「它失败了」——所以状态只有三档，
         而已结束的轮里仍挂着的调用由下面的收尾统一标成 `unsettled`。 */
      called.state = 'settled'
      openCalls.delete(callId)
      continue
    }
  }

  /* 收尾：已经结束的轮里还挂着 `running` 的调用，说明结果没进这个窗口——
     说 `unsettled`（未结算），不谎称成功也不谎称失败。 */
  for (const turn of turns.values()) {
    if (turn.endedAt === undefined) continue
    for (const step of turn.steps) if (step.kind === 'tool' && step.state === 'running') step.state = 'unsettled'
  }

  /* 最终回答边界：过程行全部收齐之后才算（边界要问「那一步有没有工具调用」，
     而工具调用是在这一轮里陆续到达的）。 */
  for (const turn of turns.values()) {
    const boundary = answerBoundaryOf(turn.replies, turn.steps)
    if (boundary !== undefined) turn.answer = boundary
  }

  return [...turns.values()].sort((a, b) => a.turn - b.turn)
}

/**
 * 一条消息内容里带的那些耐久图片引用（结构性读取）。
 *
 * **整份走，不逐项重建。** 官方那份引用是 `ImageAttachmentRef`，宿主读图时会
 * 校验它的每个字段；手抄一份字段表就是漏字段——`originalDimensions` 就是这么
 * 被漏掉的（`tests/attachment-contract.spec.ts` 逐字段比出来才发现）。
 *
 * 所以：必填项在（校验通过就说明它是一份合法引用），就**原样带走**整份对象，
 * 官方以后再加字段，我们不需要改两处；必填项缺一项的那张跳过（读回来也过不了
 * 校验，发出去只会得到一句「图片坏了」）。
 * @param content - 一条消息的 `content` 数组。
 * @returns 去重后的引用，按出现顺序。
 */
export function contentImagesOf(content: unknown): TranscriptImage[] {
  if (!Array.isArray(content)) return []
  const out: TranscriptImage[] = []
  const seen = new Set<string>()
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const row = part as Record<string, unknown>
    if (row.type !== 'image') continue
    const attachment = row.attachment
    if (typeof attachment !== 'object' || attachment === null) continue
    const ref = attachment as Record<string, unknown>
    if (typeof ref.attachmentId !== 'string' || ref.attachmentId === '') continue
    if (seen.has(ref.attachmentId)) continue
    seen.add(ref.attachmentId)
    if (typeof ref.mediaType !== 'string' || ref.mediaType === '') continue
    if (typeof ref.bytes !== 'number' || !Number.isFinite(ref.bytes)) continue
    if (typeof ref.width !== 'number' || !Number.isFinite(ref.width)) continue
    if (typeof ref.height !== 'number' || !Number.isFinite(ref.height)) continue
    /* 整份对象原样拿走（含官方将来加的字段）。`undefined` 值的键不带走——
       一份带 `name: undefined` 的引用在 JSON 上与原样相同，但会让逐字段比较变脏。 */
    const carried: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(ref)) {
      if (value !== undefined) carried[key] = value
    }
    out.push(carried as unknown as TranscriptImage)
  }
  return out
}

/** Structural guard for the native token-accounting payload. */
function isUsage(value: unknown): value is TranscriptUsage {
  if (typeof value !== 'object' || value === null) return false
  const usage = value as Record<string, unknown>
  return typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number'
}

/**
 * 一轮里「过程行 / 回复 / 读者插话」按**真实发生顺序**排成一条流。
 *
 * 这是「顺序对不上」那个病根的治法：过程与回复各自被收进两个数组，画的时候如果
 * 先摆完所有工具再摆所有话，读者看到的就是「四十行工具堆在上面、两句话接在下面」，
 * 而真实发生的是「思考 → 调工具 → 说一句 → 再调工具」。到达次序（`order`）是唯一真相，
 * 排序只在这里做一次。
 * @param turn - 一轮。
 * @returns 按 `order` 升序的流单元。
 */
export function flowOf(turn: TranscriptTurn): TurnFlowItem[] {
  const items: TurnFlowItem[] = [
    ...turn.steps.map(step => ({ kind: 'step' as const, order: step.order, step })),
    ...turn.replies.map(reply => ({ kind: 'reply' as const, order: reply.order, reply })),
    ...turn.interjections.map(interjection => ({ kind: 'reader' as const, order: interjection.order, interjection })),
  ]
  return items.sort((a, b) => a.order - b.order)
}

/** Sum the token accounting of every assistant reply in a turn list. */
export function sumUsage(turns: readonly TranscriptTurn[]): TranscriptUsage | undefined {
  let total: TranscriptUsage | undefined
  for (const turn of turns) {
    for (const reply of turn.replies) {
      if (reply.usage === undefined) continue
      const usage = reply.usage
      total = {
        inputTokens: (total?.inputTokens ?? 0) + usage.inputTokens,
        outputTokens: (total?.outputTokens ?? 0) + usage.outputTokens,
        ...usage.cacheReadTokens !== undefined
          ? { cacheReadTokens: (total?.cacheReadTokens ?? 0) + usage.cacheReadTokens } : {},
        ...usage.cacheWriteTokens !== undefined
          ? { cacheWriteTokens: (total?.cacheWriteTokens ?? 0) + usage.cacheWriteTokens } : {},
        ...usage.reasoningTokens !== undefined
          ? { reasoningTokens: (total?.reasoningTokens ?? 0) + usage.reasoningTokens } : {},
      }
    }
  }
  return total
}
