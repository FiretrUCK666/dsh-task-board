/**
 * 设计系统预览页的**隔离不变量**：它必须在产品界面里不存在。
 *
 * ── 这条钉的是什么 ──────────────────────────────────────────────────────────
 *
 * `src/client/gallery/` 是一个**给改界面的那个人看的**页面（`DESIGN.md` 的
 * 「预览页」一节）。它一旦出现在普通用户面前，就是把一份内部清单摆上了产品界面
 * ——那比不显示它更糟。
 *
 * `DESIGN.md` 写「它不在产品里出现」，而这句话必须读准：**它指「不在产品界面上
 * 出现」，不是「不进包」**。事实是：
 *
 *   - 代码**在**产物里（`lib/client.js` 含 `DesignGallery` 等符号）——一个包只有
 *     一份浏览器产物，这是不可避免的；
 *   - 它**不会出现**，靠的是两道运行期闸：宿主只在 `DSH_TASK_BOARD_DESIGN_PREVIEW=1`
 *     时宣告这个 surface，而浏览器侧读不到 manifest 时**默认不注册**。
 *
 * 在此之前**没有任何检查把这两道闸和产物内容对上**：删掉任意一道，测试全绿、
 * 门禁全绿，而普通用户会看到一份设计目录。
 *
 * ── 判据（条件不变量） ──────────────────────────────────────────────────────
 *
 * 这不是「断言产物里没有它」（那是假的，也是做不到的），而是：
 *
 *   若产物里**有**预览页代码，则两道闸**都必须**在。
 *
 * 这样「哪天拆包了、产物里真的没有它」时，这条检查自动成立且不需要改；而「代码
 * 在、闸被删了」那一刻它会红。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = new URL('..', import.meta.url)
const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, ROOT)), 'utf8')

/** 产物里只要出现这几个符号之一，就说明预览页代码被打进去了。 */
const BUNDLE_MARKERS = ['DesignGallery', 'gallerySpecimen', 'dsh-task-board-design']

const bundle = read('lib/client.js')
const bundledIn = BUNDLE_MARKERS.filter(marker => bundle.includes(marker))

describe('the design-system preview never reaches a user', () => {
  it('the client bundle is the artifact this check reads', () => {
    // 读不到产物说明检查本身失效——那时它下面每一条都会「通过」。
    expect(bundle.length, 'lib/client.js is empty or missing — run pnpm build').toBeGreaterThan(100_000)
  })

  it('IF the preview ships in the bundle, the host gate must be present', () => {
    if (bundledIn.length === 0) {
      // 拆包之后（产物里没有它）这一条自动成立，且不需要改这里。
      expect(bundledIn).toEqual([])
      return
    }
    const host = read('src/index.ts')
    expect(
      /process\.env\.DSH_TASK_BOARD_DESIGN_PREVIEW\s*===\s*'1'/.test(host),
      'the preview is in the bundle but the host no longer requires DSH_TASK_BOARD_DESIGN_PREVIEW — '
      + 'every install would announce the surface, and an ordinary user would meet a design catalogue',
    ).toBe(true)
  })

  it('IF the preview ships in the bundle, the client must fail CLOSED', () => {
    if (bundledIn.length === 0) return
    const register = read('src/client/gallery/register.tsx')
    /* 第三参数是 whenUnknown：产品面板传默认的 true（读不到宿主也注册），预览页
       必须传 false（读不到宿主就不注册）。方向相反是有意的。 */
    expect(
      /surfaceEnabled\(\s*'design'\s*,\s*manifest\s*,\s*false\s*\)/.test(register),
      'the preview registers when the manifest is unreadable — the failure direction is inverted, '
      + 'so an unreachable host puts a design catalogue in front of a user',
    ).toBe(true)
  })

  it('the product panels keep the OPPOSITE failure direction', () => {
    /* 反过来错也一样糟：产品面板读不到宿主时不注册，就等于一个坏掉的开关把插件
       变回了「装之前」。所以这条同时钉住两边，防止有人为了「一致」把它们统一。 */
    const root = read('src/client/index.ts')
    const itemRegister = read('src/client/item/register.tsx')
    const homeCall = /surfaceEnabled\('home',\s*manifest\)/.test(root)
    const itemCall = /surfaceEnabled\('items',\s*manifest\)/.test(itemRegister)
    expect(homeCall || itemCall, 'no product panel uses the default (register-anyway) direction any more — '
      + 'a broken switch would now hide the plugin instead of leaving it as it was').toBe(true)
  })

  it('the surface list still names the preview, so the switch has something to switch', () => {
    const surfaces = read('src/core/surfaces.ts')
    expect(surfaces, 'the preview dropped out of SURFACE_IDS — the host could no longer announce it')
      .toContain("'design'")
  })
})
