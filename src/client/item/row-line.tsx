/**
 * One row of the table: the list's only unit of work.
 *
 * WHY A TABLE ROW AND NOT A LINE OF TEXT. The list is a list of things to DO,
 * and the fastest way to read a column of them is to scan the column — the status
 * down one edge, the deadlines down another, the titles down the middle. A row
 * that mixes four facts into one wrapped sentence cannot be scanned by any of
 * them, so every fact on it competes with every other fact on every row above it.
 *
 * SEVEN CELLS, ALWAYS SEVEN, AND THE HEAD IS THE PROOF. The head row and the body
 * row declare the same seven tracks, and the first and last have no label (there
 * is nothing to call 「tick」 or 「⋯」), so an empty cell is still a cell: drop it
 * and every cell after it slides one column left, and the head ends up labelling
 * the wrong data. This file therefore renders seven, always, and the head is
 * rendered from the same list of names.
 *
 * THE ROW'S SHAPE IS NOT DECIDED HERE. Whether this reads as a table row or as a
 * stacked two-line row is the LIST COLUMN's width, read by a container query in
 * the stylesheet — so there is no breakpoint in this file, and none of these
 * cells knows which shape it is in.
 *
 * EVERY FACT IS VISIBLE AT REST. Status, number, title, the date verdict and the
 * step count are all on the line with no hover and no second click. Touch has no
 * hover, so a fact that only exists on one is a fact the phone does not have.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { ItemRowView } from '../../core/item-view.ts'
import { DEFAULT_STALE_DAYS } from '../../core/item-view.ts'
import { isEnglish, t } from '../locales.ts'
import { formatItemDate } from './model.ts'
import { Button } from '../board/ui.tsx'
import { ItemRowMenu } from './row-menu.tsx'
import { GROUP_LABEL, PRIORITY_LABEL, STATUS_LABEL } from './labels.ts'
import css from './item.module.css'

/** The four date readings, and the tone each one speaks in. */
type DueTone = 'soft-late' | 'over' | 'soon' | 'set'

/**
 * SHIFT, read off the event that actually carries it.
 *
 * A checkbox's `change` is React's name for the `click` underneath it, so the very
 * same `MouseEvent` is sitting in `nativeEvent` — the modifier is right there and
 * the TYPE says `Event`. Declaring the handler as `onClick` instead would leave a
 * controlled field with no `onChange`, and React answers that with a read-only
 * warning on every render of every row.
 * @param event - the change React synthesised from a click.
 * @returns whether the reader held shift.
 */
function shiftOf(event: React.ChangeEvent<HTMLInputElement>): boolean {
  return (event.nativeEvent as MouseEvent).shiftKey === true
}

/**
 * What the date cell says, and how loudly.
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
      //
      // AND THE TWO NAMES ARE THE ONES THAT DISAGREE — read off the conflict, so
      // each of the three possible pairs names the two fields that are actually
      // in it rather than one hard-coded pair that is wrong for the other two.
      return {
        tone: 'over',
        text: t('item.dates.contradict', {
          a: t(DATE_FIELD_KEY[posture.conflict.field]),
          b: t(DATE_FIELD_KEY[posture.conflict.limitField]),
        }),
      }
    case 'gated':
    case 'none':
      return undefined
  }
}

/**
 * The three date FIELDS, and the one sentence each is named by.
 *
 * A map, because the three cases must not each restate a name: a `switch` over
 * the field would be a second list of the same three, and a fourth date field
 * would have to be added in two places.
 */
const DATE_FIELD_KEY = {
  startsAfter: 'item.field.startsAfter',
  dueAt: 'item.field.dueAt',
  hardDueAt: 'item.field.hardDueAt',
} as const satisfies Record<'startsAfter' | 'dueAt' | 'hardDueAt', string>

/**
 * THE SOFT DATE'S OWN READING, when the combined reading is a HARD one.
 *
 * `posture` answers 「which of the three dates is the one being broken」, and the
 * hard deadline outranks the plan — correctly, because missing a hard deadline is
 * worse. But that ranking is a choice about which fact to LEAD with, and it used
 * to also be a choice about which facts to SAY. So a row that had slipped both
 * said one.
 *
 * Only the slip is reported, never the soft date standing: 「计划超期 N 天」 is the
 * fact the combined reading swallowed. When the combined reading is NOT a hard
 * one this is `undefined` — the soft date is then already the one being spoken,
 * and saying it twice would be noise.
 */
