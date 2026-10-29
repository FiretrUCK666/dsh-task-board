/**
 * 工作步骤的判据：四档详略 × 两种收起时机 × 两种回复口径，以及读设置的四条边界。
 *
 * 这一节钉的是**一件事**：读者在官方设置里选了什么，评论区就画什么。每条用例都在问
 * 「这一组选择下，一轮该折还是该摊、折里放多细、折外留哪几条」——正是那位读者说
 * 「我评论一句，他回复一段话」时要求的那三件事。
 *
 * **四个能力字段的名字与取值都照官方 `ChatPresentationPolicy`**，本文件把那张表逐格
 * 钉住；最后一节再拿**实际安装的宿主声明文件**对账，官方改了就让这里红。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORK_STEPS,
  collapseTimingOf,
  finalReplyOf,
  foldedRepliesChoiceOf,
  foldedRepliesOf,
  foldSummaryOf,
  groupsSteps,
  policyOfWorkSteps,
  prefsOf,
  shouldFoldTurn,
  viewOf,
  visibleRepliesOf,
  type WorkStepsPrefs,
} from '../src/client/board/work-steps.ts'
import type { TranscriptTurn } from '../src/client/board/review-transcript.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 一轮跑完、有一个工具调用的正常轮。 */
function turnOf(over: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return {
    turn: 1,
    trigger: { id: 'm1', text: '做这件事', at: 0 },
    interjections: [],
    steps: [{ kind: 'tool', id: 'c1', name: 'read', state: 'settled', step: 1, order: 1 }],
    replies: [{ id: 'a1', text: '做完了', at: 2, step: 1, order: 2 }],
    endedAt: 3,
    endReason: 'completed',
    ...over,
  }
}

/** 三件事的简写。 */
function prefsOf3(view: WorkStepsPrefs['view'], collapseTiming: WorkStepsPrefs['collapseTiming'] = 'completion', foldedReplies: WorkStepsPrefs['foldedReplies'] = 'final'): WorkStepsPrefs {
  return { view, collapseTiming, foldedReplies }
}

describe('policyOfView：四个能力字段逐格照官方 POLICIES', () => {
  it('前三档都折跑完的轮，只有完全展开不折', () => {
    expect(policyOfWorkSteps(prefsOf3('compact')).foldCompletedTurns).toBe(true)
    expect(policyOfWorkSteps(prefsOf3('standard')).foldCompletedTurns).toBe(true)
    expect(policyOfWorkSteps(prefsOf3('detailed')).foldCompletedTurns).toBe(true)
    expect(policyOfWorkSteps(prefsOf3('verbose')).foldCompletedTurns).toBe(false)
  })

  it('分组：简洁/标准始终分，详细只给历史轮分，完全展开不分', () => {
    expect(policyOfWorkSteps(prefsOf3('compact')).stepGrouping).toBe('collapsed')
    expect(policyOfWorkSteps(prefsOf3('standard')).stepGrouping).toBe('collapsed')
    expect(policyOfWorkSteps(prefsOf3('detailed')).stepGrouping).toBe('history')
    expect(policyOfWorkSteps(prefsOf3('verbose')).stepGrouping).toBe('none')
  })

  it('在跑时说不说细节、结算后给不给思考预览', () => {
    expect(policyOfWorkSteps(prefsOf3('compact'))).toMatchObject({ liveProcessDetail: false, settledReasoningPreview: false })
    expect(policyOfWorkSteps(prefsOf3('standard'))).toMatchObject({ liveProcessDetail: true, settledReasoningPreview: true })
    expect(policyOfWorkSteps(prefsOf3('detailed'))).toMatchObject({ liveProcessDetail: true, settledReasoningPreview: true })
    expect(policyOfWorkSteps(prefsOf3('verbose'))).toMatchObject({ liveProcessDetail: false, settledReasoningPreview: true })
  })

  it('两个开关独立于详略档：回复口径与收起时机各自生效', () => {
    expect(policyOfWorkSteps(prefsOf3('detailed', 'completion', 'all')).foldedReplies).toBe('all')
    expect(policyOfWorkSteps(prefsOf3('detailed', 'completion', 'final')).foldedReplies).toBe('final')
    expect(policyOfWorkSteps(prefsOf3('detailed', 'next-input')).collapseTiming).toBe('next-input')
    expect(policyOfWorkSteps(prefsOf3('detailed', 'completion')).collapseTiming).toBe('completion')
  })
})

