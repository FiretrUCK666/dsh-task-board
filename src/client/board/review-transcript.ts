/**
 * Review-page transcript: fold a raw session-history event list into the
 * last messages of the conversation. The review page shows this tail (the
 * native session page remains the place for the full transcript), rendered
 * with the board's own message styling. Pure and framework-free so the fold
 * unit-tests in isolation.
 */

/** One rendered conversation message. */
export interface TranscriptMessage {
  /** Stable message id (falls back to the event sequence). */
  id: string
  role: 'user' | 'assistant'
  /** The message's text (text blocks joined; empty messages are dropped). */
  text: string
  /** Event timestamp (ms epoch); 0 when the event carried none. */
  at: number
}

/** The raw history-event slice the fold reads (structural, narrowed). */
export interface TranscriptEvent {
  type: string
  seq?: number
  time?: number
  data?: unknown
}

/**
 * Fold history events into the conversation tail: `user/message` and
 * `assistant/message` events become messages (their text blocks joined);
 * everything else (chunks, tool calls, turn markers) is not part of the
 * message surface and is skipped.
 */
export function foldTranscript(events: readonly TranscriptEvent[]): TranscriptMessage[] {
  const messages: TranscriptMessage[] = []
  for (const event of events) {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    if (typeof event.data !== 'object' || event.data === null) continue
    const message = event.data as { id?: unknown; role?: unknown; content?: unknown }
    const text = textOf(message.content)
    if (text === '') continue
    messages.push({
      id: typeof message.id === 'string' ? message.id : String(event.seq ?? messages.length),
      role: message.role === 'assistant' ? 'assistant' : 'user',
      text,
      at: typeof event.time === 'number' ? event.time : 0,
    })
  }
  return messages
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
