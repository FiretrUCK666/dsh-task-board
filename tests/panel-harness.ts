/**
 * The task-list panel's render bench — ONE instrument, two readings.
 *
 * WHY IT LIVES HERE AND NOT IN A SPEC. Two contracts have to look at this
 * panel: the geometry one (does the workbench fill its box, are the columns
 * where they were put) and the behaviour one (does clicking this actually
 * change the document). Both of them need the panel to RUN, and a second copy
 * of the fixtures, the token extraction and the stubbing would be two
 * instruments that answer the same question in two slightly different ways —
 * which is how a gate comes to disagree with a screenshot about what the
 * current code does. So everything that makes the panel render for real lives
 * in this file, and the specs state claims.
 *
 * WHAT IT IS NOT. It is not a mock of the panel: it renders `ItemListPanel`
 * itself, with the real stylesheet and the tokens lifted out of the INSTALLED
 * harness. A snapshot of `--dsw-*` values in a test goes stale the first time
 * the host re-skins, and then it is worse than no snapshot — it renders a
 * plausible page in the wrong colours.
 *
 * THE THREE THINGS THAT ARE STUBBED, AND WHY EACH IS THE ONLY WAY IN.
 *
 *  1. THE BAND. `useSurfaceNarrow` decides "is this surface narrow" by
 *     MEASURING it. Under `renderToStaticMarkup` no effect runs, so the only
 *     value it can hold is the viewport proxy; under jsdom `getBoundingClientRect`
 *     returns zeros, which measure as narrow. Either way the page would come out
 *     in the wrong band while looking perfectly healthy — so the bench says
 *     which band it wants instead of letting the guess stand.
 *  2. THE PAGE. The page is a product constant, not a prop: `ItemListPanel`
 *     reads it from `readViewPrefs()`, which reads `window.localStorage`. The
 *     bench therefore writes the storage the module actually reaches for. A
 *     test-only `page` prop would be a second way to say which page is open,
 *     and two ways drift.
 *  3. NOTHING ELSE. The replicas, the controller face and the network are the
 *     caller's, because those are the seams the claims are about.
 *
 * Every stub is undone in a `finally`, so no render leaks into the next one.
 */
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ItemRecord } from '../src/core/item.ts'
import { createTask } from '../src/core/tasks.ts'
import { ItemListPanel } from '../src/client/item/panel.tsx'
import { DEFAULT_VIEW_PREFS, VIEW_PREFS_KEY } from '../src/client/item/view-prefs.ts'
import type { ItemListFace } from '../src/client/item/register.tsx'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/* ── the surface, as one string ─────────────────────────────────────────────
 *
 * A GATE THAT CLAIMS SOMETHING ABOUT THE PANEL MUST READ THE PANEL, NOT ONE
 * FILE OF IT. Three gates in this repository were wired to `panel.tsx` by path
 * and the day the panel was split into pages, filters, a strip, a row menu and a
 * facet editor, all three went red on claims that were still true — the code had
 * MOVED, nothing had broken.
 *
 * The tempting repair is to repoint each one at whichever file it happened to
 * land in. That works exactly once: the next split breaks them again, and each
 * break is a small emergency somebody has to diagnose under time pressure. And
 * the pressure is always in the same direction — the gate is red, the
 * implementation is fine, so the gate is the thing that gets loosened.
 *
 * So the surface is ENUMERATED here, by walking the directory, and the gates
 * read that. A file that appears needs no edit anywhere; a file that is deleted
 * takes its own code with it. This is the same move as `KEY_GAPS` being a
 * `Record` over `ItemSort` and `WritableItemKey` being derived from the ruling
 * table: **a hand-maintained list of the things that exist is the defect, and
 * the fix is to let the filesystem or the type system answer instead.**
 *
 * Order is sorted so a failure is reproducible, and only `.ts`/`.tsx` are read
 * so the stylesheet is not concatenated into a source scan.
 */
const ITEM_SURFACE = join(repoRoot, 'src', 'client', 'item')

