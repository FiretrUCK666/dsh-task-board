/**
 * Minimal markdown parser for board surfaces (comments + session transcripts +
 * the plan under review). Produces a small node tree; the renderer
 * (Markdown.tsx) maps it to React elements — there is NO HTML string output, so
 * there is no injection surface. Only the safe, common subset is supported:
 * paragraph text, `#`–`###` headings, fenced code blocks, bullet/numbered lists
 * (one or more levels deep, with task-list marks `- [ ]` / `- [x]`),
 * blockquotes, thematic breaks, pipe tables with an alignment row, and inline
 * **bold**, *italic* (single emphasis), `code` and [links](url). Everything
 * unrecognized renders as plain text. Pure and line-based so it unit-tests in
 * isolation.
 *
 * ── WHY THE NESTING IS HERE AT ALL ──────────────────────────────────────────
 *
 * 一份计划几乎一定是「几条，每条下面几条」的形状，而这一层此前只认**平的一层**：
 * 缩进被丢掉，子项变成兄弟项。于是「/plan 的计划」在界面上读起来是一串并排的短句
 * ——不是排版难看，是**层次被抹掉了**：读者看不出哪几条属于同一步。
 */

/** One inline leaf (text runs, or an emphasis/code/link span with children). */
export type InlineNode =
  | { t: 'text'; s: string }
  | { t: 'bold'; children: InlineNode[] }
  | { t: 'italic'; children: InlineNode[] }
  | { t: 'code'; s: string }
  | { t: 'link'; url: string; children: InlineNode[] }

/**
 * One list item: its own line, what the item SAYS about being done (a task-list
 * mark), and whatever sits deeper underneath it.
 *
 * `blocks` is what makes nesting representable instead of merely indented — a
 * nested list is a block like any other, so a level of a different kind
 * (numbered inside bulleted) is not flattened into its parent's kind.
 */
export interface ListItem {
  children: InlineNode[]
  /** 任务清单的记号：`- [ ]` 是 false、`- [x]` 是 true；没写这一项的普通项没有它。 */
  checked?: boolean
  /** 挂在这一条下面的块（更深的一层清单）。平的一项就是空表。 */
  blocks: BlockNode[]
}

/** How one table column is aligned (read off the separator row). */
export type TableAlign = 'left' | 'center' | 'right'

/** One top-level block. */
export type BlockNode =
  | { t: 'paragraph'; children: InlineNode[] }
  | { t: 'heading'; level: 1 | 2 | 3; children: InlineNode[] }
  | { t: 'codeblock'; lang: string; text: string }
  | { t: 'list'; ordered: boolean; items: ListItem[] }
  | { t: 'quote'; children: BlockNode[] }
  | { t: 'table'; align: readonly TableAlign[]; head: InlineNode[][]; rows: InlineNode[][][] }
  | { t: 'hr' }

const HEADING_RE = /^(#{1,3})\s+(.*)$/
const FENCE_RE = /^```([\w-]*)\s*$/
const HR_RE = /^-{3,}$|^\*{3,}$|^_{3,}$/
const QUOTE_RE = /^>\s?(.*)$/
/** 任务清单的记号要先于普通圆点认：`- [x] 做完的` 也匹配圆点那一条，反了就读成 `[x] …`。 */
const TASK_RE = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/
const NUMBERED_RE = /^(\s*)(\d+)[.)]\s+(.*)$/

/**
 * Inline tokenizer: bold / italic / code / link / escapes, everything else
 * text. NON-GLOBAL on purpose: parseInline recurses into itself for nested
 * emphasis/link text, and a shared `g`-flag regex would let an inner call
 * advance the one global lastIndex, corrupting the outer loop into an
 * infinite same-match spawn. Instead the regex is re-run against the
 * remaining substring at every step, so recursion is always safe.
 */
const INLINE_RE = /\*\*([^*]+?)\*\*|\*([^*\n]+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\\([\\`*_[\]]|$)/

/** Only these link targets may become real <a> elements — anything else
 *  (javascript:, data:, vbscript:, …) renders as plain text instead. */
