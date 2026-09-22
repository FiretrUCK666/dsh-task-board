/**
 * Contract tests for the host loader entry: what `apply` registers, how a
 * volatile config field is read, and the schema export name the plugin runtime
 * requires. Two of these fail SILENTLY in production — a renamed schema binding
 * and a schema with no volatile field both leave the plugin working while its
 * settings page disappears — so they are pinned here.
 */
import { describe, expect, it, vi } from 'vitest'
import * as host from '../src/index.ts'
import { apply, Config } from '../src/index.ts'

/** A live reference standing in for a schema field marked volatile. */
function volatileRef(value: boolean): { get(): boolean } {
  return { get: () => value }
}

/** A context double recording what the entry registers. */
function fakeCtx() {
  const registrations: string[] = []
  const events: string[] = []
  let sections = 0
  let configureCalls = 0
  const ctx = {
    systemPrompt: {
      section: () => {
        sections += 1
        registrations.push('section')
        return () => { sections -= 1 }
      },
    },
    effect: (fn: () => unknown) => {
      const disposer = fn()
      registrations.push('effect')
      return typeof disposer === 'function' ? disposer : () => undefined
    },
    on: (name: string) => {
      events.push(name)
      return () => undefined
    },
    inject: (deps: readonly string[], cb: (child: Record<string, unknown>) => void) => {
      registrations.push(`inject:${deps.join('+')}`)
      cb({
        effect: (fn: () => unknown) => { fn(); return () => undefined },
        settings: {
          configure: () => { configureCalls += 1; return () => undefined },
        },
      })
    },
    get: () => undefined,
    fiber: {},
  }
  return { ctx, registrations, events, sections: () => sections, configureCalls: () => configureCalls }
}

describe('host entry apply', () => {
  it('registers every route and the announcement without touching a removed settings API', () => {
    const host = fakeCtx()
    expect(() => apply(host.ctx as never, {} as never)).not.toThrow()
    // One effect per route: permissions, session state, board, update, and the
    // page self-report. Nothing here registers a settings route — the plugin
    // manager renders this entry's schema form from the host configuration.
    expect(host.registrations.filter(r => r === 'effect')).toHaveLength(5)
    expect(host.registrations.some(r => r.startsWith('inject:'))).toBe(false)
    expect(host.sections()).toBe(1)
    expect(host.events).toContain('loader/volatile-update')
    expect(host.configureCalls()).toBe(0)
  })

  it('reads a volatile field through its live reference instead of comparing the object', () => {
    const silent = fakeCtx()
    apply(silent.ctx as never, { announceToAgent: volatileRef(false) } as never)
    expect(silent.sections()).toBe(0)

    const on = fakeCtx()
    apply(on.ctx as never, { announceToAgent: volatileRef(true) } as never)
    expect(on.sections()).toBe(1)
  })

  it('accepts a plain config object so a hand-built context never reads as muted', () => {
    const host = fakeCtx()
    apply(host.ctx as never, { announceToAgent: true } as never)
    expect(host.sections()).toBe(1)
  })

  it('exports the schema as `Config`, the name the plugin runtime reads', () => {
    // The loader resolves `module.Config`; a renamed binding leaves it with no
    // schema, and the settings surface then drops this entry's page while the
    // plugin keeps loading and every route keeps working. Nothing else fails,
    // which is exactly why the name is asserted rather than assumed.
    expect(host.Config).toBeDefined()
    const exported = Object.keys(host).filter(key => key.toLowerCase().includes('config'))
    expect(exported).toContain('Config')
    expect(exported.filter(key => key !== 'Config')).toEqual([])
  })

  it('declares a volatile schema field, which is what makes the entry configurable', () => {
    // Read the live schema, not its JSON projection: the serialized form strips
    // the volatile marker (it is a runtime-only concern), so a JSON assertion
    // here would pass on a schema the settings surface quietly skips.
    const live = Config as unknown as { dict: Record<string, { meta?: { volatile?: boolean } }> }
    const fields = Object.entries(live.dict ?? {})
    expect(fields.filter(([, node]) => node.meta?.volatile === true).map(([key]) => key).sort())
      .toEqual(['announceToAgent'])
  })

  it('carries no enable switch of its own', () => {
    // The plugin manager already owns activation for every entry. A second
    // boolean here would be a second truth about the same thing, and the one
    // users would reach for when the board "does not turn off".
    const live = Config as unknown as { dict: Record<string, unknown> }
    expect(Object.keys(live.dict)).toEqual(['announceToAgent'])
  })

  it('never calls the removed namespace-registration API', () => {
    const spy = vi.fn()
    const host = fakeCtx()
    ;(host.ctx as Record<string, unknown>).settings = { installSection: spy }
    apply(host.ctx as never, {} as never)
    expect(spy).not.toHaveBeenCalled()
  })
})
