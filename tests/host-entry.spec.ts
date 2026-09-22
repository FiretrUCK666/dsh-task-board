/**
 * Contract tests for the host loader entry: what `apply` registers, and the two
 * facts that decide whether the entry keeps a settings page at all — the schema
 * binding's name and its volatile field. Both fail SILENTLY in production: the
 * plugin keeps loading and every route keeps registering while the settings
 * surface quietly drops the page, so they are pinned here rather than left to
 * inspection.
 */
import { describe, expect, it } from 'vitest'
import { apply, Config } from '../src/index.ts'

/** A context double recording what the entry registers. */
function fakeCtx() {
  const registrations: string[] = []
  const ctx = {
    effect: (fn: () => unknown) => {
      const disposer = fn()
      registrations.push('effect')
      return typeof disposer === 'function' ? disposer : () => undefined
    },
    get: () => undefined,
  }
  return { ctx, registrations }
}

describe('host entry apply', () => {
  it('registers one effect per host route and nothing else', () => {
    const host = fakeCtx()
    expect(() => apply(host.ctx as never)).not.toThrow()
    // permissions, session state, board, update, page self-report.
    expect(host.registrations.filter(r => r === 'effect')).toHaveLength(5)
  })

  it('reads no config at all: the switch is the browser half\'s business', () => {
    // The board's switch decides whether the BROWSER mounts seats; the host's
    // routes serve whoever asks. Reading the config here would make a hidden
    // board stop answering its own routes, which is how a switch becomes
    // unreachable.
    const host = fakeCtx()
    const looked = { config: 0 }
    const ctx = {
      ...host.ctx,
      get: (name: string) => { if (name === 'settings' || name === 'systemPrompt') looked.config += 1; return undefined },
    }
    apply(ctx as never)
    expect(looked.config).toBe(0)
  })

  it('touches no loader event, because nothing here is derived from config', () => {
    const seen: string[] = []
    const ctx = {
      effect: () => () => undefined,
      on: (name: string) => { seen.push(name); return () => undefined },
      get: () => undefined,
    }
    apply(ctx as never)
    expect(seen).toEqual([])
  })

  it('exports the schema as `Config`, the name the plugin runtime reads', () => {
    // The loader resolves `module.Config`; a renamed binding leaves it with no
    // schema, and the settings surface then drops this entry's page while the
    // plugin keeps loading and every route keeps working. Nothing else fails,
    // which is exactly why the name is asserted rather than assumed.
    const imported = Object.keys({ Config }).filter(key => key.toLowerCase().includes('config'))
    expect(imported).toEqual(['Config'])
    expect(Config).toBeDefined()
  })

  it('declares the board switch as its one volatile field', () => {
    // Read the live schema, not its JSON projection: the serialized form strips
    // the volatile marker (it is a runtime-only concern), so a JSON assertion
    // here would pass on a schema the settings surface quietly skips.
    const live = Config as unknown as { dict: Record<string, { meta?: { volatile?: boolean } }> }
    const fields = Object.entries(live.dict ?? {})
    expect(fields.map(([key]) => key)).toEqual(['boardEnabled'])
    expect(fields.filter(([, node]) => node.meta?.volatile === true).map(([key]) => key)).toEqual(['boardEnabled'])
  })
})
