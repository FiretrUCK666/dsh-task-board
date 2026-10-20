#!/usr/bin/env node
/**
 * source-core.mjs —— 扫描一份 JS/TS 源码时，怎么读到**结构**而不是**字样**。
 *
 * 硬性规范 14：判据只许读结构，不许读字样；扫描先剥注释再匹配。
 * 注释里出现 `case 'task.create':` 不是一次执行路径，字符串里出现
 * `approveTaskToStatus(` 不是一次调用——两者都会让门禁说谎，而且**不报错**。
 *
 * ── 这一份是唯一的一份 ────────────────────────────────────────────────────
 *
 * 「怎么把注释从源码里去掉」只有一处实现，各处导入。自己剥一份的代价不是那几行：
 * 自己剥的那一份只要**行为不完全一样**（比如跨行块注释处理得不一样），两个门禁
 * 就会对同一段源码给出不同的结论，而谁也看不出是哪一份错了。
 *
 * ── 三种位置 ────────────────────────────────────────────────────────────────
 *
 * 源码里的每个字符属于三处之一，扫描要能分开它们：
 *
 *   · **代码**：`if`、`.relay`、`case` 这些关键字与标识符。
 *   · **注释**：`// …` 与 `/* … *\/`。整段不算代码。
 *   · **字符串字面量**：`'engine'`、`"task.create"`。字面量**本身**是代码（它是一个
 *     表达式），但它的**内容**不是代码——内容里的 `case` 不是一次分支。
 *
 * 字面量的内容要留着（`case 'task.create':` 的标签就在里面），所以本模块不把它
 * 删掉，而是给每个字符标一个位置，由调用方按需要判断。
 *
 * ── 已知的一处让步 ──────────────────────────────────────────────────────────
 *
 * 模板字符串整体当字面量看，所以 `${ … }` 里的代码不被读成代码。仓库里没有一处
 * 判据依赖模板插值里的结构，所以这是有意识的取舍，不是遗漏。
 */

/** 一个字符是代码。 */
export const SOURCE_CODE = 0
/** 一个字符在注释里。 */
export const SOURCE_COMMENT = 1
/** 一个字符是**代码里**一个字符串字面量的定界引号（开始或结束）。 */
export const SOURCE_LITERAL = 2
/** 一个字符在字符串字面量的内容里（含嵌在别的字面量里的引号）。 */
export const SOURCE_LITERAL_BODY = 3

/**
 * 哪些词之后可以出现正则字面量。
 *
 * `/` 有两种读法：除法与正则。分界线是**前一个词**：数字或 `)` 之后是除法，
 * `return` 之后是正则。这条读法有历史包袱（`if (x) /re/.test(y)` 会被读成除法），
 * 而仓库里没有一处判据依赖那种写法，所以按词表读就够。
 */
const REGEX_AFTER_WORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
])

/** `/` 在这里开头的，是正则字面量而不是除法。 */
function startsRegex(lastChar, lastWord) {
  if (lastChar === '') return true
  if (lastChar === ')' || lastChar === ']' || lastChar === '}') return false
  if (/[0-9]/.test(lastChar)) return false
  if (/[A-Za-z_$]/.test(lastChar)) return REGEX_AFTER_WORD.has(lastWord)
  return true
}

/**
 * 扫一遍源码，给每个字符标出它在哪。
 *
 * **位置原样保留**：注释被换成等长的空格（换行留着），所以报错的行号与偏移仍然
 * 指得回原文——一个把字符删掉的读法会让所有偏移错位，而错位的偏移指回的地方是
 * 另一段话。
 * @param {string} source - 源码全文。
 * @returns {{ text: string, state: Uint8Array }} 注释已变空白的文本，与逐字符的位置。
 */
