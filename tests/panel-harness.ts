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
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { ItemListPanel } from '../src/client/item/panel.tsx'
import { DEFAULT_VIEW_PREFS, ITEM_OVERLAYS, VIEW_PREFS_KEY, type ItemOverlay } from '../src/client/item/view-prefs.ts'
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

/* ── one file, FOUND BY THE END OF ITS PATH ────────────────────────────────
 *
 * `itemSurfaceSource()` answers 「what does the whole panel say」. Several gates
 * have a narrower question — 「what does the ROW say」, 「what does the PREF file
 * say」 — and each of those reached for a literal path to ask it. That is the same
 * hand-maintained list of the things that exist that the directory walk above
 * exists to delete, one level down: a component that is renamed, split or moved
 * a directory turns every gate wired to its old path red, and the failure reads
 * like a broken claim rather than a moved file. Under time pressure the only
 * available repair is to loosen the gate, so the gate is what gets loosened.
 *
 * So a narrow claim names the END of a path, not the whole of it, and the
 * filesystem answers where it lives. `client/item/row-line.tsx` still resolves
 * after the file moves to `client/item/rows/line.tsx`.
 *
 * AND THE TWO FAILURES ARE NAMED SEPARATELY, which is the half that matters.
 * `source` is `''` for a file that is not there, so a claim written against it
 * cannot quietly pass — every pattern misses — and `missing` carries a sentence
 * naming what was asked for and listing what IS in that directory, so the report
 * says 「the file is not here any more」 instead of 「the rule does not hold」.
 * Those are different emergencies with different repairs, and a reader who
 * cannot tell them apart is being pushed towards the wrong one.
 */
const SRC_ROOT = join(repoRoot, 'src')

/** One located file: where it is, what it says, and why it is empty. */
export interface LocatedSource {
  /** The path ending the caller asked for, echoed back for the message. */
  readonly suffix: string
  /** The repository-relative path, or `undefined` when nothing ends this way. */
  readonly path: string | undefined
  /** The file's text, or `''` when there is no such file. */
  readonly source: string
  /** A sentence explaining an empty `source`. `''` when the file was found. */
  readonly missing: string
}

/** Every file under `src/`, by repository-relative path, so a suffix can be answered. */
function srcFiles(): readonly string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(relative(repoRoot, full).replaceAll('\\', '/'))
    }
  }
  walk(SRC_ROOT)
  // Sorted, so the candidate list in a failure message is the same on every run.
  return out.sort()
}

const SRC_FILE_LIST = srcFiles()

/**
 * Find one file under `src/` by the end of its path.
 *
 * Throws on an AMBIGUOUS suffix, because a suffix that matches two files is a
 * claim about a file that does not exist — it is two, and which one it meant is
 * a question nobody asked.
 * @param suffix - the end of the repository-relative path, e.g.
 *   `client/item/row-line.tsx`.
 * @returns where the file is and what it says, or an empty source that says why.
 */
export function locateSource(suffix: string): LocatedSource {
  const wanted = suffix.replaceAll('\\', '/').replace(/^\/+/, '')
  const hits = SRC_FILE_LIST.filter(path => path === wanted || path.endsWith(`/${wanted}`))
  if (hits.length === 1) {
    const path = hits[0] as string
    return { suffix: wanted, path, source: readFileSync(join(repoRoot, ...path.split('/')), 'utf8'), missing: '' }
  }
  const dir = wanted.split('/').slice(0, -1).join('/')
  // Matched on the directory as a SEGMENT SEQUENCE inside the path, not as a
  // prefix: the list holds repository-relative paths (`src/client/item/…`) while
  // `dir` is the caller's relative to `src/`, and neither a prefix comparison nor
  // a suffix comparison between the two finds anything — so the message that
  // exists to say what IS there would list nothing at all. A directory is not
  // itself a list entry, which is what defeated the suffix reading.
  const siblings = dir === ''
    ? SRC_FILE_LIST
    : SRC_FILE_LIST.filter(path => path.includes(`/${dir}/`))
  const why = hits.length === 0
    ? `no file under src/ ends with "${wanted}"`
    : `"${wanted}" matches ${hits.length} files (${hits.join(', ')}) — name it more precisely`
  return {
    suffix: wanted,
    path: undefined,
    source: '',
    missing: `the file this gate reads is NOT THERE: ${why}. ${dir === '' ? 'src/' : `${dir}/`} holds: ${siblings.join(', ')}`,
  }
}

