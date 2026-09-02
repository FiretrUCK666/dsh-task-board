// @vitest-environment jsdom
/**
 * Sidebar footer entry contract: the OFFICIAL shell slot is the one and only
 * sidebar affordance for the board. The controller owns the toggle (queued as
 * pendingOpen until bound — a click is never silently dropped, the "点了没反
 * 应" on slow tunnels) and the board-open highlight; the component renders a
 * labeled row in the wide column and an icon in the collapsed rail. Anything
 * that regresses the entry back to a DOM-injection row (with its observer loop
 * and its mobile invisibility) must fail here.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SidebarFooter, SidebarFooterController } from '../src/client/SidebarFooter.tsx'

describe('SidebarFooterController', () => {
  it('queues a click before bindBoard and fires it the moment the board binds', () => {
    const footer = new SidebarFooterController()
    const face = footer.inject()
    const toggle = vi.fn()
    // Unbound click: queued, marked pending — never silently dropped.
    face.toggle()
    expect(face.hooks.sidebarFooter.getSnapshot().pendingOpen).toBe(true)
    expect(toggle).not.toHaveBeenCalled()
    // Bind: the queued intent fires immediately and the flag clears.
    footer.bindBoard(() => false, toggle)
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(face.hooks.sidebarFooter.getSnapshot().pendingOpen).toBe(false)
    // A second (bound) click goes straight through.
    face.toggle()
    expect(toggle).toHaveBeenCalledTimes(2)
  })

  it('drop queued intent on dispose and reflect board open state', () => {
    const footer = new SidebarFooterController()
    const face = footer.inject()
    face.toggle()
    footer.dispose()
    expect(face.hooks.sidebarFooter.getSnapshot().pendingOpen).toBe(false)
    footer.bindBoard(() => true, () => {})
    expect(face.hooks.sidebarFooter.getSnapshot().boardOpen).toBe(true)
    footer.setOpen(false)
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

  it('shows the pending treatment while a click is queued', () => {
    const footer = new SidebarFooterController()
    const face = footer.inject()
    face.toggle() // unbound → pending
    const use = (sel: (s: unknown) => unknown): unknown => sel(face.hooks.sidebarFooter.getSnapshot())
    const html = renderToStaticMarkup(createElement(SidebarFooter as never, { wide: true, useSidebarFooter: use, toggle: () => {} } as never))
    expect(html).toContain('data-pending="true"')
  })
})
