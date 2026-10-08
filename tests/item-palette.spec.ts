/**
 * The command palette's CONTRACTS: what it promises, and whether it keeps them.
 *
 * WHY A SEPARATE FILE. `item-workbench.spec.ts` already drives the palette with
 * real keys, and `panel-render.spec.ts` reads the stylesheet; neither can answer
 * the questions this file is for, because every one of them is a question about a
 * PROMISE — 「the footnote says Enter runs it, so does it」, 「a modal surface
 * offers a way out」, 「`×` means one thing on this panel」. A promise is only
 * visible when you press the thing, so this mounts the panel and presses.
 *
 * WHAT IS DRIVEN AND HOW. Every key here is a REAL `KeyboardEvent` and every
 * click a real `MouseEvent`, through the harness's own `press`/`click`. That is
 * not ceremony: the last real bug this surface had was a handler whose `useMemo`
 * dependency list was missing four values, so it closed over the state from the
 * render that built it and `⌘K` would open a palette nothing could close. A
 * mocked event cannot catch that, and a mock that could would be a second
 * keyboard implementation living in the test folder.
 *
 * THE STANDING RULE. Every gate is paired with a control that feeds the same
 * computation a known-bad value and requires it to be reported. A check that
 * cannot fail is read as evidence and never looked at again.
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { claimsKey, dispatchKey, ITEM_KEYS, type ItemKeyActions } from '../src/client/item/keyboard.ts'
import { EMPTY_ITEM_QUERY, parseItemQuery } from '../src/core/item-view.ts'
import { ItemCommandPalette, type PaletteAction, type PaletteCommands } from '../src/client/item/command-palette.tsx'
import { click, fixtures, mountPanel, press, type as typeInto } from './panel-harness.ts'
import { zh } from '../src/client/locales.ts'

/** What the harness hands back: a mounted panel and the way to take it down. */
type Mounted = ReturnType<typeof mountPanel>

/** Open the palette the way a reader does, and hand back what came up. */
function open(panel: Mounted): HTMLElement {
  press(panel.surface, 'k', { metaKey: true })
  const box = panel.surface.querySelector('[class*="itemCommandPalette"]')
  if (box === null) throw new Error('⌘K did not open the palette')
  return box as HTMLElement
}

/** The palette's search field — where the caret is, and where every key lands. */
function fieldOf(panel: Mounted): HTMLInputElement {
  const input = panel.surface.querySelector('[class*="itemCommandPalette"] input')
  if (input === null) throw new Error('the palette opened with no field in it')
  return input as HTMLInputElement
}

/** Open the ＋新建一条 sheet, the surface the capture grammar now lives on. */
function openSheet(panel: Mounted): HTMLElement {
  const trigger = [...panel.surface.querySelectorAll('button')]
    .find(node => (node.textContent ?? '').includes(zh['item.topbar.create'] as string))
  if (trigger === undefined) throw new Error('the panel has no ＋新建一条 door')
  click(trigger)
  const sheet = panel.surface.querySelector('[class*="itemCreate"]')
  if (sheet === null) throw new Error('＋新建一条 opened nothing')
  return sheet as HTMLElement
}
function rowNamesOf(scope: HTMLElement): readonly string[] {
  return [...scope.querySelectorAll('[class*="itemFacetName"]')]
    .map(node => node.textContent ?? '')
    .filter(text => text !== '')
}

/** A press the harness cannot express: a pointer going down on the dimmed mask. */
function pressMask(panel: Mounted): void {
  const mask = panel.surface.querySelector('[class*="itemCommandPalette"]')
  if (mask === null) throw new Error('the palette is not on screen')
  act(() => { mask.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })) })
}

/** The same press, landing on something INSIDE the box. */
function pressInside(node: Element): void {
  act(() => { node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })) })
}

// ── The palette on its own ────────────────────────────────────────────────────

