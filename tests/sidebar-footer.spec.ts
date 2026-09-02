// @vitest-environment jsdom
/**
 * Sidebar footer entry contract: the OFFICIAL shell slot is the one and only
 * sidebar affordance for the board. The controller owns the toggle (inert
 * until bound) and the board-open highlight; the component renders a labeled
 * row in the wide column and an icon in the collapsed rail. Anything that
 * regresses the entry back to a DOM-injection row (with its observer loop
 * and its mobile invisibility) must fail here.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SidebarFooter, SidebarFooterController } from '../src/client/SidebarFooter.tsx'

describe('SidebarFooterController', () => {
  it('exposes a toggle that is inert before bindBoard and live after', () => {
    const footer = new SidebarFooterController()
    const face = footer.inject()
    expect(face.toggle).toBeTypeOf('function')
    const toggle = vi.fn()
    footer.bindBoard(() => false, toggle)
    face.toggle()
    expect(toggle).toHaveBeenCalledTimes(1)
    footer.dispose()
    face.toggle()
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('reflects board open state into the snapshot', () => {
    const footer = new SidebarFooterController()
    const face = footer.inject()
    footer.bindBoard(() => true, () => {})
    expect(face.hooks.sidebarFooter.getSnapshot().boardOpen).toBe(true)
    footer.setOpen(false)
    expect(face.hooks.sidebarFooter.getSnapshot().boardOpen).toBe(false)
    footer.dispose()
    expect(face.hooks.sidebarFooter.getSnapshot().boardOpen).toBe(false)
  })
})

describe('SidebarFooter (shell slot component)', () => {
  it('renders a labeled row in the wide column and icon-only in the rail', () => {
    const footer = new SidebarFooterController()
    const face = footer.inject()
    footer.bindBoard(() => false, () => {})
    const use = (sel: (s: unknown) => unknown): unknown => sel(face.hooks.sidebarFooter.getSnapshot())
    const props = ({ wide: true, useSidebarFooter: use, toggle: () => {} } as never)

    const wide = renderToStaticMarkup(createElement(SidebarFooter as never, props))
    const rail = renderToStaticMarkup(createElement(SidebarFooter as never, { ...(props as object), wide: false } as never))

    // Wide column: the label text is present.
    expect(wide).toContain('任务看板')
    // Rail: no label NODE is rendered (the aria-label still carries the
    // name for screen readers — accessibility survives the icon-only form).
    expect(wide).toContain('sidebarFooterLabel')
    expect(rail).not.toContain('sidebarFooterLabel')
  })

  it('marks the row active while the board is open', () => {
    const footer = new SidebarFooterController()
    const face = footer.inject()
    footer.bindBoard(() => true, () => {})
    const use = (sel: (s: unknown) => unknown): unknown => sel(face.hooks.sidebarFooter.getSnapshot())
    const html = renderToStaticMarkup(createElement(SidebarFooter as never, { wide: true, useSidebarFooter: use, toggle: () => {} } as never))
    expect(html).toContain('data-active="true"')
  })
})