function softLine(view: ItemRowView): { text: string } | undefined {
  const { posture, soft } = view
  const hardSpoke = posture.kind === 'hardOverdue' || posture.kind === 'hardSoon' || posture.kind === 'contradiction'
  if (!hardSpoke || soft.days === undefined || (!soft.overdue && !soft.today)) return undefined
  if (soft.overdue) return { text: t('item.due.planBehind', { days: String(soft.days) }) }
  return { text: t('item.due.planToday') }
}

/** What the meta line says about this row, in the order that reads. */
function metaLine(view: ItemRowView): string {
  const parts: string[] = []
  /* THE NUMBER, OR THE FACT THAT THERE ISN'T ONE YET. `itemRefOf` rather than a
     template, because the ledger's own `#0` sentinel is a fact about storage and
     must never reach the screen; and the row is still worth a word when the
     document has not numbered it, because 「编号待定」 says 「this will have a
     number」 where a blank cell says 「there is nothing here」. */
  parts.push(view.ref.text ?? t('item.ref.pending'))
  if (view.progress !== undefined) parts.push(t('item.steps', { done: String(view.progress.done), total: String(view.progress.total) }))
  // Only once it has actually been neglected. A row touched a minute ago answers
  // zero, and printing 「放置 0 天」 on every fresh row turns the one signal that is
  // supposed to be rare into furniture. The threshold is the one the panel's own
  // triage reads, so the row and the triage never disagree about what counts.
  if (view.staleDays !== undefined && view.staleDays >= DEFAULT_STALE_DAYS) parts.push(t('item.stale', { days: String(view.staleDays) }))
  return parts.join(' · ')
}

export interface ItemRowLineProps {
  readonly view: ItemRowView
  /** Whether this row's detail is open in place (the band with no detail card). */
  readonly expanded: boolean
  /** Whether this row is the one the detail card is showing. */
  readonly selected: boolean
  /** Whether the detail lives in the row rather than in the card beside it. */
  readonly inPlace: boolean
  /**
   * Whether THIS PAGE has a batch surface — which is what puts a pickbox in cell
   * one, on every row, all the time.
   *
   * It used to mean 「the reader is holding several rows」 and the box appeared
   * only then, which is the same condition stated as a MODE. A mode is something
   * the reader has to discover before the control exists: on this panel the only
   * way in was `X`, so the pickbox column was 44px of nothing on every row and the
   * only multi-select a mouse could reach was 「arm the batch in the palette and
   * then look for a box that is not there yet」. A page that CAN batch can say so
   * with a box that is simply there.
   */
  readonly picking: boolean
  /** Whether THIS row is held. */
  readonly picked: boolean
  /**
   * Hold or release this row. The flag is the SHIFT the reader pressed, and it is
   * a parameter rather than something this file reads off the event: 「hold a
   * range」 is a decision about the DOCUMENT, and the document is not this row's.
   */
  readonly onPick: (extend: boolean) => void
  readonly panelId: string
  readonly onToggle: () => void
  readonly onSelect: () => void
  readonly onAsk: () => void
  readonly asking: boolean
  /** Write a patch to THIS row — the hand-off the in-place title editor uses. */
  readonly onPatch: (patch: { readonly title: string }) => void
  /** This row's own receipt, drawn under the control that earned it. */
  readonly receipt?: string
  readonly menuOpen: boolean
  readonly onMenuToggle: () => void
  readonly onMenuClose: () => void
  readonly onMark: (status: 'open' | 'blocked' | 'done') => void
  /** Open the checklist editor and put the caret in its field. */
  readonly onSteps: () => void
  readonly onPromote: () => void
  readonly onRemove: () => void
  /** The in-place detail, rendered only when `inPlace` and open. */
  readonly detail?: React.ReactNode
}

/**
 * One row: seven cells, in the order the head names them.
 * @param props - the projection, the panel's state and the hand-offs.
 * @returns the row, its menu and, when it belongs here, its in-place detail.
 */
