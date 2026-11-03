#!/usr/bin/env node
/**
 * verify-read-write-parity.mjs — 能写的东西，必须读得回来。
 *
 * ── 它守的是什么 ────────────────────────────────────────────────────────────
 *
 * 一个只看表面看不出、但会让调用者**只能猜**的缺陷：**可写面比可读面大**。
 *
 * 真实发生过。模型能设六项运行配置、能给卡上排期、能建会话规则、能挂来源——
 * 而 `taskboard_query` 只回标题与状态。于是「给这张卡加一条规则」这件事**没法
 * 正确完成**：`rule.create` 要一个 session id，而整个工具面上没有任何一条查询
 * 会返回它。剩下的动作只有两个：猜，或者请人去屏幕上把 id 抄下来。
 *
 * **能写却不能读的工具，是在逼它的调用者猜；而猜出来的东西在出事之前和答案
 * 长得一模一样。**
 *
 * ── 判据为什么必须是「同一张表」而不是一份清单 ──────────────────────────────
 *
 * 「记得把新字段也加进查询」是一句**没有人执行**的规矩。所以这里不写字段清单，
 * 而是让两侧都对同一份声明负责：
 *
 *   · **写侧**：目录里每个写动作的每个参数（`ACTIONS[*].params`）；
 *   · **读侧**：查询投影真正产出的键（`taskRow` / `taskDetailRow` /
 *     `taskDeepRow` / `itemRow` / `itemDetailRow` 的对象字面量）。
 *
 * 这是一条**结构**判据：参数名与投影键名对不上时它才说话，而不是有一个它
 * 不认识的字段名时才说话。
 *
 * ── 它对什么沉默，以及为什么 ────────────────────────────────────────────────
 *
 * `of` 是**寻址**不是字段：每个动作都有它，它指的不是卡片上的数据。同理
 * `send`/`trigger`/`mode` 这类**动词的修饰**不是卡片的字段，读到它们的回执是
 * 那一句 `detail`。这些在 {@link NOT_A_FIELD} 里**逐个写明理由**——一条没有理由
 * 的豁免与漏掉一个没有区别。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────────
 *
 *   node scripts/verify-read-write-parity.mjs [plugin-dir]
 *   node scripts/verify-read-write-parity.mjs [plugin-dir] --probe-writable-unread
 *   node scripts/verify-read-write-parity.mjs [plugin-dir] --probe-unreadable-input
 *
 * @module dsh-task-board/scripts/verify-read-write-parity
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { probeOf } from './probe-args.mjs'
import { scanSource, stripSourceComments } from './source-core.mjs'

/** Where the two sides live. Declared, not probed. */
export const PARITY_ENDS = {
  /** The catalog: every write action's parameters. */
  catalog: 'src/core/board-actions.ts',
  /** The projections: what a query actually returns. */
  tools: 'src/host/agent/tools.ts',
}

/**
 * Parameters that are NOT card fields, each with the reason it is exempt.
 *
 * A key here is a promise that reading it back is either meaningless or happens
 * somewhere other than a row. Anything not listed and not found in a projection
 * is a finding — so adding a parameter is cheap and adding an EXEMPTION is a
 * sentence somebody has to write.
 */
