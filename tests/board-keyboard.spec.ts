/**
 * The board card's keyboard map — tested as a PURE MODULE, not as source text.
 *
 * This file used to read `TaskCard.tsx` and match strings, because the vocabulary
 * lived in inline `if`s and there was nothing else to test. Now the map is a value
 * and the matcher is a function, so the questions can be asked directly: which
 * binding is this event, does a modifier guard hold both ways, does an unavailable
 * action stay unoffered, and does the spoken hint come from the map rather than
 * from a sentence someone has to remember to edit.
 *
 * The last one is the point of the whole arrangement. The card's accessible name
 * advertises these keys, and it was a hand-written string in two locale files —
 * so adding the Alt chord meant editing two strings by hand, and forgetting would
 * have gone red nowhere.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  availableCardKeys, BOARD_KEY_PHRASE, cardBindingFor, dispatchCardKey,
  type BoardCardKeyActions, type BoardCardState,
} from '../src/client/board/keyboard.ts'

const BOTH: BoardCardState = { canStep: true, canReorder: true }
const READ_ONLY: BoardCardState = { canStep: false, canReorder: false }

/** A key event, in the shape the matcher reads. */
const ev = (key: string, mods: { alt?: boolean; ctrl?: boolean; meta?: boolean } = {}) => ({
  key,
  altKey: mods.alt ?? false,
  ctrlKey: mods.ctrl ?? false,
  metaKey: mods.meta ?? false,
})

describe('which binding a key event is', () => {
  it('the bare brackets step the column, in both directions', () => {
    expect(cardBindingFor(ev('['), BOTH)).toMatchObject({ action: 'stepColumn', arg: -1 })
    expect(cardBindingFor(ev(']'), BOTH)).toMatchObject({ action: 'stepColumn', arg: 1 })
  })

  it('Alt with the arrows reorders, in both directions', () => {
    expect(cardBindingFor(ev('ArrowUp', { alt: true }), BOTH)).toMatchObject({ action: 'reorder', arg: -1 })
    expect(cardBindingFor(ev('ArrowDown', { alt: true }), BOTH)).toMatchObject({ action: 'reorder', arg: 1 })
  })

  it('MODIFIERS ARE COMPARED BOTH WAYS — the half that is easy to get wrong', () => {
    // A binding that does not ask for Alt must refuse an event that has it, or
    // `Alt+[` steps a column and steals a gesture the platform owns.
    expect(cardBindingFor(ev('[', { alt: true }), BOTH), 'Alt+[ stepped a column').toBeUndefined()
    // Ctrl/Cmd too: `Ctrl+[` and `Cmd+[` belong to the browser.
    expect(cardBindingFor(ev('[', { ctrl: true }), BOTH)).toBeUndefined()
    expect(cardBindingFor(ev('[', { meta: true }), BOTH)).toBeUndefined()
    // And a binding that DOES ask for Alt must refuse an event without it — bare
    // arrows move focus between cards and must not reorder anything.
    expect(cardBindingFor(ev('ArrowUp'), BOTH), 'a bare arrow reordered a card').toBeUndefined()
    expect(cardBindingFor(ev('ArrowDown'), BOTH)).toBeUndefined()
    // A chord is not a bare key with extra state: Cmd+Alt+arrow is nobody's.
    expect(cardBindingFor(ev('ArrowUp', { alt: true, meta: true }), BOTH)).toBeUndefined()
  })

  it('Enter and Space both open, and neither is stolen by a modifier', () => {
    expect(cardBindingFor(ev('Enter'), BOTH)).toMatchObject({ action: 'open' })
    expect(cardBindingFor(ev(' '), BOTH)).toMatchObject({ action: 'open' })
    expect(cardBindingFor(ev('Enter', { meta: true }), BOTH), 'Cmd+Enter opened a card').toBeUndefined()
  })

  it('a key that is not ours is not claimed', () => {
    for (const key of ['a', 'Escape', 'Tab', 'ArrowLeft', 'x']) {
      expect(cardBindingFor(ev(key), BOTH), `${key} was claimed by a card`).toBeUndefined()
    }
  })
})