export function ItemRowLine(props: ItemRowLineProps) {
  const { view, expanded, selected, inPlace, panelId, menuOpen, onMenuToggle, onMenuClose } = props
  const { item, title, status, posture } = view
  const english = isEnglish()
  const due = dueLine(view, english)
  const soft = softLine(view)
  const regionId = `${panelId}-${item.id}`
  /* The two boxes the menu is placed against: its own trigger, and THIS PANEL's
     root — found by asking this row for its NEAREST ancestor carrying the
     attribute, never `document.querySelector`, which answers 「the first one in
     the document」 and the board carries the SAME attribute. A menu clamped to the
     board's box is the exact failure this geometry exists to prevent. */
  const rowRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    panelRef.current = rowRef.current?.closest<HTMLElement>('[data-dsh-taskboard-view]') ?? null
  }, [])

  /* THE TITLE IS EDITED WHERE IT IS PRINTED. Four fields are a form and a form is
     a trip; the three words a reader wants to change are IN the sentence they are
     complaining about. So the title cell swaps its text for a field on a double
     press and writes through the same `onPatch` the detail card writes through —
     one writer, so a title changed here and a title changed there are the same
     edit. `Esc` abandons it because a reader who pressed Escape wanted to look,
     not to save. */
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const editor = useRef<HTMLInputElement | null>(null)
  const startEditing = (): void => {
    setDraft(title)
    setEditing(true)
  }
  useLayoutEffect(() => {
    if (editing) editor.current?.select()
  }, [editing])

  return (
    <div
      ref={rowRef}
      className={css.itemTableRow}
      data-status={status}
      data-open={inPlace && expanded ? '' : undefined}
      data-selected={selected ? '' : undefined}
      aria-selected={selected}
      /* THE ROW ITSELF IS THE WAY INTO THE DETAIL, and it used to be nothing at
         * all: `onSelect` was declared, handed by the panel, and called by no
         * element on screen. So on a desk — where the detail lives in a rail
         * beside the list — a reader with a mouse could not read a row at all:
         * the rail appeared for the keyboard, and the only pointer route was the
         * `⋯` menu's 「展开详情」, which is offered only on the band where the
         * detail lives IN the row. Both halves of the surface were correct and
         * together they left the most common gesture on the page missing.
         *
         * It is the row and not the title, because a row in a table is one target:
         * a reader aiming at 「这一条挂在一张卡上」 is aiming at the row, and
         * requiring the press to land inside the text is a rule nobody can see.
         * The three controls inside it stop the press on their way up — each one
         * is a different intent, and none of them means 「读这一行」. */
      onClick={props.onSelect}
    >
      {/* 1. THE PICKBOX, AND IT IS ALWAYS THERE ON A PAGE THAT CAN BATCH.
          *
          * It is a real control rather than a `<span role="checkbox">`: a role on
          * a span has no tab stop of its own, and a batch is the only way to change
          * forty rows without forty presses.
          *
          * ALWAYS, rather than 「once the reader has armed the batch」. The
          * pickbox column is 44px wide on every row, so drawing nothing in it for
          * the whole time a reader is looking at the list is a column of nothing —
          * and the reader who wants to tick five rows has to guess that `X` is what
          * makes the boxes appear. It is a real `<input>`, so it is in the tab
          * order whether or not anyone has pressed anything, and the unpressed box
          * says 「this row can be held」 without a word. */}
      <div className={css.itemCellPick}>
        {props.picking && (
          <input
            type="checkbox"
            checked={props.picked}
            onChange={event => props.onPick(shiftOf(event))}
            // 勾选不是「读这一行」：勾完这一行不该顺手把详情轨也打开。
            onClick={event => event.stopPropagation()}
            aria-label={props.picked ? t('item.batch.picked') : t('item.batch.pick')}
          />
        )}
      </div>

      {/* 2. THE STATUS IS A COLUMN, NOT A GROUP HEADER. Four groups meant the same
          status appeared once per group and the count of everything else was a
          separate number to keep in step; one row per item means a status appears
          as many times as there are rows in it, and the number of rows in it is
          what the filter asks. `inProgress` is derived, so it is the one pill that
          is filled: it is the only status that is not written anywhere. */}
      <div className={css.itemCellState} data-col="state">
        <span className={css.itemPill} data-kind={status === 'done' ? 'done' : status === 'blocked' ? 'blocked' : status === 'open' ? undefined : 'running'}>
          {t(GROUP_LABEL[status])}
        </span>
      </div>

      {/* 3. THE TITLE, and under it the facts that are not columns. */}
      <div className={css.itemCellTitle}>
        {editing ? (
          <input
            ref={editor}
            className={css.itemInput}
            value={draft}
            aria-label={t('item.field.title')}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') { setEditing(false); return }
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              setEditing(false)
              if (draft.trim() !== '') props.onPatch({ title: draft.trim() })
            }}
            onBlur={() => { setEditing(false) }}
          />
        ) : (
          <>
            <span
              className={css.itemCellTitleText}
              onDoubleClick={startEditing}
            >
              {title}
            </span>
            <span className={css.itemCellMeta}>
              {[
                metaLine(view),
                soft !== undefined ? soft.text : undefined,
              ].filter(part => part !== undefined && part !== '').join(' · ')}
            </span>
          </>
        )}
      </div>

      {/* 4. PRIORITY. Every row carries it, in a fixed column, so the column can be
          scanned — which is the whole point of a column. The four tones are the
          sheet's four: 紧急 / 高 are the only filled priorities, and 进行中 is the
          third filled thing on the page. */}
      <div className={css.itemCellPrio} data-col="prio">
        <span className={css.itemPill} data-tone={item.priority}>{t(PRIORITY_LABEL[item.priority])}</span>
      </div>

      {/* 5. THE DATE, and only the date the reader can act on. A gate is shown as a
          gate: it is the one field that says 「not yet」 and it never takes part in
          the four date tones. */}
      <div className={css.itemCellDue} data-tone={due?.tone ?? undefined}>
        {due?.text ?? (posture.kind === 'gated'
          ? t('item.startsAfter', { when: formatItemDate(posture.startsAfter, english) })
          : '')}
      </div>

      {/* 6. TAGS, as words rather than pills: a pill has an intrinsic width, and a
          fixed column with pills in it squeezes the title instead. */}
      <div className={css.itemCellTags}>
        {item.tags.map(tag => <span key={tag} className={css.itemTag}>{tag}</span>)}
      </div>

      {/* 7. WHAT THIS ROW CAN DO — AND EVERY ROW SHOWS THE SAME SET.
          *
          * 「问 AI」 used to appear ONLY on a row that hangs off a board card, so a
          * reader scanning the column saw it on row two and not on row three and
          * started looking for whatever they thought they had lost. An action that
          * comes and goes with a fact the interface never states is worse than an
          * action that is always there and says 「not yet」 — the condition is real
          * (a row with no card has no session to ask), so the fix is to SHOW the
          * condition rather than to hide the button.
          *
          * A disabled control is still announced and still has a `title`, and it
          * says which of the two facts is missing — the reader is never left to
          * work out whether the button is broken or the row is.
          */}
      <div className={css.itemCellMenu}>
        <Button
          variant="ghost"
          size="sm"
          className={css.itemAsk}
          onClick={event => { event.stopPropagation(); props.onAsk() }}
          disabled={item.taskId === undefined || props.asking}
          aria-busy={props.asking}
          aria-label={item.taskId === undefined ? t('item.ask.noCard') : undefined}
          title={item.taskId === undefined ? t('item.ask.noCard') : undefined}
        >
          {t('item.ask')}
        </Button>
        <button
          ref={triggerRef}
          type="button"
          className={css.itemMenuButton}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          // The menu is the region this control governs, so it names it. A
          // disclosure that says 「I am open」 without saying 「I open THAT」 is
          // announcing a state the listener cannot tie to anything.
          aria-controls={`item-menu-${item.id}`}
          aria-label={t('item.menu.more')}
          onClick={event => { event.stopPropagation(); onMenuToggle() }}
        >
          <span aria-hidden="true">···</span>
        </button>
      </div>

      {props.receipt !== undefined && <p className={css.itemHint} role="status">{props.receipt}</p>}

      {menuOpen && (
        <ItemRowMenu
          rowId={item.id}
          trigger={triggerRef.current}
          panel={panelRef.current}
          onClose={onMenuClose}
          actions={[
            // Only where there is something to expand. On a band with a detail
            // card the row toggle is not what opens it, so offering 「expand」
            // there would name an action the reader cannot take.
            ...(inPlace
              ? [{ key: 'expand', label: t(expanded ? 'item.menu.collapse' : 'item.menu.expand'), onPick: props.onToggle }]
              : []),
            /* ONLY THE STATES THIS ROW IS NOT IN. Offering 「标为待办」 on a row
               that is already 待办 is a button that cannot do anything. The
               comparison is against the STORED status, not the derived one — 「进行中」
               is not a state a reader can put a row into, so it is never offered. */
            ...(['open', 'blocked', 'done'] as const)
              .filter(mark => mark !== item.status)
              .map(mark => ({ key: mark, label: t(STATUS_LABEL[mark]), onPick: () => props.onMark(mark) })),
            { key: 'rename', label: t('item.menu.rename'), onPick: startEditing },
            /* 「编辑步骤」是唯一一件不在这一行身上发生的事：它把读者送到这一行的
                步骤那一栏，并把光标放进那个框。所以在有步骤的清单页上按它是对的，
                在一条没有步骤的行上按它也一样是对的——那个框照样能加第一步。 */
            { key: 'steps', label: t('item.menu.steps'), onPick: props.onSteps },
            { key: 'promote', label: t('item.menu.promote'), onPick: props.onPromote },
            { key: 'remove', label: t('item.menu.delete'), onPick: props.onRemove },
          ]}
        />
      )}

      {inPlace && expanded && <div className={css.itemDetail} id={regionId}>{props.detail}</div>}
    </div>
  )
}
