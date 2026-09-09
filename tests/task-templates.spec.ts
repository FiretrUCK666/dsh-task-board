/**
 * Task templates (core/task-templates.ts + controller library methods):
 * snapshot strips instance state, instantiation stamps a fresh backlog card,
 * names dedupe, unknown ids are no-ops.
 */
import { describe, expect, it } from 'vitest'
import {
  LocalStorageTemplateStore,
  normalizeTemplates,
  templateFromTask,
  templateToNewInput,
} from '../src/core/task-templates.ts'
import { createTask } from '../src/core/tasks.ts'
import { BoardController } from '../src/core/controller.ts'

const NOW = 1_700_000_000_000

function sourceTask() {
  return {
    ...createTask({ title: 'Source', description: 'desc', prompt: 'do it' }, NOW, 'src-1'),
    binds: [{ kind: 'session' as const, sessionId: 's-1' }],
    executions: [{ id: 'e1', startedAt: NOW } as never],
  }
}

describe('templateFromTask', () => {
  it('keeps content + run config, strips instance state, names sanely', () => {
    const task = { ...sourceTask(), provider: 'p', model: 'm' }
    const template = templateFromTask(task, 't-1', '  ')
    // Blank name falls back to the task title.
    expect(template.name).toBe('Source')
    expect(template.prompt).toBe('do it')
    expect(template.provider).toBe('p')
    // No instance surface survives typing (binds/executions are not fields).
    expect((template as unknown as Record<string, unknown>).binds).toBeUndefined()
    expect((template as unknown as Record<string, unknown>).executions).toBeUndefined()
    const named = templateFromTask(task, 't-2', 'Custom')
    expect(named.name).toBe('Custom')
    const untitled = templateFromTask({ ...task, title: '  ' }, 't-3', '')
    expect(untitled.name).toBe('Untitled template')
  })
})

describe('templateToNewInput', () => {
  it('stamps a backlog input (schedule/rules never ride)', () => {
    const template = templateFromTask(sourceTask(), 't-1', 'T')
    const input = templateToNewInput(template)
    expect(input.status).toBe('backlog')
    expect(input.title).toBe('Source')
    expect(input.prompt).toBe('do it')
  })

  it('carries the inert shape (due/priority/labels/color ride, armed never)', () => {
    const task = {
      ...sourceTask(),
      dueAt: 1_700_000_000_000,
      priority: 1 as const,
      labels: ['a', 'b'],
      color: '#fff',
    }
    const template = templateFromTask(task, 't-1', 'T')
    expect(template.dueAt).toBe(1_700_000_000_000)
    expect(template.priority).toBe(1)
    expect(template.labels).toEqual(['a', 'b'])
    expect(template.color).toBe('#fff')
    const input = templateToNewInput(template)
    expect(input.dueAt).toBe(1_700_000_000_000)
    expect(input.priority).toBe(1)
    expect(input.labels).toEqual(['a', 'b'])
    expect(input.color).toBe('#fff')
  })

  it('normalizes junk inert fields to absent (legacy templates stay valid)', () => {
    const rows = normalizeTemplates([
      { id: 'a', name: 'A', title: 'x', dueAt: 'soon', priority: 9, labels: 'urgent', color: '' },
    ])
    expect(rows[0]?.dueAt).toBeUndefined()
    expect(rows[0]?.priority).toBeUndefined()
    expect(rows[0]?.labels).toBeUndefined()
    expect(rows[0]?.color).toBeUndefined()
  })

  it('carries both attachment lanes (images + files ride, never one silently)', () => {
    const task = {
      ...sourceTask(),
      promptImages: [{ mediaType: 'image/webp', data: 'QUJD', name: 'a.webp' }] as never,
      promptFiles: [{ receiptId: 'r1', name: 'a.pdf', bytes: 10 }],
    }
    const template = templateFromTask(task as never, 't-1', 'T')
    expect(template.promptImages).toEqual([{ mediaType: 'image/webp', data: 'QUJD', name: 'a.webp' }])
    expect(template.promptFiles).toEqual([{ receiptId: 'r1', name: 'a.pdf', bytes: 10 }])
    const input = templateToNewInput(template)
    expect(input.promptImages).toEqual([{ mediaType: 'image/webp', data: 'QUJD', name: 'a.webp' }])
    expect(input.promptFiles).toEqual([{ receiptId: 'r1', name: 'a.pdf', bytes: 10 }])
  })

  it('washes dirty attachments at normalize (no stamping crash)', () => {
    const rows = normalizeTemplates([
      { id: 'a', name: 'A', title: 'x', promptImages: [null, { data: '', mediaType: 'image/png' }], promptFiles: [{ name: 'x' }] },
    ])
    expect(rows[0]?.promptImages).toBeUndefined()
    expect(rows[0]?.promptFiles).toBeUndefined()
  })
})

