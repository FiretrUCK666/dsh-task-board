#!/usr/bin/env node
/**
 * 一个组件用到的类名，**必须由它自己 import 的那张表声明**。
 *
 * ── 这条门禁守的是什么 ──────────────────────────────────────────────────────
 *
 * CSS Modules 的 `import css from './x.module.css'` 给的是一个**映射对象**：表里没有
 * 的键取出来是 `undefined`。于是
 *
 *     <div className={css.doesNotExist}>
 *
 * 渲染成 `class="undefined"`——一个合法、无样式、**不报错**的节点。类型上它也不红：
 * 映射对象的类型是 `Record<string, string>`，任何键都「存在」。
 *
 * 而 `verify-sheet-scope` 看不见它：那条门禁查的是**表与表之间**的互相引用。这里
 * 的缺陷在**组件与表之间**——组件拿着 A 表，却点了一个只在 B 表里的名字。样式表
 * 全都合法，类名全都有家，测试全过，屏上只是「那里没样式」。
 *
 * 这个仓库栽过的三次（`.thumbPrimary`、`.chip`、`.sessionRowName`）都是这一类，
 * 只是当时的形态是「一张表里写了另一张表的名字」。一次拆表会把这张网撒得更开：
 * 35 个组件各自 import 一到两张表，任何一个 import 错了、或某个类名搬去了别的表
 * 而组件没跟上，都只表现为「那里没生效」。
 *
 * ── 判据为什么读「本文件 import 的表」而不是「所有表里有的名字」 ────────────
 *
 * 因为运行时的解析就是按 import 来的：`css` 这个标识符只连着它 import 的那一张。
 * 拿「所有表的并集」去判会放过真正的缺陷——那正是这次要抓的东西。
 *
 * 同一个组件 import 多张表时（`import a from './a.module.css'` +
 * `import b from './b.module.css'`），每个 `a.x` / `b.x` 各自对照各自那张。
 *
 * 用法：`node scripts/verify-sheet-ownership.mjs [根目录]`
 * 自测：`--probe-wrong-sheet`（点一个只在别的表里的名字，必须报红）
 *       `--probe-own-sheet`（全在自己 import 的表里，必须放行）
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { declaredClassesOf } from './css-core.mjs'
import { probeOf } from './probe-args.mjs'

/**
 * 递归列出 `src/client` 下的组件与样式表。
 * @param root - 仓库根。
 * @returns `{ tsx, sheets }`：`.tsx` 源文件路径，`.module.css` 的相对路径集合。
 */
function walkClient(root) {
  const tsx = []
  const sheets = new Set()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx')) tsx.push(full)
      else if (entry.name.endsWith('.module.css')) {
        sheets.add(relative(root, full).replace(/\\/g, '/'))
      }
    }
  }
  walk(join(root, 'src', 'client'))
  return { tsx, sheets }
}

/**
 * 一个组件文件里，每个「表标识符」用到哪些类名。
 *
 * 只认 `import <ident> from '<path>.module.css'` 引入的标识符。`styles`、`css`、
 * `panels` 这些名字都允许——判据是**它 import 的是哪张表**，不是标识符叫什么。
 *
 * @param source - 组件源码（注释须已剥）。
 * @param fileRel - 组件相对仓库根的路径，用于解相对 import。
 * @returns `{ ident, sheet, names }[]`。
 */
export function sheetUsesOf(source, fileRel) {
  const out = []
  const importRe = /import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.css)['"]/g
  let m
  while ((m = importRe.exec(source)) !== null) {
    const ident = m[1]
    const rawPath = m[2]
    /* 相对路径解析成仓库相对路径。`./x` 与 `../y` 都只往上走，不引入别名。 */
    const parts = fileRel.split('/').slice(0, -1)
    for (const seg of rawPath.split('/')) {
      if (seg === '.' || seg === '') continue
      else if (seg === '..') parts.pop()
      else parts.push(seg)
    }
    const sheet = parts.join('/')
    const names = new Set()
    /* `ident.foo`。**必须排除 `ident.module.css` 这种恰好接着 import 语句的写法**：
       `import components from './components.module.css'` 里的 `components.module`
       会被点号正则吃进去，而那是个路径，不是一次类名访问。判据是「点号之后不是
       文件扩展名」——`.module` / `.css` / `.tsx` 都不是类名。 */
    const useRe = new RegExp(`\\b${ident}\\.([A-Za-z_$][\\w$]*)`, 'g')
    let u
    while ((u = useRe.exec(source)) !== null) {
      if (u[1] === 'module' || u[1] === 'css') continue
      names.add(u[1])
    }
    out.push({ ident, sheet, names })
  }
  return out
}

/**
 * 找出所有「点了一个不在这张表里的名字」的地方。
 * @param root - 仓库根。
 * @returns `{ file, ident, sheet, name }[]`。
 */
