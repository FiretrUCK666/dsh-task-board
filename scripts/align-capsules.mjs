#!/usr/bin/env node
/**
 * 墨位校正的判据：**那个量按元素算**，而且每一枚都真的挂上了。
 *
 * ── 它守的是什么 ────────────────────────────────────────────────────────────
 *
 * `align-items: center` 居中的是**行盒**，读者看的是**字的墨**。两者不同心，而差值
 * 逐元素不同（字体度量、行盒比元素盒高多少、字号），且渲染时基线被吸附到整像素，
 * 于是「差多少」是**一格一格**的、每格的门槛由那一枚自己的几何决定。量过的三个族：
 * 12px 的芯片要 1.1px、13px 的页签要 2.0px、组头要 1.25px——**一个全局常数必然只
 * 对齐一族**。
 *
 * 所以判三件事，缺一件都算没过：
 *
 *   1. **每枚要校正的盒子都挂上了**：声明 `--dsh-tb-optical-target: 1`，并读
 *      `var(--dsh-tb-optical-shift, 0px)`（**这一枚自己的**值）。
 *   2. **校正没被盖掉**：那对 `padding-block` 必须是这条规则里**最后一条**管块向
 *      内衬的声明——CSS 里同族属性后声明的赢，后面再来一条 `padding: 0 4px`，
 *      前面那对就整条作废，而文件里看得见、浏览器里一次都没跑。
 *   3. **写入方在位**：运行时真的按元素算、真的写回那一枚；而且**只碰带标记的**
 *      （不碰宿主自己的界面——上一版就是栽在这里：它把整个 document 的每一行字都
 *      改了，于是整个 DSH 页面都在被抬起）。
 *
 * ── 判据是结构，不是名单 ────────────────────────────────────────────────────
 *
 * 「胶囊」= 一条规则把圆角**解析成**胶囊那一档。这里不认字面量：先把全项目的自定义
 * 属性建成一张图，把 `var()` 链解析到底再判（`--item-radius-pill` 与
 * `--dsh-tb-pill` 是同一个圆角的两个名字，只认一个就永远有一族不在网里）。
 *
 * 用法：
 *   node scripts/align-capsules.mjs .            # 检查（verify 用这一档）
 *   node scripts/align-capsules.mjs . --probe    # 自测：种一个缺标记的，必须报红
 *   node scripts/align-capsules.mjs . --probe-writer  # 自测：种一个没有写入方的，必须报红
 *   node scripts/align-capsules.mjs . --probe-clobbered  # 自测：种一个被简写盖掉的
 *   node scripts/align-capsules.mjs . --probe-ordered    # 自测：种一个写对了的
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 那一枚盒子上的「我要被校正」的标记。 */
const MARK = '--dsh-tb-optical-target: 1;'
/** 那一枚盒子读自己的那个变量。 */
const SHIFT = 'var(--dsh-tb-optical-shift, 0px)'
/** 那个被废掉的全局令牌。它一旦再出现，就是旧路复活。 */
const RETIRED = '--dsh-tb-optical-drop'
/** 唯一允许写校正的那个模块。 */
const WRITER = 'design/ink-metrics.ts'

/** 管块向内衬的四条属性：它们互相覆盖，最后一条赢。 */
const BLOCK_PADDING = /(^|[;{\s])(padding|padding-block|padding-block-start|padding-block-end|padding-top|padding-bottom)\s*:/g

/** 客户端样式表。 */
function sheets(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'lib' || name === 'dist' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.css')) out.push(full)
    }
  }
  walk(join(root, 'src/client'))
  return out
}

/** 抹掉注释（保长度），否则注释里出现的词会被当成一次使用。 */
function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
}

/** 把一张表拆成规则。 */
function rulesOf(css) {
  const rules = []
  let i = 0
  while (true) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const selector = css.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    rules.push({ selector, body: css.slice(open + 1, j - 1) })
    i = j
  }
  return rules
}

/** 全项目的自定义属性图：名字 → 值（第一条声明为准）。 */
function customProperties(root) {
  const map = new Map()
  for (const file of sheets(root)) {
    const css = blankComments(readFileSync(file, 'utf8'))
    for (const match of css.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;}]+)/g)) {
      if (!map.has(match[1])) map.set(match[1], match[2].trim())
    }
  }
  return map
}

