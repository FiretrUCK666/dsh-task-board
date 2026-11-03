#!/usr/bin/env node
/**
 * **把动作目录渲染成一本可以查的参考，并且拒绝让它过时。**
 *
 * ── 为什么这份文档必须是生成的 ──────────────────────────────────────────────
 *
 * `skills/taskboard/references/actions.md` 是模型在需要细节时翻的那一页。它如果
 * 手写，就会和 `src/core/board-actions.ts` 分家——而分家的方式是**静默的**：目录
 * 改名了、参数加了一个，文档照旧读得通，只是它说的是上一版的事。读到一份看起来很
 * 权威的旧文档，比读不到更贵。
 *
 * 所以它只有一个来源：动作目录。这个脚本把目录渲染成 markdown，`--check` 再拿磁
 * 盘上的文件跟重新渲染的结果比——不一致就是构建失败。于是「文档过时」从**人的记
 * 忆力问题**变成**机器能发现的问题**。
 *
 * ── 它渲染什么、不渲染什么 ──────────────────────────────────────────────────
 *
 * 渲染**字段**：id、做什么、危险级、参数名、是否必填、说明、可选值、缺省含义。
 * 不渲染**决策**：哪两个场景该组合、什么时候该问人——那是 `SKILL.md` 的活，而它是
 * 手写的。这条分工就是 AGENTS.md 硬性规范 22：字段类只许生成，决策类才手写。
 *
 * 用法：
 *   node scripts/gen-skill-actions.mjs           写文件
 *   node scripts/gen-skill-actions.mjs --check   只比对，不一致则退出码 1
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 输出路径，相对仓库根。 */
const OUTPUT = 'skills/taskboard/references/actions.md'

/** 仓库根：这个脚本在 scripts/ 下。 */
const root = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')

/** 一句「这份是生成的」，放在文件最前面，免得有人手改。 */
const BANNER = [
  '<!-- 本文件由 scripts/gen-skill-actions.mjs 从 src/core/board-actions.ts 生成。',
  '     不要手改：下一次生成会覆盖它，而 `pnpm verify` 会告诉你它过时了。',
  '     要改内容请改动作目录；要改渲染方式请改脚本。 -->',
  '',
  '# 动作参考（自动生成）',
  '',
  '每个动作的字段、必填条件、可选值、缺省含义。**判断**（什么时候用哪个）在 `../SKILL.md`。',
  '',
].join('\n')

/**
 * 从目录源码里读出动作与参数。
 *
 * 读的是**源码的形状**，不是 import 那个模块：`tsc` 编译的是 TS，而这个脚本是
 * 纯 node。这与项目里其它门禁同一套读法（`verify-action-coverage.mjs` 也这么读），
 * 所以「读不懂目录的形状」会在两处同时报，而不是一处。
 * @param {string} source - `board-actions.ts` 的内容。
 * @returns {readonly {id: string, verb: string, danger: string, lane: string, summary: string, params: readonly {name: string, about: string, optional: boolean, oneOf?: readonly string[], appliesWhen?: string, default?: string, requiredWhen?: string}[]}[]}
 */
export function actionsOf(source) {
  const start = source.indexOf('export const ACTIONS')
  if (start === -1) return []
  const end = source.indexOf('} as const satisfies', start)
  if (end === -1) return []
  const table = source.slice(start, end)
  // 常量表：`oneOf` 经常引用一个常量而不是字面量数组，要能解析出来。
  const constants = new Map()
  for (const match of source.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]/g)) {
    const values = [...match[2].matchAll(/'([^']*)'/g)].map(entry => entry[1])
    if (values.length > 0) constants.set(match[1], values)
  }
  const idLines = [...table.matchAll(/^ {2}'([a-z]+\.[A-Za-z]+)':\s*\{/gm)]
  const actions = []
  for (let i = 0; i < idLines.length; i++) {
    const from = idLines[i].index + idLines[i][0].length
    const to = i + 1 < idLines.length ? idLines[i + 1].index : table.length
    const block = table.slice(from, to)
    const field = name => {
      const match = new RegExp(`^\\s{4}${name}:\\s*'([^']*)'`, 'm').exec(block)
      return match === null ? '' : match[1]
    }
    const spec = {
      id: idLines[i][1],
      verb: field('verb'),
      danger: field('danger'),
      lane: field('lane'),
      summary: field('summary'),
      params: paramsOf(block, constants),
    }
    // A SPREAD THE PARSER CANNOT RESOLVE IS A FINDING, NOT SILENCE. The first
    // version of this script ignored `...RUN_CONFIG_PARAMS` and produced a
    // reference where the six run-config parameters of three actions were simply
    // ABSENT — the table looked complete, which is exactly why nobody would notice.
    spec.unresolved = [...block.matchAll(/\.\.\.([A-Z][A-Z0-9_]*)/g)]
      .map(match => match[1])
      .filter(name => !constants.has(name))
    actions.push(spec)
  }
  return actions
}

