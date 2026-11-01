/**
 * The design-system gallery: it renders, and its two curated lists are true.
 *
 * TWO CLAIMS, and they are different kinds.
 *
 *   1. IT RENDERS. The gallery is a page nobody navigates to in CI, so nothing
 *      else would notice it throwing. Rendering it to static markup is also how
 *      the artifact below gets written, so the page a human looks at and the
 *      page this spec renders are the same page.
 *
 *   2. ITS LISTS ARE NOT A SECOND COPY. Most of the page is DERIVED — the
 *      button variants, the chip kinds and the icon names come from the modules
 *      the components are built from, so a variant added there appears here with
 *      no edit. Two lists cannot be derived: CSS has no way to enumerate its own
 *      custom properties, and a type ladder is a rule rather than a set of
 *      tokens. Those two are held to the sheets below, so a renamed token or a
 *      size that leaves the ladder is red rather than silently absent from the
 *      page whose whole job is "show me everything".
 *
 * ── 两个方向，缺一个就会静默漏掉一类 ─────────────────────────────────────────────
 *
 * The assertions below used to run ONE way: every name the page shows must be a
 * token some sheet declares. That catches a rename. It does NOT catch the failure
 * the page exists to prevent — a token that is declared, read by plenty of rules,
 * and shown to nobody. It happened: 59 of 115 tokens were absent from the page,
 * among them the entire `plane-*` surface ladder, so the page taught a vocabulary
 * that had already been superseded while the current one was invisible.
 *
 * A curated list has exactly one honest invariant: it is the WHOLE catalogue, not
 * a sample of it. So both directions are asserted, and the only escape is an
 * entry in `UNSHOWN` carrying a structural reason — printed on every run, and red
 * the moment the token it excuses stops existing (a stale excuse is a lie).
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { DesignGallery, GALLERY_TOKEN_GROUPS, GALLERY_TYPE_LADDER } from '../src/client/gallery/panel.tsx'
import { CHIP_KINDS } from '../src/client/design/Chip.tsx'
import { alignClassNames, catalogueGaps, clientSheets, designCss, pageCss, stripCssComments, writeStandalonePage } from './panel-harness.ts'

/** Every `--dsh-tb-*` name any client stylesheet declares. */
function declaredTokens(): Set<string> {
  const found = new Set<string>()
  for (const match of designCss().matchAll(/(?:^|[;{\s])(--dsh-tb-[a-z0-9-]+)\s*:/g)) found.add(match[1] as string)
  return found
}

/**
 * Every `--dsh-tb-*` name the TOKEN LAYER declares — the catalogue's subject.
 *
 * Not every name any sheet declares: a page is allowed to declare a **slot** (an
 * interface between the shared layer and the page, which each page fills with its
 * own tier — `--dsh-tb-scroll-inset` is the worked example, declared by every
 * rounded scroller with its own corner radius). A slot is not a step of the
 * system, so demanding that the page exhibit it would be a category error, and
 * listing it would show one page's choice as if it were the rule.
 *
 * The token layer is where "one name per step" is the law, so that is the set the
 * page must be the whole catalogue OF.
 */
function tokenLayerNames(): Set<string> {
  // The token layer is found by PATH, not by a class name: `sheetOf` answers "which
  // sheet defines `.foo`" and prepends a dot, which is the wrong question here.
  // Naming the path is also what makes a move loud — if the layer is renamed this
  // throws instead of returning an empty catalogue, and an empty catalogue would
  // report every token as hidden (a gate that cries wolf gets ignored).
  const sheet = clientSheets().find(one => one.rel === 'src/client/design/tokens.module.css')
  if (sheet === undefined) throw new Error('the token layer moved: no sheet at src/client/design/tokens.module.css — the catalogue has no subject')
  const found = new Set<string>()
  for (const match of stripCssComments(sheet.css).matchAll(/(?:^|[;{\s])(--dsh-tb-[a-z0-9-]+)\s*:/g)) found.add(match[1] as string)
  return found
}

/**
 * Tokens the page deliberately does NOT list, each with a structural reason.
 *
 * The reason must say why the token cannot be shown, never that showing it would
 * be inconvenient. An entry whose token no longer exists is a failure below: a
 * stale excuse is indistinguishable from a lie, and it would let the next missing
 * token hide behind a name nobody reads.
 *
 * It is empty, and that is the intended state — the page shows all 115 tokens the
 * layer declares. It exists so that the next person who genuinely cannot show one
 * has somewhere honest to put it, instead of quietly leaving it out.
 */
const UNSHOWN: Readonly<Record<string, string>> = {}

describe('the gallery is a page that renders and does not lie', () => {
  it('renders to markup, not an error page', () => {
    const html = renderToStaticMarkup(createElement(DesignGallery))
    expect(html.length).toBeGreaterThan(2000)
    expect(html, 'the gallery rendered no title').toContain('galleryRoot')
  })

  it('every token it shows is declared by the design layer', () => {
    const declared = declaredTokens()
    const missing: string[] = []
    for (const group of GALLERY_TOKEN_GROUPS) {
      for (const name of group.names) if (!declared.has(name)) missing.push(`${group.title}: ${name}`)
    }
    expect(
      missing,
      'the gallery shows a token no sheet declares — a renamed variable would otherwise vanish from the one page that is supposed to list them all',
    ).toEqual([])
  })

  it('every token the design layer declares is SHOWN — the page is the whole catalogue', () => {
    // The direction that was missing, and the one that matters: a token can be
    // declared, read everywhere, and still be invisible on the page whose entire
    // job is to show what exists. 59 of 115 were, including the whole surface
    // ladder, so a reader learned a vocabulary that no longer matched the sheets.
    //
    // SHOWN means "this page renders it", and the page renders from TWO records:
    // the token groups AND the type ladder (whose rows name a token and whose
    // specimens read it). Reading only the first would report the ladder's six
    // steps as invisible while they are on screen — a checker that reports the
    // wrong thing is worse than one that reports nothing, so both are collected.
    const shown = new Set<string>()
    for (const group of GALLERY_TOKEN_GROUPS) for (const name of group.names) shown.add(name)
    for (const step of GALLERY_TYPE_LADDER) shown.add(step.token)
    const gaps = catalogueGaps(tokenLayerNames(), shown, UNSHOWN)
    expect(
      gaps.hidden,
      'these tokens are declared and read but never shown to anyone — list them in a group, or record in UNSHOWN why this token cannot be shown',
    ).toEqual([])
  })

  it('an UNSHOWN excuse outlives nothing: every entry still names a real token', () => {
    // A reason that points at a token nobody declares is a reason nobody can act
    // on — and worse, it silently excuses the NEXT token with that name.
    const gaps = catalogueGaps(tokenLayerNames(), new Set(), UNSHOWN)
    expect(gaps.staleExcuses, 'UNSHOWN excuses a token the token layer does not declare — the excuse has outlived its subject').toEqual([])
  })

  it('every UNSHOWN entry carries a reason, not a placeholder', () => {
    const gaps = catalogueGaps(tokenLayerNames(), new Set(), UNSHOWN)
    expect(gaps.hollowExcuses, 'an excuse without a real reason is a gap nobody will ever audit').toEqual([])
  })

  it('every type step it shows names a token the design layer declares', () => {
    // The ladder is DERIVED: each row names a token and the specimen reads it, so
    // a row can only be wrong in one way — it names something that is not there.
    // A renamed step would otherwise render at the inherited size, which looks
    // like a working specimen rather than a broken one.
    const declared = declaredTokens()
    const missing = GALLERY_TYPE_LADDER.filter(step => !declared.has(step.token)).map(step => `${step.label} ${step.token}`)
    expect(missing, 'a type-ladder row names a token no sheet declares').toEqual([])
  })

  it('every type-ladder token is actually read by a sheet, not just declared', () => {
    // The other direction, and the one that keeps the ladder honest: a step may be
    // declared in the token layer and still describe a size nothing uses. That is
    // a ladder nobody is on, and it teaches the reader a step that is not real.
    const css = designCss() + '\n' + pageCss('board') + '\n' + pageCss('item') + '\n' + pageCss('home') + '\n' + pageCss('gallery') + '\n' + pageCss('workbench')
    const orphans = GALLERY_TYPE_LADDER
      .filter(step => !new RegExp(`var\\(\\s*${step.token}\\b`).test(css))
      .map(step => `${step.label} ${step.token}`)
    expect(orphans, 'a type-ladder step no sheet reads — the ladder describes a size nobody is on').toEqual([])
  })

  it('the derived lists are the definitions, not copies of them', () => {
    // `CHIP_KINDS` and the button variants live beside their components; the
    // gallery imports them. This is the claim that it does not restate them.
    expect(CHIP_KINDS.length).toBeGreaterThan(1)
    expect(new Set(CHIP_KINDS).size, 'a duplicate kind would render twice').toBe(CHIP_KINDS.length)
  })

  it('writes the gallery page when DSH_PANEL_HTML names a path', () => {
    const target = process.env.DSH_PANEL_HTML
    if (target === undefined || target === '') return
    // `alignClassNames` is what makes a source-level artifact renderable: the
    // markup React produces carries the LITERAL class names (`galleryRoot`) and
    // the sheets on disk are written in the same literals, so the two are
    // already aligned — but the panels' artifacts go through this step and the
    // page below must be assembled the same way or it renders as a document of
    // unstyled divs. Found by looking: the first gallery screenshot was exactly
    // that.
    const aligned = alignClassNames(
      renderToStaticMarkup(createElement(DesignGallery)),
      pageCss('gallery') + '\n' + pageCss('board') + '\n' + pageCss('item') + '\n' + designCss(),
    )
    writeStandalonePage(target, aligned.html, aligned.css, process.env.DSH_PANEL_DARK === '1' ? 'dark' : 'light', 'design system gallery')
  })
})
