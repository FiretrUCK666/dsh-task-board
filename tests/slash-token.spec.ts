/**
 * Slash-token logic tests: token scanning, candidate filtering and
 * insertion for the prompt's command autocomplete (commands + skills).
 */
import { describe, expect, it } from 'vitest'
import type { SlashCandidate } from '../src/core/controller.ts'
import {
  commandTokenAt, filterSlashCandidates, insertCommand, insertMention, mentionTokenAt,
} from '../src/client/board/slash-token.ts'

const CANDIDATES: readonly SlashCandidate[] = [
  { name: 'skills', description: 'List available skills', kind: 'command' },
  { name: 'permission', description: 'Switch permission', hint: 'preset key', kind: 'command' },
  { name: 'agent', description: 'Switch agent preset', kind: 'command' },
  { name: 'clear', description: 'Clear the conversation', kind: 'command' },
  { name: 'skill-a', description: 'Runs skill A', kind: 'skill' },
  { name: 'skill-b', description: 'Runs skill B', kind: 'skill' },
]

describe('commandTokenAt', () => {
  it('detects a token right after typing /', () => {
    const token = commandTokenAt('/', 1)
    expect(token).toEqual({ start: 0, end: 1, query: '', leading: true })
  })

  it('detects a token with a typed prefix at line start', () => {
    const token = commandTokenAt('/sk', 3)
    expect(token).toEqual({ start: 0, end: 3, query: 'sk', leading: true })
  })

  it('detects a token mid-line after a space', () => {
    const token = commandTokenAt('do this /pe', 11)
    expect(token).toEqual({ start: 8, end: 11, query: 'pe', leading: false })
  })

  it('detects a caret in the middle of a token word', () => {
    const token = commandTokenAt('/skillss', 4)
    expect(token).toEqual({ start: 0, end: 8, query: 'ski', leading: true })
  })

  it('returns undefined outside a slash token', () => {
    expect(commandTokenAt('hello', 5)).toBeUndefined()
    expect(commandTokenAt('a / b', 4)).toBeUndefined()
    expect(commandTokenAt('', 0)).toBeUndefined()
  })

  it('returns undefined when the caret sits on a separator', () => {
    expect(commandTokenAt('/sk ', 4)).toBeUndefined()
  })
})

describe('filterSlashCandidates', () => {
  it('returns everything for an empty query: commands first, then skills, sorted', () => {
    const names = filterSlashCandidates(CANDIDATES, '', true).map(row => row.name)
    expect(names).toEqual(['agent', 'clear', 'permission', 'skills', 'skill-a', 'skill-b'])
  })

  it('ranks command prefix matches first, then includes', () => {
    const names = filterSlashCandidates(CANDIDATES, 's', true).map(row => row.name)
    expect(names[0]).toBe('skills')
    expect(names).toContain('permission')
  })

  it('matches command names case-insensitively', () => {
    // 'ski' also prefixes the skill rows, so all three match.
    expect(filterSlashCandidates(CANDIDATES, 'SKI', true).map(row => row.name)).toEqual(
      ['skills', 'skill-a', 'skill-b'],
    )
  })

  it('hides hinted commands when the token is not at line start, but keeps skills', () => {
    const names = filterSlashCandidates(CANDIDATES, '', false).map(row => row.name)
    expect(names).not.toContain('permission')
    expect(names).toContain('skills')
    expect(names).toContain('skill-a')
  })

  it('keeps hinted commands at line start', () => {
    const names = filterSlashCandidates(CANDIDATES, '', true).map(row => row.name)
    expect(names).toContain('permission')
  })

  it('filters skills by prefix only', () => {
    const names = filterSlashCandidates(CANDIDATES, 'skill-', true).map(row => row.name)
    expect(names).toEqual(['skill-a', 'skill-b'])
  })

  it('mixes matching commands and skills, commands first', () => {
    // 'sk' prefixes both the 'skills' command and the skill rows.
    const names = filterSlashCandidates(CANDIDATES, 'sk', true).map(row => row.name)
    expect(names).toEqual(['skills', 'skill-a', 'skill-b'])
  })
})