/** Every `.ts` / `.tsx` file of the task-list surface, sorted, concatenated. */
export function itemSurfaceSource(): string {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) files.push(full)
    }
  }
  walk(ITEM_SURFACE)
  // The banner makes a concatenation failure impossible to miss: a claim read
  // over a silently-empty string is a green tick that asserts nothing, which is
  // worse than a red one.
  return files
    .map(full => `\n/* ==== ${relative(ITEM_SURFACE, full).replaceAll('\\', '/')} ==== */\n${readFileSync(full, 'utf8')}`)
    .join('')
}

/** The same surface, one file at a time, for a claim that really is per file. */
export function itemSurfaceFiles(): { readonly path: string; readonly source: string }[] {
  const out: { path: string; source: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) {
        out.push({ path: relative(ITEM_SURFACE, full).replaceAll('\\', '/'), source: readFileSync(full, 'utf8') })
      }
    }
  }
  walk(ITEM_SURFACE)
  return out
}

/** A fixed clock, so every date-derived rendering is reproducible. */
export const NOW = new Date(2026, 8, 29, 10, 0, 0).getTime()
export const DAY = 86_400_000

/**
 * A panel that exercises EVERY branch the surface can draw, in one list.
 *
 * A fixture that only has an ordinary row proves an ordinary row renders. The
 * states that break layouts are the ones with text of an unexpected length and
 * a second element beside it: an overdue hard deadline, a title long enough to
 * force a real ellipsis, a row with a step list, a row with a link chip, and a
 * row whose title is empty so the body has to supply one. A FINISHED row is in
 * here for the same reason: it is the one state the list can hide.
 */
export function fixtures(): ItemRecord[] {
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
    origin: { source: 'human' as const, at: NOW - 30 * DAY },
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW - DAY,
  }
  return [
    {
      // A FINISHED row that once sat behind its plan, and a bare CAPTURE that
      // has no date at all.
      //
      // Both are here because the triage lines count only UNFINISHED work, and
      // `undated` additionally exempts a capture — so a jump written as
      // `has:behind` / `has:undated` without that scope passes every existing
      // gate on a fixture that has neither row, and then lists them the first
      // time a reader's own document contains them. The gate was right; the
      // fixture was too kind. A fixture that cannot reach the defect is not a
      // fixture, it is a decoration.
      ...base,
      id: 'fx-done-behind',
      ref: 90,
      title: '这一条做完了，但它当初也落后过计划——它不该再出现在「要处理」里',
      status: 'done',
      dueAt: NOW - 20 * DAY,
      origin: { source: 'human' as const, at: NOW - 60 * DAY },
      createdAt: NOW - 60 * DAY,
      updatedAt: NOW - 20 * DAY,
    },
    {
      ...base,
      id: 'fx-capture-undated',
      ref: 91,
      title: '刚记下的一句，没有日期，也不该被说成「没安排」',
      origin: { source: 'human' as const, at: NOW - 60_000 },
      createdAt: NOW - 60_000,
      updatedAt: NOW - 60_000,
    },
    {
      // A LIVE row with no date at all: this is what 「没日期」 is actually
      // about, and the fixture had none — its only date-less rows were captures,
      // which the line deliberately exempts.
      //
      // It carries a TAG on purpose. `isInboxItem` is 「open, normal priority, no
      // tag, no card, no date」, so a date-less row with nothing else on it IS a
      // bare capture and is exempt — which is correct. The way to be undated and
      // NOT a capture is to be FILED some other way, and a tag is the cheapest:
      // 给它日期、标签或一张卡，它就已经被归档了.
      ...base,
      id: 'fx-live-undated',
      ref: 92,
      title: '这一条还在做，但一个日期都没有——它才是「没日期」要说的事',
      status: 'open',
      tags: ['待排期'],
      origin: { source: 'human' as const, at: NOW - 5 * DAY },
      createdAt: NOW - 5 * DAY,
      updatedAt: NOW - 4 * DAY,
    },
    {
      ...base,
      id: 'fx-hard-overdue',
      ref: 1,
      title: '这一条硬期限已经过了整整九天，是最长的一条，用来逼出换行与截断',
      status: 'open',
      priority: 'urgent',
      hardDueAt: NOW - 9 * DAY,
      dueAt: NOW - 12 * DAY,
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
      dueAt: NOW - 3 * DAY,
      priority: 'high',
    },
    {
      ...base,
      id: 'fx-gated',
      ref: 3,
      title: '这一条还没到最早开始的时间，所以它不该出现在日程议程里',
      startsAfter: NOW + 6 * DAY,
      dueAt: NOW + 20 * DAY,
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
      // THE ROW THAT NO ORDINARY FIXTURE HAS, AND THE ONE THE FIRST DEFECT
      // LIVES IN. Gated AND carrying a step count: the fact line prints the
      // gate reading and the step ratio side by side, and the gate reading is
      // the longest date string the surface can produce. A fixture whose gated
      // row has no steps leaves that track empty, the line is short, and the
      // bench renders green on a layout that collides the moment a real reader
      // adds a checklist to a row they have not started — which is the ordinary
      // way a row gets a checklist. So the combination is IN the fixture, and
      // the regression is a render, not a CSS sum computed in a test.
      id: 'fx-gated-with-steps',
      ref: 8,
      title: '这一条既受门禁又带步数，是事实行最长的一种组合',
      startsAfter: NOW + 6 * DAY,
      dueAt: NOW + 20 * DAY,
      steps: [
        { id: 'g1', text: '第一步：量出事实行的两条轨', done: true },
        { id: 'g2', text: '第二步：在 390px 上再量一遍', done: false },
      ],
    },
    {
      ...base,
      id: 'fx-linked',
      ref: 5,
      title: '这一条挂在一张卡上',
      taskId: 'task-1',
      dueAt: NOW + 2 * DAY,
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
      // NEGLECT, which the base fixture had no row for. `stale` is one of the
      // qualifiers the grammar accepts and one of the sentences the triage
      // strip offers, so a fixture without a neglected row means neither of
      // those can be checked — the flag selects nothing, the strip never says
      // it, and the round trip between the two is untested on the one flag
      // whose threshold is a number rather than a visible fact on the row.
      id: 'fx-stale',
      ref: 9,
      title: '这一条很久没有人碰过了，是停滞那一档的样本',
      updatedAt: NOW - 30 * DAY,
    },
    {
      ...base,
      id: 'fx-done',
      ref: 7,
      title: '这一条做完了',
      status: 'done',
      origin: { source: 'ai' as const, at: NOW - 10 * DAY, sessionId: 'sess-1' },
      updatedAt: NOW - 2 * DAY,
    },
  ]
}

