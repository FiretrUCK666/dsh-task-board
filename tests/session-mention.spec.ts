/**
 * Session-mention grammar tests: the official `@[label](dsh-session:…)`
 * mention mirror (see session-mention.ts). Expected strings were generated
 * by running the DEPLOYED module
 * (`@deepseek-ai/dsh-session-reference/lib/types/uri.js`) in Node — they are
 * the wire contract, not an approximation.
 */
import { describe, expect, it } from 'vitest'
import {
  encodeSessionReferenceUri,
  escapeSessionReferenceLabel,
  formatSessionReferenceMention,
} from '../src/client/board/session-mention.ts'

describe('session-mention (官方会话引用文法镜像)', () => {
  it('encodes session ids as base64url(JSON.stringify(id)) with the dsh-session scheme', () => {
    expect(encodeSessionReferenceUri('session-abc')).toBe('dsh-session:InNlc3Npb24tYWJjIg')
    expect(encodeSessionReferenceUri('069eee08-29fb-4e38-a4c5-814135078fff'))
      .toBe('dsh-session:IjA2OWVlZTA4LTI5ZmItNGUzOC1hNGM1LTgxNDEzNTA3OGZmZiI')
  })

  it('escapes the display label like the deployed grammar (backslash + brackets)', () => {
    expect(escapeSessionReferenceLabel('a[b]\\c')).toBe('a[b\\]\\\\c')
  })

  it('renders the canonical @[label](dsh-session:…) mention with a utf-8 label', () => {
    expect(formatSessionReferenceMention({ sessionId: 'session-abc', label: '绘画' }))
      .toBe('@[绘画](dsh-session:InNlc3Npb24tYWJjIg)')
  })

  it('falls back to the session id as the label when absent', () => {
    expect(formatSessionReferenceMention({ sessionId: 'x-1' }))
      .toBe('@[x-1](dsh-session:IngtMSI)')
  })

  it('produces the exact deployed output for escaped labels', () => {
    expect(formatSessionReferenceMention({ sessionId: 's1', label: 'a[b]\\c' }))
      .toBe('@[a[b\\]\\\\c](dsh-session:InMxIg)')
  })
})