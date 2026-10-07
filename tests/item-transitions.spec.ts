/**
 * The checklist's shared write semantics: the one implementation the interface
 * and the model both go through.
 *
 * WHY THIS FILE EXISTS AS ITS OWN CONTRACT. The checklist is the second
 * document this plugin syncs, so two devices hold one document and must show
 * one list. A write path that behaves differently per writer is a document
 * whose order of writing differs per writer, which is a document whose two
 * replicas can disagree about facts nobody ever typed. Every case below is one
 * of those differences, stated as a fact about the function rather than as a
 * fact about a surface.
 *
 * THE LAW MOST OF THESE CASES ARE ABOUT. A write that changes nothing returns
 * THE SAME ARRAY. Not an equal one — the same one. The caller compares the
 * returned array to the one it passed in and identity IS the answer, because a
 * fresh equal array would be correct and useless: every no-op keystroke would
 * burn a revision and wake every device for a change that did not happen. The
 * cases are written to make returning a fresh array fail.
 *
 * PURE, AND THE SCAN SAYS SO. A pure function that quietly reads the clock is
 * not pure, it is just untested until somebody runs it twice, so the last case
 * scans the module rather than trusting the doc comment.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ItemRecord, ItemStatus } from '../src/core/item.ts'
import {
  applyItemPatch,
  applyItemStep,
  captureItemRecord,
  isBlankCapture,
  isItemListValue,
  mintStepId,
  planItemPromotion,
  readItemStepList,
  removeItemRecord,
  type ItemCapture,
} from '../src/core/item-transitions.ts'

const T0 = 1_700_000_000_000
const DAY = 86_400_000

function row(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 12,
    title: 'A thing',
    body: '',
    notes: '',
    steps: [],
    status: 'open',
    priority: 'normal',
    tags: [],
    startsAfter: undefined,
    dueAt: undefined,
    hardDueAt: undefined,
    taskId: undefined,
    origin: { source: 'human', at: T0 },
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  }
}

/** A row with a checklist, so the step paths have something to address. */
function withSteps(): ItemRecord {
  return row({
    steps: [
      { id: 'i-1.s1', text: 'first', done: false },
      { id: 'i-1.s2', text: 'second', done: true },
      { id: 'i-1.s3', text: 'third', done: false },
    ],
  })
}

describe('an edit that changes nothing is not a write', () => {
  it('the SAME patch twice returns the identical array the second time', () => {
    // The identity, not the equality. A function that returned a fresh equal
    // array would pass every `toEqual` in this file and still burn a revision
    // per keystroke, so the cases below all compare with `toBe`.
    const items = [row(), withSteps()]
    const once = applyItemPatch(items, 'i-1', { title: 'A thing' }, T0 + 1)
    const twice = applyItemPatch(once, 'i-1', { title: 'A thing' }, T0 + 2)
    expect(twice).toBe(once)
    // And the array it was handed is never written to — the caller holds it in
    // state, and an in-place write is what makes "did I move anything"
    // unanswerable to React.
    expect(items[0]?.title).toBe('A thing')
  })

  it('rebuilding a checklist or a tag list with equal content is still no change', () => {
    // Compared BY VALUE, not by reference. A caller that hands over a
    // rebuilt-but-equal step list is making no edit, and must not wake every
    // device for having re-derived what it already had.
    const items = [withSteps()]
    expect(applyItemPatch(items, 'i-1', { steps: items[0]!.steps.map(step => ({ ...step })) }, T0 + 1)).toBe(items)
    expect(applyItemPatch(items, 'i-1', { tags: [] }, T0 + 1)).toBe(items)
    const tagged = [row({ tags: ['画廊', '重做'] })]
    expect(applyItemPatch(tagged, 'i-1', { tags: ['画廊', '重做'] }, T0 + 1)).toBe(tagged)
    // And a genuinely different tag list IS a write, so the case above is not
    // passing because the comparison never fires.
    expect(applyItemPatch(tagged, 'i-1', { tags: ['画廊'] }, T0 + 1)).not.toBe(tagged)
  })

  it('the stamp moves only when the row did', () => {
    const items = [row()]
    expect(applyItemPatch(items, 'i-1', { title: 'A thing' }, T0 + 99)[0]?.updatedAt).toBe(T0)
    expect(applyItemPatch(items, 'i-1', { title: 'Another thing' }, T0 + 99)[0]?.updatedAt).toBe(T0 + 99)
  })

  it('an absent key means "leave it alone", and an explicit undefined means "clear it"', () => {
    // The two are different requests and the difference is the whole reading
    // rule for a patch: a date the reader emptied arrives as
    // `{ dueAt: undefined }` and does clear the promise, while a patch that
    // never mentions `dueAt` keeps it.
    const items = [row({ dueAt: T0 + 3 * DAY })]
    expect(applyItemPatch(items, 'i-1', { title: 'Another thing' }, T0 + 1)[0]?.dueAt).toBe(T0 + 3 * DAY)
    expect(applyItemPatch(items, 'i-1', { dueAt: undefined }, T0 + 1)[0]?.dueAt).toBeUndefined()
  })

  it('a row that is not there is not an error here', () => {
    // The document owns finding rows; this function's whole contract is
    // "change this one, or change nothing".
    const items = [row()]
    expect(applyItemPatch(items, 'nope', { title: 'x' }, T0 + 1)).toBe(items)
    expect(removeItemRecord(items, 'nope')).toBe(items)
    expect(applyItemStep(items, 'nope', 'any', true, T0 + 1)).toBe(items)
  })
})

