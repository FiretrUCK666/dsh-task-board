/**
 * Tag system (tags.ts): the label catalog (create/rename/recolor/remove),
 * per-task tag & color mutations, the AND multi-tag filter, and the store
 * normalization of the optional per-task fields. Pure and framework-free.
 */
import { describe, expect, it } from 'vitest'
import { TAG_PALETTE, createTag, normalizeCatalog, recolorTag, removeTag, renameTag, tagById, taskMatchesTags, withTaskColor, withTaskTags, type Tag } from '../src/core/tags.ts'
import { createTask } from '../src/core/tasks.ts'
import { parseLedger } from '../src/core/store.ts'

const NOW = 1_700_000_000_000
const red: Tag = { id: 't-red', name: '紧急', color: '#e5484d' }
const blue: Tag = { id: 't-blue', name: '设计', color: '#3e63dd' }

function task(tags?: string[], color?: string) {
  const base = createTask({ title: 'x', description: '', prompt: '' }, NOW, 'task-1')
  return { ...base, ...(tags !== undefined ? { tags } : {}), ...(color !== undefined ? { color } : {}) }
}

describe('catalog', () => {
  it('normalizeCatalog keeps valid unique rows and drops junk', () => {
    expect(normalizeCatalog(null).length).toBe(0)
    expect(normalizeCatalog('nope').length).toBe(0)
    expect(normalizeCatalog([red, blue, { id: 't-red', name: 'dup', color: '#000' }, { id: '', name: 'x', color: '#000' }, 5, { id: 't-bad', name: 3, color: '#000' }]))
      .toEqual([red, blue])
  })

  it('createTag appends immutably; tagById finds a tag', () => {
    const catalog = createTag([], red)
    const next = createTag(catalog, blue)
    expect(catalog.length).toBe(1)
    expect(next.length).toBe(2)
    expect(tagById(next, 't-blue')).toEqual(blue)
    expect(tagById(next, 'ghost')).toBeUndefined()
  })

  it('renameTag / recolorTag update in place (immutable); unknown id is a no-op', () => {
    expect(renameTag([red], 't-red', '重要')).toEqual([{ ...red, name: '重要' }])
    expect(recolorTag([red], 't-red', '#fff')).toEqual([{ ...red, color: '#fff' }])
    expect(renameTag([red], 'ghost', 'x')).toEqual([red])
  })

  it('removeTag drops the tag; the palette is a stable set of 10 colors', () => {
    expect(removeTag([red, blue], 't-red')).toEqual([blue])
    expect(TAG_PALETTE.length).toBe(10)
  })
})

describe('per-task tag & color', () => {
  it('withTaskTags / withTaskColor set the fields immutably', () => {
    expect(withTaskTags(task(), ['t-red']).tags).toEqual(['t-red'])
    expect(withTaskColor(task(), '#e5484d').color).toBe('#e5484d')
    expect(withTaskColor(withTaskColor(task(), '#e5484d'), undefined).color).toBeUndefined()
  })
})

describe('taskMatchesTags (multi-tag AND)', () => {
  it('empty selection matches everything (no filter)', () => {
    expect(taskMatchesTags(task(), [])).toBe(true)
    expect(taskMatchesTags(task(['t-red']), [])).toBe(true)
  })
  it('requires every selected tag to be present', () => {
    expect(taskMatchesTags(task(['t-red', 't-blue']), ['t-red'])).toBe(true)
    expect(taskMatchesTags(task(['t-red', 't-blue']), ['t-red', 't-blue'])).toBe(true)
    expect(taskMatchesTags(task(['t-red']), ['t-red', 't-blue'])).toBe(false)
    expect(taskMatchesTags(task([]), ['t-red'])).toBe(false)
    expect(taskMatchesTags(task(), ['t-red'])).toBe(false)
  })
  it('unlabeled tasks never match a non-empty filter', () => {
    expect(taskMatchesTags(task(undefined), ['t-red'])).toBe(false)
  })
})

describe('store normalization of optional tag fields', () => {
  it('round-trips tags + color on a task via parseLedger, drops malformed', () => {
    const ledger = JSON.stringify([
      { ...task(['t-red', 't-blue'], '#e5484d') },
      { ...task(), tags: 'not-an-array' },
      { ...task(), color: '' },
    ])
    const rows = parseLedger(ledger)
    expect(rows[0].tags).toEqual(['t-red', 't-blue'])
    expect(rows[0].color).toBe('#e5484d')
    expect(rows[1].tags).toBeUndefined()
    expect(rows[2].color).toBeUndefined()
    // Legacy rows without the fields keep working untouched.
    expect(rows[0].id).toBe('task-1')
  })
})