describe('a card only offers what it can honour', () => {
  it('a read-only surface offers nothing but opening', () => {
    // The read-only card is still focusable and Enter still opens it — so the one
    // binding it keeps is the one it can keep.
    expect(availableCardKeys(READ_ONLY)).toEqual([{ action: 'open', keys: '↵ / 空格' }])
    expect(cardBindingFor(ev('['), READ_ONLY), 'a read-only card stepped a column').toBeUndefined()
    expect(cardBindingFor(ev('ArrowUp', { alt: true }), READ_ONLY)).toBeUndefined()
    expect(cardBindingFor(ev('Enter'), READ_ONLY)).toMatchObject({ action: 'open' })
  })

  it('a card with only a column step does not advertise the reorder', () => {
    const offers = availableCardKeys({ canStep: true, canReorder: false })
    expect(offers.map(o => o.action)).toEqual(['stepColumn', 'open'])
  })

  it('one action with two bindings is offered once, with both spellings', () => {
    // `↵ / 空格` and not `↵` then `空格`: a reader told the same thing twice learns
    // nothing the second time.
    const offers = availableCardKeys(BOTH)
    expect(offers.map(o => o.action)).toEqual(['stepColumn', 'reorder', 'open'])
    expect(offers.find(o => o.action === 'open')?.keys).toBe('↵ / 空格')
  })

  it('every action the map can name has a phrase, and every phrase has a key', () => {
    // Closed records make this a COMPILE error rather than a test failure — but
    // the test says out loud what the type is protecting, and it fails first if
    // someone reaches for `Partial` to make an error go away.
    for (const action of ['open', 'stepColumn', 'reorder'] as const) {
      expect(BOARD_KEY_PHRASE[action], `no phrase for ${action}`).toBeTruthy()
    }
    const phrases = Object.values(BOARD_KEY_PHRASE)
    expect(new Set(phrases).size, 'two actions share one phrase').toBe(phrases.length)
  })
})

describe('dispatch: the event is ours even when the move goes nowhere', () => {
  const actions = (): BoardCardKeyActions => ({
    open: vi.fn(), stepColumn: vi.fn(), reorder: vi.fn(),
  })

  it('runs the named handler with the binding argument', () => {
    const a = actions()
    expect(dispatchCardKey(ev(']'), BOTH, a)).toBe(true)
    expect(a.stepColumn).toHaveBeenCalledWith(1)
    expect(a.open).not.toHaveBeenCalled()
  })

  it('a keystroke that is not ours is handed back', () => {
    const a = actions()
    expect(dispatchCardKey(ev('q'), BOTH, a)).toBe(false)
    expect(a.open).not.toHaveBeenCalled()
  })

  it('a key the surface does not OFFER is handed back, not eaten', () => {
    // Two different situations, and conflating them is how a keystroke disappears:
    //   - NOT OFFERED: a read-only card has no column step at all, so `]` is not
    //     this card's key and the browser may have it. None of this vocabulary has
    //     a browser meaning, so handing it back costs nothing.
    //   - OFFERED BUT REFUSED: a card at the end of its column. That one IS ours
    //     and IS swallowed — asserted below — so the board never scrolls because a
    //     move had nowhere to go.
    const a = actions()
    expect(dispatchCardKey(ev(']'), READ_ONLY, a)).toBe(false)
    expect(a.stepColumn).not.toHaveBeenCalled()
  })

  it('a move with nowhere to go is still swallowed', () => {
    // The refusal happens in the handler (the column has an end), not in the map —
    // so the event is claimed and `preventDefault` runs, which is what stops the
    // board scrolling under a key that did nothing.
    const a = actions()
    expect(dispatchCardKey(ev(']'), BOTH, a), 'a refused move let the event travel').toBe(true)
    expect(a.stepColumn).toHaveBeenCalledWith(1)
  })
})

describe('the hint is built from the map, not written beside it', () => {
  const card = readFileSync(fileURLToPath(new URL('../src/client/board/TaskCard.tsx', import.meta.url)), 'utf8')
  const locales = readFileSync(fileURLToPath(new URL('../src/client/locales.ts', import.meta.url)), 'utf8')

  it('the card reads the map instead of testing keys itself', () => {
    expect(card, 'the card does not use the dispatcher').toContain('dispatchCardKey(event, cardKeyState, cardKeyActions)')
    expect(card, 'the card builds its offers from the map').toContain('availableCardKeys(cardKeyState)')
    expect(card, 'the card builds its phrases from the map').toContain('BOARD_KEY_PHRASE[offer.action]')
    // No inline key tests left: the whole point is that the vocabulary is a value.
    expect(card, 'an inline key test survived the refactor').not.toMatch(/event\.key === '(\[|\]|ArrowUp|ArrowDown)'/)
    expect(card, 'an inline modifier test survived the refactor').not.toMatch(/event\.(altKey|ctrlKey|metaKey)/)
  })

  it('neither locale file restates a key spelling', () => {
    // The spellings live in the table. A `[` or `Alt` written into a sentence is a
    // second copy, and it is the copy that goes stale.
    const hints = [...locales.matchAll(/'card\.(?:keyboardLabel|key\.\w+)': '([^']*)'/g)].map(m => m[1])
    expect(hints.length, 'the hint or a phrase went missing from one language').toBe(8)
    for (const hint of hints) {
      expect(hint, `a sentence hard-codes a key instead of taking {keys}: ${hint}`)
        .not.toMatch(/\[|\]|Alt|Arrow|回车|空格/)
    }
    // And the frame must actually carry the placeholder, or the derived list is
    // computed and thrown away.
    const labels = [...locales.matchAll(/'card\.keyboardLabel': '([^']*)'/g)].map(m => m[1])
    expect(labels.length).toBe(2)
    for (const label of labels) expect(label, `the label has no {keys}: ${label}`).toContain('{keys}')
  })
})