export const NOT_A_FIELD = {
  // Addressing: every action has one, and it names WHICH row, not what is on it.
  of: '寻址：它指的是「哪一条」，不是那一条上的数据。回执里的「受影响的」已经把它说回来了。',
  // Verbs' modifiers: they choose HOW an action happens, and the receipt for the
  // action states which choice was taken. They are not stored on a card.
  send: '动词修饰：排队还是插话，是「这一次怎么说」。回执里写明是哪一种，卡片上不留这个字段。',
  trigger: '动词修饰：这次跑动的归因（manual/schedule/chain），写在执行记录上，不是卡片字段。',
  mode: '动词修饰：排期的形态（cron/chain），读它的地方是排期那条投影，不是参数同名。',
  // The envelope, not an action's parameter — but it rides the same table shape.
  dry_run: '信封参数：整批演练与否，不落在任何文档上。',
  idempotencyKey: '信封参数：重试安全用，不落在任何文档上。',
  // Batch/identity parameters on the checklist side.
  beforeId: '排序：它说的是「插到谁前面」，读回来的是那一段顺序本身（sessionsOrder / 卡片 order）。',
  cardTitle: '造卡的参数：新卡的标题立刻就是可读的 `title`，这个参数只是「造的时候叫什么」。',
  cardPrompt: '造卡的参数：新卡的 Prompt 立刻就是可读的 `prompt`，这个参数只是「造的时候写什么」。',
  rule: '指向：某条规则的身份，规则本身连同内容整条可读。',
  round: '指向：某条轮次的身份，轮次账目整条可读。',
  step: '指向：某一格勾选框的身份，整份步骤连同 id 一起可读。',
  session: '指向：某条会话的身份，卡片深读里 sessions 带 id 与名字。',
  workspace: '指向：某个工作区的身份，深读里 binds 带工作区名。',
  target: '界面导航参数：切到哪个舞台，不是数据。',
  page: '界面导航参数：跳到清单的哪一页（清单/日程），是显示位置，不是这一行上的数据。',
  scope: '界面导航参数：标已读 / 收起时动哪一层，不是数据。',
  hidden: '界面导航参数：收起还是恢复，是显示选择。',
  label: '预设的名字：预设本身整条可读（含 label）。',
  cron: '预设/规则的表达式：读它的地方是排期与规则那两条投影。',
  kind: '预设分类：读它的是预设那两条投影。',
  makeDefault: '预设的默认位：读回来的是 `defaultId`。',
  enabled: '开关：它的可读形态是排期的 enabled、规则的 enabled——同名的字段就在那条投影里。',
  instruction: '规则内容：规则的 `sends` 就是它（用 Prompt 还是自定义文本，那里一句话说清）。',
  usePrompt: '规则内容：同上，`sends` 已经把它翻译成了人话。',
  maxRuns: '排期上限：深读的 schedule.maxRuns。',
  limit: '巡航并发上限：巡航不是卡片字段，读它的是看板状态。',
  attachments: '附件的字节不在文档里；可读形态是这张卡/这一轮的附件数量。',
  title: '标题：每张卡、每条会话、每条规则、每个预设都有可读的同名字段。',
}

/**
 * The card/row fields a projection MUST cover when a parameter writes them.
 *
 * Some parameters write a field whose READ name differs, and that rename is
 * deliberate rather than an oversight — so the mapping is declared here instead
 * of being left to a heuristic that would accept anything.
 */
export const READ_AS = {
  // A rule's id is read back as the rule's own `id` inside `rules[]`.
  rule: 'rules[].id',
  // The sources a card is born with are READ as `binds`, because that is what
  // the document calls them and what a reader of the row sees. The write keeps
  // the singular name because it is "the bind list you are giving it".
  bind: 'binds',
  // `session.create`'s run config is read back as the six flat fields plus
  // `runConfig`; `config` is the carrier's own nesting of the same six.
  config: 'runConfig',
  // A comment's `command` flag lives on the ROUND, not on the card, so it is
  // read through `include: ['rounds']` — whose entries carry the same key.
  command: 'rounds[].command',
}

