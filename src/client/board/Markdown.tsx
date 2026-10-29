/**
 * Markdown renderer for board surfaces: maps the parser's node tree
 * (markdown-parser.ts) to React elements with the board's design tokens — NO
 * HTML strings are ever produced, so the preview has the native look and
 * there is no injection surface. Used by the shared transcript rows and the
 * comment thread, so every conversation surface previews markdown
 * identically.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import css from '../board.module.css'
import { Icon } from '../design/ui.tsx'
import { parseMarkdown, type BlockNode, type HeadingLevel, type InlineNode, type ListItem } from './markdown-parser.ts'

function renderInline(node: InlineNode, key: number): ReactNode {
  switch (node.t) {
    case 'text':
      return node.s
    case 'bold':
      return <strong key={key} className={css.mdStrong}>{node.children.map(renderInline)}</strong>
    case 'italic':
      return <em key={key} className={css.mdEm}>{node.children.map(renderInline)}</em>
    case 'code':
      return <code key={key} className={css.mdCode}>{node.s}</code>
    case 'link':
      return (
        <a key={key} className={css.mdLink} href={node.url} target="_blank" rel="noreferrer">
          {node.children.map(renderInline)}
        </a>
      )
  }
}

/**
 * One list item, with its own nested blocks under it.
 *
 * A task-list mark is DRAWN, not printed: `[x]` left as text is noise the reader
 * has to decode, while a box is the thing they were writing about. The words are
 * never struck through — a plan's finished steps are still the plan.
 */
function renderItem(item: ListItem, key: number): ReactNode {
  return (
    <li key={key} className={item.checked === undefined ? undefined : css.mdTask}>
      {item.checked !== undefined && (
        <span className={css.mdTaskBox} data-done={item.checked ? '' : undefined} aria-hidden="true">
          {item.checked && <Icon name="check" />}
        </span>
      )}
      {item.children.map(renderInline)}
      {item.blocks.map(renderBlock)}
    </li>
  )
}

/**
 * 标题：**标签跟着级别走**（`#` 出 `<h1>`，`###` 出 `<h3>`，一直到 `<h6>`）。
 *
 * 曾经六级一律出 `<h3>`、只靠 `data-level` 区分大小——那在语义上是错的（等于说
 * 「这些都是三级」），而且层级只活在视觉里：读屏器、文档大纲、以及任何按标签取
 * 标题的代码都读不到它。标题层级是**文档结构**，不是打扮。
 *
 * 大小由 `.mdHeading[data-level=…]` 读官方字体令牌（见 `board.module.css`）。
 */
function Heading({ level, children }: { level: HeadingLevel; children: ReactNode }) {
  const Tag = `h${level}` as const
  return <Tag className={css.mdHeading} data-level={level}>{children}</Tag>
}

function renderBlock(block: BlockNode, key: number): ReactNode {
  switch (block.t) {
    case 'paragraph':
      return <p key={key} className={css.mdParagraph}>{block.children.map(renderInline)}</p>
    case 'heading':
      return <Heading key={key} level={block.level}>{block.children.map(renderInline)}</Heading>
    case 'codeblock':
      return (
        <pre key={key} className={css.mdCodeBlock}>
          <code>{block.text}</code>
        </pre>
      )
    case 'list': {
      const items = block.items.map(renderItem)
      return block.ordered
        ? <ol key={key} className={css.mdList}>{items}</ol>
        : <ul key={key} className={css.mdList}>{items}</ul>
    }
    case 'table':
      /* A table scrolls SIDEWAYS inside its own frame rather than pushing the
         panel wide: the reader's text is not this surface's to reflow, and a
         table that overflows its column is the one block that could. */
      return (
        <div key={key} className={css.mdTableScroll} data-dsh-tb-scroll="">
          <table className={css.mdTable}>
            <thead>
              <tr>{block.head.map((cell, at) => <th key={at} data-align={block.align[at] ?? 'left'}>{cell.map(renderInline)}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, at) => <td key={at} data-align={block.align[at] ?? 'left'}>{cell.map(renderInline)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'quote':
      return <blockquote key={key} className={css.mdQuote}>{block.children.map(renderBlock)}</blockquote>
    case 'hr':
      return <hr key={key} className={css.mdRule} />
  }
}

/** Render a text source as markdown-previews blocks (empty text renders nothing). */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  return <>{blocks.map(renderBlock)}</>
}