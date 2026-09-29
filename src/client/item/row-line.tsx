/**
 * One row of the list, at rest.
 *
 * Level 0 of the two this panel has. It answers three questions and no more:
 * what is it called, what state is it in, and what is the one fact that matters
 * most today. Everything else is one click away in the detail, and the detail
 * opens IN PLACE — a dialog opened from here would anchor to the board's first
 * box, which is a different surface entirely, and a layer that floats over
 * another surface is not this surface's layer.
 *
 * TWO READING POSITIONS, ONE GRID. The title sits in one row of a named grid
 * and the facts in the row below it, with the state mark and the number in
 * areas that span both. That is the whole reason the title and the group count
 * can no longer print on top of each other: the alignment is computed by the
 * grid instead of by two offsets that each had to be right on their own.
 *
 * EVERY FACT IS VISIBLE AT REST. Status, number, title, the date verdict and
 * the step count are all on the line with no hover and no second click. Touch
 * has no hover, so a fact that only exists on one is a fact the phone does not
 * have.
 */
import { useLayoutEffect, useRef } from 'react'
import type { ItemRowView } from '../../core/item-view.ts'
import { DEFAULT_STALE_DAYS } from '../../core/item-view.ts'
import type { ItemPriority } from '../../core/item.ts'
import { isEnglish, t } from '../locales.ts'
import { formatItemDate } from './model.ts'
import type { ItemDensity } from './model.ts'
import { Button } from '../board/ui.tsx'
import { ItemRowMenu } from './row-menu.tsx'
import css from './item.module.css'

/** Each priority's word. A closed table, so a tier the model adds fails here. */
const PRIORITY_LABEL: Readonly<Record<ItemPriority, 'item.priority.low' | 'item.priority.normal' | 'item.priority.high' | 'item.priority.urgent'>> = {
  low: 'item.priority.low',
  normal: 'item.priority.normal',
  high: 'item.priority.high',
  urgent: 'item.priority.urgent',
}

/** The three marks a reader can put a row into, and each one's word. */
const MARK_LABEL: Readonly<Record<'open' | 'blocked' | 'done', 'item.status.open' | 'item.status.blocked' | 'item.status.done'>> = {
  open: 'item.status.open',
  blocked: 'item.status.blocked',
  done: 'item.status.done',
}

/** The four date readings, and the tone each one speaks in. */
type DueTone = 'soft-late' | 'over' | 'soon' | 'set'

/**
 * What the date line says, and how loudly.
 *
 * The one rule worth stating out loud: a missed WANTED-BY date is not an alarm.
 * It is a fact about a plan that slipped, so it reads in neutral ink and says
 * 「落后 N 天」. Only a missed HARD deadline is red, because that is the one the
 * reader cannot re-negotiate alone. Painting a slipped plan red is how a soft
 * deadline becomes a hard one without anybody ever deciding that.
 * @param view - the row's projection.
 * @param english - whether the reader's language is English.
 * @returns the tone and the words, or nothing when the row has no date.
 */
function dueLine(view: ItemRowView, english: boolean): { tone: DueTone; text: string } | undefined {
  const { posture } = view
  switch (posture.kind) {
    case 'behind':
      return { tone: 'soft-late', text: t('item.due.behind', { days: String(posture.days) }) }
    case 'hardOverdue':
      return { tone: 'over', text: t('item.due.overdue', { days: String(posture.days) }) }
    case 'hardSoon':
      return { tone: 'soon', text: t('item.due.soon', { days: String(posture.days) }) }
    case 'dueToday':
      return { tone: 'set', text: t('item.due.today') }
    case 'hardAhead':
    case 'upcoming':
      return { tone: 'set', text: t('item.due.set', { when: formatItemDate(posture.at, english) }) }
    case 'contradiction':
      // Said, never repaired and never hidden: a row whose three dates disagree
      // is the one row the reader most needs to see, and a schedule that
      // swallowed it would be the quietest possible way to lose their words.
      return {
        tone: 'over',
        text: t('item.dates.contradict', {
          a: t('item.field.startsAfter'),
          b: t('item.field.dueAt'),
        }),
      }
    case 'gated':
    case 'none':
      return undefined
  }
}

