/**
 * Shared UI primitives for the board: Button, Section, Notice,
 * Icon. One source for button variants, section titles, the waiting notice
 * and the icon set — every surface consumes these instead of
 * hand-rolled markup, so the whole board speaks one design language and
 * follows the native --dsw-* tokens (light/dark + any skin plugin) without
 * any per-surface styling drift.
 */
import { type ReactNode } from 'react'
import { PALETTE } from '../../core/colors.ts'
import css from '../board.module.css'
import { t } from '../locales.ts'
import { Chip } from './Chip.tsx'

/** One button variant; shared rhythm everywhere. `dangerGhost` is the
 *  row-level destructive affordance (outline + danger text) — the filled
 *  `danger` stays reserved for the primary destroyer (confirm dialogs,
 *  the detail footer's delete). */
export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'dangerGhost'

/** The board's one button (see module doc). The click handler receives the
 *  native event so callers inside clickable rows can stopPropagation; plain
 *  zero-arg handlers stay assignable (fewer parameters are always valid).
 *  `size="sm"` is the quiet row/header variant (view-session, refresh, row
 *  actions): one compact size for every secondary in-list affordance, so the
 *  board never mixes a full-size button into a row. */
export function Button({ variant = 'ghost', size, type = 'button', className, disabled, pressed, onClick, title, children }: {
  variant?: ButtonVariant
  size?: 'sm'
  type?: 'button' | 'submit'
  className?: string
  disabled?: boolean
  /** Toggle-state styling (aria-pressed): an active mode reads through a
   *  gentle press, never through the primary/danger fill. */
  pressed?: boolean
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  title?: string
  children: ReactNode
}) {
  const base = variant === 'primary' ? css.primaryButton
    : variant === 'danger' ? css.dangerButton
      : variant === 'dangerGhost' ? css.dangerGhostButton
        : css.ghostButton
  return (
    <button
      type={type}
      className={`${base}${size === 'sm' ? ` ${css.buttonSm}` : ''}${pressed === true ? ` ${css.buttonPressed}` : ''}${className !== undefined ? ` ${className}` : ''}`}
      disabled={disabled}
      aria-pressed={pressed === true ? 'true' : undefined}
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

/** A titled detail section: one shared title style for every detail module.
 *  `action` is an optional right-aligned affordance on the title row (the
 *  section's own "+ 新建" style button) — the head is a flex row, the title
 *  never shrinks, the action hugs the right edge. An EMPTY title suppresses
 *  the head entirely (an embedding surface supplies its own header — the
 *  automation editor's embedded use, where the wrapping disclosure IS the
 *  section). */
export function Section({ title, action, children, className }: {
  title: string
  /** Optional right-aligned affordance rendered on the title row. */
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`${css.detailSection}${className !== undefined ? ` ${className}` : ''}`}>
      {(title !== '' || action !== undefined) && (
        <div className={css.sectionHead}>
          <h4>{title}</h4>
          {action !== undefined && <span className={css.sectionAction}>{action}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

/** A compact collapsible block: a chevron + title + one-line live summary
 *  on the header row; the body renders only when expanded, and the summary
 *  always reflects the current state (single-source with the body). THE one
 *  disclosure grammar for every foldable module on the board (run config, the
 *  automation editor, the session rail head): collapsed it is quiet, one row,
 *  no buttons, and the chevron turns (collapsed = right, expanded = down) —
 *  never a second hand-rolled fold that forgets the turn. */
export function Disclosure({ title, summary, open, onToggle, children }: {
  title: string
  /** One-line live summary shown on the header row (collapsed or not). */
  summary?: string
  open: boolean
  onToggle: () => void
  children?: ReactNode
}) {
  return (
    <section className={css.detailSection}>
      <button
        type="button"
        className={css.detailDisclosure}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon name="chevronDown" className={css.detailChevron} />
        <span className={css.detailDisclosureTitle}>{title}</span>
        {summary !== undefined && <span className={css.detailDisclosureSummary}>{summary}</span>}
      </button>
      {open && children}
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
 * Minimal inline-icon set (SVG glyphs live here once, sized explicitly so no
 * glyph can ever balloon to the SVG default 300x150 box). Every board icon
 * route goes through this component.
 */
export type IconName = 'arrowDown' | 'chevronDown' | 'close' | 'arrowRight' | 'arrowLeft' | 'link' | 'play' | 'pause' | 'bell' | 'calendar' | 'copy' | 'check' | 'checklist' | 'eyeOff' | 'pencil'

const ICON_PATHS: Record<IconName, string> = {  arrowDown: 'M3 6.5 8 11.5 13 6.5',
  chevronDown: 'M3 6 8 11 13 6',
  close: 'M4 4 12 12M12 4 4 12',
  arrowRight: 'M4 8h8M9 4l4 4-4 4',
  arrowLeft: 'M12 8H4M7 4l-4 4 4 4',
  link: 'M6.4 9.6 9.6 6.4M6 10l-1.8 1.8a2.1 2.1 0 0 1-3-3L3.7 6.2a2.1 2.1 0 0 1 3 0M10 6l1.8-1.8a2.1 2.1 0 0 1 3 3L12.3 9.8a2.1 2.1 0 0 1-3 0',
  play: 'M5.5 3.5 12 8l-6.5 4.5z',
  // A bell: the notification-center affordance (same 16-box stroke grammar).
  bell: 'M8 2.5a4 4 0 0 1 4 4c0 2.8 1 3.8 1.5 4.5h-11C3 10.5 4 9.5 4 6.5a4 4 0 0 1 4-4zM6.5 13.5a1.5 1.5 0 0 0 3 0',
  // Two bars: the "pause this goal" affordance (the play twin — same 16-box
  // grammar, stroke-drawn like every board glyph).
  pause: 'M5.5 4v8M10.5 4v8',
  calendar: 'M3.5 6.5v6a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-6zM3.5 6.5h9M5.5 3.5v3M10.5 3.5v3',
  copy: 'M7 4h5a2 2 0 0 1 2 2v5M5 6h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  check: 'M3.5 8.5 6.5 11.5 12.5 5',
  checklist: 'M2.5 4h.5M2.5 8h.5M2.5 12h.5M5.5 4h8M5.5 8h8M5.5 12h8',
  // An eye with a slash: the quiet "hide this row" affordance (its label
  // collapses to this glyph on a narrow board; the tooltip keeps the words).
  eyeOff: 'M2.5 8s2.2-3.2 5.5-3.2S13.5 8 13.5 8s-2.2 3.2-5.5 3.2S2.5 8 2.5 8zM2.5 13.5 13.5 2.5',
  // A pencil: the "rename this row" affordance (never the copy glyph — a
  // copy icon that renames is a lie the tooltip cannot fully fix).
  pencil: 'M2.5 13.5l1-3L11 3l2 2-7.5 7.5-3 1zM9.5 4.5l2 2',
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

/**
 * THE one color-picker row of the whole board: preset palette dots + the
 * native custom-color dot + the trailing 「移除颜色」 dot. Effect colors are
 * DATA (applied inline from user choices), so the same row is safe wherever
 * a data color is chosen — the card hover bar and the board's organize bar
 * share exactly this grammar. Every entry is round and same-sized; the
 * selected ring appears only when `value` truly equals the entry — never a
 * guessed default, never a mixed shape.
 */
export function ColorSwatches({ value, onChange, none = true, custom = true }: {
  value: string | undefined
  onChange: (color: string | undefined) => void
  /** Show the trailing 「移除颜色」 dot. */
  none?: boolean
  /** Show the native custom-color dot (trailing, before 「移除颜色」). */
  custom?: boolean
}) {
  const isCustom = value !== undefined && !PALETTE.includes(value)
  return (
    <span className={css.tagSwatches}>
      {PALETTE.map(color => (
        <button
          key={color}
          type="button"
          className={`${css.tagSwatch}${value === color ? ` ${css.tagSwatchOn}` : ''}`}
          style={{ background: color }}
          aria-label={color}
          title={color}
          onClick={() => { onChange(color) }}
        />
      ))}
      {custom && (
        /* The native custom-color dot: NOT a paint of the current value
           (that read as a plain white circle next to 「移除颜色」 when no
           custom color was picked — two white dots). The wrap carries the
           look: the picked custom color when one IS active, a conic rainbow
           affordance when not; the native input sits on top invisibly
           (still opens the picker / stays keyboard-focusable). */
        <span
          className={`${css.tagCustomWrap}${isCustom ? ` ${css.tagSwatchOn}` : ` ${css.tagCustomEmpty}`}`}
          style={isCustom ? { background: value } : undefined}
          title={t('color.custom')}
        >
          <input
            type="color"
            className={css.tagCustomColor}
            value={value ?? '#ffffff'}
            aria-label={t('color.custom')}
            onChange={event => { onChange(event.target.value) }}
          />
        </span>
      )}
      {none && (
        <button
          type="button"
          className={`${css.tagSwatch} ${css.tagSwatchNone}${value === undefined ? ` ${css.tagSwatchOn}` : ''}`}
          aria-label={t('card.colorNone')}
          title={t('card.colorNone')}
          onClick={() => { onChange(undefined) }}
        />
      )}
    </span>
  )
}

/**
 * The ONE segmented-control grammar (radiogroup of labeled chips): driving
 * mode (按时间表/完成后接续), rule trigger (按时间表/任务完成后) and the
 * send mode all read/speak alike — one component, one style, zero drift.
 */
export function Segmented({ options, value, onChange, ariaLabel }: {
  options: readonly { value: string; label: string; title?: string }[]
  value: string
  onChange: (next: string) => void
  ariaLabel: string
}) {
  return (
    <span className={css.segmentedRow} role="radiogroup" aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`${css.segmentedButton}${value === option.value ? ` ${css.segmentedActive}` : ''}`}
          title={option.title}
          onClick={() => { onChange(option.value) }}
        >
          {option.label}
        </button>
      ))}
    </span>
  )
}

/**
 * The composer's send-mode switch: 排队 (queue — the dispatcher injects the
 * message, default) vs 插话 (steer — deliver straight to the session now,
 * bypassing queue/budget/cruise). One switch at the send row, shared by the
 * review page and the session panel so both speak one grammar.
 */
export function SendModeToggle({ steer, onChange }: { steer: boolean; onChange: (steer: boolean) => void }) {
  return (
    <Segmented
      ariaLabel={t('review.sendMode')}
      options={[
        { value: 'queue', label: t('review.sendQueue'), title: t('review.sendQueueTitle') },
        { value: 'steer', label: t('review.sendSteer'), title: t('review.sendSteerTitle') },
      ]}
      value={steer ? 'steer' : 'queue'}
      onChange={next => { onChange(next === 'steer') }}
    />
  )
}
