/**
 * Card chip label composition. The compact card's badges are assembled from
 * locale copy through the pure helpers in TaskCard.tsx; this spec pins the
 * exact strings in both languages for every run state (plain running + each
 * waiting kind), so the card's text can never drift from its copy and the
 * composed labels stay short enough to truncate gracefully instead of
 * overflowing (see card-layout.spec.ts for the CSS side of that contract).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executionNoLabel, runningStateLabel, settledChipLabel } from '../src/client/board/TaskCard.tsx'

function useLanguage(lang: string): void {
  vi.stubGlobal('document', { documentElement: { lang } })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('card chip label composition', () => {
  it('running state: plain running keeps a short one-word label (zh)', () => {
    useLanguage('zh')
    expect(runningStateLabel(undefined)).toBe('进行中')
  })

  it('running state: each user-blocking kind is named (zh)', () => {
    useLanguage('zh')
    expect(runningStateLabel('approval')).toBe('等待回应 · 权限审批')
    expect(runningStateLabel('plan-review')).toBe('等待回应 · 计划确认')
    expect(runningStateLabel('question')).toBe('等待回应 · 提问')
  })

  it('running state: english mirror', () => {
    useLanguage('en')
    expect(runningStateLabel(undefined)).toBe('Running')
    expect(runningStateLabel('approval')).toBe('Waiting for you · Approval')
    expect(runningStateLabel('plan-review')).toBe('Waiting for you · Plan review')
    expect(runningStateLabel('question')).toBe('Waiting for you · Question')
  })

  it('execution sequence label renders the run number (zh / en)', () => {
    useLanguage('zh')
    expect(executionNoLabel(1)).toBe('第 1 次执行')
    expect(executionNoLabel(12)).toBe('第 12 次执行')
    expect(executionNoLabel(123)).toBe('第 123 次执行')
    useLanguage('en')
    expect(executionNoLabel(1)).toBe('Run 1')
    expect(executionNoLabel(123)).toBe('Run 123')
  })

  it('settled count label (zh / en)', () => {
    useLanguage('zh')
    expect(settledChipLabel(0)).toBe('0 次执行')
    expect(settledChipLabel(3)).toBe('3 次执行')
    useLanguage('en')
    expect(settledChipLabel(0)).toBe('0 runs')
    expect(settledChipLabel(3)).toBe('3 runs')
  })
})
