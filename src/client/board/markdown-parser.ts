/**
 * Minimal markdown parser for board surfaces (comments + session transcripts).
 * Produces a small node tree; the renderer (Markdown.tsx) maps it to React
 * elements — there is NO HTML string output, so there is no injection
 * surface. Only the safe, common subset is supported: paragraph text,
 * `#`–`###` headings, fenced code blocks, bullet/numbered lists, blockquotes,
 * thematic breaks, and inline **bold**, *italic* (single emphasis), `code`
 * and [links](url). Everything unrecognized renders as plain text. Pure and
 * line-based so it unit-tests in isolation.
 */

/** One inline leaf (text runs, or an emphasis/code/link span with children). */
export type InlineNode =
  | { t: 'text'; s: string }
  | { t: 'bold'; children: InlineNode[] }
  | { t: 'italic'; children: InlineNode[] }
  | { t: 'code'; s: string }
  | { t: 'link'; url: string; children: InlineNode[] }

/** One top-level block. */
export type BlockNode =
  | { t: 'paragraph'; children: InlineNode[] }
  | { t: 'heading'; level: 1 | 2 | 3; children: InlineNode[] }
  | { t: 'codeblock'; lang: string; text: string }
  | { t: 'list'; ordered: boolean; items: InlineNode[][] }
  | { t: 'quote'; children: BlockNode[] }
  | { t: 'hr' }

const HEADING_RE = /^(#{1,3})\s+(.*)$/
const FENCE_RE = /^```([\w-]*)\s*$/
const HR_RE = /^-{3,}$|^\*{3,}$|^_{3,}$/
const QUOTE_RE = /^>\s?(.*)$/
const BULLET_RE = /^\s*[-*+]\s+(.*)$/
const NUMBERED_RE = /^\s*(\d+)[.)]\s+(.*)$/

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
  return HEADING_RE.test(line) || FENCE_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line) || BULLET_RE.test(line) || NUMBERED_RE.test(line)
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
    const bullet = BULLET_RE.exec(line)
    const numbered = NUMBERED_RE.exec(line)
    if (heading !== null) {
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
    } else if (bullet !== null || numbered !== null) {
      const ordered = numbered !== null
      const items: InlineNode[][] = []
      while (index < lines.length) {
        const b = BULLET_RE.exec(lines[index])
        const n = NUMBERED_RE.exec(lines[index])
        if (ordered ? n === null : b === null) break
        items.push(parseInline((ordered ? n![2] : b![1]).trim()))
        index += 1
      }
      blocks.push({ t: 'list', ordered, items })
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