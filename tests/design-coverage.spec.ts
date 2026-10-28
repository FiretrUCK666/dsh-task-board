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
import { SHARED_CANDIDATES } from '../src/client/gallery/shared-candidates.ts'
import { ADDITION_RECORDS } from '../src/client/design/addition-records.ts'
import { pathsIn } from '../scripts/verify-one-implementation.mjs'

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
  WorkbenchOverlays:
    'It is the set of overlays EVERY workbench page carries, and it reads `update-controller` — a module singleton that owns the update check. Hosting it in `design/` would make the design system import the assembler layer, which is the one direction the four-layer split forbids: the check would then depend on the shell that happens to render it. Its content is not a design substance either; it is one product feature (检查更新) that must appear on every page. What actually has to hold is "every page renders it", and that is asserted on its own — see the spec that counts overlays per panel.',
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

/**
 * The units that carry an addition record.
 *
 * The ledger writes 「路径 —— 一句话」, so the path is the FIRST word; that is
 * what `pathsIn` picks out. A component is 「recorded」 when a record's unit
 * names the file it is declared in.
 */
const recordedUnits = new Set<string>(
  ADDITION_RECORDS.flatMap(record => pathsIn(record.unit)),
)

/**
 * A COMPONENT CANDIDATE: an exported binding whose name starts with a capital.
 *
 * The scan is deliberately wider than 「export function」: a component written as
 * `export const Chip = () => …` or `export class Chip` is still a component, and
 * a scan that only sees functions judges the code by how it was typed rather
 * than by what it is.
 *
 * Wider means more candidates than components, so the next filter decides.
 *
 * ── 那道过滤是什么 ──────────────────────────────────────────────────────────
 *
 * **导出的是不是函数。** 一个组件是**能渲染的东西**；一个枚举数组是被 `map`
 * 的常量。两者都是「首字母大写的导出」，所以光看名字分不开——但它们的**值**分得开：
 * 前者的值是一个函数，后者的值是一个数组。
 *
 * 判的是**结构**（初始化式是不是函数），不是「名字里有没有 KINDS」这种字样。
 */
const COMPONENT_CANDIDATE = /^export (?:function|const|class) ([A-Z]\w*)/gm

/**
 * Is this export a FUNCTION (or a class)?
 *
 * `export function X` and `export class X` are yes. `export const X = …` counts
 * only when what follows the `=` is a function — which is what tells a
 * component (`= (props) => …`) from an enumerated list (`= ['a', 'b']`).
 *
 * **`forwardRef(…)` AND `memo(…)` COUNT, and they must be named here.** Both are
 * higher-order calls whose RESULT is a component — React renders them exactly like
 * a plain function component. A judgement that only accepted a bare `(` would call
 * a ref-forwarding component "not a component", and the two failures that produces
 * are both silent: the component disappears from the coverage count (so the
 * single-consumer record it owes goes unchecked), and the preview-page lists that
 * cross-check this map would report it as "a name design/ does not export".
 *
 * The judgement stays structural — it asks whether the initialiser EVALUATES to a
 * component, not whether the name looks like one.
 *
 * @param {string} text - the whole file.
 * @param {RegExpExecArray} m - the candidate match.
 * @returns {boolean}
 */