const SAFE_LINK_RE = /^(https?:|mailto:|#|\/)/i

export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_RE.exec(source.slice(cursor))) !== null) {
    const abs = cursor + match.index
    // The match consumes match[0].length characters from `abs` — `abs`
    // already includes the relative match.index, so do not add it again.
    const consumed = match[0].length
    if (consumed === 0) break // defensive: never spin on a zero-length match
    pushText(nodes, source.slice(cursor, abs))
    const [, bold, italic, code, linkText, linkUrl, escaped] = match
    if (bold !== undefined) {
      nodes.push({ t: 'bold', children: parseInline(bold) })
    } else if (italic !== undefined) {
      nodes.push({ t: 'italic', children: parseInline(italic) })
    } else if (code !== undefined) {
      nodes.push({ t: 'code', s: code })
    } else if (linkText !== undefined && linkUrl !== undefined) {
      if (SAFE_LINK_RE.test(linkUrl)) {
        nodes.push({ t: 'link', url: linkUrl, children: parseInline(linkText) })
      } else {
        pushText(nodes, `[${linkText}](${linkUrl})`)
      }
    } else if (escaped !== undefined) {
      pushText(nodes, escaped)
    }
    cursor = abs + consumed
  }
  pushText(nodes, source.slice(cursor))
  return nodes
}

/** Append a text run, coalescing with a trailing text node so escaped
 *  segments (e.g. `\*not bold\*`) rejoin into a single clean node. */
function pushText(nodes: InlineNode[], text: string): void {
  if (text === '') return
  const last = nodes[nodes.length - 1]
  if (last?.t === 'text') nodes[nodes.length - 1] = { t: 'text', s: last.s + text }
  else nodes.push({ t: 'text', s: text })
}

/** Is the line the start of a paragraph-breaking block (blank line excluded)? */
function isBlockStart(line: string): boolean {
  return HEADING_RE.test(line) || FENCE_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line) || TASK_RE.test(line) || BULLET_RE.test(line) || NUMBERED_RE.test(line)
}

/** One list line, read: how deep it sits, which kind it is, and what it says. */
interface ListMarker {
  indent: number
  ordered: boolean
  text: string
  checked?: boolean
}

/** Read one line as a list item, or `undefined` when it is not one. */
function markerOf(line: string): ListMarker | undefined {
  const task = TASK_RE.exec(line)
  if (task !== null) return { indent: task[1]!.length, ordered: false, text: task[3]!, checked: task[2] !== ' ' }
  const bullet = BULLET_RE.exec(line)
  if (bullet !== null) return { indent: bullet[1]!.length, ordered: false, text: bullet[2]! }
  const numbered = NUMBERED_RE.exec(line)
  if (numbered !== null) return { indent: numbered[1]!.length, ordered: true, text: numbered[3]! }
  return undefined
}

/**
 * One list, from its first line to where its own level ends (recursive).
 *
 * A deeper line becomes a NESTED BLOCK of the item above it rather than a
 * sibling — that is the whole difference between a plan that reads as steps and
 * one that reads as a heap of sentences. A level of the other kind (an ordered
 * list inside a bulleted one) is its own nested list, which is why the kind is
 * part of this call rather than of the item.
 *
 * The loop always consumes at least one line per iteration it does not break
 * out of, and the recursive call starts on a line this level does not consume,
 * so the walk cannot spin.
 */
function parseList(lines: readonly string[], start: number, indent: number, ordered: boolean): { items: ListItem[]; next: number } {
  const items: ListItem[] = []
  let index = start
  while (index < lines.length) {
    const marker = markerOf(lines[index]!)
    if (marker === undefined || marker.indent < indent) break
    /* **深度先判，种类后判。** 反过来的话，「圆点下面挂一串编号」会被种类不符直接
       `break` 掉——那一层连同它的子项一起掉出这张清单，而屏上没有任何东西说少了什么。 */
    if (marker.indent > indent) {
      const nested = parseList(lines, index, marker.indent, marker.ordered)
      const parent = items[items.length - 1]
      const block: BlockNode = { t: 'list', ordered: marker.ordered, items: nested.items }
      if (parent === undefined) items.push({ children: [], blocks: [block] })
      else parent.blocks.push(block)
      index = nested.next
      continue
    }
    if (marker.ordered !== ordered) break
    items.push({
      children: parseInline(marker.text.trim()),
      ...marker.checked !== undefined ? { checked: marker.checked } : {},
      blocks: [],
    })
    index += 1
  }
  return { items, next: index }
}

