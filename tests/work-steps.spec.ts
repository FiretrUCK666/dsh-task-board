/**
 * 工作步骤的判据：四档详略 × 两种收起时机 × 两种回复口径，以及读设置的四条边界。
 *
 * 这一节钉的是**一件事**：读者在官方设置里选了什么，评论区就画什么。所以每条用例
 * 都在问「这一组选择下，一轮该折还是该摊、折里放多细、折外留哪几条」——正是那位
 * 读者说「我评论一句，他回复一段话」时要求的那三件事。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORK_STEPS,
  collapseTimingOf,
  finalReplyOf,
  foldSummaryOf,
  foldedRepliesOf,
  prefsOf,
  shapeOfWorkSteps,
  shouldFoldTurn,
  viewOf,
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
    steps: [{ kind: 'tool', id: 'c1', name: 'read', state: 'settled', step: 1 }],
    replies: [{ id: 'a1', text: '做完了', at: 2 }],
    endedAt: 3,
    endReason: 'completed',
    ...over,
  }
}

/** 三件事的简写。 */
function prefsOf3(view: WorkStepsPrefs['view'], collapseTiming: WorkStepsPrefs['collapseTiming'] = 'completion', foldedReplies: WorkStepsPrefs['foldedReplies'] = 'final'): WorkStepsPrefs {
  return { view, collapseTiming, foldedReplies }
}

describe('shapeOfWorkSteps', () => {
  it('四档只决定折里放多细；只有完全展开不折', () => {
    expect(shapeOfWorkSteps(prefsOf3('compact'))).toMatchObject({ foldCompleted: true, showStepNames: false, showReasoning: false })
    expect(shapeOfWorkSteps(prefsOf3('standard'))).toMatchObject({ foldCompleted: true, showStepNames: true, showReasoning: false })
    expect(shapeOfWorkSteps(prefsOf3('detailed'))).toMatchObject({ foldCompleted: true, showStepNames: true, showReasoning: true })
    expect(shapeOfWorkSteps(prefsOf3('verbose'))).toMatchObject({ foldCompleted: false, showStepNames: true, showReasoning: true })
  })

  it('两个开关独立于详略档：回复口径与收起时机各自生效', () => {
    expect(shapeOfWorkSteps(prefsOf3('detailed', 'completion', 'all')).keepAllReplies).toBe(true)
    expect(shapeOfWorkSteps(prefsOf3('detailed', 'completion', 'final')).keepAllReplies).toBe(false)
    expect(shapeOfWorkSteps(prefsOf3('detailed', 'next-input')).collapseOnNextInput).toBe(true)
    expect(shapeOfWorkSteps(prefsOf3('detailed', 'completion')).collapseOnNextInput).toBe(false)
    /* 完全展开档无论如何都露出全部回复（它连折都没有）。 */
    expect(shapeOfWorkSteps(prefsOf3('verbose', 'completion', 'final')).keepAllReplies).toBe(true)
  })
})

describe('shouldFoldTurn', () => {
  it('跑完的正常轮该折', () => {
    expect(shouldFoldTurn(turnOf(), shapeOfWorkSteps(prefsOf3('detailed')))).toBe(true)
  })

  it('还在跑的轮永不折（折起来等于说它停了）', () => {
    expect(shouldFoldTurn(turnOf({ endedAt: undefined, endReason: undefined }), shapeOfWorkSteps(prefsOf3('detailed')))).toBe(false)
  })

  it('读者插过话的轮永不折', () => {
    const turn = turnOf({ interjections: [{ id: 'm2', text: '顺便问一句', at: 1 }] })
    expect(shouldFoldTurn(turn, shapeOfWorkSteps(prefsOf3('detailed')), { isLatest: false, hasReaderTurn: true })).toBe(false)
  })

  it('结束得不好的轮永不折（失败现场要露出来）', () => {
    expect(shouldFoldTurn(turnOf({ endReason: 'aborted' }), shapeOfWorkSteps(prefsOf3('detailed')))).toBe(false)
    expect(shouldFoldTurn(turnOf({ endReason: 'interrupted' }), shapeOfWorkSteps(prefsOf3('detailed')))).toBe(false)
  })

  it('next-input 时机下最新那一轮先摊着，直到出现更新的一轮', () => {
    const shape = shapeOfWorkSteps(prefsOf3('detailed', 'next-input'))
    expect(shouldFoldTurn(turnOf(), shape, { isLatest: true, hasReaderTurn: false })).toBe(false)
    expect(shouldFoldTurn(turnOf(), shape, { isLatest: false, hasReaderTurn: false })).toBe(true)
  })

  it('过程为空的轮不折（点开是空的折比不折更糟）', () => {
    expect(shouldFoldTurn(turnOf({ steps: [] }), shapeOfWorkSteps(prefsOf3('detailed')))).toBe(false)
  })

  it('完全展开档一道折都不折', () => {
    const shape = shapeOfWorkSteps(prefsOf3('verbose'))
    expect(shouldFoldTurn(turnOf(), shape)).toBe(false)
  })
})

