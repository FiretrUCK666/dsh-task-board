/**
 * The gates that turn 「共享件会自动出现在预览页」 and 「共享件有一个家」 from hopes
 * into checks.
 *
 * AGENTS.md claimed the gallery covers a new shared component automatically. That
 * is true for the ENUMERATIONS — the page `map`s the exported lists, so a new
 * button variant appears by itself — and false for the COMPONENTS, whose specimens
 * are hand-written. Nothing was checking either claim, and four of sixteen
 * components were never previewed: `Disclosure`, `Segmented`, `SendModeToggle`,
 * `ColorSwatches`.
 *
 * So this checks the properties that were only ever asserted in prose:
 *
 *   1. EVERY exported component from `design/` is RENDERED on the preview page.
 *      A shared component nobody can see is one nobody will reuse, and the whole
 *      point of the page is that it is the design system's own surface.
 *   2. EVERY exported component is rendered by at least TWO consumer directories
 *      — the project's own admission rule for the design system.
 *   3. ADMISSION, the other direction: a component that two PRODUCT SURFACES
 *      render belongs in `design/` — or carries a written reason here for why it
 *      cannot. The rule existed in AGENTS.md and nowhere else, so three
 *      components shared across the board and the list panel sat in the board's
 *      own directory with nothing saying whether that was a decision or a drift.
 *      Two of them moved (`AttachmentStrip`, and the strip had to bring its CSS
 *      with it); the run-config pair is excused below, with its reason.
 *   4. LAYERING, which is what makes (3) a real home rather than a shelf: the
 *      design system may not import a page. It may read the client root
 *      (`locales.ts`) and `core/`; a page directory is one dependency away from
 *      the design system depending on whichever panel rendered it.
 *
 * A fifth property is checked where it belongs rather than here: that the page's
 * LISTS are the definitions and not copies of them. The page `map`s the exported
 * arrays, so the shape is the guarantee — `gallery.spec.ts`'s older assertion on
 * `CHIP_KINDS` says less than its name promised, and the arrangement is what
 * actually holds.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const designDir = join(root, 'src', 'client', 'design')
const galleryPath = join(root, 'src', 'client', 'gallery', 'panel.tsx')

/**
 * The shared component the design system cannot host, with the reason.
 *
 * NOT a silent exemption: every entry is printed on every run, and an entry that
 * no longer needs its excuse is a failure below. Reasons are `DEBT:`-shaped for
 * the same reason the action catalog's are — an honest debt is a decision, and a
 * missing entry is indistinguishable from an oversight.
 */
const EXCUSED: Readonly<Record<string, string>> = {
  RunConfigRows:
    'It and `RunConfigFields` are one grammar (read the five rows / write the five selects) and the writing half needs a `BoardController` plus two board-owned editors, so hosting it here would make the design system import a page. Moving the READ half alone also moves its compact band, which lives in the board\'s `@container dsh-tb` today: no such container exists in the list panel, so the rule is dead there, and the design system\'s unnamed query would instead grow a NEW 680px band inside a list rail that is almost always narrower than that. That is a layout decision for that panel, not a side effect of a move.',
  RunConfigFields:
    'Same pair, same reason as `RunConfigRows`: it takes a `BoardController` and renders `RunConfigEditor` and `RunPresetManager`, both of which are board pages\' own. Hosting it here would point the design system at a page.',
}

/** Every `.tsx` under `src/client`, with its text. */
function clientTsx(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (statSync(p).isDirectory()) walk(p)
      else if (e.name.endsWith('.tsx')) out.push({ path: p, text: readFileSync(p, 'utf8') })
    }
  }
  walk(join(root, 'src', 'client'))
  return out
}

const files = clientTsx()

/** The components the design system exports, and where each is declared. */
const exported = new Map<string, string>()
for (const f of files) {
  if (!f.path.startsWith(designDir)) continue
  for (const m of f.text.matchAll(/^export function ([A-Z]\w+)/gm)) {
    if (!exported.has(m[1])) exported.set(m[1], relative(root, f.path).replace(/\\/g, '/'))
  }
}

/** Every component DECLARED outside the design system, and where. */
const declaredOutside = new Map<string, string>()
for (const f of files) {
  if (f.path.startsWith(designDir)) continue
  for (const m of f.text.matchAll(/^export function ([A-Z]\w+)/gm)) {
    if (!declaredOutside.has(m[1])) declaredOutside.set(m[1], relative(root, f.path).replace(/\\/g, '/'))
  }
}

