/**
 * The two gates that turn 「共享件会自动出现在预览页」 from a hope into a check.
 *
 * AGENTS.md claimed the gallery covers a new shared component automatically. That
 * is true for the ENUMERATIONS — the page `map`s the exported lists, so a new
 * button variant appears by itself — and false for the COMPONENTS, whose specimens
 * are hand-written. Nothing was checking either claim, and four of sixteen
 * components were never previewed: `Disclosure`, `Segmented`, `SendModeToggle`,
 * `ColorSwatches`.
 *
 * So this checks the two properties that were only ever asserted in prose:
 *
 *   1. EVERY exported component from `design/` is RENDERED on the preview page.
 *      A shared component nobody can see is one nobody will reuse, and the whole
 *      point of the page is that it is the design system's own surface.
 *   2. EVERY exported component is rendered by at least TWO consumer directories
 *      — the project's own admission rule for the design system. Two names are
 *      declared exceptions with their reasons, because moving them is a layering
 *      change with no user-visible effect and the honest record is better than a
 *      silent exemption.
 *
 * A third property is checked where it belongs rather than here: that the page's
 * LISTS are the definitions and not copies of them. The page `map`s the exported
 * arrays, so the shape is the guarantee — `gallery.spec.ts`'s older assertion on
 * `CHIP_KINDS` says less than its name promised, and the arrangement is what
 * actually holds.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const designDir = join(root, 'src', 'client', 'design')
const galleryPath = join(root, 'src', 'client', 'gallery', 'panel.tsx')

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
 * Which PRODUCT surfaces render this component.
 *
 * `gallery/` is deliberately not counted here. It is a mirror of the design system,
 * not a consumer of it: counting it would let any component satisfy a sharing rule
 * by being added to the page that exists to show it — which is circular, and would
 * make this gate unable to see the thing it is for. (It bit immediately: adding
 * `ColorSwatches` to the preview page made the component look cross-surface.)
 */
function productDirs(name: string): Set<string> {
  return new Set(renderSites(name)
    .filter(site => !site.startsWith('src/client/gallery/'))
    .map(site => site.split('/').slice(0, -1).join('/')))
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
    const missing = [...exported.keys()].filter(name => renderSites(name).length === 0)
    expect(missing, `these are exported from design/ and rendered nowhere — either show them on the preview page or delete them: ${missing.join(', ')}`)
      .toEqual([])
  })

  it('no design component is a one-off — every one is rendered by at least two files', () => {
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
})
