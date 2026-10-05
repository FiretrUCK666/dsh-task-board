/**
 * The row line: four tracks, and a sentence with a reading at the end of it.
 *
 * ══ WHY IT IS NOT A TABLE ROW ═══════════════════════════════════════════════
 *
 * It was one — a pickbox column, a status pill, then one column each for the title,
 * the priority, the date and the tags, with ⋮ last. Two things were wrong with that
 * shape and neither was about the columns:
 *
 *   THE ⋮ DID NOT STAY PUT. Two `auto` tracks sized themselves to their contents, so
 *   ⋮ stopped wherever the tags happened to end: a row with one tag sat flush
 *   right, a row with three pulled inwards by two hundred pixels. **A grid says 「I am
 *   the last column」 once and means it at every width**; a flex row has to be told,
 *   and being told means being told wrong the next time a tag gets longer.
 *
 *   THE ROW SAID EACH FACT TWICE. The status had a column AND a word; the date had a
 *   column AND a reading on the meta line. Now: the bead says the state as a shape,
 *   the sentence says the row, and the reading says what the calendar says — one
 *   fact in one place.
 *
 * ══ WHY MULTI-SELECT IS A MODIFIER AND NOT A COLUMN ════════════════════════
 *
 * Forty-four pixels of empty box down every row, on every page, to serve a mode a
 * reader has to discover first. Shift- or ⌘-click, or the 「持有」 entry in ⋮ — and
 * the pickbox column is gone rather than hidden, because a control that is invisible
 * until a step happens is a step.
 *
 * ══ WHY THE BEAD IS SHAPES AND NOT A DOT ═══════════════════════════════════
 *
 * Four states, and the word is not on the row any more. So the shape has to carry it:
 * a filled dot is 待办, a dot inside a halo is 进行中, a broken ring is 受阻, an empty
 * ring is 完成. Readable with the colour taken away — which is what a row that has to
 * be scanned fast needs to be.
 */
import { useEffect, useRef, useState } from 'react'
import type { ItemPriority, ItemRowView, ItemStatusView } from '../../core/item-view.ts'
import { DEFAULT_STALE_DAYS } from '../../core/item-view.ts'
import { t } from '../locales.ts'
import { PRIORITY_LABEL, STATUS_LABEL } from './labels.ts'
import { formatItemDate } from './model.ts'
import { ItemRowMenu } from './row-menu.tsx'
import css from './item.module.css'

/** How the four states are marked. One shape each, no word on the row. */
function stateMark(status: ItemStatusView) {
  switch (status) {
    case 'inProgress':
      return (
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <circle cx="5" cy="5" r="4" fill="var(--dsh-tb-accent)" />
          <circle cx="5" cy="5" r="7" fill="none" stroke="var(--dsh-tb-accent)" strokeOpacity="0.28" strokeWidth="1" />
        </svg>
      )
    case 'blocked':
      return (
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="5 2.4" />
        </svg>
      )
    case 'done':
      return (
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <circle cx="5" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      )
    default:
      return <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="2.5" fill="currentColor" /></svg>
  }
}

/** The priority chip, and the only solid pill on this surface. */
function prioChip(priority: ItemPriority) {
  return (
    <i className={css.itemPrioChip} data-tone={priority} title={`${t('item.field.priority')}${t(PRIORITY_LABEL[priority])}`}>
      !{PRIORITY_DIGIT[priority]}
    </i>
  )
}

/** `!1`..`!4` from the model's own table, so a re-tiering cannot leave a chip lying. */
const PRIORITY_DIGIT: Readonly<Record<ItemPriority, string>> = { urgent: '1', high: '2', normal: '3', low: '4' }

type DueTone = 'set' | 'soon' | 'soft-late' | 'over'

