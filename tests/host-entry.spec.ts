/**
 * Contract tests for the host loader entry: what `apply` registers, and the two
 * absences that are easy to undo by accident — no `Config` schema (every
 * behavior this plugin has is already the user's own choice in the UI) and no
 * system-prompt announcement (a plugin that silently writes into other people's
 * prompts is not a plugin).
 */
import { describe, expect, it } from 'vitest'
import * as host from '../src/index.ts'
import { apply } from '../src/index.ts'

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
  it('registers one effect per host route and nothing else', () => {
    const fake = fakeCtx()
    expect(() => apply(fake.ctx as never)).not.toThrow()
    // permissions, session state, board, update, page self-report.
    expect(fake.registrations.filter(r => r === 'effect')).toHaveLength(5)
  })

  it('carries no config schema', () => {
    // The enable switch lives in the profile row, not in a schema: the plugin
    // manager writes `disabled` and the loader acts on it. A schema here would
    // re-introduce a settings form for something that has no per-plugin option.
    expect('Config' in host).toBe(false)
    expect(Object.keys(host).filter(key => key.toLowerCase().includes('config'))).toEqual([])
  })

  it('never announces itself in a system prompt', () => {
    // Importing the system-prompt service at all is how the announcement used
    // to come back, so both halves of that fact are pinned.
    expect(host.inject).toEqual(['webServer'])
    const fake = fakeCtx()
    apply(fake.ctx as never)
    expect(fake.reached).not.toContain('systemPrompt.section')
  })

  it('subscribes to no loader event while registering', () => {
    // Routes resolve their services lazily inside their own register function;
    // apply itself is a pure registration pass with nothing to re-derive.
    const fake = fakeCtx()
    apply(fake.ctx as never)
    expect(fake.reached.filter(entry => entry.startsWith('on:'))).toEqual([])
  })
})
