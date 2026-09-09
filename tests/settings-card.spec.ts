/**
 * Settings-card version readout: the deployed bundle answers "am I on the
 * latest build?" where the user already looks when something looks stale —
 * a muted `v{version}` beside the card name (same line, never a second
 * row), fed by package.json through TaskBoardSettingsCard (no hand-typed
 * duplicate to drift).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const chromePath = fileURLToPath(new URL('../src/client/PluginSettingsCard.tsx', import.meta.url))
const cardPath = fileURLToPath(new URL('../src/client/TaskBoardSettingsCard.tsx', import.meta.url))
const cssPath = fileURLToPath(new URL('../src/client/settings-card.module.css', import.meta.url))
const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))

describe('settings-card version readout', () => {
  it('the chrome renders an optional muted version beside the name', () => {
    const chrome = readFileSync(chromePath, 'utf8')
    expect(chrome).toMatch(/version\?: string/)
    expect(chrome).toMatch(/css\.version/)
    expect(chrome).toMatch(/>v\{props\.version\}</)
    const css = readFileSync(cssPath, 'utf8')
    expect(css).toMatch(/\.version\s*\{[^}]*font-size:\s*12px/)
  })

  it('the task-board card feeds package.json (single source, never re-typed)', () => {
    const card = readFileSync(cardPath, 'utf8')
    expect(card).toMatch(/from '\.\.\/\.\.\/package\.json'/)
    expect(card).toMatch(/version=\{.*\.version/)
    const version = (JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string }).version
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