/**
 * A replica stand-in that records what the panel did to the document.
 *
 * The `setItems` recorder is the point: "did this click change anything" is a
 * question about the DOCUMENT, and the document only exists as the array the
 * panel hands back. A replica that swallowed the write would make a no-op look
 * like a working button.
 */
export function fakeReplica(items: readonly ItemRecord[], over: { hostLost?: boolean; synced?: boolean } = {}) {
  const writes: (readonly ItemRecord[])[] = []
  return {
    writes,
    view: () => items,
    setItems: (next: readonly ItemRecord[]) => { writes.push(next) },
    clientId: () => 'client-under-test',
    hostLostItems: () => over.hostLost === true,
    isSynced: () => over.synced !== false,
    onRemote: () => () => undefined,
  }
}

export type Band = 'wide' | 'narrow'
export type Page = 'inbox' | 'list' | 'schedule'
export const PAGES: readonly Page[] = ['inbox', 'list', 'schedule']

/** A localStorage stand-in for the node environment, where there is no window. */
function memoryStorage(raw: string | null): Storage {
  const store = new Map<string, string>()
  if (raw !== null) store.set(VIEW_PREFS_KEY, raw)
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: () => null,
    length: store.size,
  } as unknown as Storage
}

/**
 * Run `body` with the page written into the storage the panel really reads.
 *
 * Both earlier attempts at this failed and both looked right: stubbing
 * `globalThis.localStorage` while the module reads `window.localStorage` (a
 * different, or absent, slot — the read threw, the catch returned the defaults,
 * and every page rendered as the list), and stubbing `globalThis.window`
 * WITHOUT giving it a `localStorage`, for the same reason. Both were invisible:
 * the render succeeded and simply ignored the argument. A harness that accepts
 * a setting and quietly drops it is worse than one that refuses it, so the
 * storage is written on the object the module reaches for, the previous value
 * is put back, and the caller can assert the page actually took.
 */
