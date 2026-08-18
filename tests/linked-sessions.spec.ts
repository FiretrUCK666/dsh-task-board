import { describe, expect, it } from 'vitest'
import {
  boundSourceTitle,
  deriveLinkedSessions,
  resolveExternalKind,
  type LinkedSessionSource,
} from '../src/core/linked-sessions.ts'

/** Minimal workspace-session source. */
function session(overrides: Partial<LinkedSessionSource> & { title?: string }): LinkedSessionSource {
  return {
    title: undefined,
    cwd: '/work/a',
    blank: false,
    running: false,
    pendingInteraction: undefined,
    completed: false,
    updatedAt: 100,
    ...overrides,
  }
}

/** Sources fixture: two sessions under /work/a, one archived, one blank; two workspaces. */
function sources(overrides: { hidden?: string[] } = {}): {
  byId: Record<string, LinkedSessionSource>
  archived: string[]
  workspaceSessionIds: (id: string) => readonly string[] | undefined
  hidden: string[]
} {
  return {
    byId: {
      's-1': session({ title: '会话一', updatedAt: 10 }),
      's-2': session({ title: '会话二', cwd: '/work/a/deep', updatedAt: 20 }),
      's-3': session({ title: '空白', blank: true, updatedAt: 30 }),
      's-4': session({ title: '进行中', running: true, updatedAt: 40 }),
    },
    archived: ['s-2'],
    workspaceSessionIds: id => id === 'w-a'
      ? ['s-1', 's-2', 's-3', 's-4']
      : id === 'w-b' ? ['s-x'] : undefined,
    hidden: overrides.hidden ?? [],
  }
}

describe('deriveLinkedSessions', () => {
  it('returns [] for unbound tasks', () => {
    expect(deriveLinkedSessions(undefined, sources())).toEqual([])
  })

  it('lists a workspace\'s sessions in order, skipping archived, blank and unknown', () => {
    const rows = deriveLinkedSessions({ kind: 'workspace', workspaceId: 'w-a' }, sources())
    expect(rows.map(row => row.sessionId)).toEqual(['s-1', 's-4'])
  })

  it('live status rides through (running / pendingInteraction / completed)', () => {
    const src = sources()
    src.byId['s-4'] = session({ title: '进行中', running: false, pendingInteraction: 'question', updatedAt: 40 })
    src.byId['s-5'] = session({ title: '已完成', completed: true, updatedAt: 50 })
    src.workspaceSessionIds = () => ['s-4', 's-5']
    const rows = deriveLinkedSessions({ kind: 'workspace', workspaceId: 'w-a' }, src)
    expect(rows[0].pendingInteraction).toBe('question')
    expect(rows[1].completed).toBe(true)
  })

  it('applies the user hide set on top of archived/blank filtering', () => {
    const rows = deriveLinkedSessions({ kind: 'workspace', workspaceId: 'w-a' }, sources({ hidden: ['s-4'] }))
    expect(rows.map(row => row.sessionId)).toEqual(['s-1'])
  })

  it('title falls back to cwd basename then to the session id', () => {
    const byId: Record<string, LinkedSessionSource> = {
      's-a': session({ title: '', cwd: '/work/alpha' }),
      's-b': session({ title: undefined, cwd: '/work/alpha' }),
    }
    const rows = deriveLinkedSessions({ kind: 'session', sessionId: 's-a' }, {
      byId, archived: [], workspaceSessionIds: () => undefined, hidden: [],
    })
    expect(rows[0].title).toBe('alpha')
    const rowsB = deriveLinkedSessions({ kind: 'session', sessionId: 's-b' }, {
      byId, archived: [], workspaceSessionIds: () => undefined, hidden: [],
    })
    expect(rowsB[0].title).toBe('alpha')
    expect(rowsB[0].workspaceLabel).toBe('alpha')
  })

  it('a missing / archived single session yields no row', () => {
    const src = sources()
    expect(deriveLinkedSessions({ kind: 'session', sessionId: 'nope' }, src)).toEqual([])
    expect(deriveLinkedSessions({ kind: 'session', sessionId: 's-2' }, src)).toEqual([])
  })

  it('an unknown or deleted workspace yields no rows', () => {
    expect(deriveLinkedSessions({ kind: 'workspace', workspaceId: 'gone' }, sources())).toEqual([])
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
