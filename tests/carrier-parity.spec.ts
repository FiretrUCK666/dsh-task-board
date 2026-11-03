/**
 * verify-carrier-parity — 三端相等，以及「读不到就红」。
 *
 * 这一条守的不是一条规则，是一个**曾经静默失效的承诺**：宿主发
 * `session.create`，浏览器那一侧没有这一支，命令被丢掉，而回执说「已生效」。
 *
 * 所以这里的用例分两组，缺一不可：
 *
 *  · **三个源真的相等时是安静的**——否则门禁会被关掉；
 *  · **三端任何一个缺一项都报红**——否则「通过」只是一个没有读输入的巧合。
 *
 * 第二组每条都断言**具体的那句话**，因为报红但说错位置的检查，读者还得自己去
 * 找是哪个载具——而找的那一步就是下一个人放弃的地方。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { carrierListOf, carrierParityFindings, dispatchKeysOf, unionCarriersOf } from '../scripts/verify-carrier-parity.mjs'

/** The real files, read once: the quiet case must be judged on the real tree. */
function realFiles() {
  const root = process.cwd()
  const doc = readFileSync(join(root, 'src/core/board-doc.ts'), 'utf8')
  const client = readFileSync(join(root, 'src/client/index.ts'), 'utf8')
  return { listText: doc, unionText: doc, dispatchText: client }
}

describe('the readers read structure, not words', () => {
  it('reads the declared carrier list out of an array literal', () => {
    expect(carrierListOf("export const BOARD_COMMAND_CARRIERS = ['a', 'b.c'] as const", 'BOARD_COMMAND_CARRIERS')).toEqual(['a', 'b.c'])
  })

  it('reads the union&#39;s type literals and stops at the union', () => {
    const text = "export type BoardCommand =\n  | { type: 'a'; x: string }\n  | { type: 'b'; y: string }\n\nexport const after = 1\n"
    expect(unionCarriersOf(text)).toEqual(['a', 'b'])
  })

  it('does not mistake the alias above the union for the union', () => {
    /* `export type BoardCommandCarrier` starts with the same characters as
     * `export type BoardCommand`. A prefix search lands on the alias, reads no
     * members, and reports the union as unreadable — a false RED, which is how
     * a gate gets switched off. */
    const text = "export type BoardCommandCarrier = string\nexport type BoardCommand =\n  | { type: 'a'; x: string }\n"
    expect(unionCarriersOf(text)).toEqual(['a'])
  })

  it('reads quoted keys that are not identifiers', () => {
    /* `'session.create'` has a dot. A key pattern restricted to `[\w$]` reads
     * half a dispatch table and reports the other half as carriers with no
     * performer. */
    const text = "const commandDoors: Record<string, unknown> = {\n  run: c => {},\n  'session.create': c => {},\n}\n"
    expect(dispatchKeysOf(text, 'commandDoors')).toEqual(['run', 'session.create'])
  })

  it('does not read a nested object&#39;s keys as dispatch keys', () => {
    const text = "const commandDoors: Record<string, unknown> = {\n  run: c => { return { nested: 1 } },\n}\n"
    expect(dispatchKeysOf(text, 'commandDoors')).toEqual(['run'])
  })
})

describe('the real repository is quiet', () => {
  it('passes on the three real sources', () => {
    // If this fails, either the gate is wrong or the product really drifted —
    // and drift here means a command the host can build and the browser cannot
    // perform, which is the silent lie this gate exists for.
    expect(carrierParityFindings(realFiles())).toEqual([])
  })
})