describe('shouldFoldTurn', () => {
  it('跑完的正常轮该折', () => {
    expect(shouldFoldTurn(turnOf(), policyOfWorkSteps(prefsOf3('detailed')))).toBe(true)
  })

  it('还在跑的轮永不折（折起来等于说它停了）', () => {
    expect(shouldFoldTurn(turnOf({ endedAt: undefined, endReason: undefined }), policyOfWorkSteps(prefsOf3('detailed')))).toBe(false)
  })

  it('读者插过话的轮永不折', () => {
    const turn = turnOf({ interjections: [{ id: 'm2', text: '顺便问一句', at: 1, step: 1, order: 1.5 }] })
    expect(shouldFoldTurn(turn, policyOfWorkSteps(prefsOf3('detailed')), { isLatest: false, hasReaderTurn: true })).toBe(false)
  })

  it('结束得不好的轮永不折（失败现场要露出来）', () => {
    expect(shouldFoldTurn(turnOf({ endReason: 'aborted' }), policyOfWorkSteps(prefsOf3('detailed')))).toBe(false)
    expect(shouldFoldTurn(turnOf({ endReason: 'interrupted' }), policyOfWorkSteps(prefsOf3('detailed')))).toBe(false)
    expect(shouldFoldTurn(turnOf({ endReason: 'error' }), policyOfWorkSteps(prefsOf3('detailed')))).toBe(false)
  })

  it('next-input 时机下最新那一轮先摊着，直到出现更新的一轮', () => {
    const policy = policyOfWorkSteps(prefsOf3('detailed', 'next-input'))
    expect(shouldFoldTurn(turnOf(), policy, { isLatest: true, hasReaderTurn: false })).toBe(false)
    expect(shouldFoldTurn(turnOf(), policy, { isLatest: false, hasReaderTurn: false })).toBe(true)
  })

  it('过程为空的轮不折（点开是空的折比不折更糟）', () => {
    expect(shouldFoldTurn(turnOf({ steps: [] }), policyOfWorkSteps(prefsOf3('detailed')))).toBe(false)
  })

  it('完全展开档一道折都不折', () => {
    expect(shouldFoldTurn(turnOf(), policyOfWorkSteps(prefsOf3('verbose')))).toBe(false)
  })
})

describe('groupsSteps：详细档只给历史轮分组', () => {
  const detail = policyOfWorkSteps(prefsOf3('detailed'))
  const compact = policyOfWorkSteps(prefsOf3('compact'))
  const verbose = policyOfWorkSteps(prefsOf3('verbose'))

  it('历史轮 → 分；还在跑的轮 → 详细档不分（要一句一句看得见）', () => {
    expect(groupsSteps(detail, { isHistorical: true, deferCollapse: false })).toBe(true)
    expect(groupsSteps(detail, { isHistorical: false, deferCollapse: false })).toBe(false)
  })

  it('简洁/标准档在跑时也分组', () => {
    expect(groupsSteps(compact, { isHistorical: false, deferCollapse: false })).toBe(true)
  })

  it('完全展开档永远不分', () => {
    expect(groupsSteps(verbose, { isHistorical: true, deferCollapse: false })).toBe(false)
    expect(groupsSteps(verbose, { isHistorical: false, deferCollapse: false })).toBe(false)
  })

  it('按 next-input 摊着的最新那一轮不分（它还没变成「历史」）', () => {
    expect(groupsSteps(detail, { isHistorical: true, deferCollapse: true })).toBe(false)
  })
})

describe('finalReplyOf：以最终回答边界为准，不是「最后一条」', () => {
  it('最后一步里带文字的那条，不是更早的途中那句、也不是最后那条纯图消息', () => {
    const turn = turnOf({
      replies: [
        { id: 'a1', text: '途中一句', at: 1, step: 1, order: 1 },
        { id: 'a2', text: '最终回答', at: 2, step: 3, order: 2 },
        { id: 'a3', text: '', images: [{ attachmentId: 'att-1', mediaType: 'image/png', bytes: 10, width: 2, height: 2 }], at: 3, step: 3, order: 3 },
      ],
      answer: { step: 3, replyId: 'a2', messageCount: 1 },
    })
    expect(finalReplyOf(turn)?.id).toBe('a2')
  })

  it('还没有边界时返回 undefined（这一轮还在干活）', () => {
    expect(finalReplyOf(turnOf({ replies: [{ id: 'a1', text: '', at: 1, step: 1, order: 1 }], answer: undefined }))).toBeUndefined()
    expect(finalReplyOf(turnOf({ replies: [], answer: undefined }))).toBeUndefined()
  })
})