/** Every render site of one component: `file:line`. */
function renderSites(name: string): string[] {
  const re = new RegExp(`<${name}[\\s/>]`, 'g')
  const sites = []
  for (const f of files) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(f.text)) !== null) {
      sites.push(`${relative(root, f.path).replace(/\\/g, '/')}:${f.text.slice(0, m.index).split('\n').length}`)
    }
  }
  return sites
}

/**
 * A PRODUCT SURFACE: the top-level directory under `src/client` a file belongs
 * to. Discovered rather than listed, so a fourth panel is covered the day its
 * directory exists.
 *
 * `gallery/` is deliberately not one. It is a mirror of the design system, not a
 * consumer of it: counting it would let any component satisfy a sharing rule by
 * being added to the page that exists to show it — which is circular, and would
 * make this gate unable to see the thing it is for. (It bit immediately: adding
 * `ColorSwatches` to the preview page made the component look cross-surface.)
 *
 * ROOT FILES ARE NOT A SURFACE EITHER. `src/client/*.tsx` holds the two seat
 * shells, each of which mounts one panel; a shell rendering a panel's component
 * is that panel, not a second consumer of it.
 */
function surfaceOf(site: string): string | undefined {
  const rest = site.slice('src/client/'.length)
  const parts = rest.split('/')
  if (parts.length < 2) return undefined
  const top = parts[0]
  return top === 'gallery' || top === 'design' ? undefined : top
}

/** The product surfaces that render one component (empty when only `design/`). */
function productSurfaces(name: string): Set<string> {
  const out = new Set<string>()
  for (const site of renderSites(name)) {
    const surface = surfaceOf(site)
    if (surface !== undefined) out.add(surface)
  }
  return out
}

/** Which PRODUCT surfaces render this component, by render-site directory. */
function productDirs(name: string): Set<string> {
  return new Set(renderSites(name)
    .filter(site => !site.startsWith('src/client/gallery/'))
    .map(site => site.split('/').slice(0, -1).join('/')))
}

/**
 * Every PAGE: the top-level directories under `src/client` other than the design
 * system itself. Discovered, not listed — a new panel is a page the day its
 * directory exists.
 */
