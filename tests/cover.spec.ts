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
 * （模块级的 Set + 一个 `announce`），浮层壳各自调一次 `useCover('<层名>')`，读的那个
 * 是 `useCovered('<层名>')`（`useSyncExternalStore`，外部事实，首帧就同步）。
 *
 * ── 为什么答案是一个「层」而不是一个布尔 ────────────────────────────────────
 *
 * 叠起来的时候有三层：看板 ← 卡片详情 ← 会话面板 ← 确认弹窗。读者滚动的那个面板
 * 下面是**卡片详情**，而它自己也是一个没停过的订阅者。一个布尔只答得了最底下那一层，
 * 于是「看板停了」之后手感仍然不对——停的那一层不是花钱的那一层。
 *
 * 这个文件钉的是那条契约本身：次序表只有一张、集合的身份、订阅的边沿、以及「失败方向
 * 是省不下来，不是坏掉」——一个忘了登记的壳只是让那一层照旧重算，不会让任何东西停在
 * 不该停的地方。
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
import { LAYERS, useCover, useCovered } from '../src/client/design/cover.ts'

/** One source file, by path from the repository root. */
const read = (rel: string): string => readFileSync(join(process.cwd(), ...rel.split('/')), 'utf8')

const source = read('src/client/design/cover.ts')
/** Comments stripped: a comment that NAMES a hook is not a call to it. */
const strip = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '')

