/**
 * 形态层只有一处家：材质、焦点环、抬升、滚动条。
 *
 * ── 这一道门禁为什么存在 ───────────────────────────────────────────────────────
 *
 * 它抓的是一类**不会报错的**缺陷：同一段形状被抄成多份。抄一份的代价不是那几行，
 * 是**改一处不报错**——改了这一处，另一处留在旧值上，而屏上不会有人说一句话。
 *
 * CSS Modules 让这件事更安静：类名属于**表**（构建按文件名哈希），所以一张表里
 * 写另一张表的类名在生产包里**匹配不到任何东西**，静默失效；跨表共享的形状只能
 * 住在 `design/`，由页面**挂 className** 用。
 *
 * ── 它守的四条 ────────────────────────────────────────────────────────────────
 *
 *   1. **材质（底色 + 影）只有一处家。** 一张纸的签名是「受光的顶边 + 落在桌面上的
 *      投影」两笔都在；页面类不自己画那两笔，而是把「我这张纸的底色是哪一档」「我的
 *      影是哪几笔」交给共享层的两个槽。
 *   2. **焦点环的宽度只有一个数**（`--dsh-tb-ring-w`），输入框的那一枚柔晕只有一处
 *      配方。环的**笔法**（影环还是 outline 环）留给页面——那是页面自己的方向。
 *   3. **抬升只有一处家。** 悬停抬起、选中抬起与按下回位是共享形态，页面表里不再
 *      抄第二份。
 *   4. **细滚动条只有一处家**（座位级），页面表里不再写第二份。
 *
 * ── 判据读结构，不读字样（硬性规范 14） ─────────────────────────────────────
 *
 * 扫描先剥注释再匹配：注释里出现「令牌」两个字不是一次令牌使用。每一道判据都配
 * 一条**自证**（种在记忆里的表，不是磁盘上那一张——在真实文件上改一下再改回来，
 * 证的是「改动生效」而不是「门禁会红」，硬性规范 16）。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

/** The shared shape layer and the page sheets. */
const SHAPE_SHEET = 'src/client/design/base.module.css'
const COMPONENT_SHEET = 'src/client/design/components.module.css'
const TOKEN_SHEET = 'src/client/design/tokens.module.css'
const PAGE_SHEETS = [
  'src/client/board.module.css',
  'src/client/item/item.module.css',
  'src/client/home/home.module.css',
  'src/client/gallery/gallery.module.css',
]

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/** The sheet's text with its comments gone. */
export function sheet(rel: string): string {
  return read(rel).replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Every rule of a sheet: the selector and the body. */
export function rulesOf(text: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    const selector = text.slice(0, i).split(/[;}]/).pop()?.trim().replace(/\s+/g, ' ') ?? ''
    let depth = 1
    let j = i + 1
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
    }
    if (!selector.startsWith('@')) out.push({ selector, body: text.slice(i + 1, j - 1) })
    i = j - 1
  }
  return out
}

/**
 * The rules of a sheet that paint a PAPER of their own: a background together with
 * a shadow that carries BOTH strokes of a sheet of paper — the lit top edge and the
 * cast it drops on the desk.
 *
 * A surface with only one of the two is a different thing (an inlay is an edge on
 * a plane; a button is a fill with a shadow), and those are the page's own.
 *
 * @param text - the sheet's text, comments already gone.
 * @returns one entry per offending rule.
 */
