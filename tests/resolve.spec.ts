/**
 * THE RESOLVER: what a caller SAID, read into what this system stores.
 *
 * The defect it closes is measurable rather than theoretical. The catalog's own
 * description said `status` was 「五档之一：待规划 / 待办 / 进行中 / 待审核 / 已完成」
 * while `checkParams` compared against `backlog/todo/running/review/done` — so a
 * model that followed the description EXACTLY was refused every single time, by
 * a message naming values the description had never shown it.
 *
 * A gate that rejects the description it publishes is a gate whose caller cannot
 * succeed. So these tests are about the two halves of one promise: every spelling
 * a surface prints must resolve, and a spelling nothing prints must still be
 * refused WITH the legal list attached.
 */
import { describe, expect, it } from 'vitest'
import {
  builtinCandidatesOf,
  candidatesFor,
  resolveKeyOf,
  resolveValue,
  resolveWhy,
  type ResolveCandidate,
  type ResolveContext,
} from '../src/core/resolve.ts'
import { ITEM_PRIORITIES, ITEM_STATUS_VIEWS, PRIORITY_WORDS } from '../src/core/item.ts'
import { STATUS_WORDS } from '../src/core/tasks.ts'
import { zh } from '../src/client/locales.ts'

/** A context over the built-in vocabularies only — the shape a bare host has. */
const builtin: ResolveContext = { candidatesOf: kind => builtinCandidatesOf(kind) }

/** A context that also knows a deployment's own permissions, as a host would. */
const withPermissions = (candidates: readonly ResolveCandidate[]): ResolveContext => ({
  candidatesOf: kind => (kind === 'permission' ? candidates : builtinCandidatesOf(kind)),
})

/** The permission table this deployment happens to have. */
const PERMISSIONS: readonly ResolveCandidate[] = [
  { value: 'read-only', spellings: ['read-only', 'Read Only'], label: 'Read Only' },
  { value: 'workspace-write', spellings: ['workspace-write', 'Workspace Write'], label: 'Workspace Write' },
  { value: 'danger-full-access', spellings: ['danger-full-access', 'Full access', 'Full Access'], label: 'Full access' },
]

describe('the stored value always resolves to itself', () => {
  it('every status the document can hold reads back unchanged', () => {
    // The base case the whole thing stands on: whatever the columns store must
    // never be altered by the layer that also accepts human words.
    for (const status of ITEM_STATUS_VIEWS) {
      const resolved = resolveValue('status', status, builtin)
      expect(resolved.ok, `${status} did not resolve to itself`).toBe(true)
      expect(resolved.ok && resolved.value).toBe(status)
      // No `via`: a stored value was not an alias of anything.
      expect(resolved.ok && resolved.via).toBeUndefined()
    }
  })

  it('every priority tier reads back unchanged, including the numeric spellings', () => {
    for (const priority of ITEM_PRIORITIES) {
      expect(resolveValue('priority', priority, builtin)).toMatchObject({ ok: true, value: priority })
    }
    // The `!N` / `pN` ladder is the SAME one the row's mark and the search box
    // use, so it resolves here instead of being retyped.
    expect(resolveValue('priority', '!1', builtin)).toMatchObject({ ok: true, value: 'urgent' })
    expect(resolveValue('priority', 'p1', builtin)).toMatchObject({ ok: true, value: 'urgent' })
    expect(resolveValue('priority', '!4', builtin)).toMatchObject({ ok: true, value: 'low' })
  })
})