function withPrefs<T>(prefs: Record<string, unknown>, body: () => T): T {
  const g = globalThis as { window?: { localStorage?: Storage } }
  const win = g.window
  if (win === undefined) {
    g.window = { localStorage: memoryStorage(JSON.stringify({ ...DEFAULT_VIEW_PREFS, ...prefs })) }
    try {
      return body()
    } finally {
      g.window = undefined
    }
  }
  const storage = win.localStorage
  if (storage === undefined) throw new Error('the window has no localStorage to write the page into')
  const previous = storage.getItem(VIEW_PREFS_KEY)
  storage.setItem(VIEW_PREFS_KEY, JSON.stringify({ ...DEFAULT_VIEW_PREFS, ...prefs }))
  try {
    return body()
  } finally {
    if (previous === null) storage.removeItem(VIEW_PREFS_KEY)
    else storage.setItem(VIEW_PREFS_KEY, previous)
  }
}

/**
 * Run `body` in one band.
 *
 * `renderToStaticMarkup` runs no effects, so the only band signal it can hold
 * is the viewport proxy; jsdom measures every box as zero, which reads as
 * narrow. Both are stubs of a measurement, and both are undone afterwards.
 */
function withBand<T>(band: Band, body: () => T): T {
  const g = globalThis as { matchMedia?: unknown }
  const real = g.matchMedia
  if (band === 'narrow') {
    g.matchMedia = (query: string) => ({
      matches: /max-width:\s*720px/.test(query),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })
  }
  try {
    return body()
  } finally {
    if (band === 'narrow') g.matchMedia = real
  }
}

/** The face the panel reads, built from the two seams a caller owns. */
function faceOf(replica: ReturnType<typeof fakeReplica>, controller: unknown): ItemListFace {
  return {
    replica: replica as never,
    controller: controller as never,
  } as ItemListFace
}

/**
 * Render the panel to markup, with the page and the band under the caller's
 * control.
 *
 * The whole remembered view is settable, not just the page, because a claim
 * about a VIEW SWITCH ("with the finished group open, this row is on screen")
 * cannot be checked by any other route: the switch is not a prop, and adding one
 * for a test would be a second way to say which switch is on.
 * @param items - the rows to render.
 * @param band - `wide` (the default) or `narrow`.
 * @param page - which of the three pages to open.
 * @param controller - the board face, or `undefined` for a panel with no board.
 * @param prefs - remembered view fields to seed, on top of the defaults.
 * @returns the markup.
 */
export function renderPanel(
  items: readonly ItemRecord[],
  band: Band = 'wide',
  page: Page = 'list',
  controller: unknown = { getSnapshot: () => ({ tasks: [{ id: 'task-1', title: '画廊第二版', description: '' }] }), liveStateOf: () => 'idle' },
  prefs: Record<string, unknown> = {},
): string {
  return withBand(band, () => withPrefs({ page, ...prefs }, () => renderToStaticMarkup(createElement(ItemListPanel, {
    signal: new AbortController().signal,
    face: faceOf(fakeReplica(items), controller),
  } as never))))
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
 * configuration, for a concrete reason: Vitest's `css.modules.classNameStrategy`
 * is inert here, because its `css.include` defaults to empty, so the
 * stylesheet's CONTENT is never processed and the strategy is never consulted —
 * only Vite's own transform runs, and it hashes. Rewriting both sides from one
 * map is deterministic and cannot drift, because both sides come from the same
 * render and the same file.
 *
 * The STYLESHEET is left exactly as it is on disk; only the markup is renamed,
 * by stripping the scope suffix the renderer added. The page then reads like
 * the source — `.itemRoot` rather than `_itemRoot_a9e292` — which is what
 * makes a measurement or a DOM query in the browser possible at all. A harness
 * whose output cannot be queried is a screenshot.
 *
 * Rewriting the stylesheet to the scoped names instead is the tempting move
 * and it silently produces a page with no styles at all: the two sides are
 * renamed apart, and an unstyled render looks like a catastrophic CSS failure
 * rather than a mistake in this file.
 */
export function alignClassNames(html: string, css: string): { html: string; css: string } {
  const scoped = new Map<string, string>()
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const token of (match[1] ?? '').split(/\s+/)) {
      const parts = /^_(.+)_[0-9a-z]{6,}$/.exec(token)
      if (parts?.[1] !== undefined && !scoped.has(parts[1])) scoped.set(parts[1], token)
    }
  }
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
export function hostTokenCss(): string {
  return hostTokens().css
}

