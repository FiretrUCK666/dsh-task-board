import { describe, expect, it } from 'vitest'
import { externalDragOf, idOfKey, readSidebarDrag, SESSION_MIME, WORKSPACE_MIME } from '../src/client/sidebar-drag.ts'

/** Minimal dataTransfer stand-in (getData only — what the pure helpers read). */
function data(entries: Record<string, string>): { getData: (type: string) => string } {
  return { getData: type => entries[type] ?? '' }
}

const resolve = (id: string): 'session' | 'workspace' | undefined =>
  id === 's-1' || id === 's-2' ? 'session'
    : id === 'w-a' ? 'workspace'
      : undefined
const isBoardTask = (id: string): boolean => id === 'task-1'

describe('readSidebarDrag', () => {
  it('reads the board MIMEs (session/workspace) in priority order', () => {
    expect(readSidebarDrag(data({ [SESSION_MIME]: 's-1' }))).toEqual({ kind: 'session', id: 's-1' })
    expect(readSidebarDrag(data({ [WORKSPACE_MIME]: 'w-a' }))).toEqual({ kind: 'workspace', id: 'w-a' })
    expect(readSidebarDrag(data({}))).toBeUndefined()
  })
})

describe('idOfKey', () => {
  it('normalizes composite native keys to their id tail', () => {
    expect(idOfKey('w-a')).toBe('w-a')
    expect(idOfKey('workspace:w-a')).toBe('w-a')
    expect(idOfKey('C:\\work\\s-1')).toBe('s-1')
  })
})

describe('externalDragOf', () => {
  it('prefers the explicit board MIME over text/plain', () => {
    const dt = data({ [SESSION_MIME]: 's-1', 'text/plain': 'w-a' })
    expect(externalDragOf(dt, isBoardTask, resolve)).toEqual({ kind: 'session', id: 's-1' })
  })

  it('classifies a native folder drag (text/plain = workspaceId)', () => {
    expect(externalDragOf(data({ 'text/plain': 'w-a' }), isBoardTask, resolve))
      .toEqual({ kind: 'workspace', id: 'w-a' })
    // Composite native key still normalizes.
    expect(externalDragOf(data({ 'text/plain': 'workspace:w-a' }), isBoardTask, resolve))
      .toEqual({ kind: 'workspace', id: 'w-a' })
  })

  it('classifies a native session drag (text/plain = sessionId)', () => {
    expect(externalDragOf(data({ 'text/plain': 's-2' }), isBoardTask, resolve))
      .toEqual({ kind: 'session', id: 's-2' })
  })

  it('never treats the board\'s own card drag as external', () => {
    expect(externalDragOf(data({ 'text/plain': 'task-1' }), isBoardTask, resolve)).toBeUndefined()
  })

  it('ignores empty text/plain and unknown ids', () => {
    expect(externalDragOf(data({ 'text/plain': '' }), isBoardTask, resolve)).toBeUndefined()
    expect(externalDragOf(data({ 'text/plain': 'nope' }), isBoardTask, resolve)).toBeUndefined()
    expect(externalDragOf(data({}), isBoardTask, resolve)).toBeUndefined()
  })
})