describe('normalizeTemplates', () => {
  it('keeps valid rows, drops garbage and duplicate ids', () => {
    const rows = normalizeTemplates([
      { id: 'a', name: 'A', title: 'x' },
      { id: '', name: 'NoId' },
      { id: 'a', name: 'Dupe' },
      'garbage',
      null,
    ])
    expect(rows.map(row => row.id)).toEqual(['a'])
    expect(rows[0]?.description).toBe('')
    expect(normalizeTemplates(undefined)).toEqual([])
  })
})

describe('LocalStorageTemplateStore', () => {
  it('loads empty without storage and round-trips through save', () => {
    const store = new LocalStorageTemplateStore()
    // No localStorage in this environment: load degrades empty, save is silent.
    expect(store.load()).toEqual([])
    const template = templateFromTask(sourceTask(), 't-9', 'Nine')
    expect(() => { store.save([template]) }).not.toThrow()
  })
})

describe('controller template library', () => {
  function controllerWith(templates: { id: string; name: string }[] = []) {
    const store = {
      rows: templates.map(template => ({ ...templateFromTask(sourceTask(), template.id, template.name) })),
      load(): never[] { return [] },
      save(): void {},
      clear(): void {},
    }
    const templateStore = {
      rows: store.rows,
      load: () => [...store.rows],
      save: (next: readonly never[]) => { store.rows = [...next] as typeof store.rows },
    }
    const sessions = {
      list: {
        getSnapshot: () => ({ current: undefined, byId: {} }),
        subscribe: () => () => {},
      },
      exists: () => false,
      open: () => {},
    }
    const controller = new BoardController({
      store: store as never,
      exec: {} as never,
      sessions: sessions as never,
      templateStore: templateStore as never,
      now: () => NOW,
      uuid: (() => { let n = 0; return () => `u-${++n}` })(),
    })
    controller.start()
    return { controller, templateStore }
  }

  it('saveTemplate snapshots content, dedupes names, and lists', () => {
    const { controller } = controllerWith()
    const created = controller.createTask({ title: 'Alpha', description: 'd', prompt: 'p' })!
    const first = controller.saveTemplate(created.id, 'Starter')!
    const second = controller.saveTemplate(created.id, 'Starter')!
    expect(first.name).toBe('Starter')
    expect(second.name).toBe('Starter 2')
    expect(controller.listTemplates().map(template => template.name)).toEqual(['Starter', 'Starter 2'])
    // Instance state never rides along.
    expect((first as unknown as Record<string, unknown>).binds).toBeUndefined()
  })

  it('saveTemplate of an unknown task is undefined (no phantom template)', () => {
    const { controller } = controllerWith()
    expect(controller.saveTemplate('nope', 'X')).toBeUndefined()
    expect(controller.listTemplates()).toEqual([])
  })

  it('instantiateTemplate stamps a fresh backlog card; unknown id is undefined', () => {
    const { controller } = controllerWith([{ id: 'tpl-1', name: 'T' }])
    expect(controller.instantiateTemplate('nope')).toBeUndefined()
    const stamped = controller.instantiateTemplate('tpl-1')!
    expect(stamped.status).toBe('backlog')
    expect(stamped.title).toBe('Source')
    expect(stamped.id).not.toBe('tpl-1')
    expect(controller.getSnapshot().tasks.map(task => task.id)).toContain(stamped.id)
  })

  it('instantiateTemplate supplements a blank head (births complete)', () => {
    const { controller, templateStore } = controllerWith()
    // A template carrying a blank head + prompt (e.g. saved before birth
    // supplement existed) still stamps a complete card — instantiate is a
    // birth door, not an edit door.
    templateStore.rows.push({
      ...templateFromTask(sourceTask(), 't-blank', 'Blank'),
      title: '',
      description: '',
      prompt: '画一只猫\n并解释配色',
    })
    const stamped = controller.instantiateTemplate('t-blank')!
    expect(stamped.title).toBe('画一只猫')
    expect(stamped.description).toBe('画一只猫\n并解释配色')
  })

  it('deleteTemplate removes by id; unknown id is a false no-op', () => {
    const { controller } = controllerWith([{ id: 'tpl-1', name: 'T' }])
    expect(controller.deleteTemplate('nope')).toBe(false)
    expect(controller.deleteTemplate('tpl-1')).toBe(true)
    expect(controller.listTemplates()).toEqual([])
  })
})
