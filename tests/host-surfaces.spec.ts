/**
 * Which surfaces the plugin's own rows are switched on for
 * (src/host/surfaces.ts), and the ONE list they all read (src/core/surfaces.ts).
 *
 * The manifest used to be written out by hand, once per half: the host's had
 * five surfaces and the browser's had four (it was missing `agent`), so the
 * browser never narrowed that surface away and nothing said why. Now the list
 * is one list, and the manifest is DERIVED from it — a surface added to the
 * list cannot go missing from the answer.
 */
import { describe, expect, it } from 'vitest'
import { SURFACE_IDS } from '../src/core/surfaces.ts'
import { markSurfaceActive, surfaceManifest } from '../src/host/surfaces.ts'

describe('the surface list', () => {
  it('is one list, and the manifest answers for every one of its ids', () => {
    const manifest = surfaceManifest()
    for (const id of SURFACE_IDS) {
      expect(typeof manifest[id], `${id} must be answered`).toBe('boolean')
    }
    expect(Object.keys(manifest).sort()).toEqual([...SURFACE_IDS].sort())
  })

  it('the agent surface is IN the list (it used to be missing on one side)', () => {
    expect(SURFACE_IDS).toContain('agent')
  })
})

describe('markSurfaceActive', () => {
  it('turns on exactly the surface whose row was loaded', () => {
    const before = surfaceManifest()
    markSurfaceActive('design')
    const after = surfaceManifest()
    expect(after.design).toBe(true)
    // Every other answer is untouched: a row announcing itself says nothing
    // about the rows that did not.
    for (const id of SURFACE_IDS) {
      if (id === 'design') continue
      expect(after[id]).toBe(before[id])
    }
  })
})
