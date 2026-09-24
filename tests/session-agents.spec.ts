/**
 * Agent-preset identity and applied-ledger contract: display-name resolution,
 * record/query/normalize, failures never recorded, Host projection wins.
 */
import { describe, expect, it } from 'vitest'
import { BoardController } from '../src/core/controller.ts'
import {
  agentPresetLabelOf,
  agentPresetNameOf,
  appliedOf,
  appliedPresetOf,
  LocalStorageSessionAgentStore,
  normalizeLedger,
  recordApplied,
} from '../src/core/session-agents.ts'

describe('recordApplied / appliedOf', () => {
  it('records the applied preset; later applications win', () => {
    const first = recordApplied({}, 's-1', 'preset-a', 100)
    expect(appliedOf(first, 's-1')).toBe('preset-a')
    const second = recordApplied(first, 's-1', 'preset-b', 200)
    expect(appliedOf(second, 's-1')).toBe('preset-b')
    expect(appliedOf(second, 's-unknown')).toBeUndefined()
  })

  it('blank presets are never recorded (nothing applied, nothing claimed)', () => {
    expect(recordApplied({}, 's-1', '   ', 100)).toEqual({})
  })
})

describe('Agent preset labels', () => {
  const roster = [
    { id: 'space-bunny', name: 'Space Bunny' },
    { id: 'butler', name: '' },
  ]

  it('resolves the applied id to the selected Agent name', () => {
    expect(agentPresetLabelOf('space-bunny', roster)).toBe('Space Bunny')
    expect(agentPresetLabelOf('butler', roster)).toBe('butler')
  })

  it('keeps an unknown id visible and treats no selection as no label', () => {
    expect(agentPresetLabelOf('custom-agent', roster)).toBe('custom-agent')
    expect(agentPresetLabelOf(undefined, roster)).toBeUndefined()
    expect(agentPresetLabelOf('', roster)).toBeUndefined()
  })

  it('uses the same published-name-or-id rule for roster rows', () => {
    expect(agentPresetNameOf({ id: 'named', name: 'Named Agent' })).toBe('Named Agent')
    expect(agentPresetNameOf({ id: 'fallback' })).toBe('fallback')
  })
})

describe('normalizeLedger', () => {
  it('keeps string presets, drops garbage', () => {
    expect(normalizeLedger({
      's-1': { preset: 'p', at: 5 },
      's-2': { preset: '', at: 5 },
      's-3': { preset: 42 },
      's-4': 'nope',
    })).toEqual({ 's-1': { preset: 'p', at: 5 } })
    expect(normalizeLedger(undefined)).toEqual({})
    expect(normalizeLedger([])).toEqual({})
  })
})

describe('appliedPresetOf', () => {
  it('undefined store is unknown (never a throw)', () => {
    expect(appliedPresetOf(undefined, 's-1')).toBeUndefined()
  })

  it('reads through the store', () => {
    const store = {
      rows: { 's-1': { preset: 'p', at: 1 } },
      load() { return { ...this.rows } },
      save() {},
    }
    expect(appliedPresetOf(store, 's-1')).toBe('p')
    expect(appliedPresetOf(store, 's-x')).toBeUndefined()
  })
})

describe('LocalStorageSessionAgentStore', () => {
  it('loads empty without storage and saves silently', () => {
    const store = new LocalStorageSessionAgentStore()
    // No localStorage in this environment: load degrades empty, save is silent.
    expect(store.load()).toEqual({})
    expect(() => { store.save({ 's-1': { preset: 'p', at: 1 } }) }).not.toThrow()
  })
})

describe('controller sessionInfo (display truth order)', () => {
  function controllerWith(byId: Record<string, Record<string, unknown>>, ledger: Record<string, { preset: string; at: number }>) {
    const store = {
      load: (): never[] => [],
      save: (): void => {},
      clear: (): void => {},
    }
    const sessions = {
      list: {
        getSnapshot: () => ({ current: undefined, byId }),
        subscribe: () => () => {},
      },
      exists: () => false,
      open: () => {},
    }
    const controller = new BoardController({
      store: store as never,
      exec: {} as never,
      sessions: sessions as never,
      sessionAgentStore: { load: () => ({ ...ledger }), save: () => {} },
      now: () => 1_700_000_000_000,
      uuid: () => 'u-1',
    })
    controller.start()
    return controller
  }

  it('falls back to the applied ledger when the host does not project a preset', () => {
    const controller = controllerWith(
      { 's-1': { running: false } },
      { 's-1': { preset: 'butler', at: 1 } },
    )
    expect(controller.sessionInfo('s-1')).toMatchObject({ agentPreset: 'butler' })
  })

  it('uses the host projection as the authoritative applied id', () => {
    const controller = controllerWith(
      { 's-1': { running: false, projectionValues: { agentPreset: 'space-bunny' } } },
      { 's-1': { preset: 'butler', at: 1 } },
    )
    expect(controller.sessionInfo('s-1')).toMatchObject({ agentPreset: 'space-bunny' })
  })

  it('an explicit null projection means deployment default, not a stale ledger value', () => {
    const controller = controllerWith(
      { 's-1': { running: false, projectionValues: { agentPreset: null } } },
      { 's-1': { preset: 'butler', at: 1 } },
    )
    expect(controller.sessionInfo('s-1')).not.toHaveProperty('agentPreset')
  })

  it('unknown sessions stay unknown (honest 部署默认, never a guess)', () => {
    const controller = controllerWith({ 's-1': { running: false } }, {})
    expect(controller.sessionInfo('s-1')).not.toHaveProperty('agentPreset')
    expect(controller.sessionInfo('gone')).toBeUndefined()
    expect(controller.sessionInfo(undefined)).toBeUndefined()
  })
})
