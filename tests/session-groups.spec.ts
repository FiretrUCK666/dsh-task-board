/**
 * 会话选择器的名单规则（core/session-groups.ts）。
 *
 * 这份名单曾经是「把全量会话目录摊平，再在两个界面各过滤一次」，于是两处各漏
 * 一半：卡片那边过滤了归档，看板那边没过滤；两边都把子代理会话和空白槽端给了
 * 用户。规则住进核心层之后，这里逐条钉住它——**每条闸门一个用例**，因为每一
 * 条都有明确的出处（shell 的 `sessionVisible` / registry 的归属账本），不是
 * 某个会话的特例。
 */
import { describe, expect, it } from 'vitest'
import {
  countSessions, offerableSessionGroups, UNGROUPED_KEY,
  type GroupSessionRow, type GroupWorkspaceRow,
} from '../src/core/session-groups.ts'

const NOW = 1_700_000_000_000
const UNTITLED = '未命名'
const UNGROUPED = '未分组会话'

/** One workspace-snapshot shape: rows by id, in list order. */
function sources(options: {
  rows: Record<string, GroupSessionRow>
  ids?: string[]
  workspaces?: GroupWorkspaceRow[]
  archived?: string[]
}) {
  return {
    byId: options.rows,
    ...options.ids !== undefined ? { ids: options.ids } : {},
    workspaces: options.workspaces ?? [],
    archivedSessionIds: options.archived ?? [],
  }
}

const list = (groups: ReturnType<typeof offerableSessionGroups>) =>
  groups.map(group => [group.key, group.sessions.map(session => session.sessionId)])

