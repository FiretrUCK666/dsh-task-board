import { describe, expect, it } from 'vitest'
import {
  boundSourceTitle,
  deriveLinkedSessions,
  resolveExternalKind,
  workspaceLabelOf,
  type LinkedSessionSource,
} from '../src/core/linked-sessions.ts'

/** Minimal native-session source. */
function session(overrides: Partial<LinkedSessionSource> & { title?: string }): LinkedSessionSource {
  return {
    title: undefined,
    cwd: '/work/a',
    blank: false,
    running: false,
    completed: false,
    updatedAt: 100,
    ...overrides,
  }
}

/** Sources fixture: sessions incl. an archived-looking one, a blank and a
 *  running one; only byId + hidden exist (membership is never read). */
function sources(overrides: { hidden?: string[] } = {}): {
  byId: Record<string, LinkedSessionSource>
  hidden: string[]
} {
  return {
    byId: {
      's-1': session({ title: '会话一', updatedAt: 10 }),
      's-2': session({ title: '会话二', cwd: '/work/a/deep', updatedAt: 20 }),
      's-3': session({ title: '空白', blank: true, updatedAt: 30 }),
      's-4': session({ title: '进行中', running: true, updatedAt: 40 }),
    },
    hidden: overrides.hidden ?? [],
  }
}

describe('deriveLinkedSessions', () => {
  it('returns [] for unbound tasks', () => {
    expect(deriveLinkedSessions(undefined, sources())).toEqual([])
  })

  it('a WORKSPACE bind derives NO session rows (the folder-into-card flood is gone)', () => {
    // The old behavior surfaced every workspace member (and every NEW session
    // created in the folder) into the card. A workspace bind is a source
    // association only — never a conversation subscription.
    expect(deriveLinkedSessions({ kind: 'workspace', workspaceId: 'w-a' }, sources())).toEqual([])
    expect(deriveLinkedSessions({ kind: 'workspace', workspaceId: 'gone' }, sources())).toEqual([])
  })

  it('a session bind rides live status through (running / completed); waiting is NOT a source field', () => {
    const src = sources()
    src.byId['s-4'] = session({ title: '进行中', running: false, updatedAt: 40 })
    const rows = deriveLinkedSessions({ kind: 'session', sessionId: 's-4' }, src)
    expect(rows).toHaveLength(1)
    expect(rows[0].running).toBe(false)
    expect(rows[0].completed).toBe(false)
    // The waiting SIGNAL never rides the list-shaped source (the host's rows
    // carry no such field): controller.linkedOf overrides it from the question
    // face — covered in controller.spec 「linked rows carry the waiting signal」.
    expect('pendingInteraction' in rows[0]).toBe(false)
  })

  it('the title slot never carries the folder name — an unnamed row keeps the id for the 未命名 grammar', () => {
    const byId: Record<string, LinkedSessionSource> = {
      's-a': session({ title: '', cwd: '/work/alpha' }),
      's-b': session({ title: undefined, cwd: '/work/alpha' }),
      // The host's deterministic auto-name == the project basename: also not
      // a name (this is what made a fresh session "show the workspace name").
      's-c': session({ title: 'alpha', cwd: '/work/alpha' }),
    }
    for (const id of ['s-a', 's-b', 's-c']) {
      const rows = deriveLinkedSessions({ kind: 'session', sessionId: id }, { byId, hidden: [] })
      expect(rows[0].title).toBe(id)
      // The folder still has its OWN slot (never stolen by the title).
      expect(rows[0].workspaceLabel).toBe('alpha')
    }
    // A real name survives untouched.
    byId['s-d'] = session({ title: '黄道十二宫', cwd: '/work/alpha' })
    expect(deriveLinkedSessions({ kind: 'session', sessionId: 's-d' }, { byId, hidden: [] })[0].title).toBe('黄道十二宫')
  })

  it('a missing single session yields no row; an explicitly bound blank one still shows', () => {
    const src = sources()
    expect(deriveLinkedSessions({ kind: 'session', sessionId: 'nope' }, src)).toEqual([])
    // A session the user dragged in on purpose is NEVER filtered as blank —
    // explicit inclusion beats the implicit filters.
    expect(deriveLinkedSessions({ kind: 'session', sessionId: 's-3' }, src).map(row => row.sessionId)).toEqual(['s-3'])
    // …but an explicitly hidden one still obeys the hide set.
    expect(deriveLinkedSessions({ kind: 'session', sessionId: 's-1' }, sources({ hidden: ['s-1'] }))).toEqual([])
  })
})

describe('workspaceLabelOf', () => {
  it('takes the last non-empty path segment (both separators)', () => {
    expect(workspaceLabelOf('/work/alpha')).toBe('alpha')
    expect(workspaceLabelOf('C:\\work\\beta')).toBe('beta')
    expect(workspaceLabelOf('/work/alpha/')).toBe('alpha')
  })
})

describe('boundSourceTitle', () => {
  it('prefers the session title, then cwd basename, then the id', () => {
    expect(boundSourceTitle({ kind: 'session', sessionId: 's-1' }, {
      sessions: { 's-1': { title: '会话一', cwd: '/work/a' } },
      workspaces: [],
    })).toBe('会话一')
    expect(boundSourceTitle({ kind: 'session', sessionId: 's-2' }, {
      sessions: { 's-2': { title: '', cwd: '/work/alpha' } },
      workspaces: [],
    })).toBe('alpha')
    expect(boundSourceTitle({ kind: 'session', sessionId: 's-3' }, {
      sessions: {}, workspaces: [],
    })).toBe('s-3')
  })

  it('falls back to the workspace title, then the workspace id', () => {
    expect(boundSourceTitle({ kind: 'workspace', workspaceId: 'w-a' }, {
      sessions: {}, workspaces: [{ id: 'w-a', title: '项目A' }],
    })).toBe('项目A')
    expect(boundSourceTitle({ kind: 'workspace', workspaceId: 'gone' }, {
      sessions: {}, workspaces: [],
    })).toBe('gone')
  })
})

describe('resolveExternalKind', () => {
  it('classifies known sessions and workspaces, else undefined', () => {
    const ctx = { sessions: { 's-1': {} }, workspaces: [{ id: 'w-a' }] }
    expect(resolveExternalKind('s-1', ctx)).toBe('session')
    expect(resolveExternalKind('w-a', ctx)).toBe('workspace')
    expect(resolveExternalKind('nope', ctx)).toBeUndefined()
  })
})
