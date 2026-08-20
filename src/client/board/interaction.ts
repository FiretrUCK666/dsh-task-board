/**
 * Pending user interaction detection: the native agent pausing for a human
 * decision (a plan awaiting confirmation, or an ask_user_question) is a
 * `tool/call` event whose tool is `ask_user_question`, paired with the
 * `tool/result` that settles it. The board renders an interaction card over
 * the composer while such a call is still open, so the user can answer right
 * in the comment area — an answer is sent as a normal comment through the
 * existing steer/queue channel, which is exactly how the agent sees typing in
 * the native chat.
 *
 * Pure and framework-free so the open-call detection, argument parsing and
 * answer assembly are unit-testable without React or the runtime. The event
 * shapes are the narrow structural slice the review page already reads
 * (foldTranscript); only the tool-call fields are narrowed here.
 */
import type { TranscriptEventShape } from '../../core/controller.ts'

/** A native user-question item (the `ask_user_question` request shape). */
export interface InteractionQuestion {
  /** Stable caller-provided question id. */
  id: string
  /** The question to display. */
  question: string
  /** Optional supporting detail (kept out of option labels). */
  detail?: string
  /** Optional short heading/group label. */
  header?: string
  /** Optional choices a capable UI can render as a menu. */
  options?: Array<{ label: string; description?: string }>
  /** Whether more than one option may be selected (defaults to single). */
  multiSelect?: boolean
  /** Plan-review intent: the question IS a plan awaiting confirmation. */
  intent?: { kind: 'plan-review'; approve: string }
}

/** A parsed, human-readable plan/question awaiting an answer. */
export interface PendingInteraction {
  /** The first ask_user_question question block, parsed and wrapped: exactly
   *  one question when the tool sends one question, many for a questionnaire. */
  questions: readonly InteractionQuestion[]
  /** True when a question is a plan-review (render confirm/decline). */
  isPlanReview: boolean
  /** The callId of the open tool call (dedupe across polls). */
  callId: string
}

/** The structural slice of tool events we read (narrowed, unknown-tolerant). */
interface ToolCallShape {
  callId?: unknown
  name?: unknown
  arguments?: unknown
}

interface ToolResultBlock {
  callId?: unknown
}

/** Parse the tool's arguments JSON into question items (tolerant parser):
 *  the model writes `{ "questions": [...] }`, but a single-question request
 *  may arrive as `{ "question": ..., "options": [...] }` — wrap both. */
export function parseQuestionArgs(value: unknown): InteractionQuestion[] | undefined {
  if (typeof value !== 'string') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const object = parsed as Record<string, unknown>
  const rawQuestions = object.questions
  if (Array.isArray(rawQuestions)) {
    const questions = rawQuestions
      .map(normalizeQuestion)
      .filter((question): question is InteractionQuestion => question !== undefined)
    return questions.length > 0 ? questions : undefined
  }
  const single = normalizeQuestion(object)
  return single !== undefined ? [single] : undefined
}

/** Normalize one question item structurally; drop anything malformed. */
function normalizeQuestion(value: unknown): InteractionQuestion | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const source = value as Record<string, unknown>
  const questionText = typeof source.question === 'string' ? source.question : ''
  if (questionText === '') return undefined
  const item: InteractionQuestion = {
    id: typeof source.id === 'string' ? source.id : questionText,
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

/** Collect the callId of every settled `tool/result` (its message carries the
 *  call's id in its single tool block). */
function settledCallIds(events: readonly TranscriptEventShape[]): Set<string> {
  const settled = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const data = event.data as { message?: { content?: unknown } } | null
    const content = data?.message?.content
    if (!Array.isArray(content)) continue
    const block = content[0] as ToolResultBlock | null
    if (typeof block?.callId === 'string') settled.add(block.callId)
  }
  return settled
}

/**
 * Find the open `ask_user_question` call — the last one whose callId has no
 * matching `tool/result`. Returns its parsed questions, or undefined when no
 * question is awaiting the user.
 */
export function detectPendingInteraction(events: readonly TranscriptEventShape[]): PendingInteraction | undefined {
  if (!Array.isArray(events) || events.length === 0) return undefined
  const settled = settledCallIds(events)
  // Walk from the tail: the newest open ask_user_question wins.
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'tool/call') continue
    const data = (event.data ?? {}) as ToolCallShape
    if (data.name !== 'ask_user_question') continue
    const callId = typeof data.callId === 'string' ? data.callId : ''
    if (callId !== '' && settled.has(callId)) continue
    const questions = parseQuestionArgs(data.arguments)
    if (questions === undefined || questions.length === 0) continue
    const isPlanReview = questions.some(question => question.intent?.kind === 'plan-review')
    return { questions, isPlanReview, callId }
  }
  return undefined
}

/** The text sent when confirming a plan-review (the intent's approve label,
 *  or a plain confirmation when the tool omitted one). */
export function planConfirmText(interaction: PendingInteraction): string {
  const plan = interaction.questions.find(question => question.intent?.kind === 'plan-review')
  return plan?.intent?.approve ?? '确认，按此计划执行'
}

/** The text sent for a declined plan; the caller replaces `{reason}`. */
export const PLAN_DECLINE_TEMPLATE = '计划需要修改：{reason}'

/**
 * Assemble one answer message from the collected answers: each answered
 * question's selected labels (joined) plus any custom text, one per line —
 * the shape the agent in the native chat would read as plain typing.
 */
export function assembleAnswers(answers: ReadonlyArray<{ id: string; selected: readonly string[]; custom?: string }>): string {
  const lines = answers
    .map((answer) => {
      const parts = [...answer.selected]
      if (answer.custom !== undefined && answer.custom.trim() !== '') parts.push(answer.custom.trim())
      return parts.join(' · ')
    })
    .filter(line => line !== '')
  if (lines.length === 0) return ''
  return lines.join('\n')
}

/** One to-do row the native `todo/write` log event carries. */
export interface SessionTodo {
  /** What this task is — a short imperative line. */
  content: string
  /** Lifecycle state: pending / in_progress / completed. */
  status: 'pending' | 'in_progress' | 'completed'
}

/**
 * Read the latest `todo/write` snapshot out of a session's events (last-write
 * wins — the newest event holds the whole list). Returns the todo rows, or
 * undefined when the session never wrote one.
 */
export function latestSessionTodos(events: readonly TranscriptEventShape[]): SessionTodo[] | undefined {
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'todo/write') continue
    const data = event.data as { todos?: unknown } | null
    if (!Array.isArray(data?.todos)) return undefined
    const todos = data.todos
      .map((row): SessionTodo | undefined => {
        if (typeof row !== 'object' || row === null) return undefined
        const entry = row as Record<string, unknown>
        if (typeof entry.content !== 'string' || entry.content === '') return undefined
        const status = entry.status
        const normalized = status === 'in_progress' || status === 'completed' ? status : 'pending'
        return { content: entry.content, status: normalized }
      })
      .filter((row): row is SessionTodo => row !== undefined)
    return todos
  }
  return undefined
}

/** Whether one todo row is still open (not yet completed). */
export function isOpenTodo(row: SessionTodo): boolean {
  return row.status !== 'completed'
}
