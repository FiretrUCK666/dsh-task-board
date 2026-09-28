/**
 * The task-list panel, rendered for real and measured.
 *
 * WHY A RENDER HARNESS AND NOT A SCREENSHOT OF THE APP. Every layout rule in
 * DESIGN.md about width, density and containment was written by measuring a
 * rendering, and a static check cannot keep any of them: the panel filling its
 * box, the columns not overlapping, the text staying inside its slot — those
 * are facts about computed geometry, not about source text. So the loop has to
 * be "render it, measure it, fix what it shows".
 *
 * It renders the APP rather than this page in the running GUI on purpose. The
 * GUI is behind a per-process launch token and a second instance would open
 * the same storage unit the live one holds (a dual-open this plugin has
 * already been bitten by), so neither route is safe to rely on. This page is
 * the third option and the better instrument: it is deterministic, it needs no
 * server, it runs on every `pnpm test`, and it can assert geometry instead of
 * asking a human to look at a PNG. The PNG is still the final word on taste —
 * `scripts/shot-panel.mjs` captures this page — but the geometry claims are
 * checked here, every run, by arithmetic rather than by eye.
 *
 * THE TOKENS ARE READ FROM THE INSTALLED HARNESS, NOT COPIED. A snapshot of
 * `--dsw-*` values in a test goes stale the first time the host re-skins, and
 * then it is worse than no snapshot: it renders a plausible page in the wrong
 * colours and every conclusion drawn from it is about a host that no longer
 * exists. So the token block is extracted from the real theme stylesheet, and
 * `every dsw token the panel names exists in the host` is a TEST — a token that
 * disappears from the host fails here instead of quietly rendering transparent.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ItemRecord } from '../src/core/item.ts'
import { ItemListPanel } from '../src/client/item/panel.tsx'
import { DEFAULT_VIEW_PREFS, VIEW_PREFS_KEY } from '../src/client/item/view-prefs.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** A fixed clock, so every date-derived rendering is reproducible. */
const NOW = new Date(2026, 8, 29, 10, 0, 0).getTime()
const day = 86_400_000

/**
 * A panel that exercises EVERY branch the surface can draw, in one list.
 *
 * A fixture that only has an ordinary row proves an ordinary row renders. The
 * states that break layouts are the ones with text of an unexpected length and
 * a second element beside it: an overdue hard deadline, a title long enough to
 * force a real ellipsis, a row with a step list, a row with a link chip, and a
 * row whose title is empty so the body has to supply one.
 */
function fixtures(): ItemRecord[] {
  const base = {
    body: '',
    notes: '',
    steps: [],
    status: 'open' as const,
    priority: 'normal' as const,
    tags: [] as string[],
    startsAfter: undefined,
    dueAt: undefined,
    hardDueAt: undefined,
    taskId: undefined,
    origin: { source: 'human' as const, at: NOW - 30 * day },
    createdAt: NOW - 30 * day,
    updatedAt: NOW - day,
  }
  return [
    {
      ...base,
      id: 'fx-hard-overdue',
      ref: 1,
      title: '这一条硬期限已经过了整整九天，是最长的一条，用来逼出换行与截断',
      status: 'open',
      priority: 'urgent',
      hardDueAt: NOW - 9 * day,
      dueAt: NOW - 12 * day,
      tags: ['画廊', '重做'],
      steps: [
        { id: 's1', text: '第一步：把详情侧栏的地板量出来', done: true },
        { id: 's2', text: '第二步：在 390px 上验一遍', done: false },
        { id: 's3', text: '第三步：确认没有控件被藏掉', done: false },
      ],
    },
    {
      ...base,
      id: 'fx-soft-late',
      ref: 2,
      title: '这一条只是落后了计划，硬期限还在下周，所以它不该是红的',
      dueAt: NOW - 3 * day,
      priority: 'high',
    },
    {
      ...base,
      id: 'fx-gated',
      ref: 3,
      title: '这一条还没到最早开始的时间，所以它不该出现在日程议程里',
      startsAfter: NOW + 6 * day,
      dueAt: NOW + 20 * day,
    },
    {
      ...base,
      id: 'fx-blocked',
      ref: 4,
      title: '这一条卡住了，在等一个还没回来的答复',
      status: 'blocked',
      priority: 'normal',
    },
    {
      ...base,
      id: 'fx-linked',
      ref: 5,
      title: '这一条挂在一张卡上',
      taskId: 'task-1',
      dueAt: NOW + 2 * day,
    },
    {
      ...base,
      id: 'fx-untitled',
      ref: 6,
      title: '',
      body: '这一条没有标题，所以标题要从正文首行借',
    },
    {
      ...base,
      id: 'fx-done',
      ref: 7,
      title: '这一条做完了',
      status: 'done',
      origin: { source: 'ai' as const, at: NOW - 10 * day, sessionId: 'sess-1' },
      updatedAt: NOW - 2 * day,
    },
  ]
}

