#!/usr/bin/env node
/**
 * CSS 的**唯一解析处**：读一张样式表，回答「有哪些规则」。
 *
 * ── 为什么这必须只有一份 ────────────────────────────────────────────────────
 *
 * 这条代码被抄过四份（`verify-capsule-centring` / `-decoration-property` /
 * `-hover-contrast` / `-scroll-floor`），而它们**读法互相不同**：
 *
 *   - 三份用 `/([^{}]+)\{([^{}]*)\}/g` 平铺，**不下降进 at-rule**。于是
 *     `@container … { .a { … } }` 整块被当成一条规则，选择器是 `@container …`。
 *     这个仓库的窄档规则全在 at-rule 里（164 条），也就是说**布局最密集的那一段
 *     对三条门禁从来没有可见过**。
 *   - 一份手写下降，但只修了它自己。
 *
 * 这不是「几行重复」的问题。抄一份的代价是**改一处不报错**：同一个 bug 在另外三份里
 * 继续活着，而每一份都自称「自测通过」。所以解析只有一处，四份调用点全部 import。
 *
 * ── 三条不可让步的性质 ──────────────────────────────────────────────────────
 *
 *   1. **下降进 at-rule**，并把 at-rule 的完整前导（含条件）带在规则上。判断
 *      「谁是谁的子元素」在窄档里问的仍是同一个问题，只是多一层不知道宽度的祖先。
 *   2. **先剥注释再匹配**，且剥的时候保留行号（等长空白替换）。注释里出现
 *      `align-items: baseline` 不是一次漂移。
 *   3. **行号从原文算**，不从剥完的文本算——报错要指得回真实文件。
 *
 * 纯函数，没有 I/O、没有全局状态，所以 probe 能直接种文本断言它会咬。
 */

/**
 * 剥掉注释，**保留行号与字符位置**（用等长空白替换，换行符原样留下）。
 * @param css - 源文本。
 * @returns 等长的、注释已变成空白的文本。
 */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
}

/**
 * 把样式表拆成规则列表，**下降进 at-rule**。
 *
 * @param css - 源文本（可以带注释；内部会剥）。
 * @param at - 当前的 at-rule 前导（递归用，调用方不要传）。
 * @param base - 本段文本在**原文**里的起始偏移（递归用，调用方不要传）。
 * @returns `{ selector, body, line, at, offset, endOffset }` 数组。`at` 是这条规则
 *   所在 at-rule 的完整前导（顶层规则是 `''`），`line` 是 1 起的真实行号，
 *   `offset` / `endOffset` 是**相对原文**的字符区间。
 *
 * ── 为什么偏移必须相对原文 ──────────────────────────────────────────────────
 *
 * 递归进 at-rule 时切出的是 `body` 子串，它自己的下标从 0 开始。如果直接把那个
 * 下标当偏移报出去，所有 at-rule 里的规则都会指回文件开头——搬运时会切到别的段落，
 * 而这件事**看起来只是「样式少了一点」**。所以 `base` 一路加下去，保证任何一个
 * 偏移拿去切原文都是对的。实测：不加 `base` 时有 10 对区间前后颠倒。
 */
export function rulesOf(css, at = '', base = 0) {
  const text = stripComments(css)
  const rules = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    let depth = 1
    let j = open + 1
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
      j++
    }
    const raw = text.slice(i, open)
    const prelude = raw.trim()
    const body = text.slice(open + 1, j - 1)
    /* `line` 是**选择器第一个字符**所在行，`offset` 是它在原文里的字符位置，
       `endOffset` 是规则体闭合 `}` 之后的位置。行号只用于报错，偏移用于搬运。 */
    const lead = raw.length - raw.trimStart().length
    const offset = base + i + lead
    const line = (text.slice(0, i + lead).match(/\n/g)?.length ?? 0) + 1
    if (prelude.startsWith('@')) {
      /* 容器：递归进去。`@supports` / `@container` / `@media` 的前导都只是「在什么
         条件下」，不是选择器本身，但它必须被带下去——一条规则的完整身份是
         「在哪个 at-rule 里的哪条选择器」。
         **`@keyframes` 不递归**：它的内部是帧（`0%` / `50%`），不是选择器，按规则
         读会把每一帧当成一条顶层规则、搬走时切坏。整块作为一个不可分单元。 */
      if (/^@(-[a-z]+-)?keyframes\b/.test(prelude)) {
        rules.push({ selector: prelude, body, line, at, offset, endOffset: base + j, opaque: true })
      } else {
        const nested = at === '' ? prelude : `${at} ${prelude}`
        rules.push(...rulesOf(body, nested, base + open + 1))
      }
    } else if (prelude !== '') {
      rules.push({ selector: prelude, body, line, at, offset, endOffset: base + j })
    } else {
      /* **匿名块也要下降。** 前导为空的 `{ … }` 在 CSS 里装的是**规则**（不是声明）——
       * CSS Nesting 里它就是「没有条件的嵌套」。

       * 这一条曾经是「空前导 = 跳过」，于是**脚本侧读不到匿名块里的规则**，
       * 而测试侧（`tests/panel-harness.ts` 的 `allRules`）读得到——**同一段 CSS
       * 两个答案**。仓库今天没有匿名块，所以两边结果相同；可那不是「都对」，
       * 是「今天恰好没有」。读法只有一份的规矩就在这里：两边必须给同一个答案。 */
      rules.push(...rulesOf(body, at, base + open + 1))
    }
    i = j
  }
  return rules
}

