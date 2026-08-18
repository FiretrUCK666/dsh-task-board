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

/** The board's one button (see module doc). The click handler receives the
 *  native event so callers inside clickable rows can stopPropagation; plain
 *  zero-arg handlers stay assignable (fewer parameters are always valid).
 *  `size="sm"` is the quiet row/header variant (view-session, refresh, row
 *  actions): one compact size for every secondary in-list affordance, so the
 *  board never mixes a full-size button into a row. */
export function Button({ variant = 'ghost', size, type = 'button', className, disabled, onClick, title, children }: {
  variant?: ButtonVariant
  size?: 'sm'
  type?: 'button' | 'submit'
  className?: string
  disabled?: boolean
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  title?: string
  children: ReactNode
}) {
  const base = variant === 'primary' ? css.primaryButton
    : variant === 'danger' ? css.dangerButton
      : css.ghostButton
  return (
    <button
      type={type}
      className={`${base}${size === 'sm' ? ` ${css.buttonSm}` : ''}${className !== undefined ? ` ${className}` : ''}`}
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  )
}

/**
 * An iOS-style toggle switch (pure CSS): a hidden checkbox driving a track +
 * knob. "On" fills the track with the success tone and slides the knob right;
 * keyboard focus draws a soft ring around the track. Every on/off control on
 * the board (cruise, schedule enable) renders through this component.
 */
export function Switch({ checked, onChange, label, title, disabled }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  title?: string
  disabled?: boolean
}) {
  return (
    <label className={css.switch} title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={event => { onChange(event.target.checked) }}
      />
      <span className={css.switchTrack} aria-hidden="true">
        <span className={css.switchKnob} />
      </span>
      <span className={css.switchLabel}>{label}</span>
    </label>
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

/**
 * Minimal inline-icon set (SVG glyphs live here once, sized explicitly so no
 * glyph can ever balloon to the SVG default 300x150 box). Every board icon
 * route goes through this component.
 */
export type IconName = 'arrowDown' | 'chevronDown' | 'close' | 'arrowRight' | 'arrowLeft' | 'link'

const ICON_PATHS: Record<IconName, string> = {
  arrowDown: 'M3 6.5 8 11.5 13 6.5',
  chevronDown: 'M3 6 8 11 13 6',
  close: 'M4 4 12 12M12 4 4 12',
  arrowRight: 'M4 8h8M9 4l4 4-4 4',
  arrowLeft: 'M12 8H4M7 4l-4 4 4 4',
  link: 'M6.4 9.6 9.6 6.4M6 10l-1.8 1.8a2.1 2.1 0 0 1-3-3L3.7 6.2a2.1 2.1 0 0 1 3 0M10 6l1.8-1.8a2.1 2.1 0 0 1 3 3L12.3 9.8a2.1 2.1 0 0 1-3 0',
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={css.icon + (className !== undefined ? ` ${className}` : '')}
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}
