/**
 * 一轮一折的**渲染契约**：折起来之后屏上真的只剩那几样东西。
 *
 * 为什么这条要单独一个 spec：判据（哪一轮该折）由 `work-steps.spec.ts` 钉住，
 * 而「判据对了、画出来却是另一回事」是这一类界面最常见的失效方式——折行画了但最后那段话
 * 没露出来，或者 `final` 档把中途那几句也印上去了。那两种都不会让任何判据变红。
 *
 * **顺序**也在这里钉：过程行与回复必须按真实发生次序交错，否则长轮看起来就是
 * 「几十行工具堆在上面、两句话接在下面」——那正是读者说「对不上」的那种观感。
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TurnItem, TurnList } from '../src/client/board/TurnItem.tsx'
import { policyOfWorkSteps } from '../src/client/board/work-steps.ts'
import type { TranscriptTurn } from '../src/client/board/review-transcript.ts'

/**
 * 一轮跑完的正常对话，**到达次序照真实事件流排**：
 * 先想、再调 read、说一句、再调 write、最后一段。
 */
function turnOf(over: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return {
    turn: 1,
    trigger: { id: 'm1', text: '把东墙那盏灯换掉', at: 0 },
    interjections: [],
    steps: [
      { kind: 'tool', id: 'c1', name: 'read', state: 'settled', step: 1, order: 1 },
      { kind: 'reasoning', id: 'r1', chars: 412, preview: '先看现场', step: 1, order: 2 },
      { kind: 'tool', id: 'c2', name: 'write', state: 'settled', step: 2, order: 4 },
    ],
    replies: [
      { id: 'a1', text: '我看了一下现场，马上换。', at: 1, step: 1, order: 3 },
      { id: 'a2', text: '换好了：东墙那盏换成了轨道灯。', at: 2, step: 2, order: 5 },
    ],
    answer: { step: 2, replyId: 'a2', messageCount: 1 },
    endedAt: 3,
    endReason: 'completed',
    ...over,
  }
}

/** 按一档设置把这一轮画出来。 */
function renderTurn(turn: TranscriptTurn, prefs: Parameters<typeof policyOfWorkSteps>[0], open = false): string {
  return renderToStaticMarkup(createElement(TurnItem, {
    turn,
    policy: policyOfWorkSteps(prefs),
    isLatest: false,
    open,
    onToggle: () => {},
  }))
}

describe('一轮一折的渲染', () => {
  it('折起来：触发句 + 折行 + 最后那段话，中途那几句不在屏上', () => {
    const html = renderTurn(turnOf(), { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' })
    expect(html, '触发句不见了').toContain('把东墙那盏灯换掉')
    expect(html, '最后那段话不见了').toContain('换好了')
    expect(html, 'final 档把中途那句也印出来了').not.toContain('我看了一下现场')
    expect(html, '折行没有标题').toContain('reviewWorkSteps')
    expect(html, '折着却把过程画出来了').not.toContain('reviewStep')
  })

  it('折起来时折行是 aria-expanded=false、且没有展开区域', () => {
    const html = renderTurn(turnOf(), { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' })
    expect(html).toContain('aria-expanded="false"')
    expect(html, '折着却有展开区域').not.toContain('detailSectionBody')
  })

  it('点开之后过程按发生顺序露出来，折记号翻过来', () => {
    const html = renderTurn(turnOf(), { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' }, true)
    expect(html).toContain('aria-expanded="true"')
    const read = html.indexOf('>read<')
    const thought = html.indexOf('先看现场')
    const midway = html.indexOf('我看了一下现场')
    const write = html.indexOf('>write<')
    expect(read, '工具 read 不在折里').toBeGreaterThan(-1)
    expect(thought, '思考行不在折里').toBeGreaterThan(read)
    /* 中途那句话是在 read/思考**之后**、write **之前**发生的：折里也必须这样排，
       否则读者对不上「哪句话说在哪一步之后」。 */
    expect(midway, '中途那句没有排在真实位置').toBeGreaterThan(thought)
    expect(write, '工具 write 不在中途那句之后').toBeGreaterThan(midway)
  })

  it('all 档：中途那几句也露在折外', () => {
    const html = renderTurn(turnOf(), { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'all' })
    expect(html).toContain('我看了一下现场')
    expect(html).toContain('换好了')
  })

  it('完全展开档：一道折都不折，过程与全部回复都摊着', () => {
    const html = renderTurn(turnOf(), { view: 'verbose', collapseTiming: 'completion', foldedReplies: 'final' })
    expect(html, '完全展开档仍然画了折行').not.toContain('reviewWorkSteps')
    expect(html).toContain('reviewStep')
    expect(html).toContain('我看了一下现场')
    expect(html).toContain('换好了')
  })

  it('还在跑的轮摊着，标题点出正在调用的工具', () => {
    const html = renderTurn(turnOf({
      endedAt: undefined,
      endReason: undefined,
      answer: undefined,
      steps: [{ kind: 'tool', id: 'c1', name: 'bash', state: 'running', step: 1, order: 1 }],
      replies: [],
    }), { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' })
    expect(html, '跑着的轮被折了').not.toContain('reviewWorkSteps')
    expect(html).toContain('bash')
  })

  it('读者插过话的轮永不折——他自己的话不许折进过程里', () => {
    const html = renderTurn(turnOf({
      interjections: [{ id: 'm2', text: '顺便看一下客厅', at: 1, step: 1, order: 3.5 }],
    }), { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' })
    expect(html, '插过话的轮被折了').not.toContain('reviewWorkSteps')
    /* 而且**那句话真的画出来了**——收进 `interjections` 却从不渲染，
       是最糟的组合：判据说「永不折」，而读者的话一个字都看不到。 */
    expect(html, '读者插的话没画出来').toContain('顺便看一下客厅')
  })

  it('简洁档在跑的时候也把过程收进一个组里（官方 stepGrouping=collapsed）', () => {
    const running = turnOf({
      endedAt: undefined,
      endReason: undefined,
      answer: undefined,
      steps: [{ kind: 'tool', id: 'c1', name: 'bash', state: 'running', step: 1, order: 1 }],
      replies: [],
    })
    const compact = renderTurn(running, { view: 'compact', collapseTiming: 'completion', foldedReplies: 'final' })
    expect(compact, '简洁档在跑时没分组').toContain('reviewWorkSteps')
    /* 详细档只给**历史**轮分组，所以在跑的轮平铺。 */
    const detailed = renderTurn(running, { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' })
    expect(detailed, '详细档把在跑的轮也分组了').not.toContain('reviewWorkSteps')
  })

  it('一次画多轮：每轮一格，新的那一轮带着自己的折开状态', () => {
    const html = renderToStaticMarkup(createElement(TurnList, {
      turns: [turnOf(), turnOf({ turn: 2, trigger: { id: 'm2', text: '顺便看一下客厅', at: 0 } })],
      prefs: { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' },
      openTurns: new Set(['2#2']),
      onToggle: () => {},
    }))
    expect(html.match(/reviewTurn/g)?.length).toBe(2)
    expect(html, '第二轮的折没打开').toContain('aria-expanded="true"')
    expect(html, '第一轮的折被顺手打开了').toContain('aria-expanded="false"')
  })
})