/**
 * 读一个动作的参数表，**包括展开进来的那几份**。
 *
 * 目录里参数表有两种写法：逐条写，和 `...RUN_CONFIG_PARAMS` 这样整份展开。第二种
 * 是把六个运行配置字段收进一处声明的做法，所以解析器必须认识它——不认识就会安静地
 * 少六行，而表照旧看起来是完整的。
 * @param {string} block - 这个动作的源码片段。
 * @param {ReadonlyMap<string, readonly string[]>} constants - 常量表。
 */
function paramsOf(block, constants) {
  const paramsAt = /^\s{4}params:\s*\{/m.exec(block)
  if (paramsAt === null) return []
  const rest = block.slice(paramsAt.index + paramsAt[0].length)
  const paramsEnd = /\n {4}\}/.exec(rest)
  const text = paramsEnd === null ? rest : rest.slice(0, paramsEnd.index)
  const params = []
  const entries = [...text.matchAll(/^ {6}([A-Za-z_$][\w$]*):\s*\{/gm)]
  for (let p = 0; p < entries.length; p++) {
    const pFrom = entries[p].index + entries[p][0].length
    const pTo = p + 1 < entries.length ? entries[p + 1].index : text.length
    params.push(paramOf(entries[p][1], text.slice(pFrom, pTo), constants))
  }
  // 展开的那一份：`...RUN_CONFIG_PARAMS` 指向的是同一份声明，所以它的六个字段从
  // `run-presets.ts` 里读出来，跟逐条写的结果一字不差。
  for (const spread of text.matchAll(/^ {6}\.\.\.([A-Z][A-Z0-9_]*),?$/gm)) {
    const shared = sharedParamsOf(spread[1])
    for (const param of shared) params.push(param)
  }
  return params
}

/** `run-presets.ts` 里那份共享参数声明的来源，随包源码。 */
let runPresetsSource

/**
 * 读一份「整份展开」的参数声明。
 *
 * 目前只有 `RUN_CONFIG_PARAMS` 一份，而它的内容是从 `RUN_CONFIG_KEYS` + 两句说明
 * 表派生的——所以这里也照那个形状读，读不到就抛：一份读不懂的共享声明必须让生成
 * 失败，而不是让它安静地少几行。
 * @param {string} name - 常量名。
 */
function sharedParamsOf(name) {
  if (name !== 'RUN_CONFIG_PARAMS') {
    throw new Error(`gen-skill-actions: the catalog spreads \`...${name}\`, which this generator does not know how to expand — teach it, or the reference will silently omit those parameters`)
  }
  if (runPresetsSource === undefined) {
    runPresetsSource = readFileSync(join(root, 'src', 'core', 'run-presets.ts'), 'utf8')
  }
  const keysAt = /const RUN_CONFIG_KEYS\s*=\s*\[([^\]]*)\]/.exec(runPresetsSource)
  if (keysAt === null) {
    throw new Error('gen-skill-actions: cannot read RUN_CONFIG_KEYS out of src/core/run-presets.ts — the reference would omit every run-config parameter')
  }
  const keys = [...keysAt[1].matchAll(/'([^']*)'/g)].map(entry => entry[1])
  // 每键一句「是什么」和一句「没有时是什么」。两张表都是 `Record<key, string>`，所以
  // 读法一致；读不到的键让生成失败，因为缺一句说明的参数写进参考就是半行。
  const table = tableName => {
    const at = new RegExp(`const ${tableName}\\s*:[^=]*=\\s*\\{`).exec(runPresetsSource)
    if (at === null) return new Map()
    const body = runPresetsSource.slice(at.index + at[0].length)
    const end = body.indexOf('\n}')
    const block = end === -1 ? body : body.slice(0, end)
    return new Map([...block.matchAll(/^\s{2}([A-Za-z_$][\w$]*):\s*'([^']*)'/gm)].map(match => [match[1], match[2]]))
  }
  const about = table('RUN_CONFIG_ABOUT')
  const absent = table('RUN_CONFIG_ABSENT')
  return keys.map(key => {
    if (!about.has(key) || !absent.has(key)) {
      throw new Error(`gen-skill-actions: run-config key \`${key}\` has no sentence in RUN_CONFIG_ABOUT / RUN_CONFIG_ABSENT — a parameter with no description must not be written into the reference`)
    }
    return { name: key, about: about.get(key), optional: true, appliesWhen: absent.get(key) }
  })
}

/**
 * 读一个参数的声明。
 * @param {string} name - 参数名。
 * @param {string} spec - 它的源码片段。
 * @param {ReadonlyMap<string, readonly string[]>} constants - `oneOf` 可能引用的常量表。
 */
function paramOf(name, spec, constants) {
  const about = /about:\s*'([^']*)'/.exec(spec)
  // `oneOf` 有两种形状：字面量数组，或一个常量名。第二种不解析就会把「可选值」整段
  // 丢掉——而丢掉的方式是静默的，渲染出来的表照旧完整，只是少了一列。
  let oneOf
  const literal = /oneOf:\s*\[([^\]]*)\]/.exec(spec)
  if (literal !== null) oneOf = [...literal[1].matchAll(/'([^']*)'/g)].map(entry => entry[1])
  else {
    const named = /oneOf:\s*([A-Z][A-Z0-9_]*)/.exec(spec)
    if (named !== null) oneOf = constants.get(named[1])
  }
  const text = key => {
    const match = new RegExp(`${key}:\\s*'([^']*)'`).exec(spec)
    return match === null ? undefined : match[1]
  }
  return {
    name,
    about: about === null ? '' : about[1],
    optional: /optional:\s*true/.test(spec),
    ...oneOf === undefined || oneOf.length === 0 ? {} : { oneOf },
    ...text('appliesWhen') === undefined ? {} : { appliesWhen: text('appliesWhen') },
    ...text('default') === undefined ? {} : { default: text('default') },
    ...text('requiredWhen') === undefined ? {} : { requiredWhen: text('requiredWhen') },
  }
}