export function scanSource(source) {
  const n = source.length
  const state = new Uint8Array(n)
  const out = new Array(n)
  // 0 = 代码，1 = 行注释，2 = 块注释，3 = 字符串字面量，4 = 正则字面量
  let mode = 0
  let quote = ''
  let inClass = false
  let lastChar = ''
  let lastWord = ''
  let i = 0
  while (i < n) {
    const ch = source[i]
    if (mode === 0) {
      if (ch === '/' && source[i + 1] === '/') {
        state[i] = SOURCE_COMMENT; out[i] = ' '
        state[i + 1] = SOURCE_COMMENT; out[i + 1] = ' '
        mode = 1; i += 2; continue
      }
      if (ch === '/' && source[i + 1] === '*') {
        state[i] = SOURCE_COMMENT; out[i] = ' '
        state[i + 1] = SOURCE_COMMENT; out[i + 1] = ' '
        mode = 2; i += 2; continue
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch; mode = 3
        state[i] = SOURCE_LITERAL; out[i] = ch
        i += 1; continue
      }
      if (ch === '/' && startsRegex(lastChar, lastWord)) {
        mode = 4; inClass = false
        state[i] = SOURCE_LITERAL; out[i] = ch
        i += 1; continue
      }
      state[i] = SOURCE_CODE; out[i] = ch
      if (!/\s/.test(ch)) {
        lastChar = ch
        if (/[\w$]/.test(ch)) lastWord += ch
        else lastWord = ''
      }
      i += 1; continue
    }
    if (mode === 1) {
      if (ch === '\n') { mode = 0; state[i] = SOURCE_CODE; out[i] = '\n' }
      else { state[i] = SOURCE_COMMENT; out[i] = ' ' }
      i += 1; continue
    }
    if (mode === 2) {
      if (ch === '*' && source[i + 1] === '/') {
        state[i] = SOURCE_COMMENT; out[i] = ' '
        state[i + 1] = SOURCE_COMMENT; out[i + 1] = ' '
        mode = 0; i += 2; continue
      }
      state[i] = SOURCE_COMMENT; out[i] = ch === '\n' ? '\n' : ' '
      i += 1; continue
    }
    if (mode === 3) {
      if (ch === '\\') {
        state[i] = SOURCE_LITERAL_BODY; out[i] = ch
        i += 1
        if (i < n) { state[i] = SOURCE_LITERAL_BODY; out[i] = source[i] }
        i += 1; continue
      }
      if (ch === quote) {
        state[i] = SOURCE_LITERAL; out[i] = ch
        mode = 0; i += 1; continue
      }
      state[i] = SOURCE_LITERAL_BODY; out[i] = ch
      i += 1; continue
    }
    // 正则字面量：里面的字符都不是代码。
    if (ch === '\\') {
      state[i] = SOURCE_LITERAL_BODY; out[i] = ch
      i += 1
      if (i < n) { state[i] = SOURCE_LITERAL_BODY; out[i] = source[i] }
      i += 1; continue
    }
    if (ch === '[' && !inClass) {
      inClass = true
      state[i] = SOURCE_LITERAL_BODY; out[i] = ch
      i += 1; continue
    }
    if (ch === ']' && inClass) {
      inClass = false
      state[i] = SOURCE_LITERAL_BODY; out[i] = ch
      i += 1; continue
    }
    if (ch === '/' && !inClass) {
      state[i] = SOURCE_LITERAL; out[i] = ch
      mode = 0; i += 1
      while (i < n && /[A-Za-z]/.test(source[i])) {
        state[i] = SOURCE_LITERAL; out[i] = source[i]; i += 1
      }
      continue
    }
    state[i] = SOURCE_LITERAL_BODY; out[i] = ch
    i += 1
  }
  return { text: out.join(''), state }
}

/**
 * 把注释去掉，其余原样（位置一一对应）。
 * @param {string} source - 源码全文。
 * @returns {string} 注释已变空白的源码。
 */
export function stripSourceComments(source) {
  return scanSource(source).text
}

