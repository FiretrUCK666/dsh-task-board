import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

  it('a session bind rides live status through; waiting is NOT a source field', () => {
    const src = sources()
    src.byId['s-4'] = session({ title: '进行中', running: false, updatedAt: 40 })
    const rows = deriveLinkedSessions({ kind: 'session', sessionId: 's-4' }, src)
    expect(rows).toHaveLength(1)
    expect(rows[0].running).toBe(false)
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

/**
 * ARCHIVING IS NOT DELETION, AND THE ROW HAS TO SAY WHICH.
 *
 * This pure derivation does not know the archive set (it is a registry-global
 * concern applied one level up), so every row it produces says `archived: false`
 * and the controller — the one caller that can know — overrides it. Stating it
 * here rather than leaving it optional is what keeps "did anybody set this?" from
 * being a question a consumer has to ask.
 *
 * The reason the field exists at all: archiving used to make the row DISAPPEAR,
 * so on the card an archived conversation looked exactly like a deleted one. The
 * person tidied their sidebar and the card lost a session it still owns, with no
 * way to tell 「放起来了」 from 「没了」.
 */
describe('an archived session is a fact the row carries, not an absence', () => {
  const sources = (hidden: readonly string[] = []) => ({
    byId: {
      's-1': { blank: false, running: false, updatedAt: 10, title: '会话一' },
    },
    hidden,
  })

  it('derives a row and marks it not-archived by default', () => {
    // The derivation is archive-blind by design; the controller knows and
    // overrides. `false` (not `undefined`) keeps the answer definite.
    const rows = deriveLinkedSessions({ kind: 'session', sessionId: 's-1' }, sources())
    expect(rows).toHaveLength(1)
    expect(rows[0]?.archived).toBe(false)
  })

  it('still drops a session the person hid ON THE CARD', () => {
    // Hide is a display instruction about this panel, not a fact about the
    // session — so unlike archiving it really does remove the row. Keeping the
    // two apart is the whole point: one is 「不看」, the other is 「放起来了」.
    expect(deriveLinkedSessions({ kind: 'session', sessionId: 's-1' }, sources(['s-1']))).toHaveLength(0)
  })
})

/**
 * THE FLAG HAS TO REACH THE SCREEN, OR THE FIX IS HALF DONE.
 *
 * `controller.linkedOf` keeps an archived row and marks it — but the first version
 * of that change stopped there. Nothing in `src/client` read `.archived`, so on the
 * card an archived conversation still just vanished: exactly as indistinguishable
 * from a deleted one as before, while a comment in the controller claimed 「a reader
 * can see the session is still bound」. A field that is written and never read is
 * the 「假线索」 hard rule 18 calls out, and it is worse than the bug it replaced,
 * because the comment makes the next reader believe the case is handled.
 *
 * These two cases pin both halves: the client READS the flag, and the tray it
 * feeds is excluded from the 会话 list (which is about work, not ownership).
 */
describe('the archived flag reaches the card, and stays out of the work list', () => {
  const detail = readFileSync(join(process.cwd(), 'src', 'client', 'board', 'TaskDetail.tsx'), 'utf8')

  it('the card reads row.archived and renders a named tray for it', () => {
    // The read exists at all — this is the half that was missing.
    expect(detail, 'src/client never reads the archived flag, so the row invisibly vanishes').toContain('row.archived')
    // And it is RENDERED, not merely computed: a computed-only array is the same
    // silent absence one refactor later.
    expect(detail).toContain('archivedSessions.length > 0')
    expect(detail).toContain('detail.archivedTrayTitle')
  })

  it('the archived tray is NOT folded into the 会话 list', () => {
    // `sessionsOf` is 「what is going on」 and leaves archived conversations out.
    // Putting them back there would make this list disagree with the board's dots
    // (which read the same unified list) and would call a put-away conversation
    // outstanding work. The tray is a separate line, filtered against the list.
    expect(detail).toContain('!sessions.some(session => session.sessionId === row.sessionId)')
    expect(detail, 'the archived rows were merged into the work list').not.toContain('sessionsOf(current).concat')
  })

  it('says where to bring it back rather than offering a button it cannot honour', () => {
    // Un-archiving is a NATIVE sidebar operation; this plugin does not perform it,
    // so a 「恢复」 button here would be a promise the panel cannot keep. The copy
    // names the place instead.
    const locales = readFileSync(join(process.cwd(), 'src', 'client', 'locales.ts'), 'utf8')
    expect(locales).toContain('detail.archivedTrayTitle')
    // Both languages, because a missing key renders as the key itself.
    expect(locales.match(/detail\.archivedTrayTitle/g)?.length, 'the archived tray title is not translated in both languages').toBe(2)
  })
})