/**
 * Whether the host was FOUND, stated separately from what it declares.
 *
 * `hostTokenCss()` returns `''` in two quite different situations, and a caller
 * that cannot tell them apart reads the wrong one as a finding:
 *
 *   - the host declares no tokens (it is installed, and it really has none); and
 *   - **the host is not installed at all.**
 *
 * The second is neither rare nor this repository's fault. The host is discovered
 * by RESOLUTION and is deliberately not a dependency: `dependencies` is empty
 * (hard rule 8) and the plugin is developed against a separately installed DSH.
 * On CI the host is therefore absent, and every `--dsw-*` the sheets name reads
 * as 「the host does not declare this」 — a defect that does not exist, reported by
 * a test that cannot run. That is this project's own hazard from the other side:
 * 「假面比现实窄」turns correct code into a reported defect, and a suite that has
 * been red for a dozen commits stops being read as evidence about anything.
 *
 * So the two facts are separate properties, and a caller that NEEDS the host
 * checks this one rather than inferring it from an empty string.
 */
export function hostTokens(): { readonly found: boolean; readonly css: string } {
  const bundle = dshHome()
  if (bundle === undefined) return { found: false, css: '' }
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
  return { found: true, css: sheets.join('\n') }
}

/** The panel's own stylesheet, if it has been created yet. */
export function itemSheetPath(): string {
  return join(repoRoot, 'src/client/item/item.module.css')
}

/** The shared alias layer: the `--dsh-tb-*` definitions both sheets consume. */
export function aliasLayer(css: string): string {
  return /\[data-dsh-taskboard-view\][^{]*\{([^}]*)\}/s.exec(css)?.[1] ?? ''
}

/** The panel's own stylesheets, as written (the module class names are literal here). */
export function panelCss(): string {
  const sheets = ['src/client/board.module.css', 'src/client/item/item.module.css']
  return sheets
    .map(sheet => {
      const path = join(repoRoot, sheet)
      return existsSync(path) ? `\n/* ${sheet} */\n${readFileSync(path, 'utf8')}` : ''
    })
    .join('\n')
}

/** The item panel's own sheet, comments intact. */
export function itemSheet(): string {
  return existsSync(itemSheetPath()) ? readFileSync(itemSheetPath(), 'utf8') : ''
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
export function dswNamesReferenced(css: string): string[] {
  const live = stripCssComments(css)
  const used = new Set<string>()
  for (const call of live.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)\s*([,)])/g)) {
    // `,` means a fallback follows, so the author has already answered for the
    // case where the host does not declare it.
    if (call[2] === ',') continue
    used.add(call[1] as string)
  }
  return [...used].sort()
}

/** CSS block comments, removed. The sheet's only comment form. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * The body of every rule that targets `.name`, brace-matched.
 *
 * Brace matching rather than `[^}]*` because the bands are written INSIDE
 * `@container` blocks, so the interesting half of the contract — where the wide
 * band is allowed to differ from the base — lives one level down. A reader that
 * stops at the first `}` sees only the base rule and reports a band change that
 * is really there, which is the worst kind of wrong: it sends the next author to
 * delete a correct rule.
 * @param css - the sheet, comments intact or not.
 * @param name - the class, without the dot.
 * @returns one body per matching rule, in source order.
 */
export function rulesOf(css: string, name: string): string[] {
  const out: string[] = []
  const open = new RegExp(`\\.${name}(?![\\w-])[^\\{;]*\\{`, 'g')
  for (const match of css.matchAll(open)) {
    const start = (match.index ?? 0) + match[0].length - 1
    let depth = 0
    let end = start
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++
      else if (css[end] === '}') { depth--; if (depth === 0) break }
    }
    out.push(css.slice(start + 1, end))
  }
  return out
}