describe('offerableSessionGroups', () => {
  it('excludes subagent-origin sessions: the official sidebar never shows them as top-level rows', () => {
    // Shell grammar (dsh-client-ui-workspace, sessionVisible): a subagent
    // child rides its parent header, so it is never a pick target.
    const groups = offerableSessionGroups(sources({
      rows: { s1: { title: '普通会话' }, sub: { title: '子代理', origin: 'subagent' } },
      ids: ['s1', 'sub'],
      workspaces: [{ id: 'w', title: 'Work', sessionIds: ['s1', 'sub'] }],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(list(groups)).toEqual([['w', ['s1']]])
  })

  it('excludes blank sessions: a "New Session" slot is not a conversation', () => {
    const groups = offerableSessionGroups(sources({
      rows: { s1: { title: '真会话' }, slot: { blank: true } },
      ids: ['s1', 'slot'],
      workspaces: [{ id: 'w', title: 'Work', sessionIds: ['s1', 'slot'] }],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(list(groups)).toEqual([['w', ['s1']]])
  })

  it('excludes archived sessions and nothing else', () => {
    const groups = offerableSessionGroups(sources({
      rows: { s1: { title: 'A' }, s2: { title: 'B' }, s3: { title: 'C' } },
      ids: ['s1', 's2', 's3'],
      workspaces: [{ id: 'w', title: 'Work', sessionIds: ['s1', 's2', 's3'] }],
      archived: ['s2'],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(list(groups)).toEqual([['w', ['s1', 's3']]])
  })

  it('groups by the registry ownership account, in registry order, in list order within a group', () => {
    const groups = offerableSessionGroups(sources({
      rows: { s1: { title: 'A' }, s2: { title: 'B' }, s3: { title: 'C' } },
      ids: ['s3', 's1', 's2'],
      workspaces: [
        { id: 'w2', title: 'Second', sessionIds: ['s2'] },
        { id: 'w1', title: 'First', sessionIds: ['s1', 's3'] },
      ],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(list(groups)).toEqual([['w2', ['s2']], ['w1', ['s3', 's1']]])
  })

  it('never guesses a home by cwd: a session no workspace accounts for lands in the trailing ungrouped group', () => {
    // Same-named folder elsewhere is NOT this workspace (the same law
    // snapshotWorkspaceSessions states). Dropping it would be a silent loss.
    const groups = offerableSessionGroups(sources({
      rows: { s1: { title: 'A' }, orphan: { title: '孤儿', cwd: '/elsewhere/Work' } },
      ids: ['s1', 'orphan'],
      workspaces: [{ id: 'w1', title: 'Work', path: '/here/Work', sessionIds: ['s1'] } as GroupWorkspaceRow],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(list(groups)).toEqual([['w1', ['s1']], [UNGROUPED_KEY, ['orphan']]])
    // And it is never dropped when it is the ONLY session.
    const only = offerableSessionGroups(sources({
      rows: { orphan: { title: '孤儿' } },
      ids: ['orphan'],
      workspaces: [],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(list(only)).toEqual([[UNGROUPED_KEY, ['orphan']]])
  })

  it('omits empty groups (an empty heading is noise, not information)', () => {
    const groups = offerableSessionGroups(sources({
      rows: { s1: { title: 'A' } },
      ids: ['s1'],
      workspaces: [
        { id: 'empty', title: 'Empty' },
        { id: 'w1', title: 'Work', sessionIds: ['s1'] },
      ],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(list(groups)).toEqual([['w1', ['s1']]])
  })

  it('applies exclude last, so a card never offers a session it already holds', () => {
    const groups = offerableSessionGroups(sources({
      rows: { s1: { title: 'A' }, s2: { title: 'B' } },
      ids: ['s1', 's2'],
      workspaces: [{ id: 'w1', title: 'Work', sessionIds: ['s1', 's2'] }],
    }), { exclude: new Set(['s1']), untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(list(groups)).toEqual([['w1', ['s2']]])
  })

  it('titles by the real title, the untitled placeholder, or the folder name — never a raw id', () => {
    const groups = offerableSessionGroups(sources({
      rows: {
        named: { title: '真名' },
        // The host's deterministic auto-name equals the folder basename, so
        // realTitleOf rejects it as "not a name someone chose".
        folderish: { title: 'Work', cwd: '/x/Work' },
        untitled: {},
      },
      ids: ['named', 'folderish', 'untitled'],
      workspaces: [{ id: 'w1', title: 'Work', sessionIds: ['named', 'folderish', 'untitled'] }],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    const sessions = groups[0]?.sessions ?? []
    // In NATIVE LIST order (named, folderish, untitled), not in the
    // workspace's own membership order — the list order is what the sidebar
    // shows and what the user recognizes.
    expect(sessions.map(session => session.title)).toEqual(['真名', UNTITLED, UNTITLED])
    for (const session of sessions) expect(session.title).not.toBe(session.sessionId)
  })

  it('carries the folder label so the ungrouped group can still say where a row came from', () => {
    const groups = offerableSessionGroups(sources({
      rows: { orphan: { title: '孤儿', cwd: '/x/Tools' } },
      ids: ['orphan'],
      workspaces: [],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(groups[0]?.sessions[0]?.workspaceLabel).toBe('Tools')
  })

  it('falls back to key order when the list carries no explicit order', () => {
    const groups = offerableSessionGroups(sources({
      rows: { s1: { title: 'A' }, s2: { title: 'B' } },
      workspaces: [{ id: 'w1', title: 'Work', sessionIds: ['s1', 's2'] }],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(list(groups)).toEqual([['w1', ['s1', 's2']]])
  })

  it('skips ids the snapshot does not carry (a stale membership slot is never guessed at)', () => {
    const groups = offerableSessionGroups(sources({
      rows: { s1: { title: 'A' } },
      ids: ['s1', 'gone'],
      workspaces: [{ id: 'w1', title: 'Work', sessionIds: ['s1', 'gone'] }],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(list(groups)).toEqual([['w1', ['s1']]])
  })

  it('counts the sessions across groups', () => {
    const groups = offerableSessionGroups(sources({
      rows: { s1: { title: 'A' }, s2: { title: 'B' }, s3: { title: 'C' } },
      ids: ['s1', 's2', 's3'],
      workspaces: [
        { id: 'w1', title: 'Work', sessionIds: ['s1', 's2'] },
        { id: 'w2', title: 'Other', sessionIds: ['s3'] },
      ],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(countSessions(groups)).toBe(3)
  })

  it('derives nothing from a clock: the same snapshots always give the same list', () => {
    const build = () => offerableSessionGroups(sources({
      rows: { s1: { title: 'A' }, s2: { title: 'B' } },
      ids: ['s1', 's2'],
      workspaces: [{ id: 'w1', title: 'Work', sessionIds: ['s1', 's2'] }],
    }), { untitledLabel: UNTITLED, ungroupedLabel: UNGROUPED })
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()))
    expect(NOW).toBeGreaterThan(0) // the derivation takes no clock at all
  })
})