describe('a step is SET, never toggled', () => {
  it('two calls with the same state are one write and then nothing', () => {
    // "Tick or untick" is a decision the caller makes from a value it has
    // already read; a toggle would make two devices that both retried land on
    // opposite sides of one box.
    const items = [withSteps()]
    const once = applyItemStep(items, 'i-1', 'i-1.s1', true, T0 + 1)
    expect(once[0]?.steps[0]?.done).toBe(true)
    expect(applyItemStep(once, 'i-1', 'i-1.s1', true, T0 + 2)).toBe(once)
  })

  it('only the addressed step moves, and the rest keep their id, text and state', () => {
    const items = [withSteps()]
    const next = applyItemStep(items, 'i-1', 'i-1.s2', false, T0 + 1)
    expect(next[0]?.steps).toEqual([
      { id: 'i-1.s1', text: 'first', done: false },
      { id: 'i-1.s2', text: 'second', done: false },
      { id: 'i-1.s3', text: 'third', done: false },
    ])
  })

  it('a step id that names nothing is a question, not a silent success', () => {
    // The step list is something only the document knows, so an id that matches
    // nothing must not create a step — that is how a checklist quietly grows a
    // line nobody wrote.
    const items = [withSteps()]
    expect(applyItemStep(items, 'i-1', 'i-1.s9', true, T0 + 1)).toBe(items)
  })
})

describe('deleting takes the row out of the list and says nothing about the disk', () => {
  it('the row is gone, the list is a new one, and a miss changes nothing', () => {
    const items = [row(), row({ id: 'i-2', title: 'stays' })]
    const next = removeItemRecord(items, 'i-1')
    expect(next).not.toBe(items)
    expect(next.map(item => item.id)).toEqual(['i-2'])
    expect(items.map(item => item.id)).toEqual(['i-1', 'i-2'])
  })
})

