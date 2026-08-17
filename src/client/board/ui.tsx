/**
 * Shared UI primitives for the board: Button, Section, Notice, AttentionDot,
 * Icon. One source for button variants, section titles, the waiting notice
 * and the unread-dot system — every surface consumes these instead of
 * hand-rolled markup, so the whole board speaks one design language and
 * follows the native --dsw-* tokens (light/dark + any skin plugin) without
 * any per-surface styling drift.
 */
import type { ReactNode } from 'react'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'

/** One button variant; shared "primary / ghost / danger" rhythm everywhere. */
export type ButtonVariant = 'primary' | 'ghost' | 'danger'

/** The board's one button (see module doc). */
export function Button({ variant = 'ghost', type = 'button', className, disabled, onClick, title, children }: {
  variant?: ButtonVariant
  type?: 'button' | 'submit'
  className?: string
  disabled?: boolean
  onClick?: () => void
  title?: string
  children: ReactNode
}) {
  const base = variant === 'primary' ? css.primaryButton
    : variant === 'danger' ? css.dangerButton
      : css.ghostButton
  return (
    <button
      type={type}
      className={`${base}${className !== undefined ? ` ${className}` : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

/** A titled detail section: one shared title style for every detail module. */
export function Section({ title, children, className }: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`${css.detailSection}${className !== undefined ? ` ${className}` : ''}`}>
      <h4>{title}</h4>
      {children}
    </section>
  )
}

/** The waiting notice: one neutral framed row + warn chip for every surface. */
export function Notice({ chip, children }: { chip: ReactNode; children: ReactNode }) {
  return (
    <div className={css.waitingNotice} role="status">
      <Chip kind="warn" fill={false}>{chip}</Chip>
      <span>{children}</span>
    </div>
  )
}

/**
 * The unread-dot of the attention system: a small warn dot with a soft static
 * glow. The row it sits on breathes via the shared attention halo; the dot
 * itself stays still so a long list never competes with many moving dots.
 */
export function AttentionDot({ title }: { title?: string }) {
  return <span className={css.attentionDot} title={title} aria-label={title} />
}

/** Minimal inline-icon set (SVG glyphs live here once). */
export function Icon({ name, className }: { name: 'arrowDown'; className?: string }) {
  const classes = className !== undefined ? ` ${className}` : ''
  if (name === 'arrowDown') {
    return (
      <svg className={`${css.icon}${classes}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6.5 8 11.5 13 6.5" />
      </svg>
    )
  }
  return null
}
