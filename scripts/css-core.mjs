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
 * @returns `{ selector, body, line, at }` 数组。`at` 是这条规则所在 at-rule 的完整
 *   前导（顶层规则是 `''`），`line` 是 1 起的真实行号。
 */
export function rulesOf(css, at = '') {
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
    const prelude = text.slice(i, open).trim()
    const body = text.slice(open + 1, j - 1)
    const line = (text.slice(0, i).match(/\n/g)?.length ?? 0) + 1
    if (prelude.startsWith('@')) {
      /* 容器：递归进去。`@supports` / `@container` / `@media` 的前导都只是「在什么
         条件下」，不是选择器本身，但它必须被带下去——一条规则的完整身份是
         「在哪个 at-rule 里的哪条选择器」。 */
      const nested = at === '' ? prelude : `${at} ${prelude}`
      rules.push(...rulesOf(body, nested))
    } else if (prelude !== '') {
      rules.push({ selector: prelude, body, line, at })
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
    for (const part of rule.selector.split(',')) {
      /* 末段 compound：从最后一个非复合连接符之后开始。连接符是空格、`>`、`+`、`~`。 */
      const compounds = part.trim().split(/\s*[>+~]\s*|\s+/)
      const last = compounds[compounds.length - 1] ?? ''
      /* 末段里可能挂着多个类（`.card.dragging`）与伪类/属性——**每一个类都是被
         声明出来的**，因为它们共同构成「选中哪个元素」。伪类里的参数
         （`:not(.x)`）不算：那是条件，不是本体。 */
      const withoutPseudoArgs = last.replace(/\((?:[^()]|\([^()]*\))*\)/g, '')
      for (const m of withoutPseudoArgs.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1])
    }
  }
  return out
}