/** 沿 `var()` 链解析到底；解析不动就原样返回。 */
function resolveValue(value, properties, depth = 0) {
  const trimmed = value.trim()
  if (depth > 8) return trimmed
  const single = /^var\((--[A-Za-z0-9-]+)\)$/.exec(trimmed)
  if (single !== null && properties.has(single[1])) {
    return resolveValue(properties.get(single[1]), properties, depth + 1)
  }
  return trimmed
}

/** 一条规则的圆角是不是胶囊那一档（沿 `var()` 链解析之后比）。 */
function isCapsule(body, properties) {
  const declared = /border-radius\s*:\s*([^;}]+)/.exec(body)
  if (declared === null) return false
  const pill = properties.get('--dsh-tb-pill')
  if (pill === undefined) return false
  const pillValue = resolveValue(pill, properties)
  const horizontal = declared[1].split('/')[0].trim()
  for (const one of horizontal.split(/\s+/)) {
    if (resolveValue(one, properties) === pillValue) return true
  }
  return false
}

/** 这条规则里，那对校正的 `padding-block` 是不是**最后一条**管块向内衬的声明。 */
function correctionIsLast(body) {
  const matches = [...body.matchAll(BLOCK_PADDING)]
  if (matches.length === 0) return true
  const last = matches[matches.length - 1]
  return last[0].includes('padding-block')
}