describe('可见/折起回复：两个口径各自的全部含义', () => {
  const mixed = turnOf({
    replies: [
      { id: 'a1', text: '途中一句', at: 1, step: 1, order: 1 },
      { id: 'a2', text: '最终回答', at: 2, step: 2, order: 2 },
    ],
    answer: { step: 2, replyId: 'a2', messageCount: 1 },
  })

  it('final 口径：折外只留最终回答，途中那句进折', () => {
    const policy = policyOfWorkSteps(prefsOf3('detailed', 'completion', 'final'))
    expect(visibleRepliesOf(mixed, policy).map(reply => reply.id)).toEqual(['a2'])
    expect(foldedRepliesOf(mixed, policy).map(reply => reply.id)).toEqual(['a1'])
  })

  it('all 口径：全部露在外面，折里一条回复都没有', () => {
    const policy = policyOfWorkSteps(prefsOf3('detailed', 'completion', 'all'))
    expect(visibleRepliesOf(mixed, policy).map(reply => reply.id)).toEqual(['a1', 'a2'])
    expect(foldedRepliesOf(mixed, policy)).toEqual([])
  })
})

describe('foldSummaryOf', () => {
  const words = {
    tools: (n: number) => `${n} 次工具调用`,
    reasoning: (n: number) => `${n} 段思考`,
    context: (n: number) => `${n} 条上下文`,
    running: (name: string) => `正在调用 ${name}`,
    completed: '工作步骤',
  }

  it('在跑且这一档说细节时，点出当前工具名', () => {
    const turn = turnOf({ endedAt: undefined, steps: [{ kind: 'tool', id: 'c1', name: 'write', state: 'running', step: 1, order: 1 }] })
    expect(foldSummaryOf(turn, policyOfWorkSteps(prefsOf3('detailed')), words)).toBe('正在调用 write')
  })

  it('简洁档不说正在跑什么（liveProcessDetail 关），退回计数', () => {
    const turn = turnOf({ endedAt: undefined, steps: [{ kind: 'tool', id: 'c1', name: 'write', state: 'running', step: 1, order: 1 }] })
    expect(foldSummaryOf(turn, policyOfWorkSteps(prefsOf3('compact')), words)).toBe('1 次工具调用')
  })

  it('跑完的轮按结算计数', () => {
    const turn = turnOf({
      steps: [
        { kind: 'tool', id: 'c1', name: 'read', state: 'settled', step: 1, order: 1 },
        { kind: 'reasoning', id: 'r1', chars: 10, preview: '想', step: 1, order: 2 },
        { kind: 'context', id: 'x1', producer: 'AGENTS.md', summary: '', at: 0, order: 3 },
      ],
    })
    expect(foldSummaryOf(turn, policyOfWorkSteps(prefsOf3('compact')), words)).toBe('1 次工具调用 · 1 段思考 · 1 条上下文')
  })

  it('每一档都有话说：什么都不剩时退回状态词，不留空折行', () => {
    expect(foldSummaryOf(turnOf({ steps: [] }), policyOfWorkSteps(prefsOf3('compact')), words)).toBe('工作步骤')
  })
})

describe('读设置：逐项窄化，读不出来就是没读到', () => {
  it('四档与两种历史拼写', () => {
    expect(viewOf('compact')).toBe('compact')
    expect(viewOf('verbose')).toBe('verbose')
    expect(viewOf('normal')).toBe('detailed')
    expect(viewOf('expanded')).toBe('detailed')
    expect(viewOf('huge')).toBeUndefined()
    expect(viewOf(undefined)).toBeUndefined()
  })

  it('收起时机与回复口径各自只认两个值', () => {
    expect(collapseTimingOf('completion')).toBe('completion')
    expect(collapseTimingOf('next-input')).toBe('next-input')
    expect(collapseTimingOf('never')).toBeUndefined()
    expect(foldedRepliesChoiceOf('all')).toBe('all')
    expect(foldedRepliesChoiceOf('final')).toBe('final')
    expect(foldedRepliesChoiceOf('some')).toBeUndefined()
  })

  it('逐项回落：只改一项不打回另外两项', () => {
    expect(prefsOf({ collapseTiming: 'next-input' })).toEqual({
      view: DEFAULT_WORK_STEPS.view,
      collapseTiming: 'next-input',
      foldedReplies: DEFAULT_WORK_STEPS.foldedReplies,
    })
    expect(prefsOf(undefined)).toEqual(DEFAULT_WORK_STEPS)
    expect(prefsOf('nonsense')).toEqual(DEFAULT_WORK_STEPS)
    expect(prefsOf({ transcriptView: 42, collapseTiming: [], foldedReplies: {} })).toEqual(DEFAULT_WORK_STEPS)
  })

  it('产品默认是「折叠 + 跑完就收 + 只留最后那一段话」', () => {
    expect(DEFAULT_WORK_STEPS).toEqual({ view: 'detailed', collapseTiming: 'completion', foldedReplies: 'final' })
  })
})

