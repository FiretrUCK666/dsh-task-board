/**
 * 覆盖登记表：一层浮层打开时，被它盖住的那一层**一个字的活都不干**。
 *
 * ── 为什么这件事要有一套自己的契约文件 ──────────────────────────────────────
 *
 * 「盖住」这件事一共管四层：动画、绘制、布局、React 的重算。前两层由
 * `board.module.css` 的 `:has(.modalBackdrop)` 管住（动画 `paused`、列
 * `content-visibility: hidden`），后两层没有任何选择器能管——React 在 `setState`
 * 之前不会去问一个选择器匹配了什么，而 FLIP 的几何读发生在提交之后。
 *
 * 所以这份登记表必须自己成立，而它成立的方式只有一条：**登记与揭开都只有一个入口**
 * （模块级的 Set + 一个 `announce`），三个浮层壳各自调一次 `useCover(true)`，读的那个
 * 是 `useCovered()`（`useSyncExternalStore`，外部事实，首帧就同步）。
 *
 * 这个文件钉的是那条契约本身：集合的身份、订阅的边沿、以及「失败方向是省不下来，
 * 不是坏掉」——一个忘了登记的壳只是让那一层照旧重算，不会让任何东西停在不该停的地方。
 *
 * 它跑在 jsdom 下（要真挂一次 hook 才能证明边沿），所以文件声明环境；也正因为如此，
 * 源码用 `process.cwd()` 读，不用 `import.meta.url`（那边在这里是 http URL）。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useCover, useCovered } from '../src/client/design/cover.ts'

/** One source file, by path from the repository root. */
const read = (rel: string): string => readFileSync(join(process.cwd(), ...rel.split('/')), 'utf8')

const source = read('src/client/design/cover.ts')

describe('the cover registry is one fact, read by everyone', () => {
  it('is a module-level set, announced through one function', () => {
    // A counter would require every registration to be paired exactly once, and a
    // StrictMode double-invoked effect breaks that pairing; set membership cannot.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).toMatch(/const covers = new Set<symbol>\(\)/)
    expect(code, 'membership must be announced, or the readers never hear the edge')
      .toMatch(/function announce\(\): void \{\s*\n\s*for \(const listener of \[\.\.\.listeners\]\) listener\(\)/)
  })

  it('the reader is a synchronised external subscription, not an effect', () => {
    /* `useState` + `useEffect` renders one frame with the WRONG answer first — and
     * that frame is exactly the one that does the work the cover exists to stop. */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).toMatch(/useSyncExternalStore\(subscribe, snapshot, snapshot\)/)
    expect(code, 'a second copy of the same fact is how two layers come to disagree').not.toMatch(/useState/)
  })

  it('an inactive cover never registers', () => {
    expect(source).toMatch(/if \(!active\) return undefined/)
  })

  it('a mount registers and an unmount releases — the same token', () => {
    expect(source).toMatch(/const token = Symbol\('cover'\)/)
    expect(source).toMatch(/covers\.add\(token\)/)
    expect(source).toMatch(/covers\.delete\(token\)/)
  })
})

describe('useCovered sees the edge, live', () => {
  it('a registered cover reads true, an inactive one reads false, and release reads false', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const seen: boolean[] = []
    function Probe(): ReactElement {
      seen.push(useCovered())
      return createElement('span')
    }
    /** A shell that registers while open, exactly as the three real ones do. */
    function Shell({ active }: { active: boolean }): ReactElement {
      useCover(active)
      return createElement('i')
    }
    const render = async (active: boolean): Promise<void> => {
      await act(async () => {
        root.render(createElement('div', null, createElement(Probe), createElement(Shell, { active })))
      })
    }

    try {
      await render(false)
      expect(seen.at(-1), 'nothing is open, so nothing is covered').toBe(false)

      await render(true)
      expect(seen.at(-1), 'a registered cover must be visible to the reader in the same commit').toBe(true)

      await render(false)
      expect(seen.at(-1), 'an inactive cover must not hold the layer').toBe(false)

      await render(true)
      expect(seen.at(-1), 'the hold must be re-enterable').toBe(true)

      await act(async () => { root.render(createElement(Probe)) })
      expect(seen.at(-1), 'unmounting the shell releases the cover').toBe(false)
    } finally {
      await act(async () => { root.unmount() })
      host.remove()
    }
  })

  it('two covers are one fact, and closing one does not release the other', async () => {
    /* This is why the registry is a SET and not a boolean prop: a detail sheet can
       open a confirm dialog on top of itself, and the board must stay held until
       BOTH are gone. A flag would release on the first close. */
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const seen: boolean[] = []
    function Probe(): ReactElement {
      seen.push(useCovered())
      return createElement('span')
    }
    function Shell({ active }: { active: boolean }): ReactElement {
      useCover(active)
      return createElement('i')
    }
    const render = async (outer: boolean, inner: boolean): Promise<void> => {
      await act(async () => {
        root.render(createElement('div', null,
          createElement(Probe),
          createElement(Shell, { active: outer }),
          createElement(Shell, { active: inner })))
      })
    }

    try {
      await render(true, true)
      expect(seen.at(-1)).toBe(true)
      await render(true, false)
      expect(seen.at(-1), 'the outer layer still covers the board').toBe(true)
      await render(false, false)
      expect(seen.at(-1)).toBe(false)
    } finally {
      await act(async () => { root.unmount() })
      host.remove()
    }
  })

  it('the three overlay shells each register', () => {
    const shells = [
      'src/client/design/Dialog.tsx',
      'src/client/board/TaskDetail.tsx',
      'src/client/board/SessionFrame.tsx',
    ]
    for (const rel of shells) {
      const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, '')
      expect(code, `${rel} declares aria-modal, so it owes the covered layer a cover`)
        .toMatch(/useCover\(true\)/)
    }
  })
})