/**
 * 一条声明块里某条属性的**最后**一个值（CSS 的后者胜出）。
 * @param body - 规则体。
 * @param property - 属性名（不含冒号）。
 * @returns 去掉首尾空白的值，没有则 `undefined`。
 */
export function declOf(body, property) {
  let found
  const re = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`, 'g')
  for (const match of body.matchAll(re)) found = (match[1] ?? '').trim()
  return found
}

/**
 * 一个声明块里的**全部**声明，按出现顺序。
 *
 * 有的判据要问「有没有两条互相矛盾的声明」，那需要全部而不只是最后一个。
 * @param body - 规则体。
 * @returns `{ property, value }` 数组。
 */
export function declsOf(body) {
  const out = []
  for (const part of body.split(';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const property = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim()
    if (property === '' || value === '') continue
    out.push({ property, value })
  }
  return out
}

/**
 * 选择器里出现的**类名**，按出现顺序、去重。
 *
 * 只认 `.<ident>` 形态，不认属性值里的点（`.5px`）与 `::` 伪元素之后的空。
 * @param selector - 一条选择器前导（可能带逗号）。
 * @returns 类名数组（不含点）。
 */
export function classNamesIn(selector) {
  const seen = new Set()
  for (const match of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) seen.add(match[1])
  return [...seen]
}

/**
 * 一张表**定义**了哪些类。
 *
 * ── 判据是 CSS 自己的结构：**末段compound** ─────────────────────────────────
 *
 * 一条选择器描述的是「哪个元素被这条规则选中」，而那个元素由**最后一段 compound**
 * 决定（`A B` 选中 B；`A > B` 选中 B；`.card.dragging` 选中同时有这两个类的元素）。
 * 所以：
 *
 *   - `.name` / `.name:hover` / `.name[data-x]` / `.name::before`  → 声明 `name`
 *   - `.card.dragging`                                            → 声明 `dragging`
 *   - `[data-dsh-taskboard-view] .itemRoot`                        → 声明 `itemRoot`
 *   - `.waitingNotice .chip`                                       → 声明 `chip`
 *
 * ── 那为什么这不等于「全文出现过」 ──────────────────────────────────────────
 *
 * 因为**只有末段算**。`A B` 里的 `A` 是**引用**：它必须已在别处被声明，这条规则
 * 才可能匹配到任何东西。而「全文凡出现 `.xxx` 都算本表声明」会把 `A` 也算进来——
 * 那个误读让跨表检查看不见它存在的理由（`.waitingNotice .chip` 会把 `chip` 记成
 * board 表声明的，而 `chip` 只在 `components.module.css` 里）。
 *
 * 两者的差别只在**位置**：末段是本体，其余是引用。这条区别是 CSS 语法给的，不是
 * 我挑的判据——所以它对任意写法都成立。
 *
 * @param css - 源文本。
 * @returns 这张表定义的类名集合。
 */
export function declaredClassesOf(css) {
  const out = new Set()
  for (const rule of rulesOf(css)) {
    for (const names of holderClassesOf(rule.selector)) {
      for (const name of names) out.add(name)
    }
  }
  return out
}

/**
 * 一条选择器的**每一段**各自主张了哪些类——也就是**承载盒**。
 *
 * ── 判据是 CSS 自己的结构：**末段compound** ─────────────────────────────────
 *
 * 一条选择器描述的是「哪个元素被这条规则选中」，而那个元素由**最后一段 compound**
 * 决定（`A B` 选中 B；`A > B` 选中 B；`.card.dragging` 选中同时有这两个类的元素）。
 * 所以：
 *
 *   - `.name` / `.name:hover` / `.name[data-x]` / `.name::before`  → 主张 `name`
 *   - `.card.dragging`                                            → 主张 `card` 与 `dragging`
 *   - `[data-dsh-taskboard-view] .itemRoot`                        → 主张 `itemRoot`
 *   - `.waitingNotice .chip`                                       → 主张 `chip`
 *
 * **伪类里的参数不是本体**：`.panel:not(.panelWide)` 选中的是 **`.panel`**，
 * `.panelWide` 是**条件**（那个盒子此刻不是 panelWide）。把它算成承载盒，记账就挂到了
 * 错的盒子上——那一条门禁会因此**报一个不存在的问题**（或漏掉一个真问题）。
 *
 * @param {string} selector - 一条选择器（可以带逗号）。
 * @returns {string[][]} 每一段各自主张的类名（不含点）。
 */
export function holderClassesOf(selector) {
  const out = []
  for (const part of splitSelectorList(selector)) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const compounds = splitCompounds(trimmed)
    const last = compounds[compounds.length - 1] ?? ''
    for (const names of subjectGroupsOf(last)) out.push(names)
  }
  return out
}

/**
 * 按**顶层**逗号把选择器拆成若干段（逗号在括号里不是分隔符）。
 *
 * `:is(.a, .b)` 里那个逗号**不是**「两个选择器」——它是 `:is()` 的参数表。
 * 按普通逗号切会把 `:is(.a, .b)` 切成两段**坏掉**的文本。
 * @param {string} selector - 一条选择器。
 * @returns {string[]} 每一段。
 */
function splitSelectorList(selector) {
  const out = []
  let depth = 0
  let current = ''
  for (const ch of selector) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  out.push(current)
  return out
}

/**
 * 按**括号外**的连接符把一段选择器切成 compound。
 *
 * 连接符是空格、`>`、`+`、`~`——但**括号里的不算**：`.a:not(:has(> *))` 里的那个 `>`
 * 是 `:has()` 的参数（选的是子元素），不是「子代」连接符。按普通分隔符切，
 * 整条选择器会被切成两半，末段读成 `*))`——**承载盒读成空**。
 * @param {string} text - 一段选择器。
 * @returns {string[]} 各个 compound。
 */
function splitCompounds(text) {
  const out = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth === 0 && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '>' || ch === '+' || ch === '~')) {
      if (current.trim() !== '') out.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim() !== '') out.push(current.trim())
  return out
}

/**
 * 一个 compound 的**本体**分成几组（每组 = 同一个盒子上的那些类）。
 *
 * 两种伪类的参数含义**相反**：
 *
 *   - `:is(.a)` / `:where(.a)`（以及旧别名 `:matches` / `:any`）：参数里的类**就是**
 *     被选中的那个元素——`:where(.a)` 选的就是 `.a`。所以它们**算本体**。
 *   - `:not(.a)` / `:has(.a)`：参数是**条件**（那个盒子此刻不是 `.a`；`:has(.a)`
 *     是「它里面有 `.a`」）。所以它们**不算本体**。
 *
 * **`:is(.a, .b)` 是两个盒子**（它选的是「是 .a 或者是 .b」的元素），
 * 而 **`.a:is(.b)` 是同一个盒子**（既是 .a 又匹配 .b）——所以：
 * compound 自己有类时，`:is()` 的参数并进本体；自己没有类时，参数表里每一项各成一组。
 *
 * @param {string} compound - 一个 compound。
 * @returns {string[][]} 本体的分组。
 */
function subjectGroupsOf(compound) {
  /* 去掉**所有**伪类参数（含嵌套一层的那种），只留本体上的类。 */
  const own = [...compound.replace(/\((?:[^()]|\([^()]*\))*\)/g, ' ').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])
  const argGroups = []
  for (const m of compound.matchAll(/:(?:is|where|matches|any)\(([^()]*)\)/g)) {
    for (const arg of splitSelectorList(m[1])) {
      const names = [...arg.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((x) => x[1])
      if (names.length > 0) argGroups.push(names)
    }
  }
  if (own.length === 0) return argGroups
  return [[...own, ...argGroups.flat()]]
}