/** The panel reads exactly these five members of the replica; nothing else. */
function fakeReplica(items: readonly ItemRecord[]) {
  return {
    view: () => items,
    setItems: () => undefined,
    hostLostItems: () => false,
    isSynced: () => true,
    onRemote: () => () => undefined,
  }
}

type Band = 'wide' | 'narrow'
type Page = 'list' | 'inbox' | 'schedule'

/**
 * Render the panel in one band, on one page.
 *
 * `useSurfaceNarrow` decides "is this surface narrow" by MEASURING it, and
 * server rendering runs no effects — so the only value it can hold is the
 * first one, the viewport proxy. Without help, every render here comes out in
 * the wide band, and a screenshot of a 390px window would show the two-column
 * desktop: a picture of the wrong shape, taken with a real camera. So the
 * viewport proxy is stubbed for the narrow band.
 *
 * The PAGE is injected the same way, through the only place the panel reads it
 * from: `readViewPrefs()`, which in a node environment finds no storage and
 * falls back to the defaults. Stubbing `localStorage.getItem` therefore sets
 * the page without the panel growing a prop that exists only for a test — a
 * test-only prop is a second way to say which page is open, and two ways drift.
 * Both stubs are removed again in `finally`, so neither leaks into the next
 * render or into another spec.
 * @param items - the rows to render.
 * @param band - `wide` (the default) or `narrow`.
 * @param page - which of the three pages to open.
 * @returns the markup.
 */
