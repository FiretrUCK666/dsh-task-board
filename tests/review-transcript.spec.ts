/**
 * Review-transcript tests: folding raw session-history events into the last
 * messages of a conversation.
 */
import { describe, expect, it } from 'vitest'
import { foldTranscript, type TranscriptEvent } from '../src/client/board/review-transcript.ts'

const base = { seq: 1, time: 1000 }

describe('foldTranscript', () => {
  it('folds user and assistant messages with their text blocks', () => {
    const events: TranscriptEvent[] = [
      { ...base, type: 'user/message', data: { id: 'm1', role: 'user', content: [{ type: 'text', text: '你好' }] } },
      { ...base, seq: 2, time: 2000, type: 'assistant/message', data: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '你好，我是 agent' }] } },
    ]
    expect(foldTranscript(events)).toEqual([
      { id: 'm1', role: 'user', text: '你好', at: 1000 },
      { id: 'm2', role: 'assistant', text: '你好，我是 agent', at: 2000 },
    ])
  })

  it('joins multiple text blocks and trims empty messages', () => {
    const events: TranscriptEvent[] = [
      { ...base, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '  a ' }, { type: 'text', text: ' b ' }] } },
      // Empty content and non-message events are skipped.
      { ...base, seq: 2, type: 'user/message', data: { role: 'user', content: [] } },
      { ...base, seq: 3, type: 'turn/start', data: { turn: 1 } },
      { ...base, seq: 4, type: 'tool/call', data: { name: 'bash' } },
    ]
    expect(foldTranscript(events)).toEqual([
      { id: '1', role: 'user', text: 'a\nb', at: 1000 },
    ])
  })

  it('falls back to the event sequence for messages without an id', () => {
    const events: TranscriptEvent[] = [
      { ...base, type: 'assistant/message', data: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    ]
    const folded = foldTranscript(events)
    expect(folded[0].id).toBe('1')
  })

  it('returns an empty list for an empty or all-skipped event list', () => {
    expect(foldTranscript([])).toEqual([])
    expect(foldTranscript([{ ...base, type: 'turn/end', data: { turn: 1 } }])).toEqual([])
  })
})
