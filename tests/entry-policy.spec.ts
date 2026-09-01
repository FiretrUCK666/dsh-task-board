// @vitest-environment jsdom
/**
 * Entry display policy contract: visibility is the ONLY input to the
 * one-entry decision (row visible = row wins; anything else = fallback).
 * A row that is connected but hidden or detached must never count as the
 * entry — that is precisely the mobile "board button vanished" failure.
 */
import { describe, expect, it } from 'vitest'
import { entryVisible, fallbackWanted } from '../src/client/entry-policy.ts'

describe('entry policy', () => {
  it('entryVisible rejects detached elements', () => {
    const detached = document.createElement('button')
    expect(entryVisible(detached)).toBe(false)
  })

  it('entryVisible accepts a connected element with layout boxes', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const button = document.createElement('button')
    host.appendChild(button)
    // jsdom has no layout engine: getClientRects always returns []. The
    // browser contract is layout boxes — stub the measurement the same way
    // a real element would report them.
    Object.defineProperty(button, 'getClientRects', { value: () => [{ width: 40, height: 20 } as unknown as DOMRect] })
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
    expect(entryVisible(button)).toBe(false)
    button.remove()
  })

  it('fallbackWanted is the exact negation of row visibility', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const visible = document.createElement('button')
    Object.defineProperty(visible, 'getClientRects', { value: () => [{ width: 40, height: 20 } as unknown as DOMRect] })
    host.appendChild(visible)
    expect(fallbackWanted(visible)).toBe(false)
    expect(fallbackWanted(undefined)).toBe(true)
    const detached = document.createElement('button')
    expect(fallbackWanted(detached)).toBe(true)
    visible.remove()
  })
})
