#!/usr/bin/env node
/**
 * verify-carrier-parity.mjs — 一条载具的三端必须齐。
 *
 * ── 它守的是什么 ────────────────────────────────────────────────────────────
 *
 * 一条「载具」（carrier）是**跨进程的一个承诺**：宿主构造一条命令，浏览器去执行它。
 * 这个承诺成立的唯一条件是**两端都认识这个名字**。
 *
 * 而「两端都认识」在代码里曾经没有任何东西保证过。真实发生过：宿主发
 * `session.create`，页面那一侧的分派表里**没有这一支**，于是它被静默丢掉——
 * 而宿主回给调用方的仍是「已落盘，1 条已生效」。**一个工具报错，AI 会改；
 * 一个工具假装成功，AI 会一直换方法试。**
 *
 * 这不是一个漏掉的分支，是**三个地方各写一遍同一条清单**，而没有任何一处
 * 负责让它们相等：
 *
 *   1. `BOARD_COMMAND_CARRIERS`（core）—— 名字的家，也是租约里上报给宿主的能力；
 *   2. `BoardCommand` 联合（core）—— 每条命令真正长什么样；
 *   3. 浏览器的分派表（client）—— 这张页面真的会做哪些。
 *
 * 三者齐，承诺才成立。缺任何一端，症状都是**静默**的：没有类型错误（清单是
 * 手写的）、没有运行时异常（没人调用缺失的分支）、没有测试会红（测试造的是
 * 假面，假面记得住那一支）。
 *
 * ── 为什么这一条必须是门禁而不是注释 ────────────────────────────────────────
 *
 * 「加一条载具记得改三处」是一句**没有人执行**的规矩。项目自己的判据是：
 * 没有门禁守着的规则是假线索——它让人以为这件事有人管。所以这里把三处都读出来
 * 对账，并且**读不到就红**：一个读不到输入的检查，报成功比不报更糟。
 *
 * ── 判据只读结构（硬性规范 14）──────────────────────────────────────────────
 *
 * 三处都是**结构**：数组字面量、联合成员、对象字面量的键。扫描前先剥注释，
 * 所以一段解释里提到 `session.create` 不算一次用法。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────────
 *
 *   node scripts/verify-carrier-parity.mjs [plugin-dir]
 *   node scripts/verify-carrier-parity.mjs [plugin-dir] --probe-missing-client-branch
 *   node scripts/verify-carrier-parity.mjs [plugin-dir] --probe-undeclared-carrier
 *   node scripts/verify-carrier-parity.mjs [plugin-dir] --probe-unread-carriers
 *
 * 探针把**不可能成立**的输入喂进同一套检查，必须报红——否则「自测通过」证明不了
 * 任何事。
 *
 * @module dsh-task-board/scripts/verify-carrier-parity
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { probeOf } from './probe-args.mjs'
import { scanSource, stripSourceComments } from './source-core.mjs'

/** Where each of the three ends lives. Declared, not probed: this IS the map. */
export const CARRIER_ENDS = {
  /** The published name list (core). */
  list: { file: 'src/core/board-doc.ts', symbol: 'BOARD_COMMAND_CARRIERS' },
  /** The command union (core) — what a command can actually be. */
  union: { file: 'src/core/board-doc.ts', symbol: 'BoardCommand' },
  /** The browser dispatch table (client) — what this page performs. */
  dispatch: { file: 'src/client/index.ts', symbol: 'commandDoors' },
}

/**
 * The names in one array literal `const NAME = ['a', 'b'] as const`.
 * @param text - the source file.
 * @param symbol - the constant to find.
 * @returns the names, or null when the declaration could not be read.
 */
export function carrierListOf(text, symbol) {
  const source = stripSourceComments(text)
  const at = new RegExp(`(?:export\\s+)?const\\s+${symbol}\\s*(?::[^=]+)?=\\s*\\[`).exec(source)
  if (at === null) return null
  const open = at.index + at[0].length - 1
  const close = source.indexOf(']', open)
  if (close === -1) return null
  const names = [...source.slice(open, close).matchAll(/'([^']*)'/g)].map(match => match[1])
  return names.length === 0 ? null : names
}

/**
 * The `type:` literals of the command union.
 *
 * MATCHED ON THE WHOLE DECLARATION (`export type BoardCommand =`), never on a
 * prefix: `export type BoardCommandCarrier` starts with the same characters, and
 * a prefix search lands on that one-line alias, reads no members, and reports
 * the union as unreadable — a false red, which is how a gate gets switched off.
 * @param text - the source file.
 * @returns the carrier names, or null when unreadable.
 */
export function unionCarriersOf(text) {
  const source = stripSourceComments(text)
  const at = /^export type BoardCommand\s*=/m.exec(source)
  if (at === null) return null
  const names = []
  for (const line of source.slice(at.index).split('\n').slice(1)) {
    const isMember = /^\s*\|/.test(line) || /^\s{2}\*\s/.test(line) || line.trim() === ''
    if (!isMember) break
    for (const match of line.matchAll(/type:\s*'([^']*)'/g)) names.push(match[1])
  }
  return names.length === 0 ? null : names
}