/** 扫描整个客户端半区，返回问题清单。 */
export function audit(root) {
  const findings = []
  const properties = customProperties(root)

  for (const file of sheets(root)) {
    const css = blankComments(readFileSync(file, 'utf8'))
    const rel = relative(root, file).replace(/\\/g, '/')

    /* 1. 旧路不许回来。 */
    if (css.includes(RETIRED)) {
      findings.push({
        kind: 'retired-token',
        file,
        message: `又读到了 \`${RETIRED}\`：那是「一个全局常数」那一版，已被逐元素取代`,
      })
    }

    for (const rule of rulesOf(css)) {
      const hasMarker = rule.body.includes(MARK)
      const hasShift = rule.body.includes(SHIFT)
      if (!hasMarker && !hasShift) continue

      if (!hasMarker) {
        findings.push({
          kind: 'missing-marker',
          file,
          message: `${rule.selector} 读了 \`${SHIFT}\` 却没有声明 \`${MARK}\`——`
            + '运行时不知道要校正它，于是这一枚的字永远偏着',
        })
      }
      if (!hasShift) {
        findings.push({
          kind: 'missing-shift',
          file,
          message: `${rule.selector} 声明了 \`${MARK}\` 却没有读 \`${SHIFT}\`——`
            + '声明了要校正，却没有任何一条声明跟着它',
        })
      }
      if (hasShift && !correctionIsLast(rule.body)) {
        findings.push({
          kind: 'clobbered',
          file,
          message: `${rule.selector} 的校正被后面一条块向内衬的声明整条盖掉了——`
            + '文件里看得见，浏览器里一次都没跑',
        })
      }
    }
  }

  /* 2. 写入方必须在位，而且只碰带标记的。 */
  const writer = sheets(root).length > 0 ? join(root, 'src/client', WRITER) : undefined
  const sources = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (full.endsWith('.ts') || full.endsWith('.tsx')) sources.push(full)
    }
  }
  walk(join(root, 'src/client'))
  const writerFile = sources.find((file) => relative(root, file).replace(/\\/g, '/').endsWith(WRITER))
  if (writerFile === undefined) {
    findings.push({
      kind: 'writer-missing',
      file: join(root, 'src/client', WRITER),
      message: '没有墨位校正的写入方',
    })
  } else {
    const source = blankComments(readFileSync(writerFile, 'utf8'))
    const finds = /getPropertyValue\(OPTICAL_TARGET_PROPERTY\)/.test(source)
    const measures = /function\s+shiftOf/.test(source)
    const writes = /setProperty\(OPTICAL_SHIFT_PROPERTY/.test(source)
    if (!finds || !measures || !writes) {
      findings.push({
        kind: 'writer-missing',
        file: writerFile,
        message: '写入方必须：只认带标记的元素（`getPropertyValue(OPTICAL_TARGET_PROPERTY)`）、'
          + '按元素算（`shiftOf`）、把结果写回那一枚（`setProperty(OPTICAL_SHIFT_PROPERTY`）——'
          + '少了任何一样，界面就是「盒子居中、字没居中」，而没有报错',
      })
    }
  }

  /* 3. 胶囊这一族不能没有校正（覆盖：老网眼继续用）。 */
  for (const file of sheets(root)) {
    const css = blankComments(readFileSync(file, 'utf8'))
    const rel = relative(root, file).replace(/\\/g, '/')
    for (const rule of rulesOf(css)) {
      if (!isCapsule(rule.body, properties)) continue
      /* **这条规则自己得给字定排版**，才谈得上「装一行字」。
         判据是**这条规则自己的** `font-size` / `line-height` 等，不是「同一个类名在别处
         出现过」——日历上那颗圆点（`.itemDateAxis li > i`，`border-radius: 999px`）
         也解析到胶囊那一档，但它是个**点**，里面没有字。
         （早先这一条按「类名在别处有排版声明」判，于是那颗点被算成一枚装字的胶囊。） */
      if (!/(^|[;{\s])(font-size|line-height)\s*:/.test(rule.body)) continue
      if (!rule.body.includes(MARK)) {
        findings.push({
          kind: 'missing-correction',
          file,
          message: `${rule.selector} 是一枚装字的胶囊，却没有 \`${MARK}\`——`
            + '它的字会一直偏着，而没有任何测试会红',
        })
      }
    }
  }

  return findings
}

function report(findings, root) {
  console.error(`FAIL ${findings.length} 处墨位校正退回到了「一个常数」、断了线，或者漏了一枚：`)
  for (const finding of findings) {
    console.error(`  ${relative(root, finding.file).replace(/\\/g, '/')}  [${finding.kind}]`)
    console.error(`      ${finding.message}`)
  }
  console.error('  这一条的判据是「量出来的数按元素算吗」，不是「那个常数的值调对了吗」。')
  console.error('  见 DESIGN.md 的墨位一节。')
}

function main() {
  const root = process.argv[2] ?? '.'
  const probe = process.argv.find((arg) => arg.startsWith('--probe'))

  if (probe !== undefined) {
    const fixtures = {
      '--probe': ['tests/fixtures/ink-missing-marker', 'missing-marker'],
      '--probe-writer': ['tests/fixtures/ink-no-writer', 'writer-missing'],
      '--probe-clobbered': ['tests/fixtures/ink-clobbered', 'clobbered'],
    }
    const entry = fixtures[probe]
    if (entry === undefined) {
      /* `--probe-ordered` 是**反向**自测：种一个写对了的，门禁必须**放行**。
         只测「会红」不测「不乱红」，那门禁就可能被写成「见谁都要红」。 */
      if (probe === '--probe-ordered') {
        const findings = audit(join(root, 'tests/fixtures/ink-ordered'))
        const wrong = findings.filter((one) => one.kind === 'missing-marker'
          || one.kind === 'missing-shift' || one.kind === 'clobbered')
        if (wrong.length > 0) {
          console.error(`FAIL 自测：写对了的那一版被门禁判成 ${wrong.map((one) => one.kind).join('、')}——门禁成了「见谁都要红」。`)
          process.exit(1)
        }
        console.log('OK 自测：写对了的那一版被放行（门禁不是「见谁都要红」）。')
        return
      }
      console.error(`align-capsules: unknown probe ${probe}`)
      process.exit(2)
    }
    const [dir, want] = entry
    const findings = audit(join(root, dir))
    if (!findings.some((one) => one.kind === want)) {
      console.error(`FAIL 自测：${dir} 里必须报出 ${want}，但一条都没有——门禁是死的。`)
      process.exit(1)
    }
    console.log(`OK 自测：${want} 被认出（门禁是活的）。`)
    return
  }

  const findings = audit(root)
  if (findings.length === 0) {
    console.log('verify-capsules-aligned OK: 墨位按元素算，每一枚都挂上了，校正也没被盖掉。')
    return
  }
  report(findings, root)
  process.exit(1)
}

/* 只有直接跑这个文件时才执行 CLI：被 import 时（测试、别的脚本）不该顺手改仓库。 */
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) main()
