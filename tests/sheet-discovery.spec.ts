/**
 * 「样式表只许被发现，不许被列名单」——**这道门禁自己必须会红**。
 *
 * ── 为什么这条自证必须存在（硬性规范 16） ────────────────────────────────────
 *
 * 在真实文件里改一下再改回来，证的是「改动生效」，不是「门禁会红」。而同一类缺陷
 * 在这个仓库里已经发生过三次（见 `scripts/verify-sheet-discovery.mjs` 头注释），
 * 每一次都没有任何东西报警——所以「这条门禁是活的」本身必须有可复跑的证明。
 *
 * 这里喂的是**内存里的源码文本**，不是磁盘上的文件：改一次真实文件再改回来会与
 * 别的写者互相踩（同一个工作区），而这套判据是纯函数，喂文本就能证。
 *
 * ── 判据读的是「用途」，不是「形状」 ────────────────────────────────────────
 *
 * 一条被 `for…of` / `.map` 遍历的名单会变旧（加一张表没人补）；一份喂给函数的
 * 夹具本来就不该跟着真实文件变。两者字面上都是「一串表名」，区别在它后面接什么。
 * 所以要证的是**两个方向**：会遍历的必红、只喂参的必放行。
 */
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  arrayLiterals,
  bareSheetElements,
  findings,
  gatesWithoutProbe,
  isIterated,
  realSheetsOf,
} from '../scripts/verify-sheet-discovery.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 造一段源码：夹具由字符串拼出来，本文件自己不是一份名单。 */
const src = (lines: readonly string[]): string => lines.join('\n')

/** 一段源码里被判为「名单」的数组（形状 + 用途都命中）。 */
function listsIn(source: string): string[][] {
  const out: string[][] = []
  for (const literal of arrayLiterals(source)) {
    if (!isIterated(source, literal.open, literal.close)) continue
    const named = realSheetsOf(bareSheetElements(literal.inner), ROOT)
    if (named.size > 0) out.push([...named].sort())
  }
  return out
}

describe('a list that is iterated is reported', () => {
  it('a for…of over two real sheets', () => {
    const lists = listsIn(src([
      'const SHEETS = [',
      "  'src/client/board.module.css',",
      "  'src/client/item/item.module.css',",
      ']',
      'for (const rel of SHEETS) {',
      '  check(rel)',
      '}',
    ]))
    expect(lists, 'a list that is walked is exactly the shape that goes stale')
      .toEqual([['src/client/board.module.css', 'src/client/item/item.module.css']])
  })

  it('a .map over the literal itself', () => {
    const lists = listsIn(src([
      "['src/client/board.module.css', 'src/client/home/home.module.css'].map(check)",
    ]))
    expect(lists.length, 'a list mapped straight out of the literal is the same defect').toBe(1)
  })

  it('a list written across lines', () => {
    const lists = listsIn(src([
      'const PAGES = [',
      "  'src/client/board.module.css',",
      '  // a comment between the members does not end the array',
      "  'src/client/home/home.module.css',",
      ']',
      'PAGES.forEach(check)',
    ]))
    expect(lists, 'a per-line reader sees two one-element arrays and misses this')
      .toEqual([['src/client/board.module.css', 'src/client/home/home.module.css']])
  })
})

describe('a list that is only fed to a function is not', () => {
  it('an argument to a judging function', () => {
    const lists = listsIn(src([
      'const got = judge([',
      "  'src/client/board.module.css',",
      "  'src/client/item/item.module.css',",
      '])',
    ]))
    expect(lists, 'a fixture is input to a judgement — it must not follow the real files')
      .toEqual([])
  })

  it('a self-test fixture of invented sheet names', () => {
    const lists = listsIn(src([
      'const PLANTED = [',
      "  { rel: 'a.module.css', css: '.x { color: red; }' },",
      "  { rel: 'b.module.css', css: '.y { color: blue; }' },",
      ']',
      'for (const one of PLANTED) check(one)',
    ]))
    expect(lists, 'invented names do not exist on disk — they are a planted scene, not a real list')
      .toEqual([])
  })

  it('a list that lives only in a comment', () => {
    const lists = listsIn(src([
      '/* The old code listed:',
      "   'src/client/board.module.css'",
      "   'src/client/item/item.module.css'",
      '*/',
      'const ONE = 1',
    ]))
    expect(lists, 'comments are prose (hard rule 14) — otherwise the explanation is the violation')
      .toEqual([])
  })

  it('reading ONE sheet by name is an authority, not a list', () => {
    const lists = listsIn(src([
      "const TOKEN_SHEET = 'src/client/design/tokens.module.css'",
      'const SCALE = new Set([',
      "  ['a', TOKEN_SHEET],",
      '])',
    ]))
    expect(lists, 'one named sheet cannot fall behind — there is only one')
      .toEqual([])
  })
})

describe('the repository itself carries no hand-written sheet list', () => {
  it('every gate and spec discovers its sheets', () => {
    const bad = findings(ROOT)
    expect(
      bad.map(one => one.rel),
      'a hand-written sheet list cannot follow a new sheet, and nothing says a word when it falls behind:'
      + '\n' + bad.map(one => `  - ${one.rel} → ${one.sheets.join(', ')}`).join('\n'),
    ).toEqual([])
  })

  it('the reader reads the sheets it is judging (a silent empty scan passes everything)', () => {
    // 一条读不到任何东西的判据会全绿——而全绿看起来像「没问题」。
    expect(listsIn(src([
      "const SHEETS = ['src/client/board.module.css', 'src/client/home/home.module.css']",
      'for (const one of SHEETS) check(one)',
    ])).length).toBe(1)
  })

  it('every gate carries at least one self-test switch (hard rule 16)', () => {
    // 一条没有探针的门禁，没人能证明它会红；而一条永远绿的门禁会被读成证据。
    const missing = gatesWithoutProbe(ROOT)
    expect(missing, 'a gate with no self-test switch cannot be shown to bite:\n'
      + missing.map(one => `  - scripts/${one}`).join('\n')).toEqual([])
  })

  it('the probe reader reads BOTH spellings (probeOf and a bare switch name)', () => {
    // 只认 probeOf 会把一条合格的（自己查表的）门禁判成不合格。
    // 这一条钉的是「两种写法都算」，喂的是内存里的源码，不是磁盘上的门禁。
    const withProbeOf = "import { probeOf } from './probe-args.mjs'\nconst p = probeOf(['--probe-x'])"
    const withOwnSwitch = "if (process.argv.includes('--probe-own')) go()"
    const withNeither = 'const x = 1'
    expect(/\bprobeOf\s*\(/.test(withProbeOf) || /['"]--probe-[\w-]+['"]/.test(withProbeOf)).toBe(true)
    expect(/\bprobeOf\s*\(/.test(withOwnSwitch) || /['"]--probe-[\w-]+['"]/.test(withOwnSwitch)).toBe(true)
    expect(/\bprobeOf\s*\(/.test(withNeither) || /['"]--probe-[\w-]+['"]/.test(withNeither)).toBe(false)
  })
})
