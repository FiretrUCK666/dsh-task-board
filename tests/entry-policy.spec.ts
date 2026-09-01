// @vitest-environment jsdom
/**
 * Entry display policy contract: visibility is the ONLY input to the
 * one-entry decision (row visible = row wins; anything else = fallback).
 * A row that is connected but hidden, off-viewport (a mobile drawer slides
 * it out while it keeps its layout rects), or detached must never count as
 * the entry — that is precisely the mobile "board button vanished" failure.
 */
import { describe, expect, it } from 'vitest'
import { entryVisible, fallbackWanted } from '../src/client/entry-policy.ts'

/** Stub the layout measurement the way a browser would report it. */
function withRect(element: HTMLElement, rect: { width: number; height: number; left?: number; top?: number }): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    value: () => ({
      width: rect.width,
      height: rect.height,
      left: rect.left ?? 10,
      top: rect.top ?? 10,
      right: (rect.left ?? 10) + rect.width,
      bottom: (rect.top ?? 10) + rect.height,
    } as unknown as DOMRect),
  })
}

describe('entry policy', () => {
  it('entryVisible rejects detached elements', () => {
    const detached = document.createElement('button')
    expect(entryVisible(detached)).toBe(false)
  })

  it('entryVisible accepts a connected element with layout boxes inside the viewport', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const button = document.createElement('button')
    host.appendChild(button)
    withRect(button, { width: 40, height: 20 })
    expect(entryVisible(button)).toBe(true)
    button.remove()
  })

  it('entryVisible rejects a connected element hidden by CSS (zero rects)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const button = document.createElement('button')
    button.style.display = 'none'
    host.appendChild(button)
    expect(button.isConnected).toBe(true)
    // jsdom reports zero rects for a display:none element.
    expect(entryVisible(button)).toBe(false)
    button.remove()
  })

  it('entryVisible rejects an off-canvas drawer entry (rects exist but off-viewport)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const button = document.createElement('button')
    host.appendChild(button)
    // A closed mobile drawer: the entry keeps width/height but its rects lie
    // entirely left of the viewport — it must NOT count as visible, or the
    // fallback would never appear and the board would be unreachable.
    withRect(button, { width: 220, height: 40, left: -240, top: 0 })
    expect(entryVisible(button)).toBe(false)
    button.remove()
  })

  it('fallbackWanted is the exact negation of row visibility', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const visible = document.createElement('button')
    withRect(visible, { width: 40, height: 20 })
    host.appendChild(visible)
    expect(fallbackWanted(visible)).toBe(false)
    expect(fallbackWanted(undefined)).toBe(true)
    const detached = document.createElement('button')
    expect(fallbackWanted(detached)).toBe(true)
    visible.remove()
  })
})
