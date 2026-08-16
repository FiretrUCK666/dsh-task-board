/**
 * Shared badge: every pill and badge on the board renders through this one
 * component, so all badges share one size, weight and semantic color system
 * and differ only in density. `fill` renders the pill look (neutral fill +
 * padding) for roomy surfaces like the detail; `fill={false}` renders plain
 * semibold text for dense surfaces like cards, where the text must align
 * flush with the card's left edge.
 */
import type { ReactNode } from 'react'
import css from '../board.module.css'

/** Semantic chip color; neutral is the default. */
export type ChipKind = 'neutral' | 'success' | 'error' | 'warn' | 'muted'

/** One badge. */
export function Chip({ kind = 'neutral', fill = true, title, className, children }: {
  kind?: ChipKind
  /** Pill look with neutral fill; false = plain semibold text. */
  fill?: boolean
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={`${css.chip}${fill ? ` ${css.chipFill}` : ''}${className !== undefined ? ` ${className}` : ''}`}
      data-kind={kind}
      title={title}
    >
      {children}
    </span>
  )
}
