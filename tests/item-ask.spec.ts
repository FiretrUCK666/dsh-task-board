/**
 * 交给谁、说什么——「问 AI」那一按背后的两个判决。
 *
 * TWO THINGS ARE WORTH PINNING HERE, and they are the two a reader cannot see:
 * WHICH conversation the words go to (a wrong target delivers a person's request
 * into somebody else's session, and nothing about that looks broken), and WHAT
 * the words are (a model told the wrong thing answers the wrong question, and the
 * reader blames the model).
 *
 * ── THE CLAIM THIS FILE WAS REWRITTEN FOR ────────────────────────────────────
 *
 * 「没有会话」 used to be a REFUSAL — asking a card that had never run answered
 * `taskHasNoSession`, and the panel had a second button (「执行」) for the case
 * where there was nothing to continue into. So a reader who pressed the wrong one
 * of two buttons that both meant 「交给 AI」 got a dead control, and the row's
 * other two lanes (a fresh run, a message into a live conversation) were decided
 * in two places that could disagree.
 *
 * Now it is ONE decision with two lanes: a card with a conversation gets the words
 * said into it, a card without one gets a run. `start` is a lane, not a failure —
 * which is the assertion below that would have been the opposite of the true one
 * in the previous shape.
 */
import { describe, expect, it } from 'vitest'
import { askTargetOf, itemContextText, planItemAsk } from '../src/core/item-ask.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import type { ItemRecord } from '../src/core/item.ts'

const T0 = 1_700_000_000_000

function row(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 1,
    title: '一件要做的事',
    body: '',
    notes: '',
    steps: [],
    status: 'todo',
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

/** A card, with the sessions it is related to said out loud (the caller's job:
 *  this module reads a fact it is handed, never a document). */
function card(patch: Partial<TaskRecord> = {}): TaskRecord {
  return { ...createTask({ title: '卡 A', description: '', prompt: 'p' }, T0, 'card-a'), ...patch }
}

const never = (): boolean => false

describe('开始还是继续：这一张卡有没有一条能接下去的对话', () => {
  it('一条会话都没有，就是「开始」——不是拒绝', () => {
    expect(askTargetOf([], never)).toEqual({ kind: 'start' })
  })

  it('有会话就继续，哪怕是闲着的', () => {
    expect(askTargetOf([{ sessionId: 's-1' }], never)).toEqual({ kind: 'continue', sessionId: 's-1' })
  })

  it('有好几条时选正在干活的那一条', () => {
    // THE claim the old route spelled out: a card can hold several conversations,
    // and 「正在干活的那一条」 is the only choice that matches what a reader means.
    const target = askTargetOf([{ sessionId: 's-1' }, { sessionId: 's-2' }], id => id === 's-2')
    expect(target).toEqual({ kind: 'continue', sessionId: 's-2' })
  })

  it('没有一条在跑时，用卡自己的第一条', () => {
    const target = askTargetOf([{ sessionId: 's-1' }, { sessionId: 's-2' }], never)
    expect(target).toEqual({ kind: 'continue', sessionId: 's-1' })
  })
})

describe('一句话里写什么', () => {
  it('五个字段都在时，一个不少', () => {
    const said = itemContextText(row({
      ref: 12,
      title: '写完部署脚本',
      tags: ['运维', '脚本'],
      body: '正文第一行\n正文第二行',
      notes: '上次那个坑要先看一眼',
      steps: [
        { id: 'st-1', text: '查一遍现网', done: true },
        { id: 'st-2', text: '写脚本', done: false },
      ],
    }))
    expect(said).toContain('（#12）')
    expect(said).toContain('标题：写完部署脚本')
    expect(said).toContain('标签：运维、脚本')
    expect(said).toContain('正文：\n正文第一行\n正文第二行')
    expect(said).toContain('步骤：\n- [x] 查一遍现网\n- [ ] 写脚本')
    expect(said).toContain('上下文备注：\n上次那个坑要先看一眼')
  })

  it('空的字段是删掉，不是留一个空标题', () => {
    // A list of empty headings reads as a form somebody forgot to fill, and a
    // model that sees 「标签：」 learns nothing except that there are no tags.
    const said = itemContextText(row({ title: '只有标题' }))
    for (const label of ['标签：', '正文：', '步骤：', '上下文备注：']) {
      expect(said, `${label} 不该出现`).not.toContain(label)
    }
    expect(said).toContain('标题：只有标题')
  })

  it('没编号的行说「还没编号」，不写 #0', () => {
    // `ref === 0` is the document's 「not numbered yet」 sentinel, and printing it
    // would put a number on screen that the reader's own list does not show.
    const said = itemContextText(row({ ref: 0, title: '刚记的一条' }))
    expect(said).not.toContain('#0')
    expect(said).toContain('还没有编号')
  })

  it('标题取的是这一行自己的字段，不是屏幕上借来的那行正文', () => {
    // `itemTitleOf` borrows the body's first line for an untitled row — right for
    // a screen, wrong here: the borrowed line would arrive twice and the model
    // would be told the row has a title it does not have.
    const said = itemContextText(row({ title: '', body: '第一行就是它\n第二行' }))
    expect(said).not.toContain('标题：')
    expect(said).toContain('正文：\n第一行就是它\n第二行')
  })
})

describe('整件事：两条车道与两种拒绝', () => {
  it('挂着卡、卡有会话：说进那条会话', () => {
    const plan = planItemAsk({
      item: row({ taskId: 'card-a', title: '一件事' }),
      card: card(),
      sessions: [{ sessionId: 's-1' }],
      isRunning: never,
    })
    expect(plan.kind).toBe('continue')
    if (plan.kind !== 'continue') return
    expect(plan.sessionId).toBe('s-1')
    expect(plan.text).toContain('一件事')
  })

  it('挂着卡、卡一条会话都没有：开一轮', () => {
    const plan = planItemAsk({
      item: row({ taskId: 'card-a', title: '一件事' }),
      card: card(),
      sessions: [],
      isRunning: never,
    })
    expect(plan.kind).toBe('start')
    if (plan.kind !== 'start') return
    expect(plan.text).toContain('一件事')
  })

  it('REFUSES a body whose card and row disagree', () => {
    // THE claim the route's two independent lookups could not make: `taskId`
    // picks the card, the row is found separately, and nothing compared them — so
    // a request naming card A with a row of card B delivered B's text into A's
    // conversation. On a board with a dozen cards that is not a crash; it is a
    // wrong answer inside a session the reader will trust.
    const plan = planItemAsk({
      item: row({ id: 'i-other', taskId: 'card-z' }),
      card: card(),
      sessions: [{ sessionId: 's-1' }],
      isRunning: never,
    })
    expect(plan).toEqual({ kind: 'refused', why: 'rowBelongsElsewhere' })
  })

  it('挂着的卡不在了：拒绝，而且是在读会话之前就拒绝', () => {
    const plan = planItemAsk({
      item: row({ taskId: 'card-a' }),
      card: undefined,
      sessions: [],
      isRunning: never,
    })
    expect(plan).toEqual({ kind: 'refused', why: 'noCard' })
  })
})