/** 把 `|` 和换行压掉，免得一个参数值把表格撑坏。 */
function cell(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
}

/**
 * 渲染整份文档。
 * @param {ReturnType<typeof actionsOf>} actions - 目录。
 * @returns {string} markdown。
 */
export function render(actions) {
  const parts = [BANNER]
  // 目录按 id 排序，而不是按源码顺序：源码顺序会随着合并变动，排序之后 diff 只反
  // 映内容变化，`--check` 的红才指得出「谁变了」。
  for (const action of [...actions].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(`## ${action.id}`)
    parts.push('')
    parts.push(action.summary)
    parts.push('')
    parts.push(`危险级 \`${action.danger}\`；经 \`${action.lane}\` 写入；动词 \`${action.verb}\`。`)
    const params = action.params
    if (params.length > 0) {
      parts.push('')
      parts.push('| 参数 | 必填 | 说明 | 可选值 | 缺省含义 |')
      parts.push('| --- | --- | --- | --- | --- |')
      for (const param of params) {
        const required = param.requiredWhen === undefined
          ? (param.optional ? '否' : '**是**')
          : `条件：${param.requiredWhen}`
        const values = param.oneOf === undefined ? '' : param.oneOf.map(value => `\`${value}\``).join(' / ')
        // 缺省含义优先说 `appliesWhen`，其次 `default`：两者都说时合并，因为它们回
        // 答的是同一件事的两半（什么时候没有意义、没有时是什么）。
        const absent = [param.appliesWhen, param.default].filter(part => part !== undefined).join('；')
        parts.push(`| \`${param.name}\` | ${cell(required)} | ${cell(param.about)} | ${cell(values)} | ${cell(absent)} |`)
      }
    }
    parts.push('')
  }
  return `${parts.join('\n').trimEnd()}\n`
}

/* ── CLI ──────────────────────────────────────────────────────────────────── */

// 作为脚本运行时才碰磁盘；被 spec import 时只导出纯函数。
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const check = process.argv.includes('--check')
  const catalogPath = join(root, 'src', 'core', 'board-actions.ts')
  if (!existsSync(catalogPath)) {
    console.error(`gen-skill-actions FAIL: no action catalog at ${catalogPath}`)
    process.exit(1)
  }
  const actions = actionsOf(readFileSync(catalogPath, 'utf8'))
  if (actions.length === 0) {
    // 空输入渲染出来的文档是空的，而空文档会让 `--check` 永远通过——一道在空输入上
    // 成功的门禁比没有门禁更糟。
    console.error('gen-skill-actions FAIL: read 0 actions out of the catalog — the parser no longer understands its shape')
    process.exit(1)
  }
  const rendered = render(actions)
  const outPath = join(root, ...OUTPUT.split('/'))
  if (check) {
    if (!existsSync(outPath)) {
      console.error(`gen-skill-actions FAIL: ${OUTPUT} does not exist. Run \`node scripts/gen-skill-actions.mjs\` and commit it.`)
      process.exit(1)
    }
    const onDisk = readFileSync(outPath, 'utf8')
    if (onDisk !== rendered) {
      console.error(
        `gen-skill-actions FAIL: ${OUTPUT} is out of date. The action catalog changed and this file did not.\n`
        + '  Run `node scripts/gen-skill-actions.mjs` and commit the result — the reference is generated so that it cannot describe a previous version of the catalog.',
      )
      process.exit(1)
    }
    console.log(`gen-skill-actions OK: ${OUTPUT} matches ${actions.length} actions`)
  } else {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, rendered, 'utf8')
    console.log(`gen-skill-actions: wrote ${OUTPUT} (${actions.length} actions)`)
  }
}