/**
 * The keys of a typed dispatch table: `const NAME: { ... } = {` … `}`.
 *
 * Read by BRACE MATCHING over code characters only, so a `{` inside a string or a
 * comment cannot move the end. The keys are the `'name':` / `name:` labels at the
 * table's own depth — one level in, never nested members.
 * @param text - the source file.
 * @param symbol - the table's identifier.
 * @returns the keys, or null when the table could not be read.
 */
export function dispatchKeysOf(text, symbol) {
  const scan = scanSource(text)
  const at = new RegExp(`(?:const|let)\\s+${symbol}\\b`).exec(scan.text)
  if (at === null) return null
  /* THE OBJECT OPENS AFTER THE ASSIGNMENT, not at the first `{`.
   *
   * A table written with its type inline — `const x: { ... } = { ... }` — puts a
   * brace in the ANNOTATION, so "the first `{` after the name" lands inside the
   * type and the matching close is the type's, not the value's. The keys read
   * out of it are then type parameters, or nothing. `=\s*{` is the assignment
   * itself: an arrow type spells `=>`, never `= {`. */
  const assigned = /=\s*\{/g
  assigned.lastIndex = at.index
  const match = assigned.exec(scan.text)
  if (match === null) return null
  const open = match.index + match[0].length - 1
  let depth = 0
  let close = -1
  for (let i = open; i < scan.text.length; i++) {
    if (scan.state[i] !== 0) continue
    if (scan.text[i] === '{') depth += 1
    else if (scan.text[i] === '}') {
      depth -= 1
      if (depth === 0) { close = i; break }
    }
  }
  if (close === -1) return null
  // Labels at the table's own depth: walk one level in, taking `key:` only where
  // the enclosing brace is the table's. A nested object's key is one deeper.
  const keys = []
  depth = 0
  let i = open
  while (i < close) {
    /* BRACES COUNT ONLY IN CODE; KEYS MAY OPEN A QUOTED LITERAL.
     *
     * `scan.state` says a quote character is a LITERAL delimiter, not code — so
     * a loop that skips everything non-code never sees the start of a quoted
     * key, and `'session.create':` is invisible while `run:` is not. The result
     * is a table read as half its keys, and the missing half reported as
     * carriers with no performer: a false red on the exact check this gate
     * exists for. So a key may start at code OR at a quote, and only the brace
     * arithmetic requires code. */
    if (scan.state[i] === 0) {
      const ch = scan.text[i]
      if (ch === '{') { depth += 1; i += 1; continue }
      if (ch === '}') { depth -= 1; i += 1; continue }
    }
    if (depth !== 1) { i += 1; continue }
    // A key at depth 1: quoted or a bare identifier, followed by `:`.
    //
    // THE QUOTED FORM IS THE NORMAL ONE HERE, and its content is NOT an
    // identifier: `'session.create'` has a dot, so a key pattern restricted to
    // `[\w$]` reads two of four carriers. The quoted arm therefore accepts any
    // characters but its own quote.
    const quoted = /^(['"])([^'"]*)\1\s*:/.exec(scan.text.slice(i, i + 120))
    if (quoted !== null && (scan.state[i] === 0 || scan.state[i] === 2)) {
      keys.push(quoted[2])
      i += quoted[0].length
      continue
    }
    const bare = /^([A-Za-z_$][\w$]*)\s*:/.exec(scan.text.slice(i, i + 120))
    if (bare !== null && scan.state[i] === 0 && !/[\w$.]/.test(scan.text[i - 1] ?? '')) {
      keys.push(bare[1])
      i += bare[0].length
      continue
    }
    i += 1
  }
  return keys.length === 0 ? null : keys
}

/**
 * The findings for one set of sources. Pure, so the tests can call it directly.
 * @param input - the three texts, or `undefined` when a file is absent.
 * @returns the finding sentences; empty means the three ends agree.
 */
export function carrierParityFindings(input) {
  const findings = []
  const list = input.listText === undefined ? null : carrierListOf(input.listText, CARRIER_ENDS.list.symbol)
  const union = input.unionText === undefined ? null : unionCarriersOf(input.unionText)
  // `unionText` is the same file as `listText` in the real tree, and the two reads
  // are separate because they answer different questions.
  const dispatch = input.dispatchText === undefined ? null : dispatchKeysOf(input.dispatchText, CARRIER_ENDS.dispatch.symbol)

  if (list === null) {
    findings.push(`cannot read ${CARRIER_ENDS.list.symbol} out of ${CARRIER_ENDS.list.file} — that array is the one place a carrier name is written down AND what a page declares to the host with every lease. Without it the relay cannot tell a page that implements a carrier from one that does not, and a command gets promised to a page that drops it. This is a FINDING, not a skip.`)
  }
  if (union === null) {
    findings.push(`cannot read the carrier variants out of the ${CARRIER_ENDS.union.symbol} union in ${CARRIER_ENDS.union.file} — no \`type:\` literals were found, so every comparison below would have passed on an empty input. This is a FINDING, not a skip.`)
  }
  if (dispatch === null) {
    findings.push(`cannot read the browser dispatch table \`${CARRIER_ENDS.dispatch.symbol}\` out of ${CARRIER_ENDS.dispatch.file} — the table is what this page actually performs. Unreadable means the check below would pass on nothing. This is a FINDING, not a skip.`)
  }
  if (findings.length > 0) return findings

  const named = new Set(list)
  const carried = new Set(union)
  const performed = new Set(dispatch)

  // 1. The declared list and the union name the same carriers.
  for (const name of named) {
    if (!carried.has(name)) {
      findings.push(`${CARRIER_ENDS.list.symbol} declares "${name}" but the ${CARRIER_ENDS.union.symbol} union has no \`type: '${name}'\` — a page would declare it can perform a command that cannot be built, and the relay would answer about a carrier that does not exist.`)
    }
  }
  for (const name of carried) {
    if (!named.has(name)) {
      findings.push(`the ${CARRIER_ENDS.union.symbol} union carries \`type: '${name}'\` but ${CARRIER_ENDS.list.symbol} does not list it — no page can declare it, so the relay answers 「不支持」 to every caller about a carrier this build implements. Add it to the list, or the feature is unreachable by design and by accident at once.`)
    }
  }

  // 2. EVERY carrier has a door in the browser. This is the one that lied.
  for (const name of carried) {
    if (!performed.has(name)) {
      findings.push(`the carrier "${name}" has no branch in ${CARRIER_ENDS.dispatch.file}'s \`${CARRIER_ENDS.dispatch.symbol}\` — the host will build it, the relay will broadcast it to a live engine, the engine will have nowhere to send it, and the caller will be told the batch landed. A command with no performer is the exact shape of a tool that reports success it did not perform.`)
    }
  }
  // 3. And no door exists for a carrier that cannot be built.
  for (const name of performed) {
    if (!carried.has(name)) {
      findings.push(`${CARRIER_ENDS.dispatch.file}'s \`${CARRIER_ENDS.dispatch.symbol}\` has a door for "${name}", but no \`type: '${name}'\` exists in the ${CARRIER_ENDS.union.symbol} union — that door can never be reached, and it makes the page look like it performs something it cannot (the capability it declares is then a promise about an impossible command).`)
    }
  }
  return findings
}

/** Read the three sources off disk and check them. */
function readRepo(root) {
  const readOr = relative => {
    try {
      return readFileSync(join(root, relative), 'utf8')
    } catch {
      return undefined
    }
  }
  const list = readOr(CARRIER_ENDS.list.file)
  return carrierParityFindings({
    listText: list,
    // Same file, read once — the union lives beside the list by design.
    unionText: list,
    dispatchText: readOr(CARRIER_ENDS.dispatch.file),
  })
}

/** The self-test switch names this gate understands. */
const KNOWN_PROBES = ['--probe-missing-client-branch', '--probe-undeclared-carrier', '--probe-unread-carriers']

/**
 * The reads a probe substitutes. Each is a source the REAL check must refuse: a
 * page missing a branch, a list missing a name, and a file that cannot be read
 * at all. If any of them comes back green, the check is not running.
 */
const PROBES = {
  // A live carrier with no door in the browser — the incident this gate exists for.
  '--probe-missing-client-branch': () => carrierParityFindings({
    listText: "export const BOARD_COMMAND_CARRIERS = ['run', 'comment'] as const\nexport type BoardCommand =\n  | { type: 'run'; taskId: string }\n  | { type: 'comment'; taskId: string }\n",
    unionText: "export const BOARD_COMMAND_CARRIERS = ['run', 'comment'] as const\nexport type BoardCommand =\n  | { type: 'run'; taskId: string }\n  | { type: 'comment'; taskId: string }\n",
    dispatchText: "const commandDoors: Record<string, unknown> = {\n  run: command => {},\n}\n",
  }),
  // A union member the declared list forgot: no page can promise it.
  '--probe-undeclared-carrier': () => carrierParityFindings({
    listText: "export const BOARD_COMMAND_CARRIERS = ['run'] as const\nexport type BoardCommand =\n  | { type: 'run'; taskId: string }\n  | { type: 'comment'; taskId: string }\n",
    unionText: "export const BOARD_COMMAND_CARRIERS = ['run'] as const\nexport type BoardCommand =\n  | { type: 'run'; taskId: string }\n  | { type: 'comment'; taskId: string }\n",
    dispatchText: "const commandDoors: Record<string, unknown> = {\n  run: command => {},\n  comment: command => {},\n}\n",
  }),
  // Nothing readable at all: the gate must report, never pass.
  '--probe-unread-carriers': () => carrierParityFindings({ listText: '', unionText: '', dispatchText: '' }),
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
    console.log(`verify-carrier-parity self-test ${probe} OK: ${findings.length} finding(s), as it must`)
    console.log(`  ${findings[0]}`)
    return
  }
  const findings = readRepo(root)
  if (findings.length > 0) {
    console.error('FAIL verify-carrier-parity:')
    for (const finding of findings) console.error(`  ${finding}`)
    process.exit(1)
  }
  console.log('verify-carrier-parity OK: every declared carrier is a buildable command and every buildable command has a door in the browser')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
