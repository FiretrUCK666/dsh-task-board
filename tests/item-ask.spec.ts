/**
 * 交给谁、说什么——「问 AI」那一按背后的两个判决。
 *
 * TWO THINGS ARE WORTH PINNING HERE, and they are the two a reader cannot see:
 * WHICH conversation the words go to (a wrong target delivers a person's request
 * into somebody else's session, and nothing about that looks broken), and WHAT
 * the words are (a model told the wrong thing answers the wrong question, and the
 * reader blames the model).
 *
 * ── THE CLAIM THIS FILE PINS ─────────────────────────────────────────────────
 *
 * 「没有会话」 is NOT A REFUSAL — asking a card that has never run answers
 * `taskHasNoSession` only if the lane is read as a failure, and a second button
 * (「执行」) for the case where there is nothing to continue into puts two buttons
 * on the row that both mean 「交给 AI」. A reader who presses the wrong one of
 * those gets a dead control, and the row's other two lanes (a fresh run, a
 * message into a live conversation) get decided in two places that can disagree.
 *
 * It is ONE decision with two lanes: a card with a conversation gets the words
 * said into it, a card without one gets a run. `start` is a lane, not a failure —
 * which is why the assertion below would be the opposite of the true one if this
 * were read as a refusal.
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
    attachments: [],
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

  /**
   * HOW URGENT IT IS, AND WHEN IT IS DUE.
   *
   * The hand-off carried 「标题 / 标签 / 正文 / 步骤 / 备注」 and nothing else, so a
   * row reading 「紧急、周五截止」 arrived as a body of text: the model could not
   * tell a hard deadline from a note, and could not order two rows it was handed.
   * Both facts were in the document the whole time.
   */
  it('优先级随这一条一起送过去，两种写法都给', () => {
    // `urgent` is what `item.update` accepts; `!1` is the mark the reader sees.
    // A hand-off naming only one of them teaches a value the model cannot connect
    // to the field it may write.
    const said = itemContextText(row({ priority: 'urgent' }))
    expect(said, 'the tier never reached the model').toContain('优先级：urgent')
    expect(said, 'the mark the reader sees is missing').toContain('!1')
  })

  it('三个日期都送，而且是各自的名字，不挤成一个「到期」', () => {
    // 开始 / 计划 / 截止 are three different promises. Collapsing them into one
    // "due date" is a different fact from the one the row holds.
    const said = itemContextText(row({
      startsAfter: Date.UTC(2026, 10, 1, 4),
      dueAt: Date.UTC(2026, 10, 6, 4),
      hardDueAt: Date.UTC(2026, 10, 13, 4),
    }))
    expect(said).toContain('开始：')
    expect(said).toContain('计划：')
    expect(said).toContain('截止：')
    // Printed as a DAY, which is the unit, so no 13-digit stamp reaches the model.
    expect(said, 'a raw stamp reached the model').not.toMatch(/\d{13}/)
  })

  it('普通优先级与没填的日期都不留空标题', () => {
    // The same rule the rest of this composer follows: an empty field is OMITTED
    // rather than sent as a blank label, or the model reads a form nobody filled.
    const said = itemContextText(row({ title: '普通的事', priority: 'normal' }))
    expect(said, 'the neutral tier is a label for nothing').not.toContain('优先级：')
    for (const label of ['开始：', '计划：', '截止：']) expect(said).not.toContain(label)
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

  it('这一条自己的图片与文件跟着那句话走，两条车道都一样', () => {
    /* 只送文字就是「读者把图给了这一条，而模型从没见过它」——与评论区丢掉附件是同一类
       缺陷。所以 `attachments` 是**计划的一部分**，两条车道各带一份（同一个读法
       `attachmentsOf`，所以老形状也算数）。 */
    const lamp = { attachmentId: 'att-lamp', name: '灯位.png', bytes: 2048, mediaType: 'image/png' }
    const note = { attachmentId: 'att-note', name: '灯座型号.txt', bytes: 320 }
    const item = row({ taskId: 'card-a', title: '一件事', attachments: [lamp, note] })
    const started = planItemAsk({ item, card: card(), sessions: [], isRunning: never })
    expect(started.kind === 'start' && started.attachments).toEqual([
      { name: '灯位.png', bytes: 2048, mediaType: 'image/png', attachmentId: 'att-lamp' },
      { name: '灯座型号.txt', bytes: 320, attachmentId: 'att-note' },
    ])
    const continued = planItemAsk({ item, card: card(), sessions: [{ sessionId: 's-1' }], isRunning: never })
    expect(continued.kind === 'continue' && continued.attachments).toHaveLength(2)
  })

  it('一个附件都没有时是空表（下游读的是表，不判「有没有」）', () => {
    const plan = planItemAsk({ item: row({ taskId: 'card-a' }), card: card(), sessions: [], isRunning: never })
    expect(plan.kind === 'start' && plan.attachments).toEqual([])
  })
})
