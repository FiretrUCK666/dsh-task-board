/**
 * Pending `ask_user_question` answers over the official mirror.
 *
 * On dsh 0.1.5 the waterfall is a CLAIM chain (first answer wins, never a
 * broadcast), so the board never registers its own answerer — answering stays
 * in the native session and the board only mirrors the official
 * `pendingInteractions` snapshot (see question-mirror.ts). This module keeps
 * the historical wire model (frame normalization, the per-rpcId pending
 * projection, answer assembly and the plan-review grammar) for the legacy
 * tracker path; the mirror path renders from `MirrorQuestion` instead.
 * Framework-free and DOM-free, so the rules unit-test in isolation. The live
 * stream and the wire calls live in the client tracker; the controller
 * exposes a thin `QuestionRpcFace`.
 *
 * Frame identity: the host mints one rpcId per open `ask()` and replays it
 * verbatim on reconnects (refresh-recovery baseline), so the answer echoes
 * the requested frame's rpcId, never a minted one.
 */

/** One normalized question item (unknown shapes trimmed to the wire contract). */
export interface WireQuestionItem {
  /** Stable caller-provided question id, echoed in the answer. */
  id: string
  /** The question to display. */
  question: string
  /** Optional supporting detail (kept out of option labels). */
  detail?: string
  /** Optional short heading/group label. */
  header?: string
  /** Optional choices a capable UI can render as a menu. */
  options?: readonly { label: string; description?: string }[]
  /** Whether more than one option may be selected (defaults to single). */
  multiSelect?: boolean
  /** Plan-review intent: the question IS a plan awaiting confirmation. */
  intent?: { kind: 'plan-review'; approve: string }
}

/** One pending question batch on the wire, keyed for answering. */
export interface WireQuestion {
  /** The host-minted rpcId the answer must echo. */
  rpcId: string
  /** The session the question was asked in. */
  sessionId: string
  /** The whole question batch (one ask, many questions, one answer). */
  questions: readonly WireQuestionItem[]
  /** True when any question declares a plan-review intent. */
  isPlanReview: boolean
}

/** One question's local draft: selections + optional free text. */
export interface QuestionDraft {
  selected: string[]
  custom?: string
  /** Explicitly skipped (submitted as an empty selection). */
  skipped?: boolean
}

/** One answered question in the answer batch (skip = empty selected). */
export interface QuestionAnswerEntry {
  id: string
  selected: string[]
  custom?: string
}

/** The legacy frames this model consumes (narrowed structural slices). */
export type QuestionFrameIn =
  | { type: 'question/requested'; rpcId: string; sessionId: string; questions: unknown }
  | { type: 'question/resolved'; questionRpcId: string }

/** Plan-review decision a UI can send (see planDecisionAnswers). */
export type PlanDecision = 'approve' | 'decline'

/** The controller's thin question surface (implemented by the live tracker
 *  or the official mirror; absent when the host wire is unavailable —
 *  surfaces then hide the card). On 0.1.5 the mirror never answers in place
 *  (`answerInPlace` is false): the card navigates to the native session. */
export interface QuestionRpcFace {
  /** The pending wire question for one session (newest wins), if any. */
  pendingOf(sessionId: string | undefined): WireQuestion | undefined
  /** React to pending-question changes (requested/resolved frames). */
  subscribe(listener: () => void): () => void
  /** Whether the board answers in place (false = navigate to answer). */
  readonly answerInPlace?: boolean
  /** Deliver the whole answer batch; false = the host rejected it. */
  answer(rpcId: string, sessionId: string, answers: readonly QuestionAnswerEntry[]): Promise<boolean>
  /** Reject the whole ask (the host resolves the tool call as cancelled). */
  cancel(rpcId: string): Promise<boolean>
}

/** Normalize one wire question item; drop anything malformed. */
export function normalizeWireQuestion(value: unknown): WireQuestionItem | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const source = value as Record<string, unknown>
  const questionText = typeof source.question === 'string' ? source.question : ''
  if (questionText === '') return undefined
  const item: WireQuestionItem = {
    id: typeof source.id === 'string' && source.id !== '' ? source.id : questionText,
    question: questionText,
  }
  if (typeof source.detail === 'string') item.detail = source.detail
  if (typeof source.header === 'string') item.header = source.header
  if (Array.isArray(source.options)) {
    const options = source.options
      .map((option): { label: string; description?: string } | undefined => {
        if (typeof option !== 'object' || option === null) return undefined
        const entry = option as Record<string, unknown>
        if (typeof entry.label !== 'string') return undefined
        const result: { label: string; description?: string } = { label: entry.label }
        if (typeof entry.description === 'string') result.description = entry.description
        return result
      })
      .filter((option): option is { label: string; description?: string } => option !== undefined)
    if (options.length > 0) item.options = options
  }
  if (source.multiSelect === true || source.multiSelect === 'true') item.multiSelect = true
  const intent = source.intent
  if (typeof intent === 'object' && intent !== null) {
    const intentSource = intent as Record<string, unknown>
    if (intentSource.kind === 'plan-review' && typeof intentSource.approve === 'string') {
      item.intent = { kind: 'plan-review', approve: intentSource.approve }
    }
  }
  return item
}