export interface ItemRowLineProps {
  readonly view: ItemRowView
  readonly density: ItemDensity
  /** Whether this row's detail is open in place. */
  readonly expanded: boolean
  /** Whether this row is the one the detail pane is showing. */
  readonly selected: boolean
  /** Whether the detail lives in the row (narrow) or in the pane (wide). */
  readonly inPlace: boolean
  readonly panelId: string
  readonly onToggle: () => void
  readonly onSelect: () => void
  readonly onAsk: () => void
  readonly asking: boolean
  /** The menu's open state and its dismissal, so one click closes it. */
  readonly menuOpen: boolean
  readonly onMenuToggle: () => void
  readonly onMenuClose: () => void
  readonly onMark: (status: 'open' | 'blocked' | 'done') => void
  readonly onPromote: () => void
  readonly onRemove: () => void
  /** The in-place detail, rendered only when `inPlace` and open. */
  readonly detail?: React.ReactNode
}

/**
 * One row.
 * @param props - the projection, the panel's state and the hand-offs.
 * @returns the row, its menu and, when it belongs here, its in-place detail.
 */
export function ItemRowLine(props: ItemRowLineProps) {
  const { view, density, expanded, selected, inPlace, panelId, menuOpen, onMenuToggle, onMenuClose } = props
  const { item, ref, title, status, progress, posture } = view
  const english = isEnglish()
  const due = dueLine(view, english)
  const regionId = `${panelId}-${item.id}`
  /* The two boxes the menu is placed against: its own trigger, and THIS PANEL's
     root. The panel is found by asking this row for its NEAREST ancestor
     carrying the attribute — never by `document.querySelector`, which answers
     "the first one in the document", and the board's own panel carries the SAME
     attribute (`TaskBoardPanel.tsx`). The first match is therefore the board's box
     whenever both surfaces are in the tree at once, and a menu clamped to another
     surface's box is the exact failure this geometry exists to prevent: a layer
     that floats over the wrong panel is not this panel's layer.
     `useSurfaceNarrow` resolves the same surface with `closest` for the same
     reason; this is that idiom, applied to the box rather than to a breakpoint. */
  const rowRef = useRef<HTMLLIElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    panelRef.current = rowRef.current?.closest<HTMLElement>('[data-dsh-taskboard-view]') ?? null
  }, [])
  return (
    <li
      ref={rowRef}
      className={css.itemRow}
      data-status={status}
      data-density={density}
      data-open={inPlace && expanded ? '' : undefined}
      data-selected={selected ? '' : undefined}
    >
      <button
        type="button"
        className={css.itemRowMain}
        aria-expanded={inPlace ? expanded : undefined}
        aria-controls={inPlace ? regionId : undefined}
        onClick={() => {
          props.onSelect()
          props.onToggle()
        }}
      >
        <span className={css.itemStateMark} aria-hidden="true" />
        <span className={css.itemRef} title={ref.numbered ? undefined : t('item.ref.pending')}>
          {ref.text ?? '—'}
        </span>
        {/* THE PRIORITY PILL, and only when the model says this row is worth
            interrupting for. `priorityLoud` is the model's own word for it — the
            default tier stays quiet, because a pill on every row is a pill nobody
            reads, and the reader who cares about priority is the one filtering on
            it. The model has computed this field since the row projection was
            written and the interface never read it, which is how a derived
            judgment turns into folklore and then into a bug report.

            IT IS NEUTRAL INK, and that is a budget decision rather than a taste
            one. The surface has three attention positions and four danger ones,
            all spent: the triage sentences, a deadline inside the week, the
            running dot, an overrun, the blocked dot, the delete, the overdue
            tile. A pill that spent a fifth colour would be the first thing on the
            row that is neither the title nor a date. Priority is carried by the
            WORD — 「紧急」 says it — and by the fixed place it occupies, not by a
            seventh colour. A colour's share of attention is what it means. */}
        {view.priorityLoud && (
          <span className={css.itemPriority} data-level={view.item.priority}>
            {t(PRIORITY_LABEL[view.item.priority])}
          </span>
        )}
        <span className={css.itemTitle}>
          <span className={css.itemTitleText}>{title}</span>
        </span>
        <span className={css.itemRowMeta}>
          {/* The gate is shown as a gate: it is the one field that says "not yet",
              and it never takes part in the four date tones. */}
          {posture.kind === 'gated' && (
            <span className={css.itemStartsAfter}>
              {t('item.startsAfter', { when: formatItemDate(posture.startsAfter, english) })}
            </span>
          )}
          {due !== undefined && <span className={css.itemDue} data-tone={due.tone}>{due.text}</span>}
          {progress !== undefined && (
            <span className={css.itemSteps}>{t('item.steps', { done: String(progress.done), total: String(progress.total) })}</span>
          )}
          {/* Only once it has actually been neglected. The projection answers
              "how long since a change", and a row touched a minute ago answers
              zero — printing 「放置 0 天」 on every fresh row turns the one
              signal that is supposed to be rare into furniture. The threshold
              is the same one the triage strip uses, so the row and the strip
              never disagree about what counts as neglected. */}
          {view.staleDays !== undefined && view.staleDays >= DEFAULT_STALE_DAYS && (
            <span className={css.itemSteps}>{t('item.stale', { days: String(view.staleDays) })}</span>
          )}
        </span>
      </button>

      <span className={css.itemRowActions}>
        {/* Only where there is a target. A button that can only explain itself
            when pressed is lying about what it does, so a row with no board card
            gets no hand-off at all. */}
        {item.taskId !== undefined && (
          <Button variant="ghost" size="sm" className={css.itemAsk} onClick={props.onAsk} disabled={props.asking}>
            {t(props.asking ? 'item.ask.busy' : 'item.ask')}
          </Button>
        )}
        <button
          ref={triggerRef}
          type="button"
          className={css.itemRowMenuButton}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          // The menu is the region this control governs, so it names it. A
          // disclosure that says "I am open" without saying "I open THAT" is
          // announcing a state the listener cannot tie to anything.
          aria-controls={`item-menu-${item.id}`}
          aria-label={t('item.menu.more')}
          onClick={onMenuToggle}
        >
          <span aria-hidden="true">···</span>
        </button>
      </span>

      {menuOpen && (
        <ItemRowMenu
          rowId={item.id}
          trigger={triggerRef.current}
          panel={panelRef.current}
          onClose={onMenuClose}
          actions={[
            // Only where there is something to expand. On a wide surface the
            // detail lives in the pane and the row toggle is not what opens it,
            // so offering "expand" there would name an action the reader cannot
            // take.
            ...(props.inPlace
              ? [{ key: 'expand', label: t(props.expanded ? 'item.menu.collapse' : 'item.menu.expand'), onPick: props.onToggle }]
              : []),
            /* ONLY THE STATES THIS ROW IS NOT IN. Offering 「标为待办」 on a row
               that is already 待办 is a button that cannot do anything, and the
               product's own rule is that the interface carries no action which
               does nothing when pressed. It also reads as a bug for a different
               reason: a reader who cannot tell which entry is a no-op will try
               all three, and the two that work will look unreliable rather than
               the one that was always dead. The comparison is against the STORED
               status, not the derived one — 「进行中」 is not a state a reader can
               put a row into, so it is never offered either. */
            ...(['open', 'blocked', 'done'] as const)
              .filter(mark => mark !== item.status)
              .map(mark => ({ key: mark, label: t(MARK_LABEL[mark]), onPick: () => props.onMark(mark) })),
            { key: 'promote', label: t('item.menu.promote'), onPick: props.onPromote },
            { key: 'remove', label: t('item.menu.delete'), onPick: props.onRemove },
          ]}
        />
      )}

      {inPlace && expanded && <div className={css.itemDetail} id={regionId}>{props.detail}</div>}
    </li>
  )
}
