/**
 * Shared UI primitives for the board: Button, Section, Notice,
 * Icon. One source for button variants, section titles, the waiting notice
 * and the icon set — every surface consumes these instead of
 * hand-rolled markup, so the whole board speaks one design language and
 * follows the native --dsw-* tokens (light/dark + any skin plugin) without
 * any per-surface styling drift.
 */
import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { PALETTE } from '../../core/colors.ts'
import css from './components.module.css'
import { t } from '../locales.ts'

/** One button variant; shared rhythm everywhere. `dangerGhost` is the
 *  row-level destructive affordance (outline + danger text) — the filled
 *  `danger` stays reserved for the primary destroyer (confirm dialogs,
 *  the detail footer's delete).
 *
 *  THE ARRAY IS THE DEFINITION and the type is derived from it, so the
 *  design-system gallery can render every variant by iterating it. A union
 *  written by hand beside a hand-written list is two statements of one fact,
 *  and the gallery — whose whole job is "show me everything the system has" —
 *  is exactly where the second one goes stale without anyone noticing. */
export const BUTTON_VARIANTS = ['primary', 'ghost', 'danger', 'dangerGhost'] as const

/** One button variant. */
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]

/** The variants that can carry a TOGGLE state.
 *
 *  `.buttonPressed` is a ghost treatment — hover tone plus a stronger border, and
 *  deliberately no fill (see its rule in the design sheet). On a FILLED variant
 *  it replaces the fill with a nearly transparent wash while the text stays
 *  white: the label disappears. Measured on the gallery's own `pressed` specimen
 *  for `primary` — 1.11:1, effectively invisible.
 *
 *  So `pressed` is not a free-standing flag; it is a property of the ghost
 *  family. The list below is the definition, the type is derived from it, and the
 *  button's props are a union that makes `variant="primary" pressed` a COMPILE
 *  ERROR rather than a button nobody can read. A hand-written list beside a
 *  hand-written union would be two statements of one fact — and this one already
 *  went stale once. */
export const BUTTON_TOGGLE_VARIANTS = ['ghost', 'dangerGhost'] as const

/** A variant that can be a toggle. */
export type ButtonToggleVariant = (typeof BUTTON_TOGGLE_VARIANTS)[number]

/** The filled variants — `pressed` is not expressible on these. */
type ButtonFillVariant = Exclude<ButtonVariant, ButtonToggleVariant>

/** Everything a button takes, whatever its variant. */
type ButtonCommon = {
  size?: 'sm'
  type?: 'button' | 'submit'
  className?: string
  disabled?: boolean
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  title?: string
  /** The button's ACCESSIBLE NAME, for a button whose face is a word that does
   *  not name what it does. `title` is not a substitute: hard rule 11 says a
   *  control that only explains itself on hover has no explanation on a phone,
   *  and a title is exactly that. */
  label?: string
  children: ReactNode
}

/** A button's props: the toggle state exists only where it can be styled. */
type ButtonProps = ButtonCommon & (
  | {
    variant?: ButtonToggleVariant
    /** Toggle-state styling (aria-pressed): an active mode reads through a
     *  gentle press, never through a fill. */
    pressed?: boolean
  }
  | {
    variant: ButtonFillVariant
    pressed?: never
  }
)

/** The board's one button (see module doc). The click handler receives the
 *  native event so callers inside clickable rows can stopPropagation; plain
 *  zero-arg handlers stay assignable (fewer parameters are always valid).
 *  `size="sm"` is the quiet row/header variant (view-session, refresh, row
 *  actions): one compact size for every secondary in-list affordance, so the
 *  board never mixes a full-size button into a row. */
export function Button({ variant = 'ghost', size, type = 'button', className, disabled, pressed, onClick, title, label, children }: ButtonProps) {
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
      aria-label={label}
    >
      {typeof children === 'string' || typeof children === 'number'
        ? <span data-dsh-tb-pilltext>{children}</span>
        : children}
    </button>
  )
}

/**
 * The board's one icon-only button.
 *
 * WHY IT EXISTS. Five surfaces were hand-writing
 * `<button className={css.iconButton}><Icon name="close" /></button>` — the
 * markup is four lines, so it got copied rather than reached for, and every copy
 * was a place where the accessible name could be forgotten and where a size
 * tweak had to be re-derived. The class existed; the component did not, and a
 * class is not something a page author looks for.
 *
 * `label` IS REQUIRED, and that is the point of the component rather than a
 * formality: an icon-only control has no text, so without it the button
 * announces nothing. Hard rule 11 forbids a control whose only explanation is a
 * `title` — hover does not exist on a phone — so the accessible name is a
 * parameter, not an option.
 *
 * `size` is the component's own ladder (see the size steps in the design sheet):
 * `lg` is the 30px toolbar default, `md` the full button height, `sm` the
 * compact one. A row picks ONE tier; it never mixes two heights side by side.
 */