/** The text of one file found by the end of its path; `''` when it is not there. */
export function readSource(suffix: string): string {
  return locateSource(suffix).source
}

/**
 * The whole shared layer, as one string.
 *
 * `itemSurfaceSource()` does this for the panel. A claim about the SHARED layer
 * needs the same treatment, because the shared layer is several files and moves
 * between them: `isInboxItem` and `isAgendaItem` were re-exported out of
 * `item-view.ts` and the gate wired to that one path reported 「the inbox
 * predicate is gone from the shared module」 — which was false, the export was
 * still there, and the reader of that message would have gone looking for a
 * deleted function instead of a moved one. Same class as the ten path gates,
 * one directory over, and the same repair.
 *
 * Only `.ts` is read: the layer is pure logic, and concatenating a stylesheet
 * into a source scan would let a word in a comment answer a claim about code.
 */
export function coreSurfaceSource(): string {
  const core = join(repoRoot, 'src', 'core')
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.ts')) files.push(full)
    }
  }
  walk(core)
  return files
    .map(full => `\n/* ==== ${relative(core, full).replaceAll('\\', '/')} ==== */\n${readFileSync(full, 'utf8')}`)
    .join('')
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
    status: 'todo' as const,
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
      status: 'todo',
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
      status: 'todo',
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
      /* **挂着卡的那一行。** 它原来是「受阻」那一档的样本，而清单自己只剩两个值；现在它
         承担的是这一版最要紧的一种组合：**一条挂着卡、而那张卡在「待审核」的行**。它同时
         压住三件事——状态读的是那张卡（不是这一行存的 `todo`）、行首那颗珠子用看板那一栏的
         颜色、以及「这一行在哪一栏」与「它自己存什么」两句话不一致时界面怎么说。
         卡片的台账由台架的 `controller` 假面提供（见 `renderPanel` / `mountPanel`）。 */
      id: 'fx-carded-review',
      ref: 4,
      title: '这一条挂着卡，卡在待审核那一栏',
      status: 'todo',
      taskId: 'task-review',
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
export function fakeReplica(items: readonly ItemRecord[], over: { hostLost?: boolean; synced?: boolean; deleted?: readonly ItemRecord[]; pruned?: string[] } = {}) {
  const writes: (readonly ItemRecord[])[] = []
  return {
    writes,
    view: () => items,
    /** The rows behind a tombstone. Empty unless the fixture says otherwise, and
     *  that is the honest default: `view()` is the live document only, so a
     *  harness that leaves the archive empty is drawing a panel where nothing has
     *  been deleted — not one where the archive is broken. */
    archive: () => over.deleted ?? [],
    setItems: (next: readonly ItemRecord[]) => { writes.push(next) },
    clientId: () => 'client-under-test',
    hostLostItems: () => over.hostLost === true,
    isSynced: () => over.synced !== false,
    onRemote: () => () => undefined,
    /** The mirror of the real replica's local prune: the fake records it so a
     *  gate can assert 「the purge settled the count in the same turn」 without
     *  a browser. `pruned` is the recorded ids, named in the fixture options. */
    pruneDeleted: (id: string, _revision: number): void => {
      if (over.pruned !== undefined) over.pruned.push(id)
    },
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

/** The face the panel reads, built from the seams a caller owns.
 *
 * `openCard` 缺席时面板把卡芯片画成**一枚读数**（`span`），给了才是门（`button`）——所以
 * 这条接缝必须是可选的，两种状态都要能装配出来，测试才问得出「缺席时它是不是退回了读数」。 */
function faceOf(
  replica: ReturnType<typeof fakeReplica>,
  controller: unknown,
  openCard?: (cardId: string) => void,
): ItemListFace {
  return {
    replica: replica as never,
    controller: controller as never,
    ...openCard === undefined ? {} : { openCard },
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
  controller: unknown = {
    getSnapshot: () => ({
      tasks: [
        { id: 'task-1', title: '画廊第二版', status: 'todo', prompt: 'p', description: '' },
        /* 那一条挂卡的 fixture 行（`fx-carded-review`）靠这张卡才读得出它在哪一栏。 */
        { id: 'task-review', title: '给画廊换一批挂画', status: 'review', prompt: 'p', description: '' },
      ],
    }),
    liveStateOf: () => 'idle',
  },
  prefs: Record<string, unknown> = {},
  /** WHICH ROW IS EXPANDED, for a capture. `renderToStaticMarkup` presses nothing,
   *  so the expansion is the one state a static render cannot reach by itself. */
  openRow?: string,
  /**
   * 跨面板那扇门给不给，给的是哪一枚回调。
   *
   * 它在这里出现，是为了让**装配层那两种状态都能被拍下来看**：给了门时卡芯片是一枚
   * `button`（按得动），没给时是一枚 `span`（读数）。这两张图不一样——而「按得动的东西
   * 看起来要像按得动」这件事只有看一眼才算验过（硬性规范 19：量法之外还要有图）。
   */
  openCard?: (cardId: string) => void,
): string {
  return withBand(band, () => withPrefs({ page, ...prefs }, () => renderToStaticMarkup(createElement(ItemListPanel, {
    signal: new AbortController().signal,
    face: faceOf(fakeReplica(items), controller, openCard),
    /* THE BENCH'S CLOCK, and it is the fixture's own. Without this the panel read
     * the real `Date.now()` while every row was dated relative to {@link NOW}, so a
     * fixture built to be nine days late rendered as fifteen days late — a
     * photograph of a panel disagreeing with its own data, and one that looks
     * entirely plausible in both directions. */
    now: NOW,
    ...(openRow === undefined ? {} : { openRow }),
  } as never))))
}

/**
 * THE LAYER A CAPTURE ASKS FOR, read from `DSH_PANEL_OPEN`.
 *
 * It goes through the SAME record the page goes through, for the same reason the
 * page does: a switch that exists only to take a screenshot is a second way of
 * saying 「the palette is open」, and the two ways drift the first time somebody
 * adds the real control. `ItemViewPrefs.overlay` is the one place that says
 * 「which view is on screen」, so a capture sets it there and gets the same reader
 * a reader would.
 *
 * **THE SET OF STATES IS IMPORTED, NOT TYPED HERE.** It used to compare against
 * the literal `'palette'`, so every layer added after that one was unreachable:
 * `DSH_PANEL_OPEN=create` silently produced an ordinary panel, and the capture
 * looked like a CSS failure when nothing had failed. **A gate that cannot see
 * which states exist is a gate that answers 「no」 for every state it has not
 * heard of**, and that reads exactly like a working gate.
 *
 * So the names come from the product module that owns them. Add a layer there and
 * it is photographable the same day; miss it here and this function says so
 * rather than quietly rendering nothing.
 *
 * `undefined` when the variable is absent, so the ordinary capture is an ordinary
 * panel with nothing over it. An unrecognised value is treated as absent rather
 * than guessed at — but it is REPORTED, because a typo in a shell variable is
 * exactly the case where a silent fallback costs an hour of looking at the wrong
 * screenshot.
 */
export function overlayOfEnv(): ItemOverlay | undefined {
  const asked = process.env.DSH_PANEL_OPEN
  if (asked === undefined || asked === '') return undefined
  const known = ITEM_OVERLAYS.find(name => name === asked)
  if (known === undefined) {
    throw new Error(
      `DSH_PANEL_OPEN=${asked} names no layer. The ones this panel has are: ${ITEM_OVERLAYS.join(', ')}. `
      + 'Rendering an ordinary panel here would produce a screenshot that looks like a CSS failure.',
    )
  }
  return known
}

/**
 * THE ROW A CAPTURE EXPANDS, read from `DSH_PANEL_ROW`.
 *
 * ONE VARIABLE PER MEANING. `DSH_PANEL_OPEN` used to answer two questions at once
 * — 「哪一层开着」 for `overlayOfEnv` and 「哪一行展开」 for the render bench — and a
 * variable with two meanings can only ever hold one of them. So asking for an
 * expanded row threw 「names no layer」, and asking for a layer left the expansion
 * closed: **the largest thing on this panel could not be photographed at all**, in
 * a bench whose own comment says that state must not go unlooked-at.
 *
 * The row is named by its `id` rather than by its title or its short number: a
 * fixture whose wording changes would otherwise silently photograph whichever row
 * happened to match, and a capture of the wrong row is a capture of nothing.
 */
export function openRowOfEnv(): string | undefined {
  const asked = process.env.DSH_PANEL_ROW
  if (asked === undefined || asked === '') return undefined
  return asked
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
  // The surface's sheets are ENUMERATED, and a surface with a sheet of its own
  // has to be added here or it renders unstyled in every screenshot — which reads
  // as a CSS failure and is really a missing line. Found by looking: the key
  // help sheet's own rules were absent from the artifact, so the `?` button came
  // out unstyled and looked like a margin rule that did not work.
  const sheets = [
    'src/client/board.module.css',
    'src/client/item/item.module.css',
  ]
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
 * @param scheme - which theme table the host's own tokens resolve against.
 */
export function writeRenderArtifact(target: string, items: readonly ItemRecord[], band: Band, page: Page, scheme: 'light' | 'dark' = 'light', openRow?: string, openCard?: (cardId: string) => void): void {
  // `DSH_PANEL_OPEN` rides the SAME `prefs` channel as the page, and the
  // environment is read HERE rather than inside the panel, so a capture can ask
  // for the open palette and the product code has no idea a capture exists.
  const overlay = overlayOfEnv()
  const aligned = alignClassNames(
    renderPanel(items, band, page, undefined, overlay === undefined ? {} : { overlay }, openRow, openCard),
    panelCss(),
  )
  // THE HOST'S OWN DARK TABLE, NOT A RECONSTRUCTED ONE. `hostTokenCss()`
  // concatenates every stylesheet the theme bundle ships, and the dark table in
  // it is selected by `body[data-ds-dark-theme]` — so putting the attribute on
  // the body is what makes the page resolve against the host's real dark
  // semantic tokens. Reconstructing a dark theme by hand would photograph this
  // plugin's own guess, which is the one thing a capture cannot be evidence for.
  const bodyAttributes = scheme === 'dark' ? ' data-ds-dark-theme' : ''
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
    `</style></head><body${bodyAttributes}>`,
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
  /** 面板通过跨面板那扇门**打开过的卡**，按顺序——`over.openCard` 给了才记得到。 */
  readonly openedCards: string[]
  /** The board cards the panel minted, in mint order — the seeding check reads these. */
  readonly minted: readonly TaskRecord[]
  /** The last document the panel handed to the replica. */
  lastWrite(): readonly ItemRecord[]
  /** Re-render and flush effects. */
  settle(): void
  /** Unmount and detach; every stub this bench installed is already undone. */
  dispose(): void
}

/** A fake board face that records what the panel asked of it.
 *
 * Tasks minted through `createTask`/`createBoundTask` join the snapshot, for the
 * SAME reason the real controller's would: a picker that just made a card shows
 * the card it made, and a fake whose snapshot cannot see its own writes is a
 * fake that cannot answer that question. */
export function fakeController(calls: string[], tasks: { id: string; title: string; description?: string }[] = [{ id: 'task-1', title: '画廊第二版' }]) {
  const minted: TaskRecord[] = []
  return {
    /* `prompt` 是**必填**的（真实的 `TaskRecord` 每一条都有），而它不是可有可无的装饰：
     * 「这张卡跑不跑得起来」就是 `taskExecutable` 读它（清单那一侧现在按它禁用「执行」）。
     * 一台少了这个字段的假面，会让那条判据在测试里抛 `undefined.trim()`——**假面比现实宽容
     * 或比现实窄同样危险**（硬性规范 18）。 */
    getSnapshot: () => ({
      tasks: [
        ...tasks.map(task => ({ prompt: 'p', status: 'todo', ...task, description: task.description ?? '' })),
        ...minted,
      ],
    }),
    liveStateOf: () => 'idle',
    ...boundRecorder(calls, minted),
    /** A READING of what the face has minted so far — the mounted panel exposes
     *  it so a promote's seeding can be asserted; reading, not holding. */
    mintedSnapshot: (): readonly TaskRecord[] => [...minted],
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
function boundRecorder(calls: string[], minted: TaskRecord[]): Record<string, (...args: unknown[]) => unknown> {
  const mutators = [
    'updateTask', 'deleteTask', 'moveTask', 'runTask',
    'openTask', 'closeTask', 'addComment', 'setSchedule', 'ackTask', 'duplicateTask',
  ]
  const out: Record<string, (...args: unknown[]) => unknown> = {}
  for (const name of mutators) out[name] = (...args: unknown[]) => { calls.push(`${name}(${args.length})`); return true }
  // The same entry point the real controller uses, with a fixed clock and id, so
  // the record this hands back is the record the product would have written —
  // including the fields the caller is entitled to read. The minted record also
  // joins the snapshot, so the face reads like one that persisted it.
  for (const name of ['createTask', 'createBoundTask']) {
    out[name] = (...args: unknown[]) => {
      calls.push(`${name}(${args.length})`)
      const input = (args[0] ?? {}) as Parameters<typeof createTask>[0]
      const task = createTask(input, 1_700_000_000_000, 'task-minted')
      minted.push(task)
      return task
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
  over: { hostLost?: boolean; synced?: boolean; deleted?: readonly ItemRecord[]; openCard?: (cardId: string) => void } = {},
): MountedPanel {
  const g = globalThis as Record<string, unknown>
  g.IS_REACT_ACT_ENVIRONMENT = true

  const host = document.createElement('div')
  document.body.appendChild(host)
  const replica = fakeReplica(items, over)
  const calls: string[] = []
  /* 跨面板那扇门的记录：`over.openCard` 是调用方自己的接缝，这里只**既转发又记下**
     它被打开过哪张卡——一条断言要能说「按了它，它带着这个 id 走了」。 */
  const openedCards: string[] = []
  const openCard = over.openCard === undefined
    ? undefined
    : (cardId: string) => { openedCards.push(cardId); over.openCard?.(cardId) }
  const controller = fakeController(calls)
  const root = createRoot(host)
  const signal = new AbortController().signal

  const rect = band === 'wide'
    ? { width: 1600, height: 1000, top: 0, left: 0, right: 1600, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) }
    : { width: 390, height: 844, top: 0, left: 0, right: 390, bottom: 844, x: 0, y: 0, toJSON: () => ({}) }
  const realRect = Element.prototype.getBoundingClientRect
  const realMedia = g.matchMedia
  const realFetch = g.fetch
  /**
   * ONE BOX FOR EVERY ELEMENT, EXCEPT THE ONES THAT HAVE NONE.
   *
   * jsdom lays nothing out, so a stub has to supply the geometry. The first
   * version supplied the SAME rectangle to every element, which made the stub
   * unable to tell a rendered box from an unrendered one — and that is precisely
   * the distinction a placement bug turns on. The row menu was wired to a
   * `hidden` marker element for a while: `getBoundingClientRect()` on it returned
   * this stub's 1600x1000, so every gate stayed green while the real browser
   * returned `{0,0,0,0}` and the menu collapsed to a zero-height strip.
   *
   * A browser answers `{0,0,0,0}` for an element inside `[hidden]`, and that is
   * the only thing this stub now has to reproduce: everything else it still
   * answers with one box, because everything else is the same kind of lie
   * (a real box of unknown size) and no gate in this repository reads its
   * numbers. What gates read is WHICH element was measured, and for that the
   * zero box is the whole answer.
   */
  const notRendered = (element: Element): boolean => element.closest('[hidden]') !== null
  Element.prototype.getBoundingClientRect = function stubbed(this: Element): DOMRect {
    return (notRendered(this) ? { ...rect, width: 0, height: 0, right: 0, bottom: 0 } : { ...rect }) as DOMRect
  }
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
  /* A MOUNT MAY START WITH TOMBSTONES ALREADY IN THE DRAWER.
   *
   * The fake fills this map itself as the panel deletes rows, which is how the
   * archive is reached in every behavioural test — but that path needs a reader
   * to delete something first, and a PHOTOGRAPH of the drawer therefore could
   * only ever show it empty. An empty drawer is the one state where 「the rows
   * stay where they are when one comes back」 cannot be seen at all, so the
   * artifact was structurally unable to answer the question the reader asked.
   * Seeding is the smallest change that lets the same instrument photograph the
   * drawer with rows in it. */
  for (const row of over.deleted ?? []) tombstones.set(row.id, row)
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
    if (url.includes('/board/items?includeDeleted=1')) {
      // The archive read answers from the SAME tombstones the restore answers
      // from: what a delete took away is exactly what the drawered 「已删除」
      // shows. A fake whose read and whose erase disagree is a hostile fake.
      return json({ available: true, revision: 9, deleted: [...tombstones.values()] })
    }
    if (url.includes('/board/items/restore')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { id?: unknown; ref?: unknown }
      const row = typeof body.id === 'string'
        ? tombstones.get(body.id)
        : [...tombstones.values()].find(one => one.ref === body.ref)
      if (row === undefined) return json({ available: true, restored: null })
      tombstones.delete(row.id)
      return json({ available: true, restored: row })
    }
    if (url.includes('/board/items/purge')) {
      // 「彻底删除」 drops the tombstone too: the row is gone from the read the
      // next time the drawer re-reads, which is the observable the confirm bar
      // promises. The revision rides along because a REAL host puts it beside
      // the answer — the replica prunes on it.
      const body = JSON.parse(String(init?.body ?? '{}')) as { id?: unknown; ref?: unknown }
      const row = typeof body.id === 'string'
        ? tombstones.get(body.id)
        : [...tombstones.values()].find(one => one.ref === body.ref)
      if (row === undefined) return json({ available: true, revision: 9, erased: null, notDeleted: true })
      tombstones.delete(row.id)
      return json({ available: true, revision: 9, erased: row })
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

  const settle = (): void => {
    act(() => {
      root.render(createElement(ItemListPanel, {
        signal,
        face: faceOf(replica, controller, openCard),
        /* THE BENCH'S CLOCK, the same reason renderPanel hands its own: every
         * fixture is dated relative to {@link NOW}, so a panel that read the real
         * `Date.now()` would disagree with its own rows the moment a relative
         * word like 明天 was parsed into a date. */
        now: NOW,
      } as never))
    })
  }
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
    get openedCards(): string[] { return openedCards },
    /** The board cards the mounted panel minted, so a promote's SEEDING (the
     *  card's own words) is checkable on the fake that answered it. A LIVE
     *  getter, not a snapshot: mints that happen after the mount have to be
     *  visible to the test that caused them. */
    get minted(): readonly TaskRecord[] { return controller.mintedSnapshot() },
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

/**
 * A keyboard event on a control, with its modifiers.
 *
 * The modifiers are a parameter rather than a separate function because a key map
 * is mostly about WHICH CHORD — `k` alone is 「往上」 on this surface and `⌘K` is
 * the palette — and a helper that can only press a bare key cannot exercise the
 * half of the map that is about chords. They default to none, so the ordinary
 * `press(node, 'Escape')` still reads exactly as it did.
 */
export function press(
  element: Element | null | undefined,
  key: string,
  modifiers: { readonly metaKey?: boolean; readonly shiftKey?: boolean; readonly ctrlKey?: boolean } = {},
): void {
  if (element === null || element === undefined) throw new Error('the control to press is not on screen')
  act(() => {
    element.dispatchEvent(new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      metaKey: modifiers.metaKey === true,
      shiftKey: modifiers.shiftKey === true,
      ctrlKey: modifiers.ctrlKey === true,
    }))
  })
}
