/**
 * 卡片上那串会话圆点，必须始终是一扇门。
 *
 * ── 这里钉的是什么 ──────────────────────────────────────────────────────────
 *
 * 一个**不是缺陷、但用户每天都撞上**的事实：卡片是不进详情就能看见会话的唯一
 * 地方，而过去那串圆点在「没有未读」时只是读数——人能看见「这张卡有三个会话」，
 * 却一个都点不开。圆点的名字挂在 `title` 上，而**触屏没有 hover**（硬性规范
 * 11③），所以手机上连那行字都不存在。
 *
 * 这不是布局问题，是**控件性质**问题：按下去什么都不会发生的形状，比一句没有
 * 更糟（硬性规范同一条）。所以判据读的是**结构**：那一段的渲染里，按钮必须
 * 包住整串圆点，且「有未读」不能是进入按钮分支的条件。
 *
 * ── 为什么用静态判据而不是渲染 ──────────────────────────────────────────────
 *
 * 这个缺陷的形状是**一个条件和它的分支**：`if (unread === undefined || …) return
 * strip`。把它渲染出来再断言「有按钮」也能抓到，但那要求整套装配层；而真正会
 * 复发的地方是那一行条件——它短、看起来合理、改回来时**屏幕上一片正常**。
 * 静态判据正好盯住它。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CARD = readFileSync(fileURLToPath(new URL('../src/client/board/TaskCard.tsx', import.meta.url)), 'utf8')

/** The dots block: from its own guard to the closing paren before the colour bar. */
function dotsBlock(): string {
  const at = CARD.indexOf('{dots !== undefined && dots.length > 0 && (() => {')
  expect(at, 'the session-dot block is gone — either it was renamed or the dots were removed entirely').toBeGreaterThan(-1)
  // Take a generous window: the block is everything between this guard and the
  // colour bar that follows it.
  const end = CARD.indexOf('{onColorPick !== undefined', at)
  expect(end, 'the colour bar that closes the dots block is gone').toBeGreaterThan(at)
  return CARD.slice(at, end)
}

describe('the session dots on a card are a door, not a readout', () => {
  it('renders a button whenever the caller offered one, not only when a dot is unread', () => {
    const block = dotsBlock()
    // The door exists…
    expect(block, 'the dots no longer render a button at all').toContain('<button')
    // …and entering it does NOT depend on there being an unread dot: that is the
    // exact condition that made the strip a readout for every card without one.
    expect(
      /if\s*\(\s*unread\s*===\s*undefined/.test(block),
      'the button is skipped when nothing is unread — the strip is a readout again, and a phone user cannot open any session from the card',
    ).toBe(false)
  })

  it('still refuses to render a door the assembly did not provide', () => {
    // The other half of the same law: a button that does nothing is worse than a
    // readout, so an absent handler must fall back to the plain strip.
    expect(dotsBlock(), 'the strip renders a button even with no handler to call').toContain('if (onOpenSession === undefined) return strip')
  })

  it('names the destination, and the unread case keeps its own name', () => {
    // The button wraps decorative dots, so its accessible name is the ONLY name it
    // has. A nameless button is unusable by assistive tech and unlabelable by eye.
    const block = dotsBlock()
    expect(block, 'the door has no aria-label').toContain('aria-label={label}')
    expect(block, 'the unread case lost its specific wording').toContain("t('card.openUnread')")
    expect(block, 'the general case has no wording of its own').toContain("t('card.openSessions')")
  })

  it('sends both cases through ONE funnel, with the unread session winning when there is one', () => {
    // `openTaskAtSession` treats `undefined` as "just open the card", which is
    // exactly what the session-list door wants. A second callback for the two
    // cases would be two doors to keep in step.
    expect(dotsBlock(), 'the door does not fall back to the card itself').toContain('onOpenSession(unread?.sessionId)')
  })
})

describe('the probe bites: the old condition is reported', () => {
  it('a synthetic source with the readout condition is caught', () => {
    // Proving the check reads STRUCTURE: feed it the exact shape that shipped,
    // and the same predicate must fire. (The comment-stripping itself is covered
    // by the gates that own that scanner; asserting it again here would be a
    // second opinion about somebody else's contract.)
    const shipped = `
      {dots !== undefined && (() => {
        const strip = <span>{dots.map(dot => <span key={dot.sessionId} />)}</span>
        const unread = dots.find(dot => dot.state === 'unread')
        if (unread === undefined || onOpenSession === undefined) return strip
        return <button aria-label={t('card.openUnread')}>{strip}</button>
      })()}
      {onColorPick !== undefined && <span />}
    `
    const block = shipped.slice(shipped.indexOf('{dots !== undefined'), shipped.indexOf('{onColorPick !== undefined'))
    expect(/if\s*\(\s*unread\s*===\s*undefined/.test(block), 'the predicate missed the shipped shape it exists for').toBe(true)
  })
})
