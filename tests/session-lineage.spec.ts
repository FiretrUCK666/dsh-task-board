/**
 * Subagent lineage (session-lineage.ts): THE one rollup of a session's
 * subagent descendants. The contract is the official sidebar's own
 * `indexSubagentDescendants` (dsh-client-ui-workspace) — a session whose own
 * turn stopped while the subagent it summoned keeps working IS still working.
 * Every rule below is that function's rule, pinned one by one: the `origin`
 * first gate (a fork must never count), level-by-level crediting, the
 * traversed node's own flag, the cycle guard, and a missing ancestor row
 * ending the walk instead of throwing.
 */
import { describe, expect, it } from 'vitest'
import { indexSubagentDescendants, type LineageRow } from '../src/core/session-lineage.ts'

/** One row of the fixture (the list projection's shape, narrowed). */
function rows(spec: Record<string, [boolean, string | undefined, 'subagent' | undefined]>): Record<string, LineageRow> {
  const out: Record<string, LineageRow> = {}
  for (const [id, [running, parentId, origin]] of Object.entries(spec)) {
    out[id] = {
      running,
      ...parentId !== undefined ? { parentId } : {},
      ...origin !== undefined ? { origin } : {},
    }
  }
  return out
}

describe('indexSubagentDescendants (a literal port of the official rollup)', () => {
  it('a single running subagent makes its普通 parent an ancestor with one running descendant', () => {
    const index = indexSubagentDescendants(rows({
      P: [false, undefined, undefined],
      C: [true, 'P', 'subagent'],
    }))
    expect(index.get('P')).toEqual({ count: 1, runningCount: 1 })
    // The child is not its own descendant.
    expect(index.has('C')).toBe(false)
  })

  it('several descendants accumulate on the same parent, running ones counted apart', () => {
    const index = indexSubagentDescendants(rows({
      P: [false, undefined, undefined],
      C1: [true, 'P', 'subagent'],
      C2: [false, 'P', 'subagent'],
      C3: [true, 'P', 'subagent'],
    }))
    expect(index.get('P')).toEqual({ count: 3, runningCount: 2 })
  })

  it('multi-level grandchildren credit EVERY level, and the stopped middle node does not mask them', () => {
    const index = indexSubagentDescendants(rows({
      P: [false, undefined, undefined],
      S: [false, 'P', 'subagent'],
      G: [true, 'S', 'subagent'],
    }))
    // P sees both levels; the running grandchild reaches it through the
    // stopped middle node (the case the whole rollup exists for).
    expect(index.get('P')).toEqual({ count: 2, runningCount: 1 })
    expect(index.get('S')).toEqual({ count: 1, runningCount: 1 })
  })

  it('a deeply nested chain keeps crediting the same top ancestor', () => {
    const index = indexSubagentDescendants(rows({
      P: [false, undefined, undefined],
      S1: [false, 'P', 'subagent'],
      S2: [false, 'S1', 'subagent'],
      S3: [true, 'S2', 'subagent'],
    }))
    expect(index.get('P')).toEqual({ count: 3, runningCount: 1 })
    expect(index.get('S1')).toEqual({ count: 2, runningCount: 1 })
    expect(index.get('S2')).toEqual({ count: 1, runningCount: 1 })
  })

  it('CROSS-BRANCH: the first non-subagent ancestor is credited once and ends that walk', () => {
    // C's chain stops at P (a普通 session); a subagent row hanging under a
    // NON-subagent row is simply a fresh chain with its own top.
    const index = indexSubagentDescendants(rows({
      P: [false, undefined, undefined],
      C: [true, 'P', 'subagent'],
      OTHER: [false, 'P', undefined],
      ORPHAN: [false, 'OTHER', 'subagent'],
    }))
    expect(index.get('P')).toEqual({ count: 1, runningCount: 1 })
    expect(index.get('OTHER')).toEqual({ count: 1, runningCount: 0 })
  })

  it('a FORK (parentId but no origin) is never counted, and creates no index entry', () => {
    // The official `fork()` writes `parentSessionId` and no `origin`: crawling
    // on parentId alone would credit the fork to the source session.
    const index = indexSubagentDescendants(rows({
      P: [false, undefined, undefined],
      F: [true, 'P', undefined],
    }))
    expect(index.has('P')).toBe(false)
    expect(index.has('F')).toBe(false)
  })

  it('a subagent row WITHOUT a parentId credits nobody', () => {
    const index = indexSubagentDescendants(rows({ C: [true, undefined, 'subagent'] }))
    expect(index.size).toBe(0)
  })

  it('a missing ancestor row ends the walk without throwing, and still credits the level below', () => {
    // The ancestor itself is not in the snapshot (a partial page): the child's
    // own level is credited and the walk stops — no throw, no hang.
    const index = indexSubagentDescendants(rows({ C: [true, 'GHOST', 'subagent'] }))
    expect(index.get('GHOST')).toEqual({ count: 1, runningCount: 1 })
  })

  it('a parentId cycle terminates (the seen guard) instead of hanging', () => {
    const index = indexSubagentDescendants(rows({
      A: [false, 'B', 'subagent'],
      B: [false, 'A', 'subagent'],
    }))
    // Each node is traversed as a descendant once, and each traversal credits
    // its parent once: with a two-node cycle every pair is counted — 2 each.
    // What matters is the ported guard: the walk TERMINATES (the official
    // `seen` set) instead of looping forever, and nothing throws.
    expect(index.get('A')).toEqual({ count: 2, runningCount: 0 })
    expect(index.get('B')).toEqual({ count: 2, runningCount: 0 })
  })

  it('a self-parented row terminates too', () => {
    const index = indexSubagentDescendants(rows({ A: [false, 'A', 'subagent'] }))
    expect(index.get('A')).toEqual({ count: 1, runningCount: 0 })
  })

  it('undefined rows in the record are skipped (partial projections)', () => {
    const index = indexSubagentDescendants({
      ...rows({ P: [false, undefined, undefined], C: [true, 'P', 'subagent'] }),
      MISSING: undefined,
    })
    expect(index.get('P')).toEqual({ count: 1, runningCount: 1 })
  })
})
