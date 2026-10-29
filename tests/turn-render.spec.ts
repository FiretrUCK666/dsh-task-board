/**
 * 一轮一折的**渲染契约**：折起来之后屏上真的只剩那几样东西。
 *
 * 为什么这条要单独一个 spec：判据（哪一轮该折）由 `work-steps.spec.ts` 钉住，
 * 而「判据对了、画出来却是另一回事」是这一类界面最常见的失效方式——折行画了但最后那段话
 * 没露出来，或者 `final` 档把中途那几句也印上去了。那两种都不会让任何判据变红。
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TurnItem, TurnList } from '../src/client/board/TurnItem.tsx'
import { shapeOfWorkSteps } from '../src/client/board/work-steps.ts'
import type { TranscriptTurn } from '../src/client/board/review-transcript.ts'

/** 一轮跑完的正常对话：两个工具、一段思考、中途一句、最后一段。 */
function turnOf(over: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return {
    turn: 1,
    trigger: { id: 'm1', text: '把东墙那盏灯换掉', at: 0 },
    interjections: [],
    steps: [
      { kind: 'tool', id: 'c1', name: 'read', state: 'settled', step: 1 },
      { kind: 'reasoning', id: 'r1', chars: 412, preview: '先看现场', step: 1 },
      { kind: 'tool', id: 'c2', name: 'write', state: 'settled', step: 2 },
    ],
    replies: [
      { id: 'a1', text: '我看了一下现场，马上换。', at: 1 },
      { id: 'a2', text: '换好了：东墙那盏换成了轨道灯。', at: 2 },
    ],
    endedAt: 3,
    endReason: 'completed',
    ...over,
  }
}

/** 按一档设置把这一轮画出来。 */
function renderTurn(turn: TranscriptTurn, prefs: Parameters<typeof shapeOfWorkSteps>[0], open = false): string {
  return renderToStaticMarkup(createElement(TurnItem, {
    turn,
    shape: shapeOfWorkSteps(prefs),
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
    // 折行标题读的是结算（这一轮没有运行中的工具）。
    expect(html, '折行没有标题').toContain('reviewWorkSteps')
    // 折着的时候过程不在屏上（它们只活在展开区域里）。
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
    // 思考行的标签是那个词自己（`review.stepThought`）；标题里也有「思考」两个字
    // （「2 段思考」那条结算），所以这里认的是**被 `<span>` 包住的那一个**。
    const thought = html.indexOf('>思考<')
    const write = html.indexOf('>write<')
    expect(read, '工具 read 不在折里').toBeGreaterThan(-1)
    expect(thought, '思考行不在折里').toBeGreaterThan(read)
    expect(write, '工具 write 不在思考之后').toBeGreaterThan(thought)
    // 点开之后折里也有中途那句（它是「没露在折外」的那一条）。
    expect(html).toContain('我看了一下现场')
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
      steps: [{ kind: 'tool', id: 'c1', name: 'bash', state: 'running', step: 1 }],
    }), { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' })
    expect(html, '跑着的轮被折了').not.toContain('reviewWorkSteps')
    expect(html).toContain('bash')
  })

  it('读者插过话的轮永不折——他自己的话不许折进过程里', () => {
    const html = renderTurn(turnOf({
      interjections: [{ id: 'm2', text: '顺便看一下客厅', at: 1 }],
    }), { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' })
    expect(html, '插过话的轮被折了').not.toContain('reviewWorkSteps')
  })

  it('一次画多轮：每轮一格，新的那一轮带着自己的折开状态', () => {
    const html = renderToStaticMarkup(createElement(TurnList, {
      turns: [turnOf(), turnOf({ turn: 2, trigger: { id: 'm2', text: '顺便看一下客厅', at: 0 } })],
      prefs: { view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' },
      openTurns: new Set([2]),
      onToggle: () => {},
    }))
    expect(html.match(/reviewTurn/g)?.length).toBe(2)
    expect(html, '第二轮的折没打开').toContain('aria-expanded="true"')
    expect(html, '第一轮的折被顺手打开了').toContain('aria-expanded="false"')
  })
})