function renderPanel(items: readonly ItemRecord[], band: Band = 'wide', page: Page = 'list'): string {
  const realMedia = globalThis.matchMedia
  const realWindow = (globalThis as { window?: unknown }).window
  if (band === 'narrow') {
    globalThis.matchMedia = ((query: string) => ({
      matches: /max-width:\s*720px/.test(query),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof globalThis.matchMedia
  }
  // The PAGE is not a prop — `ItemListPanel` reads it from `readViewPrefs()`,
  // which reads `window.localStorage` inside a try/catch. So the thing to
  // fake is the STORAGE, on the object the module actually reaches for. Two
  // earlier attempts failed here and both looked right:
  //
  //  - stubbing `globalThis.localStorage` while the module reads
  //    `window.localStorage`, which in a node environment is a different (or
  //    absent) slot — the read threw, the catch returned the defaults, and
  //    every page rendered as the list;
  //  - stubbing `globalThis.window` WITHOUT giving it a `localStorage`, for
  //    the same reason.
  //
  // Both were invisible: the render succeeded and simply ignored the argument.
  // A harness that accepts a setting and quietly drops it is worse than one
  // that refuses it, so the stubs are restored in `finally` and the artifact
  // test asserts the page actually took.
  const store = {
    getItem: (key: string) => (key === VIEW_PREFS_KEY ? JSON.stringify({ ...DEFAULT_VIEW_PREFS, page }) : null),
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  } as unknown as Storage
  ;(globalThis as { window?: unknown }).window = { ...(realWindow as object | undefined), localStorage: store }
  try {
    return renderToStaticMarkup(createElement(ItemListPanel, {
      signal: new AbortController().signal,
      face: {
        replica: fakeReplica(items),
        controller: {
          getSnapshot: () => ({ tasks: [{ id: 'task-1', title: '画廊第二版', description: '' }] }),
          liveStateOf: () => 'idle',
        },
      } as never,
    } as never))
  } finally {
    globalThis.matchMedia = realMedia
    ;(globalThis as { window?: unknown }).window = realWindow
  }
}

/** Locate the installed DSH, the same way the toolchain does: by resolution. */
function dshHome(): string | undefined {
  for (const root of [join(process.env.APPDATA ?? '', 'npm', 'node_modules'), join(process.env.HOME ?? '', '.npm', 'node_modules')]) {
    const candidate = join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Put the markup and the stylesheet on the SAME class name.
 *
 * The renderer hands out scoped names (`_itemRoot_56f2ef`) while the sheet on
 * disk says `.itemRoot`, so a page built from the two renders completely
 * unstyled — which looks exactly like a catastrophic CSS failure and is
 * nothing of the kind. The two are reconciled here rather than by
 * configuration, for a concrete reason: Vitest's
 * `css.modules.classNameStrategy` is inert here, because its `css.include`
 * defaults to empty, so the stylesheet's CONTENT is never processed and the
 * strategy is never consulted — only Vite's own transform runs, and it hashes.
 * Rewriting both sides from one map is deterministic and cannot drift, because
 * both sides come from the same render and the same file.
 *
 * Nothing is written back to the project: the assertions below read the real
 * class names off disk, not off this page.
 */
function alignClassNames(html: string, css: string): { html: string; css: string } {
  const scoped = new Map<string, string>()
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const token of (match[1] ?? '').split(/\s+/)) {
      const parts = /^_(.+)_[0-9a-z]{6,}$/.exec(token)
      if (parts?.[1] !== undefined && !scoped.has(parts[1])) scoped.set(parts[1], token)
    }
  }
  // The stylesheet is left EXACTLY as it is on disk; only the markup is
  // renamed, by stripping the scope suffix the renderer added. The page then
  // reads like the source — `.itemRoot` rather than `_itemRoot_a9e292` — which
  // is what makes a measurement or a DOM query in the browser possible at all.
  // A harness whose output cannot be queried is a screenshot.
  //
  // Rewriting the STYLESHEET to the scoped names instead is the tempting move
  // and it silently produces a page with no styles at all: the two sides are
  // renamed apart, and an unstyled render looks like a catastrophic CSS
  // failure rather than a mistake in this file.
  let markup = html
  for (const [, scopedName] of scoped) {
    markup = markup.replace(new RegExp(`\\b${scopedName}\\b`, 'g'), (match) => match.slice(1, match.lastIndexOf('_')))
  }
  return { html: markup, css }
}

/**
 * The host's real token stylesheets, lifted out of the bundle that ships them.
 *
 * The theme bundle holds TEN css string literals — `base`, `design_platform`,
 * `corner_shape`, `focus`, `scrollbar` and the rest — and the tokens are spread
 * across all of them: `--dsw-font-family` and `--dsw-shadow-lv1` are declared
 * outside the one that declares `--dsw-alias-bg-base`. Reading one literal and
 * calling the rest "absent" is how a coverage check starts crying wolf, so all
 * ten are read and concatenated.
 *
 * Each literal is handed to `JSON.parse` rather than unescaped by hand: the
 * escapes in it (`\"PingFang SC\"` and the `#rrggbbaa` colours) are a subset of
 * JSON's, and a hand-rolled unescape silently mangles exactly the font stack
 * and the alpha values that matter most here.
 */
function hostTokenCss(): string {
  const bundle = dshHome()
  if (bundle === undefined) return ''
  const source = readFileSync(bundle, 'utf8')
  const sheets: string[] = []
  for (const match of source.matchAll(/(\w+)_css_default\s*=\s*"/g)) {
    // The slice has to carry BOTH quotes: `JSON.parse` on a bare `body{...}"`
    // fails, and a parse failure here is silent — it reads as "the host
    // declares no tokens at all" rather than as a bug in this file.
    const open = match.index + match[0].length - 1
    let end = open + 1
    while (end < source.length) {
      if (source[end] === '\\') { end += 2; continue }
      if (source[end] === '"') break
      end += 1
    }
    try {
      sheets.push(JSON.parse(source.slice(open, end + 1)) as string)
    } catch {
      // One unparsable literal is a fact about the bundle, not a reason to
      // report every token in it as missing.
    }
  }
  return sheets.join('\n')
}

/** The panel's own stylesheet, if it has been created yet. */
function itemSheetPath(): string {
  return join(repoRoot, 'src/client/item/item.module.css')
}

/** The shared alias layer: the `--dsh-tb-*` definitions both sheets consume. */
function aliasLayer(css: string): string {
  const block = /\[data-dsh-taskboard-view\][^{]*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
  return block
}

/** The panel's own stylesheets, as written (the module class names are literal here). */
function panelCss(): string {
  const sheets = ['src/client/board.module.css', 'src/client/item/item.module.css']
  return sheets
    .map(sheet => {
      const path = join(repoRoot, sheet)
      return existsSync(path) ? `\n/* ${sheet} */\n${readFileSync(path, 'utf8')}` : ''
    })
    .join('\n')
}

/**
 * Every `--dsw-*` name the given CSS actually USES, with comments removed.
 *
 * Comments come off FIRST, and that is the whole point of this function.
 * board.module.css:164 explains in prose why a token was removed, and the
 * explanation quotes the old `var(--dsw-...)` call. A scanner that matches
 * inside comments reports a token that no rule uses — and the cheapest way to
 * silence that is to reword the comment, which destroys the note and fixes
 * nothing. Stripping first is the only reading that keeps a correct
 * implementation from having to become a worse one.
 *
 * A name that appears only as a FALLBACK (`var(--x, something)`) is not a
 * finding either, and for the same reason: the author already declared what
 * happens when the host does not provide it, so the declaration is complete.
 */
function dswNamesReferenced(css: string): string[] {
  const live = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const used = new Set<string>()
  for (const call of live.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)\s*([,)])/g)) {
    // `,` means a fallback follows, so the author has already answered for the
    // case where the host does not declare it.
    if (call[2] === ',') continue
    used.add(call[1] as string)
  }
  return [...used].sort()
}

/**
 * Tokens the project already ruled absent, each with the reason it is here.
 *
 * An exemption without a reason is indistinguishable from a gap, and a gap
 * that has learned to shout is how a gate gets switched off. So every entry
 * says why the host does not declare it and what the panel gets instead.
 */
const ABSENT_BY_DECISION: Readonly<Record<string, string>> = {
  // board.module.css:44-52 documents this one at length: the shell references
  // the token and never declares it (zero declarations across the whole DSH
  // install), so the alias is deliberately `none` and the separators never
  // paint. Naming it here keeps that decision from being "fixed" by accident.
  '--dsw-alias-separator-primary': 'the host references it and never declares it; the alias is deliberately `none`',
}

describe('the panel renders against the host it will actually run in', () => {
  const tokens = hostTokenCss()
  const css = panelCss()
  const itemSheet = existsSync(itemSheetPath()) ? readFileSync(itemSheetPath(), 'utf8') : ''

  it('finds the host token stylesheets, so nothing is measured against a snapshot', () => {
    // Without this the rest of the file would pass by asserting nothing: a
    // harness that silently renders colourless geometry is not a harness.
    expect(tokens, 'the installed DSH theme bundle was not found').not.toBe('')
    expect(tokens).toContain('--dsw-alias-bg-base')
    expect(tokens).toContain('--dsw-font-family')
  })

  it('has a stylesheet of its own, so the list stops living inside the board\'s', () => {
    expect(existsSync(itemSheetPath()), 'src/client/item/item.module.css does not exist yet').toBe(true)
  })

  it('keeps zero list rules inside the board stylesheet', () => {
    // 74 rules were appended there under a heading that still read "right-hand
    // page". A separate sheet is the structural half of that fix: after it,
    // nothing about the list can be edited from the board's file by accident.
    expect(/\.item[A-Z]/.test(css) && css.includes('src/client/board.module.css')).toBe(true)
    const boardOnly = readFileSync(join(repoRoot, 'src/client/board.module.css'), 'utf8')
    const leftover = [...boardOnly.matchAll(/^\.item[A-Z][A-Za-z]*\s*\{/gm)].map(m => m[0])
    expect(leftover, `these list rules are still in board.module.css: ${leftover.join(', ')}`).toEqual([])
  })

  it('names only tokens the host declares, in the list\'s own sheet and in the shared alias layer', () => {
    // A token the host dropped resolves to nothing, which paints as transparent
    // — and a transparent surface is exactly the class of bug that reads as a
    // layout bug. Scoped to this surface: the board's own sheet is a different
    // surface, and a check that spans both is a check nobody can act on.
    const named = [...new Set([
      ...dswNamesReferenced(itemSheet),
      ...dswNamesReferenced(aliasLayer(readFileSync(join(repoRoot, 'src/client/board.module.css'), 'utf8'))),
    ])]
    const missing = named.filter(name => !tokens.includes(`${name}:`) && ABSENT_BY_DECISION[name] === undefined)
    const why = missing.map(name => `${name}${ABSENT_BY_DECISION[name] === undefined ? '' : ` (${ABSENT_BY_DECISION[name]})`}`)
    expect(missing, `the list names tokens the host does not declare: ${why.join(', ')}`).toEqual([])
  })

  it('produces markup, not an error page', () => {
    const html = renderPanel(fixtures())
    expect(html.length).toBeGreaterThan(500)
    expect(html).not.toContain('undefined')
  })

  it('really opens the page it was asked for, on every page', () => {
    // A harness that accepts a setting and quietly drops it is worse than one
    // that refuses it: every capture then looks right and proves nothing. This
    // is the check that would have caught the page argument landing nowhere.
    const inbox = renderPanel(fixtures(), 'wide', 'inbox')
    const schedule = renderPanel(fixtures(), 'wide', 'schedule')
    const list = renderPanel(fixtures(), 'wide', 'list')
    // The inbox is the page that deliberately has no second-level chrome, and
    // the agenda is the only one whose primary form is a day sequence.
    expect(inbox).toContain('收件只放还没分流的想法')
    expect(schedule).toContain('没有日期')
    expect(schedule).toContain('还没到开始时间')
    // And they must be three DIFFERENT documents, not one rendered three times.
    expect(new Set([inbox, schedule, list]).size).toBe(3)
  })

  it('really narrows to the band it was asked for', () => {
    // Same reason, for the band: the viewport proxy is only the FIRST value
    // the hook can hold, and a stub in the wrong slot leaves every capture in
    // the wide band while looking perfectly healthy.
    const wide = renderPanel(fixtures(), 'wide')
    const narrow = renderPanel(fixtures(), 'narrow')
    expect(narrow).not.toBe(wide)
    // The detail pane is the wide band's own track; a narrow one has no pane.
    expect(wide).toContain('itemDetailPane')
    expect(narrow).not.toContain('itemDetailPane')
  })
})

/**
 * THE GEOMETRY CONTRACTS.
 *
 * These are the claims that the screenshots in the bug report contradict, and
 * they are written as arithmetic on the source rather than as a picture,
 * because a picture has to be believed. Each one states the failure it exists
 * to catch, in the same shape: the rule, then the reason it was ever broken.
 */
describe('the panel fills the stage it is given', () => {
  const css = panelCss()

  it('declares a definite height on a border-box root, so padding cannot push it over', () => {
    // The board carries this exact rule and explains why in a comment at
    // board.module.css:334-338: height:100% plus content-box padding makes the
    // panel taller than its own view, and the overflow lands at the bottom.
    const root = /\.itemRoot\s*\{[^}]*\}/s.exec(css)?.[0] ?? ''
    expect(root, 'there is no .itemRoot rule').not.toBe('')
    expect(root).toMatch(/box-sizing\s*:\s*border-box/)
    expect(root).toMatch(/(?:block-size|height)\s*:\s*100%/)
    // Both spellings count: the sheet is written in logical properties, and a
    // check that demanded the physical one would be sending the author back to
    // convert a correct file instead of finding a real defect.
    expect(root, 'the root can shrink below its content, so its scroller is not a scroller')
      .toMatch(/min-(?:block-size|height)\s*:\s*0/)
  })

  it('paints an OPAQUE surface, so the host wallpaper cannot show through the panel', () => {
    // The old rule painted itself with --dsh-tb-bg, which is the host's GLASS
    // token; the comment above it claimed the opposite. Only the opaque inner
    // layer tokens actually keep the wallpaper out.
    const root = /\.itemRoot\s*\{[^}]*\}/s.exec(css)?.[0] ?? ''
    const background = /background\s*:\s*([^;]+)/.exec(root)?.[1] ?? ''
    expect(background).not.toBe('')
    expect(background, 'the panel root paints with the glass token').not.toMatch(/var\(--dsh-tb-bg\)/)
  })

  it('wraps the root in the stage that hands it a definite height', () => {
    // The board has this wrapper and the list did not, which is the structural
    // half of the same defect: without it the root's `height: 100%` has no
    // definite containing block to resolve against, and the four column tracks
    // collapse to zero and their text overflows on top of the header.
    //
    // The stage is named in the LIST's own family (`.itemPanelStage`), because
    // `.panelStage` belongs to the board — hard rule 3 keeps each surface's
    // class names to itself, and two surfaces sharing one class name is how a
    // fix to one silently restyles the other. So this looks for the item name.
    const stage = /\.itemPanelStage\s*\{[^}]*\}/s.exec(css)?.[0] ?? ''
    expect(stage, 'there is no .itemPanelStage rule').not.toBe('')
    expect(stage).toMatch(/min-block-size\s*:\s*0/)
    expect(stage).toMatch(/(?:block-size|height)\s*:\s*100%/)
  })

  it('never decides a layout from the viewport', () => {
    // The surface's own width is the only honest reference; a media query on
    // the viewport misjudges exactly when the shell sidebar is open. Comments
    // come off first for the same reason the token scan strips them: this file
    // explains the rule IN A COMMENT by quoting the query it forbids, and a
    // scanner that reads comments reports the explanation as a violation.
    // The touch-ergonomics query is not a layout decision and stays allowed.
    const live = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const widthQueries = [...live.matchAll(/@media[^{]*?\b(?:max|min)-width/g)].map(m => m[0].trim())
    expect(widthQueries, `a viewport width query decides this panel's layout: ${widthQueries.join(' | ')}`).toEqual([])
  })

  it('keeps the sanctioned touch-ergonomics query, and uses it for nothing else', () => {
    // `@media (hover: none) and (pointer: coarse)` may grow hit areas and
    // nothing more. If it ever grows a visual size, the phone stops being the
    // same product at a smaller width, which is the one thing rule 11 forbids.
    const live = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const block of live.matchAll(/@media \(hover: none\) and \(pointer: coarse\) \{([\s\S]*?)\n\}/g)) {
      const body = block[1] ?? ''
      expect(body, 'the touch query changes a visual size, not just a hit area').not.toMatch(
        /(?:font-size|inline-size|block-size|width|height|padding|border-width)\s*:\s*(?!24px|44px|16px)[\d.]+px/,
      )
    }
  })

  it('never asks a container query about the element that IS the container', () => {
    // A container query resolves against an element's nearest ANCESTOR with
    // the named container — and an element is not its own ancestor. So
    //
    //   .itemRoot { container-name: dsh-tb-item }
    //   @container dsh-tb-item (max-width: 719px) { .itemRoot { --inset: 12px } }
    //
    // parses, lints, and balances its braces, and then NEVER MATCHES. The
    // declaration is simply dead, and no other gate can see it: class names
    // resolve both ways, every token is declared, the file is clean. The
    // symptom is a phone rendering the desktop's padding, which reads as a
    // layout bug in a place nobody is looking.
    //
    // Two rules make the check itself honest, and both were found by reading
    // this comment and getting it wrong:
    //
    //   1. A NAME IS DECLARED BY A SET OF CLASSES, never by one. `.itemDetail`
    //      and `.itemDetailPane` both declare `dsh-tb-item-detail` — that is
    //      the mechanism for one component rendered in two places. A map that
    //      keeps only the last declarer would let a self-query on the other one
    //      through, which is the exact defect this exists to catch.
    //   2. THE PREDICATE IS BOUND TO THE QUERIED NAME. A block may legitimately
    //      mention a class that declares a DIFFERENT container:
    //      `@container dsh-tb-item { .itemDetail { display: none } }` is a real
    //      rule here, because `.itemDetail` answers to `dsh-tb-item-detail` and
    //      the block asks about the panel. A check that only asks "does this
    //      selector name a container at all" reports it, and the next reader
    //      deletes a correct rule to make the gate quiet.
    const live = css.replace(/\/\*[\s\S]*?\*\//g, '')
    // class -> every container name it declares (a set, per rule 1)
    const declares = new Map<string, string[]>()
    for (const rule of live.matchAll(/\.([A-Za-z][\w-]*)\s*\{([^}]*)\}/g)) {
      for (const name of rule[2].matchAll(/container-name\s*:\s*([a-z][\w-]*)/g)) {
        declares.set(rule[1] as string, [...(declares.get(rule[1] as string) ?? []), name[1] as string])
      }
    }
    const dead: string[] = []
    for (const block of live.matchAll(/@container\s+([a-z][\w-]*)[^{]*\{([\s\S]*?)\n\}/g)) {
      const asked = block[1] as string
      const body = block[2] ?? ''
      for (const [selector, names] of declares) {
        // rule 2: only THIS name counts, not "declares something"
        if (names.includes(asked) && new RegExp(`\\.${selector}(?![\\w-])`).test(body)) {
          dead.push(`@container ${asked } { ... .${selector} ... } — .${selector} declares ${asked}, so it can never match it`)
        }
      }
    }
    expect(dead, `container queries that can never match:\n  ${dead.join('\n  ')}`).toEqual([])
  })
})

/**
 * THE GATE PROVES IT CAN BITE, on all three shapes of the question.
 *
 * A check that cannot fail is worse than no check: it is read as evidence and
 * it is never looked at again. So this feeds the scan the defect it exists to
 * catch, a SECOND declarer of the same container (the shape that a one-to-one
 * map would wave through), and — the one that matters most — a rule that is
 * CORRECT and must stay silent.
 *
 * The third case is what separates a working gate from a gate that passes
 * because its input happens to be clean. A scan that reported
 * `@container dsh-tb-item { .itemDetail … }` would be reporting a true rule:
 * `.itemDetail` answers to `dsh-tb-item-detail` and the block asks about the
 * panel. A gate that cries wolf there gets its rule deleted by the next reader,
 * and the real defect it was built for comes back with it.
 */
describe('the container self-query gate reacts', () => {
  const live = panelCss().replace(/\/\*[\s\S]*?\*\//g, '')

  /** Which class declares which container name. */
  function declarersOf(css: string): Map<string, string[]> {
    const declares = new Map<string, string[]>()
    for (const rule of css.matchAll(/\.([A-Za-z][\w-]*)\s*\{([^}]*)\}/g)) {
      for (const name of rule[2].matchAll(/container-name\s*:\s*([a-z][\w-]*)/g)) {
        declares.set(rule[1] as string, [...(declares.get(rule[1] as string) ?? []), name[1] as string])
      }
    }
    return declares
  }

  /** Self-queries in a sheet, bound to the name each block asks about. */
  function deadQueriesIn(css: string): string[] {
    const declares = declarersOf(css)
    const dead: string[] = []
    for (const block of css.matchAll(/@container\s+([a-z][\w-]*)[^{]*\{([\s\S]*?)\n\}/g)) {
      const asked = block[1] as string
      for (const [selector, names] of declares) {
        if (names.includes(asked) && new RegExp(`\\.${selector}(?![\\w-])`).test(block[2] ?? '')) {
          dead.push(`@container ${asked} { … .${selector} … }`)
        }
      }
    }
    return dead
  }

  /**
   * Splice a self-query in front of the FIRST block that asks about `asked`.
   *
   * It matches any block for that name, not one particular breakpoint: the
   * detail's own container is only ever asked about at 360px, and a helper
   * that planted at 720px would silently plant nothing and report the gate as
   * broken — which is how a probe ends up deleted for the crime of the thing
   * it was checking.
   */
  function plant(css: string, asked: string, selector: string, body: string): string {
    const pattern = new RegExp(`@container ${asked} \\(min-width:`)
    if (!pattern.test(css)) throw new Error(`no ${asked} block to plant into — the fixture is stale, not the gate`)
    return css
      .replace(pattern, (match) => `@container ${asked} (min-width: 1px) {\n  ${selector} { ${body} }\n}\n@media screen {\n${match}`)
      .replace(/\}\s*@media screen \{/g, '}\n@media screen {')
  }

  it('is quiet on the stylesheet as it stands', () => {
    expect(deadQueriesIn(live)).toEqual([])
  })

  it('catches the container asking about itself', () => {
    const caught = deadQueriesIn(plant(live, 'dsh-tb-item', '.itemRoot', '--probe: 1px;'))
    expect(caught.some(finding => finding.includes('.itemRoot'))).toBe(true)
  })

  it('catches it through a SECOND declarer of the same container', () => {
    // `dsh-tb-item-detail` is declared by two classes on purpose — that is the
    // mechanism for one component rendered in two places. A map that kept only
    // the last declarer would let this through, which is the defect wearing a
    // different class name.
    const caught = deadQueriesIn(plant(live, 'dsh-tb-item-detail', '.itemDetailPane', '--probe: 1px;'))
    expect(caught.some(finding => finding.includes('.itemDetailPane'))).toBe(true)
  })

  it('stays silent on a correct rule that merely MENTIONS another container', () => {
    const planted = plant(live, 'dsh-tb-item', '.itemDetail', 'display: none;')
    expect(deadQueriesIn(planted)).toEqual([])
  })
})

/**
 * THE RENDER ARTIFACT.
 *
 * Only written when `DSH_PANEL_HTML` names a path, so the suite stays a suite.
 * With it set, `scripts/shot-panel.mjs` can capture the same page the
 * assertions above measure — one instrument, two readings.
 */
describe('the render artifact', () => {
  it('writes a standalone page when asked, and the page carries the real tokens', () => {    const target = process.env.DSH_PANEL_HTML
    if (target === undefined || target === '') return
    const band = process.env.DSH_PANEL_BAND === 'narrow' ? 'narrow' : 'wide'
    // Three pages, and the harness used to render ONE of them: a surface with
    // two thirds of itself never looked at is a surface half-changed. The page
    // is the other half of the band switch, and the agenda — whose primary form
    // is a day-sequence rather than a grouped list — is the one that differs
    // most from the default, so it is the one most worth being able to see.
    const asked = process.env.DSH_PANEL_PAGE
    const page: Page = asked === 'inbox' || asked === 'schedule' ? asked : 'list'
    // An empty document is the FIRST thing a reader with a fresh install sees,
    // and it is this repository's own state right now (six tombstones, no
    // rows). A fixture full of rows would never show it, so the artifact can be
    // rendered empty on purpose — the empty state is a designed state, and it
    // is the one most likely to be drawn badly.
    const empty = process.env.DSH_PANEL_EMPTY === '1'
    const aligned = alignClassNames(renderPanel(empty ? [] : fixtures(), band, page), panelCss())
    const document_ = [
      '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
      // WITHOUT THIS, EVERY NARROW SCREENSHOT IS A LIE. The harness asks the
      // browser for mobile emulation below 600px, and a page with no viewport
      // meta falls back to Chrome's DEFAULT LAYOUT WIDTH of 980px, which is
      // then scaled down into the window. The capture looks like a 390px
      // phone; it is a 980px desktop, every container query lands in the wrong
      // band, and the reader — me, twice — draws conclusions from it. The
      // symptom is a header that looks like the two-column band on a phone.
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>task list panel</title>',
      '<style>', hostTokenCss(), '</style>',
      '<style>', aligned.css, '</style>',
      '<style>',
      // The shell hands the panel a definite height through a centred column.
      // Reproducing THAT is the point: the bug report's screenshots are a
      // panel that failed to fill exactly this box, so a harness that handed it
      // an auto-height box would not have reproduced anything.
      'html,body{margin:0;block-size:100%;}',
      'body{display:flex;flex-direction:column;overflow:hidden;}',
      '</style></head><body>',
      aligned.html,
      '</body></html>',
    ].join('\n')
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, document_, 'utf8')
    expect(existsSync(target)).toBe(true)
  })
})