describe('the words a reader sees resolve to the value stored', () => {
  it('every Chinese column label resolves — this is the defect that was measured', () => {
    // 进行中 is the exact string the catalog's `about` printed and the validator
    // rejected. If this test fails, that defect is back.
    //
    // The words are READ from `STATUS_WORDS`, not typed again here: the whole
    // point of that table is that there is one home for them, and a test that
    // spelled them out would be the third copy — green while the two real ones
    // drift apart.
    for (const [stored, said] of Object.entries(STATUS_WORDS)) {
      const resolved = resolveValue('status', said, builtin)
      expect(resolved.ok, `「${said}」 was refused, which is the defect itself`).toBe(true)
      expect(resolved.ok && resolved.value).toBe(stored)
      // `via` records that the caller used a spelling rather than the key, so a
      // receipt can say what was read into what.
      expect(resolved.ok && resolved.via).toBe(said)
    }
  })

  it('the resolver reads the SAME words the interface prints — one table, not two', () => {
    // This is the claim the extraction is FOR. `locales.ts` takes these nine
    // strings from `core/`, so the column header a person reads and the word the
    // resolver recognises cannot be two different strings — which is exactly what
    // they were: two hand-typed copies that happened to match, with nothing
    // keeping them equal.
    //
    // The comparison is a FUNCTION so the self-test below can run the very same
    // one over a pair it knows has drifted: an assertion that has never failed is
    // not evidence (a green here would mean nothing if the reader were wrong).
    const driftIn = (dictionary: Readonly<Record<string, string>>): string[] => {
      const out: string[] = []
      for (const [status, word] of Object.entries(STATUS_WORDS)) {
        if (dictionary[`board.status.${status}`] !== word) out.push(`board.status.${status}`)
      }
      for (const [tier, word] of Object.entries(PRIORITY_WORDS)) {
        if (dictionary[`item.priority.${tier}`] !== word) out.push(`item.priority.${tier}`)
      }
      return out
    }
    expect(driftIn(zh), 'the dictionary and the resolver disagree about a word').toEqual([])
    // …and the reader can see a drift, on a dictionary built to have one.
    expect(driftIn({ ...zh, 'board.status.running': '进行中（旧）' })).toEqual(['board.status.running'])
  })

  it('every Chinese priority label resolves', () => {
    for (const [stored, said] of Object.entries(PRIORITY_WORDS)) {
      expect(resolveValue('priority', said, builtin), `「${said}」 was refused`).toMatchObject({ ok: true, value: stored })
    }
  })

  it('folds case and separators, so a display name works however it is typed', () => {
    // `Full access`, `full-access` and `full_access` are one preset. This is the
    // folding rule doing the work — no per-vocabulary synonym table needed.
    for (const said of ['Full access', 'full access', 'full-access', 'full_access', 'FULL ACCESS']) {
      expect(resolveValue('permission', said, withPermissions(PERMISSIONS)), `${said} did not resolve`).toMatchObject({
        ok: true,
        value: 'danger-full-access',
      })
    }
  })

  it('does not touch a value the deployment lists verbatim', () => {
    expect(resolveValue('permission', 'read-only', withPermissions(PERMISSIONS))).toMatchObject({ ok: true, value: 'read-only' })
  })
})

describe('a value it cannot read is refused WITH the candidates', () => {
  it('refuses a misspelling, and names every legal value with both spellings', () => {
    const resolved = resolveValue('status', '进行重', builtin)
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    // The refusal is a next move, not a wall: the list is what makes the
    // correction a glance instead of a search.
    expect(resolved.candidates).toContain('backlog（待规划）')
    expect(resolved.candidates).toContain('running（进行中）')
    // BOTH halves, because the caller must send the stored value while the person
    // reading over its shoulder recognises the label.
    expect(resolved.candidates.join(' ')).toContain('done（已完成）')
  })

  it('turns a failure into one sentence carrying the list', () => {
    const resolved = resolveValue('priority', '特别急', builtin)
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    const why = resolveWhy('priority', resolved)
    expect(why).toContain('特别急')
    expect(why).toContain('urgent')
  })

  it('refuses an empty value rather than reading it as the first candidate', () => {
    // A confident wrong answer is worse than a refusal: an empty string must not
    // become `backlog` because it happens to sort first.
    for (const empty of ['', '   ', undefined, null]) {
      expect(resolveValue('status', empty, builtin).ok, `${String(empty)} was read as a value`).toBe(false)
    }
  })

  it('does not silently match a PREFIX or a substring', () => {
    // 进行 is not 进行中, and 「待」 alone is two different columns. A resolver that
    // matched loosely would pick one of them and the caller would never know.
    for (const near of ['进行', '待', 'run', 'todos']) {
      expect(resolveValue('status', near, builtin).ok, `「${near}」 resolved, but it is not a spelling`).toBe(false)
    }
  })
})