describe('finalReplyOf', () => {
  it('「最后那段话」是最后一条**带文字**的回复，不是最后那条消息', () => {
    const turn = turnOf({
      replies: [
        { id: 'a1', text: '途中一句', at: 1 },
        { id: 'a2', text: '最终回答', at: 2 },
        { id: 'a3', text: '', images: [{ attachmentId: 'att-1', mediaType: 'image/png' }], at: 3 },
      ],
    })
    expect(finalReplyOf(turn)?.id).toBe('a2')
  })

  it('一轮没有文字回复时返回 undefined（纯图片轮）', () => {
    expect(finalReplyOf(turnOf({ replies: [{ id: 'a1', text: '', at: 1 }] }))).toBeUndefined()
    expect(finalReplyOf(turnOf({ replies: [] }))).toBeUndefined()
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

  it('运行中的轮点出当前工具名（读者扫一眼要知道它在动什么）', () => {
    const turn = turnOf({ endedAt: undefined, steps: [{ kind: 'tool', id: 'c1', name: 'write', state: 'running', step: 1 }] })
    expect(foldSummaryOf(turn, shapeOfWorkSteps(prefsOf3('detailed')), words)).toBe('正在调用 write')
  })

  it('跑完的轮按详略给结算：简档不数思考，详档数', () => {
    const turn = turnOf({
      steps: [
        { kind: 'tool', id: 'c1', name: 'read', state: 'settled', step: 1 },
        { kind: 'reasoning', id: 'r1', chars: 10, preview: '想', step: 1 },
        { kind: 'context', id: 'x1', producer: 'AGENTS.md', summary: '', at: 0 },
      ],
    })
    expect(foldSummaryOf(turn, shapeOfWorkSteps(prefsOf3('compact')), words)).toBe('1 次工具调用 · 1 条上下文')
    expect(foldSummaryOf(turn, shapeOfWorkSteps(prefsOf3('detailed')), words)).toBe('1 次工具调用 · 1 段思考 · 1 条上下文')
  })

  it('每一档都有话说：没有工具/思考/上下文时退回状态词，不留空折行', () => {
    expect(foldSummaryOf(turnOf({ steps: [] }), shapeOfWorkSteps(prefsOf3('compact')), words)).toBe('工作步骤')
  })
})

describe('读设置：逐项窄化，读不出来就是没读到', () => {
  it('四档与两种历史拼写', () => {
    expect(viewOf('compact')).toBe('compact')
    expect(viewOf('verbose')).toBe('verbose')
    /* 两种历史拼写读作 detailed：老设置文档里还留着它们。 */
    expect(viewOf('normal')).toBe('detailed')
    expect(viewOf('expanded')).toBe('detailed')
    expect(viewOf('huge')).toBeUndefined()
    expect(viewOf(undefined)).toBeUndefined()
  })

  it('收起时机与回复口径各自只认两个值', () => {
    expect(collapseTimingOf('completion')).toBe('completion')
    expect(collapseTimingOf('next-input')).toBe('next-input')
    expect(collapseTimingOf('never')).toBeUndefined()
    expect(foldedRepliesOf('all')).toBe('all')
    expect(foldedRepliesOf('final')).toBe('final')
    expect(foldedRepliesOf('some')).toBeUndefined()
  })

  it('逐项回落：只改一项不打回另外两项', () => {
    /* 读者只把收起时机改成 next-input，另外两项没动过 → 它们保持默认。 */
    expect(prefsOf({ collapseTiming: 'next-input' })).toEqual({
      view: DEFAULT_WORK_STEPS.view,
      collapseTiming: 'next-input',
      foldedReplies: DEFAULT_WORK_STEPS.foldedReplies,
    })
    /* 一个不认识的整份快照：三项全默认，不抛。 */
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
 * 这一条拿**实际安装的宿主声明文件**逐项对账。官方加一档、改一个字，它报红并指名；
 * 于是「以后官方改了我们怎么知道」有一个机械答案，不靠谁记得来看。
 */
describe('词表镜像与实际安装的宿主一致', () => {
  /** 那个声明文件；找不到（没装宿主）时返回 undefined 并明说这一条没核。 */
  function chatSettingsDeclaration(): string | undefined {
    const candidates = [
      join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
      join(process.env.HOME ?? '', '.npm', 'node_modules'),
    ]
    for (const root of candidates) {
      const file = join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'types', 'chat-settings.d.ts')
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
    const source = chatSettingsDeclaration()
    if (source === undefined) {
      /* 没装宿主 = 这条没核，而不是通过（硬性规范 15）。 */
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
    const source = chatSettingsDeclaration()
    if (source === undefined) return
    expect(source).toContain('CHAT_SETTINGS_NAMESPACE = "ui-chat"')
    expect(source).toContain('TRANSCRIPT_VIEW_FIELD = "transcriptView"')
    expect(source).toContain('COLLAPSE_TIMING_FIELD = "collapseTiming"')
    expect(source).toContain('FOLDED_REPLIES_FIELD = "foldedReplies"')
    /* 本仓库读的就是这个命名空间：两处写同一个名字的那天，其中一处会失效。 */
    const reader = readFileSync(fileURLToPath(new URL('../src/client/chat-settings.ts', import.meta.url)), 'utf8')
    expect(reader).toContain("CHAT_SETTINGS_NAMESPACE = 'ui-chat'")
  })
})