/** Read the parameter names each write action declares. */
export function catalogParamsOf(text, runConfigKeys) {
  const source = stripSourceComments(text)
  const at = source.indexOf('export const ACTIONS')
  if (at === -1) return null
  const names = new Set()
  // Action blocks begin at two-space indentation: `'task.create': {`.
  const blocks = [...source.slice(at).matchAll(/^ {2}'([a-z]+\.[A-Za-z]+)':\s*\{/gm)]
  for (let index = 0; index < blocks.length; index += 1) {
    const start = blocks[index].index
    const end = index + 1 < blocks.length ? blocks[index + 1].index : source.length
    const body = source.slice(start, end)
    // Only parameters: the `params: { … }` region of the block.
    const paramsAt = body.indexOf('params: {')
    if (paramsAt === -1) continue
    const region = body.slice(paramsAt)
    for (const match of region.matchAll(/^ {6}([A-Za-z_$][\w$]*):/gm)) names.add(match[1])
    // A spread contributes its own keys, and they have to be RESOLVED: an
    // unresolved spread would silently hide six real parameters from the check.
    if (/\.\.\.RUN_CONFIG_PARAMS/.test(region)) {
      if (runConfigKeys === null || runConfigKeys === undefined) return null
      for (const key of runConfigKeys) names.add(key)
    }
  }
  return names.size === 0 ? null : [...names]
}

/** Where the run-config key list lives — the one declaration the spread imports. */
export const RUN_CONFIG_HOME = 'src/core/run-presets.ts'

/**
 * The run-config keys, read off their own declaration.
 *
 * The catalog spreads `RUN_CONFIG_PARAMS` into two actions rather than spelling
 * six parameters out; that spread is only honest if this gate can resolve it.
 * A spread it could not read would make six real parameters invisible to the
 * check — the shape of a gate that passes on a subset it can see.
 * @param text - the source of {@link RUN_CONFIG_HOME}.
 * @returns the keys, or null when unreadable (a finding at the call site).
 */
export function runConfigKeysOf(text) {
  const source = stripSourceComments(text)
  const at = /(?:export\s+)?const\s+RUN_CONFIG_KEYS\s*=\s*\[/.exec(source)
  if (at === null) return null
  const open = at.index + at[0].length - 1
  const close = source.indexOf(']', open)
  if (close === -1) return null
  const keys = [...source.slice(open, close).matchAll(/'([^']*)'/g)].map(match => match[1])
  return keys.length === 0 ? null : keys
}

/**
 * The key names a set of row-building functions produce.
 *
 * Read by BRACE MATCHING over the function bodies, then every `key:` label at the
 * object literal's own depth. Text-level `key:` inside strings and comments is
 * excluded through the same scanner the rest of the gates use.
 * @param text - `src/host/agent/tools.ts`.
 * @param functions - the row builders to read.
 * @returns the union of their key names, or null when none could be read.
 */
export function projectionKeysOf(text, functions) {
  const scan = scanSource(text)
  const keys = new Set()
  for (const name of functions) {
    const at = new RegExp(`function\\s+${name}\\s*\\(`).exec(scan.text)
    if (at === null) continue
    // The body opens at the first `{` in code after the signature.
    let open = -1
    let depth = 0
    for (let i = at.index; i < scan.text.length; i++) {
      if (scan.state[i] !== 0) continue
      if (scan.text[i] === '(') depth += 1
      else if (scan.text[i] === ')') { depth -= 1; if (depth === 0) { open = i; break } }
    }
    if (open === -1) continue
    let bodyOpen = -1
    for (let i = open; i < scan.text.length; i++) {
      if (scan.state[i] === 0 && scan.text[i] === '{') { bodyOpen = i; break }
    }
    if (bodyOpen === -1) continue
    let level = 0
    for (let i = bodyOpen; i < scan.text.length; i++) {
      if (scan.state[i] === 0) {
        if (scan.text[i] === '{') level += 1
        else if (scan.text[i] === '}') {
          level -= 1
          if (level === 0) break
        }
      }
      // ANY depth: a projection nests (`schedule: { mode… }`, `sessions: [{ … }]`),
      // and a nested field is as readable as a top-level one. Reading only depth
      // one would miss `mode` and then report a schedule parameter as unreadable.
      const quoted = /^(['"])([A-Za-z_$][\w$]*)\1\s*:/.exec(scan.text.slice(i, i + 80))
      if (quoted !== null && (scan.state[i] === 0 || scan.state[i] === 2)) {
        keys.add(quoted[2])
        i += quoted[0].length
        continue
      }
      const bare = /^([A-Za-z_$][\w$]*)\s*:/.exec(scan.text.slice(i, i + 80))
      if (bare !== null && scan.state[i] === 0 && !/[\w$.]/.test(scan.text[i - 1] ?? '')) {
        keys.add(bare[1])
        i += bare[0].length
        continue
      }
    }
  }
  return keys.size === 0 ? null : keys
}

/**
 * The row builders and projections the query answers from. Named once, read by
 * the gate.
 *
 * `includedOf` is here because it IS a projection: `include: ['comments']` and
 * `include: ['rounds']` return content, and a field that only those carry
 * (a round's `command`, a comment's full text) is readable exactly because of
 * it. Leaving it out would make the gate report that content as unreadable —
 * a false red, and the cheapest repair for a false red is to weaken the gate.
 */
export const PROJECTION_FUNCTIONS = [
  'taskRow',
  'taskDetailRow',
  'taskDeepRow',
  'itemRow',
  'itemDetailRow',
  'includedOf',
]

/**
 * The findings, pure, so the tests call them directly.
 * @param input - the two source texts.
 * @returns the finding sentences; empty means the two sides agree.
 */
export function readWriteParityFindings(input) {
  const findings = []
  const runConfigKeys = input.runPresetsText === undefined ? null : runConfigKeysOf(input.runPresetsText)
  const params = input.catalogText === undefined ? null : catalogParamsOf(input.catalogText, runConfigKeys)
  const keys = input.toolsText === undefined ? null : projectionKeysOf(input.toolsText, PROJECTION_FUNCTIONS)
  if (params === null) {
    findings.push(`cannot read the write parameters out of ${PARITY_ENDS.catalog} — no ACTIONS blocks with \`params:\` were found, or a spread of RUN_CONFIG_PARAMS could not be resolved through ${RUN_CONFIG_HOME}. Every check below would have passed on an empty input. This is a FINDING, not a skip.`)
  }
  if (keys === null) {
    findings.push(`cannot read the query projection out of ${PARITY_ENDS.tools} — none of ${PROJECTION_FUNCTIONS.join(' / ')} produced a readable object literal, so every check below would have passed on an empty input. This is a FINDING, not a skip.`)
  }
  if (findings.length > 0) return findings

  for (const name of params) {
    if (Object.hasOwn(NOT_A_FIELD, name)) continue
    if (keys.has(name)) continue
    const alias = READ_AS[name]
    if (alias !== undefined) {
      // A declared rename must still land somewhere readable.
      const leaf = alias.split('.').pop()
      if (leaf !== undefined && keys.has(leaf)) continue
    }
    findings.push(`the parameter "${name}" can be WRITTEN by the model, but no query projection returns it — so a model can set it and can never read it back. Either add it to a row builder (taskRow / taskDetailRow / taskDeepRow / itemRow / itemDetailRow), or list it in NOT_A_FIELD with the sentence explaining why reading it is not a field read. A tool that can write what it cannot read makes its caller guess, and a guess is indistinguishable from an answer until something breaks.`)
  }
  return findings
}

/** Read the real files and check them. */
function readRepo(root) {
  const readOr = relative => {
    try {
      return readFileSync(join(root, relative), 'utf8')
    } catch {
      return undefined
    }
  }
  return readWriteParityFindings({
    catalogText: readOr(PARITY_ENDS.catalog),
    toolsText: readOr(PARITY_ENDS.tools),
    runPresetsText: readOr(RUN_CONFIG_HOME),
  })
}

const KNOWN_PROBES = ['--probe-writable-unread', '--probe-unreadable-input']

const PROBES = {
  // A parameter nobody can read back: the defect this gate exists for.
  '--probe-writable-unread': () => readWriteParityFindings({
    catalogText: "export const ACTIONS = {\n  'task.create': {\n    params: {\n      smuggledField: { about: 'x' },\n    },\n  },\n}\n",
    toolsText: 'function taskRow(task: TaskRecord): TaskRow {\n  return { title: task.title }\n}\nfunction taskDeepRow(task: TaskRecord) { return {} }\n',
    runPresetsText: "export const RUN_CONFIG_KEYS = ['workspaceId'] as const\n",
  }),
  // Nothing readable on either side: must report, never pass.
  '--probe-unreadable-input': () => readWriteParityFindings({ catalogText: '', toolsText: '', runPresetsText: '' }),
}

function main() {
  const root = resolve(process.argv[2] !== undefined && !process.argv[2].startsWith('--') ? process.argv[2] : '.')
  const probe = probeOf(KNOWN_PROBES)
  if (probe !== undefined) {
    const findings = PROBES[probe]()
    if (findings.length === 0) {
      console.error(`FAIL self-test ${probe}: the check came back GREEN on input it must refuse — it is not reading what it claims to read`)
      process.exit(1)
    }
    console.log(`verify-read-write-parity self-test ${probe} OK: ${findings.length} finding(s), as it must`)
    console.log(`  ${findings[0]}`)
    return
  }
  const findings = readRepo(root)
  if (findings.length > 0) {
    console.error('FAIL verify-read-write-parity:')
    for (const finding of findings) console.error(`  ${finding}`)
    process.exit(1)
  }
  console.log('verify-read-write-parity OK: every parameter the model can write is reachable from a query projection, or says why it is not a field')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