/**
 * `case` 标签：代码里的那些，附带它们在源码里的位置。
 *
 * **只认代码里的**：注释里写一句 `case 'task.create':` 不是一次执行路径，字符串里
 * 写一句也不是。引号两种写法都认——`case 'x.y':` 与 `case "x.y":` 是同一条分支，
 * 只认一种会让一个正确的实现被报成「没有执行路径」。
 * @param {{ text: string, state: Uint8Array }} scan - 扫过的源码。
 * @returns {{ id: string, index: number, end: number }[]} 标签、它的起点与它之后的第一个位置。
 */
export function caseLabelsOf(scan) {
  const { text, state } = scan
  const labels = []
  for (let i = 0; i < text.length; i++) {
    if (state[i] !== SOURCE_CODE) continue
    if (!text.startsWith('case', i)) continue
    if (i > 0 && /[\w$]/.test(text[i - 1])) continue
    const after = text[i + 4]
    if (after === undefined || !/\s/.test(after)) continue
    let j = i + 4
    while (j < text.length && /\s/.test(text[j])) j += 1
    const quote = text[j]
    if (quote !== "'" && quote !== '"') continue
    let k = j + 1
    while (k < text.length && text[k] !== quote && text[k] !== '\n') k += 1
    if (text[k] !== quote) continue
    const id = text.slice(j + 1, k)
    let m = k + 1
    while (m < text.length && /\s/.test(text[m])) m += 1
    if (text[m] !== ':') continue
    labels.push({ id, index: i, end: m + 1 })
  }
  return labels
}

/**
 * 第一个**起点在代码里**的匹配。
 *
 * 用在「这个关键字是不是真的写着」的判据上：注释里的一句 `relay === undefined`
 * 不是一次判据，字符串里的一句也不是。
 * @param {{ text: string, state: Uint8Array }} scan - 扫过的源码。
 * @param {RegExp} pattern - 模式（不带 g 也行）。
 * @returns {RegExpExecArray | null} 第一个合法匹配。
 */
export function firstCodeMatch(scan, pattern) {
  return firstMatchWhere(scan, pattern, m => scan.state[m.index] === SOURCE_CODE)
}

/**
 * 第一个**起点是一个代码里的字符串字面量定界引号**的匹配。
 *
 * 用在「这个动作是不是被认出了名字」这类判据上：`'task.run'` 写在代码里是一次
 * 认名字，写在注释里不是，写在另一个字符串的内容里也不是。
 * @param {{ text: string, state: Uint8Array }} scan - 扫过的源码。
 * @param {RegExp} pattern - 模式（不带 g 也行）。
 * @returns {RegExpExecArray | null} 第一个合法匹配。
 */
export function firstLiteralMatch(scan, pattern) {
  return firstMatchWhere(scan, pattern, m => scan.state[m.index] === SOURCE_LITERAL)
}

/** 逐个匹配，直到有一个满足 `accept`。 */
function firstMatchWhere(scan, pattern, accept) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const re = new RegExp(pattern.source, flags)
  let match = re.exec(scan.text)
  while (match !== null) {
    if (accept(match)) return match
    if (match[0].length === 0) re.lastIndex += 1
    match = re.exec(scan.text)
  }
  return null
}

/**
 * 从 `from` 起的一段，**按大括号配对**取出来。
 *
 * 大括号只在代码里算数：字符串里的 `{` 与注释里的 `{` 不改变深度，所以一段代码
 * 里的字符串不会把配对带偏。
 * @param {{ text: string, state: Uint8Array }} scan - 扫过的源码。
 * @param {number} from - 起点。
 * @returns {{ text: string, state: Uint8Array } | null} 那一段，或 null。
 */
export function bracedRegionOf(scan, from) {
  const { text, state } = scan
  let open = -1
  for (let i = from; i < text.length; i++) {
    if (state[i] === SOURCE_CODE && text[i] === '{') { open = i; break }
  }
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (state[i] !== SOURCE_CODE) continue
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) {
        const end = i + 1
        return { text: text.slice(from, end), state: state.slice(from, end) }
      }
    }
  }
  return null
}