/**
 * THE ONE DATE READING THE ROW CARRIES.
 *
 * One, not two. It used to print the hard deadline's reading at the end of the
 * sentence AND the plan's reading on the line below — two numbers, two words for
 * 「late」, two lines, and a reader has to work out which is about which date.
 *
 * The plan's reading is not lost: it is on the date axis in the expanded row, in the
 * column that already says 「截止」. **一个事实在一行里说一次，在它自己的那一栏里
 * 说一次。**
 *
 * And only the HARD date is red, because that is the one a reader cannot
 * re-negotiate alone. Painting a slipped plan red is how a soft deadline quietly
 * becomes a hard one without anybody deciding that.
 * @param view - the row's projection.
 * @param english - whether the reader's language is English.
 * @returns the tone and the words, or nothing when no date says anything yet.
 */
function dueLine(view: ItemRowView, english: boolean, now: number): { tone: DueTone; text: string } | undefined {
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
      return { tone: 'set', text: t('item.due.set', { when: formatItemDate(posture.at, english, now) }) }
    case 'contradiction':
      // Said, never repaired and never hidden: a row whose three dates disagree is
      // the one row the reader most needs to see, and a list that swallowed it would
      // be the quietest possible way to lose their words. And the two names are the
      // ones that disagree — read off the conflict, so each of the three possible
      // pairs names the two fields actually in it.
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

/** The three date FIELDS and the sentence each is named by — one map, not three cases. */
const DATE_FIELD_KEY = {
  startsAfter: 'item.field.startsAfter',
  dueAt: 'item.field.dueAt',
  hardDueAt: 'item.field.hardDueAt',
} as const satisfies Record<'startsAfter' | 'dueAt' | 'hardDueAt', string>

/** What the meta line says, in the order that reads. */
function metaLine(view: ItemRowView): string {
  const parts: string[] = []
  /* THE NUMBER, OR THE FACT THAT THERE ISN'T ONE YET. `itemRefOf` rather than a
   * template, because the ledger's own `#0` sentinel is a fact about storage and must
   * never reach the screen; and the row is still worth a word when the document has
   * not numbered it, because 「编号待定」 says 「this will have a number」 where a
   * blank cell says 「there is nothing here」. */
  parts.push(view.ref.text ?? t('item.ref.pending'))
  if (view.progress !== undefined) parts.push(t('item.steps', { done: String(view.progress.done), total: String(view.progress.total) }))
  // Only once it has actually been neglected. A row touched a minute ago answers
  // zero, and printing 「放着 0 天」 on every fresh row turns the one signal that is
  // supposed to be rare into furniture. The threshold is the one the rail's own
  // 「没人动的」 reads, so the row and the rail never disagree.
  if (view.staleDays !== undefined && view.staleDays >= DEFAULT_STALE_DAYS) parts.push(t('item.stale', { days: String(view.staleDays) }))
  return parts.join(' · ')
}

export interface ItemRowLineProps {
  readonly view: ItemRowView
  /** THE PANEL'S CLOCK, passed in rather than read. Two clocks on one row is a row
   *  that says 「还早」 and shows last year's date. */
  readonly now: number
  readonly panelId: string
  readonly expanded: boolean
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onToggle: () => void
  /** Whether this PAGE batches. The inbox and the agenda answer false, so a row there
   *  carries no way to be held. */
  readonly picking: boolean
  readonly picked: boolean
  /** Hold one row, optionally as a range over what is on screen. */
  readonly onPick: (extend: boolean) => void
  readonly onPatch: (patch: { readonly title: string }) => void
  readonly menuOpen: boolean
  readonly onMenuToggle: () => void
  readonly onMenuClose: () => void
  readonly onAsk: () => void
  readonly asking: boolean
  readonly receipt?: string
  readonly onMark: (status: 'open' | 'blocked' | 'done') => void
  /** Open the checklist and put the caret in its field. Three things at once: close
   *  the menu, select the row, expand it — picking without expanding leaves the
   *  reader looking at a selected row with no checklist on screen. */
  readonly onSteps: () => void
  readonly onPromote: () => void
  /** 开工 — run the card this row hangs off, through the SAME `runTask` the
   *  catalog's `task.run` binds. Not `rerunTask`: a row that runs a card one way
   *  while the model runs it another is two definitions of 「开工」 on one
   *  installation. */
  readonly onStart: () => void
  /** Whether that card is running, so 「开工」 is not offered twice. */
  readonly running: boolean
  readonly onRemove: () => void
  /** The in-place detail, rendered only when `inPlace` and open. */
  readonly inPlace: boolean
  readonly detail?: React.ReactNode
}

/**
 * One row.
 * @param props - the projection and every hand-off it needs.
 * @returns the row: a bead, a sentence, its tags and one control.
 */
export function ItemRowLine(props: ItemRowLineProps) {
  const { view, expanded, selected, inPlace, panelId, menuOpen, onMenuToggle, onMenuClose } = props
  const item = view.item
  const english = t('item.field.title') === 'Title'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.title)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const regionId = `${panelId}-row-${item.id}-detail`

  // The draft follows the row it is renaming, and a row's title changes from three
  // places — the pencil, the keyboard, the model — so an edit that started on a stale
  // value would file the stale value.
  useEffect(() => { if (!editing) setDraft(item.title) }, [item.title, editing])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const startEditing = (): void => { setDraft(item.title); setEditing(true); onMenuClose() }
  const commitTitle = (): void => {
    const words = draft.trim()
    if (words !== '' && words !== item.title) props.onPatch({ title: words })
    setEditing(false)
  }

  const due = dueLine(view, english, props.now)

  return (
    <div
      className={css.itemRow}
      role="listitem"
      data-status={view.status}
      data-open={inPlace && expanded ? '' : undefined}
      data-selected={selected ? '' : undefined}
      data-picked={props.picked ? '' : undefined}
      onClick={() => { props.onSelect(); if (!inPlace) props.onToggle() }}
    >
      {/* THE BEAD: a shape, and it is the only thing that says the state. */}
      <span className={css.itemRowLead} aria-hidden="true">{stateMark(view.status)}</span>

      <div className={css.itemRowCell}>
        {editing
          ? (
            <input
              ref={inputRef}
              className={css.itemRowTitleInput}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); commitTitle() }
                if (event.key === 'Escape') { event.preventDefault(); setEditing(false) }
              }}
            />
          )
          : (
            /* THE SENTENCE, AND THE READING AT ITS END.
             *
             * 行内排版，不是 flex —— flex 的换行是在**收缩之前**按基准尺寸决定的，于是
             * 芯片 30px 加上整句的 max-content 超过一行宽时，**整句被推到下一行、芯片
             * 自己留在上面**。412px 上每一行都成了「一行芯片 + 三行标题」。换成正常的行内
             * 流之后，芯片是段首的一个词、读法是句末的一个短语，文字自己折行。 */
            <h3 className={css.itemRowTitle}>
              <button type="button" className={css.itemPrioButton} onClick={event => { event.stopPropagation(); startEditing() }}>
                {prioChip(item.priority)}
              </button>
              <span className={css.itemRowText}>{item.title}</span>
              {due !== undefined && (
                <span className={css.itemRowTail} data-tone={due.tone}>{`（${due.text}）`}</span>
              )}
            </h3>
          )}

        {/* THE META LINE SAYS THREE THINGS, and it used to say four.
         *
         * **状态不在这里。** 它原来印着「待办」，而左边那个点已经说了同一件事——一个
         * 事实在一行里出现两遍，读者得先判断哪一遍算数。
         *
         * 挂着的卡由一枚记号说，不占一个字——那一行已经被四件事实占满了。 */}
        <p className={css.itemRowMeta}>
          {item.taskId !== undefined && (
            <svg className={css.itemRowCard} viewBox="0 0 9 9" width="9" height="9" aria-hidden="true">
              <rect x="1" y="1" width="7" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
          {metaLine(view)}
        </p>
      </div>

      {/* TAGS, AS CHIPS, AND ALWAYS VISIBLE. They were bare words in a column, which
          made the one field a reader scans a list FOR the hardest to find: a word with
          no edge is a word the eye slides off. */}
      {item.tags.length > 0 && (
        <p className={css.itemRowTags}>
          {item.tags.map(tag => <span key={tag} className={css.itemTag}>#{tag}</span>)}
        </p>
      )}

      <button
        ref={triggerRef}
        type="button"
        className={css.itemRowDots}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        // The menu is the region this control governs, so it names it. A disclosure
        // that says 「I am open」 without saying 「I open THAT」 announces a state the
        // listener cannot tie to anything.
        aria-controls={`item-menu-${item.id}`}
        aria-label={t('item.menu.more')}
        onClick={event => { event.stopPropagation(); onMenuToggle() }}
      >
        <svg viewBox="0 0 4 16" width="4" height="16" aria-hidden="true">
          <circle cx="2" cy="3" r="1.3" fill="currentColor" />
          <circle cx="2" cy="8" r="1.3" fill="currentColor" />
          <circle cx="2" cy="13" r="1.3" fill="currentColor" />
        </svg>
      </button>

      {props.receipt !== undefined && <p className={css.itemHint} role="status">{props.receipt}</p>}

      {menuOpen && (
        <ItemRowMenu
          rowId={item.id}
          trigger={triggerRef.current}
          panel={panelRef.current}
          onClose={onMenuClose}
          actions={[
            /* THE THREE VERBS, IN THE ORDER THE READER MEETS THEM, none repeating
             * another.
             *
             * 变成看板卡片 first, because it is the one that changes what this row IS
             * attached to; everything below it only changes what it says. The draft had
             * 「交给模型去做」 in this slot, and swapping them puts the decision a row
             * cannot make without you above the one it can.
             *
             * LISTED EVEN WHEN IT CANNOT ACT, disabled with the reason — the same
             * treatment 「问一句」 gets. An entry that comes and goes with a fact the
             * interface never states is worse than one that is always there and says
             * 「not yet」. */
            { key: 'promote', label: t('item.menu.promote'), onPick: props.onPromote },
            {
              key: 'start',
              label: t('item.menu.start'),
              hint: item.taskId === undefined ? t('item.menu.startNoCard') : undefined,
              disabled: item.taskId === undefined || props.running,
              onPick: props.onStart,
            },
            {
              key: 'ask',
              label: t('item.ask'),
              hint: item.taskId === undefined ? t('item.ask.noCard') : undefined,
              disabled: item.taskId === undefined || props.asking,
              onPick: props.onAsk,
            },
            // Only where there is something to expand. On a band with a detail card
            // the row toggle is not what opens it, so offering 「expand」 there would
            // name an action the reader cannot take.
            ...(inPlace
              ? [{ key: 'expand', label: t(expanded ? 'item.menu.collapse' : 'item.menu.expand'), onPick: props.onToggle }]
              : []),
            { key: 'steps', label: t('item.menu.steps'), onPick: props.onSteps },
            { key: 'rename', label: t('item.menu.rename'), onPick: startEditing },
            /* ONLY THE STATES THIS ROW IS NOT IN. Offering 「标为待办」 on a row that is
             * already 待办 is a button that cannot do anything. The comparison is
             * against the STORED status, not the derived one — 「进行中」 is not a
             * state a reader can put a row into, so it is never offered. */
            ...(['open', 'blocked', 'done'] as const)
              .filter(mark => mark !== item.status)
              .map(mark => ({ key: mark, label: t(STATUS_LABEL[mark]), onPick: () => props.onMark(mark) })),
            /* HOLDING ONE ROW WITHOUT A MODIFIER, because the pickbox that used to do
             * this was a column on every row for one checkbox. The entry says which
             * state it is in, because a menu whose labels flip is a menu nobody can
             * learn. */
            ...(props.picking
              ? [{ key: 'pick', label: t(props.picked ? 'item.batch.release' : 'item.batch.hold'), onPick: () => props.onPick(false) }]
              : []),
            { key: 'remove', label: t('item.menu.delete'), hint: t('item.archive.window'), onPick: props.onRemove },
          ]}
        />
      )}

      {inPlace && expanded && <div className={css.itemDetail} id={regionId}>{props.detail}</div>}
      <div ref={panelRef} hidden />
    </div>
  )
}