/** Split one table row into cells, dropping the outer pipes and the padding. */
function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map(cell => cell.trim())
}

/** The alignment row (`| --- | :--: |`) — its colons ARE the alignment. */
const TABLE_SEPARATOR_RE = /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/

function tableAligns(line: string): TableAlign[] {
  return tableCells(line).map(cell => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    return right ? 'right' : 'left'
  })
}

/**
 * A pipe table, when the two lines that start it really are one.
 *
 * The separator row is the DISCRIMINATOR and not decoration: without it,
 * `| a | b |` is just a sentence with pipes in it, and treating it as a table
 * would put a one-cell row of prose on screen inside a frame. So the shape is
 * required — first row, then a separator — exactly like every markdown there is.
 * Extra cells in a body row are kept (the renderer draws what is there);
 * missing ones render empty.
 */
function tableAt(lines: readonly string[], start: number): { block: BlockNode; next: number } | undefined {
  const head = lines[start]
  const separator = lines[start + 1]
  if (head === undefined || separator === undefined) return undefined
  if (!head.trim().startsWith('|') || !TABLE_SEPARATOR_RE.test(separator)) return undefined
  const align = tableAligns(separator)
  const rows: InlineNode[][][] = []
  let index = start + 2
  while (index < lines.length) {
    const line = lines[index]!
    if (!line.trim().startsWith('|')) break
    rows.push(tableCells(line).map(cell => parseInline(cell)))
    index += 1
  }
  return {
    block: { t: 'table', align, head: tableCells(head).map(cell => parseInline(cell)), rows },
    next: index,
  }
}

/** Parse the whole source into top-level blocks. */
export function parseMarkdown(source: string): BlockNode[] {
  const lines = source.split('\n')
  const blocks: BlockNode[] = []
  let index = 0
  const pushParagraph = (start: number, end: number): void => {
    const text = lines.slice(start, end).filter(line => line.trim() !== '').join('\n')
    if (text.trim() !== '') blocks.push({ t: 'paragraph', children: parseInline(text) })
  }
  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()
    const heading = HEADING_RE.exec(trimmed)
    const fence = FENCE_RE.exec(trimmed)
    const hr = HR_RE.test(trimmed)
    const quote = QUOTE_RE.exec(line)
    const marker = markerOf(line)
    const table = tableAt(lines, index)
    if (table !== undefined) {
      blocks.push(table.block)
      index = table.next
    } else if (heading !== null) {
      blocks.push({ t: 'heading', level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2]) })
      index += 1
    } else if (fence !== null) {
      const lang = fence[1] ?? ''
      const body: string[] = []
      index += 1
      while (index < lines.length && !FENCE_RE.test(lines[index].trim())) {
        body.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1 // consume the closing fence
      blocks.push({ t: 'codeblock', lang, text: body.join('\n') })
    } else if (hr) {
      blocks.push({ t: 'hr' })
      index += 1
    } else if (quote !== null) {
      const body: string[] = []
      while (index < lines.length && QUOTE_RE.exec(lines[index]) !== null) {
        body.push(QUOTE_RE.exec(lines[index])![1])
        index += 1
      }
      blocks.push({ t: 'quote', children: parseMarkdown(body.join('\n')) })
    } else if (marker !== undefined) {
      const list = parseList(lines, index, marker.indent, marker.ordered)
      blocks.push({ t: 'list', ordered: marker.ordered, items: list.items })
      index = list.next
    } else if (trimmed === '') {
      index += 1
    } else {
      const start = index
      while (index < lines.length && lines[index].trim() !== '' && !isBlockStart(lines[index])) index += 1
      pushParagraph(start, index)
    }
  }
  return blocks
}