/** Normalize a whole wire question list; undefined when nothing is usable. */
export function wireQuestionsOf(value: unknown): WireQuestionItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const questions = value
    .map(normalizeWireQuestion)
    .filter((question): question is WireQuestionItem => question !== undefined)
  return questions.length > 0 ? questions : undefined
}

/** Immutable application of one legacy frame onto the pending map (same map on no-op). */
export function reduceQuestionFrames(
  pending: ReadonlyMap<string, WireQuestion>,
  frame: QuestionFrameIn,
): ReadonlyMap<string, WireQuestion> {
  if (frame.type === 'question/resolved') {
    if (!pending.has(frame.questionRpcId)) return pending
    const next = new Map(pending)
    next.delete(frame.questionRpcId)
    return next
  }
  const questions = wireQuestionsOf(frame.questions)
  if (questions === undefined) return pending
  const existing = pending.get(frame.rpcId)
  if (existing !== undefined && existing.sessionId === frame.sessionId
    && existing.questions.length === questions.length
    && existing.questions.every((item, index) => questionItemKey(item) === questionItemKey(questions[index]))) {
    return pending
  }
  const next = new Map(pending)
  next.set(frame.rpcId, {
    rpcId: frame.rpcId,
    sessionId: frame.sessionId,
    questions,
    isPlanReview: questions.some(item => item.intent?.kind === 'plan-review'),
  })
  return next
}

/** A stable content key of one question item (dedupe/idempotence comparison). */
function questionItemKey(item: WireQuestionItem): string {
  return `${item.id}|${item.question}|${item.detail ?? ''}|${item.header ?? ''}|${item.multiSelect === true ? 'm' : 's'}|${item.intent?.approve ?? ''}|${(item.options ?? []).map(option => option.label).join(',')}`
}

/** The pending wire question for one session (newest wins), when any. */
export function pendingQuestionOf(
  pending: ReadonlyMap<string, WireQuestion>,
  sessionId: string | undefined,
): WireQuestion | undefined {
  if (sessionId === undefined) return undefined
  let latest: WireQuestion | undefined
  for (const question of pending.values()) {
    if (question.sessionId === sessionId) latest = question
  }
  return latest
}

/** The plan-review question of a batch, when the batch IS a plan review. */
export function planQuestionOf(question: WireQuestion): WireQuestionItem | undefined {
  return question.questions.find(item => item.intent?.kind === 'plan-review')
}

/** The approve label of a plan-review question (the intent names it). */
export function approveLabelOf(item: WireQuestionItem | undefined): string | undefined {
  if (item?.intent?.kind === 'plan-review') return item.intent.approve
  return item?.options?.[0]?.label
}

/** The decline label of a plan-review question (first non-approve option). */
export function declineLabelOf(item: WireQuestionItem | undefined): string | undefined {
  const approve = item?.intent?.approve
  if (approve === undefined) return undefined
  return item?.options?.find(option => option.label !== approve)?.label
}

/**
 * The answer batch for a plan-review decision.
 * - approve: select the intent's approve label;
 * - decline without amendments: select the first non-approve option;
 * - decline with amendments: revise-with-feedback — a custom-only answer
 *   (host validation forbids a single-select option alongside custom text).
 */
export function planDecisionAnswers(
  item: WireQuestionItem,
  decision: PlanDecision,
  amend: string,
): QuestionAnswerEntry[] {
  const trimmed = amend.trim()
  if (decision === 'decline' && trimmed !== '') {
    return [{ id: item.id, selected: [], custom: trimmed }]
  }
  if (decision === 'approve') {
    const label = approveLabelOf(item)
    return label !== undefined ? [{ id: item.id, selected: [label] }] : [{ id: item.id, selected: [] }]
  }
  const label = declineLabelOf(item)
  return label !== undefined ? [{ id: item.id, selected: [label] }] : [{ id: item.id, selected: [] }]
}

/**
 * The whole answer batch from per-question drafts: one entry per question,
 * in batch order, ids matching the requested frame (a skipped question is an
 * empty selection; a missing answer is a server-side rejection, never sent
 * silently). Custom text rides alongside selections only for multi-select.
 */
export function answerBatchOf(
  question: WireQuestion,
  drafts: readonly QuestionDraft[],
): QuestionAnswerEntry[] {
  return question.questions.map((item, index) => {
    const draft = drafts[index] ?? { selected: [] }
    const custom = draft.custom?.trim() ?? ''
    return {
      id: item.id,
      selected: [...draft.selected],
      ...(custom !== '' && (item.multiSelect === true || draft.selected.length === 0) ? { custom } : {}),
    }
  })
}
