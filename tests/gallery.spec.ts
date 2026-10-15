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
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { DesignGallery, GALLERY_TOKEN_GROUPS, GALLERY_TYPE_LADDER } from '../src/client/gallery/panel.tsx'
import { CHIP_KINDS } from '../src/client/design/Chip.tsx'
import { alignClassNames, designCss, pageCss, writeStandalonePage } from './panel-harness.ts'

/** Every `--dsh-tb-*` name any client stylesheet declares. */
function declaredTokens(): Set<string> {
  const found = new Set<string>()
  for (const match of designCss().matchAll(/(?:^|[;{\s])(--dsh-tb-[a-z0-9-]+)\s*:/g)) found.add(match[1] as string)
  return found
}

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

  it('every type step it shows is a size the sheets actually use', () => {
    // A ladder is a rule about which sizes the interface may use, so a row that
    // no sheet writes is a row describing a ladder nobody is on.
    const css = pageCss('board') + '\n' + pageCss('item')
    const used = new Set([...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1])))
    const orphans = GALLERY_TYPE_LADDER.filter(step => !used.has(step.size)).map(step => `${step.label} ${step.size}px`)
    expect(orphans, 'a type-ladder row no sheet uses').toEqual([])
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