describe('the capture box and the model mint a row the same way', () => {
  const base: ItemCapture = { title: '  trimmed  ', body: '', notes: '', origin: 'human' }

  it('what the writer decided is what is stored, and the rest is the document\'s', () => {
    const { item, mintedSteps } = captureItemRecord(base, T0 + 5, () => 'i-new')
    expect(item.title, 'the text is not trimmed, so the same words typed into two surfaces produce two different rows').toBe('trimmed')
    // The short number is the document's to hand out, and a row that showed one
    // before the document has seen it would be quoting a guess.
    expect(item.ref).toBe(0)
    expect(item.createdAt).toBe(T0 + 5)
    expect(item.updatedAt).toBe(T0 + 5)
    expect(item.origin).toEqual({ source: 'human', at: T0 + 5 })
    expect(mintedSteps).toBe(0)
  })

  it('an unknown status or priority lands in the neutral tier, never in the document', () => {
    // The parser leaves an unrecognised tier undefined, and undefined is not a
    // value the model may store: it means "the writer did not say", which for a
    // fresh row is the neutral tier.
    const { item } = captureItemRecord({ ...base, status: 'nonsense' as ItemStatus, priority: 'louder' as never }, T0, () => 'i-new')
    expect(item.status).toBe('open')
    expect(item.priority).toBe('normal')
  })

  it('step ids are minted from the row and the position, so the same words give the same list', () => {
    // A step is ADDRESSED by its id, so a scheme that changes per writer is a
    // scheme whose ids cannot be quoted — and two writers who typed the same
    // lines into the same row must not end up with two different lists.
    const input: ItemCapture = { ...base, steps: [{ text: 'one', done: false }, { text: 'two', done: true }] }
    const first = captureItemRecord(input, T0, () => 'i-new')
    const second = captureItemRecord(input, T0, () => 'i-new')
    expect(first.item.steps.map(step => step.id)).toEqual(['i-new.s1', 'i-new.s2'])
    expect(second.item.steps).toEqual(first.item.steps)
    expect(first.mintedSteps).toBe(2)
    expect(mintStepId('i-new', 3)).toBe('i-new.s3')
  })

  it('a step that brought its own id keeps it, so an edit does not renumber under the writer', () => {
    const { item, mintedSteps } = captureItemRecord({ ...base, steps: [{ id: 'keep-me', text: 'one', done: false }] } as never, T0, () => 'i-new')
    expect(item.steps[0]?.id).toBe('keep-me')
    expect(mintedSteps).toBe(0)
  })
})

describe('an inbound step list is repaired, and the repair is REPORTED', () => {
  it('nothing to read is the empty list; a shape nobody can read is a refusal', () => {
    // Three answers, and the third is the one that matters: a value supplied in
    // a shape nobody can read must NOT be answered by emptying the list, which
    // would destroy work over a typo. The caller refuses it with a sentence the
    // writer can act on.
    expect(readItemStepList(null, 'i-1')).toEqual({ steps: [], minted: 0 })
    expect(readItemStepList([], 'i-1')).toEqual({ steps: [], minted: 0 })
    expect(readItemStepList('two steps please', 'i-1')).toBeUndefined()
    expect(readItemStepList(7, 'i-1')).toBeUndefined()
  })

  it('a line with no readable text is not a line, and a bare string is one', () => {
    expect(readItemStepList(['one', '', '   ', { text: 'two' }], 'i-1')?.steps.map(s => s.text)).toEqual(['one', 'two'])
  })

  it('a duplicate id is re-minted rather than dropping a line of the reader\'s words', () => {
    // Losing a line of the reader's own words is the one outcome no repair may
    // choose, so a collision renumbers and the count of re-mints is reported.
    const read = readItemStepList([
      { id: 'same', text: 'first', done: false },
      { id: 'same', text: 'second', done: false },
    ], 'i-1')
    expect(read?.steps.map(step => step.text)).toEqual(['first', 'second'])
    expect(new Set(read?.steps.map(step => step.id)).size).toBe(2)
    // The re-mint is a GIVEN id being repaired, not a missing one, so it is not
    // counted as minted — the two numbers mean different things to the caller.
    expect(read?.minted).toBe(0)
  })

  it('a wrongly ticked box reads as not done, because work that is hidden is worse', () => {
    const read = readItemStepList([{ text: 'a', done: 'yes' }, { text: 'b', done: true }], 'i-1')
    expect(read?.steps.map(step => step.done)).toEqual([false, true])
  })
})

