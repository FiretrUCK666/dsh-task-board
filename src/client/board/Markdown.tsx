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
import { parseMarkdown, type BlockNode, type InlineNode } from './markdown-parser.ts'

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

function renderBlock(block: BlockNode, key: number): ReactNode {
  switch (block.t) {
    case 'paragraph':
      return <p key={key} className={css.mdParagraph}>{block.children.map(renderInline)}</p>
    case 'heading':
      return <h3 key={key} className={css.mdHeading} data-level={block.level}>{block.children.map(renderInline)}</h3>
    case 'codeblock':
      return (
        <pre key={key} className={css.mdCodeBlock}>
          <code>{block.text}</code>
        </pre>
      )
    case 'list': {
      const items = block.items.map((children, index) => (
        <li key={index}>{children.map(renderInline)}</li>
      ))
      return block.ordered
        ? <ol key={key} className={css.mdList}>{items}</ol>
        : <ul key={key} className={css.mdList}>{items}</ul>
    }
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