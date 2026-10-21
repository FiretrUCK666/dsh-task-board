// @vitest-environment jsdom
/**
 * 主行动是「打开」，不是「切换」。
 *
 * 连按三次「新建一条」，每一次之后那张纸都必须在——按它的意图永远是
 * 「给我一张纸」，从来不是「把这张纸收起来」。收它有纸上那枚关闭与 Esc。
 *
 * 这一条同时钉住两档：宽档在顶栏那一枚、窄档在底部栏杆那一枚，两处是同一个动作。
 */
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { fixtures, mountPanel } from './panel-harness.ts'

const openCount = (): number => document.querySelectorAll('[role="dialog"]').length

const press = (button: Element | null | undefined, times: number): number[] => {
  const seen: number[] = []
  for (let i = 0; i < times; i += 1) {
    act(() => { (button as HTMLElement | null)?.click() })
    seen.push(openCount())
  }
  return seen
}

describe('新建一条是打开，不是切换', () => {
  it('窄档：底部栏杆那一枚连按三次，纸一直在', () => {
    const panel = mountPanel(fixtures(), 'list', 'narrow')
    try {
      const rail = panel.host.querySelector('[data-dsh-tb-thumbrail]')
      const button = rail?.querySelector('button')
      expect(button, '窄档没有底部栏杆的按钮').not.toBeNull()

      const seen = press(button, 3)
      expect(seen, '连按时纸张忽有忽无 —— 那个按钮在切换').toEqual([1, 1, 1])
    } finally {
      panel.dispose()
    }
  })

  it('宽档：顶栏那一枚连按三次，纸一直在', () => {
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const button = [...panel.host.querySelectorAll('button')]
        .find((b) => (b.textContent ?? '').includes('新建一条'))
      expect(button, '宽档没有新建按钮').not.toBeUndefined()

      const seen = press(button, 3)
      expect(seen, '宽档连按时纸张忽有忽无').toEqual([1, 1, 1])
    } finally {
      panel.dispose()
    }
  })

  it('两档都能把那张纸打开', () => {
    for (const band of ['narrow', 'wide'] as const) {
      const panel = mountPanel(fixtures(), 'list', band)
      try {
        const candidates = [...panel.host.querySelectorAll('button')]
          .filter((b) => (b.textContent ?? '').includes('新建一条'))
        const pick = band === 'narrow'
          ? panel.host.querySelector('[data-dsh-tb-thumbrail] button')
          : candidates[0]
        expect(pick, band + ' 档找不到新建按钮').not.toBeNull()

        act(() => { (pick as HTMLElement).click() })
        expect(openCount(), band + ' 档按下去没有出现那张纸').toBe(1)
      } finally {
        panel.dispose()
      }
    }
  })
})