describe('insertCommand', () => {
  it('replaces the token with a bare command', () => {
    const token = commandTokenAt('run /sk now', 6)!
    const result = insertCommand('run /sk now', token, { name: 'skills', description: '', kind: 'command' })
    expect(result.text).toBe('run /skills now')
    expect(result.caret).toBe(11)
  })

  it('appends a trailing space for a hinted command', () => {
    const token = commandTokenAt('/per', 4)!
    const result = insertCommand('/per', token, { name: 'permission', description: '', hint: 'preset key', kind: 'command' })
    expect(result.text).toBe('/permission ')
    expect(result.caret).toBe(12)
  })

  it('always appends a trailing space for a skill', () => {
    const token = commandTokenAt('/skill-', 7)!
    const result = insertCommand('/skill-', token, { name: 'skill-a', description: '', kind: 'skill' })
    expect(result.text).toBe('/skill-a ')
    expect(result.caret).toBe(9)
  })

  it('replaces the whole word when the caret is mid-token', () => {
    const token = commandTokenAt('/skillss', 4)!
    const result = insertCommand('/skillss', token, { name: 'skills', description: '', kind: 'command' })
    expect(result.text).toBe('/skills')
    expect(result.caret).toBe(7)
  })

  it('clears the query after a space', () => {
    expect(commandTokenAt('/skills ', 8)).toBeUndefined()
  })
})

describe('mentionTokenAt (官方 @ 文法委托 @deepseek-ai/dsh-file-reference)', () => {
  it('detects a plain @ token at line start', () => {
    expect(mentionTokenAt('@src', 4)).toEqual({ start: 0, end: 4, query: 'src', leading: true })
  })

  it('detects an @ token mid-line after a space', () => {
    expect(mentionTokenAt('see @src/a', 10)).toEqual({ start: 4, end: 10, query: 'src/a', leading: false })
  })

  it('detects an OPEN QUOTED path spanning whitespace (@")', () => {
    expect(mentionTokenAt('@"my file', 9)).toEqual({ start: 0, end: 9, query: 'my file', quoted: true, leading: true })
  })

  it('keeps an open quote alive after a directory descent (official descent)', () => {
    const token = mentionTokenAt('@"src/', 6)
    expect(token?.quoted).toBe(true)
    expect(token?.query).toBe('src/')
    expect(token?.start).toBe(0)
  })

  it('does not treat an @ inside a word (email) as a trigger', () => {
    expect(mentionTokenAt('a@b.com', 6)).toBeUndefined()
  })

  it('returns undefined outside an @ token', () => {
    expect(mentionTokenAt('hello', 5)).toBeUndefined()
    expect(mentionTokenAt('', 0)).toBeUndefined()
  })
})

describe('insertMention', () => {
  it('splices the official mention over the whole @ token and returns the caret', () => {
    const token = mentionTokenAt('@src', 4)!
    const result = insertMention('@src', token, '@[绘画](dsh-session:czc3) ')
    expect(result.text).toBe('@[绘画](dsh-session:czc3) ')
    expect(result.caret).toBe(24)
  })

  it('replaces the quoted token including the opening quote', () => {
    const token = mentionTokenAt('go @"my file', 12)!
    const result = insertMention('go @"my file', token, '@"src/main.ts" ')
    expect(result.text).toBe('go @"src/main.ts" ')
    expect(result.caret).toBe(18)
  })

  it('keeps the directory quote open for descent (@"path/)', () => {
    const token = mentionTokenAt('@"', 2)!
    const result = insertMention('@"', token, '@"src/')
    expect(result.text).toBe('@"src/')
    expect(result.caret).toBe(6)
  })
})
