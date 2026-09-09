/**
 * Command palette model (client/board/commands.ts): six commands reusing
 * existing handlers, multi-term label filter.
 */
import { describe, expect, it } from 'vitest'
import { buildCommands, filterCommands, type PaletteActions } from '../src/client/board/commands.ts'

function actions(overrides: Partial<PaletteActions> = {}): PaletteActions & { calls: string[] } {
  const calls: string[] = []
  const named = (name: string) => () => { calls.push(name) }
  return {
    calls,
    cruiseEnabled: false,
    openNew: named('new'),
    toggleCruise: named('cruise'),
    openOrganize: named('organize'),
    openAutomation: named('automation'),
    openNotify: named('notify'),
    closeBoard: named('close'),
    ...overrides,
  }
}

const t = (key: string): string => key

describe('buildCommands', () => {
  it('lists the six board actions in palette order', () => {
    const commands = buildCommands(t, actions())
    expect(commands.map(command => command.id)).toEqual(['new', 'cruise', 'organize', 'automation', 'notify', 'close'])
  })

  it('the cruise label follows the live state (open vs close)', () => {
    expect(buildCommands(t, actions())[1]?.label).toBe('board.cruiseOn')
    expect(buildCommands(t, actions({ cruiseEnabled: true }))[1]?.label).toBe('board.cruiseOff')
  })

  it('each run fires exactly its own handler', () => {
    const ui = actions()
    const commands = buildCommands(t, ui)
    for (const command of commands) command.run()
    expect(ui.calls).toEqual(['new', 'cruise', 'organize', 'automation', 'notify', 'close'])
  })
})

describe('filterCommands', () => {
  it('blank query keeps the order', () => {
    const commands = buildCommands(t, actions())
    expect(filterCommands(commands, '  ').map(command => command.id)).toHaveLength(6)
  })

  it('multi-term AND narrows (case-insensitive)', () => {
    const commands = buildCommands((key: string) => ({
      'board.new': '新建任务',
      'board.cruiseOn': '开启自动巡航',
      'board.cruiseOff': '关闭自动巡航',
      'board.organize': '整理',
      'board.automation': '自动化',
      'board.notify': '通知',
      'board.close': '返回对话',
    }[key] ?? key), actions())
    expect(filterCommands(commands, '自动').map(command => command.id)).toEqual(['cruise', 'automation'])
    expect(filterCommands(commands, '自动 巡航').map(command => command.id)).toEqual(['cruise'])
    expect(filterCommands(commands, '不存在').map(command => command.id)).toEqual([])
  })
})
