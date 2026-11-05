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
    /* 组默认收着（官方 `useDisclosure` 初值），所以先把两组都点开，才看得到内容。 */
    const opened = renderToStaticMarkup(createElement(TurnItem, {
      turn: turnOf(),
      policy: policyOfWorkSteps({ view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' }),
      isLatest: false,
      open: true,
      onToggle: () => {},
      /* 组键 = `foldKeyOf(turn)` + '#' + 组键。`turnOf()` 的 `answerStep` 是 2，
         两段过程的第一条到达序号分别是 1 与 4。 */
      openGroups: new Set(['1#2#g1', '1#2#g4']),
      onToggleGroup: () => {},
    }))
    const read = opened.indexOf('>read<')
    const thought = opened.indexOf('先看现场')
    const midway = opened.indexOf('我看了一下现场')
    const write = opened.indexOf('>write<')
    /* 真实次序：read → 思考 → 中途那句 → write。**中途那句话把过程切成两段**
       （官方 `flush(true)` 只在遇到带文字的回复时发生），所以两段各自成折。 */
    expect(read, '工具 read 不在折里').toBeGreaterThan(-1)
    expect(thought, '思考行不在折里').toBeGreaterThan(read)
    expect(midway, '中途那句没有画出来').toBeGreaterThan(thought)
    expect(write, '工具 write 排到了中途那句之前').toBeGreaterThan(midway)
  })

  it('只有一段过程的轮不套第二层折（否则屏上是一列「1 次工具调用」）', () => {
    /* 官方那个分组只在**一轮里有多段**时才有意义。一段连续过程就是一轮的全部内容，
       再套一层的话读者要连点两次才看到第一行，而每一轮都会长出一个空折。
       读者截图里那一列「1 次工具调用」正是这么来的。 */
    const single = turnOf({
      steps: [
        { kind: 'tool', id: 'c1', name: 'read', state: 'settled', step: 1, order: 1 },
        { kind: 'tool', id: 'c2', name: 'write', state: 'settled', step: 2, order: 2 },
      ],
      replies: [{ id: 'a2', text: '换好了：东墙那盏换成了轨道灯。', at: 2, step: 2, order: 3 }],
      answer: { step: 2, replyId: 'a2', messageCount: 0 },
    })
    const html = renderTurn(single, { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' }, true)
    expect(html.match(/reviewStepGroup/g)?.length ?? 0, '一段过程却套了组折').toBe(0)
    expect(html, '过程没画出来').toContain('>read<')
    expect(html, '过程没画出来').toContain('>write<')
  })

  it('一轮里有多段过程时，每段各自是一个小折', () => {
    /* `turnOf()` 的中途那句把过程切成两段 → 两个组折。这是官方那种「多段各自收放」。 */
    const html = renderTurn(turnOf(), { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' }, true)
    expect(html.match(/reviewStepGroup/g)?.length, '多段过程没有各自成折').toBe(2)
  })

  it('组默认收着（官方 useDisclosure 的初值）', () => {
    const html = renderTurn(turnOf(), { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' }, true)
    const groups = html.match(/aria-expanded="false"/g)?.length ?? 0
    expect(groups, '组默认是展开的').toBeGreaterThan(0)
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