/** Every declaration of `property` across the rules that target `.name`. */
export function declaredOf(css: string, name: string, property: string): string[] {
  const value = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const out: string[] = []
  for (const body of rulesOf(css, name)) {
    for (const call of body.matchAll(new RegExp(`(?:^|[;{\\s])${value}\\s*:\\s*([^;]+)`, 'g'))) out.push((call[1] ?? '').trim())
  }
  return out
}

/** The last declared value of `property` for `.name`, or `undefined`. */
export function lastDeclaredOf(css: string, name: string, property: string): string | undefined {
  const all = declaredOf(css, name, property)
  return all.length === 0 ? undefined : all[all.length - 1]
}

/** The `background` / `background-color` a class paints with, in source order. */
export function backgroundOf(css: string, name: string): string[] {
  return [...declaredOf(css, name, 'background'), ...declaredOf(css, name, 'background-color')]
}

/**
 * The class a piece of JSX puts on an element, read off the module the panel
 * imports.
 *
 * The gates that need "which class does this sentence wear" cannot answer it
 * by guessing a name: the point of the workbench refactor is that names move.
 * So they ask the MARKUP which class it is, and then ask the sheet what that
 * class declares. Renaming a class therefore cannot make a gate vacuous, and
 * cannot make it red for a rename.
 * @param jsx - the component source.
 * @returns the `css.<member>` names it uses, mapped to the bare class name.
 */
export function cssMembersOf(jsx: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const call of jsx.matchAll(/css\.([A-Za-z][\w]*)/g)) {
    const member = call[1] as string
    out.set(member, member.charAt(0).toLowerCase() + member.slice(1))
  }
  return out
}

/**
 * Write the standalone page `scripts/shot-panel.mjs` captures.
 *
 * The PNG is still the final word on taste; the arithmetic in the specs is the
 * final word on geometry. One instrument, two readings.
 * @param target - where to write the page.
 * @param items - the rows to render, or `[]` for the empty document.
 * @param band - which band to render.
 * @param page - which page to open.
 */
export function writeRenderArtifact(target: string, items: readonly ItemRecord[], band: Band, page: Page): void {
  const aligned = alignClassNames(renderPanel(items, band, page), panelCss())
  const document_ = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    // WITHOUT THIS, EVERY NARROW SCREENSHOT IS A LIE. The harness asks the
    // browser for mobile emulation below 600px, and a page with no viewport
    // meta falls back to Chrome's DEFAULT LAYOUT WIDTH of 980px, which is then
    // scaled down into the window. The capture looks like a 390px phone; it is
    // a 980px desktop, every container query lands in the wrong band, and the
    // reader draws conclusions from it.
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>task list panel</title>',
    '<style>', hostTokenCss(), '</style>',
    '<style>', aligned.css, '</style>',
    '<style>',
    // The shell hands the panel a definite height through a centred column.
    // Reproducing THAT is the point: the bug report's screenshots are a panel
    // that failed to fill exactly this box, so a harness that handed it an
    // auto-height box would not have reproduced anything.
    'html,body{margin:0;block-size:100%;}',
    'body{display:flex;flex-direction:column;overflow:hidden;}',
    '</style></head><body>',
    aligned.html,
    '</body></html>',
  ].join('\n')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, document_, 'utf8')
}

// ── the mounted reading ─────────────────────────────────────────────────────

/** A mounted panel: a real DOM, a real React root, and the caller's own seams. */
export interface MountedPanel {
  /** The host element the panel is mounted into. */
  readonly host: HTMLElement
  /** The panel root, so a query starts from the surface and not from `body`. */
  readonly surface: HTMLElement
  /** Every call the panel made to the replica, in order. */
  readonly writes: (readonly ItemRecord[])[]
  /** The controller methods the panel called, as `receiver.method` strings. */
  readonly calls: string[]
  /** The last document the panel handed to the replica. */
  lastWrite(): readonly ItemRecord[]
  /** Re-render and flush effects. */
  settle(): void
  /** Unmount and detach; every stub this bench installed is already undone. */
  dispose(): void
}