describe('the defect this fixes (stated as a contract)', () => {
  it('the board holds its subscription while covered and re-reads once on reveal', () => {
    const hook = read('src/client/board/use-board-snapshot.ts')
    /* The hold must be read through a ref: rebuilding the subscription on the edge
     * would drop the notifications that arrive between the two commits. */
    expect(hook, 'a hold read from the render scope would rebuild the subscription on the edge')
      .toMatch(/const heldRef = useRef\(held\)/)
    expect(hook, 'the listener must stop accepting snapshots while held')
      .toMatch(/if \(heldRef\.current\) return/)
    expect(hook, 'the reveal must re-read once, or the board shows the frame from before the panel opened')
      .toMatch(/if \(held \|\| controller === undefined\) return/)
  })

  it('every rect read lives behind the structure decision, in two named homes', () => {
    const flip = read('src/client/board/use-flip.ts')
    const decisionAt = flip.indexOf('const decision = flipDecisionOf(')
    const skipAt = flip.indexOf("if (decision.kind === 'skip') return")
    const measureAt = flip.indexOf('const region = measureRegion(container)')
    expect(decisionAt, 'the decision is missing').toBeGreaterThan(-1)
    expect(skipAt, 'the skip short-circuit is missing').toBeGreaterThan(-1)
    expect(measureAt, 'the measurement is missing').toBeGreaterThan(-1)
    expect(decisionAt, 'the decision must precede the short-circuit').toBeLessThan(skipAt)
    expect(skipAt, 'no rect may be read before the structure says it moved').toBeLessThan(measureAt)

    /* THE CHEAP HALF MUST STAY CHEAP. The signature walk is what decides whether a
     * rect may be read at all, and it runs after every commit — so it may not read
     * a box, resolve a style, or ask for a scroll size. Anything on that list would
     * put the layout flush back on the commit path, which is the defect. */
    const signature = /export function structureSignatureOf[\s\S]*?\n\}/.exec(flip)?.[0] ?? ''
    expect(signature, 'structureSignatureOf not found').not.toBe('')
    expect(signature, 'a geometry read here forces a layout pass on every commit')
      .not.toMatch(/getBoundingClientRect|offsetWidth|offsetHeight|clientHeight|scrollHeight|getComputedStyle/)
  })

  it('the remembered position is a CONTENT position, so a skip cannot stale it', () => {
    /* Skipping renders means the memory can be older than the last paint: a column
     * may have scrolled since. A remembered VIEWPORT rect would then fling the card
     * in from the wrong place — so the memory stores offsets from the container plus
     * the scroll offsets, and the animation reconstructs the viewport position from
     * the CURRENT frame. This is what makes "measure only when the structure moved"
     * honest instead of merely faster. */
    const flip = read('src/client/board/use-flip.ts')
    expect(flip, 'the memory must store a content offset, not a viewport rect').toMatch(/contentTop:/)
    expect(flip, 'the memory must store the horizontal content offset too').toMatch(/contentLeft:/)
    expect(flip, 'the reconstruction must read the live frame').toMatch(/const frame = liveFrameOf\(container\)/)
    expect(flip, 'the departure point must be reconstructed, not remembered as a rect')
      .toMatch(/const origin = rememberedOriginOf\(place, frame\)/)
  })

  it('a reveal rebases the baseline and plays nothing', () => {
    const flip = read('src/client/board/use-flip.ts')
    expect(flip, 'the reveal edge must feed the quiet flag').toMatch(/const quiet = disabled \|\| reducedMotion\(\) \|\| revealed/)
    expect(flip, 'the reveal must be detected from the passed key').toMatch(/const revealed = previousReveal\.current !== revealKey/)
  })
})
