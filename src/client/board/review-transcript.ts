/**
 * Review-page transcript: fold a raw session-history event list into the
 * tail of the conversation, following the native harness folding rules:
 * - `user/message` with `source.kind === 'user'` is a user bubble (the
 *   message's text blocks).
 * - `user/message` with any other source kind (system and producer
 *   injections — skills, AGENTS.md, runtime context, cron notices…) is a
 *   context row labelled by that kind: the native conversation shows these
 *   as a weak "context injection" row, never as a user bubble. The review
 *   page renders them the same way, collapsed (the full text lives in the
 *   native session page).
 * - `assistant/message` carries its message under `data.message` (with
 *   `turn`/`step`/`usage` alongside) — different from the flat
 *   `user/message` shape — and its text/reasoning blocks form the
 *   assistant message.
 * - Tool results and every other event are not part of the message
 *   surface and are skipped.
 * Pure and framework-free so the fold unit-tests in isolation.
 */
import { contentTextOf } from '../../core/session-activity.ts'

/** One image attached to a message — the DURABLE ref form the host stores
 *  after admission (the browser submitted temporary bytes; the stored event
 *  carries the promoted reference). Renderers fetch the bytes through the
 *  official `sessions.attachment` read. */
export interface TranscriptImage {
  attachmentId: string
  mediaType: string
  name?: string
}

/** One rendered transcript line: a real message or a context-injection row. */
export type TranscriptLine =
  | {
    kind: 'message'
    /** Stable message id (falls back to the event sequence). */
    id: string
    role: 'user' | 'assistant'
    /** The message's text (text blocks joined; image-only messages carry ''). */
    text: string
    /** Images attached to the message (empty/absent when none). */
    images?: TranscriptImage[]
    /** Event timestamp (ms epoch); 0 when the event carried none. */
    at: number
    /** Token accounting reported with the assistant message, when present. */
    usage?: TranscriptUsage
  }
  | {
    kind: 'context'
    /** Fallback identity (the event sequence). */
    id: string
    /** The injection's producer label — its durable source kind, or for the
     *  three data-bearing kinds the thing it injected (see
     *  {@link contextProducerOf}); native context rows name their source. */
    producer: string
    /** One-line account when the injection carries one (notice form). */
    summary: string
    /** Event timestamp (ms epoch); 0 when the event carried none. */
    at: number
  }

/** Token accounting of one assistant message (native `usage` payload). */
interface TranscriptUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
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

/** One non-empty string member of a structural record, else undefined. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
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

/** The structural shape of an `assistant/message` payload (message wrapped). */
interface AssistantMessageShape {
  message?: {
    id?: unknown
    content?: unknown
  }
  usage?: TranscriptUsage
}

/**
 * Fold history events into the conversation tail (see module doc). Only
 * append-surface user and assistant messages produce lines; everything else
 * (tool results, chunks, turn markers) is skipped.
 */
export function foldTranscript(events: readonly TranscriptEvent[]): TranscriptLine[] {
  const lines: TranscriptLine[] = []
  for (const event of events) {
    const at = typeof event.time === 'number' ? event.time : 0
    const fallbackId = String(event.seq ?? lines.length)
    if (event.type === 'user/message') {
      const data = event.data as UserMessageShape | null
      if (typeof data !== 'object' || data === null) continue
      if (data.source?.kind !== 'user') {
        // Not a user bubble: a system/producer injection becomes a context
        // row labelled by its durable source kind.
        lines.push({
          kind: 'context',
          id: String(data.id ?? fallbackId),
          producer: contextProducerOf(data.source),
          summary: typeof data.source?.summary === 'string' ? data.source.summary : '',
          at,
        })
        continue
      }
      const text = contentTextOf(data.content)
      const images = contentImagesOf(data.content)
      if (text === '' && images.length === 0) continue
      lines.push({
        kind: 'message',
        id: String(data.id ?? fallbackId),
        role: 'user',
        text,
        ...images.length > 0 ? { images } : {},
        at,
      })
    } else if (event.type === 'assistant/message') {
      const data = event.data as AssistantMessageShape | null
      if (typeof data !== 'object' || data === null) continue
      const message = data.message
      if (typeof message !== 'object' || message === null) continue
      const text = contentTextOf(message.content)
      const images = contentImagesOf(message.content)
      if (text === '' && images.length === 0) continue
      const usage = data.usage
      lines.push({
        kind: 'message',
        id: String(message.id ?? fallbackId),
        role: 'assistant',
        text,
        ...images.length > 0 ? { images } : {},
        at,
        ...usage !== undefined && isUsage(usage) ? { usage } : {},
      })
    }
  }
  return lines
}

/**
 * The durable image refs one message content carries (structural): parts of
 * the shape `{type:'image', attachment:{attachmentId, mediaType, name?}}` —
 * exactly what the host stores after promoting the submitted bytes. Anything
 * malformed is skipped (never a crash on an unknown part).
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
    out.push({
      attachmentId: ref.attachmentId,
      mediaType: typeof ref.mediaType === 'string' ? ref.mediaType : 'image/png',
      ...typeof ref.name === 'string' && ref.name !== '' ? { name: ref.name } : {},
    })
  }
  return out
}

/** Structural guard for the native token-accounting payload. */
function isUsage(value: unknown): value is TranscriptUsage {
  if (typeof value !== 'object' || value === null) return false
  const usage = value as Record<string, unknown>
  return typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number'
}

/** Sum the token accounting of every assistant message in a transcript. */
export function sumUsage(lines: readonly TranscriptLine[]): TranscriptUsage | undefined {
  let total: TranscriptUsage | undefined
  for (const line of lines) {
    if (line.kind !== 'message' || line.usage === undefined) continue
    const usage = line.usage
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
  return total
}