describe('every missing end is a finding, and it says which carrier', () => {
  const agreed = {
    listText: "export const BOARD_COMMAND_CARRIERS = ['run', 'session.create'] as const\nexport type BoardCommand =\n  | { type: 'run'; taskId: string }\n  | { type: 'session.create'; taskId: string }\n",
    dispatchText: 'const commandDoors: Record<string, unknown> = {\n  run: c => {},\n  \'session.create\': c => {},\n}\n',
  }

  it('is quiet when all three agree', () => {
    expect(carrierParityFindings({ ...agreed, unionText: agreed.listText })).toEqual([])
  })

  it('catches a carrier with no door in the browser', () => {
    const out = carrierParityFindings({
      ...agreed,
      unionText: agreed.listText,
      dispatchText: 'const commandDoors: Record<string, unknown> = {\n  run: c => {},\n}\n',
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('"session.create" has no branch')
  })

  it('catches a door with no carrier behind it', () => {
    const out = carrierParityFindings({
      ...agreed,
      unionText: agreed.listText,
      dispatchText: 'const commandDoors: Record<string, unknown> = {\n  run: c => {},\n  \'session.rename\': c => {},\n}\n',
    })
    // Two findings: the union member without a door, and the door without a
    // carrier. Both are real and both name a different repair.
    expect(out.some(finding => finding.includes('"session.rename"') && finding.includes('can never be reached'))).toBe(true)
  })

  it('catches a union member the declared list forgot', () => {
    const out = carrierParityFindings({
      ...agreed,
      listText: "export const BOARD_COMMAND_CARRIERS = ['run'] as const\nexport type BoardCommand =\n  | { type: 'run'; taskId: string }\n  | { type: 'session.create'; taskId: string }\n",
      unionText: "export const BOARD_COMMAND_CARRIERS = ['run'] as const\nexport type BoardCommand =\n  | { type: 'run'; taskId: string }\n  | { type: 'session.create'; taskId: string }\n",
    })
    expect(out.some(finding => finding.includes('BOARD_COMMAND_CARRIERS does not list it'))).toBe(true)
  })

  it('catches a declared name the union cannot build', () => {
    const out = carrierParityFindings({
      ...agreed,
      listText: "export const BOARD_COMMAND_CARRIERS = ['run', 'session.create', 'ghost'] as const\nexport type BoardCommand =\n  | { type: 'run'; taskId: string }\n  | { type: 'session.create'; taskId: string }\n",
      unionText: "export const BOARD_COMMAND_CARRIERS = ['run', 'session.create', 'ghost'] as const\nexport type BoardCommand =\n  | { type: 'run'; taskId: string }\n  | { type: 'session.create'; taskId: string }\n",
    })
    expect(out.some(finding => finding.includes('declares "ghost"') && finding.includes('has no '))).toBe(true)
  })
})

describe('an unreadable input is a finding, never a quiet pass', () => {
  it('reports a missing carrier list', () => {
    const out = carrierParityFindings({ listText: 'export const nothing = 1\n', unionText: 'export const nothing = 1\n', dispatchText: 'const commandDoors = { run: 1 }\n' })
    expect(out.some(finding => finding.includes('cannot read BOARD_COMMAND_CARRIERS'))).toBe(true)
  })

  it('reports a missing union', () => {
    const out = carrierParityFindings({
      listText: "export const BOARD_COMMAND_CARRIERS = ['run'] as const\n",
      unionText: "export const BOARD_COMMAND_CARRIERS = ['run'] as const\n",
      dispatchText: 'const commandDoors = { run: 1 }\n',
    })
    expect(out.some(finding => finding.includes('cannot read the carrier variants'))).toBe(true)
  })

  it('reports a missing dispatch table', () => {
    const out = carrierParityFindings({
      listText: "export const BOARD_COMMAND_CARRIERS = ['run'] as const\nexport type BoardCommand =\n  | { type: 'run'; taskId: string }\n",
      unionText: "export const BOARD_COMMAND_CARRIERS = ['run'] as const\nexport type BoardCommand =\n  | { type: 'run'; taskId: string }\n",
      dispatchText: 'export const nothing = 1\n',
    })
    expect(out.some(finding => finding.includes('cannot read the browser dispatch table'))).toBe(true)
  })
})
