// Prove the new assertion is falsifiable: a selector the sheet has not got
// must make the same `toMatch` fail. This is the "prove the gate goes red"
// step, kept out of the real files (hard rule 16).
import { describe, expect, it } from 'vitest'

function ruleOf(source: string, name: string): string {
  const at = source.indexOf(`.${name} {`)
  if (at < 0) return ''
  const end = source.indexOf('}', at)
  return source.slice(at, end < 0 ? undefined : end)
}

const sheet = '.feedSection {\n  border-top: var(--dsh-tb-border-soft);\n}\n.feedSection:first-child {\n  border-top: none;\n}\n'

describe('the first-child assertion can fail', () => {
  it('passes when the rule is present', () => {
    const rule = ruleOf(sheet, 'feedSection:first-child')
    expect(rule).toMatch(/border-top:\s*none/)
  })

  it('fails when the rule is absent', () => {
    const rule = ruleOf(sheet, 'feedSection:nonexistent')
    expect(rule).toBe('')
    expect(() => expect(rule).toMatch(/border-top:\s*none/)).toThrow()
  })

  it('fails when the rule is present but the line came back', () => {
    const bad = '.feedSection:first-child {\n  border-top: var(--dsh-tb-border-soft);\n}\n'
    const rule = ruleOf(bad, 'feedSection:first-child')
    expect(() => expect(rule).toMatch(/border-top:\s*none/)).toThrow()
  })
})