describe('an absent vocabulary says so, instead of guessing', () => {
  it('reports that this host cannot list the values, and does not pretend the value is wrong', () => {
    // 「I cannot tell you」 and 「your value is wrong」 are different answers, and only
    // the second one is a claim about the caller. A deployment with no preset
    // table must not accuse a perfectly good key.
    const resolved = resolveValue('permission', 'read-only', builtin)
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.candidates).toEqual([])
    expect(resolved.why).toContain('没有提供')
  })

  it('keeps the deployment vocabulary out of the built-ins', () => {
    // A resolver that hard-coded `read-only / workspace-write / danger-full-access`
    // would be the 「写死」 this project forbids: the deployment's table is the
    // authority and it changes without this file.
    expect(builtinCandidatesOf('permission')).toEqual([])
    expect(builtinCandidatesOf('workspace')).toEqual([])
    expect(builtinCandidatesOf('model')).toEqual([])
    expect(builtinCandidatesOf('agentPreset')).toEqual([])
  })

  it('composes host candidates only where there are no built-ins', () => {
    // `status` must NOT be overridable by a host list: its authority is the enum.
    const host = [{ value: 'nonsense', spellings: ['nonsense'] }]
    expect(candidatesFor('status', host).map(candidate => candidate.value)).toEqual([...ITEM_STATUS_VIEWS])
    expect(candidatesFor('permission', host)).toEqual(host)
  })
})

describe('the reading rule itself', () => {
  it('folds case, runs of whitespace and the three separator shapes', () => {
    expect(resolveKeyOf('  Full   Access ')).toBe('full access')
    expect(resolveKeyOf('full_access')).toBe('full access')
    expect(resolveKeyOf('full-access')).toBe('full access')
    expect(resolveKeyOf('full/access')).toBe('full access')
  })

  it('leaves CJK alone — a space cannot be folded into Chinese', () => {
    // Folding here would change the spelling of a label somebody typed, and the
    // stored value would then not be what they said.
    expect(resolveKeyOf('进行中')).toBe('进行中')
    expect(resolveKeyOf('待审核')).toBe('待审核')
  })
})

/**
 * `resolveWhy` IS THE ONE PLACE A REFUSAL SENTENCE IS BUILT.
 *
 * It existed first as a helper nothing called — a function whose only consumer was
 * its own spec, which is dead code by hard rule 18, and worse than dead code when
 * its doc-comment described a caller that did not exist. The door in `tools.ts` now
 * asks `ParamResolver.whyNot` (implemented in `register.ts` on top of this), so the
 * wording of a refusal is written once.
 */
describe('a refusal is one sentence, and it says what to send instead', () => {
  it('carries the value that was said and the full legal list', () => {
    const resolved = resolveValue('status', '进行重', builtin)
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    const why = resolveWhy('status', resolved)
    expect(why).toContain('进行重')
    // Both spellings per candidate: the caller must send the stored key, and the
    // label is what the person recognises.
    expect(why).toContain('running（进行中）')
    expect(why).toContain('backlog（待规划）')
  })

  it('does not invent a candidate list when the deployment has none', () => {
    // 「I cannot tell you the values」 is the honest sentence; printing an empty
    // list would read as 「nothing is legal」.
    const resolved = resolveValue('permission', 'anything', builtin)
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolveWhy('permission', resolved)).not.toContain('可选：')
  })
})