describe('the shape checks the write path refuses on', () => {
  it('a list is a list, and nothing else is', () => {
    for (const value of [undefined, null, [], [1], ['a']]) expect(isItemListValue(value), JSON.stringify(value)).toBe(true)
    for (const value of ['two', 7, {}, { a: 1 }]) expect(isItemListValue(value), JSON.stringify(value)).toBe(false)
  })

  it('a capture is blank only when there is nothing in it at all', () => {
    // A tag is structure the reader typed on purpose, so a row carrying only
    // tags is a row they decided to make — refusing it would lose the decision.
    // The helper reads title, body and steps, and the tag is counted by the
    // caller that holds it; the cases below are the three things the helper
    // itself has an opinion about.
    expect(isBlankCapture({ title: '', body: '', steps: [] })).toBe(true)
    expect(isBlankCapture({ title: '   ', body: '  ', steps: [] })).toBe(true)
    // A checklist line of pure spaces is not a line: it is a box, and a box the
    // reader cannot read is not something they wrote.
    expect(isBlankCapture({ title: '', body: '', steps: [{ text: '  ', done: false }] })).toBe(true)
    expect(isBlankCapture({ title: 'x', body: '', steps: [] })).toBe(false)
    expect(isBlankCapture({ title: '', body: 'y', steps: [] })).toBe(false)
    expect(isBlankCapture({ title: '', body: '', steps: [{ text: 'z', done: false }] })).toBe(false)
  })
})

describe('the module is pure, because a function that reads the clock is untested', () => {
  it('reads neither the machine clock nor a random source', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/core/item-transitions.ts', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    for (const banned of ['Date.now', 'new Date(', 'Math.random']) {
      expect(source, `item-transitions reads ${banned} — a second call with the same input is not the same output, so the no-op law cannot be checked`).not.toContain(banned)
    }
  })

  it('and the two calls really do agree, which is what "pure" buys', () => {
    // The scan above can be satisfied by a rename, so the property is also
    // demonstrated: the same input twice is the same output, down to the ids.
    const input: ItemCapture = { title: 't', body: '', notes: '', origin: 'ai', steps: [{ text: 'a', done: false }] }
    expect(captureItemRecord(input, T0, () => 'i-x')).toEqual(captureItemRecord(input, T0, () => 'i-x'))
  })
})

describe('the promotion plan says what the card would say, once', () => {
  it('the three fields come from the row, and an override replaces its one field only', () => {
    const plan = planItemPromotion(row({ body: '先看一眼现状', notes: '预算要说明' }))
    if (plan.kind !== 'ready') throw new Error('a titled row plans a card')
    expect(plan.task.title).toBe('A thing')
    expect(plan.task.description).toBe('预算要说明')
    expect(plan.task.prompt).toBe('先看一眼现状')
    const renamed = planItemPromotion(row({ body: '先看一眼现状', notes: '预算要说明' }), { cardTitle: '画廊改造' })
    if (renamed.kind !== 'ready') throw new Error('a renamed promotion is ready the same way')
    expect(renamed.task.title).toBe('画廊改造')
    // The override is one field and never the other two, because a caller who
    // renamed the card did not thereby rewrite its prompt.
    expect(renamed.task.prompt).toBe('先看一眼现状')
    expect(renamed.task.description).toBe('预算要说明')
  })

  it('an untitled row borrows the body\'s first line, because the card still needs a name', () => {
    const plan = planItemPromotion(row({ title: '', body: '拆迁之前\n然后再说', notes: '' }))
    if (plan.kind !== 'ready') throw new Error('a body-first line is a name')
    expect(plan.task.title).toBe('拆迁之前')
  })

  it('a row already on a card is refused, and the card it is on is said back', () => {
    const plan = planItemPromotion(row({ taskId: 'task-9' }))
    expect(plan).toEqual({ kind: 'refused', why: 'alreadyLinked', taskId: 'task-9' })
  })

  it('「another」 is the deliberate press that stands the guard aside', () => {
    // 选择器里的「新建卡片」是明说的一声「换一张新的」：不是重复按提升，是被换的
    // 位置。判定不松——没说这句话的调用还是被拦。
    const plan = planItemPromotion(row({ taskId: 'task-9' }), { another: true })
    if (plan.kind !== 'ready') throw new Error('a deliberate card lands')
    expect(plan.task.title).toBe('A thing')
    // 它借用文案的规则不变：正文照旧从这一条带过去。
    expect(plan.task.prompt).toBe('')
  })

  it('「another」 does not make an unnamed card, because a card with no name cannot be made', () => {
    const plan = planItemPromotion(row({ title: '', body: '', taskId: 'task-9' }), { another: true })
    expect(plan).toEqual({ kind: 'refused', why: 'noTitle' })
  })
})