/**
 * 词表镜像：`work-steps.ts` 抄的是官方的词。抄一份的代价不是漂移，是**红**——
 * 这一条拿**实际安装的宿主声明文件**逐项对账。官方加一档、改一个字、改一个字段的
 * 取值，它报红并指名；于是「以后官方改了我们怎么知道」有一个机械答案。
 */
describe('词表镜像与实际安装的宿主一致', () => {
  /** 宿主包里那个声明文件；找不到（没装宿主）时返回 undefined 并明说这一条没核。 */
  function declarationOf(relative: string): string | undefined {
    const candidates = [
      join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
      join(process.env.HOME ?? '', '.npm', 'node_modules'),
    ]
    for (const root of candidates) {
      const file = join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'types', relative)
      try {
        const source = readFileSync(file, 'utf8')
        if (source !== '') return source
      } catch {
        /* 下一个候选 */
      }
    }
    return undefined
  }

  /** 一个 `declare const X: readonly [...]` 的成员表（单引号与双引号两种拼写都认）。 */
  function tupleOf(source: string, name: string): string[] | undefined {
    const match = source.match(new RegExp(`export declare const ${name}: readonly \\[([^\\]]+)\\]`))
    if (match === null) return undefined
    return [...match[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map(one => one[1] ?? one[2])
  }

  it('四档、两种时机、两种回复口径逐项对得上', () => {
    const source = declarationOf('chat-settings.d.ts')
    if (source === undefined) {
      console.warn('skip: 这台机器上没有已安装的 dsh-client-ui-chat 声明文件，词表镜像未核对')
      return
    }
    expect(tupleOf(source, 'TRANSCRIPT_VIEW_MODES'), 'four modes').toEqual(['compact', 'standard', 'detailed', 'verbose'])
    expect(tupleOf(source, 'COLLAPSE_TIMINGS'), 'collapse timings').toEqual(['completion', 'next-input'])
    expect(tupleOf(source, 'FOLDED_REPLIES'), 'folded replies').toEqual(['all', 'final'])
    expect(source, 'legacy mode').toContain('LEGACY_TRANSCRIPT_VIEW_MODE = "normal"')
    expect(source, 'legacy expanded mode').toContain('LEGACY_EXPANDED_TRANSCRIPT_VIEW_MODE = "expanded"')
  })

  it('设置命名空间与三个字段名逐项对得上', () => {
    const source = declarationOf('chat-settings.d.ts')
    if (source === undefined) return
    expect(source).toContain('CHAT_SETTINGS_NAMESPACE = "ui-chat"')
    expect(source).toContain('TRANSCRIPT_VIEW_FIELD = "transcriptView"')
    expect(source).toContain('COLLAPSE_TIMING_FIELD = "collapseTiming"')
    expect(source).toContain('FOLDED_REPLIES_FIELD = "foldedReplies"')
    const reader = readFileSync(fileURLToPath(new URL('../src/client/chat-settings.ts', import.meta.url)), 'utf8')
    expect(reader).toContain("CHAT_SETTINGS_NAMESPACE = 'ui-chat'")
  })

  it('四个能力字段的名字与语义都对得上（这是这一轮换成官方的核心）', () => {
    const source = declarationOf(join('client', 'presentation-policy.d.ts'))
    if (source === undefined) {
      console.warn('skip: 没有 presentation-policy.d.ts，四个能力字段未核对')
      return
    }
    /* 字段名逐个钉住：本仓的 `WorkStepsPolicy` 就是它的镜像，官方改名了这里要红。 */
    for (const field of ['foldCompletedTurns', 'stepGrouping', 'liveProcessDetail', 'settledReasoningPreview']) {
      expect(source, `官方策略少了 ${field}`).toContain(field)
    }
    /* `stepGrouping` 的取值也必须逐格照抄。 */
    expect(source, 'stepGrouping 取值').toContain("'collapsed' | 'history' | 'none'")
  })
})