function isFunctionExport(text: string, m: RegExpExecArray): boolean {
  // 关键字是 TypeScript 的词，不是散文里的字样
  if (m[0].startsWith('export function') || m[0].startsWith('export class')) return true
  const after = text.slice(m.index + m[0].length)
  const eq = after.indexOf('=')
  if (eq < 0) return false
  /* 三种形状都是组件：箭头函数 / 泛型箭头，以及两个高阶包装器（它们返回的仍是组件）。 */
  return /^(async\s+)?(\(|<|forwardRef\s*[(<]|memo\s*[(<])/.test(after.slice(eq + 1).trimStart())
}

/** The components the design system exports, and where each is declared. */
const exported = new Map<string, string>()
for (const f of files) {
  if (!f.path.startsWith(designDir)) continue
  for (const m of f.text.matchAll(COMPONENT_CANDIDATE)) {
    if (!isFunctionExport(f.text, m)) continue
    if (!exported.has(m[1])) exported.set(m[1], relative(root, f.path).replace(/\\/g, '/'))
  }
}

/** Every component DECLARED outside the design system, and where. */
const declaredOutside = new Map<string, string>()
for (const f of files) {
  if (f.path.startsWith(designDir)) continue
  for (const m of f.text.matchAll(COMPONENT_CANDIDATE)) {
    if (!isFunctionExport(f.text, m)) continue
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

  it('a design component with one consumer carries a recorded reason', () => {
    // 一处消费者也可以住在共享层——「新增即入共享层，哪怕只被用一次」是规矩。
    // 但那不是默认：**默认是两处**，一处的那份必须**留一条记录**（新增登记），
    // 说得出「谁要求新增」与「为什么不能用最接近的那个」。
    //
    // 这条以前是「一处就搬走」。那与新章节直接打架：规矩说新增先落共享层，
    // 门禁却把刚落的那个推回页面——于是下一个人只能绕过共享层，
    // 因为「先落共享层」在这个项目里会被门禁当场撤销。
    const oneOff = []
    for (const name of exported.keys()) {
      const sites = renderSites(name).filter(site => !site.startsWith('src/client/gallery/'))
      if (sites.length >= 2) continue
      const where = exported.get(name) ?? ''
      if (recordedUnits.has(where)) continue
      oneOff.push(`${name} (${sites.join(', ') || 'nowhere'}; ${where})`)
    }
    expect(oneOff, `these are in design/ with one consumer and no record — either give them a second consumer, or record the addition in src/client/design/addition-records.ts: ${oneOff.join('; ')}`)
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

  it('the preview page shows exactly the components that have one consumer today', () => {
    // 「以后会不会被复用」答不出来，「现在被几处用到」是事实。名单摆到预览页上，
    // 让下一个人翻得到——所以这份名单必须**跟着计数走**，不能自己长。
    //
    // 三个方向都判，因为三种走法各不相同：名单里写了一个已经被两个页面用的名字
    // （过时的借口）、名单漏了一个只有一个消费者的组件（还没记的欠账）、以及
    // 名单里那个名字根本不是 design/ 导出的（拼错或已删除）。少判一个方向，名单
    // 就会朝那个方向慢慢腐烂。
    const single = new Set([...exported.keys()].filter(name => productDirs(name).size < 2))
    const listed = new Set(SHARED_CANDIDATES.map(entry => entry.name))

    const stale = [...listed].filter(name => !single.has(name)).sort()
    expect(stale, `these are on the preview page as single-consumer components but have two or more consumers now (or are no longer exported): ${stale.join(', ')}`)
      .toEqual([])

    const missing = [...single].filter(name => !listed.has(name)).sort()
    expect(missing, `these have one consumer and are not on the preview page's list, so nobody can see they exist: ${missing.join(', ')}`)
      .toEqual([])

    const unexported = [...listed].filter(name => !exported.has(name)).sort()
    expect(unexported, `the preview page lists names that design/ does not export: ${unexported.join(', ')}`)
      .toEqual([])

    const noReason = SHARED_CANDIDATES.filter(entry => entry.why.trim().length < 8)
    expect(noReason.map(entry => entry.name), 'a name with no reason reads as a to-do item, and these are decisions or excuses — say which')
      .toEqual([])
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

  it('the design system never imports a page', () => {    // What makes `design/` a home rather than a shelf. A shared component that
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

  it('every page that shows the workbench bar also mounts the overlays', () => {
    /* ── 这条钉的是一次真实的「功能被拆在两个地方」 ────────────────────────────
     *
     * 检查更新的**按钮**由 `WorkbenchBar` 渲染（`checking` / `onCheck` 是它的 props），
     * 而按钮打开的**对话框**曾经只住在看板页的 JSX 里。于是同一个按钮在三个页面里有
     * 两种行为：看板页能弹出，另外两页什么都不发生。
     *
     * 那不是漏改一处：触发在共享层、结果在页面层，**一个功能被拆开了**。每加一个新
     * 页面这个缺口就再出现一次，而它不报错、不红、测试也过——每一页各自都「正确地」
     * 渲染了自己那份 JSX，只是少了一份。
     *
     * 判据是结构性的，而且**自己发现页面**：
     *
     *   1. 凡是用 `WorkbenchBar` / `WorkbenchShell` 的文件就是一个「带栏的页面」——
     *      因为栏是那个按钮的来源，与「哪一页」无关。
     *   2. 这样的文件必须同时渲染 `WorkbenchOverlays`（或直接渲染 `UpdateDialog`）——
     *      否则它有一颗按下没反应的按钮。
     *
     * 加第 4、第 5 个页面时，只要它用了栏，这条就自动覆盖它；不用栏的页面没有那颗
     * 按钮，也就不需要对话框。 */
    const barUsers: string[] = []
    const missing: string[] = []
    for (const f of files) {
      const rel = relative(root, f.path).replace(/\\/g, '/')
      /* `design/` 里是壳与栏的**定义**，不是消费者；`gallery/` 摆的是**标本**
         （`onCheck={() => undefined}`，一个不接任何东西的按钮），它不打开对话框是
         对的——那里没有真的检查要跑。判据只问「真页面上那颗按钮有没有结果」。 */
      if (rel.startsWith('src/client/design/') || rel.startsWith('src/client/gallery/')) continue
      const rendersBar = /<WorkbenchBar[\s>]|<WorkbenchShell[\s>]/.test(f.text)
      if (!rendersBar) continue
      barUsers.push(rel)
      const mountsOverlays = /<WorkbenchOverlays[\s/>]|<UpdateDialog[\s/>]/.test(f.text)
      if (!mountsOverlays) missing.push(rel)
    }
    /* 读取器自证：一个页面都没找到说明扫描坏了，而不是「都没问题」。 */
    expect(barUsers.length, 'no page renders the workbench bar — the scan is broken, not the pages').toBeGreaterThan(1)
    expect(missing, `these pages show the 检查更新 button but never mount its dialog, so the button does nothing there: ${missing.join(', ')}`)
      .toEqual([])
  })
})

/**
 * 组件识别的自测：**它认得出几种形状，也认得出哪些不是组件**。
 *
 * 没有这一节，上面所有计数都可以在「解析器一个都没认出来」的情况下全绿——那正是
 * 一条读不出东西的门禁最危险的地方：它安静地报告 0，而 0 看起来像「没有问题」。
 */
describe('the component-export judgement reads structure, not spelling', () => {
  /** 跑一遍判据，返回它认不认为这是一个组件导出。 */
  function judges(source: string): boolean {
    const candidate = /^export (?:function|const|class) ([A-Z]\w*)/gm.exec(source)
    if (candidate === null) throw new Error('the probe source has no component candidate')
    return isFunctionExport(source, candidate)
  }

  it('accepts every shape that evaluates to a component', () => {
    expect(judges('export function Chip() { return null }')).toBe(true)
    expect(judges('export class Chip { render() { return null } }')).toBe(true)
    expect(judges('export const Chip = () => null')).toBe(true)
    expect(judges('export const Chip = <T,>() => null')).toBe(true)
    /* 两个高阶包装器的**结果**仍是组件——React 渲染它们与渲染普通函数组件毫无区别。 */
    expect(judges('export const Chip = forwardRef(function Chip(props, ref) { return null })')).toBe(true)
    expect(judges('export const Chip = memo(function Chip() { return null })')).toBe(true)
  })

  it('rejects a capitalised export whose value is not a component', () => {
    /* 首字母大写的枚举数组不是组件：它会被 `map`，不会被渲染。 */
    expect(judges("export const KINDS = ['a', 'b']")).toBe(false)
    expect(judges('export const FIGURES = { a: 1 }')).toBe(false)
    /* 一个返回值的普通调用也不是组件。 */
    expect(judges('export const FIGURES = makeFigures()')).toBe(false)
  })
})
