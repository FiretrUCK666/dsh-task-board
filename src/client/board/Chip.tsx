/**
 * Shared badge: every pill on the board (card status chips, detail status
 * and execution-result badges) renders through this one component, so all
 * badges share one shape, size and weight and differ only in semantic color.
 */
import type { ReactNode } from 'react'
import css from '../board.module.css'

/** Semantic chip color; neutral is the default. */
export type ChipKind = 'neutral' | 'success' | 'error' | 'warn' | 'muted'

/** One pill badge. */
export function Chip({ kind = 'neutral', title, className, children }: {
  kind?: ChipKind
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={`${css.chip}${className !== undefined ? ` ${className}` : ''}`}
      data-kind={kind}
      title={title}
    >
      {children}
    </span>
  )
}