export function wrongSheetFindings(root) {
  const { tsx } = walkClient(root)
  const declaredCache = new Map()
  const declaredOf = (sheetRel) => {
    if (!declaredCache.has(sheetRel)) {
      const full = join(root, sheetRel)
      declaredCache.set(sheetRel, existsSync(full) ? declaredClassesOf(readFileSync(full, 'utf8')) : new Set())
    }
    return declaredCache.get(sheetRel)
  }

  const findings = []
  for (const file of tsx) {
    const fileRel = relative(root, file).replace(/\\/g, '/')
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const use of sheetUsesOf(source, fileRel)) {
      const declared = declaredOf(use.sheet)
      for (const name of use.names) {
        /* 跳过 React / 常见对象上本来就有的东西？不跳。`css` 这个标识符只可能来自
           那张表的 import——它没有别的成员可读。 */
        if (!declared.has(name)) findings.push({ file: fileRel, ident: use.ident, sheet: use.sheet, name })
      }
    }
  }
  return findings
}

/**
 * 自测：造一个组件与两张表，看判据咬不咬。
 * @param probe - `--probe-wrong-sheet` 或 `--probe-own-sheet`。
 * @returns 判定结果。
 */
export function selfTest(probe) {
  const sheets = {
    'src/client/a.module.css': '.mine { color: red }\n.sharedClass { color: blue }',
    'src/client/b.module.css': '.theirs { color: red }\n.sharedClass { color: blue }',
  }
  const declared = new Map(Object.entries(sheets).map(([rel, css]) => [rel, declaredClassesOf(css)]))
  const judge = (fileRel, source) => {
    const found = []
    for (const use of sheetUsesOf(source, fileRel)) {
      const own = declared.get(use.sheet) ?? new Set()
      for (const name of use.names) if (!own.has(name)) found.push(name)
    }
    return found
  }
  if (probe === '--probe-wrong-sheet') {
    return {
      wrong: judge('src/client/Comp.tsx', "import css from './a.module.css'\nconst x = <div className={css.theirs} />"),
      alsoWrong: judge('src/client/deep/Comp.tsx', "import css from '../a.module.css'\nconst x = <div className={css.theirs} />"),
    }
  }
  return {
    own: judge('src/client/Comp.tsx', "import css from './a.module.css'\nconst x = <div className={css.mine} />"),
    shared: judge('src/client/Comp.tsx', "import css from './a.module.css'\nconst x = <div className={css.sharedClass} />"),
    deeper: judge('src/client/deep/Comp.tsx', "import css from '../a.module.css'\nconst x = <div className={css.mine} />"),
  }
}

function main() {
  const root = process.argv[2] ?? '.'
  const probe = probeOf(['--probe-wrong-sheet', '--probe-own-sheet'])

  if (probe !== undefined) {
    const heard = selfTest(probe)
    const wrong = []
    if (probe === '--probe-wrong-sheet') {
      if (heard.wrong.length === 0) wrong.push('点了一个只在别的表里的名字，没被认出')
      if (heard.alsoWrong.length === 0) wrong.push('相对路径 `../` 的情况没被认出')
    } else {
      if (heard.own.length > 0) wrong.push(`本表的类被误报：${heard.own.join(', ')}`)
      if (heard.shared.length > 0) wrong.push(`两张表都声明的类被误报：${heard.shared.join(', ')}`)
      if (heard.deeper.length > 0) wrong.push(`相对路径下本表的类被误报：${heard.deeper.join(', ')}`)
    }
    if (wrong.length > 0) {
      for (const line of wrong) console.error(`  - ${line}`)
      console.error('verify-sheet-ownership self-test FAILED: the reader does not bite correctly')
      process.exit(1)
    }
    console.log(probe === '--probe-wrong-sheet'
      ? 'OK 自测：点错表的名字被认出，`../` 相对路径也认得出（门禁是活的）。'
      : 'OK 自测：本表、共享类、相对路径三种都放行（不误伤）。')
    return
  }

  if (!existsSync(join(root, 'src', 'client'))) {
    console.error('verify-sheet-ownership: 找不到 src/client —— 根目录给错了？')
    process.exit(1)
  }

  const findings = wrongSheetFindings(root)
  if (findings.length === 0) {
    console.log('verify-sheet-ownership OK: 每个组件点到的类名都由它自己 import 的那张表声明。')
    return
  }
  console.error(`FAIL ${findings.length} 处点了一个不在这张表里的名字——渲染成 class="undefined"，不报错、无样式：`)
  for (const f of findings) {
    console.error(`  ${f.file}`)
    console.error(`    ${f.ident}.${f.name}  ← ${f.sheet} 里没有声明 ${f.name}`)
  }
  process.exit(1)
}

main()