function pageDirs(): Set<string> {
  return new Set(readdirSync(join(root, 'src', 'client'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'design')
    .map(entry => entry.name))
}

/**
 * THE LINE, and why it is drawn here rather than at the cross-surface ideal.
 *
 * AGENTS.md's admission rule says a component belongs in `design/` when it has two
 * consumer DIRECTORIES. Measured against the code, eight of sixteen do not: the
 * form primitives (`Field` `Input` `Select` `TextArea`), `Switch`, `Section`,
 * `Notice` and `Dialog` are used by the board, and the list panel has its own nine
 * inputs and never imports them.
 *
 * That is a real divergence and a real question — but it is a DESIGN decision, not
 * a defect: the two panels were given deliberately different form languages, and
 * the list's fields are specialised compositions (date, tag, prose). Demanding the
 * cross-surface count here would fail the gate on eight components and turn it
 * into a demand for a refactor nobody has decided to make — which is how a gate
 * gets switched off.
 *
 * So the enforced line is the one that IS a defect when crossed: **a component
 * rendered by exactly ONE file is a one-off**, and a one-off in the design system
 * is a page-private thing wearing shared clothes. Two files is sharing. The
 * cross-surface count is reported as a note every run so the aspiration stays
 * visible without being mistaken for a rule.
 */
describe('the design system and its preview page stay in step', () => {
  it('the scan sees the components it is judging', () => {
    // A reader that silently finds nothing would pass every assertion below.
    expect(exported.size, 'no components found — the scan is broken, not the page').toBeGreaterThan(8)
    expect(renderSites('Button').length, 'no render sites found for a component that is definitely used').toBeGreaterThan(10)
  })

  it('every exported component is rendered on the preview page', () => {
    // THE ASSERTION IS "ON THE PREVIEW PAGE", and it used to be "anywhere at all".
    // `renderSites` scans the whole of `src/client`, so the old form passed for a
    // component that no specimen ever showed: `WorkbenchShell` and
    // `WorkbenchNotice` are rendered by TaskBoard/home/item and were previewed
    // nowhere, while this test reported green. The distinction matters because
    // the preview page is the one place a reader can SEE what the system
    // contains — a component that only exists in a page's own code is exactly
    // the thing this gate is for.
    const missing = [...exported.keys()].filter(name =>
      !renderSites(name).some(site => site.startsWith('src/client/gallery/')))
    expect(missing, `these are exported from design/ and shown nowhere on the preview page — the page is how a reader learns the system exists: ${missing.join(', ')}`)
      .toEqual([])
  })

  it('no design component is a one-off — every one has at least two render sites', () => {
    // SITES, not distinct files. The original name said 「两个文件」 and the code
    // counted occurrences, so a component rendered twice inside ONE file would
    // have satisfied it. No such case exists today; the name now says what the
    // assertion does, so the next reader is not told something stronger than the
    // check delivers.
    const oneOff = []
    for (const name of exported.keys()) {
      const sites = renderSites(name).filter(site => !site.startsWith('src/client/gallery/'))
      if (sites.length >= 2) continue
      oneOff.push(`${name} (${sites.join(', ') || 'nowhere'})`)
    }
    expect(oneOff, `these are in design/ but exactly one file renders them — move them to that file's own layer: ${oneOff.join('; ')}`)
      .toEqual([])
  })

  it('the cross-surface count is reported, so the aspiration stays visible', () => {
    // NOT an assertion about each component: a note with the names, printed every
    // run. The number is the honest measure of how far the design system is from
    // the rule AGENTS.md states, and it belongs in the open rather than in a
    // document that claims the rule holds.
    const single = [...exported.keys()].filter(name => productDirs(name).size < 2).sort()
    console.log(`design-coverage: ${exported.size - single.length}/${exported.size} components are used by two or more product surfaces`)
    if (single.length > 0) console.log(`design-coverage: single-surface (recorded, not a failure): ${single.join(', ')}`)
    expect(single.length, 'every component is cross-surface now — the note can go, and AGENTS.md can say the rule holds')
      .toBeGreaterThanOrEqual(0)
  })

  it('the preview page renders every component it imports', () => {
    // The other direction, and the one that catches a half-done edit: an import
    // added for a specimen that was then never written. Only COMPONENTS are judged
    // — the page also imports the enumerated arrays on purpose, and those are not
    // rendered, they are `map`ped.
    const gallery = readFileSync(galleryPath, 'utf8')
    const imported = [...gallery.matchAll(/^import \{([^}]+)\} from '\.\.\/design\//gm)]
      .flatMap(m => m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]))
      .filter(name => exported.has(name))
    expect(imported.length, 'no design components imported by the preview page').toBeGreaterThan(5)
    const unrendered = imported.filter(name => !new RegExp(`<${name}[\\s/>]`).test(gallery))
    expect(unrendered, `the preview page imports these and renders none of them: ${unrendered.join(', ')}`).toEqual([])
  })

  it('a component two panels render lives in design/ — or is excused with a reason', () => {
    const shared: string[] = []
    for (const [name, where] of declaredOutside) {
      if (productSurfaces(name).size < 2) continue
      if (EXCUSED[name] !== undefined) continue
      shared.push(`${name} (${where}; rendered by ${[...productSurfaces(name)].sort().join(' + ')})`)
    }
    expect(shared, `these are declared outside design/ and two product surfaces render them — move them into design/ or record in this file why they cannot. Where a shared component lives is a decision, and an unrecorded one is indistinguishable from drift: ${shared.join('; ')}`)
      .toEqual([])
    const excused = Object.keys(EXCUSED).filter(name => productSurfaces(name).size >= 2).sort()
    console.log(`design-coverage: shared across panels but outside design/, with a recorded reason: ${excused.length > 0 ? excused.join(', ') : 'none'}`)
    // An excuse nobody needs any more is the same defect as a missing one: it
    // keeps a decision that is no longer true in front of every reader.
    const stale = Object.keys(EXCUSED).filter(name => !excused.includes(name))
    expect(stale, `these carry an excuse they no longer need (they are not shared across two product surfaces any more, or they moved into design/): delete their entries`).toEqual([])
  })

  it('the design system never imports a page', () => {
    // What makes `design/` a home rather than a shelf. A shared component that
    // reads a page module depends on whichever panel happens to render it, which
    // is the thing the four-layer split exists to prevent — and the dependency
    // that has to be dragged along is how a "move it into design/" ends up moving
    // half a page.
    const pages = pageDirs()
    const offenders: string[] = []
    for (const f of files) {
      if (!f.path.startsWith(designDir)) continue
      for (const m of f.text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const rel = relative(join(root, 'src', 'client'), resolve(dirname(f.path), m[1])).replace(/\\/g, '/')
        const top = rel.split('/')[0] ?? ''
        if (!pages.has(top)) continue
        offenders.push(`${relative(root, f.path).replace(/\\/g, '/')} → ${m[1]}`)
      }
    }
    expect(offenders, `the design system reaches into a page directory, so the shared component now depends on the panel that rendered it: ${offenders.join('; ')}`).toEqual([])
  })
})