describe('the cover registry is one fact, read by everyone', () => {
  it('is a module-level set, announced through one function', () => {
    // A counter would require every registration to be paired exactly once, and a
    // StrictMode double-invoked effect breaks that pairing; set membership cannot.
    const code = strip(source)
    expect(code).toMatch(/const covers = new Set<\{ layer: Layer; token: symbol \}>\(\)/)
    expect(code, 'membership must be announced, or the readers never hear the edge')
      .toMatch(/function announce\(\): void \{\s*\n\s*for \(const listener of \[\.\.\.listeners\]\) listener\(\)/)
  })

  it('the reader is a synchronised external subscription, not an effect', () => {
    /* `useState` + `useEffect` renders one frame with the WRONG answer first — and
     * that frame is exactly the one that does the work the cover exists to stop. */
    const code = strip(source)
    expect(code).toMatch(/useSyncExternalStore\(subscribe, snapshot, snapshot\)/)
    expect(code, 'a second copy of the same fact is how two layers come to disagree').not.toMatch(/useState/)
  })

  it('a mount registers and an unmount releases — the same token', () => {
    expect(source).toMatch(/const entry = \{ layer, token: Symbol\('cover'\) \}/)
    expect(source).toMatch(/covers\.add\(entry\)/)
    expect(source).toMatch(/covers\.delete\(entry\)/)
  })

  /**
   * 次序只有一张表，而且它是一条链——不是一串可以互换的名字。
   *
   * 「谁在谁上面」是这一页**结构上的事实**，不是运行时推得出来的：React 的 effect 子先
   * 父后跑，卡片详情会排在它自己打开的面板之后，恰好反过来。所以它必须被声明一次。
   */
  it('the order is ONE declared chain, bottom to top', () => {
    expect(LAYERS).toEqual(['board', 'detail', 'panel', 'dialog'])
    expect(strip(source), 'the order must be a declaration, not a runtime guess')
      .toMatch(/export const LAYERS = \['board', 'detail', 'panel', 'dialog'\] as const/)
    expect(strip(source), 'the reader must compare ranks, or every layer is 「above」 every other')
      .toMatch(/return top > rankOf\(me\)/)
  })
})

describe('useCovered sees the edge, live', () => {
  it('a registered cover reads true, an unregistered one reads false, and release reads false', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const seen: boolean[] = []
    function Probe(): ReactElement {
      seen.push(useCovered('board'))
      return createElement('span')
    }
    /* A shell that registers for as long as it is MOUNTED, exactly as the real ones
       do: every overlay in this product is conditionally mounted, so mount lifetime
       IS open lifetime. That is what replaces the old `active` flag. */
    function Shell(): ReactElement {
      useCover('detail')
      return createElement('i')
    }
    const render = async (active: boolean): Promise<void> => {
      await act(async () => {
        root.render(createElement('div', null, createElement(Probe), active ? createElement(Shell) : null))
      })
    }

    try {
      await render(false)
      expect(seen.at(-1), 'nothing is open, so nothing is covered').toBe(false)

      await render(true)
      expect(seen.at(-1), 'a registered cover must be visible to the reader in the same commit').toBe(true)

      await render(false)
      expect(seen.at(-1), 'an unmounted shell releases the cover').toBe(false)

      await render(true)
      expect(seen.at(-1), 'the hold must be re-enterable').toBe(true)

      await act(async () => { root.render(createElement(Probe)) })
      expect(seen.at(-1), 'unmounting the shell releases the cover').toBe(false)
    } finally {
      await act(async () => { root.unmount() })
      host.remove()
    }
  })

  it('a layer is not covered by itself, and a lower layer is', async () => {
    /* This is the whole point of the chain: the sheet the reader is scrolling sits
       ON TOP of the board, and it must not count itself as 「上面有东西」 — while the
       sheet BENEATH it must. A boolean cannot express either half. */
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const asBoard: boolean[] = []
    const asDetail: boolean[] = []
    function Probe({ layer }: { layer: 'board' | 'detail' }): ReactElement {
      const covered = useCovered(layer)
      if (layer === 'board') asBoard.push(covered)
      else asDetail.push(covered)
      return createElement('span')
    }
    function Shell({ layer }: { layer: 'panel' }): ReactElement {
      useCover(layer)
      return createElement('i')
    }
    const render = async (panelOpen: boolean): Promise<void> => {
      await act(async () => {
        root.render(createElement('div', null,
          createElement(Probe, { layer: 'board' }),
          createElement(Probe, { layer: 'detail' }),
          panelOpen ? createElement(Shell, { layer: 'panel' }) : null))
      })
    }

    try {
      await render(false)
      expect(asBoard.at(-1), 'nothing open, nothing covered').toBe(false)
      expect(asDetail.at(-1)).toBe(false)

      await render(true)
      expect(asBoard.at(-1), 'the panel covers the board').toBe(true)
      expect(asDetail.at(-1), 'the panel ALSO covers the sheet it was opened from').toBe(true)

      await render(false)
      expect(asBoard.at(-1)).toBe(false)
      expect(asDetail.at(-1), 'closing the panel releases the sheet, not only the board').toBe(false)
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
      seen.push(useCovered('board'))
      return createElement('span')
    }
    function Shell({ layer }: { layer: 'detail' | 'dialog' }): ReactElement {
      useCover(layer)
      return createElement('i')
    }

    const render = async (outer: boolean, inner: boolean): Promise<void> => {
      await act(async () => {
        root.render(createElement('div', null,
          createElement(Probe),
          outer ? createElement(Shell, { layer: 'detail' }) : null,
          inner ? createElement(Shell, { layer: 'dialog' }) : null))
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

  /**
   * 每一个声明了 `aria-modal` 的壳都欠被盖住的那一层一次登记，**而且它欠的是自己
   * 那一个层名**——报错层名会让停下的那一层不是花钱的那一层，而屏上不说话。
   */
  it('every modal shell registers, and names its own layer', () => {
    const shells: Array<{ file: string; layer: string }> = [
      { file: 'src/client/design/Dialog.tsx', layer: 'dialog' },
      { file: 'src/client/board/TaskDetail.tsx', layer: 'detail' },
      { file: 'src/client/board/SessionFrame.tsx', layer: 'panel' },
    ]
    for (const { file, layer } of shells) {
      const code = strip(read(file))
      expect(code, `${file} declares aria-modal, so it owes the covered layer a cover`)
        .toMatch(new RegExp(`useCover\\('${layer}'\\)`))
    }
  })
})

describe('the defect this fixes (stated as a contract)', () => {
  it('a held subscription still receives the POSITION half — that is how it learns to disappear', () => {
    /* The hold must not be 「什么都收不到」: a covered surface that receives no
     * notification at all can never learn that the layer above it closed. So the
     * listener compares the position fields and lets them through. This is the
     * contract that the close button depends on. */
    const hook = read('src/client/board/use-board-snapshot.ts')
    expect(hook, 'the position fields must be named in one place')
      .toMatch(/function samePlace\(a: BoardSnapshot, b: BoardSnapshot\): boolean \{[\s\S]*?selectedTaskId === b\.selectedTaskId[\s\S]*?boardOpen === b\.boardOpen/)
    expect(hook, 'the hold must be read through a ref, or the subscription rebuilds on the edge')
      .toMatch(/const heldRef = useRef\(held\)/)
    expect(hook, 'a held subscription must skip only the DATA half')
      .toMatch(/if \(heldRef\.current && previous !== undefined && samePlace\(previous, next\)\) return/)
    expect(hook, 'the reveal must re-read once, or the surface shows the frame from before the panel opened')
      .toMatch(/if \(held \|\| controller === undefined\) return/)
  })

  it('the sheet under the panel is held too, not only the board', () => {
    /* 卡片详情盖住看板，而它自己会被会话面板盖住。只停看板时，读者滚动的那个面板
     * 底下仍有一个每 3 秒重算整张卡的订阅者。 */
    const detail = strip(read('src/client/board/TaskDetail.tsx'))
    expect(detail, 'the detail sheet must read its own covered state')
      .toMatch(/const covered = useCovered\('detail'\)/)
    expect(detail, 'and hand it to its snapshot subscription')
      .toMatch(/useRequiredBoardSnapshot\(controller, covered\)/)
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
