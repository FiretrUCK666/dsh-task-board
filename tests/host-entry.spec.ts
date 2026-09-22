/**
 * Contract tests for the host loader entry: what `apply` registers, and how a
 * volatile config field is read. The volatile shape is the load-bearing part —
 * a volatile field resolves to a live reference, so a direct comparison reads
 * "always truthy" and the master switch would never turn off.
 */
import { describe, expect, it, vi } from 'vitest'
import { apply, ConfigSchema } from '../src/index.ts'

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
    // Six routes plus the settings page policy: one effect per route.
    expect(host.registrations.filter(r => r === 'effect')).toHaveLength(6)
    expect(host.registrations).toContain('inject:settings')
    expect(host.sections()).toBe(1)
    expect(host.events).toContain('loader/volatile-update')
    expect(host.configureCalls()).toBe(1)
  })

  it('reads a volatile field through its live reference instead of comparing the object', () => {
    const off = fakeCtx()
    apply(off.ctx as never, { enabled: volatileRef(false), announceToAgent: volatileRef(true) } as never)
    expect(off.sections()).toBe(0)

    const silent = fakeCtx()
    apply(silent.ctx as never, { enabled: volatileRef(true), announceToAgent: volatileRef(false) } as never)
    expect(silent.sections()).toBe(0)

    const on = fakeCtx()
    apply(on.ctx as never, { enabled: volatileRef(true), announceToAgent: volatileRef(true) } as never)
    expect(on.sections()).toBe(1)
  })

  it('accepts a plain config object so a hand-built context never reads as disabled', () => {
    const host = fakeCtx()
    apply(host.ctx as never, { enabled: true, announceToAgent: true } as never)
    expect(host.sections()).toBe(1)
  })

  it('declares a volatile schema field, which is what makes the entry configurable', () => {
    // Read the live schema, not its JSON projection: the serialized form strips
    // the volatile marker (it is a runtime-only concern), so a JSON assertion
    // here would pass on a schema the settings surface quietly skips.
    const live = ConfigSchema as unknown as { dict: Record<string, { meta?: { volatile?: boolean } }> }
    const fields = Object.entries(live.dict ?? {})
    expect(fields.filter(([, node]) => node.meta?.volatile === true).map(([key]) => key).sort())
      .toEqual(['announceToAgent', 'enabled'])
  })

  it('never calls the removed namespace-registration API', () => {
    const spy = vi.fn()
    const host = fakeCtx()
    ;(host.ctx as Record<string, unknown>).settings = { installSection: spy }
    apply(host.ctx as never, {} as never)
    expect(spy).not.toHaveBeenCalled()
  })
})
