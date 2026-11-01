/**
 * The gallery's catalogue gate must BITE.
 *
 * ── 为什么这条 spec 单独存在 ─────────────────────────────────────────────────
 *
 * `gallery.spec.ts` asserts that every token the token layer declares is shown on
 * the preview page. While it was green it proved nothing: a check that has only
 * ever passed is indistinguishable from a check that never runs. The day it was
 * written it was already the ONLY thing standing between "a new token nobody can
 * see" and silence — the failure it was built for had happened 59 times, and
 * nothing had reported it.
 *
 * So the judgement is tested directly, with planted inputs, in BOTH directions:
 *
 *   - a catalogue that omits a declared token is reported, by name;
 *   - a catalogue that lists them all is accepted;
 *   - an `UNSHOWN` entry with a real reason excuses exactly its own token;
 *   - an `UNSHOWN` entry with a placeholder reason does NOT excuse it;
 *   - an `UNSHOWN` entry for a token nobody declares is reported as stale.
 *
 * ── 硬性规范 16 ──────────────────────────────────────────────────────────────
 *
 * The violations live in this file as literals. Changing a real stylesheet and
 * changing it back would prove "the edit took effect", not "the gate goes red" —
 * and in a shared working tree it would collide with anyone else writing at the
 * same moment. The judgement under test is exported from the harness, so these
 * cases exercise the REAL function, not a copy of it.
 */
import { describe, expect, it } from 'vitest'
import { catalogueGaps } from './panel-harness.ts'

/** A token layer, as the scanner would read it out of a sheet. */
function layer(...names: string[]): Set<string> {
  return new Set(names)
}

/** A catalogue, as the preview page declares it. */
function catalogue(...names: string[]): ReadonlySet<string> {
  return new Set(names)
}

describe('the catalogue gate reports a token nobody can see', () => {
  it('reports a declared token the page never shows, and names it', () => {
    const gaps = catalogueGaps(layer('--dsh-tb-bg', '--dsh-tb-ink', '--dsh-tb-plane-sheet'), catalogue('--dsh-tb-bg', '--dsh-tb-ink'), {})
    expect(gaps.hidden, 'a token absent from the page must be reported by name').toEqual(['--dsh-tb-plane-sheet'])
  })

  it('accepts a page that shows every declared token', () => {
    // The lawful twin. A checker that reports everything is as useless as one that
    // reports nothing, so the passing case has to be asserted too.
    const gaps = catalogueGaps(layer('--dsh-tb-a', '--dsh-tb-b'), catalogue('--dsh-tb-a', '--dsh-tb-b'), {})
    expect(gaps.hidden).toEqual([])
  })

  it('does not report a token the page shows but the layer does not declare', () => {
    // That direction belongs to a different assertion (a rename); this judgement
    // answers "is anything hidden", so a surplus name is not its business.
    const gaps = catalogueGaps(layer('--dsh-tb-a'), catalogue('--dsh-tb-a', '--dsh-tb-ghost'), {})
    expect(gaps.hidden).toEqual([])
  })

  it('an UNSHOWN entry with a real reason excuses exactly its own token', () => {
    const gaps = catalogueGaps(
      layer('--dsh-tb-a', '--dsh-tb-slot'),
      catalogue('--dsh-tb-a'),
      { '--dsh-tb-slot': 'This is a slot the pages fill with their own tier, not a step of the system.' },
    )
    expect(gaps.hidden, 'an excused token must not be reported').toEqual([])
    expect(gaps.staleExcuses, 'the excuse still names a declared token, so it is not stale').toEqual([])
  })

  it('a placeholder reason does NOT excuse a token', () => {
    // "n/a" and "TODO" are the shapes a reason takes when nobody wrote one. The
    // gate treats them as absent, or every future omission hides behind them.
    for (const hollow of ['', '   ', 'n/a', 'TODO', '?']) {
      const gaps = catalogueGaps(layer('--dsh-tb-a', '--dsh-tb-slot'), catalogue('--dsh-tb-a'), { '--dsh-tb-slot': hollow })
      expect(gaps.hidden, `"${hollow}" must not count as a reason`).toEqual(['--dsh-tb-slot'])
      expect(gaps.hollowExcuses).toEqual(['--dsh-tb-slot'])
    }
  })

  it('an excuse for a token nobody declares is reported as stale', () => {
    // A stale excuse is worse than a missing one: it silently excuses the NEXT
    // token that takes the name, so the gate would go quiet exactly where it is
    // needed.
    const gaps = catalogueGaps(layer('--dsh-tb-a'), catalogue('--dsh-tb-a'), {
      '--dsh-tb-gone': 'This token was removed years ago, and this reason outlived it.',
    })
    expect(gaps.staleExcuses).toEqual(['--dsh-tb-gone'])
  })

  it('reports hidden tokens in a stable order, so a diff is readable', () => {
    const gaps = catalogueGaps(layer('--dsh-tb-c', '--dsh-tb-a', '--dsh-tb-b'), catalogue(), {})
    expect(gaps.hidden).toEqual(['--dsh-tb-a', '--dsh-tb-b', '--dsh-tb-c'])
  })
})