/** A fake board face that records what the panel asked of it. */
export function fakeController(calls: string[], tasks: { id: string; title: string; description?: string }[] = [{ id: 'task-1', title: '画廊第二版' }]) {
  return {
    getSnapshot: () => ({ tasks: tasks.map(task => ({ ...task, description: task.description ?? '' })) }),
    liveStateOf: () => 'idle',
    ...boundRecorder(calls),
  }
}

/**
 * The controller's write methods, as recorders.
 *
 * They exist so "the click changed the document" is a question with an answer
 * on BOTH sides of the panel: a write to the checklist itself, and a write to
 * the board. A promote that only moved local state would pass the first test
 * and fail the second, which is exactly the defect this file is here to catch.
 */
/**
 * A board face that RECORDS what it was asked to do, and answers with the shapes
 * the real controller answers with.
 *
 * The return value used to be `true` for every method, which is a fake NARROWER
 * than reality in the worst direction: the real `createTask` hands back a whole
 * `TaskRecord`, and the panel reads `task.title` off the answer. A `true` made
 * that read `undefined`, `.trim()` threw, and the throw escaped as an UNHANDLED
 * ERROR — which does not fail a test, it fails the RUN. The suite printed
 * `2265 passed` and still exited 1, and a green-looking line is exactly what let
 * that sit unfixed through several rounds. The same rule the project states for
 * the execution fake applies here: **a fake that is narrower than reality turns
 * correct code into a reported defect.**
 *
 * So the two constructors mint a real record with the real core constructor, and
 * only the genuinely boolean methods answer `true`.
 */
function boundRecorder(calls: string[]): Record<string, (...args: unknown[]) => unknown> {
  const mutators = [
    'updateTask', 'deleteTask', 'moveTask', 'runTask',
    'openTask', 'closeTask', 'addComment', 'setSchedule', 'ackTask', 'duplicateTask',
  ]
  const out: Record<string, (...args: unknown[]) => unknown> = {}
  for (const name of mutators) out[name] = (...args: unknown[]) => { calls.push(`${name}(${args.length})`); return true }
  // The same entry point the real controller uses, with a fixed clock and id, so
  // the record this hands back is the record the product would have written —
  // including the fields the caller is entitled to read.
  for (const name of ['createTask', 'createBoundTask']) {
    out[name] = (...args: unknown[]) => {
      calls.push(`${name}(${args.length})`)
      const input = (args[0] ?? {}) as Parameters<typeof createTask>[0]
      return createTask(input, 1_700_000_000_000, 'task-minted')
    }
  }
  return out
}

/**
 * Mount the panel for real, under jsdom.
 *
 * jsdom measures every box as zero, which `useSurfaceNarrow` reads as "narrow"
 * — so the bench answers the measurement instead of letting the guess stand, by
 * making `getBoundingClientRect` report the band the caller asked for. That is
 * a stub of the ENVIRONMENT, not of the panel: every branch the panel takes is
 * its own.
 * @param items - the rows to show.
 * @param page - which page to open.
 * @param band - which band to render.
 * @param over - `hostLost` / `synced` for the degraded states.
 * @returns the mounted panel.
 */
