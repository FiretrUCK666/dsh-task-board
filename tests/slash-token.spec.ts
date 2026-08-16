/**
 * Slash-token logic tests: token scanning, candidate filtering and
 * insertion for the prompt's command autocomplete.
 */
import { describe, expect, it } from 'vitest'
import {
  commandTokenAt, filterCommands, insertCommand, type CommandRow,
} from '../src/client/board/slash-token.ts'

const ROWS: readonly CommandRow[] = [
  { name: 'skills', description: 'List available skills' },
  { name: 'permission', description: 'Switch permission', hint: 'preset key' },
  { name: 'agent', description: 'Switch agent preset' },
  { name: 'clear', description: 'Clear the conversation' },
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

describe('filterCommands', () => {
  it('returns everything for an empty query, sorted by name', () => {
    expect(filterCommands(ROWS, '', true).map(row => row.name)).toEqual(
      ['agent', 'clear', 'permission', 'skills'],
    )
  })

  it('ranks prefix matches first, then includes', () => {
    const names = filterCommands(ROWS, 's', true).map(row => row.name)
    expect(names[0]).toBe('skills')
    expect(names).toContain('permission')
  })

  it('matches case-insensitively', () => {
    expect(filterCommands(ROWS, 'SKI', true).map(row => row.name)).toEqual(['skills'])
  })

  it('hides hinted commands when the token is not at line start', () => {
    const names = filterCommands(ROWS, '', false).map(row => row.name)
    expect(names).not.toContain('permission')
    expect(names).toContain('skills')
  })

  it('keeps hinted commands at line start', () => {
    const names = filterCommands(ROWS, '', true).map(row => row.name)
    expect(names).toContain('permission')
  })
})

describe('insertCommand', () => {
  it('replaces the token with a bare command', () => {
    const token = commandTokenAt('run /sk now', 6)!
    const result = insertCommand('run /sk now', token, 'skills', undefined)
    expect(result.text).toBe('run /skills now')
    expect(result.caret).toBe(11)
  })

  it('appends a trailing space for a hinted command', () => {
    const token = commandTokenAt('/per', 4)!
    const result = insertCommand('/per', token, 'permission', 'preset key')
    expect(result.text).toBe('/permission ')
    expect(result.caret).toBe(12)
  })

  it('replaces the whole word when the caret is mid-token', () => {
    const token = commandTokenAt('/skillss', 4)!
    const result = insertCommand('/skillss', token, 'skills', undefined)
    expect(result.text).toBe('/skills')
    expect(result.caret).toBe(7)
  })

  it('clears the query after a space', () => {
    expect(commandTokenAt('/skills ', 8)).toBeUndefined()
  })
})
