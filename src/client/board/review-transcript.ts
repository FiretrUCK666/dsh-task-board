/**
 * Review-page transcript: fold a raw session-history event list into the
 * tail of the conversation, following the native harness folding rules:
 * - `user/message` with `source.kind === 'user'` is a user bubble (the
 *   message's text blocks).
 * - `user/message` with any other source kind (plugin/system injections —
 *   skills, AGENTS.md, runtime context, cron notices…) is a context row:
 *   the native conversation shows these as a weak "context injection" row,
 *   never as a user bubble. The review page renders them the same way,
 *   collapsed (the full text lives in the native session page).
 * - `assistant/message` carries its message under `data.message` (with
 *   `turn`/`step`/`usage` alongside) — different from the flat
 *   `user/message` shape — and its text/reasoning blocks form the
 *   assistant message.
 * - Tool results and every other event are not part of the message
 *   surface and are skipped.
 * Pure and framework-free so the fold unit-tests in isolation.
 */

/** One rendered transcript line: a real message or a context-injection row. */
export type TranscriptLine =
  | {
    kind: 'message'
    /** Stable message id (falls back to the event sequence). */
    id: string
    role: 'user' | 'assistant'
    /** The message's text (text blocks joined; empty messages are dropped). */
    text: string
    /** Event timestamp (ms epoch); 0 when the event carried none. */
    at: number
    /** Token accounting reported with the assistant message, when present. */
    usage?: TranscriptUsage
  }
  | {
    kind: 'context'
    /** Fallback identity (the event sequence). */
    id: string
    /** The injecting plugin's name (native context rows name their source). */
    plugin: string
    /** One-line account when the injection carries one (notice form). */
    summary: string
    /** Event timestamp (ms epoch); 0 when the event carried none. */
    at: number
  }

/** Token accounting of one assistant message (native `usage` payload). */
export interface TranscriptUsage {
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
    plugin?: unknown
    summary?: unknown
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
        // System/plugin injection: a context row, never a user bubble.
        lines.push({
          kind: 'context',
          id: String(data.id ?? fallbackId),
          plugin: typeof data.source?.plugin === 'string' ? data.source.plugin : 'context',
          summary: typeof data.source?.summary === 'string' ? data.source.summary : '',
          at,
        })
        continue
      }
      const text = textOf(data.content)
      if (text === '') continue
      lines.push({
        kind: 'message',
        id: String(data.id ?? fallbackId),
        role: 'user',
        text,
        at,
      })
    } else if (event.type === 'assistant/message') {
      const data = event.data as AssistantMessageShape | null
      if (typeof data !== 'object' || data === null) continue
      const message = data.message
      if (typeof message !== 'object' || message === null) continue
      const text = textOf(message.content)
      if (text === '') continue
      const usage = data.usage
      lines.push({
        kind: 'message',
        id: String(message.id ?? fallbackId),
        role: 'assistant',
        text,
        at,
        ...usage !== undefined && isUsage(usage) ? { usage } : {},
      })
    }
  }
  return lines
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

/** Join a message's text blocks (each trimmed); returns '' when there is no text. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const entry = block as { type?: unknown; text?: unknown }
    if (entry.type === 'text' && typeof entry.text === 'string') {
      const text = entry.text.trim()
      if (text !== '') parts.push(text)
    }
  }
  return parts.join('\n')
}