export function paperCopies(text: string): string[] {
  const out: string[] = []
  for (const rule of rulesOf(text)) {
    const hasBackground = /(?:^|;|\n)\s*background(?:-color)?\s*:/.test(rule.body)
    const shadow = /(?:^|;|\n)\s*box-shadow\s*:\s*([^;]+)/.exec(rule.body)?.[1] ?? ''
    if (!hasBackground) continue
    if (!/var\(--dsh-tb-rim/.test(shadow)) continue
    if (!/var\(--dsh-tb-cast-\d/.test(shadow)) continue
    out.push(`${rule.selector} → ${shadow.trim()}`)
  }
  return out
}

/**
 * The rules of a sheet that spell a focus ring's WIDTH as a literal.
 *
 * @param text - the sheet's text, comments already gone.
 * @returns one entry per offending rule.
 */
export function literalRingWidths(text: string): string[] {
  const out: string[] = []
  for (const rule of rulesOf(text)) {
    if (!/focus/.test(rule.selector)) continue
    for (const declaration of rule.body.split(';').map(one => one.trim()).filter(Boolean)) {
      if (/^outline\s*:\s*\d+px\s+solid/.test(declaration)) out.push(`${rule.selector} → ${declaration}`)
      if (/^box-shadow\s*:\s*0 0 0 \d+px/.test(declaration)) out.push(`${rule.selector} → ${declaration}`)
    }
  }
  return out
}

/** The body of the rule whose selector names `name` exactly. */
function ruleFor(text: string, name: string): string {
  const hit = rulesOf(text).find(rule => rule.selector.split(',').map(one => one.trim()).includes(`.${name}`))
  return hit?.body ?? ''
}

/** The body of the rule whose selector names `name` in one of its focus states. */
function focusRuleFor(text: string, name: string): string {
  const hit = rulesOf(text).find(rule => rule.selector.split(',')
    .map(one => one.trim())
    .some(one => one === `.${name}:focus` || one === `.${name}:focus-visible` || one === `.${name}:focus-within`))
  return hit?.body ?? ''
}

describe('the shape layer has one home', () => {
  it('a sheet of paper is painted by the shared class, not by the page sheets', () => {
    /* **这一条钉的是「谁画那两笔」。** 一张纸的签名是**两笔都在**：受光的顶边
     * （`--dsh-tb-rim`）与落在桌面上的投影（`--dsh-tb-cast-*`）。页面类不自己写
     * 那两笔——它们把「我这张纸的底色是哪一档」「我的影是哪几笔」交给共享层的两个
     * 槽（`--dsh-tb-paper-plane` / `--dsh-tb-paper-cast`），共享层那个类负责画。
     *
     * **只带一笔的不算**：嵌面（一条边光 + 一个平面）与按钮（一块填色 + 一档影）是
     * 别的形状，它们是页面自己的。
     *
     * **例外有一个**（写在这里而不是藏起来）：`.workbenchTab[aria-current='page']`
     * （共享组件表）——它是**组件自己的**那一档，而挂它的 `design/WorkbenchBar.tsx`
     * 不在本轮的写域里：类名属于表，组件不挂它就没有那一份材质。
     */
    const EXCUSED: Record<string, string[]> = {
      'src/client/design/components.module.css': ['.workbenchTab[aria-current=\'page\']'],
    }
    const offenders: string[] = []
    for (const rel of [COMPONENT_SHEET, ...PAGE_SHEETS]) {
      const excused = EXCUSED[rel] ?? []
      for (const hit of paperCopies(sheet(rel))) {
        if (excused.some(one => hit.startsWith(one))) continue
        offenders.push(`${rel}: ${hit}`)
      }
    }
    expect(offenders, 'the paper is painted in more than one place — the shared class owns those two strokes:\n'
      + offenders.join('\n')).toEqual([])
    /* **共享层那一份就是那一个家**：它画那两笔，别处不画。 */
    expect(paperCopies(sheet(SHAPE_SHEET)).map(hit => hit.split(' ')[0]), 'the shared shape sheet lost the paper')
      .toEqual(['.paperSheet'])
  })

  it('the reader bites: a planted paper is read, a one-stroke surface is not', () => {
    /* **这一条是这道门禁的自证。** 它喂的是**记忆里的表**，不是磁盘上那一张。 */
    const planted = [
      '.a { background: var(--dsh-tb-plane-sheet); box-shadow: var(--dsh-tb-rim), var(--dsh-tb-cast-1); }',
      '.b { background: var(--dsh-tb-plane-sheet); box-shadow: var(--dsh-tb-rim-soft); }',
      '.c { background: var(--dsh-tb-plane-sheet); box-shadow: var(--dsh-tb-shadow-1); }',
      '.d { background: var(--dsh-tb-plane-sheet); }',
    ].join('\n')
    const copies = paperCopies(planted)
    expect(copies).toHaveLength(1)
    expect(copies[0]).toContain('.a')
  })

  it('a focus ring spells its width as a token, never as a literal', () => {
    /* **环的宽度是一条共享的事实**：实环与柔晕共用同一档。挑一次就分家——改一处，
     * 另一处留在旧值上，而屏上不会有人说一句话。 */
    const offenders: string[] = []
    for (const rel of [SHAPE_SHEET, COMPONENT_SHEET, ...PAGE_SHEETS]) {
      for (const hit of literalRingWidths(sheet(rel))) offenders.push(`${rel}: ${hit}`)
    }
    expect(offenders, 'a focus ring spells its own width — it reads --dsh-tb-ring-w:\n'
      + offenders.join('\n')).toEqual([])
  })

  it('the width reader bites: a literal width is read, the token form is not', () => {
    const planted = [
      '.a:focus { outline: 2px solid var(--dsh-tb-focus-color); }',
      '.b:focus { outline: var(--dsh-tb-ring-w) solid var(--dsh-tb-focus-color); }',
      '.c:focus { box-shadow: 0 0 0 3px var(--dsh-tb-focus-ring); }',
      '.d:focus { box-shadow: 0 0 0 var(--dsh-tb-ring-w) var(--dsh-tb-focus-ring); }',
      '.e { outline: 2px solid var(--dsh-tb-accent); }',
    ].join('\n')
    const widths = literalRingWidths(planted)
    expect(widths).toHaveLength(2)
    expect(widths[0]).toContain('.a')
    expect(widths[1]).toContain('.c')
  })

  it('the fields mount the shared halo instead of painting one', () => {
    /* **输入框的那一枚柔晕住在共享层**（`design/base.module.css` 的 `.focusHalo`）：
     * 清单的两个字段与看板的排期预设原先各写了一份逐字相同的
     * `box-shadow: 0 0 0 3px var(--dsh-tb-focus-ring)`——三份各写各的，改一处另两处
     * 留在旧值上。 */
    const FIELDS: { file: string; sheet: string; class: string }[] = [
      { file: 'src/client/item/step-editor.tsx', sheet: 'src/client/item/item.module.css', class: 'itemInput' },
      { file: 'src/client/item/item-create-dialog.tsx', sheet: 'src/client/item/item.module.css', class: 'itemCreateDialogTitleField' },
      { file: 'src/client/board/automation-ui.tsx', sheet: 'src/client/board.module.css', class: 'schedulePreset' },
    ]
    for (const field of FIELDS) {
      expect(read(field.file), `${field.class} does not mount the shared halo — it lives in the shared shape sheet`)
        .toContain('base.focusHalo')
      const focus = focusRuleFor(sheet(field.sheet), field.class)
      expect(focus, `${field.class} has no focus rule at all`).not.toBe('')
      expect(focus, `${field.class} paints a halo of its own — the shared shape sheet owns that recipe`)
        .not.toMatch(/box-shadow/)
    }
  })

  it('the lift is the shared form: the board sheet does not raise its card a second way', () => {
    /* **悬停抬起与选中抬起住在共享层**（`.paperLift` 与它的 `[data-raised]` 入口），
     * 按下回位也住在那里。看板表里原先逐字抄了一份（连过渡速度都抄了一份改了一个
     * 数），两份会分家。 */
    const board = sheet('src/client/board.module.css')
    const raising = rulesOf(board)
      .filter(rule => rule.selector.includes('.card:hover') && /translateY\(-1px\)/.test(rule.body))
      .map(rule => rule.selector)
    expect(raising, 'the board sheet raises its card on hover — the shared lift owns that:\n' + raising.join('\n'))
      .toEqual([])
    const shape = sheet(SHAPE_SHEET)
    expect(shape).toMatch(/\.paperLift:hover[^{]*\{/)
    expect(shape, 'the raised state has no entry of its own — the selected card needs one')
      .toMatch(/\[data-raised='true'\]/)
    /* **抬升只有一个速度**：影与位移是同一件事的两半。 */
    const lift = ruleFor(shape, 'paperLift')
    expect(lift, 'the lift lost its transition').toMatch(/transform\s*var\(--dsh-tb-motion-lift\)/)
    expect(lift).not.toMatch(/transform\s*var\(--dsh-tb-motion-fast\)/)
  })

  it('the thin scrollbar has one home: the seat-level rule', () => {
    /* **滚动条长什么样是共享的事**；滚动容器是哪几个元素是每一页自己的事。所以它
     * 住在共享层的座位级规则里，而不是每页抄一份。 */
    for (const rel of [COMPONENT_SHEET, ...PAGE_SHEETS]) {
      expect(sheet(rel), `${rel} grew a second scrollbar grammar — it lives in the shared shape sheet`)
        .not.toContain('::-webkit-scrollbar-thumb')
    }
    expect(sheet(SHAPE_SHEET)).toContain('::-webkit-scrollbar-thumb')
  })

  it('the shared layer reads only tokens the token layer declares', () => {
    /* **层方向是一条门禁**：共享形态读页面表声明的变量，今天靠 DOM 继承侥幸活着，
     * 换一个消费者就读不到，于是**整条声明在计算值阶段静默丢弃**（`padding-inline`
     * 失效、内衬变 0，屏上没有任何报错）。所以共享层读的每一个变量，**令牌层都得
     * 声明它**（或者共享层自己声明它）。
     *
     * **两个槽是例外，而且是设计出来的一个例外**：共享层的那两个槽
     * （`--dsh-tb-paper-plane` / `--dsh-tb-paper-cast`）本来就是**给页面写的**——
     * 它们是共享层对外的接口，页面写、共享层读，方向是反的才对。 */
    const INTERFACE = ['--dsh-tb-paper-plane', '--dsh-tb-paper-cast', '--dsh-tb-paper-radius']
    const declared = new Set<string>()
    for (const rel of [TOKEN_SHEET, SHAPE_SHEET, COMPONENT_SHEET]) {
      for (const match of sheet(rel).matchAll(/(--[\w-]+)\s*:/g)) declared.add(match[1])
    }
    const pageOnly = new Set<string>()
    for (const rel of PAGE_SHEETS) {
      for (const match of sheet(rel).matchAll(/(--[\w-]+)\s*:/g)) pageOnly.add(match[1])
    }
    const read = new Set<string>()
    for (const rel of [SHAPE_SHEET, COMPONENT_SHEET]) {
      for (const match of sheet(rel).matchAll(/var\(\s*(--[\w-]+)/g)) read.add(match[1])
    }
    const inverted = [...read]
      .filter(name => !declared.has(name) && pageOnly.has(name) && !INTERFACE.includes(name))
    expect(inverted, 'the shared layer reads a variable only a page sheet declares — another consumer reads nothing:\n'
      + inverted.join('\n')).toEqual([])
  })

  it('the ring width token is declared once and read', () => {
    /* 一个**没人读的令牌**等于没有答案（它让人以为「宽度这件事有人管」）。 */
    const declarations = [...sheet(TOKEN_SHEET).matchAll(/--dsh-tb-ring-w\s*:/g)].length
    expect(declarations, 'the ring width is declared more than once — one concept, one home').toBe(1)
    const readers = [SHAPE_SHEET, COMPONENT_SHEET, ...PAGE_SHEETS]
      .filter(rel => sheet(rel).includes('var(--dsh-tb-ring-w)'))
    expect(readers.length, 'the ring width token has no reader').toBeGreaterThan(0)
  })
})