export function mountPanel(
  items: readonly ItemRecord[],
  page: Page = 'list',
  band: Band = 'wide',
  over: { hostLost?: boolean; synced?: boolean } = {},
): MountedPanel {
  const g = globalThis as Record<string, unknown>
  g.IS_REACT_ACT_ENVIRONMENT = true

  const host = document.createElement('div')
  document.body.appendChild(host)
  const replica = fakeReplica(items, over)
  const calls: string[] = []
  const controller = fakeController(calls)
  const root = createRoot(host)
  const signal = new AbortController().signal

  const rect = band === 'wide'
    ? { width: 1600, height: 1000, top: 0, left: 0, right: 1600, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) }
    : { width: 390, height: 844, top: 0, left: 0, right: 390, bottom: 844, x: 0, y: 0, toJSON: () => ({}) }
  const realRect = Element.prototype.getBoundingClientRect
  const realMedia = g.matchMedia
  const realFetch = g.fetch
  Element.prototype.getBoundingClientRect = function stubbed(): DOMRect { return { ...rect } as DOMRect }
  g.matchMedia = (query: string) => ({
    matches: band === 'narrow' && /max-width:\s*720px/.test(query),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })
  /**
   * The one fake, and the rule it follows: **it answers what the real host
   * answers, or it is a narrower thing than reality.**
   *
   * It used to answer `{}` to everything, which is not a neutral stub — it is a
   * host that refuses. `itemsRestore` reads `available` and the row, and a body
   * with neither is a refusal, so a perfectly correct undo came back as
   * `ok: false, why: 'malformedAnswer'` and the gate reported 「the undo does
   * nothing」 about code that was fine. That is the narrow-fake hazard pointed at
   * the implementation rather than away from it: the suite reports a defect that
   * is not in the code, and the reader of the report cannot tell the difference.
   *
   * So the restore route is answered, from a tombstone this fake keeps itself —
   * the rows a delete removed are exactly the rows a restore may bring back, and
   * answering from that set is the same relationship the real document has.
   */
  const tombstones = new Map<string, ItemRecord>()
  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    // The REAL host answers in an ENVELOPE: `{ ok, value }`, and the client
    // reads `value` out of it. A fake that answers the bare object is not a
    // simpler host, it is a host speaking a different protocol — and the client
    // reports 「malformed」 about a row that is sitting right there.
    const json = (value: unknown): Response => new Response(JSON.stringify({ ok: true, value }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    if (url.includes('/board/items/restore')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { id?: unknown; ref?: unknown }
      const row = typeof body.id === 'string'
        ? tombstones.get(body.id)
        : [...tombstones.values()].find(one => one.ref === body.ref)
      if (row === undefined) return json({ available: true, restored: null })
      tombstones.delete(row.id)
      return json({ available: true, restored: row })
    }
    return json({})
  }) as typeof fetch
  // The fake host is also where a deletion goes, so a restore has something to
  // answer with. It is wired by wrapping `setItems`, which is the ONE write
  // every removal on this surface goes through.
  const baseSetItems = replica.setItems
  replica.setItems = (next: readonly ItemRecord[]) => {
    for (const gone of replica.view()) {
      if (!next.some(row => row.id === gone.id)) tombstones.set(gone.id, gone)
    }
    baseSetItems(next)
  }

  const settle = (): void => { act(() => { root.render(createElement(ItemListPanel, { signal, face: faceOf(replica, controller) } as never)) }) }
  try {
    withPrefs({ page }, () => { settle() })
    // The band is read by an effect, so the first render guessed; re-render once
    // now that the measurement answers.
    settle()
  } catch (error) {
    Element.prototype.getBoundingClientRect = realRect
    g.matchMedia = realMedia
    g.fetch = realFetch
    root.unmount()
    host.remove()
    throw error
  }

  const surface = host.querySelector('[data-dsh-taskboard-view]') as HTMLElement | null
  if (surface === null) throw new Error('the panel mounted without its surface element')
  return {
    host,
    surface,
    writes: replica.writes,
    calls,
    lastWrite: () => replica.writes[replica.writes.length - 1] ?? items,
    settle,
    dispose: () => {
      act(() => { root.unmount() })
      host.remove()
      Element.prototype.getBoundingClientRect = realRect
      g.matchMedia = realMedia
      g.fetch = realFetch
    },
  }
}

/**
 * Click an element the way a reader does.
 *
 * A real `MouseEvent`, dispatched on the element itself, inside `act` so React
 * has flushed before the next assertion. Calling a prop directly would test the
 * prop, not the surface.
 * @param element - the control.
 */
export function click(element: Element | null | undefined): void {
  if (element === null || element === undefined) throw new Error('the control to click is not on screen')
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/** Type into a field the way a reader does, one `input` event per value. */
export function type(field: Element | null | undefined, value: string): void {
  if (field === null || field === undefined) throw new Error('the field to type into is not on screen')
  const input = field as HTMLInputElement
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** A keyboard event on a control, for the Escape path. */
export function press(element: Element | null | undefined, key: string): void {
  if (element === null || element === undefined) throw new Error('the control to press is not on screen')
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}
