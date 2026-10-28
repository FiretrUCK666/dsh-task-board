/**
 * 「引用选中的文字」——纯文法，零框架，所以编码与插入两端都能单独测。
 *
 * ── 这是什么，为什么它是一段纯函数 ───────────────────────────────────────────
 *
 * 读者在会话转写或评论里选中一段字，按「引用文本」，那段字就以 Markdown 引用行
 * 的形式进入评论输入框；发送之后，模型与读者看到的都是普通的 `> ` 行，**没有任何
 * 额外元数据**。这与宿主 `dsh-message-quotes` 的模型完全一致：引用是文本的一种
 * 写法，不是一种附件，也不是一种消息类型。
 *
 * 因此这里只有两件纯事：把一段任意选中文本归一成「每行一个 `> `」，以及决定它该
 * 插在光标的哪里、光标随后落到哪里。组件只负责把这两件事接到 DOM 上。
 *
 * ── 为什么展示侧一行都不用改 ─────────────────────────────────────────────────
 *
 * `markdown-parser.ts` 本来就认 `>` 引用块（`t: 'quote'`），`Markdown.tsx` 本来
 * 就把它渲染成 `<blockquote class="mdQuote">`。所以「引用发出去之后长什么样」这一
 * 半是现成的——本模块只补「怎么把它写进输入框」这一半。
 */

/** 引用行的前缀。宿主逐字用的是它，渲染侧认的也是它。 */
const QUOTE_PREFIX = '> '

/**
 * 一段选中的文字，归一成 Markdown 引用行。
 *
 * 三条规矩，每条都对应一个真实的违约后果：
 *
 * 1. **换行统一成 `\n`。** 跨段选中时浏览器给的可能是 `\r\n`；不归一的话，引用
 *    里会多出看不出、却把一行切成两行的回车。
 * 2. **每一行都带前缀，空行也带。** 引用块靠连续的前缀行界定；中间空一行却不带
 *    前缀，那一行就落到引用外面，于是发送后引用被截成两块。带前缀的空行（`> `）
 *    仍是引用的一部分，读起来正好是段间空行。
 * 3. **两端空白去掉，行内空白一个字不动。** 选区首尾常常捎带换行，留着会让引用
 *    多出空白行；而行内的缩进与空格是原文的一部分，不许碰。
 *
 * 全空白（或空串）时返回 `''`——调用方据此不显示按钮、也不做插入。
 *
 * @param text - 浏览器选区里读出来的原始文本。
 * @returns 逐行带 `> ` 前缀的引用文本；没有可引用的内容时是空串。
 */
export function quoteTextOf(text: string): string {
  const normalized = text.replace(/\r\n?/gu, '\n').trim()
  if (normalized === '') return ''
  return normalized
    .split('\n')
    .map(line => `${QUOTE_PREFIX}${line}`)
    .join('\n')
}

/**
 * 把一段引用插到 `text` 的 `caret` 处，返回新文本与新光标位置。
 *
 * ── 位置的三条规矩，每一条都是「不这样就难看」 ───────────────────────────────
 *
 * 1. **引用必须自成一块。** Markdown 里引用块与正文之间要隔一个空行：紧贴着下一
 *    行普通文字时，那行会被并进引用里。所以前后都要保证有分隔。
 * 2. **已经隔开的地方不重复补。** 光标本就落在空行之后（或文本开头）时不再多插
 *    一个空行，否则连续引用两次会双倍空行，越积越松。
 * 3. **光标落到插入内容之后。** 读者按下按钮接着就要说自己的话，光标留在末尾，
 *    不必再点一下输入框。
 *
 * @param text - 输入框当前的全部文本。
 * @param caret - 插入位置（`selectionStart` 那一处）。
 * @param quote - 已经过 `quoteTextOf` 的引用文本。
 * @returns 新文本与新的光标位置（= 插入内容之后）。
 */
export function insertQuote(text: string, caret: number, quote: string): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length))
  if (quote === '') return { text, caret: at }
  const before = text.slice(0, at)
  const after = text.slice(at)
  /* 前方：开头、或已经跟在空行之后，都不再补；否则补到「至少一个空行」为止。
     这三行是一个意思的三个分支：引用块前面必须是段落边界。 */
  const lead = before === '' || before.endsWith('\n\n')
    ? ''
    : before.endsWith('\n') ? '\n' : '\n\n'
  /* 后方：文本已到末尾就不补（末尾空行只是看不见的尾巴）；已经跟在空行之后也不补；
     否则补到「至少一个空行」——读者的光标正落在那里，接着写下一段。 */
  const trail = after === '' || after.startsWith('\n\n')
    ? ''
    : after.startsWith('\n') ? '\n' : '\n\n'
  const inserted = `${lead}${quote}${trail}`
  return { text: `${before}${inserted}${after}`, caret: at + inserted.length }
}