/** What the loose harness can do to the box. */
interface Loose {
  readonly host: HTMLElement
  /** A real keypress, through the table's own router. */
  readonly key: (name: 'Enter' | 'ArrowDown' | 'ArrowUp' | 'Escape') => void
  /** The query the box is holding, as typing would leave it. */
  readonly search: (next: string) => void
  /** What a press actually DID, in the order it happened. */
  readonly did: readonly string[]
  /** How many times the box told its caller it had closed. */
  readonly closes: () => number
  dispose: () => void
}

/**
 * THE BOX, MOUNTED DIRECTLY, WITH THE FOUR LINES THE PANEL SUPPLIES.
 *
 * `panel.tsx` owns the connection between the key map and this box, and it is not
 * this file's to write. So the cases that need a key to REACH the box mount the
 * box itself and wire exactly the four handlers the panel will wire — one per
 * action the map names for the palette, each calling the command the box
 * publishes. Nothing here is faked: the component under test is the real one, the
 * listener is the real one (`claimsKey` → `preventDefault` → `dispatchKey`, in
 * that order, exactly as `use-item-keys.ts` does it), and the key events are real
 * `KeyboardEvent`s dispatched at the real field.
 *
 * What this harness does NOT prove is that the panel passes those commands in.
 * That is one line of source, and the closed `ItemKeyActions` record is what turns
 * forgetting it into a build failure rather than a dead key.
 */
function mountLoose(): Loose {
  const g = globalThis as Record<string, unknown>
  g.IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.appendChild(host)
  const reactRoot: Root = createRoot(host)
  const did: string[] = []
  let commands: PaletteCommands | undefined
  let closes = 0
  let setText: (next: string) => void = () => undefined
  let setOpen: (next: boolean) => void = () => undefined

  const actions: readonly PaletteAction[] = [
    { id: 'page-list', label: zh['item.page.list'] as string, run: () => { did.push('go:list') } },
    { id: 'page-schedule', label: zh['item.page.schedule'] as string, run: () => { did.push('go:schedule') } },
    { id: 'undo', label: zh['item.undo.do'] as string, run: () => { did.push('undo') } },
  ]

  function Harness(): ReturnType<typeof createElement> {
    const [text, setNext] = useState('')
    const [isOpen, setIsOpen] = useState(true)
    setText = setNext
    setOpen = setIsOpen
    return createElement(ItemCommandPalette, {
      open: isOpen,
      text,
      onText: setNext,
      query: text.trim() === '' ? EMPTY_ITEM_QUERY : parseItemQuery(text),
      tags: [['画廊']],
      sort: 'sequence',
      onSort: () => { did.push('sort') },
      onPriority: priority => { did.push(`priority:${priority}`) },
      rows: fixtures(),
      actions,
      onPickRow: id => { did.push(`row:${id}`) },
      onClose: () => setOpen(false),
      onClosed: () => { closes += 1 },
      onCommands: next => { commands = next },
    })
  }
  act(() => { reactRoot.render(createElement(Harness)) })

  // The four handlers, in the shape `panel.tsx` will write them, plus the two it
  // already writes: `close` shuts this box, and everything else is recorded.
  const handlers = Object.fromEntries([...new Set(ITEM_KEYS.map(binding => binding.action))].map(name => [name, () => {
    if (name === 'palettePrev') commands?.step(-1)
    else if (name === 'paletteNext') commands?.step(1)
    else if (name === 'palettePick') commands?.pick()
    else if (name === 'close') { act(() => { setOpen(false) }) }
    else did.push(name)
  }])) as unknown as ItemKeyActions

  // The registrar, verbatim in behaviour: swallow first, then decide.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!claimsKey(event)) return
    event.preventDefault()
    dispatchKey(event, {
      focusedId: 'r-1',
      somethingOpen: host.querySelector('[class*="itemCommandPalette"]') !== null,
      paletteOpen: host.querySelector('[class*="itemCommandPalette"]') !== null,
    }, handlers)
  }
  host.addEventListener('keydown', onKeyDown)

  return {
    host,
    did,
    closes: () => closes,
    search: next => { act(() => { setText(next) }) },
    key: name => {
      const field = host.querySelector('input')
      if (field === null) throw new Error('the box has no field to press a key into')
      act(() => { field.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })) })
    },
    dispose: () => {
      host.removeEventListener('keydown', onKeyDown)
      act(() => { reactRoot.unmount() })
      host.remove()
    },
  }
}