export const ICON_BUTTON_SIZES = ['lg', 'md', 'sm'] as const

/** One icon-button size step. */
export type IconButtonSize = (typeof ICON_BUTTON_SIZES)[number]

export function IconButton({ size = 'lg', quiet = false, type = 'button', className, disabled, onClick, title, label, children }: {
  size?: IconButtonSize
  /** Present but not asking for attention until hovered or focused. */
  quiet?: boolean
  type?: 'button' | 'submit'
  /** The page's own class, for placing the control in ITS layout (a grid area,
   *  a justify-self). This is the supported way for a surface to say where the
   *  button goes — a descendant selector across the sheet boundary is not. */
  className?: string
  disabled?: boolean
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  title?: string
  /** The button's ACCESSIBLE NAME. Required — see the component doc. */
  label: string
  /** The glyph. */
  children: ReactNode
}) {
  const classes = css.iconButton
    + (size === 'md' ? ` ${css.iconButtonMd}` : size === 'sm' ? ` ${css.iconButtonSm}` : '')
    + (quiet ? ` ${css.iconButtonQuiet}` : '')
    + (className !== undefined ? ` ${className}` : '')
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={label}
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
export function Switch({ checked, onChange, label, title, disabled, describedBy, className }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  title?: string
  disabled?: boolean
  /** Id of the node that states WHY the switch is unusable — the reason has to
   *  be reachable on touch (there is no hover) and announced to assistive
   *  technology, so it is a real reference rather than a tooltip. */
  describedBy?: string
  /** The surface's own class, for placing the switch in ITS layout. A surface
   *  that needs the switch in a particular grid cell passes this and styles it
   *  in its own sheet — the supported direction, where `.row > .switch` from
   *  another sheet is a selector that matches nothing. */
  className?: string
}) {
  return (
    <label className={`${css.switch}${className !== undefined ? ` ${className}` : ''}`} title={title} aria-disabled={disabled === true ? true : undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
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
          <h4 className={`${css.sectionHeadTitle} ${css.truncate}`}>{title}</h4>
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
export function Disclosure({ title, summary, open, onToggle, children, className, headerClassName }: {
  title: string
  /** One-line live summary shown on the header row (collapsed or not). */
  summary?: string
  open: boolean
  onToggle: () => void
  children?: ReactNode
  /** The surface's own class on the SECTION — how a surface gives the fold its
   *  place in a rail (a flex role, an inline inset). */
  className?: string
  /** The surface's own class on the FOLD ROW itself. Two hooks because the fold
   *  is two elements and a surface legitimately places both: the section in its
   *  column, the row inside the section. Reaching either one with a descendant
   *  selector from another sheet is the failure this replaces. */
  headerClassName?: string
}) {
  // The controlled region needs an identity for the header to point at: a
  // disclosure that reports `aria-expanded` without `aria-controls` states its
  // condition but never its subject. Done here once, so every fold built on this
  // component is complete rather than each caller remembering.
  const regionId = useId()
  return (
    <section className={`${css.detailSection}${className !== undefined ? ` ${className}` : ''}`}>
      <button
        type="button"
        className={`${css.detailDisclosure}${headerClassName !== undefined ? ` ${headerClassName}` : ''}`}
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
      >
        <Icon name="chevronDown" className={`${css.detailChevron} ${css.foldMark}`} />
        <span className={css.detailDisclosureTitle}>{title}</span>
        {summary !== undefined && <span className={`${css.inlineSummary} ${css.truncate}`}>{summary}</span>}
      </button>
      {open && <div id={regionId} className={css.detailSectionBody}>{children}</div>}
    </section>
  )
}


/**
 * Minimal inline-icon set (SVG glyphs live here once, sized explicitly so no
 * glyph can ever balloon to the SVG default 300x150 box). Every board icon
 * route goes through this component.
 */
export type IconName = 'arrowDown' | 'arrowUp' | 'chevronDown' | 'close' | 'arrowRight' | 'arrowLeft' | 'link' | 'play' | 'pause' | 'bell' | 'calendar' | 'copy' | 'check' | 'checklist' | 'eyeOff' | 'pencil'

const ICON_PATHS: Record<IconName, string> = {  arrowDown: 'M3 6.5 8 11.5 13 6.5',
  chevronDown: 'M3 6 8 11 13 6',
  /* The up twin of `chevronDown`, mirrored about y = 8. Needed because two
     VISUALLY IDENTICAL downward glyphs for opposite states (`chevronDown` and
     `arrowDown` differ by half a unit of y) make the icon say "down" whether the
     card is open or closed: the arrow carries no state at all while
     `aria-expanded` carries it correctly for screen readers only. A disclosure
     triangle that never turns around is a missed affordance, not a style
     choice. */
  arrowUp: 'M3 9.5 8 4.5 13 9.5',
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

/**
 * Every glyph name, DERIVED from the path table.
 *
 * The gallery renders the whole icon set by iterating this, so a glyph added to
 * the table appears there with no second edit — and a name that somehow has no
 * path cannot appear at all, because the list IS the table's keys.
 */
export const ICON_NAMES = Object.keys(ICON_PATHS) as readonly IconName[]

/**
 * THE plus sign, drawn once.
 *
 * WHY IT IS NOT THE CHARACTER `+`. A full-width or even a half-width plus
 * carries side bearing the glyph itself does not fill, so in a perfectly centred
 * pill the two strokes sit visibly off the optical centre — 「上下居中了，左右偏
 * 右一点」 is a property of the CHARACTER, not of the layout. Drawing the two
 * strokes on a symmetric viewBox removes the question.
 *
 * WHY IT IS A COMPONENT. The board's primary button spelled it as the literal
 * `+ ` inside a template string while the list's drew an SVG — two primary
 * buttons for the same action, with two different plus signs, is the exact
 * 「这个跟那个不是同一套东西」 the reader reported. One glyph, both pages.
 *
 * `size` defaults to 11 and is an ODD number on purpose: the strokes are centred
 * on `5.5` in an 11-unit box, so at every odd size they land on a half-pixel
 * boundary rather than one side of a pixel.
 */
export function PlusIcon({ size = 11, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className === undefined ? undefined : className}
      viewBox="0 0 11 11"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5.5 1v9M1 5.5h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
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
           (that reads as a plain white circle next to 「移除颜色」 when no
           custom color is picked — two white dots). The wrap carries the
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
export function Segmented({ options, value, onChange, ariaLabel, disabled }: {
  options: readonly { value: string; label: string; title?: string }[]
  value: string
  onChange: (next: string) => void
  ariaLabel: string
  /** Stand down the whole group — the shape stays, nothing answers a press.
   *  A group that vanished instead would make the row jump under the reader. */
  disabled?: boolean
}) {
  return (
    <span className={css.segmentedRow} role="radiogroup" aria-label={ariaLabel} aria-disabled={disabled === true ? true : undefined}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`${css.segmentedButton}${value === option.value ? ` ${css.segmentedActive}` : ''}`}
          disabled={disabled}
          title={option.title}
          onClick={() => { onChange(option.value) }}
        >
          {/* 槽是文法的一部分：裸文本在 flex 容器里变成匿名项，行盒不再受
              `line-height` 支配（见 `[data-dsh-tb-pilltext]` 那一处）。 */}
          <span data-dsh-tb-pilltext>{option.label}</span>
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

/**
 * The one search / filter field.
 *
 * WHY IT IS A COMPONENT AND NOT A CLASS. The board's toolbar and the list's
 * toolbar each had their own input rule — one filled with the shell's input
 * face, one with a surface token, both with the shell's 4% hairline — and the
 * two sat one above the other in the same workbench reading as two different
 * products: 「里面的按钮又变窄了、又看不清了」. A field's look is not a page
 * decision. It is the same question in both pages ("let me narrow this"),
 * so it gets one answer, and a page may only place it (width, flex, margins)
 * through its own `className`.
 *
 * WHY IT TAKES NATIVE PROPS. The list's field opens the command palette on
 * click and carries `aria-haspopup`; the board's field feeds a `<datalist>`.
 * Those are behaviours of the CALLER, not variations of the control, so the
 * component stays a thin, fully-props-compatible input instead of growing a
 * zoo of booleans. `type` is fixed to `search` because a field of this family
 * is always a search box.
 */
export function SearchField({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'className'> & { className?: string }) {
  return (
    <input
      {...rest}
      type="search"
      className={`${css.searchField}${className !== undefined ? ` ${className}` : ''}`}
    />
  )
}
