/**
 * Contract tests for the host loader entry: what `apply` registers, and the
 * absences that are easy to undo by accident — no `Config` schema (every
 * behavior this plugin has is already the user's own choice in the UI) and no
 * loader event subscriptions while registering.
 *
 * The system-prompt fact CHANGED with the agent surface and the test says so:
 * the plugin now contributes exactly ONE section, with fixed text, and only
 * when the host composes the service. What must stay true is the shape of that
 * contribution — one section, not a system-prompt override, and never one that
 * interpolates live state (a per-turn prompt change busts the cache for every
 * conversation that carries it).
 */
import { describe, expect, it } from 'vitest'
import * as host from '../src/index.ts'
import * as agent from '../src/host-agent.ts'
import { apply } from '../src/index.ts'
import { apply as applyAgent } from '../src/host-agent.ts'
import { PROMPT_SECTION_NAME, PROMPT_SECTION_TEXT } from '../src/host/agent/prompt.ts'

/** A context double recording what the entry registers and what it reaches for. */
function fakeCtx() {
  const registrations: string[] = []
  const reached: string[] = []
  const ctx = {
    effect: (fn: () => unknown) => {
      const disposer = fn()
      registrations.push('effect')
      return typeof disposer === 'function' ? disposer : () => undefined
    },
    on: (name: string) => { reached.push(`on:${name}`); return () => undefined },
    get: (name: string) => { reached.push(`get:${name}`); return undefined },
    systemPrompt: { section: () => { reached.push('systemPrompt.section'); return () => undefined } },
  }
  return { ctx, registrations, reached }
}

describe('host entry apply', () => {
  it('registers one effect per host surface and nothing else', () => {
    const fake = fakeCtx()
    expect(() => apply(fake.ctx as never)).not.toThrow()
    // The package row carries five routes: permissions, session state, board,
    // update, page self-report. The model's surface is NOT here any more — it
    // is its own row, so the plugin page can switch it off by never loading
    // this file's sibling rather than by a check that could be forgotten.
    expect(fake.registrations.filter(r => r === 'effect')).toHaveLength(5)
    expect(host.inject).toEqual(['webServer'])
  })

  it('keeps the model surface in a row of its own, declared with its three services', () => {
    // The whole surface travels together: half a surface is worse than none, and
    // a deployment that composes none of the three must wait on none of them.
    expect(agent.inject).toEqual(['tools', 'commands', 'systemPrompt'])
  })

  it('carries no config schema', () => {
    // The enable switch lives in the profile row, not in a schema: the plugin
    // manager writes `disabled` and the loader acts on it. A schema here would
    // re-introduce a settings form for something that has no per-plugin option.
    expect('Config' in host).toBe(false)
    expect(Object.keys(host).filter(key => key.toLowerCase().includes('config'))).toEqual([])
  })

  it('contributes exactly ONE fixed system-prompt section, and only if the host has one', () => {
    // The host composes none of the three services in this double, so the whole
    // surface stays off: a half-registered agent surface is worse than none.
    const without = fakeCtx()
    applyAgent(without.ctx as never)
    expect(without.reached).not.toContain('systemPrompt.section')

    // With the service present: one section, fixed text, and not a `complete`
    // override (which would replace the deployment's whole prompt).
    const withPrompt = fakeCtx()
    const sections: { name: string; text: string; complete?: boolean }[] = []
    const ctx = { ...withPrompt.ctx, get: (name: string) => (name === 'systemPrompt' ? { section: (s: never) => { sections.push(s); return () => undefined } } : undefined) }
    applyAgent(ctx as never)
    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe(PROMPT_SECTION_NAME)
    expect(sections[0]?.text).toBe(PROMPT_SECTION_TEXT)
    expect(sections[0]?.complete).toBeUndefined()
  })

  it('subscribes to no loader event while registering', () => {
    // Routes resolve their services lazily inside their own register function;
    // apply itself is a pure registration pass with nothing to re-derive.
    const fake = fakeCtx()
    apply(fake.ctx as never)
    expect(fake.reached.filter(entry => entry.startsWith('on:'))).toEqual([])
  })
})
