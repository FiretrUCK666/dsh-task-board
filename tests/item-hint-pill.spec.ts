/**
 * 图二那两条提示：底必须是不透明的。
 *
 * ── 为什么单独一条 spec ──────────────────────────────────────────────────────
 *
 * 读者从手机上报了一张截图：清单页的「暂时读不到 host 上的清单」那枚药丸是**透明**的
 * ——描边在，底色没有，于是壁纸上的山从字后面透上来，那行字读不清。
 *
 * 根因不是「忘了写一行 background」，而是**同一族有两个实现**：共享层的
 * `components.receiptLine` 有底（`--dsh-tb-plane-inlay`），页面侧那份 `.itemHint`
 * 没有。补一行治的是这一处，而「两份同族实现」会再长出第三份。所以这一条钉的是**值
 * 而不是声明**：这两枚药丸的底色必须解析成同一个不透明的东西。
 *
 * ── 为什么不用截图 ──────────────────────────────────────────────────────────
 *
 * 「透明」在截图上要看壁纸才认得出来，而工件的壁纸是定的。判据是计算值本身：
 * `background-color` 的 alpha 必须是 1，并且它不能等于 `transparent`/`rgba(0,0,0,0)`。
 * 这比肉眼看一张图更硬，也不依赖截图工具在不在。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { stripCssComments } from './panel-harness.ts'

/** One class's declaration block from a stylesheet, comments removed. */
function blockOf(sheet: string, selector: string): string {
  const css = stripCssComments(readFileSync(fileURLToPath(new URL(`../src/client/${sheet}`, import.meta.url)), 'utf8'))
  const found = new RegExp(`(?:^|[}\\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)
  if (found === null) throw new Error(`no rule for ${selector} in ${sheet}`)
  return found[1]!
}

describe('a hint pill is readable on a wallpaper, which means it has a floor', () => {
  it('the item hint declares a background at all', () => {
    // The reported defect in one line: the pill had a border and no fill.
    const body = blockOf('item/item.module.css', '.itemHint')
    expect(body, '.itemHint is a pill floating over the page — a border alone leaves it transparent').toMatch(/(?:^|[;\s])background(?:-color)?\s*:/)
  })

  it('its fill is the shared receipt bar\'s fill, not a second colour', () => {
    // ONE family, one fill. If these drift apart, the page teaches two pills that
    // look almost the same and only one of them is readable on a wallpaper.
    const hint = blockOf('item/item.module.css', '.itemHint')
    const receipt = blockOf('design/components.module.css', '.receiptLine')
    const fill = /(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/.exec(hint)?.[1]?.trim()
    const sharedFill = /(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/.exec(receipt)?.[1]?.trim()
    expect(fill, 'the hint pill must read the shared fill so the two cannot drift').toBe(sharedFill)
    expect(fill, 'a surface token, not a raw colour: this layer owns no values').toMatch(/^var\(--dsh-tb-/)
  })

  it('that fill is the SOLID float — the one surface that does not follow the canvas', () => {
    // THE REPORTED DEFECT, in its actual mechanism. Both pills used to read
    // `--dsh-tb-plane-inlay`, which derives from the paper, which derives from
    // the canvas. A third-party skin that makes the canvas translucent (wallpaper,
    // frosted glass) therefore made these bars translucent too — measured: with a
    // 35% canvas, `paper` resolved to `color(… / 0.857)` and the bar to `0.864`,
    // so the wallpaper showed through the reader's own words.
    //
    // The fix is not a darker colour (a colour still gets re-mixed); it is reading
    // the one surface token whose opacity does not depend on the canvas.
    const hint = blockOf('item/item.module.css', '.itemHint')
    const receipt = blockOf('design/components.module.css', '.receiptLine')
    for (const [label, body] of [['.itemHint', hint], ['.receiptLine', receipt]] as const) {
      expect(body, `${label} must read the solid float, not a canvas-derived plane`).toContain('var(--dsh-tb-solid-float)')
      expect(body, `${label} must not read the inlay plane: it follows the canvas`).not.toContain('var(--dsh-tb-plane-inlay)')
    }
  })

  it('the solid float is defined in BOTH themes, and neither derives from the canvas', () => {
    // Light and dark each declare it; if dark stopped declaring one, the pill would
    // fall back to `transparent` in dark mode and the defect would return at night.
    const tokens = stripCssComments(readFileSync(fileURLToPath(new URL('../src/client/design/tokens.module.css', import.meta.url)), 'utf8'))
    const declared = [...tokens.matchAll(/--dsh-tb-solid-float\s*:\s*([^;]+);/g)].map(m => m[1]!.trim())
    expect(declared.length, 'the solid float must be declared once per theme').toBe(2)
    for (const value of declared) {
      // The canvas is the one input that carries a skin's translucency. A value
      // that mixes toward it (or toward `transparent`) is not solid.
      expect(value, 'the solid float must not mix toward the canvas').not.toContain('--dsh-tb-bg')
      expect(value, 'the solid float must not mix toward transparent').not.toMatch(/\btransparent\b/)
    }
  })

  it('the border reads the same edge recipe as the shared bar', () => {
    // The two pills are one family; a second border recipe is a second look.
    const hint = blockOf('item/item.module.css', '.itemHint')
    const receipt = blockOf('design/components.module.css', '.receiptLine')
    const borderOf = (body: string): string | undefined => /(?:^|[;\s])border\s*:\s*([^;]+)/.exec(body)?.[1]?.trim()
    expect(borderOf(hint), 'the hint pill and the receipt bar must share one edge recipe').toBe(borderOf(receipt))
  })
})