/** The label under the cursor, for the loose box — or `''` when it is nowhere. */
function looseCursor(loose: Loose): string {
  const field = loose.host.querySelector('input')
  const id = field?.getAttribute('aria-activedescendant') ?? undefined
  if (id === undefined) return ''
  return loose.host.querySelector(`[id="${id}"]`)?.textContent ?? ''
}

/**
 * THE ANSWERS, and only the answers.
 *
 * The vocabulary is on screen whatever the reader typed — that is the reading the
 * whole box is built on, and a case that counted every option on the page would
 * be counting the wrong list.
 */
function answerOptions(loose: Loose): HTMLElement[] {
  return [...loose.host.querySelectorAll(
    '[data-palette-group="go"] [role="option"], [data-palette-group="act"] [role="option"], [data-palette-group="rows"] [role="option"]',
  )] as HTMLElement[]
}

describe('typing into the box leaves what the reader typed', () => {
  /**
   * THE ONE BUG HERE THAT NO SCREENSHOT CAN SHOW, because the field looked right
   * in every static render: the box is a CONTROLLED input whose value is
   * `freeTextOf(text)`, and its `onChange` handed the whole field back as if it
   * were ONE facet token. Every keystroke therefore appended the field to the
   * field — type `abc` and the box read `a ab a abc`, while the reader watched
   * their own word being mangled as the answers emptied out.
   *
   * The two halves were each correct on their own; what was missing was the third
   * function, `withFreeText`, whose contract is 「replace the WORDS and leave the
   * qualifiers standing」. A test that only asserted 「the field accepts a string」
   * passes for both the broken and the fixed version, so this one types and then
   * reads back what a reader would see.
   */
  const typeIn = (panel: Mounted, text: string): void => {
    const field = fieldOf(panel)
    act(() => {
      field.value = text
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('three keystrokes are three characters, not three copies of the field', () => {
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      open(panel)
      typeIn(panel, 'a')
      expect(fieldOf(panel).value).toBe('a')
      typeIn(panel, 'ab')
      expect(fieldOf(panel).value, 'the second keystroke appended the field to itself').toBe('ab')
      typeIn(panel, 'abc')
      expect(fieldOf(panel).value, 'typing three letters produced something else entirely').toBe('abc')
    } finally {
      panel.dispose()
    }
  })

  it('and a qualifier the chips cannot name survives the typing', () => {
    // The same defect had a second edge: the base handed to the writer was
    // `freeTextOf(text)`, so every qualifier the chip layer cannot render was
    // dropped on the first keystroke — the filter came off, the list silently
    // widened, and nothing had ever drawn the chip that would have said so.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      open(panel)
      // A qualifier nobody can chip: the grammar reads it, the chip layer cannot
      // label it, so it only survives if the writer preserves unknown qualifiers.
      const field = fieldOf(panel)
      act(() => {
        field.value = 'has:stale 画廊'
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const after = fieldOf(panel).value
      expect(after, 'the free text was not what the reader typed').toContain('画廊')
      expect(parseItemQuery(after).flags.has('stale'),
        'typing dropped a qualifier the reader had set, so the filter came off with nothing saying so').toBe(true)
    } finally {
      panel.dispose()
    }
  })
})

describe('a modal surface has to offer a way out of it', () => {  it('a press on the dimmed mask closes it, because the mask is the only door a touch has', () => {
    // THE DEFECT. The root element was a full-screen `dialog` carrying not one
    // handler, so a reader who opened the box with a finger and changed their mind
    // had nothing to press: the dimmed area swallowed the tap and the box stayed.
    // It declares `aria-modal="true"`, which promises the reader it is modal — and a
    // modal promise with no exit is a promise the reader cannot act on.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      open(panel)
      pressMask(panel)
      expect(panel.surface.querySelector('[class*="itemCommandPalette"]'), 'a press on the mask did not close the palette — the reader has no way out').toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('the probe bites: a press that lands INSIDE the box does not close it', () => {
    // The other half of the same question, and the reason the handler judges
    // WHERE THE PRESS LANDED rather than 「a press that missed the box」. A drag
    // that starts in the field and ends on the dimmed area ends with the mask as
    // the target — so judging by position would close the palette while a reader
    // selects text, and close it under their finger.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      open(panel)
      pressInside(fieldOf(panel))
      expect(panel.surface.querySelector('[class*="itemCommandPalette"]'), 'a press in the field closed the palette — the reader cannot select text in it').not.toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('and closing it tells the caller, so the focus has somewhere to go back to', () => {
    // `aria-modal` promises two things: a way out, and the focus back. The box
    // cannot give the focus back to a control it does not own — the reader pressed
    // `⌘K` and the caret is in a field they cannot see from — so it REPORTS the
    // close and the caller does it. Reported, not done: a caller that has no
    // trigger to focus must not be left with an exception on the way out.
    const loose = mountLoose()
    try {
      expect(loose.closes(), 'the box reported a close it was never given').toBe(0)
      loose.key('Escape')
      expect(loose.host.querySelector('[class*="itemCommandPalette"]'), 'Escape did not close the box').toBeNull()
      expect(loose.closes(), 'the box closed without saying so, so the caller cannot hand the focus back').toBe(1)
    } finally {
      loose.dispose()
    }
  })
})

describe('the footnote is a claim, and this is what keeps it', () => {
  it('Enter runs what the cursor is on', () => {
    // THE DEFECT WAS THE OPPOSITE. The box said 「回车执行，Esc 关掉」 over a screen
    // with no selection on it anywhere: no cursor, no Enter handler, no such
    // thing. A sentence under an interface is a claim about that interface, and
    // this one was false for as long as it was printed.
    const loose = mountLoose()
    try {
      loose.search(zh['item.page.schedule'] as string)
      expect(looseCursor(loose), 'the cursor did not land on the page the reader typed — Enter would run something else')
        .toContain(zh['item.page.schedule'] as string)
      loose.key('Enter')
      expect(loose.did, 'Enter on the typed page did not run that page').toEqual(['go:schedule'])
    } finally {
      loose.dispose()
    }
  })

  it('the cursor walks the list and wraps at both ends', () => {
    const loose = mountLoose()
    try {
      const options = [...loose.host.querySelectorAll('[role="option"]')] as HTMLElement[]
      expect(options.length, 'the box offers nothing the cursor can be on — a list of zero rows cannot answer 「what does ↓ reach」').toBeGreaterThan(3)
      const first = looseCursor(loose)
      expect(first, 'the box opened with the cursor nowhere').not.toBe('')
      // DOWN MOVES ONE. One press, one step: a cursor that jumped to the far end
      // would be a cursor the reader cannot predict, and predictability is the
      // whole reason to have one.
      loose.key('ArrowDown')
      const second = looseCursor(loose)
      expect(second, '↓ did not move the cursor').not.toBe(first)
      expect(options.map(one => one.textContent), 'the cursor left the list it was walking').toContain(second)
      // AND IT WRAPS. Stopping at the end answers 「there is nothing more」 when
      // there is, and a list whose arrow keys stop is a list a reader learns to
      // distrust at the bottom.
      loose.key('ArrowUp')
      loose.key('ArrowUp')
      expect(looseCursor(loose), '↑↑ from the first row did not wrap round to the last')
        .toBe(options[options.length - 1]?.textContent)
    } finally {
      loose.dispose()
    }
  })

  it('typing puts the cursor back on the first thing, because the list just changed', () => {
    // The cursor sat on the fifth row; the reader typed two characters and the
    // list is a different list. A cursor left where it was is choosing a row that
    // no longer means what it meant — the reader would press Enter on one thing
    // while the interface is pointing at another.
    const loose = mountLoose()
    try {
      loose.key('ArrowDown')
      loose.key('ArrowDown')
      loose.key('ArrowDown')
      expect(looseCursor(loose), 'the cursor did not move, so this case is reading nothing').not.toBe('')
      loose.search(zh['item.page.schedule'] as string)
      // With a search running the cursor chooses between the ANSWERS, so it lands
      // on the first thing the search found — not on the first chip above it,
      // which is why 「输日程、回车」 reaches the page and not a filter.
      expect(looseCursor(loose), 'the cursor stayed where it was across a new list').toBe(answerOptions(loose)[0]?.textContent)
    } finally {
      loose.dispose()
    }
  })

  it('a query that matches nothing leaves the cursor nowhere, and Enter does nothing', () => {
    const loose = mountLoose()
    try {
      loose.search('zzzz')
      expect(answerOptions(loose), 'a query that matches nothing still offers answers — the reader is being offered things that do not exist').toEqual([])
      expect(looseCursor(loose), 'the cursor is on something while nothing matches').toBe('')
      expect(loose.host.textContent, 'nothing matched and the box says nothing').toContain(zh['item.palette.nothing'] as string)
      loose.key('Enter')
      expect(loose.did, 'Enter over an empty answer list ran something anyway').toEqual([])
    } finally {
      loose.dispose()
    }
  })

  it('every key the footnote names is a key the table really binds, in that state', () => {
    // The footnote may promise only what the map answers. The glyphs are read out
    // of the shipped sentence rather than listed here, so a reworded footnote
    // cannot quietly start promising something else.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const hint = zh['item.palette.hint'] as string
      const named = keyNamesIn(hint)
      expect(named.length, 'the footnote names no keys at all — this gate is asserting nothing').toBeGreaterThan(2)
      for (const name of named) {
        const held = ITEM_KEYS.filter(binding => binding.key === name)
        expect(held.length, `the footnote promises ${name} and the map binds no such key`).toBeGreaterThan(0)
        expect(held.some(binding => binding.when === undefined || binding.when({ focusedId: 'r-1', somethingOpen: true, paletteOpen: true })),
          `the footnote promises ${name} inside the palette and no binding for it applies there`).toBe(true)
      }
    } finally {
      panel.dispose()
    }
  })

  it('the probe bites: a footnote promising a key nothing binds is reported', () => {
    const covered = (hint: string, keys: readonly { key: string }[]): boolean => {
      const named = keyNamesIn(hint)
      return named.length > 0 && named.every(name => keys.some(binding => binding.key === name))
    }
    expect(covered('↑↓ 选，回车执行，Esc 关掉。', ITEM_KEYS), 'the detector cannot see a bound key — the gate proves nothing').toBe(true)
    expect(covered('↑↓ 选，回车执行，Esc 关掉。', ITEM_KEYS.filter(one => one.key !== 'arrowdown')),
      'a footnote promising a key the map does not bind passed').toBe(false)
    expect(covered('这是一句话。', ITEM_KEYS), 'a footnote that promises no key passed').toBe(false)
  })
})

/** The `KeyboardEvent.key` values a sentence names, read out of the sentence. */
function keyNamesIn(text: string): readonly string[] {
  return [...text.matchAll(/↑|↓|↵|Esc/g)]
    .map(match => match[0] === 'Esc' ? 'escape' : match[0] === '↵' ? 'enter' : match[0] === '↑' ? 'arrowup' : 'arrowdown')
}

describe('one word, one meaning: the rows of this box are distinguishable', () => {
  it('there is no second row called 「优先级」, and the assigning row says what it does to whom', () => {
    // THE DEFECT. Two rows both named 「优先级」: one FILTERED by priority and the
    // other ASSIGNED priority to the row under the cursor — same word, opposite
    // order, same shape, side by side, with nothing on screen to tell a reader
    // which they were reading. The filtering row has moved to the spine; what is
    // left says which row it writes.
    const loose = mountLoose()
    try {
      const names = rowNamesOf(loose.host)
      expect(names.filter(name => name === (zh['item.facet.priority'] as string)),
        'the box still filters by priority under the same word the priority-ASSIGNING row uses').toEqual([])
      expect(names, 'the priority row does not say that it writes to the row under the cursor').toContain(zh['item.palette.prioritySet'] as string)
      expect(new Set(names).size, 'two rows share a name, so the reader has to remember which one is which').toBe(names.length)
    } finally {
      loose.dispose()
    }
  })

  it('going somewhere and doing something are two rows, because they are two things', () => {
    // 「收件 / 清单 / 日程」 change which page you are on and leave the document
    // alone; 「多选 / 清空筛选 / 撤销」 act on it. Under one heading called 「动作」
    // the reader cannot tell which of the two pressing a word will do.
    const loose = mountLoose()
    try {
      const names = rowNamesOf(loose.host)
      expect(names, 'the box does not separate 「go somewhere」 from 「do something」').toContain(zh['item.palette.go'] as string)
      expect(names, 'the box does not separate 「do something」 from 「go somewhere」').toContain(zh['item.palette.act'] as string)
      const rows = [...loose.host.querySelectorAll('[class*="itemFacetRow"]')]
      const rowNamed = (name: string): Element | undefined =>
        rows.find(row => row.querySelector('[class*="itemFacetName"]')?.textContent === name)
      expect(rowNamed(zh['item.palette.go'] as string)?.textContent ?? '', 'the 「go」 row does not carry the page names')
        .toContain(zh['item.page.schedule'] as string)
      expect(rowNamed(zh['item.palette.act'] as string)?.textContent ?? '', 'the 「actions」 row carries the page names — the split is a label and nothing else')
        .not.toContain(zh['item.page.schedule'] as string)
    } finally {
      loose.dispose()
    }
  })

  it('the probe bites: two rows that share a name are reported', () => {
    const shared = (names: readonly string[]): string[] => names.filter((name, index) => names.indexOf(name) !== index)
    expect(shared(['状态', '日期', '排序']), 'the detector cannot see a shared name — the gate proves nothing').toEqual([])
    expect(shared(['状态', '优先级', '优先级']), 'two rows named 「优先级」 passed').toEqual(['优先级'])
  })

  it('the foot of the box says nothing in bare symbols any more', () => {
    // The glyphs moved into the sheet, where each one has a sentence beside it.
    // What is left is a sentence about the keys and a `?` that opens the table.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const box = open(panel)
      const text = box.textContent ?? ''
      for (const glyph of ['⌘⌫', '⌘Z']) {
        expect(text, `the box still prints ${glyph} with no sentence attached — a glyph with nothing beside it teaches nothing`).not.toContain(glyph)
      }
      expect(text, 'the box says nothing about what its keys do').toContain(zh['item.palette.hint'] as string)
    } finally {
      panel.dispose()
    }
  })
})

describe('`×` means one thing on this panel: it takes a condition OFF the query', () => {
  it('and nothing that puts text BACK borrows it', () => {
    // THE DEFECT, IN THE READER'S WORDS: 「点那个叉，它会往输入框里面继续输入，没有
    // 把它叉掉」. Two controls wore the same glyph an inch apart and meant opposite
    // things — the qualifier chip really does delete, and the capture box's chip
    // puts the characters back. Same shape, opposite verbs, and the only way to
    // find out which was to press it.
    //
    // So the rule is checked over the whole rendered surface rather than over the
    // one control that was fixed: EVERY cross belongs to a control whose own name
    // says it removes a condition. A cross anywhere else fails here, which is what
    // stops the next one from being added beside something that is not a deletion.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      // A qualifier is set, so the chip that removes it is on screen.
      open(panel)
      typeInto(fieldOf(panel), 'status:open')
      const crosses = [...panel.surface.querySelectorAll('button')].filter(node => node.textContent === '×')
      expect(crosses.length, 'no `×` was rendered, so this case is reading nothing — set a qualifier first').toBeGreaterThan(0)
      for (const node of crosses) {
        expect(node.getAttribute('aria-label') ?? '', 'a `×` is on screen with no name, so nothing says what it removes')
          .toMatch(/^(去掉|移除)/)
      }
      // AND THE CAPTURE BOX'S OWN CHIP IS NOT ONE OF THEM. Typing a tag there
      // produces the chip that undoes the parser; it must not be a cross.
// AND THE ONE FIELD THAT PUTS TEXT BACK IS NOT ONE OF THEM. Typing a tag
// AND THE ONE FIELD THAT PUTS TEXT BACK IS NOT ONE OF THEM. Typing a tag
      // into it produces the chip that undoes the parser; it must not be a cross.
      //
      // IT IS NO LONGER ON THE SURFACE AT REST, and that is the whole change: the
      // capture grammar lives in the ＋新建一条 sheet now, so there is no always-on
      // field to type into — which is why the two controls could collide at all.
      // The rule still has to hold, so it is checked where the field now lives:
      // in the sheet, opening it first.
      openSheet(panel)
      const capture = panel.surface.querySelector('[class*="itemInput"]')
      expect(capture, 'the sheet opened and there is still no field — there is no chip to look at').not.toBeNull()
      typeInto(capture, '#画廊 !1')
      const chip = [...panel.surface.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.includes(zh['item.token.undo'] as string))
      expect(chip, 'the sheet drew no chip for what it recognised — there is nothing to check').toBeDefined()
      expect(chip?.textContent, 'the chip that puts text back is a cross again — the same glyph, the opposite verb, one inch apart').not.toContain('×')
      expect(chip?.getAttribute('aria-label'), 'the chip that puts text back does not say so').toContain(zh['item.token.undo'] as string)
    } finally {
      panel.dispose()
    }
  })

  it('the probe bites: a cross on a control that removes nothing is reported', () => {
    const ownsCross = (label: string): boolean => /^(去掉|移除)/.test(label)
    expect(ownsCross('去掉「状态：待办」'), 'the detector cannot see a real removal — the gate proves nothing').toBe(true)
    expect(ownsCross('还原成普通文字'), 'a cross on the chip that puts text back passed').toBe(false)
    expect(ownsCross(''), 'an unnamed cross passed').toBe(false)
  })
})

describe('the qualifier chip says the filter, not the kind', () => {
  it('a chip carries the value as well as the face, in words rather than in tokens', () => {
    // Checked because the reader reported a chip reading 「标签」 and nothing else.
    // The qualifier chip has always said 「标签：画廊」; what they pressed was the
    // capture box's own chip, which names the kind the parser recognised and
    // borrowed the removal cross for its second half. Both facts are pinned here —
    // the one that was already true, so it cannot rot, and the one that was not.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      open(panel)
      typeInto(fieldOf(panel), '#画廊 status:open')
      const labels = [...panel.surface.querySelectorAll('[class*="itemQueryChipLabel"]')].map(node => node.textContent ?? '')
      expect(labels, 'no qualifier chip was drawn for a qualifier that is on the query — the filter is applied with nothing saying so').not.toEqual([])
      expect(labels, 'the tag chip names the kind but not the tag').toContain(`${zh['item.facet.tag']}：画廊`)
      expect(labels, 'the status chip names the kind but not the status').toContain(`${zh['item.facet.status']}：${zh['item.group.open']}`)
      for (const label of labels) {
        expect(label, `a chip reads 「${label}」 — a chip with no value cannot be read back, so it cannot be taken off`).toContain('：')
      }
    } finally {
      panel.dispose()
    }
  })
})
